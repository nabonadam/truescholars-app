"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { EscrowError } from "@/server/escrow";
import { FileError, saveUploads } from "@/server/files";
import { requireUser } from "@/server/guards";
import { approveDelivery, leaveReview, OrderRoomError, requestRevision, sendMessage, setStarred, submitDelivery } from "@/server/orderRoom";

export type FormState = { error?: string; ok?: number } | undefined;

const KNOWN = [OrderRoomError, FileError, EscrowError];
function asState(err: unknown): FormState {
  if (KNOWN.some((E) => err instanceof E)) return { error: (err as Error).message };
  throw err;
}

const uploadsOf = (form: FormData) => form.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);

export async function sendMessageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const orderId = String(form.get("orderId"));
  try {
    const db = getDb();
    const fileIds = await saveUploads(db, { orderId, ownerId: user.id, uploads: uploadsOf(form) });
    await sendMessage(db, { orderId, senderId: user.id, body: String(form.get("body") ?? ""), fileIds });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/messages");
  return { ok: Date.now() }; // changes each time so the form can reset
}

export async function toggleStarAction(form: FormData) {
  const user = await requireUser();
  await setStarred(getDb(), String(form.get("orderId")), user.id, form.get("starred") === "1");
  revalidatePath("/messages");
}

export async function deliverAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("EXPERT");
  const orderId = String(form.get("orderId"));
  try {
    const db = getDb();
    const fileIds = await saveUploads(db, { orderId, ownerId: user.id, uploads: uploadsOf(form) });
    await submitDelivery(db, { milestoneId: String(form.get("milestoneId")), expertId: user.id, note: String(form.get("note") ?? ""), fileIds });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: Date.now() };
}

export async function revisionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const orderId = String(form.get("orderId"));
  try {
    const db = getDb();
    const reason = String(form.get("reason") ?? "");
    await requestRevision(db, { milestoneId: String(form.get("milestoneId")), clientId: user.id, reason });
    await sendMessage(db, { orderId, senderId: user.id, body: `Revision requested: ${reason.trim()}` });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: Date.now() };
}

export async function approveAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const orderId = String(form.get("orderId"));
  try {
    await approveDelivery(getDb(), { milestoneId: String(form.get("milestoneId")), clientId: user.id });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: Date.now() };
}

export async function reviewAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const orderId = String(form.get("orderId"));
  try {
    await leaveReview(getDb(), { orderId, authorId: user.id, rating: Number(form.get("rating")), body: String(form.get("body") ?? "") });
  } catch (err) {
    return asState(err);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: Date.now() };
}
