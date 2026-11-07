/**
 * Qualitative Studio exports: a response spreadsheet (CSV, opens in Excel, SPSS, R and NVivo),
 * one plain-text transcript per participant (NVivo/ATLAS.ti/MAXQDA import them as documents), and
 * the recordings as a ZIP, streamed so large studies don't need to fit in memory.
 */

import { Zip, ZipPassThrough, strToU8, zipSync } from "fflate";
import type { DB } from "@/db";
import { answerText, answerable, pid, questionNumbers, translationOf, type PublishedStudy, type Question } from "@/lib/qual";
import { getAudio } from "./qualStorage";
import { type ListedResponse, type StudyRow, studyQuestions, studySettings, usable } from "./qual";

export const slug = (t: string, n = 50) => t.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, n).replace(/-+$/, "") || "study";

/** The questions respondents actually answered: the published copy, or the draft if never published. */
export const fieldQuestions = (s: StudyRow): Question[] => ((s.published as PublishedStudy | null)?.questions ?? studyQuestions(s));

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ext = (key: string) => key.split(".").pop() ?? "webm";
export const audioName = (r: ListedResponse, q: Question, n: number, key: string) => `${pid(r.n)}/${pid(r.n)}_Q${String(n).padStart(2, "0")}_${slug(q.text, 30)}.${ext(key)}`;

export function responsesCsv(s: StudyRow, rs: ListedResponse[], opts: { all?: boolean } = {}) {
  const qs = answerable(fieldQuestions(s));
  const nums = questionNumbers(fieldQuestions(s));
  const rows = opts.all ? rs : usable(rs);
  // an English column for each open question that has any translation
  const translated = new Set(qs.filter((q) => rows.some((r) => translationOf(q, r.answers[q.id]))).map((q) => q.id));
  const head = ["Participant", "Name", "Email", "Status", "Test response", "Tags", "Started", "Submitted"];
  for (const q of qs) {
    head.push(`Q${nums[q.id]}. ${q.text}`);
    if (translated.has(q.id)) head.push(`Q${nums[q.id]} (English translation)`);
    if (q.type === "voice") head.push(`Q${nums[q.id]} answered by`, `Q${nums[q.id]} audio file`, `Q${nums[q.id]} seconds`);
  }
  const lines = [head.map(cell).join(",")];
  for (const r of rows) {
    const line: unknown[] = [pid(r.n), r.name ?? "", r.email ?? "", r.status === "SUBMITTED" ? "Submitted" : "In progress", r.flagged ? "Yes" : "No", r.tags.join("; "), r.startedAt.toISOString(), r.submittedAt?.toISOString() ?? ""];
    for (const q of qs) {
      const a = r.answers[q.id];
      line.push(answerText(q, a));
      if (translated.has(q.id)) line.push(translationOf(q, a) ?? "");
      if (q.type === "voice") line.push(a?.text?.trim() ? "typing" : a?.audio ? "voice" : "", a?.audio ? audioName(r, q, nums[q.id], a.audio.key) : "", a?.audio?.seconds ?? "");
    }
    lines.push(line.map(cell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel reads accents and cedi signs correctly
}

/** One .txt per participant, without names: attributes first, then each question and answer. */
export function transcriptsZip(s: StudyRow, rs: ListedResponse[]) {
  const qs = answerable(fieldQuestions(s));
  const nums = questionNumbers(fieldQuestions(s));
  const files: Record<string, Uint8Array> = {};
  for (const r of usable(rs)) {
    const attrs = qs.filter((q) => q.type !== "voice" && q.type !== "text").map((q) => `${q.text}: ${answerText(q, r.answers[q.id]) || "(no answer)"}`);
    const body = qs
      .filter((q) => q.type === "voice" || q.type === "text")
      .map((q) => {
        const tr = translationOf(q, r.answers[q.id]);
        return `Q${nums[q.id]}. ${q.text}\n\n${answerText(q, r.answers[q.id]) || "(no answer)"}${tr && tr !== answerText(q, r.answers[q.id]) ? `\n\n[English translation]\n${tr}` : ""}`;
      })
      .join("\n\n\n");
    const text = [`${s.title}`, `Participant ${pid(r.n)}`, ...(attrs.length ? ["", ...attrs] : []), "", "─".repeat(40), "", body, ""].join("\n");
    files[`${pid(r.n)}.txt`] = strToU8(text.replace(/\n/g, "\r\n"));
  }
  files["README.txt"] = strToU8(
    [
      `${s.title}: participant transcripts`,
      "",
      "One file per participant. Names are left out; participant numbers match the response spreadsheet.",
      "Voice answers show the transcript (as edited); typed answers show what the participant typed.",
      "",
      "NVivo: Import > Files, choose all the .txt files. To add attributes, import the response spreadsheet as a classification sheet.",
      "ATLAS.ti / MAXQDA: add the .txt files as documents.",
    ].join("\r\n"),
  );
  return zipSync(files, { level: 6 });
}

/** Streams every recording, in folders per participant, as a ZIP. */
export function audioZipStream(db: DB, s: StudyRow, rs: ListedResponse[]) {
  const qs = answerable(fieldQuestions(s));
  const nums = questionNumbers(fieldQuestions(s));
  const items = usable(rs).flatMap((r) => qs.filter((q) => r.answers[q.id]?.audio).map((q) => ({ r, q, key: r.answers[q.id].audio!.key })));
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      const list = [`${s.title}: recordings`, "", `Language: ${studySettings(s).language}`, "", ...items.map((i) => audioName(i.r, i.q, nums[i.q.id], i.key))].join("\r\n");
      const readme = new ZipPassThrough("README.txt");
      zip.add(readme);
      readme.push(strToU8(list), true);
      for (const i of items) {
        const file = await getAudio(db, i.key).catch(() => null);
        if (!file) continue;
        const entry = new ZipPassThrough(audioName(i.r, i.q, nums[i.q.id], i.key)); // audio is already compressed
        zip.add(entry);
        entry.push(file.bytes, true);
      }
      zip.end();
    },
  });
}
