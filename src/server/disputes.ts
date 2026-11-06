/**
 * Resolution centre. Either side can open a dispute on a milestone whose money is in escrow.
 * That freezes the milestone (no auto-approval, deliveries or release). The two sides can settle
 * it themselves by agreeing on a split; otherwise our team decides once the response window ends.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { disputes, milestones, orders, users } from "@/db/schema";
import { feeFor, formatMoney } from "@/lib/money";
import { escrowBalance, settleMilestone } from "./escrow";
import { evaluateLevel } from "./levels";
import { notify } from "./notifications";

export class DisputeError extends Error {}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export const RESPONSE_DAYS = 3;
const DAY = 86_400_000;

export const REASONS = {
  QUALITY: "The work doesn't meet what was agreed",
  NOT_DELIVERED: "Nothing has been delivered",
  LATE: "The work is very late",
  SCOPE: "We disagree about what's included",
  UNRESPONSIVE: "The other person stopped responding",
  OTHER: "Something else",
} as const;
export type ReasonCode = keyof typeof REASONS;

const DISPUTABLE = ["FUNDED", "DELIVERED", "REVISION_REQUESTED"];

export async function hasOpenDispute(db: DB | Tx, milestoneId: string) {
  const [d] = await db.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.milestoneId, milestoneId), eq(disputes.status, "OPEN")));
  return Boolean(d);
}

async function admins(db: DB) {
  return db.select({ id: users.id }).from(users).where(sql`'ADMIN' = any(${users.roles})`);
}

const firstName = (n: string | null | undefined) => n?.split(" ")[0] ?? "Someone";

export async function openDispute(db: DB, p: { milestoneId: string; userId: string; reason: string; details: string; evidence?: string[] }) {
  if (!(p.reason in REASONS)) throw new DisputeError("Choose what went wrong.");
  const details = p.details.trim();
  if (details.length < 30) throw new DisputeError("Explain what happened in a few sentences (at least 30 characters). It helps resolve things faster.");
  if (details.length > 3000) throw new DisputeError("Keep the explanation under 3,000 characters.");

  const { dispute, order } = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(milestones).where(eq(milestones.id, p.milestoneId)).for("update");
    if (!m) throw new DisputeError("Milestone not found.");
    const [order] = await tx.select().from(orders).where(eq(orders.id, m.orderId));
    if (order.clientId !== p.userId && order.expertId !== p.userId) throw new DisputeError("You're not part of this order.");
    if (!DISPUTABLE.includes(m.status)) throw new DisputeError("You can open a dispute only while this milestone's payment is held in escrow.");
    if (await hasOpenDispute(tx, m.id)) throw new DisputeError("There's already an open dispute for this milestone.");

    const [dispute] = await tx
      .insert(disputes)
      .values({
        orderId: order.id,
        milestoneId: m.id,
        openedById: p.userId,
        reason: p.reason,
        details,
        evidence: p.evidence ?? [],
        previousMilestoneStatus: m.status,
        respondBy: new Date(Date.now() + RESPONSE_DAYS * DAY),
      })
      .returning();
    await tx.update(milestones).set({ autoApproveAt: null }).where(eq(milestones.id, m.id));
    await tx.update(orders).set({ status: "DISPUTED" }).where(eq(orders.id, order.id));
    return { dispute, order };
  });

  const otherId = order.clientId === p.userId ? order.expertId : order.clientId;
  const [opener] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.userId));
  const link = `/disputes/${dispute.id}`;
  await notify(db, {
    userId: otherId,
    kind: "DISPUTE",
    title: `${firstName(opener?.name)} opened a dispute on “${order.title}”`,
    body: `${REASONS[p.reason as ReasonCode]}. The payment stays safely in escrow while you sort it out. Please respond within ${RESPONSE_DAYS} days.`,
    link,
    orderId: order.id,
  });
  for (const a of await admins(db)) {
    if (a.id === p.userId || a.id === otherId) continue;
    await notify(db, { userId: a.id, kind: "DISPUTE", title: `New dispute: ${order.title}`, body: REASONS[p.reason as ReasonCode], link });
  }
  return dispute;
}

async function loadOpen(db: DB | Tx, disputeId: string, lock = false) {
  const q = db.select().from(disputes).where(eq(disputes.id, disputeId));
  const [d] = lock ? await q.for("update") : await q;
  if (!d) throw new DisputeError("Dispute not found.");
  if (d.status !== "OPEN") throw new DisputeError("This dispute has already been closed.");
  const [order] = await db.select().from(orders).where(eq(orders.id, d.orderId));
  const [m] = await db.select().from(milestones).where(eq(milestones.id, d.milestoneId!));
  return { d, order, m };
}

/** Either side proposes how to split the escrow: `releaseMinor` to the expert, the rest back to the client. */
export async function makeOffer(db: DB, p: { disputeId: string; userId: string; releaseMinor: number }) {
  const { d, order, m } = await loadOpen(db, p.disputeId);
  if (order.clientId !== p.userId && order.expertId !== p.userId) throw new DisputeError("You're not part of this dispute.");
  if (!Number.isSafeInteger(p.releaseMinor) || p.releaseMinor < 0 || p.releaseMinor > m.amountMinor) throw new DisputeError("Choose an amount between nothing and the full milestone.");
  await db.update(disputes).set({ offerReleaseMinor: p.releaseMinor, offerById: p.userId, offerAt: new Date() }).where(eq(disputes.id, d.id));
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.userId));
  await notify(db, {
    userId: order.clientId === p.userId ? order.expertId : order.clientId,
    kind: "DISPUTE",
    title: `${firstName(me?.name)} proposed a settlement for “${order.title}”`,
    body: `${formatMoney(p.releaseMinor, order.currency)} to the expert and ${formatMoney(m.amountMinor - p.releaseMinor, order.currency)} back to the client. Accept it to close the dispute.`,
    link: `/disputes/${d.id}`,
    orderId: order.id,
  });
}

export async function acceptOffer(db: DB, p: { disputeId: string; userId: string }) {
  const { d, order } = await loadOpen(db, p.disputeId);
  if (order.clientId !== p.userId && order.expertId !== p.userId) throw new DisputeError("You're not part of this dispute.");
  if (d.offerReleaseMinor === null || !d.offerById) throw new DisputeError("There's no offer to accept yet.");
  if (d.offerById === p.userId) throw new DisputeError("You can't accept your own offer.");
  return finalize(db, { disputeId: d.id, releaseMinor: d.offerReleaseMinor, resolvedById: p.userId, decision: "Settled by agreement between the client and the expert." });
}

export async function adminResolve(db: DB, p: { disputeId: string; adminId: string; releaseMinor: number; decision: string }) {
  const decision = p.decision.trim();
  if (decision.length < 20) throw new DisputeError("Explain the decision to both sides (at least 20 characters).");
  return finalize(db, { disputeId: p.disputeId, releaseMinor: p.releaseMinor, resolvedById: p.adminId, decision });
}

/** Splits the escrow, closes the dispute and puts the order back on track, all in one transaction. */
async function finalize(db: DB, p: { disputeId: string; releaseMinor: number; resolvedById: string; decision: string }) {
  const out = await db.transaction(async (tx) => {
    const { d, order, m } = await loadOpen(tx, p.disputeId, true);
    const held = await escrowBalance(tx, m.id);
    if (!Number.isSafeInteger(p.releaseMinor) || p.releaseMinor < 0 || p.releaseMinor > held) throw new DisputeError("The amount must be between nothing and what's held in escrow.");
    await settleMilestone(tx as unknown as DB, { milestoneId: m.id, releaseMinor: p.releaseMinor });
    const status = p.releaseMinor === 0 ? "RESOLVED_REFUND" : p.releaseMinor === held ? "RESOLVED_RELEASE" : "RESOLVED_PARTIAL";
    await tx
      .update(disputes)
      .set({ status, releasedMinor: p.releaseMinor, refundedMinor: held - p.releaseMinor, decision: p.decision, resolvedById: p.resolvedById, resolvedAt: new Date() })
      .where(eq(disputes.id, d.id));
    await refreshOrderStatus(tx, order.id);
    return { d, order, held };
  });

  const { d, order, held } = out;
  const net = p.releaseMinor - feeFor(p.releaseMinor, order.feeBps);
  const link = `/disputes/${d.id}`;
  await notify(db, {
    userId: order.expertId,
    kind: "DISPUTE",
    title: `Dispute resolved: ${order.title}`,
    body: p.releaseMinor > 0 ? `${formatMoney(net, order.currency)} has been added to your earnings. ${p.decision}` : `The payment was returned to the client. ${p.decision}`,
    link,
    orderId: order.id,
  });
  await notify(db, {
    userId: order.clientId,
    kind: "DISPUTE",
    title: `Dispute resolved: ${order.title}`,
    body: held - p.releaseMinor > 0 ? `${formatMoney(held - p.releaseMinor, order.currency)} will be refunded to you. ${p.decision}` : `The payment was released to the expert. ${p.decision}`,
    link,
    orderId: order.id,
  });
  await evaluateLevel(db, order.expertId);
  return { releasedMinor: p.releaseMinor, refundedMinor: held - p.releaseMinor };
}

/** The opener can withdraw the dispute; the milestone carries on where it was. */
export async function cancelDispute(db: DB, p: { disputeId: string; userId: string }) {
  const { order } = await db.transaction(async (tx) => {
    const { d, order, m } = await loadOpen(tx, p.disputeId, true);
    if (d.openedById !== p.userId) throw new DisputeError("Only the person who opened the dispute can withdraw it.");
    await tx.update(disputes).set({ status: "CANCELLED", resolvedAt: new Date(), resolvedById: p.userId, decision: "Withdrawn by the person who opened it." }).where(eq(disputes.id, d.id));
    if (m.status === "DELIVERED") await tx.update(milestones).set({ autoApproveAt: new Date(Date.now() + RESPONSE_DAYS * DAY) }).where(eq(milestones.id, m.id));
    await refreshOrderStatus(tx, order.id);
    return { order };
  });
  await notify(db, {
    userId: order.clientId === p.userId ? order.expertId : order.clientId,
    kind: "DISPUTE",
    title: `Dispute withdrawn: ${order.title}`,
    body: "The order carries on as normal.",
    link: `/orders/${order.id}`,
    orderId: order.id,
  });
}

/** After a dispute closes, the order goes back to the status its milestones imply. */
async function refreshOrderStatus(tx: Tx, orderId: string) {
  const [o] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (o?.status !== "DISPUTED") return; // already completed or cancelled by the settlement
  const [open] = await tx.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.orderId, orderId), eq(disputes.status, "OPEN")));
  if (open) return;
  const ms = await tx.select({ status: milestones.status }).from(milestones).where(eq(milestones.orderId, orderId));
  await tx.update(orders).set({ status: ms.some((m) => m.status === "DELIVERED") ? "DELIVERED" : "ACTIVE" }).where(eq(orders.id, orderId));
}

// ───────────── Reading ─────────────

export async function getDispute(db: DB, disputeId: string, viewer: { id: string; roles: string[] }) {
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!d) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, d.orderId));
  const isAdmin = viewer.roles.includes("ADMIN");
  const role = order.clientId === viewer.id ? "client" : order.expertId === viewer.id ? "expert" : isAdmin ? "admin" : null;
  if (!role) return null;
  const [m] = d.milestoneId ? await db.select().from(milestones).where(eq(milestones.id, d.milestoneId)) : [];
  const people = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [order.clientId, order.expertId]));
  const name = (id: string) => people.find((x) => x.id === id)?.name ?? "Unknown";
  const held = m ? await escrowBalance(db, m.id) : 0;
  return { dispute: d, order, milestone: m ?? null, role, held, clientName: name(order.clientId), expertName: name(order.expertId), openerName: name(d.openedById), isAdmin };
}

export async function disputesForOrder(db: DB, orderId: string) {
  return db.select().from(disputes).where(eq(disputes.orderId, orderId)).orderBy(desc(disputes.createdAt));
}

export async function listDisputes(db: DB, filter: "open" | "closed" = "open") {
  const rows = await db
    .select({ dispute: disputes, title: orders.title, currency: orders.currency, clientId: orders.clientId, expertId: orders.expertId, amountMinor: milestones.amountMinor, milestoneTitle: milestones.title })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .leftJoin(milestones, eq(milestones.id, disputes.milestoneId))
    .where(filter === "open" ? eq(disputes.status, "OPEN") : sql`${disputes.status} <> 'OPEN'`)
    .orderBy(filter === "open" ? disputes.createdAt : desc(disputes.resolvedAt))
    .limit(200);
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.clientId, r.expertId]))];
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  const name = (id: string) => people.find((x) => x.id === id)?.name ?? "Unknown";
  return rows.map((r) => ({ ...r, clientName: name(r.clientId), expertName: name(r.expertId) }));
}

export const openDisputeCount = async (db: DB) => (await db.select({ id: disputes.id }).from(disputes).where(eq(disputes.status, "OPEN"))).length;
