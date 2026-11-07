/** Qualitative Studio: the shapes of studies, questions and answers (shared by server and browser). */

import { z } from "zod";

export const QUESTION_TYPES = {
  voice: "Voice answer",
  text: "Typed answer",
  choice: "Multiple choice (one)",
  multi: "Checkboxes (several)",
  dropdown: "Dropdown list",
  rating: "Rating scale",
  section: "Section heading",
} as const;
export type QType = keyof typeof QUESTION_TYPES;

export const LANGUAGES = {
  en: "English",
  multi: "Mixed / auto-detect (English, Spanish, French, Portuguese and more)",
  fr: "French",
  pt: "Portuguese",
  es: "Spanish",
  de: "German",
  none: "Don't transcribe automatically (type transcripts yourself)",
} as const;
export type Lang = keyof typeof LANGUAGES;

export const questionSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(Object.keys(QUESTION_TYPES) as [QType, ...QType[]]),
  text: z.string().trim().max(1000),
  help: z.string().trim().max(600).optional().default(""),
  required: z.boolean().optional().default(false),
  options: z.array(z.string().trim().min(1).max(200)).max(300).optional().default([]),
  allowText: z.boolean().optional().default(true), // voice: respondents may type instead
  scaleMax: z.number().int().min(3).max(10).optional().default(5),
  minLabel: z.string().trim().max(60).optional().default(""),
  maxLabel: z.string().trim().max(60).optional().default(""),
});
export type Question = z.infer<typeof questionSchema>;

export const settingsSchema = z.object({
  language: z.enum(Object.keys(LANGUAGES) as [Lang, ...Lang[]]).default("en"),
  maxSeconds: z.number().int().min(30).max(600).default(300),
  askName: z.enum(["required", "optional", "no"]).default("optional"),
  askEmail: z.enum(["required", "optional", "no"]).default("no"),
  thankYou: z.string().trim().max(1500).default("Thank you. Your answers have been saved and will help this research."),
  notifyOwner: z.boolean().default(true),
});
export type StudySettings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): StudySettings => settingsSchema.parse({});

export type AudioRef = { key: string; mime: string; seconds: number; bytes: number; at: string };
export type Answer = {
  text?: string;
  choice?: string;
  choices?: string[];
  rating?: number;
  audio?: AudioRef;
  transcript?: string;
  tStatus?: "pending" | "done" | "failed" | "edited" | "none";
  tError?: string;
};
export type Answers = Record<string, Answer>;

export type PublishedStudy = { title: string; intro: string; questions: Question[]; settings: StudySettings };

export const DEFAULT_INTRO = `Thank you for considering taking part in this study.

What it involves: you will answer a few short questions. Some ask you to speak your answer; you can record, listen back and record again before moving on. It takes about 15 to 20 minutes.

Your rights: taking part is voluntary. You can skip questions that are not required, and you can stop at any time without giving a reason.

Your privacy: your answers are confidential and will be used only for research. Voice answers are recorded and transcribed. Quotes used in reports will not include your name.

By continuing, you confirm that you have read this information and agree to take part.`;

export const newQuestion = (type: QType = "voice"): Question => ({
  id: Math.random().toString(36).slice(2, 10),
  type,
  text: "",
  help: "",
  required: type !== "section",
  options: type === "choice" || type === "multi" || type === "dropdown" ? ["", ""] : [],
  allowText: true,
  scaleMax: 5,
  minLabel: type === "rating" ? "Not at all" : "",
  maxLabel: type === "rating" ? "Very much" : "",
});

/** Questions respondents answer (section headings are not questions). */
export const answerable = (qs: Question[]) => qs.filter((q) => q.type !== "section");

/** "Q3" labels, counting only answerable questions. */
export function questionNumbers(qs: Question[]): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  for (const q of qs) if (q.type !== "section") out[q.id] = ++n;
  return out;
}

export function isAnswered(q: Question, a: Answer | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case "voice":
      return !!a.audio || !!a.text?.trim();
    case "text":
      return !!a.text?.trim();
    case "choice":
    case "dropdown":
      return !!a.choice;
    case "multi":
      return !!a.choices?.length;
    case "rating":
      return typeof a.rating === "number";
    default:
      return true;
  }
}

/** One readable value per answer: a typed answer, the transcript, the choice(s) or the rating. */
export function answerText(q: Question, a: Answer | undefined): string {
  if (!a) return "";
  if (q.type === "voice") return (a.text?.trim() || a.transcript?.trim() || "").trim();
  if (q.type === "text") return a.text?.trim() ?? "";
  if (q.type === "multi") return (a.choices ?? []).join("; ");
  if (q.type === "rating") return typeof a.rating === "number" ? String(a.rating) : "";
  return a.choice ?? "";
}

export const pid = (n: number) => `P${String(n).padStart(2, "0")}`;
export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
