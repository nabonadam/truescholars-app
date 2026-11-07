/**
 * Literature Review analysis, in three stages the researcher steers:
 *   1. Systematic reading: one structured card per paper (introduction, methods, findings, conclusions,
 *      key terms, keywords, quality), every point tied to a quote that is checked against the PDF's text
 *      and located on its page.
 *   2. Synthesis across papers, organised by ideas, not authors: a concept matrix, themes with each
 *      paper's stance, agreements, contradictions (and why), gaps, and a glossary of how authors define terms.
 *   3. Critical writing: an outline the researcher approves, then idea-led paragraphs where every sentence
 *      lists its sources and the evidence it rests on; evidence that isn't in the papers is flagged.
 * Only text from the papers goes to the AI.
 */

import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { litPapers } from "@/db/schema";
import { type PaperMeta, pno, shortAuthors } from "@/lib/cite";
import { LitError, type Paper, getAnalysisState, listPapers, mustOwn, paperPages, saveAnalysisState } from "./lit";
import { claudeJson, findQuote } from "./qualAnalysis";
import { countUnit } from "./usage";

// ───────── types ─────────

export type Point = { text: string; quote?: string; page?: number; verified?: boolean };
export type Card = {
  basis: "full" | "abstract";
  summary: { introduction: string; methods: string; findings: string; conclusions: string };
  aim: Point;
  theory: Point;
  context: Point & { country?: string; setting?: string; population?: string };
  design: Point & { type: string };
  sample: Point;
  findings: Point[];
  conclusions: Point;
  limitations: Point[];
  keyTerms: (Point & { term: string })[];
  keywords: string[];
  quality: { rating: "strong" | "moderate" | "weak" | "unclear"; notes: string };
  bibliographic?: { title?: string; authors: { family: string; given?: string }[]; year?: number; journal?: string };
};

export type Theme = { id: string; name: string; claim: string; description: string; papers: { p: string; stance: "supports" | "contradicts" | "extends" | "nuances"; point: string }[] };
export type Synthesis = {
  concepts: { id: string; name: string; description: string }[];
  matrix: Record<string, Record<string, string>>; // P01 → concept id → what this paper says about it
  themes: Theme[];
  agreements: { statement: string; papers: string[] }[];
  contradictions: { statement: string; sides: { papers: string[]; position: string }[]; explanation: string }[];
  gaps: { gap: string; why: string; papers: string[] }[];
  glossary: { term: string; definitions: { p: string; definition: string }[] }[];
};
export type Section = { id: string; heading: string; purpose: string; points: string[]; themeIds: string[]; words: number };
export type Sentence = { text: string; sources: string[]; evidence: { p: string; quote: string; page?: number }[]; status: "verified" | "unverified" | "analysis" };
export type Paragraph = { sentences: Sentence[]; edited?: string };
export type WriteState = {
  synthesis?: Synthesis;
  outline?: Section[];
  sections?: Record<string, Paragraph[]>;
  targetWords?: number;
  done?: { synthesis?: string; outline?: string; writing?: string };
};

const ROLE =
  "You are a senior academic who teaches literature reviewing. You read carefully, stay faithful to what each paper actually says, write in clear, concise academic English, and never invent findings, numbers, papers or quotes. You organise ideas by what is said, not by who said it.";

// ───────── 1. systematic reading ─────────

const DESIGNS = ["qualitative", "quantitative", "mixed methods", "systematic review", "review", "theoretical", "case study", "experimental", "other"];

function paperText(pages: string[]): string {
  const marked = pages.map((t, i) => `[[page ${i + 1}]]\n${t}`).join("\n\n");
  if (marked.length <= 150_000) return marked;
  return `${marked.slice(0, 115_000)}\n\n[… middle of the paper omitted for length …]\n\n${marked.slice(-35_000)}`;
}

/** Puts a quote on its page, word for word, or marks it unverified. */
export function locate(quote: string | undefined, pages: string[]): { quote?: string; page?: number; verified: boolean } {
  if (!quote || quote.trim().split(/\s+/).length < 3) return { verified: false };
  for (let i = 0; i < pages.length; i++) {
    const q = findQuote(quote, pages[i]);
    if (q) return { quote: q, page: i + 1, verified: true };
  }
  for (let i = 0; i < pages.length - 1; i++) {
    const q = findQuote(quote, `${pages[i]} ${pages[i + 1]}`); // a quote running over a page break
    if (q) return { quote: q, page: i + 1, verified: true };
  }
  return { quote: undefined, verified: false };
}

type RawPoint = { text?: string; quote?: string };

function point(raw: RawPoint | undefined, pages: string[]): Point {
  const text = String(raw?.text ?? "").trim().slice(0, 900);
  return { text, ...locate(raw?.quote, pages) };
}

export async function readPaper(p: Paper, pages: string[]): Promise<Card> {
  const meta = p.meta as PaperMeta;
  const hasText = pages.join(" ").trim().length > 600;
  const basis: Card["basis"] = hasText ? "full" : "abstract";
  const source = hasText ? paperText(pages) : `TITLE: ${meta.title ?? ""}\nABSTRACT: ${meta.abstract ?? "(no abstract available)"}`;
  if (!hasText && !meta.abstract) throw new LitError("No readable text in this PDF (it may be a scanned image). Upload a text PDF to read it.");
  type Raw = {
    summary?: Partial<Card["summary"]>;
    aim?: RawPoint;
    theory?: RawPoint;
    context?: RawPoint & { country?: string; setting?: string; population?: string };
    design?: RawPoint & { type?: string };
    sample?: RawPoint;
    findings?: RawPoint[];
    conclusions?: RawPoint;
    limitations?: RawPoint[];
    keyTerms?: (RawPoint & { term?: string })[];
    keywords?: string[];
    quality?: { rating?: string; notes?: string };
    bibliographic?: { title?: string; authors?: { family?: string; given?: string }[]; year?: number | string; journal?: string };
  };
  const r = await claudeJson<Raw>(
    ROLE,
    `Read this ${hasText ? "paper" : "abstract"} systematically and fill in a reading card.\n` +
      `For every field with "quote", copy 8 to 40 words EXACTLY, word for word, from the text that supports it (never paraphrase inside a quote, never join separate sentences). If nothing in the text supports a field, use "Not reported" and no quote.\n\n` +
      `Fields:\n- summary: four short paragraphs (2 to 4 sentences each) summarising the paper's introduction (problem and aim), methods, findings and conclusions.\n` +
      `- aim: the aim or research question.\n- theory: the theory, framework or key concepts it uses.\n- context: country, setting and population (also as separate short fields).\n` +
      `- design: type (one of: ${DESIGNS.join(", ")}) and a one-sentence description of the method.\n- sample: who or what was studied, and how many.\n` +
      `- findings: 3 to 7 key findings, each one sentence.\n- conclusions: the main conclusion and implications.\n- limitations: 1 to 4, as stated by the authors or evident from the design.\n` +
      `- keyTerms: 2 to 6 key concepts with how THIS paper defines or uses them (text = the definition).\n- keywords: 4 to 8 keywords.\n` +
      `- quality: rating (strong, moderate, weak or unclear) for how well the design supports the conclusions, with a one-sentence reason.\n` +
      `- bibliographic: the paper's title, authors (family and given names, in order), year and journal or publisher, exactly as printed on the paper.\n\n` +
      `TEXT (page numbers in [[page n]] markers):\n${source}\n\n` +
      `JSON: {"summary": {"introduction": "", "methods": "", "findings": "", "conclusions": ""}, "aim": {"text": "", "quote": ""}, "theory": {"text": "", "quote": ""}, "context": {"text": "", "quote": "", "country": "", "setting": "", "population": ""}, "design": {"type": "", "text": "", "quote": ""}, "sample": {"text": "", "quote": ""}, "findings": [{"text": "", "quote": ""}], "conclusions": {"text": "", "quote": ""}, "limitations": [{"text": "", "quote": ""}], "keyTerms": [{"term": "", "text": "", "quote": ""}], "keywords": [""], "quality": {"rating": "", "notes": ""}, "bibliographic": {"title": "", "authors": [{"family": "", "given": ""}], "year": 2020, "journal": ""}}`,
    6000,
  );
  const quotePages = hasText ? pages : [meta.abstract ?? ""];
  const s = (v: unknown, n = 1500) => String(v ?? "").trim().slice(0, n);
  const rating = ["strong", "moderate", "weak", "unclear"].includes(String(r.quality?.rating)) ? (r.quality!.rating as Card["quality"]["rating"]) : "unclear";
  return {
    basis,
    summary: { introduction: s(r.summary?.introduction), methods: s(r.summary?.methods), findings: s(r.summary?.findings), conclusions: s(r.summary?.conclusions) },
    aim: point(r.aim, quotePages),
    theory: point(r.theory, quotePages),
    context: { ...point(r.context, quotePages), country: s(r.context?.country, 80) || undefined, setting: s(r.context?.setting, 160) || undefined, population: s(r.context?.population, 160) || undefined },
    design: { ...point(r.design, quotePages), type: DESIGNS.includes(String(r.design?.type).toLowerCase()) ? String(r.design?.type).toLowerCase() : "other" },
    sample: point(r.sample, quotePages),
    findings: (r.findings ?? []).slice(0, 8).map((f) => point(f, quotePages)).filter((f) => f.text),
    conclusions: point(r.conclusions, quotePages),
    limitations: (r.limitations ?? []).slice(0, 5).map((f) => point(f, quotePages)).filter((f) => f.text),
    keyTerms: (r.keyTerms ?? []).slice(0, 8).map((k) => ({ term: s(k.term, 80), ...point(k, quotePages) })).filter((k) => k.term),
    keywords: (r.keywords ?? []).map((k) => s(k, 60)).filter(Boolean).slice(0, 10),
    quality: { rating, notes: s(r.quality?.notes, 400) },
    bibliographic: {
      title: s(r.bibliographic?.title, 400) || undefined,
      authors: (r.bibliographic?.authors ?? []).map((a) => ({ family: s(a.family, 80), given: s(a.given, 80) || undefined })).filter((a) => a.family).slice(0, 40),
      year: Number(r.bibliographic?.year) > 1500 && Number(r.bibliographic?.year) < 2100 ? Number(r.bibliographic?.year) : undefined,
      journal: s(r.bibliographic?.journal, 300) || undefined,
    },
  };
}

export type StepResult = { done: number; total: number; finished: boolean; failed?: number };

/** Reads the next few unread accepted papers. Call repeatedly until `finished`. */
export async function readPapers(db: DB, ownerId: string, reviewId: string, opts: { batch?: number; paperId?: string } = {}): Promise<StepResult> {
  await mustOwn(db, ownerId, reviewId);
  const papers = await listPapers(db, reviewId, { status: "ACCEPTED" });
  if (!papers.length) throw new LitError("Add or accept some papers first.");
  const todo = opts.paperId ? papers.filter((p) => p.id === opts.paperId) : papers.filter((p) => p.cardStatus === "none").slice(0, opts.batch ?? 2);
  await Promise.all(
    todo.map(async (p) => {
      try {
        const card = await readPaper(p, await paperPages(db, p.id));
        // papers Crossref doesn't know (theses, reports, local journals) get their details from the paper itself
        const m = p.meta as PaperMeta;
        const b = card.bibliographic;
        const meta = !m.authors?.length && b?.authors.length ? { ...m, authors: b.authors, year: m.year ?? b.year ?? null, journal: m.journal ?? b.journal, title: m.title || b.title } : m;
        await db.update(litPapers).set({ card, meta, cardStatus: "done", cardError: null }).where(eq(litPapers.id, p.id));
        countUnit("lit.read");
      } catch (err) {
        const msg = err instanceof LitError || (err instanceof Error && /busy|unreadable/i.test(err.message)) ? err.message : "This paper couldn't be read.";
        await db.update(litPapers).set({ cardStatus: "failed", cardError: msg }).where(eq(litPapers.id, p.id));
      }
    }),
  );
  const after = await listPapers(db, reviewId, { status: "ACCEPTED" });
  const read = after.filter((p) => p.cardStatus !== "none").length;
  return { done: read, total: after.length, finished: read >= after.length || !!opts.paperId, failed: after.filter((p) => p.cardStatus === "failed").length };
}

/** Lets a failed or outdated card be read again. */
export async function resetCard(db: DB, ownerId: string, reviewId: string, paperId: string) {
  await mustOwn(db, ownerId, reviewId);
  await db.update(litPapers).set({ card: null, cardStatus: "none", cardError: null }).where(eq(litPapers.id, paperId));
}

// ───────── 2. synthesis ─────────

const cite = (p: Paper) => `${shortAuthors(p.meta as PaperMeta)} (${(p.meta as PaperMeta).year ?? "n.d."})`;

function compactCard(p: Paper): string {
  const c = p.card as Card;
  const pts = (xs: Point[]) => xs.map((x) => `- ${x.text}`).join("\n");
  return [
    `${pno(p.n)} | ${cite(p)} | ${(p.meta as PaperMeta).title ?? ""}`,
    `Design: ${c.design.type}; ${c.design.text} Sample: ${c.sample.text}`,
    `Context: ${c.context.text}`,
    `Aim: ${c.aim.text}`,
    `Theory: ${c.theory.text}`,
    `Findings:\n${pts(c.findings)}`,
    `Conclusions: ${c.conclusions.text}`,
    `Limitations:\n${pts(c.limitations)}`,
    `Key terms: ${c.keyTerms.map((k) => `${k.term}: ${k.text}`).join(" | ")}`,
    `Quality: ${c.quality.rating}`,
  ].join("\n");
}

async function context(db: DB, ownerId: string, reviewId: string) {
  const r = await mustOwn(db, ownerId, reviewId);
  const papers = (await listPapers(db, reviewId, { status: "ACCEPTED" })).filter((p) => p.cardStatus === "done" && p.card);
  if (papers.length < 2) throw new LitError("Read at least two papers before synthesising.");
  const brief = r.brief as Record<string, unknown>;
  const ctx = `Research question: ${r.researchQuestion}${brief.discipline ? `\nDiscipline: ${brief.discipline}` : ""}${brief.purpose ? `\nPurpose: ${brief.purpose}` : ""}`;
  return { r, papers, ctx };
}

export async function synthesise(db: DB, ownerId: string, reviewId: string): Promise<Synthesis> {
  const { papers, ctx } = await context(db, ownerId, reviewId);
  const ids = new Set(papers.map((p) => pno(p.n)));
  const raw = await claudeJson<Partial<Synthesis>>(
    ROLE,
    `${ctx}\n\nBelow are reading cards for ${papers.length} papers. Synthesise them around the research question, focusing on IDEAS and EVIDENCE, not on authors.\n\n` +
      `Give:\n- concepts: 4 to 9 key concepts or dimensions that organise this literature (id C1, C2…, name, one-sentence description).\n` +
      `- matrix: for each paper id, for each concept id, a short note (max 20 words) of what the paper says about it, or "" if nothing.\n` +
      `- themes: 3 to 7 themes. Each has a name, a claim (one sentence stating what the literature, taken together, suggests), a description (2 to 3 sentences), and papers: each relevant paper with its stance (supports, contradicts, extends or nuances) and the point it makes (one sentence).\n` +
      `- agreements: where several papers converge (statement + paper ids).\n- contradictions: where papers disagree, with each side's papers and position, and an explanation of WHY they may differ (context, method, population, time, measures).\n` +
      `- gaps: what the literature has not studied or not settled (by place, population, method, time or concept), why it matters for the research question, and the papers that show the gap.\n` +
      `- glossary: key terms defined differently across papers, with each paper's definition.\n` +
      `Use only these paper ids: ${[...ids].join(", ")}. Do not invent papers or findings.\n\nREADING CARDS:\n${papers.map(compactCard).join("\n\n").slice(0, 300_000)}\n\n` +
      `JSON: {"concepts": [{"id": "C1", "name": "", "description": ""}], "matrix": {"P01": {"C1": ""}}, "themes": [{"name": "", "claim": "", "description": "", "papers": [{"p": "P01", "stance": "supports", "point": ""}]}], "agreements": [{"statement": "", "papers": ["P01"]}], "contradictions": [{"statement": "", "sides": [{"papers": ["P01"], "position": ""}], "explanation": ""}], "gaps": [{"gap": "", "why": "", "papers": ["P01"]}], "glossary": [{"term": "", "definitions": [{"p": "P01", "definition": ""}]}]}`,
    16000,
  );
  const only = (xs: unknown) => (Array.isArray(xs) ? xs.map(String).filter((x) => ids.has(x)) : []);
  const s = (v: unknown, n = 800) => String(v ?? "").trim().slice(0, n);
  const concepts = (raw.concepts ?? []).map((c, i) => ({ id: s(c.id, 6) || `C${i + 1}`, name: s(c.name, 100), description: s(c.description, 400) })).filter((c) => c.name);
  const cids = new Set(concepts.map((c) => c.id));
  const matrix: Synthesis["matrix"] = {};
  for (const [p, row] of Object.entries(raw.matrix ?? {})) if (ids.has(p)) matrix[p] = Object.fromEntries(Object.entries(row ?? {}).filter(([c]) => cids.has(c)).map(([c, v]) => [c, s(v, 240)]));
  const stances = ["supports", "contradicts", "extends", "nuances"];
  return {
    concepts,
    matrix,
    themes: (raw.themes ?? [])
      .map((t, i) => ({
        id: `T${i + 1}`,
        name: s(t.name, 140),
        claim: s(t.claim, 400),
        description: s(t.description, 900),
        papers: (t.papers ?? []).filter((x) => ids.has(String(x.p))).map((x) => ({ p: String(x.p), stance: (stances.includes(x.stance) ? x.stance : "supports") as Theme["papers"][number]["stance"], point: s(x.point, 400) })),
      }))
      .filter((t) => t.name && t.papers.length),
    agreements: (raw.agreements ?? []).map((a) => ({ statement: s(a.statement, 500), papers: only(a.papers) })).filter((a) => a.statement && a.papers.length),
    contradictions: (raw.contradictions ?? [])
      .map((c) => ({ statement: s(c.statement, 500), sides: (c.sides ?? []).map((x) => ({ papers: only(x.papers), position: s(x.position, 400) })).filter((x) => x.papers.length), explanation: s(c.explanation, 700) }))
      .filter((c) => c.statement && c.sides.length >= 2),
    gaps: (raw.gaps ?? []).map((g) => ({ gap: s(g.gap, 500), why: s(g.why, 600), papers: only(g.papers) })).filter((g) => g.gap),
    glossary: (raw.glossary ?? []).map((g) => ({ term: s(g.term, 100), definitions: (g.definitions ?? []).filter((d) => ids.has(String(d.p))).map((d) => ({ p: String(d.p), definition: s(d.definition, 400) })) })).filter((g) => g.term && g.definitions.length),
  };
}

export async function runSynthesis(db: DB, ownerId: string, reviewId: string) {
  const synthesis = await synthesise(db, ownerId, reviewId);
  const state = await getAnalysisState<WriteState>(db, reviewId);
  // a new synthesis invalidates the outline and the writing built on the old one
  await saveAnalysisState(db, reviewId, { targetWords: state.targetWords, synthesis, done: { synthesis: new Date().toISOString() } } satisfies WriteState);
  return synthesis;
}

// ───────── 3. critical writing ─────────

export async function makeOutline(db: DB, ownerId: string, reviewId: string, targetWords = 3500): Promise<Section[]> {
  const { ctx } = await context(db, ownerId, reviewId);
  const state = await getAnalysisState<WriteState>(db, reviewId);
  const syn = state.synthesis;
  if (!syn) throw new LitError("Run the synthesis first.");
  const words = Math.max(1200, Math.min(15000, Math.round(targetWords)));
  const raw = await claudeJson<{ sections: { heading: string; purpose: string; points: string[]; themes: string[]; words: number }[] }>(
    ROLE,
    `${ctx}\n\nPlan a CRITICAL literature review of about ${words} words, organised by ideas (themes), not by author or paper. Ten pages of real synthesis beat fifty pages of summaries.\n` +
      `Sections: a short introduction (scope and how the review is organised), one section per major theme or closely related group of themes (each building an argument: what is established, where evidence conflicts and why, what remains unclear), a section on gaps that leads to the research question, and a brief conclusion. 4 to 8 sections in total.\n` +
      `For each: heading, purpose (one sentence: the argument this section makes), points (3 to 5 bullet points to cover, in order), themes (theme ids it draws on), words (its share of the length; the shares must add up to ${words}).\n\n` +
      `THEMES:\n${syn.themes.map((t) => `${t.id} ${t.name}: ${t.claim}`).join("\n")}\n\nCONTRADICTIONS:\n${syn.contradictions.map((c) => `- ${c.statement}`).join("\n") || "-"}\n\nGAPS:\n${syn.gaps.map((g) => `- ${g.gap}`).join("\n") || "-"}\n\n` +
      `JSON: {"sections": [{"heading": "", "purpose": "", "points": [""], "themes": ["T1"], "words": 500}]}`,
    4000,
  );
  const tids = new Set(syn.themes.map((t) => t.id));
  const outline = (raw.sections ?? [])
    .map((x, i) => ({ id: `S${i + 1}`, heading: String(x.heading ?? "").slice(0, 160), purpose: String(x.purpose ?? "").slice(0, 500), points: (x.points ?? []).map((p) => String(p).slice(0, 300)).slice(0, 8), themeIds: (x.themes ?? []).map(String).filter((t) => tids.has(t)), words: Math.max(100, Math.min(4000, Number(x.words) || Math.round(words / 6))) }))
    .filter((x) => x.heading);
  await saveAnalysisState(db, reviewId, { ...state, targetWords: words, outline, sections: {}, done: { ...state.done, outline: new Date().toISOString(), writing: undefined } } satisfies WriteState);
  return outline;
}

export async function saveOutline(db: DB, ownerId: string, reviewId: string, outline: Section[]) {
  await mustOwn(db, ownerId, reviewId);
  const state = await getAnalysisState<WriteState>(db, reviewId);
  const clean = outline
    .slice(0, 15)
    .map((x, i) => ({ id: String(x.id || `S${i + 1}`).slice(0, 10), heading: String(x.heading ?? "").trim().slice(0, 160), purpose: String(x.purpose ?? "").trim().slice(0, 500), points: (x.points ?? []).map((p) => String(p).trim().slice(0, 300)).filter(Boolean).slice(0, 10), themeIds: (x.themeIds ?? []).map(String).slice(0, 10), words: Math.max(100, Math.min(4000, Number(x.words) || 400)) }))
    .filter((x) => x.heading);
  if (!clean.length) throw new LitError("Keep at least one section.");
  const ids = new Set(clean.map((x) => x.id));
  const sections = Object.fromEntries(Object.entries(state.sections ?? {}).filter(([k]) => ids.has(k)));
  await saveAnalysisState(db, reviewId, { ...state, outline: clean, sections });
}

/** Evidence the writer may cite for a section: verified quotes from the papers in its themes (all papers for intro/gaps). */
function evidencePool(papers: Paper[], keep: Set<string> | null) {
  const out: { id: string; p: string; text: string; quote: string; page?: number }[] = [];
  for (const p of papers) {
    const id = pno(p.n);
    if (keep && !keep.has(id)) continue;
    const c = p.card as Card;
    const pts: [string, Point][] = [["A", c.aim], ["D", c.design], ["S", c.sample], ...c.findings.map((f, i) => [`F${i + 1}`, f] as [string, Point]), ["C", c.conclusions], ...c.limitations.map((f, i) => [`L${i + 1}`, f] as [string, Point]), ...c.keyTerms.map((k, i) => [`K${i + 1}`, k] as [string, Point])];
    for (const [k, pt] of pts) if (pt.verified && pt.quote) out.push({ id: `${id}-${k}`, p: id, text: pt.text, quote: pt.quote, page: pt.page });
  }
  return out;
}

export async function writeSection(db: DB, ownerId: string, reviewId: string, sectionId: string): Promise<Paragraph[]> {
  const { papers, ctx } = await context(db, ownerId, reviewId);
  const state = await getAnalysisState<WriteState>(db, reviewId);
  const sec = state.outline?.find((x) => x.id === sectionId);
  if (!sec || !state.synthesis) throw new LitError("Make the outline first.");
  const themes = state.synthesis.themes.filter((t) => sec.themeIds.includes(t.id));
  const keep = themes.length ? new Set(themes.flatMap((t) => t.papers.map((x) => x.p))) : null;
  const pool = evidencePool(papers, keep);
  const byId = Object.fromEntries(pool.map((e) => [e.id, e]));
  const ids = new Set(papers.map((p) => pno(p.n)));
  const others = state.outline!.filter((x) => x.id !== sec.id).map((x) => `- ${x.heading}`).join("\n");
  const relevant = themes.length ? themes : state.synthesis.themes;
  const raw = await claudeJson<{ paragraphs: { sentences: { text: string; sources?: string[]; evidence?: string[] }[] }[] }>(
    ROLE,
    `${ctx}\n\nWrite ONE section of a critical literature review: "${sec.heading}". Strict length: no more than ${sec.words} words in total.\nIts argument: ${sec.purpose}\nCover, in order:\n${sec.points.map((p) => `- ${p}`).join("\n")}\n(Other sections cover: \n${others}\nso don't repeat them.)\n\n` +
      `HOW TO WRITE IT (critical, idea-led):\n- Each paragraph opens with a topic sentence that makes a claim about the literature, then compares and evaluates evidence across papers, and ends by saying what it means for the research question.\n` +
      `- Never start a sentence with an author or paper ("Smith (2019) found…", "P03 shows…"). Never name authors in the text at all: list them in "sources" and the citation is added automatically.\n` +
      `- Synthesise: group papers that agree, contrast those that don't and explain why (context, method, sample), and judge the strength of the evidence.\n- Be concise. No summaries of single papers. No padding, no headings inside the section.\n\n` +
      `EVIDENCE: every sentence that states what the literature says must list its "sources" (paper ids) and "evidence" (ids from the evidence list below that support it). Sentences that are your own analytical linking or evaluation have no sources. Use only this evidence.\n\n` +
      `THEMES:\n${relevant.map((t) => `${t.id} ${t.name}: ${t.claim}\n${t.papers.map((x) => `  ${x.p} (${x.stance}): ${x.point}`).join("\n")}`).join("\n")}\n` +
      `${state.synthesis.contradictions.length ? `\nCONTRADICTIONS:\n${state.synthesis.contradictions.map((c) => `- ${c.statement} ${c.explanation}`).join("\n")}\n` : ""}` +
      `${/gap|future|research question|conclu/i.test(sec.heading + sec.purpose) ? `\nGAPS:\n${state.synthesis.gaps.map((g) => `- ${g.gap}: ${g.why}`).join("\n")}\n` : ""}` +
      `\nEVIDENCE LIST:\n${pool.map((e) => `${e.id}: ${e.text} | "${e.quote}"`).join("\n").slice(0, 120_000)}\n\n` +
      `JSON: {"paragraphs": [{"sentences": [{"text": "", "sources": ["P01"], "evidence": ["P01-F1"]}]}]}`,
    Math.min(12000, 2000 + sec.words * 4),
  );
  const paragraphs: Paragraph[] = (raw.paragraphs ?? []).map((pa) => ({
    sentences: (pa.sentences ?? [])
      .map((s) => {
        const text = String(s.text ?? "").trim().slice(0, 1500);
        const sources = [...new Set((s.sources ?? []).map(String).filter((x) => ids.has(x)))];
        const evidence = (s.evidence ?? []).map((e) => byId[String(e)]).filter((e) => e && sources.includes(e.p)).map((e) => ({ p: e.p, quote: e.quote, page: e.page }));
        const status: Sentence["status"] = !sources.length ? "analysis" : evidence.length ? "verified" : "unverified";
        return { text, sources, evidence, status };
      })
      .filter((s) => s.text),
  })).filter((pa) => pa.sentences.length);
  if (!paragraphs.length) throw new LitError("The writer returned nothing usable for this section. Try again.");
  const fresh = await getAnalysisState<WriteState>(db, reviewId);
  const sections = { ...(fresh.sections ?? {}), [sec.id]: paragraphs };
  const allDone = (fresh.outline ?? []).every((x) => sections[x.id]?.length);
  await saveAnalysisState(db, reviewId, { ...fresh, sections, done: { ...fresh.done, writing: allDone ? new Date().toISOString() : fresh.done?.writing } });
  return paragraphs;
}

/** The researcher rewrites a paragraph in their own words (its sources stay attached). */
export async function editParagraph(db: DB, ownerId: string, reviewId: string, sectionId: string, index: number, text: string | null) {
  await mustOwn(db, ownerId, reviewId);
  const state = await getAnalysisState<WriteState>(db, reviewId);
  const paras = state.sections?.[sectionId];
  if (!paras?.[index]) throw new LitError("Paragraph not found.");
  const next = paras.map((p, i) => (i === index ? { ...p, edited: text?.trim() ? text.trim().slice(0, 8000) : undefined } : p));
  await saveAnalysisState(db, reviewId, { ...state, sections: { ...state.sections, [sectionId]: next } });
}

export async function editSynthesis(db: DB, ownerId: string, reviewId: string, edit: { kind: "theme"; id: string; name?: string; claim?: string; remove?: boolean } | { kind: "gap"; index: number; remove: true } | { kind: "targetWords"; words: number }) {
  await mustOwn(db, ownerId, reviewId);
  const state = await getAnalysisState<WriteState>(db, reviewId);
  if (edit.kind === "targetWords") return saveAnalysisState(db, reviewId, { ...state, targetWords: Math.max(1200, Math.min(15000, Math.round(edit.words))) });
  if (!state.synthesis) throw new LitError("Run the synthesis first.");
  const syn = { ...state.synthesis };
  if (edit.kind === "theme") syn.themes = edit.remove ? syn.themes.filter((t) => t.id !== edit.id) : syn.themes.map((t) => (t.id === edit.id ? { ...t, name: edit.name?.trim().slice(0, 140) || t.name, claim: edit.claim?.trim().slice(0, 400) ?? t.claim } : t));
  if (edit.kind === "gap") syn.gaps = syn.gaps.filter((_, i) => i !== edit.index);
  await saveAnalysisState(db, reviewId, { ...state, synthesis: syn });
}

// ───────── the critical check ─────────

export type Warning = { sectionId: string; paragraph: number; kind: "author-led" | "single-source" | "descriptive" | "unverified" | "no-sources"; message: string };

const EVALUATIVE = /\b(however|whereas|in contrast|although|though|but|yet|unlike|similarly|consistent(ly)? with|contradict|challenge|limited|only|few|little|unclear|suggests?|indicates?|implies|because|therefore|thus|while|despite|nevertheless|notably|rather|stronger|weaker|robust|fragile)\b/i;

/** Plain checks a supervisor would make, run without AI so they are fast and predictable. */
export function criticalCheck(state: WriteState, papers: Paper[]): Warning[] {
  const surnames = new Set(papers.flatMap((p) => ((p.meta as PaperMeta).authors ?? []).map((a) => a.family.toLowerCase())).filter((s) => s.length > 2));
  const out: Warning[] = [];
  for (const sec of state.outline ?? []) {
    (state.sections?.[sec.id] ?? []).forEach((pa, i) => {
      const sentences = pa.edited ? pa.edited.split(/(?<=[.!?])\s+/).map((text) => ({ text, sources: [] as string[], status: "analysis" as const })) : pa.sentences;
      const authorLed = sentences.filter((s) => {
        const first = s.text.trim().split(/\s+/)[0]?.replace(/[^\p{L}-]/gu, "").toLowerCase() ?? "";
        return surnames.has(first) || /^\p{Lu}[\p{L}-]+( et al\.?| and \p{Lu}[\p{L}-]+| & \p{Lu}[\p{L}-]+)? \(\d{4}/u.test(s.text) || /^(P\d{2}|this study|the study|one study|a study by)\b/i.test(s.text);
      });
      if (authorLed.length) out.push({ sectionId: sec.id, paragraph: i, kind: "author-led", message: `${authorLed.length} sentence${authorLed.length > 1 ? "s start" : " starts"} with an author or study. Lead with the idea and cite the authors in brackets.` });
      if (!pa.edited) {
        const cited = new Set(sentences.flatMap((s) => s.sources));
        if (sentences.length >= 3 && cited.size === 1) out.push({ sectionId: sec.id, paragraph: i, kind: "single-source", message: "This paragraph rests on a single paper. Bring in others that agree or disagree." });
        const unverified = sentences.filter((s) => s.status === "unverified").length;
        if (unverified) out.push({ sectionId: sec.id, paragraph: i, kind: "unverified", message: `${unverified} sentence${unverified > 1 ? "s cite" : " cites"} papers without a matching passage. Check them against the papers.` });
        if (!cited.size && sentences.length >= 2) out.push({ sectionId: sec.id, paragraph: i, kind: "no-sources", message: "No sources in this paragraph. Support its claims with the literature." });
      }
      const text = sentences.map((s) => s.text).join(" ");
      if (sentences.length >= 3 && !EVALUATIVE.test(text)) out.push({ sectionId: sec.id, paragraph: i, kind: "descriptive", message: "This paragraph describes without evaluating. Compare the evidence, judge its strength, or say why findings differ." });
    });
  }
  return out;
}
