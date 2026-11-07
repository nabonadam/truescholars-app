/**
 * Thematic analysis in Braun & Clarke's phases, with Claude doing the mechanical first passes and the
 * researcher reviewing and editing at each step:
 *   1 familiarise (per participant) → 2 code (per participant, verbatim quotes) → 3 codebook (merge codes)
 *   → 4 themes (+ thematic map) → 5 framework matrix (per participant) → 6 report.
 * Per-participant phases run a few participants per call, so the page can show progress and no request
 * runs for minutes. Every quote is checked against the transcripts; quotes that aren't found are dropped.
 * Only transcripts and typed answers are sent to the AI: never names, emails or audio.
 */

import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { qualAnalyses } from "@/db/schema";
import { answerText, answerable, pid, questionNumbers, type Question } from "@/lib/qual";
import { QualError, getStudy, listResponses, usable } from "./qual";
import { fieldQuestions } from "./qualExport";

export type Quote = { rid: string; text: string };
export type RawCode = { label: string; description: string; quotes: string[] };
export type CodebookEntry = { id: string; label: string; definition: string; rids: string[]; quotes: Quote[]; theme?: string };
export type Theme = { id: string; name: string; definition: string; codes: string[]; subthemes: { name: string; codes: string[] }[] };
export type AnalysisState = {
  familiar?: Record<string, { summary: string; notes: string[] }>;
  codes?: Record<string, RawCode[]>;
  codebook?: CodebookEntry[];
  themes?: Theme[];
  matrix?: Record<string, Record<string, string>>; // participant (response id) → theme id → summary
  report?: string;
  done?: Partial<Record<Phase, string>>; // ISO time each phase finished
};
export const PHASES = ["familiar", "codes", "codebook", "themes", "matrix", "report"] as const;
export type Phase = (typeof PHASES)[number];

const BATCH: Partial<Record<Phase, number>> = { familiar: 3, codes: 2, matrix: 3 };
/** What each phase is built from (familiarisation is recommended but not required before coding). */
const NEEDS: Partial<Record<Phase, Phase>> = { codebook: "codes", themes: "codebook", matrix: "themes", report: "themes" };

// ───────── data ─────────

export type Case = { rid: string; pid: string; text: string; words: number; attributes: string[] };

/** Each usable participant as one document: attributes, then each open question and answer. */
export async function cases(db: DB, ownerId: string, studyId: string): Promise<{ study: NonNullable<Awaited<ReturnType<typeof getStudy>>>; list: Case[]; questions: Question[] }> {
  const study = await getStudy(db, ownerId, studyId);
  if (!study) throw new QualError("Study not found.");
  const qs = fieldQuestions(study);
  const nums = questionNumbers(qs);
  const open = answerable(qs).filter((q) => q.type === "voice" || q.type === "text");
  const closed = answerable(qs).filter((q) => q.type !== "voice" && q.type !== "text");
  const list = usable(await listResponses(db, ownerId, studyId))
    .map((r) => {
      const text = open
        .map((q) => {
          const a = answerText(q, r.answers[q.id]);
          return a ? `Q${nums[q.id]}. ${q.text}\n${a}` : "";
        })
        .filter(Boolean)
        .join("\n\n");
      const attributes = closed.map((q) => `${q.text}: ${answerText(q, r.answers[q.id]) || "-"}`);
      return { rid: r.id, pid: pid(r.n), text, words: text.split(/\s+/).filter(Boolean).length, attributes };
    })
    .filter((c) => c.words > 0);
  return { study, list, questions: qs };
}

export async function getAnalysis(db: DB, studyId: string) {
  const [a] = await db.select().from(qualAnalyses).where(eq(qualAnalyses.studyId, studyId));
  return { researchQuestion: a?.researchQuestion ?? "", background: a?.background ?? "", state: ((a?.state as AnalysisState) ?? {}) as AnalysisState };
}

async function saveState(db: DB, studyId: string, state: AnalysisState) {
  await db.insert(qualAnalyses).values({ studyId, state }).onConflictDoUpdate({ target: qualAnalyses.studyId, set: { state } });
}

export async function saveSetup(db: DB, ownerId: string, studyId: string, researchQuestion: string, background: string) {
  if (!(await getStudy(db, ownerId, studyId))) throw new QualError("Study not found.");
  const rq = researchQuestion.trim().slice(0, 1000);
  if (rq.length < 10) throw new QualError("Write your research question first: the analysis is organised around it.");
  await db
    .insert(qualAnalyses)
    .values({ studyId, researchQuestion: rq, background: background.trim().slice(0, 4000) })
    .onConflictDoUpdate({ target: qualAnalyses.studyId, set: { researchQuestion: rq, background: background.trim().slice(0, 4000) } });
}

/** Clears a phase and everything after it (they were built from it). */
function resetFrom(state: AnalysisState, phase: Phase): AnalysisState {
  const s: AnalysisState = { ...state, done: { ...state.done } };
  for (const p of PHASES.slice(PHASES.indexOf(phase))) {
    delete s[p];
    delete s.done![p];
  }
  return s;
}

// ───────── quotes ─────────

const norm = (s: string) => s.toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}']+/gu, " ").trim();

/** The quote as it appears in the transcript (exact wording), or null if it isn't there. */
export function findQuote(quote: string, source: string): string | null {
  const q = norm(quote.replace(/^[\s"'“”‘’.…]+|[\s"'“”‘’.…]+$/g, "").replace(/\.\.\.|…/g, " "));
  if (q.split(" ").length < 3) return null;
  // find the shortest run of source words whose normalised text contains the quote
  const flat = norm(source);
  if (!flat.includes(q)) return null;
  const tokens = source.match(/\S+/g) ?? [];
  const qWords = q.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    if (!norm(tokens[i]).startsWith(qWords[0]) && !qWords[0].startsWith(norm(tokens[i]))) continue;
    for (let j = i; j < Math.min(tokens.length, i + qWords.length + 6); j++) {
      if (norm(tokens.slice(i, j + 1).join(" ")).includes(q)) return tokens.slice(i, j + 1).join(" ").replace(/^["“‘']+|["”’',;:]+$/g, "");
    }
  }
  return quote.trim();
}

// ───────── Claude ─────────

export const aiOn = () => !!process.env.ANTHROPIC_API_KEY;

async function claude(system: string, user: string, maxTokens: number): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new QualError("AI analysis isn't switched on yet.");
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: user }];
  let text = "";
  // A reply that hits the length limit is continued (up to twice) instead of being cut off mid-sentence.
  for (let round = 0; round < 3; round++) {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages }),
      signal: AbortSignal.timeout(170_000),
    });
    if (!res.ok) {
      console.error("anthropic", res.status, (await res.text().catch(() => "")).slice(0, 300));
      throw new QualError("The analysis assistant is busy right now. Try again in a moment.");
    }
    const data = (await res.json()) as { content: { type: string; text?: string }[]; stop_reason?: string };
    const part = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    text += part;
    if (data.stop_reason !== "max_tokens" || !part) break;
    messages.push({ role: "assistant", content: text }, { role: "user", content: "You were cut off. Continue exactly where you stopped, without repeating anything." });
    if (messages.length > 4) messages.splice(1, 2); // keep only the latest partial reply
  }
  return text.trim();
}

export function parseJson<T>(text: string): T | null {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  for (const candidate of [t, t.match(/\{[\s\S]*\}/)?.[0], t.match(/\[[\s\S]*\]/)?.[0]]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

async function claudeJson<T>(system: string, user: string, maxTokens: number): Promise<T> {
  const first = await claude(system + "\nReply with JSON only, no other text.", user, maxTokens);
  const parsed = parseJson<T>(first);
  if (parsed) return parsed;
  const again = parseJson<T>(await claude(system + "\nReply with valid JSON only, no other text. Your last reply could not be read as JSON.", user, maxTokens));
  if (!again) throw new QualError("The analysis assistant returned something unreadable. Try that step again.");
  return again;
}

const ROLE = "You are an experienced qualitative researcher assisting with reflexive thematic analysis (Braun & Clarke). You stay close to what participants actually said, use plain academic English, and never invent data or quotes.";
const ctx = (rq: string, bg: string) => `Research question: ${rq}${bg ? `\nStudy background: ${bg}` : ""}`;
const chunk = (text: string, maxWords = 6000) => {
  const w = text.split(/\s+/);
  if (w.length <= maxWords) return [text];
  const out: string[] = [];
  for (let i = 0; i < w.length; i += maxWords) out.push(w.slice(i, i + maxWords).join(" "));
  return out;
};

// ───────── phases ─────────

export type StepResult = { phase: Phase; done: number; total: number; finished: boolean };

/** Runs the next batch of a phase. Call repeatedly until `finished`. `restart` clears the phase first. */
export async function runPhase(db: DB, ownerId: string, studyId: string, phase: Phase, opts: { restart?: boolean } = {}): Promise<StepResult> {
  const { list } = await cases(db, ownerId, studyId);
  if (!list.length) throw new QualError("There are no completed responses with answers to analyse yet.");
  const a = await getAnalysis(db, studyId);
  if (a.researchQuestion.length < 10) throw new QualError("Write your research question first.");
  let state = opts.restart ? resetFrom(a.state, phase) : a.state;
  const need = NEEDS[phase];
  if (need && !state.done?.[need]) throw new QualError("Finish the previous step first.");
  const C = ctx(a.researchQuestion, a.background);
  const byRid = Object.fromEntries(list.map((c) => [c.rid, c]));

  if (phase === "familiar" || phase === "codes" || phase === "matrix") {
    const store = (state[phase] ?? {}) as Record<string, unknown>;
    const todo = list.filter((c) => !(c.rid in store)).slice(0, BATCH[phase]);
    await Promise.all(
      todo.map(async (c) => {
        if (phase === "familiar") store[c.rid] = await familiarise(C, c);
        if (phase === "codes") store[c.rid] = await code(C, c);
        if (phase === "matrix") store[c.rid] = await matrixRow(C, c, state);
      }),
    );
    const done = list.filter((c) => c.rid in store).length;
    const finished = done >= list.length;
    if (phase === "matrix") {
      // stored per participant while running; the final shape is theme → participant
      state = { ...state, matrix: store as AnalysisState["matrix"] };
    } else {
      state = { ...state, [phase]: store };
    }
    if (finished) state.done = { ...state.done, [phase]: new Date().toISOString() };
    await saveState(db, studyId, state);
    return { phase, done, total: list.length, finished };
  }

  if (phase === "codebook") state = { ...state, codebook: await buildCodebook(C, state, byRid) };
  if (phase === "themes") state = { ...state, themes: await buildThemes(C, state) };
  if (phase === "report") state = { ...state, report: await writeReport(a.researchQuestion, a.background, state, list) };
  state.done = { ...state.done, [phase]: new Date().toISOString() };
  await saveState(db, studyId, state);
  return { phase, done: 1, total: 1, finished: true };
}

async function familiarise(C: string, c: Case) {
  const r = await claudeJson<{ summary: string; notes: string[] }>(
    ROLE,
    `${C}\n\nPhase 1, familiarisation. Read this participant's answers and give:\n- "summary": 2 to 3 sentences on what this participant says that matters for the research question.\n- "notes": 3 to 5 short initial observations (patterns, tensions, striking ideas) worth noticing.\n\nParticipant ${c.pid}${c.attributes.length ? ` (${c.attributes.join("; ")})` : ""}:\n${c.text.slice(0, 40_000)}\n\nJSON: {"summary": "...", "notes": ["...", "..."]}`,
    1200,
  );
  return { summary: String(r.summary ?? "").slice(0, 1200), notes: (r.notes ?? []).map(String).slice(0, 6) };
}

async function code(C: string, c: Case): Promise<RawCode[]> {
  const out: RawCode[] = [];
  for (const part of chunk(c.text)) {
    const r = await claudeJson<{ codes: RawCode[] }>(
      ROLE,
      `${C}\n\nPhase 2, coding. Code this participant's answers inductively. Give 6 to 15 codes that capture meaningful features of the data relevant to the research question (semantic and, where clear, latent).\nFor each code: "label" (2 to 6 words), "description" (one sentence), and "quotes": 1 to 3 short excerpts copied EXACTLY, word for word, from the text below (5 to 40 words each). Never paraphrase or join separate sentences into one quote.\n\nParticipant ${c.pid}:\n${part}\n\nJSON: {"codes": [{"label": "...", "description": "...", "quotes": ["..."]}]}`,
      3000,
    );
    for (const k of r.codes ?? []) {
      const quotes = (k.quotes ?? []).map((q) => findQuote(String(q), c.text)).filter((q): q is string => !!q);
      if (!k.label || !quotes.length) continue; // a code without evidence in the data is dropped
      out.push({ label: String(k.label).slice(0, 80), description: String(k.description ?? "").slice(0, 400), quotes: [...new Set(quotes)].slice(0, 3) });
    }
  }
  return out;
}

async function buildCodebook(C: string, state: AnalysisState, byRid: Record<string, Case>): Promise<CodebookEntry[]> {
  const flat = Object.entries(state.codes ?? {}).flatMap(([rid, codes]) => codes.map((k) => ({ rid, ...k })));
  if (!flat.length) throw new QualError("No codes yet. Run the coding step first.");
  const listing = flat.map((k, i) => `C${i + 1} [${byRid[k.rid]?.pid ?? "?"}] ${k.label}: ${k.description}`).join("\n");
  const r = await claudeJson<{ codes: { label: string; definition: string; members: string[] }[] }>(
    ROLE,
    `${C}\n\nPhase 3, reviewing codes. Below are codes generated separately for each participant (id, participant, label: description). Many mean the same thing. Merge codes with the same meaning into a shared codebook of 12 to 40 codes. Keep distinct ideas apart; don't force everything together. Every input id must appear in exactly one group.\nFor each code: "label" (2 to 6 words), "definition" (one sentence, saying what is and isn't included), "members" (the input ids).\n\nCODES:\n${listing.slice(0, 120_000)}\n\nJSON: {"codes": [{"label": "...", "definition": "...", "members": ["C1", "C7"]}]}`,
    8000,
  );
  const used = new Set<number>();
  const book: CodebookEntry[] = [];
  for (const g of r.codes ?? []) {
    const idx = (g.members ?? []).map((m) => Number(String(m).replace(/\D/g, "")) - 1).filter((i) => i >= 0 && i < flat.length && !used.has(i));
    if (!idx.length) continue;
    idx.forEach((i) => used.add(i));
    const members = idx.map((i) => flat[i]);
    book.push({
      id: `K${book.length + 1}`,
      label: String(g.label).slice(0, 80),
      definition: String(g.definition ?? "").slice(0, 500),
      rids: [...new Set(members.map((m) => m.rid))],
      quotes: members.flatMap((m) => m.quotes.map((text) => ({ rid: m.rid, text }))).slice(0, 12),
    });
  }
  // anything the model left out stays as its own code, so no data is lost
  flat.forEach((k, i) => {
    if (!used.has(i)) book.push({ id: `K${book.length + 1}`, label: k.label, definition: k.description, rids: [k.rid], quotes: k.quotes.map((text) => ({ rid: k.rid, text })) });
  });
  return book.sort((x, y) => y.rids.length - x.rids.length).map((k, i) => ({ ...k, id: `K${i + 1}` }));
}

async function buildThemes(C: string, state: AnalysisState): Promise<Theme[]> {
  const book = state.codebook ?? [];
  if (!book.length) throw new QualError("Build the codebook first.");
  const listing = book.map((k) => `${k.id} (${k.rids.length} participants) ${k.label}: ${k.definition}${k.quotes[0] ? ` e.g. "${k.quotes[0].text}"` : ""}`).join("\n");
  const r = await claudeJson<{ themes: { name: string; definition: string; codes: string[]; subthemes?: { name: string; codes: string[] }[] }[] }>(
    ROLE,
    `${C}\n\nPhase 4, generating themes. Group the codes below into 3 to 7 themes. A theme is a pattern of shared meaning organised around a central concept that answers the research question, not just a topic summary. Name each theme so it says something (e.g. "Rain you can no longer trust", not "Rainfall"). Give each a two to three sentence "definition" stating its central organising concept, its "codes" (ids), and optionally "subthemes" (name + code ids). Codes that don't fit any theme can be left out.\n\nCODES:\n${listing.slice(0, 80_000)}\n\nJSON: {"themes": [{"name": "...", "definition": "...", "codes": ["K1"], "subthemes": [{"name": "...", "codes": ["K1"]}]}]}`,
    5000,
  );
  const ids = new Set(book.map((k) => k.id));
  return (r.themes ?? [])
    .map((t, i) => ({
      id: `T${i + 1}`,
      name: String(t.name).slice(0, 120),
      definition: String(t.definition ?? "").slice(0, 800),
      codes: [...new Set((t.codes ?? []).map(String).filter((c) => ids.has(c)))],
      subthemes: (t.subthemes ?? []).map((s) => ({ name: String(s.name).slice(0, 120), codes: (s.codes ?? []).map(String).filter((c) => ids.has(c)) })).filter((s) => s.codes.length),
    }))
    .filter((t) => t.codes.length);
}

async function matrixRow(C: string, c: Case, state: AnalysisState): Promise<Record<string, string>> {
  const themes = state.themes ?? [];
  if (!themes.length) throw new QualError("Generate themes first.");
  const r = await claudeJson<Record<string, string>>(
    ROLE,
    `${C}\n\nFramework matrix. For each theme below, summarise in at most 30 words what this participant says that relates to it, in your own words (no quotes). If they say nothing relevant, use "".\n\nTHEMES:\n${themes.map((t) => `${t.id} ${t.name}: ${t.definition}`).join("\n")}\n\nParticipant ${c.pid}:\n${c.text.slice(0, 40_000)}\n\nJSON: {${themes.map((t) => `"${t.id}": "..."`).join(", ")}}`,
    1500,
  );
  return Object.fromEntries(themes.map((t) => [t.id, String(r[t.id] ?? "").slice(0, 300)]));
}

async function writeReport(rq: string, bg: string, state: AnalysisState, list: Case[]): Promise<string> {
  const themes = state.themes ?? [];
  if (!themes.length) throw new QualError("Generate themes first.");
  const pids = Object.fromEntries(list.map((c) => [c.rid, c.pid]));
  const book = Object.fromEntries((state.codebook ?? []).map((k) => [k.id, k]));
  const info = themes.map((t) => {
    const codes = t.codes.map((id) => book[id]).filter(Boolean);
    const people = new Set(codes.flatMap((k) => k.rids));
    const quotes = codes.flatMap((k) => k.quotes.slice(0, 3).map((q) => `- ${pids[q.rid]}: "${q.text}"`)).slice(0, 14);
    return { t, summary: `${t.name} (${people.size} of ${list.length} participants): ${t.definition}`, detail: `${t.name} (${people.size} of ${list.length} participants)\nDefinition: ${t.definition}\n${t.subthemes.length ? `Subthemes: ${t.subthemes.map((s) => s.name).join("; ")}\n` : ""}Codes: ${codes.map((k) => k.label).join("; ")}\nQuotes you may use (verbatim):\n${quotes.join("\n")}` };
  });
  const system = `${ROLE}\nYou write the findings of a qualitative study for a thesis or journal article, in Markdown. Use plain academic English (British spelling). Use only quotes you are given, copied exactly, in double quotation marks, attributed like (P03). Never invent numbers, participants or quotes; say "most", "several" or "a few" rather than percentages.`;
  const study = `${ctx(rq, bg)}\nParticipants: ${list.length} (labelled P01, P02...). Data: open-ended voice and typed answers to an online survey, transcribed. Analysis: reflexive thematic analysis following Braun and Clarke (2006, 2021), with AI-assisted initial coding reviewed and refined by the researcher.`;
  const overview = info.map((x) => `- ${x.summary}`).join("\n");
  // written in parts (in parallel) so no single reply is long enough to be cut off
  const [intro, sections, closing] = await Promise.all([
    claude(system, `${study}\n\nTHEMES:\n${overview}\n\nWrite "## Method" (one paragraph of about 120 words) and then "## Findings" with a short overview paragraph (about 100 words) naming the ${themes.length} themes. Nothing else.`, 1500),
    Promise.all(info.map((x) => claude(system, `${study}\n\nWrite the findings section for ONE theme, starting with the heading "### ${x.t.name}". About 300 to 400 words: explain its central idea, how it varies across participants, and illustrate with 2 to 4 of the quotes below.\n\n${x.detail.slice(0, 20_000)}`, 2000))),
    claude(system, `${study}\n\nTHEMES:\n${overview}\n\nWrite "## Discussion" (about 300 words: how the themes together answer the research question) and "## Limitations" (one paragraph, including the role of AI assistance and the need for researcher review). Nothing else.`, 2000),
  ]);
  const heading = (t: string, h: string) => (t.trimStart().startsWith("#") ? t.trim() : `${h}\n\n${t.trim()}`);
  return [intro.trim(), ...sections.map((t, i) => heading(t, `### ${themes[i].name}`)), closing.trim()].join("\n\n").slice(0, 80_000);
}

// ───────── researcher edits ─────────

export async function editAnalysis(
  db: DB,
  ownerId: string,
  studyId: string,
  edit:
    | { kind: "code"; id: string; label?: string; definition?: string; remove?: boolean }
    | { kind: "theme"; id: string; name?: string; definition?: string; remove?: boolean; codes?: string[] }
    | { kind: "report"; text: string }
    | { kind: "reset"; phase: Phase },
) {
  if (!(await getStudy(db, ownerId, studyId))) throw new QualError("Study not found.");
  const a = await getAnalysis(db, studyId);
  let s = a.state;
  if (edit.kind === "reset") s = resetFrom(s, edit.phase);
  if (edit.kind === "code" && s.codebook) {
    s = {
      ...s,
      codebook: edit.remove ? s.codebook.filter((k) => k.id !== edit.id) : s.codebook.map((k) => (k.id === edit.id ? { ...k, label: edit.label?.trim().slice(0, 80) || k.label, definition: edit.definition?.trim().slice(0, 500) ?? k.definition } : k)),
      themes: edit.remove ? s.themes?.map((t) => ({ ...t, codes: t.codes.filter((c) => c !== edit.id), subthemes: t.subthemes.map((x) => ({ ...x, codes: x.codes.filter((c) => c !== edit.id) })) })) : s.themes,
    };
  }
  if (edit.kind === "theme" && s.themes) {
    s = {
      ...s,
      themes: edit.remove
        ? s.themes.filter((t) => t.id !== edit.id)
        : s.themes.map((t) => (t.id === edit.id ? { ...t, name: edit.name?.trim().slice(0, 120) || t.name, definition: edit.definition?.trim().slice(0, 800) ?? t.definition, codes: edit.codes ?? t.codes } : t)),
    };
    if (edit.remove && s.matrix) s = { ...s, matrix: Object.fromEntries(Object.entries(s.matrix).map(([rid, row]) => [rid, Object.fromEntries(Object.entries(row).filter(([tid]) => tid !== edit.id))])) };
  }
  if (edit.kind === "report") s = { ...s, report: edit.text.slice(0, 80_000) };
  await saveState(db, studyId, s);
}

// ───────── word frequencies (for the word cloud) ─────────

const STOP = new Set(
  ("a about above after again against all also am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's like me more most mustn't my myself no nor not now of off on once only or other ought our ours ourselves out over own really same say said says she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've thing things this those through to too under until up us very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't yeah yes you you'd you'll you're you've your yours yourself yourselves um uh oh okay ok know think also even one two much many well still go going gone come came make made take took way lot lots maybe kind sort actually basically something someone anything everything every back time times year years day days use used want wanted need needed tell told see saw look"
  ).split(" "),
);

/** The most frequent meaningful words across participants' answers (question text and stop words left out). */
export function wordFrequencies(list: Case[], limit = 90): { word: string; count: number; people: number }[] {
  const count = new Map<string, number>();
  const people = new Map<string, Set<string>>();
  for (const c of list) {
    const answers = c.text.split("\n").filter((l) => !/^Q\d+\.\s/.test(l)).join(" ");
    for (const raw of answers.toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}][\p{L}'-]*/gu) ?? []) {
      const w = raw.replace(/^'+|'+$/g, "").replace(/'s$/, "");
      if (w.length < 3 || STOP.has(w)) continue;
      count.set(w, (count.get(w) ?? 0) + 1);
      if (!people.has(w)) people.set(w, new Set());
      people.get(w)!.add(c.rid);
    }
  }
  return [...count.entries()]
    .map(([word, n]) => ({ word, count: n, people: people.get(word)!.size }))
    .filter((x) => x.count > 1 || list.length < 3)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}
