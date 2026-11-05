/**
 * Escrow operations against the database. Each one runs in a transaction, locks the milestone row,
 * checks the state machine, writes balanced ledger entries and updates statuses together.
 */

import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { ledgerEntries, milestones, orders } from "@/db/schema";
import { planFund, planPartial, planRefund, planRelease, type PlannedEntry } from "@/lib/ledger";

export class EscrowError extends Error {}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

async function writeEntries(tx: Tx, entries: PlannedEntry[]) {
  const transactionId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values(
    entries.map((e) => ({
      transactionId,
      account: e.account,
      type: e.type,
      amountMinor: e.amountMinor,
      userId: e.userId ?? null,
      milestoneId: e.milestoneId ?? null,
      reference: e.reference ?? null,
    })),
  );
  return transactionId;
}

async function lockMilestone(tx: Tx, milestoneId: string) {
  const [m] = await tx.select().from(milestones).where(eq(milestones.id, milestoneId)).for("update");
  if (!m) throw new EscrowError("Milestone not found");
  const [o] = await tx.select().from(orders).where(eq(orders.id, m.orderId));
  if (!o) throw new EscrowError("Order not found");
  return { milestone: m, order: o };
}

/** Current escrow held for a milestone, summed from the ledger. */
export async function escrowBalance(db: DB | Tx, milestoneId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, "ESCROW"), eq(ledgerEntries.milestoneId, milestoneId)));
  return Number(row?.total ?? 0);
}

/** An expert's withdrawable earnings, summed from the ledger. */
export async function expertAvailable(db: DB | Tx, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, "EXPERT_AVAILABLE"), eq(ledgerEntries.userId, userId)));
  return Number(row?.total ?? 0);
}

/**
 * Book a confirmed payment into escrow. Idempotent per payment reference: a second call with the
 * same reference (e.g. webhook + redirect both arriving) does nothing and returns "already-funded".
 */
export async function fundMilestone(
  db: DB,
  p: { milestoneId: string; amountMinor: number; currency: string; reference: string },
): Promise<"funded" | "already-funded"> {
  return db.transaction(async (tx) => {
    const { milestone, order } = await lockMilestone(tx, p.milestoneId);

    const [existing] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.reference, p.reference), eq(ledgerEntries.type, "FUND")))
      .limit(1);
    if (existing) return "already-funded";

    if (milestone.status !== "PENDING_FUNDING") throw new EscrowError(`Milestone is ${milestone.status}, not awaiting funding`);
    if (p.currency !== order.currency) throw new EscrowError(`Currency mismatch: paid ${p.currency}, order is ${order.currency}`);
    if (p.amountMinor !== milestone.amountMinor) {
      throw new EscrowError(`Amount mismatch: paid ${p.amountMinor}, milestone needs ${milestone.amountMinor}`);
    }

    await writeEntries(tx, planFund({ milestoneId: milestone.id, amountMinor: p.amountMinor, reference: p.reference }));
    await tx.update(milestones).set({ status: "FUNDED" }).where(eq(milestones.id, milestone.id));
    if (order.status === "AWAITING_PAYMENT") {
      await tx.update(orders).set({ status: "ACTIVE" }).where(eq(orders.id, order.id));
    }
    return "funded";
  });
}

/** Client approves a delivered milestone: escrow goes to the expert, minus the platform fee. */
export async function releaseMilestone(db: DB, p: { milestoneId: string; approvedBy: string }) {
  return db.transaction(async (tx) => {
    const { milestone, order } = await lockMilestone(tx, p.milestoneId);
    if (p.approvedBy !== order.clientId) throw new EscrowError("Only the client can approve this milestone");
    if (milestone.status !== "DELIVERED") throw new EscrowError(`Milestone is ${milestone.status}; it must be delivered first`);

    const held = await escrowBalance(tx, milestone.id);
    if (held !== milestone.amountMinor) throw new EscrowError(`Escrow holds ${held}, expected ${milestone.amountMinor}`);

    await writeEntries(
      tx,
      planRelease({
        milestoneId: milestone.id,
        expertId: order.expertId,
        amountMinor: held,
        feeBps: order.feeBps,
        reference: `release:${milestone.id}`,
      }),
    );
    await tx.update(milestones).set({ status: "APPROVED" }).where(eq(milestones.id, milestone.id));
    return { releasedMinor: held };
  });
}

/** Admin decision on a dispute, or a cancellation before delivery: refund the escrow to the client. */
export async function refundMilestone(db: DB, p: { milestoneId: string }) {
  return db.transaction(async (tx) => {
    const { milestone } = await lockMilestone(tx, p.milestoneId);
    if (milestone.status === "APPROVED" || milestone.status === "REFUNDED") {
      throw new EscrowError(`Milestone is already ${milestone.status}`);
    }
    const held = await escrowBalance(tx, milestone.id);
    if (held <= 0) throw new EscrowError("Nothing is held in escrow for this milestone");

    await writeEntries(tx, planRefund({ milestoneId: milestone.id, amountMinor: held, reference: `refund:${milestone.id}` }));
    await tx.update(milestones).set({ status: "REFUNDED" }).where(eq(milestones.id, milestone.id));
    return { refundedMinor: held };
  });
}

/** Admin dispute decision: release part of the escrow to the expert and refund the rest. */
export async function settleMilestone(db: DB, p: { milestoneId: string; releaseMinor: number }) {
  return db.transaction(async (tx) => {
    const { milestone, order } = await lockMilestone(tx, p.milestoneId);
    if (milestone.status === "APPROVED" || milestone.status === "REFUNDED") {
      throw new EscrowError(`Milestone is already ${milestone.status}`);
    }
    const held = await escrowBalance(tx, milestone.id);
    await writeEntries(
      tx,
      planPartial({
        milestoneId: milestone.id,
        expertId: order.expertId,
        escrowMinor: held,
        releaseMinor: p.releaseMinor,
        feeBps: order.feeBps,
        reference: `settle:${milestone.id}`,
      }),
    );
    const status = p.releaseMinor > 0 ? "APPROVED" : "REFUNDED";
    await tx.update(milestones).set({ status }).where(eq(milestones.id, milestone.id));
    return { releasedMinor: p.releaseMinor, refundedMinor: held - p.releaseMinor };
  });
}
