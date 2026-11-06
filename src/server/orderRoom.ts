/** The order room: messages, deliveries, revisions, approvals, auto-approval and reviews. */

import { and, asc, avg, count, desc, eq, gt, inArray, isNotNull, lte, ne, or, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { deliveries, messages, milestones, orders, reviews, threadMembers, threads, users } from "@/db/schema";
import { releaseMilestone } from "./escrow";
import { notify } from "./notifications";

export class OrderRoomError extends Error {}

/** Days the client has to respond to a delivery before it is approved automatically. */
export const AUTO_APPROVE_DAYS = 3;

const CONTACT_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?\d[\s-]?){9,}|wa\.me\/|whatsapp/i;

/** Flags messages that share contact details, so admins can spot attempts to move off-platform. */
export function looksLikeContactDetails(text: string) {
  return CONTACT_PATTERN.test(text);
}

async function loadOrder(db: DB, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new OrderRoomError("Order not found");
  return order;
}

function assertParticipant(order: { clientId: string; expertId: string }, userId: string) {
  if (order.clientId !== userId && order.expertId !== userId) throw new OrderRoomError("You're not part of this order");
}

// ───────────── Messages ─────────────

export async function sendMessage(db: DB, p: { orderId: string; senderId: string; body: string; fileIds?: string[] }) {
  const order = await loadOrder(db, p.orderId);
  assertParticipant(order, p.senderId);
  const body = p.body.trim();
  if (!body && !(p.fileIds?.length)) throw new OrderRoomError("Write a message or attach a file.");
  if (body.length > 5000) throw new OrderRoomError("Messages are limited to 5,000 characters.");
  const [thread] = await db.select().from(threads).where(eq(threads.orderId, p.orderId));
  if (!thread) throw new OrderRoomError("This order has no message thread");
  const [msg] = await db
    .insert(messages)
    .values({ threadId: thread.id, senderId: p.senderId, body, files: p.fileIds ?? [], flagged: looksLikeContactDetails(body) })
    .returning();
  const recipient = p.senderId === order.clientId ? order.expertId : order.clientId;
  const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.senderId));
  await notify(db, {
    userId: recipient,
    kind: "MESSAGE",
    title: `New message from ${sender?.name?.split(" ")[0] ?? "your contact"}`,
    body: body ? (body.length > 140 ? `${body.slice(0, 140)}…` : body) : "Sent you a file.",
    link: `/orders/${order.id}`,
    orderId: order.id,
  });
  return msg;
}

export async function listMessages(db: DB, orderId: string) {
  const [thread] = await db.select().from(threads).where(eq(threads.orderId, orderId));
  if (!thread) return [];
  return db
    .select({ id: messages.id, body: messages.body, files: messages.files, flagged: messages.flagged, createdAt: messages.createdAt, senderId: messages.senderId, senderName: users.name })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.threadId, thread.id))
    .orderBy(asc(messages.createdAt));
}

/** Records that this user has seen the order's conversation up to now. */
export async function markThreadRead(db: DB, orderId: string, userId: string) {
  const [thread] = await db.select({ id: threads.id }).from(threads).where(eq(threads.orderId, orderId));
  if (!thread) return;
  await db
    .update(threadMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(threadMembers.threadId, thread.id), eq(threadMembers.userId, userId)));
}

/** Unread messages from the other person, per order, for this user. */
export async function unreadByOrder(db: DB, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ orderId: threads.orderId, n: count(messages.id) })
    .from(threadMembers)
    .innerJoin(threads, eq(threads.id, threadMembers.threadId))
    .innerJoin(messages, eq(messages.threadId, threads.id))
    .where(
      and(
        eq(threadMembers.userId, userId),
        ne(messages.senderId, userId),
        or(isNull(threadMembers.lastReadAt), gt(messages.createdAt, threadMembers.lastReadAt)),
      ),
    )
    .groupBy(threads.orderId);
  return new Map(rows.filter((r) => r.orderId).map((r) => [r.orderId as string, Number(r.n)]));
}

/** A cheap fingerprint of an order's live state; changes whenever a message or status changes. */
export async function orderPulse(db: DB, orderId: string): Promise<string> {
  const [o] = await db.select({ status: orders.status, updatedAt: orders.updatedAt }).from(orders).where(eq(orders.id, orderId));
  if (!o) return "gone";
  const [last] = await db
    .select({ id: messages.id, n: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(eq(threads.orderId, orderId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const ms = await db.select({ s: milestones.status, u: milestones.updatedAt }).from(milestones).where(eq(milestones.orderId, orderId));
  return [o.status, o.updatedAt.getTime(), last?.id ?? "-", last?.n ?? 0, ...ms.map((m) => `${m.s}:${m.u.getTime()}`)].join("|");
}

/** Inbox: every conversation the user is in, with the latest message and unread count, newest first. */
export async function listConversations(db: DB, userId: string) {
  const mine = await db
    .select({ threadId: threads.id, orderId: threads.orderId, title: orders.title, clientId: orders.clientId, expertId: orders.expertId, status: orders.status, createdAt: orders.createdAt })
    .from(threadMembers)
    .innerJoin(threads, eq(threads.id, threadMembers.threadId))
    .innerJoin(orders, eq(orders.id, threads.orderId))
    .where(eq(threadMembers.userId, userId));
  if (mine.length === 0) return [];

  const threadIds = mine.map((t) => t.threadId);
  const latest = await db
    .selectDistinctOn([messages.threadId], { threadId: messages.threadId, body: messages.body, files: messages.files, senderId: messages.senderId, createdAt: messages.createdAt })
    .from(messages)
    .where(inArray(messages.threadId, threadIds))
    .orderBy(messages.threadId, desc(messages.createdAt));
  const otherIds = [...new Set(mine.map((t) => (t.clientId === userId ? t.expertId : t.clientId)))];
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, otherIds));
  const unread = await unreadByOrder(db, userId);

  return mine
    .map((t) => {
      const otherId = t.clientId === userId ? t.expertId : t.clientId;
      const last = latest.find((l) => l.threadId === t.threadId) ?? null;
      return {
        orderId: t.orderId as string,
        title: t.title,
        status: t.status,
        role: t.clientId === userId ? ("buying" as const) : ("selling" as const),
        otherName: people.find((p) => p.id === otherId)?.name ?? "Unknown",
        last: last && { body: last.body || (last.files.length ? "Sent a file" : ""), mine: last.senderId === userId, at: last.createdAt },
        unread: unread.get(t.orderId as string) ?? 0,
        sortAt: last?.createdAt ?? t.createdAt,
      };
    })
    .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
}

/** Flagged messages for admin review, newest first. */
export async function listFlaggedMessages(db: DB, limit = 100) {
  return db
    .select({
      id: messages.id,
      body: messages.body,
      createdAt: messages.createdAt,
      senderName: users.name,
      senderEmail: users.email,
      orderId: threads.orderId,
      orderTitle: orders.title,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .leftJoin(orders, eq(orders.id, threads.orderId))
    .where(eq(messages.flagged, true))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

// ───────────── Deliveries, revisions, approval ─────────────

/** Expert delivers work for a funded milestone (or after a revision request). */
export async function submitDelivery(db: DB, p: { milestoneId: string; expertId: string; note: string; fileIds: string[] }) {
  const result = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(milestones).where(eq(milestones.id, p.milestoneId)).for("update");
    if (!m) throw new OrderRoomError("Milestone not found");
    const [order] = await tx.select().from(orders).where(eq(orders.id, m.orderId));
    if (order.expertId !== p.expertId) throw new OrderRoomError("Only the expert can deliver this order");
    if (m.status !== "FUNDED" && m.status !== "REVISION_REQUESTED") {
      throw new OrderRoomError(m.status === "PENDING_FUNDING" ? "Wait until the client has paid into escrow." : "This milestone can't receive a delivery now.");
    }
    if (!p.note.trim()) throw new OrderRoomError("Add a short note explaining what you're delivering.");
    if (p.fileIds.length === 0) throw new OrderRoomError("Attach at least one file.");

    await tx.insert(deliveries).values({ milestoneId: m.id, note: p.note.trim(), files: p.fileIds });
    const autoApproveAt = new Date(Date.now() + AUTO_APPROVE_DAYS * 86_400_000);
    await tx.update(milestones).set({ status: "DELIVERED", autoApproveAt }).where(eq(milestones.id, m.id));
    await tx.update(orders).set({ status: "DELIVERED" }).where(eq(orders.id, order.id));
    return { autoApproveAt, order };
  });
  await notify(db, {
    userId: result.order.clientId,
    kind: "DELIVERED",
    title: `Your work is ready: ${result.order.title}`,
    body: `Review the delivery and approve it, or ask for a revision. It's approved automatically in ${AUTO_APPROVE_DAYS} days if you don't respond.`,
    link: `/orders/${result.order.id}`,
    orderId: result.order.id,
  });
  return { autoApproveAt: result.autoApproveAt };
}

/** Client asks for changes, within the package's revision allowance. */
export async function requestRevision(db: DB, p: { milestoneId: string; clientId: string; reason: string }) {
  const result = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(milestones).where(eq(milestones.id, p.milestoneId)).for("update");
    if (!m) throw new OrderRoomError("Milestone not found");
    const [order] = await tx.select().from(orders).where(eq(orders.id, m.orderId));
    if (order.clientId !== p.clientId) throw new OrderRoomError("Only the client can request a revision");
    if (m.status !== "DELIVERED") throw new OrderRoomError("You can only request a revision after a delivery.");
    if (m.revisionsUsed >= m.revisionsAllowed) {
      throw new OrderRoomError("You've used all the revisions in this package. Approve the work, or message the expert to agree next steps.");
    }
    if (!p.reason.trim()) throw new OrderRoomError("Tell the expert what to change.");

    await tx
      .update(milestones)
      .set({ status: "REVISION_REQUESTED", revisionsUsed: m.revisionsUsed + 1, autoApproveAt: null })
      .where(eq(milestones.id, m.id));
    await tx.update(orders).set({ status: "ACTIVE" }).where(eq(orders.id, order.id));
    return { revisionsLeft: m.revisionsAllowed - m.revisionsUsed - 1, order };
  });
  await notify(db, {
    userId: result.order.expertId,
    kind: "REVISION_REQUESTED",
    title: `Revision requested: ${result.order.title}`,
    body: p.reason.trim().slice(0, 200),
    link: `/orders/${result.order.id}`,
    orderId: result.order.id,
  });
  return { revisionsLeft: result.revisionsLeft };
}

/** Client approves: releases escrow to the expert (minus fee); the order completes when all milestones settle. */
export function approveDelivery(db: DB, p: { milestoneId: string; clientId: string }) {
  return releaseMilestone(db, { milestoneId: p.milestoneId, approvedBy: p.clientId });
}

/** Approves every delivery whose auto-approve time has passed. Safe to run repeatedly. */
export async function autoApproveDue(db: DB, now = new Date()) {
  const due = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.status, "DELIVERED"), isNotNull(milestones.autoApproveAt), lte(milestones.autoApproveAt, now)));
  let approved = 0;
  for (const m of due) {
    try {
      await releaseMilestone(db, { milestoneId: m.id, auto: true });
      approved++;
    } catch (err) {
      console.error("auto-approve failed", m.id, err);
    }
  }
  return { approved, checked: due.length };
}

export async function listDeliveries(db: DB, milestoneIds: string[]) {
  if (milestoneIds.length === 0) return [];
  return db.select().from(deliveries).where(inArray(deliveries.milestoneId, milestoneIds)).orderBy(desc(deliveries.createdAt));
}

// ───────────── Reviews ─────────────

export async function leaveReview(db: DB, p: { orderId: string; authorId: string; rating: number; body: string }) {
  const order = await loadOrder(db, p.orderId);
  assertParticipant(order, p.authorId);
  if (order.status !== "COMPLETED") throw new OrderRoomError("You can review once the order is completed.");
  if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 5) throw new OrderRoomError("Choose a rating from 1 to 5 stars.");
  const subjectId = p.authorId === order.clientId ? order.expertId : order.clientId;
  const [existing] = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.orderId, order.id), eq(reviews.authorId, p.authorId)));
  if (existing) throw new OrderRoomError("You've already reviewed this order.");
  await db.insert(reviews).values({ orderId: order.id, authorId: p.authorId, subjectId, rating: p.rating, body: p.body.trim() || null });
  await notify(db, {
    userId: subjectId,
    kind: "REVIEW_RECEIVED",
    title: `You received a ${p.rating}-star review`,
    body: p.body.trim() ? p.body.trim().slice(0, 200) : `For "${order.title}".`,
    link: `/orders/${order.id}`,
    orderId: order.id,
  });
}

export async function reviewsForOrder(db: DB, orderId: string) {
  return db.select().from(reviews).where(eq(reviews.orderId, orderId));
}

/** Average rating and recent written reviews an expert received from clients. */
export async function expertReviewSummary(db: DB, expertUserId: string, limit = 5) {
  const clientReviews = and(eq(reviews.subjectId, expertUserId), eq(orders.expertId, expertUserId));
  const [agg] = await db
    .select({ average: avg(reviews.rating), total: count(reviews.id) })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(clientReviews);
  const recent = await db
    .select({ rating: reviews.rating, body: reviews.body, createdAt: reviews.createdAt, author: users.name })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(and(clientReviews, isNotNull(reviews.body)))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
  return { average: agg?.average ? Number(agg.average) : null, total: Number(agg?.total ?? 0), recent };
}
