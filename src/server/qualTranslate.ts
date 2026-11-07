/**
 * English translation of open answers (voice transcripts and typed text) in the Qualitative Studio.
 * The original is always kept; the translation is stored beside it with a fingerprint of the text it
 * was made from, so an edited transcript is translated again rather than silently going stale.
 */

import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { qualResponses } from "@/db/schema";
import { LANGUAGES, answerText, fingerprint, needsTranslation, type Answers, type Lang, type Question } from "@/lib/qual";
import { getStudy, listResponses, QualError, studySettings, usable } from "./qual";
import { aiOn, claude } from "./qualAnalysis";
import { fieldQuestions } from "./qualExport";

const SYSTEM = `You translate answers from research interviews and surveys into English for qualitative analysis.
Translate faithfully and completely. Keep the speaker's meaning, tone, hedges, repetitions and informal phrasing. Do not summarise, correct, tidy up, explain or add anything.
Keep names of people, places and organisations; romanise Chinese names in pinyin. If a word or idiom has no close English equivalent, translate its meaning and give the original once in brackets.
If the text is already in English, return it unchanged.
Reply with the English translation only: no notes, labels or quotation marks.`;

export async function translateText(text: string, language: string) {
  const from = language in LANGUAGES && language !== "none" && language !== "multi" && language !== "en" ? `The answer is in ${LANGUAGES[language as Lang]}.` : "Detect the language of the answer.";
  const out = await claude(SYSTEM, `${from}\n\n<answer>\n${text}\n</answer>`, Math.min(8000, 400 + text.length * 3));
  return out.replace(/^<answer>\s*|\s*<\/answer>$/g, "").trim();
}

async function setAnswer(db: DB, responseId: string, questionId: string, patch: Record<string, unknown>) {
  await db
    .update(qualResponses)
    .set({ answers: sql`jsonb_set(${qualResponses.answers}, ${`{${questionId}}`}::text[], coalesce(${qualResponses.answers} -> ${questionId}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(qualResponses.id, responseId));
}

/** Translates one answer as it stands now. Failures are recorded on the answer so they can be retried. */
export async function translateOne(db: DB, r: { id: string; answers: Answers }, q: Question, language: string) {
  const a = r.answers[q.id];
  if (!needsTranslation(q, a)) return "skipped" as const;
  const src = answerText(q, a);
  try {
    const translation = await translateText(src, language);
    if (!translation) throw new QualError("The translation came back empty.");
    await setAnswer(db, r.id, q.id, { translation, trOf: fingerprint(src), trStatus: "done", trError: "" });
    return "done" as const;
  } catch (err) {
    await setAnswer(db, r.id, q.id, { translation: "", trOf: fingerprint(src), trStatus: "failed", trError: err instanceof Error ? err.message.slice(0, 200) : "failed" });
    return "failed" as const;
  }
}

/** What still needs translating in a study (for the button and the page). */
export function pendingTranslations(questions: Question[], rs: { answers: Answers }[]) {
  let n = 0;
  for (const r of rs) for (const q of questions) if (needsTranslation(q, r.answers[q.id])) n++;
  return n;
}

/** Translates up to `limit` answers in a study; the page calls again while some remain. */
export async function translateStudy(db: DB, ownerId: string, studyId: string, limit = 20) {
  const s = await getStudy(db, ownerId, studyId);
  if (!s) throw new QualError("Study not found.");
  if (!aiOn()) throw new QualError("Translation isn't switched on yet.");
  const settings = studySettings(s);
  const qs = fieldQuestions(s);
  const rs = usable(await listResponses(db, ownerId, studyId));
  let done = 0,
    failed = 0,
    remaining = 0;
  for (const r of rs) {
    for (const q of qs) {
      if (!needsTranslation(q, r.answers[q.id])) continue;
      // answers that failed before are retried by this explicit request
      if (done + failed >= limit) {
        remaining++;
        continue;
      }
      const res = await translateOne(db, r, q, settings.language);
      if (res === "done") done++;
      if (res === "failed") failed++;
    }
  }
  return { done, failed, remaining };
}

/** After a respondent submits (and after transcription): translate their open answers if the study asks for it. */
export async function translateResponse(db: DB, ownerId: string, studyId: string, responseId: string) {
  const s = await getStudy(db, ownerId, studyId);
  if (!s || !aiOn() || !studySettings(s).translate) return { done: 0, failed: 0 };
  const [row] = await db.select().from(qualResponses).where(eq(qualResponses.id, responseId));
  if (!row) return { done: 0, failed: 0 };
  const r = { id: row.id, answers: (row.answers as Answers) ?? {} };
  let done = 0,
    failed = 0;
  for (const q of fieldQuestions(s)) {
    const a = r.answers[q.id];
    if (a?.trStatus === "failed" && a.trOf === fingerprint(answerText(q, a))) continue; // don't hammer a failing one; the researcher can retry
    const res = await translateOne(db, r, q, studySettings(s).language);
    if (res === "done") done++;
    if (res === "failed") failed++;
  }
  return { done, failed };
}
