/**
 * The Qualitative Studio as the developer API sees it: studies, responses and analysis in plain
 * snake_case JSON, submitting responses from another system, and what happens after a submission
 * (transcription, translation, webhooks), which the public study link shares.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { qualResponses, qualStudies, users } from "@/db/schema";
import { DEFAULT_INTRO, answerable, questionNumbers, settingsSchema, type Answer, type Question } from "@/lib/qual";
import { ApiError, apiAccessFor } from "./apiAccess";
import { aiOn, getAnalysis } from "./qualAnalysis";
import { fieldQuestions } from "./qualExport";
import { translateResponse } from "./qualTranslate";
import {
  MAX_AUDIO_BYTES,
  QualError,
  createStudy,
  deleteResponse,
  getStudy,
  hasUnpublishedChanges,
  listResponses,
  listStudies,
  responseCounts,
  saveAnswer,
  saveAudio,
  saveDraft,
  startResponse,
  studyQuestions,
  studySettings,
  submitResponse,
  transcribeResponse,
  transcriptionOn,
  type ListedResponse,
  validateDraft,
  type StudyRow,
} from "./qual";
import { canUse, peekToolAccess } from "./toolAccess";
import { QuotaError, metered } from "./usage";
import { emit, type Sender } from "./webhooks";

const BASE = () => process.env.APP_URL ?? "https://app.thetruescholars.com";
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const pid = (n: number) => `P${String(n).padStart(2, "0")}`;

// ───────── shapes ─────────

const questionView = (q: Question, n?: number) => ({
  id: q.id,
  number: n ?? null,
  type: q.type,
  text: q.text,
  help: q.help || null,
  required: q.required,
  ...(q.options.length ? { options: q.options } : {}),
  ...(q.type === "voice" ? { allow_text: q.allowText } : {}),
  ...(q.type === "rating" ? { scale_max: q.scaleMax, min_label: q.minLabel || null, max_label: q.maxLabel || null } : {}),
});

const settingsView = (s: ReturnType<typeof studySettings>) => ({ language: s.language, max_seconds: s.maxSeconds, ask_name: s.askName, ask_email: s.askEmail, thank_you: s.thankYou, notify_owner: s.notifyOwner, translate: s.translate });

export async function studyView(db: DB, s: StudyRow, opts: { full?: boolean } = {}) {
  const base = {
    id: s.id,
    title: s.title,
    status: s.status.toLowerCase(),
    public_url: `${BASE()}/s/${s.token}`,
    responses: await responseCounts(db, s.id),
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
    published_at: iso(s.publishedAt),
  };
  if (!opts.full) return base;
  const qs = studyQuestions(s);
  const nums = questionNumbers(qs);
  return {
    ...base,
    intro: s.intro,
    questions: qs.map((q) => questionView(q, nums[q.id])),
    settings: settingsView(studySettings(s)),
    has_unpublished_changes: hasUnpublishedChanges(s),
  };
}

export function responseView(s: StudyRow, r: ListedResponse) {
  const qs = answerable(fieldQuestions(s));
  const nums = questionNumbers(fieldQuestions(s));
  return {
    id: r.id,
    study_id: s.id,
    participant: pid(r.n),
    status: r.status === "SUBMITTED" ? "submitted" : "in_progress",
    test: r.flagged,
    name: r.name,
    email: r.email,
    tags: r.tags ?? [],
    started_at: iso(r.startedAt),
    submitted_at: iso(r.submittedAt),
    answers: qs.map((q) => answerView(q, r.answers[q.id], nums[q.id], r.id)),
  };
}

function answerView(q: Question, a: Answer | undefined, n: number, rid: string) {
  const out: Record<string, unknown> = { question_id: q.id, number: n, question: q.text, type: q.type };
  if (q.type === "voice" || q.type === "text") {
    out.text = a?.text?.trim() || null;
    if (q.type === "voice") {
      out.audio = a?.audio ? { seconds: a.audio.seconds, mime_type: a.audio.mime, url: `${BASE()}/api/v1/responses/${rid}/audio/${q.id}` } : null;
      out.transcript = a?.transcript ?? null;
      out.transcription_status = a?.audio ? (a.tStatus ?? "pending") : null;
    }
    out.translation = a?.trStatus === "done" ? (a.translation ?? null) : null;
  } else if (q.type === "multi") out.choices = a?.choices ?? [];
  else if (q.type === "rating") out.rating = a?.rating ?? null;
  else out.choice = a?.choice ?? null;
  return out;
}

// ───────── reading ─────────

export async function apiStudy(db: DB, userId: string, id: string) {
  const s = await getStudy(db, userId, id);
  if (!s) throw new ApiError(404, "not_found", "Study not found.");
  return s;
}

export async function apiStudies(db: DB, userId: string) {
  const list = await listStudies(db, userId);
  const rows = list.length ? await db.select().from(qualStudies).where(eq(qualStudies.ownerId, userId)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return Promise.all(list.map((l) => studyView(db, byId.get(l.id)!)));
}

export type ResponseQuery = { status?: string | null; since?: string | null; after?: string | null; limit?: string | null; include_test?: string | null };

export async function apiResponses(db: DB, userId: string, studyId: string, q: ResponseQuery) {
  const s = await apiStudy(db, userId, studyId);
  const all = await listResponses(db, userId, studyId);
  const status = q.status ?? "submitted";
  if (!["submitted", "in_progress", "all"].includes(status)) throw new ApiError(400, "invalid_request", "status must be submitted, in_progress or all.");
  const since = q.since ? new Date(q.since) : null;
  if (since && isNaN(since.getTime())) throw new ApiError(400, "invalid_request", "since must be a date and time, for example 2026-11-01T00:00:00Z.");
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
  let rs = all.filter((r) => (status === "all" ? true : status === "submitted" ? r.status === "SUBMITTED" : r.status !== "SUBMITTED"));
  if (q.include_test !== "true") rs = rs.filter((r) => !r.flagged);
  if (since) rs = rs.filter((r) => (r.submittedAt ?? r.startedAt) >= since);
  if (q.after) {
    const i = rs.findIndex((r) => r.id === q.after);
    if (i < 0) throw new ApiError(400, "invalid_request", "after must be the id of a response from an earlier page.");
    rs = rs.slice(i + 1);
  }
  const page = rs.slice(0, limit);
  return { study: s, data: page.map((r) => responseView(s, r)), has_more: rs.length > limit, next_after: rs.length > limit ? page[page.length - 1].id : null, rows: page };
}

export async function apiResponse(db: DB, userId: string, responseId: string) {
  const [row] = await db.select({ studyId: qualResponses.studyId }).from(qualResponses).innerJoin(qualStudies, eq(qualStudies.id, qualResponses.studyId)).where(and(eq(qualResponses.id, responseId), eq(qualStudies.ownerId, userId)));
  if (!row) throw new ApiError(404, "not_found", "Response not found.");
  const s = (await getStudy(db, userId, row.studyId))!;
  const r = (await listResponses(db, userId, s.id)).find((x) => x.id === responseId)!;
  return responseView(s, r);
}

export async function apiAnalysis(db: DB, userId: string, studyId: string) {
  const s = await apiStudy(db, userId, studyId);
  const { researchQuestion, background, state } = await getAnalysis(db, studyId);
  const pids = new Map((await listResponses(db, userId, studyId)).map((r) => [r.id, pid(r.n)]));
  const codes = state.codebook ?? [];
  const codeLabel = new Map(codes.map((c) => [c.id, c.label]));
  return {
    study_id: s.id,
    research_question: researchQuestion || null,
    background: background || null,
    phases_completed: state.done ?? {},
    themes: (state.themes ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      definition: t.definition,
      codes: t.codes.map((c) => ({ id: c, label: codeLabel.get(c) ?? c })),
      subthemes: t.subthemes.map((st) => ({ name: st.name, codes: st.codes.map((c) => ({ id: c, label: codeLabel.get(c) ?? c })) })),
    })),
    codebook: codes.map((c) => ({
      id: c.id,
      label: c.label,
      definition: c.definition,
      theme_id: c.theme ?? null,
      participants: c.rids.map((r) => pids.get(r) ?? r),
      quotes: c.quotes.map((q) => ({ participant: pids.get(q.rid) ?? null, response_id: q.rid, text: q.text })),
    })),
    matrix: Object.fromEntries(Object.entries(state.matrix ?? {}).map(([rid, row]) => [pids.get(rid) ?? rid, row])),
    report: state.report ?? null,
  };
}

// ───────── creating and changing studies ─────────

type StudyInput = { title?: unknown; intro?: unknown; questions?: unknown; settings?: unknown };

/** Accepts the API's shapes (snake_case, ids optional) and turns them into the studio's. */
function draftFrom(s: StudyRow | null, p: StudyInput) {
  const questions =
    p.questions === undefined ? (s ? studyQuestions(s) : [])
    : Array.isArray(p.questions) ? p.questions.map((raw) => {
        const q = (raw ?? {}) as Record<string, unknown>;
        return {
          id: typeof q.id === "string" && q.id ? q.id : randomUUID().slice(0, 8),
          type: q.type,
          text: q.text ?? "",
          help: q.help ?? "",
          required: q.required ?? q.type !== "section",
          options: q.options ?? [],
          allowText: q.allow_text ?? q.allowText ?? true,
          scaleMax: q.scale_max ?? q.scaleMax ?? 5,
          minLabel: q.min_label ?? q.minLabel ?? "",
          maxLabel: q.max_label ?? q.maxLabel ?? "",
          explain: s ? (studyQuestions(s).find((x) => x.id === q.id)?.explain ?? null) : null,
        };
      })
    : (() => {
        throw new ApiError(400, "invalid_request", "questions must be a list.");
      })();
  const current = s ? studySettings(s) : settingsSchema.parse({});
  const ps = (p.settings ?? {}) as Record<string, unknown>;
  if (typeof ps !== "object" || Array.isArray(ps)) throw new ApiError(400, "invalid_request", "settings must be an object.");
  const pick = (snake: string, camel: keyof typeof current) => (ps[snake] ?? ps[camel] ?? current[camel]);
  const settings = {
    language: pick("language", "language"),
    maxSeconds: pick("max_seconds", "maxSeconds"),
    askName: pick("ask_name", "askName"),
    askEmail: pick("ask_email", "askEmail"),
    thankYou: pick("thank_you", "thankYou"),
    notifyOwner: pick("notify_owner", "notifyOwner"),
    translate: pick("translate", "translate"),
  };
  return {
    title: typeof p.title === "string" ? p.title : (s?.title ?? ""),
    intro: typeof p.intro === "string" ? p.intro : (s?.intro ?? ""),
    questions,
    settings,
  };
}

export async function apiCreateStudy(db: DB, userId: string, p: StudyInput) {
  if (typeof p.title !== "string" || !p.title.trim()) throw new ApiError(400, "invalid_request", "Give the study a title.");
  const d = { ...draftFrom(null, p), intro: typeof p.intro === "string" ? p.intro : DEFAULT_INTRO };
  validateDraft(d); // fail before anything is created
  const id = await createStudy(db, userId, { title: d.title });
  await saveDraft(db, userId, id, d);
  return (await getStudy(db, userId, id))!;
}

export async function apiUpdateStudy(db: DB, userId: string, id: string, p: StudyInput) {
  const s = await apiStudy(db, userId, id);
  await saveDraft(db, userId, id, draftFrom(s, p));
  return (await getStudy(db, userId, id))!;
}

// ───────── submitting a response from another system ─────────

type AnswerInput = { text?: unknown; choice?: unknown; choices?: unknown; rating?: unknown; audio?: { data?: unknown; mime_type?: unknown; seconds?: unknown } };

export async function apiSubmit(db: DB, userId: string, studyId: string, p: { name?: unknown; email?: unknown; test?: unknown; answers?: unknown }) {
  const s = await apiStudy(db, userId, studyId);
  if (s.status !== "LIVE") throw new ApiError(409, "study_not_live", s.status === "DRAFT" ? "Publish the study before submitting responses." : "This study is closed. Open it to accept responses.");
  if (!p.answers || typeof p.answers !== "object" || Array.isArray(p.answers)) throw new ApiError(400, "invalid_request", "answers must be an object keyed by question id.");
  const qs = answerable(fieldQuestions(s));
  const answers = p.answers as Record<string, AnswerInput>;
  const unknownId = Object.keys(answers).find((k) => !qs.some((q) => q.id === k));
  if (unknownId) throw new ApiError(400, "invalid_request", `"${unknownId}" isn't a question in the published study. GET the study to see question ids.`);
  const started = await startResponse(db, s.token, { name: typeof p.name === "string" ? p.name : "", email: typeof p.email === "string" ? p.email : "", userAgent: "api" });
  try {
    for (const q of qs) {
      const a = answers[q.id];
      if (!a) continue;
      if (a.audio) {
        if (q.type !== "voice") throw new QualError(`Question ${q.id} doesn't take a recording.`);
        if (typeof a.audio.data !== "string") throw new QualError(`audio.data for ${q.id} must be base64 text.`);
        const bytes = new Uint8Array(Buffer.from(a.audio.data, "base64"));
        if (bytes.length > MAX_AUDIO_BYTES) throw new QualError(`The recording for ${q.id} is larger than 25 MB.`);
        await saveAudio(db, s.token, started.responseId, started.secret, q.id, bytes, String(a.audio.mime_type ?? "audio/webm"), Number(a.audio.seconds ?? 0));
      }
      const input = { text: typeof a.text === "string" ? a.text : undefined, choice: typeof a.choice === "string" ? a.choice : undefined, choices: Array.isArray(a.choices) ? a.choices.map(String) : undefined, rating: a.rating as number | undefined };
      if (input.text !== undefined || input.choice !== undefined || input.choices !== undefined || input.rating !== undefined) {
        if (q.type === "multi" && input.choices?.some((c) => !q.options.includes(c))) throw new QualError(`Some choices for ${q.id} aren't among its options.`);
        await saveAnswer(db, s.token, started.responseId, started.secret, q.id, input);
      }
    }
    if (p.test === true) await db.update(qualResponses).set({ flagged: true }).where(eq(qualResponses.id, started.responseId));
    const done = await submitResponse(db, s.token, started.responseId, started.secret);
    return done;
  } catch (err) {
    // nothing half-made is left behind
    await deleteResponse(db, userId, started.responseId).catch(() => null);
    throw err;
  }
}

// ───────── after a submission (public link and API alike) ─────────

/**
 * Runs once a response is submitted: the `response.submitted` webhook, automatic transcription and
 * translation (while the researcher has access), then `response.processed`.
 */
export async function afterSubmit(db: DB, done: { studyId: string; responseId: string }, send?: Sender) {
  const [owner] = await db.select({ id: users.id, roles: users.roles }).from(qualStudies).innerJoin(users, eq(users.id, qualStudies.ownerId)).where(eq(qualStudies.id, done.studyId));
  if (!owner) return;
  const hooks = (await apiAccessFor(db, owner)).active;
  const payload = async () => {
    const s = (await getStudy(db, owner.id, done.studyId))!;
    const r = (await listResponses(db, owner.id, done.studyId)).find((x) => x.id === done.responseId);
    return r ? { study: { id: s.id, title: s.title }, response: responseView(s, r) } : null;
  };
  if (hooks) {
    const p = await payload();
    if (p && !p.response.test) await emit(db, owner.id, "response.submitted", done.studyId, p, send);
  }
  const access = hooks || canUse((await peekToolAccess(db, "qual", owner)).access as Parameters<typeof canUse>[0]);
  if (access) {
    // counted against the researcher's allowance; over it, recordings wait for them to transcribe later
    if (transcriptionOn()) await metered(db, owner, "qual", "qual.autotranscribe", () => transcribeResponse(db, done.responseId)).catch((e) => {
      if (!(e instanceof QuotaError)) console.error("auto-transcribe", e);
    });
    if (aiOn()) await metered(db, owner, "qual", "qual.autotranslate", () => translateResponse(db, owner.id, done.studyId, done.responseId)).catch((e) => {
      if (!(e instanceof QuotaError)) console.error("auto-translate", e);
    });
  }
  if (hooks) {
    const p = await payload();
    if (p && !p.response.test) await emit(db, owner.id, "response.processed", done.studyId, p, send);
  }
}
