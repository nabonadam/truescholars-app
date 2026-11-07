"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { LitError } from "@/server/lit";
import { addRetrieverByEmail, assignRetriever, declineRequest, setRetriever, unassignRetriever } from "@/server/litRetrieval";
import { endToolAccess, grantToolAccess } from "@/server/toolAccess";

type GrantState = { ok?: string; error?: string } | undefined;

export async function litGrantAction(_p: GrantState, form: FormData): Promise<GrantState> {
  await requireUser("ADMIN");
  try {
    const r = await grantToolAccess(getDb(), "lit", String(form.get("email") ?? ""), Number(form.get("days")), String(form.get("note") ?? ""));
    revalidatePath("/admin/lit");
    return { ok: `${r.name ?? "They"} now has Literature Review access until ${r.until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not grant access." };
  }
}

export async function litEndAccessAction(userId: string) {
  await requireUser("ADMIN");
  await endToolAccess(getDb(), "lit", userId);
  revalidatePath("/admin/lit");
}

// ───────── private literature retrieval: assigning dedicated experts ─────────

type AdminState = { ok?: string; error?: string; at?: number } | undefined;

async function run(fn: () => Promise<unknown>, ok: string): Promise<AdminState> {
  await requireUser("ADMIN");
  try {
    await fn();
  } catch (err) {
    if (err instanceof LitError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/retrieval");
  return { ok, at: Date.now() };
}

export async function assignRetrieverAction(_p: AdminState, form: FormData): Promise<AdminState> {
  const reviewId = String(form.get("reviewId") ?? "");
  return run(
    () => assignRetriever(getDb(), reviewId, { expertUserId: String(form.get("expert") ?? ""), priceMinor: Math.round(Number(form.get("price")) * 100), days: Number(form.get("days")), note: String(form.get("note") ?? "") }),
    "Assigned. The expert and the client have been notified; the client pays into escrow next.",
  );
}

export async function unassignRetrieverAction(reviewId: string) {
  return run(() => unassignRetriever(getDb(), reviewId), "Taken back. You can assign it again.");
}

export async function declineRequestAction(reviewId: string, reason: string) {
  return run(() => declineRequest(getDb(), reviewId, reason), "Declined. The client has been told why.");
}

export async function setRetrieverAction(userId: string, on: boolean) {
  return run(() => setRetriever(getDb(), userId, on), on ? "Added as a literature retriever." : "Removed from literature retrievers.");
}

export async function addRetrieverAction(_p: AdminState, form: FormData): Promise<AdminState> {
  return run(() => addRetrieverByEmail(getDb(), String(form.get("email") ?? "")), "Added as a literature retriever.");
}
