"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { PaperMeta } from "@/lib/cite";
import { requireUser } from "@/server/guards";
import { type Brief, LitError, addDoi, createReview, decidePaper, deletePaper, deleteReview, editPaperMeta, getReview, recheckPaper, recordPaper, setNote, updateReview } from "@/server/lit";
import { type Section, editParagraph, editSynthesis, makeOutline, readPapers, resetCard, runSynthesis, saveOutline, writeSection } from "@/server/litAnalysis";
import { EscrowError } from "@/server/escrow";
import { type SearchLog, acceptLiterature, askReplacements, cancelRequest, requestRetrieval, saveSearchLog, submitRetrieval } from "@/server/litRetrieval";
import { OrderRoomError } from "@/server/orderRoom";
import { QualError } from "@/server/qual";
import { canUse, requestToolUpgrade, toolAccessFor } from "@/server/toolAccess";
import { QuotaError, metered } from "@/server/usage";

export type LitState = { error?: string; ok?: string; at?: number } | undefined;

const ENDED = "Your free trial has ended. Your reviews and downloads are safe. Upgrade to keep reading and writing.";

/** AI steps and new papers need an active trial or access; viewing, editing and downloading never do. */
async function worker() {
  const user = await requireUser();
  if (!canUse(await toolAccessFor(getDb(), "lit", user))) throw new LitError(ENDED);
  return user;
}

const known = (err: unknown): { error: string } => {
  if (err instanceof LitError || err instanceof QualError || err instanceof QuotaError) return { error: err.message };
  throw err;
};
const pages = (id: string) => revalidatePath(`/tools/lit/${id}`, "layout");

export async function createReviewAction(_: LitState, form: FormData): Promise<LitState> {
  let id: string;
  try {
    const user = await worker();
    id = await createReview(getDb(), user.id, {
      title: String(form.get("title") ?? ""),
      researchQuestion: String(form.get("rq") ?? ""),
      style: String(form.get("style") ?? "apa"),
      brief: { purpose: String(form.get("purpose") ?? ""), discipline: String(form.get("discipline") ?? "") },
    });
  } catch (err) {
    return known(err);
  }
  revalidatePath("/tools/lit");
  redirect(`/tools/lit/${id}`);
}

export async function updateReviewAction(id: string, p: { title?: string; researchQuestion?: string; brief?: Brief; style?: string }): Promise<LitState> {
  try {
    const user = await requireUser();
    await updateReview(getDb(), user.id, id, p);
    pages(id);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function deleteReviewAction(id: string): Promise<LitState> {
  try {
    const user = await requireUser();
    await deleteReview(getDb(), user.id, id);
  } catch (err) {
    return known(err);
  }
  revalidatePath("/tools/lit");
  redirect("/tools/lit");
}

export async function decidePaperAction(reviewId: string, paperId: string, accept: boolean, reason = ""): Promise<LitState> {
  try {
    const user = await requireUser();
    await decidePaper(getDb(), user.id, paperId, accept, reason);
    pages(reviewId);
    return { ok: accept ? "Accepted" : "Rejected", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function deletePaperAction(reviewId: string, paperId: string): Promise<LitState> {
  try {
    const user = await requireUser();
    await deletePaper(getDb(), user.id, paperId);
    pages(reviewId);
    return { ok: "Removed", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function paperMetaAction(reviewId: string, paperId: string, meta: PaperMeta): Promise<LitState> {
  try {
    const user = await requireUser();
    await editPaperMeta(getDb(), user.id, paperId, meta);
    pages(reviewId);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function paperNoteAction(reviewId: string, paperId: string, note: string): Promise<LitState> {
  try {
    const user = await requireUser();
    await setNote(getDb(), user.id, paperId, note);
    pages(reviewId);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function recordPaperAction(reviewId: string, paperId: string, input: { meta: PaperMeta; summary: string; note: string; confirmed: boolean }): Promise<LitState & { mismatches?: string[] }> {
  try {
    const user = await requireUser();
    const r = await recordPaper(getDb(), user.id, paperId, input);
    pages(reviewId);
    return { ok: r.mismatches.length ? "Saved. Crossref's record differs on a few points: please check them against the paper." : r.found ? "Saved. Crossref's record matches your details." : "Saved. No Crossref record found, which is normal for reports, theses and some journals.", mismatches: r.mismatches, at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function recheckAction(reviewId: string, paperId: string): Promise<LitState> {
  try {
    const user = await requireUser();
    const v = await recheckPaper(getDb(), user.id, paperId);
    pages(reviewId);
    return v.found ? { ok: v.retracted ? "Found on Crossref, and it has been RETRACTED." : "Found on Crossref", at: Date.now() } : { error: v.message ?? "Not found on Crossref." };
  } catch (err) {
    return known(err);
  }
}

export async function addDoiAction(reviewId: string, doi: string, note = ""): Promise<LitState> {
  try {
    const user = await requireUser();
    const r = await getReview(getDb(), user.id, reviewId);
    if (r?.role === "owner") await worker();
    await addDoi(getDb(), user.id, reviewId, doi, { note });
    pages(reviewId);
    return { ok: "Added", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

// ───────── analysis ─────────

export async function readAction(reviewId: string, paperId?: string): Promise<{ error?: string; done?: number; total?: number; finished?: boolean; failed?: number }> {
  try {
    const user = await worker();
    if (paperId) await resetCard(getDb(), user.id, reviewId, paperId);
    const r = await metered(getDb(), user, "lit", "lit.read", ({ remaining }) => readPapers(getDb(), user.id, reviewId, { paperId, batch: Math.max(1, Math.min(2, remaining["lit.read"] ?? 2)) }));
    if (r.finished) pages(reviewId);
    return r;
  } catch (err) {
    return known(err);
  }
}

export async function synthesisAction(reviewId: string): Promise<LitState> {
  try {
    const user = await worker();
    await metered(getDb(), user, "lit", "lit.synthesis", () => runSynthesis(getDb(), user.id, reviewId));
    pages(reviewId);
    return { ok: "Done", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function editSynthesisAction(reviewId: string, edit: Parameters<typeof editSynthesis>[3]): Promise<LitState> {
  try {
    const user = await requireUser();
    await editSynthesis(getDb(), user.id, reviewId, edit);
    pages(reviewId);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function outlineAction(reviewId: string, targetWords: number): Promise<LitState> {
  try {
    const user = await worker();
    await metered(getDb(), user, "lit", "lit.outline", () => makeOutline(getDb(), user.id, reviewId, targetWords));
    pages(reviewId);
    return { ok: "Done", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function saveOutlineAction(reviewId: string, outline: Section[]): Promise<LitState> {
  try {
    const user = await requireUser();
    await saveOutline(getDb(), user.id, reviewId, outline);
    pages(reviewId);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function writeSectionAction(reviewId: string, sectionId: string): Promise<LitState> {
  try {
    const user = await worker();
    await metered(getDb(), user, "lit", "lit.write", () => writeSection(getDb(), user.id, reviewId, sectionId));
    return { ok: "Written", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function refreshReviewAction(reviewId: string) {
  pages(reviewId);
}

export async function editParagraphAction(reviewId: string, sectionId: string, index: number, text: string | null): Promise<LitState> {
  try {
    const user = await requireUser();
    await editParagraph(getDb(), user.id, reviewId, sectionId, index, text);
    pages(reviewId);
    return { ok: "Saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function litUpgradeAction(): Promise<LitState> {
  const user = await requireUser();
  await requestToolUpgrade(getDb(), "lit", user);
  return { ok: "sent" };
}

// ───────── literature retrieval by an expert ─────────

export async function requestRetrievalAction(reviewId: string, input: { brief: Brief; days: number }): Promise<LitState> {
  try {
    const user = await requireUser();
    await requestRetrieval(getDb(), user.id, reviewId, input);
    pages(reviewId);
    return { ok: "Sent privately to The True Scholars. We'll assign a dedicated expert.", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function cancelRequestAction(reviewId: string): Promise<LitState> {
  try {
    const user = await requireUser();
    await cancelRequest(getDb(), user.id, reviewId);
    pages(reviewId);
    return { ok: "Request withdrawn.", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function saveSearchLogAction(reviewId: string, log: Partial<SearchLog>): Promise<LitState> {
  try {
    const user = await requireUser();
    await saveSearchLog(getDb(), user.id, reviewId, log);
    pages(reviewId);
    return { ok: "Search log saved", at: Date.now() };
  } catch (err) {
    return known(err);
  }
}

export async function submitRetrievalAction(reviewId: string, note: string): Promise<LitState> {
  try {
    const user = await requireUser();
    await submitRetrieval(getDb(), user.id, reviewId, note);
    pages(reviewId);
    return { ok: "Delivered. The client has been asked to review your papers.", at: Date.now() };
  } catch (err) {
    if (err instanceof OrderRoomError) return { error: err.message };
    return known(err);
  }
}

export async function askReplacementsAction(reviewId: string, message: string): Promise<LitState> {
  try {
    const user = await requireUser();
    await askReplacements(getDb(), user.id, reviewId, message);
    pages(reviewId);
    return { ok: "Sent back to the expert for replacements.", at: Date.now() };
  } catch (err) {
    if (err instanceof OrderRoomError) return { error: err.message };
    return known(err);
  }
}

export async function acceptLiteratureAction(reviewId: string): Promise<LitState> {
  try {
    const user = await requireUser();
    await acceptLiterature(getDb(), user.id, reviewId);
  } catch (err) {
    if (err instanceof OrderRoomError || err instanceof EscrowError) return { error: err.message };
    return known(err);
  }
  pages(reviewId);
  redirect(`/tools/lit/${reviewId}/reading`);
}
