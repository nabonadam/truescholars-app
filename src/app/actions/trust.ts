"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { toMinor } from "@/lib/money";
import { EscrowError } from "@/server/escrow";
import { acceptOffer, adminResolve, cancelDispute, DisputeError, makeOffer, openDispute } from "@/server/disputes";
import { FileError, saveUploads } from "@/server/files";
import { requireUser } from "@/server/guards";
import { markWithdrawalPaid, PayoutError, rejectWithdrawal, requestWithdrawal, savePayoutMethod } from "@/server/payouts";

export type TrustState = { error?: string; ok?: number } | undefined;

const KNOWN = [DisputeError, PayoutError, FileError, EscrowError];
const asState = (err: unknown): TrustState => {
  if (KNOWN.some((E) => err instanceof E)) return { error: (err as Error).message };
  throw err;
};
const cedis = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? toMinor(n) : NaN;
};

// ───────────── Disputes ─────────────

export async function openDisputeAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser();
  const orderId = String(form.get("orderId"));
  let id: string;
  try {
    const db = getDb();
    const evidence = await saveUploads(db, { orderId, ownerId: user.id, uploads: form.getAll("files").filter((v): v is File => v instanceof File && v.size > 0) });
    id = (await openDispute(db, { milestoneId: String(form.get("milestoneId")), userId: user.id, reason: String(form.get("reason") ?? ""), details: String(form.get("details") ?? ""), evidence })).id;
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/orders/${orderId}`);
  redirect(`/disputes/${id}`);
}

export async function offerAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser();
  const id = String(form.get("disputeId"));
  try {
    await makeOffer(getDb(), { disputeId: id, userId: user.id, releaseMinor: Number(form.get("releaseMinor")) });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/disputes/${id}`);
  return { ok: Date.now() };
}

export async function acceptOfferAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser();
  const id = String(form.get("disputeId"));
  try {
    await acceptOffer(getDb(), { disputeId: id, userId: user.id });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/disputes/${id}`);
  return { ok: Date.now() };
}

export async function cancelDisputeAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser();
  const id = String(form.get("disputeId"));
  try {
    await cancelDispute(getDb(), { disputeId: id, userId: user.id });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/disputes/${id}`);
  return { ok: Date.now() };
}

export async function adminResolveAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser("ADMIN");
  const id = String(form.get("disputeId"));
  try {
    await adminResolve(getDb(), { disputeId: id, adminId: user.id, releaseMinor: Number(form.get("releaseMinor")), decision: String(form.get("decision") ?? "") });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/disputes/${id}`);
  revalidatePath("/admin/disputes");
  return { ok: Date.now() };
}

// ───────────── Earnings ─────────────

export async function payoutMethodAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser("EXPERT");
  try {
    await savePayoutMethod(getDb(), user.id, {
      kind: String(form.get("kind") ?? ""),
      provider: String(form.get("provider") ?? ""),
      accountName: String(form.get("accountName") ?? ""),
      accountNumber: String(form.get("accountNumber") ?? ""),
    });
  } catch (err) {
    return asState(err);
  }
  revalidatePath("/earnings");
  return { ok: Date.now() };
}

export async function withdrawAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser("EXPERT");
  try {
    await requestWithdrawal(getDb(), { userId: user.id, amountMinor: cedis(form.get("amount")) });
  } catch (err) {
    return asState(err);
  }
  revalidatePath("/earnings");
  return { ok: Date.now() };
}

export async function markPaidAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser("ADMIN");
  try {
    await markWithdrawalPaid(getDb(), { withdrawalId: String(form.get("withdrawalId")), adminId: user.id, payoutReference: String(form.get("reference") ?? "") });
  } catch (err) {
    return asState(err);
  }
  revalidatePath("/admin/payouts");
  return { ok: Date.now() };
}

export async function rejectPayoutAction(_prev: TrustState, form: FormData): Promise<TrustState> {
  const user = await requireUser("ADMIN");
  try {
    await rejectWithdrawal(getDb(), { withdrawalId: String(form.get("withdrawalId")), adminId: user.id, note: String(form.get("note") ?? "") });
  } catch (err) {
    return asState(err);
  }
  revalidatePath("/admin/payouts");
  return { ok: Date.now() };
}
