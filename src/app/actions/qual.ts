"use server";

import { translateStudy } from "@/server/qualTranslate";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import {
  QualError,
  deleteResponse,
  deleteStudy,
  editTranscript,
  getStudy,
  publishStudy,
  saveDraft,
  setFlag,
  setStudyOpen,
  setTags,
  studySettings,
  transcribeStudy,
} from "@/server/qual";
import { PHASES, type Phase, aiOn, editAnalysis, runPhase, saveSetup } from "@/server/qualAnalysis";
import { createFromTemplate, createSampleStudy, TEMPLATES, type TemplateKey } from "@/server/qualTemplates";
import { canUse, requestToolUpgrade, toolAccessFor } from "@/server/toolAccess";
import { QuotaError, metered } from "@/server/usage";

export type QualState = { error?: string; ok?: string; at?: number } | undefined;

const ENDED = "Your free trial has ended. Your studies, responses and downloads are safe. Upgrade to keep collecting and analysing.";

/** Creating, publishing, transcribing and analysing need an active trial or access; viewing and downloading never do. */
async function worker() {
  const user = await requireUser();
  if (!canUse(await toolAccessFor(getDb(), "qual", user))) throw new QualError(ENDED);
  return user;
}

const known = (err: unknown): QualState => {
  if (err instanceof QualError || err instanceof QuotaError) return { error: err.message };
  throw err;
};

export async function newStudyAction(template: string): Promise<QualState> {
  let id: string;
  try {
    const user = await worker();
    id = template === "sample" ? await createSampleStudy(getDb(), user.id) : await createFromTemplate(getDb(), user.id, (template in TEMPLATES ? template : "blank") as TemplateKey);
  } catch (err) {
    return known(err);
  }
  redirect(template === "sample" ? `/tools/qual/${id}/responses` : `/tools/qual/${id}`);
}

const pages = (id: string) => revalidatePath(`/tools/qual/${id}`, "layout");

export async function saveDraftAction(id: string, draft: { title: string; intro: string; questions: unknown; settings: unknown }): Promise<QualState> {
  try {
    const user = await requireUser(); // saving work never needs a trial
    await saveDraft(getDb(), user.id, id, draft);
    pages(id);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function publishAction(id: string, draft: { title: string; intro: string; questions: unknown; settings: unknown }): Promise<QualState> {
  try {
    const user = await worker();
    await saveDraft(getDb(), user.id, id, draft);
    await publishStudy(getDb(), user.id, id);
    pages(id);
    return { ok: "Published. Your link is live.", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function setOpenAction(id: string, open: boolean): Promise<QualState> {
  try {
    const user = open ? await worker() : await requireUser();
    await setStudyOpen(getDb(), user.id, id, open);
    pages(id);
    return { ok: open ? "The link is open again." : "The link is closed. No new responses will be accepted.", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function deleteStudyAction(id: string): Promise<QualState> {
  try {
    const user = await requireUser();
    await deleteStudy(getDb(), user.id, id);
  } catch (err) {
    return known(err);
  }
  revalidatePath("/tools/qual");
  redirect("/tools/qual");
}

export async function flagAction(studyId: string, responseId: string, flagged: boolean): Promise<QualState> {
  try {
    const user = await requireUser();
    await setFlag(getDb(), user.id, responseId, flagged);
    pages(studyId);
    return { ok: flagged ? "Marked as a test response" : "Restored", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function tagsAction(studyId: string, responseId: string, tags: string[]): Promise<QualState> {
  try {
    const user = await requireUser();
    await setTags(getDb(), user.id, responseId, tags);
    pages(studyId);
    return { ok: "Tags saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function deleteResponseAction(studyId: string, responseId: string): Promise<QualState> {
  try {
    const user = await requireUser();
    await deleteResponse(getDb(), user.id, responseId);
    pages(studyId);
    return { ok: "Response deleted", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function transcriptAction(studyId: string, responseId: string, questionId: string, text: string): Promise<QualState> {
  try {
    const user = await requireUser();
    await editTranscript(getDb(), user.id, responseId, questionId, text);
    const s = await getStudy(getDb(), user.id, studyId);
    if (s && studySettings(s).translate && aiOn()) {
      await metered(getDb(), user, "qual", "qual.translate", () => translateStudy(getDb(), user.id, studyId, 3)).catch((e) => console.error("translate after edit", e));
    }
    pages(studyId);
    return { ok: "Transcript saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

/** Transcribes up to 15 recordings per call; the page calls again while some remain. */
export async function transcribeAllAction(studyId: string): Promise<{ error?: string; ok?: string; at?: number; remaining?: number; done?: number; failed?: number }> {
  try {
    const user = await worker();
    const r = await metered(getDb(), user, "qual", "qual.transcribe", () => transcribeStudy(getDb(), user.id, studyId, 15));
    pages(studyId);
    return { ok: "Transcribed", at: Date.now(), ...r };
  } catch (err) {
    return known(err) ?? {};
  }
}

/** Translates up to 20 answers per call into English; the page calls again while some remain. */
export async function translateAllAction(studyId: string): Promise<{ error?: string; ok?: string; at?: number; remaining?: number; done?: number; failed?: number }> {
  try {
    const user = await worker();
    const r = await metered(getDb(), user, "qual", "qual.translate", () => translateStudy(getDb(), user.id, studyId, 20));
    pages(studyId);
    return { ok: "Translated", at: Date.now(), ...r };
  } catch (err) {
    return known(err) ?? {};
  }
}

export async function qualUpgradeAction(): Promise<QualState> {
  const user = await requireUser();
  await requestToolUpgrade(getDb(), "qual", user);
  return { ok: "sent" };
}

// ───────── analysis ─────────

export async function analysisSetupAction(studyId: string, researchQuestion: string, background: string): Promise<QualState> {
  try {
    const user = await requireUser();
    await saveSetup(getDb(), user.id, studyId, researchQuestion, background);
    revalidatePath(`/tools/qual/${studyId}/analyse`);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

/** Runs one batch of a phase; the page calls again until `finished`. */
export async function runPhaseAction(studyId: string, phase: Phase, restart = false): Promise<{ error?: string; done?: number; total?: number; finished?: boolean }> {
  try {
    const user = await worker();
    if (!PHASES.includes(phase)) throw new QualError("Unknown step.");
    const r = await metered(getDb(), user, "qual", `qual.${phase}`, () => runPhase(getDb(), user.id, studyId, phase, { restart }));
    if (r.finished) revalidatePath(`/tools/qual/${studyId}/analyse`);
    return r;
  } catch (err) {
    return (known(err) as { error?: string }) ?? {};
  }
}

export async function editAnalysisAction(studyId: string, edit: Parameters<typeof editAnalysis>[3]): Promise<QualState> {
  try {
    const user = await requireUser();
    await editAnalysis(getDb(), user.id, studyId, edit);
    revalidatePath(`/tools/qual/${studyId}/analyse`);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}
