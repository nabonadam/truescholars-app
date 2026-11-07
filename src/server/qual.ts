/**
 * Qualitative Studio: studies (voice/text surveys), the public respondent link, responses and
 * transcription. Analysis lives in qualAnalysis.ts.
 *
 * Researchers edit a draft; publishing copies it to `published`, which is all respondents ever see,
 * so editing never disturbs people mid-survey. Respondents have no account: starting a response
 * gives their browser a secret that every later save must present.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { col } from "@/db/col";
import { qualResponses, qualStudies, users } from "@/db/schema";
import {
  DEFAULT_INTRO,
  answerable,
  defaultSettings,
  isAnswered,
  questionSchema,
  settingsSchema,
  type Answer,
  type Answers,
  type PublishedStudy,
  type Question,
  type StudySettings,
} from "@/lib/qual";
import { notify } from "./notifications";
import { deleteAudio, deleteAudioPrefix, getAudio, putAudio } from "./qualStorage";

export class QualError extends Error {}

const token = (n = 10) => randomBytes(n).toString("base64url").replace(/[-_]/g, "x").slice(0, n).toLowerCase();
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|x-m4a|m4a)(;.*)?$/i;

// ───────── studies (researcher) ─────────

export type StudyRow = typeof qualStudies.$inferSelect;
export const studyQuestions = (s: StudyRow) => (s.questions as Question[]) ?? [];
export const studySettings = (s: StudyRow): StudySettings => ({ ...defaultSettings(), ...((s.settings as Partial<StudySettings>) ?? {}) });

export async function createStudy(db: DB, ownerId: string, p: { title?: string; questions?: Question[]; intro?: string } = {}) {
  const [s] = await db
    .insert(qualStudies)
    .values({ ownerId, token: token(), title: p.title?.trim() || "Untitled study", intro: p.intro ?? DEFAULT_INTRO, questions: p.questions ?? [], settings: defaultSettings() })
    .returning({ id: qualStudies.id });
  return s.id;
}

export async function listStudies(db: DB, ownerId: string) {
  const submitted = sql<number>`(select count(*)::int from ${qualResponses} r where r.study_id = ${col(qualStudies.id)} and r.status = 'SUBMITTED' and not r.flagged)`;
  return db
    .select({ id: qualStudies.id, title: qualStudies.title, status: qualStudies.status, updatedAt: qualStudies.updatedAt, publishedAt: qualStudies.publishedAt, questions: qualStudies.questions, responses: submitted })
    .from(qualStudies)
    .where(eq(qualStudies.ownerId, ownerId))
    .orderBy(desc(qualStudies.updatedAt));
}

export async function getStudy(db: DB, ownerId: string, id: string) {
  const [s] = await db.select().from(qualStudies).where(and(eq(qualStudies.id, id), eq(qualStudies.ownerId, ownerId)));
  return s ?? null;
}

async function mustStudy(db: DB, ownerId: string, id: string) {
  const s = await getStudy(db, ownerId, id);
  if (!s) throw new QualError("Study not found.");
  return s;
}

export function validateDraft(input: { title: string; intro: string; questions: unknown; settings: unknown }) {
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new QualError("Give the study a title.");
  const intro = input.intro.trim().slice(0, 8000);
  const qs = questionSchema.array().max(150).safeParse(input.questions);
  if (!qs.success) throw new QualError("Some questions could not be saved. Check each one has text and its options are filled in.");
  const ids = new Set<string>();
  for (const q of qs.data) {
    if (ids.has(q.id)) throw new QualError("Two questions share an id. Reload the page and try again.");
    ids.add(q.id);
    q.options = (q.options ?? []).filter((o) => o.trim());
  }
  const settings = settingsSchema.safeParse(input.settings ?? {});
  if (!settings.success) throw new QualError("Some settings are not valid.");
  return { title, intro, questions: qs.data, settings: settings.data };
}

export async function saveDraft(db: DB, ownerId: string, id: string, input: { title: string; intro: string; questions: unknown; settings: unknown }) {
  await mustStudy(db, ownerId, id);
  const d = validateDraft(input);
  // an explanation recording must be one of this study's own files
  for (const q of d.questions) if (q.explain && !q.explain.key.startsWith(explainPrefix(id))) q.explain = null;
  await db.update(qualStudies).set(d).where(eq(qualStudies.id, id));
}

/** Copies the draft to what respondents see, and opens the link. */
export async function publishStudy(db: DB, ownerId: string, id: string) {
  const s = await mustStudy(db, ownerId, id);
  const d = validateDraft({ title: s.title, intro: s.intro, questions: s.questions, settings: s.settings });
  const qs = answerable(d.questions);
  if (!qs.length) throw new QualError("Add at least one question before publishing.");
  const blank = d.questions.find((q) => !q.text.trim());
  if (blank) throw new QualError("Every question and section needs some text before you publish.");
  const noOptions = qs.find((q) => (q.type === "choice" || q.type === "multi" || q.type === "dropdown") && q.options.length < 2);
  if (noOptions) throw new QualError(`“${noOptions.text.slice(0, 60)}” needs at least two options.`);
  const published: PublishedStudy = { title: d.title, intro: d.intro, questions: d.questions, settings: d.settings };
  await db.update(qualStudies).set({ published, status: "LIVE", publishedAt: new Date() }).where(eq(qualStudies.id, id));
}

export async function setStudyOpen(db: DB, ownerId: string, id: string, open: boolean) {
  const s = await mustStudy(db, ownerId, id);
  if (open && !s.published) throw new QualError("Publish the study first.");
  await db.update(qualStudies).set({ status: open ? "LIVE" : "CLOSED" }).where(eq(qualStudies.id, id));
}

export async function deleteStudy(db: DB, ownerId: string, id: string) {
  await mustStudy(db, ownerId, id);
  await deleteAudioPrefix(db, `qual/${id}/`);
  await db.delete(qualStudies).where(eq(qualStudies.id, id));
}

/** True when the draft differs from what respondents currently see. */
export function hasUnpublishedChanges(s: StudyRow) {
  if (!s.published) return true;
  const p = s.published as PublishedStudy;
  return stable({ t: p.title, i: p.intro, q: p.questions, s: { ...defaultSettings(), ...p.settings } }) !== stable({ t: s.title, i: s.intro, q: s.questions, s: studySettings(s) });
}

/** JSON with sorted keys (Postgres jsonb doesn't keep key order). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

// ───────── spoken explanations (recorded by the researcher) ─────────

export const MAX_EXPLAIN_SECONDS = 180;
const explainPrefix = (studyId: string) => `qual/${studyId}/_explain/`;
const audioExt = (type: string) => (/mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /mpeg|mp3/.test(type) ? "mp3" : /wav/.test(type) ? "wav" : "webm");

/** Stores a researcher's spoken explanation for a question; the builder then saves it on the question. */
export async function saveExplanation(db: DB, ownerId: string, studyId: string, bytes: Uint8Array, mime: string, seconds: number) {
  await mustStudy(db, ownerId, studyId);
  if (!bytes.length) throw new QualError("The recording is empty. Please record again.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new QualError("That recording is too large. Keep explanations under three minutes.");
  const type = (mime || "audio/webm").toLowerCase();
  if (!AUDIO_TYPES.test(type)) throw new QualError("That isn't an audio recording we can store.");
  const key = `${explainPrefix(studyId)}${Date.now().toString(36)}-${token(6)}.${audioExt(type)}`;
  await putAudio(db, key, bytes, type.split(";")[0]);
  return { key, mime: type.split(";")[0], seconds: Math.max(0, Math.min(MAX_EXPLAIN_SECONDS, Math.round(seconds || 0))) };
}

/** The researcher's own explanation file, for playback in the builder. */
export async function ownerExplanation(db: DB, ownerId: string, studyId: string, key: string) {
  await mustStudy(db, ownerId, studyId);
  if (!key.startsWith(explainPrefix(studyId)) || key.includes("..")) return null;
  return getAudio(db, key);
}

/** The explanation respondents hear: only ever one attached to a question of the published study. */
export async function publicExplanation(db: DB, tok: string, questionId: string) {
  const s = await publicStudy(db, tok);
  const q = s?.study.questions.find((x) => x.id === questionId);
  if (!s || !q?.explain || !q.explain.key.startsWith(explainPrefix(s.id))) return null;
  return getAudio(db, q.explain.key);
}

// ───────── respondents (public, no account) ─────────

export async function publicStudy(db: DB, tok: string): Promise<{ id: string; status: string; study: PublishedStudy } | null> {
  const [s] = await db.select({ id: qualStudies.id, status: qualStudies.status, published: qualStudies.published }).from(qualStudies).where(eq(qualStudies.token, tok));
  if (!s || !s.published || s.status === "DRAFT") return null;
  const p = s.published as PublishedStudy;
  return { id: s.id, status: s.status, study: { ...p, settings: { ...defaultSettings(), ...p.settings } } };
}

async function liveStudy(db: DB, tok: string) {
  const s = await publicStudy(db, tok);
  if (!s) throw new QualError("This study link isn't valid.");
  if (s.status !== "LIVE") throw new QualError("This study is closed and isn't accepting responses.");
  return s;
}

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function respondent(db: DB, tok: string, responseId: string, secret: string) {
  const s = await liveStudy(db, tok);
  const [r] = await db.select().from(qualResponses).where(and(eq(qualResponses.id, responseId), eq(qualResponses.studyId, s.id)));
  if (!r || !sameSecret(r.secret, secret)) throw new QualError("We couldn't find your answers. Start again from the study link.");
  if (r.status === "SUBMITTED") throw new QualError("These answers have already been submitted.");
  return { s, r };
}

export async function startResponse(db: DB, tok: string, p: { name?: string; email?: string; userAgent?: string }) {
  const s = await liveStudy(db, tok);
  const st = s.study.settings;
  const name = p.name?.trim().slice(0, 120) || null;
  const email = p.email?.trim().toLowerCase().slice(0, 200) || null;
  if (st.askName === "required" && !name) throw new QualError("Please enter your name.");
  if (st.askEmail === "required" && !email) throw new QualError("Please enter your email address.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new QualError("That email address doesn't look right.");
  const secret = token(24);
  const [r] = await db
    .insert(qualResponses)
    .values({ studyId: s.id, secret, name: st.askName === "no" ? null : name, email: st.askEmail === "no" ? null : email, userAgent: p.userAgent?.slice(0, 300) ?? null })
    .returning({ id: qualResponses.id });
  return { responseId: r.id, secret };
}

/** Saves one typed / chosen answer; audio goes through saveAudio. */
export async function saveAnswer(db: DB, tok: string, responseId: string, secret: string, questionId: string, input: { text?: string; choice?: string; choices?: string[]; rating?: number }) {
  const { s, r } = await respondent(db, tok, responseId, secret);
  const q = s.study.questions.find((x) => x.id === questionId && x.type !== "section");
  if (!q) throw new QualError("That question isn't part of this study.");
  const prev = ((r.answers as Answers) ?? {})[q.id] ?? {};
  const next: Answer = { ...prev };
  if (q.type === "text" || q.type === "voice") {
    if (q.type === "voice" && !q.allowText && input.text) throw new QualError("This question needs a recorded answer.");
    next.text = (input.text ?? "").slice(0, 20_000);
  } else if (q.type === "choice" || q.type === "dropdown") {
    if (input.choice && !q.options.includes(input.choice)) throw new QualError("Choose one of the options.");
    next.choice = input.choice || undefined;
  } else if (q.type === "multi") {
    const picked = (input.choices ?? []).filter((c) => q.options.includes(c));
    next.choices = [...new Set(picked)];
  } else if (q.type === "rating") {
    const v = Number(input.rating);
    if (!Number.isInteger(v) || v < 1 || v > q.scaleMax) throw new QualError("Choose a point on the scale.");
    next.rating = v;
  }
  await db.update(qualResponses).set({ answers: sql`${qualResponses.answers} || ${JSON.stringify({ [q.id]: next })}::jsonb` }).where(eq(qualResponses.id, r.id));
}

/** Stores a recording for a voice question (replacing an earlier take). */
export async function saveAudio(db: DB, tok: string, responseId: string, secret: string, questionId: string, bytes: Uint8Array, mime: string, seconds: number) {
  const { s, r } = await respondent(db, tok, responseId, secret);
  const q = s.study.questions.find((x) => x.id === questionId && x.type === "voice");
  if (!q) throw new QualError("That question doesn't take a recording.");
  if (!bytes.length) throw new QualError("The recording is empty. Please record again.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new QualError("That recording is too large. Please keep answers shorter.");
  const type = (mime || "audio/webm").toLowerCase();
  if (!AUDIO_TYPES.test(type)) throw new QualError("That isn't an audio recording we can store.");
  const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /mpeg|mp3/.test(type) ? "mp3" : /wav/.test(type) ? "wav" : "webm";
  const prev = ((r.answers as Answers) ?? {})[q.id];
  const key = `qual/${s.id}/${r.id}/${q.id}-${Date.now().toString(36)}.${ext}`;
  await putAudio(db, key, bytes, type.split(";")[0]);
  const audio = { key, mime: type.split(";")[0], seconds: Math.max(0, Math.min(3600, Math.round(seconds || 0))), bytes: bytes.length, at: new Date().toISOString() };
  const next: Answer = { ...(prev ?? {}), audio, transcript: undefined, tStatus: undefined, tError: undefined };
  await db.update(qualResponses).set({ answers: sql`${qualResponses.answers} || ${JSON.stringify({ [q.id]: next })}::jsonb` }).where(eq(qualResponses.id, r.id));
  if (prev?.audio?.key) await deleteAudio(db, prev.audio.key).catch(() => null);
  return { seconds: audio.seconds };
}

/** Removes a recording (the respondent chose to type instead, or to record again later). */
export async function clearAudio(db: DB, tok: string, responseId: string, secret: string, questionId: string) {
  const { r } = await respondent(db, tok, responseId, secret);
  const prev = ((r.answers as Answers) ?? {})[questionId];
  if (!prev?.audio) return;
  const next: Answer = { ...prev, audio: undefined, transcript: undefined, tStatus: undefined };
  await db.update(qualResponses).set({ answers: sql`${qualResponses.answers} || ${JSON.stringify({ [questionId]: next })}::jsonb` }).where(eq(qualResponses.id, r.id));
  await deleteAudio(db, prev.audio.key).catch(() => null);
}

/** What the respondent has answered so far, so a reload or a dropped connection resumes where they were. */
export async function resumeResponse(db: DB, tok: string, responseId: string, secret: string) {
  const { r } = await respondent(db, tok, responseId, secret);
  const answers = (r.answers as Answers) ?? {};
  return Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, { text: a.text, choice: a.choice, choices: a.choices, rating: a.rating, audio: a.audio ? { seconds: a.audio.seconds } : undefined }]));
}

export async function submitResponse(db: DB, tok: string, responseId: string, secret: string) {
  const { s, r } = await respondent(db, tok, responseId, secret);
  const answers = (r.answers as Answers) ?? {};
  const missing = answerable(s.study.questions).find((q) => q.required && !isAnswered(q, answers[q.id]));
  if (missing) throw new QualError(`Please answer: “${missing.text.slice(0, 80)}”`);
  await db.update(qualResponses).set({ status: "SUBMITTED", submittedAt: new Date() }).where(eq(qualResponses.id, r.id));
  const [owner] = await db.select({ ownerId: qualStudies.ownerId, title: qualStudies.title }).from(qualStudies).where(eq(qualStudies.id, s.id));
  if (s.study.settings.notifyOwner && owner) {
    await notify(db, { userId: owner.ownerId, kind: "STUDY_RESPONSE", title: `New response: ${owner.title}`, body: `${r.name ?? "Someone"} completed your study.`, link: `/tools/qual/${s.id}/responses` });
  }
  return { studyId: s.id, responseId: r.id };
}

// ───────── responses (researcher) ─────────

export type ResponseRow = typeof qualResponses.$inferSelect;

/** All responses, oldest first, with stable participant numbers (P01, P02...) in that order. */
export async function listResponses(db: DB, ownerId: string, studyId: string) {
  await mustStudy(db, ownerId, studyId);
  const rows = await db.select().from(qualResponses).where(eq(qualResponses.studyId, studyId)).orderBy(asc(qualResponses.startedAt), asc(qualResponses.id));
  return rows.map((r, i) => ({ ...r, n: i + 1, answers: (r.answers as Answers) ?? {} }));
}
export type ListedResponse = Awaited<ReturnType<typeof listResponses>>[number];

/** Submitted, non-test responses: what exports and analysis use. */
export const usable = (rs: ListedResponse[]) => rs.filter((r) => r.status === "SUBMITTED" && !r.flagged);

async function mustResponse(db: DB, ownerId: string, responseId: string) {
  const [row] = await db
    .select({ r: qualResponses, ownerId: qualStudies.ownerId })
    .from(qualResponses)
    .innerJoin(qualStudies, eq(qualStudies.id, qualResponses.studyId))
    .where(eq(qualResponses.id, responseId));
  if (!row || row.ownerId !== ownerId) throw new QualError("Response not found.");
  return row.r;
}

export async function setFlag(db: DB, ownerId: string, responseId: string, flagged: boolean) {
  await mustResponse(db, ownerId, responseId);
  await db.update(qualResponses).set({ flagged }).where(eq(qualResponses.id, responseId));
}

export async function setTags(db: DB, ownerId: string, responseId: string, tags: string[]) {
  await mustResponse(db, ownerId, responseId);
  const clean = [...new Set(tags.map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
  await db.update(qualResponses).set({ tags: clean }).where(eq(qualResponses.id, responseId));
}

export async function deleteResponse(db: DB, ownerId: string, responseId: string) {
  const r = await mustResponse(db, ownerId, responseId);
  await deleteAudioPrefix(db, `qual/${r.studyId}/${r.id}/`);
  await db.delete(qualResponses).where(eq(qualResponses.id, responseId));
}

export async function editTranscript(db: DB, ownerId: string, responseId: string, questionId: string, transcript: string) {
  const r = await mustResponse(db, ownerId, responseId);
  const prev = ((r.answers as Answers) ?? {})[questionId];
  if (!prev?.audio) throw new QualError("That answer has no recording.");
  const next: Answer = { ...prev, transcript: transcript.slice(0, 50_000), tStatus: "edited", tError: undefined };
  await db.update(qualResponses).set({ answers: sql`${qualResponses.answers} || ${JSON.stringify({ [questionId]: next })}::jsonb` }).where(eq(qualResponses.id, responseId));
}

/** The audio of one answer, for a researcher who owns the study. */
export async function audioFor(db: DB, ownerId: string, responseId: string, questionId: string) {
  const r = await mustResponse(db, ownerId, responseId);
  const a = ((r.answers as Answers) ?? {})[questionId]?.audio;
  if (!a) return null;
  const file = await getAudio(db, a.key);
  return file ? { ...file, ref: a } : null;
}

export async function responseCounts(db: DB, studyId: string) {
  const rows = await db
    .select({ status: qualResponses.status, flagged: qualResponses.flagged, n: count() })
    .from(qualResponses)
    .where(eq(qualResponses.studyId, studyId))
    .groupBy(qualResponses.status, qualResponses.flagged);
  const get = (st: string, f: boolean) => Number(rows.find((r) => r.status === st && r.flagged === f)?.n ?? 0);
  return { submitted: get("SUBMITTED", false), inProgress: get("IN_PROGRESS", false), test: get("SUBMITTED", true) + get("IN_PROGRESS", true) };
}

// ───────── transcription (Deepgram) ─────────

export const transcriptionOn = () => !!process.env.DEEPGRAM_API_KEY;

async function deepgram(bytes: Uint8Array, mime: string, language: string) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new QualError("Automatic transcription isn't switched on yet.");
  const params = new URLSearchParams({ model: process.env.DEEPGRAM_MODEL || "nova-3", smart_format: "true", punctuate: "true", paragraphs: "true" });
  params.set("language", language === "multi" ? "multi" : language || "en");
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": mime },
    body: bytes as BodyInit,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    console.error("deepgram", res.status, (await res.text().catch(() => "")).slice(0, 400));
    throw new QualError(res.status === 401 || res.status === 403 ? "The transcription key was refused." : `Transcription failed (${res.status}).`);
  }
  const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string; paragraphs?: { transcript?: string } }[] }[] } };
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  return (alt?.paragraphs?.transcript || alt?.transcript || "").trim();
}

async function setAnswer(db: DB, responseId: string, questionId: string, patch: Partial<Answer>) {
  await db
    .update(qualResponses)
    .set({ answers: sql`jsonb_set(${qualResponses.answers}, ${`{${questionId}}`}::text[], coalesce(${qualResponses.answers} -> ${questionId}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(qualResponses.id, responseId));
}

/** Transcribes one answer. Failures are recorded on the answer, so the researcher can see and retry. */
export async function transcribeOne(db: DB, r: { id: string; answers: Answers }, questionId: string, language: string) {
  const a = r.answers[questionId];
  if (!a?.audio) return "skipped" as const;
  if (language === "none") {
    await setAnswer(db, r.id, questionId, { tStatus: "none" });
    return "skipped" as const;
  }
  try {
    const file = await getAudio(db, a.audio.key);
    if (!file) throw new QualError("The recording is missing from storage.");
    const text = await deepgram(file.bytes, file.mimeType, language);
    await setAnswer(db, r.id, questionId, { transcript: text || "(no speech detected)", tStatus: "done", tError: "" });
    return "done" as const;
  } catch (err) {
    await setAnswer(db, r.id, questionId, { tStatus: "failed", tError: err instanceof Error ? err.message.slice(0, 200) : "failed" });
    return "failed" as const;
  }
}

/** Everything a response still needs transcribed (called after submission, and by "Transcribe all"). */
export async function transcribeResponse(db: DB, responseId: string, opts: { retry?: boolean } = {}) {
  const [row] = await db
    .select({ r: qualResponses, published: qualStudies.published })
    .from(qualResponses)
    .innerJoin(qualStudies, eq(qualStudies.id, qualResponses.studyId))
    .where(eq(qualResponses.id, responseId));
  if (!row) return { done: 0, failed: 0 };
  const p = row.published as PublishedStudy | null;
  const language = p?.settings?.language ?? "en";
  const answers = (row.r.answers as Answers) ?? {};
  let done = 0,
    failed = 0;
  for (const [qid, a] of Object.entries(answers)) {
    if (!a.audio) continue;
    if (a.tStatus === "done" || a.tStatus === "edited" || (a.tStatus === "failed" && !opts.retry) || (a.tStatus === "none" && !opts.retry)) continue;
    const res = await transcribeOne(db, { id: row.r.id, answers }, qid, language);
    if (res === "done") done++;
    if (res === "failed") failed++;
  }
  return { done, failed };
}

export async function transcribeStudy(db: DB, ownerId: string, studyId: string, limit = 15) {
  const s = await mustStudy(db, ownerId, studyId);
  const language = (s.published as PublishedStudy | null)?.settings?.language ?? studySettings(s).language;
  if (language !== "none" && !transcriptionOn()) throw new QualError("Automatic transcription isn't switched on yet. You can type transcripts yourself.");
  const rs = usable(await listResponses(db, ownerId, studyId));
  let done = 0,
    failed = 0,
    remaining = 0;
  for (const r of rs) {
    for (const [qid, a] of Object.entries(r.answers)) {
      if (!a.audio || a.tStatus === "done" || a.tStatus === "edited") continue;
      if (done + failed >= limit) {
        remaining++;
        continue;
      }
      const res = await transcribeOne(db, r, qid, language);
      if (res === "done") done++;
      if (res === "failed") failed++;
    }
  }
  return { done, failed, remaining };
}

export async function ownerName(db: DB, studyId: string) {
  const [row] = await db.select({ name: users.name }).from(qualStudies).innerJoin(users, eq(users.id, qualStudies.ownerId)).where(eq(qualStudies.id, studyId));
  return row?.name ?? null;
}
