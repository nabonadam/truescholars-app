/** Applies a verified Paystack transaction. Shared by the webhook and the redirect callback; idempotent. */

import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { paymentEvents } from "@/db/schema";
import type { VerifiedTransaction } from "@/lib/paystack";
import { fundMilestone } from "./escrow";

export type ApplyResult = "funded" | "already-funded" | "recorded" | "not-successful";

export async function applyVerifiedTransaction(db: DB, tx: VerifiedTransaction): Promise<ApplyResult> {
  const meta = tx.metadata;
  const status = tx.status === "success" ? "success" : "failed";

  const [existing] = await db.select().from(paymentEvents).where(eq(paymentEvents.reference, tx.reference));
  if (existing) {
    await db.update(paymentEvents).set({ status, raw: tx }).where(eq(paymentEvents.reference, tx.reference));
  } else {
    await db.insert(paymentEvents).values({
      reference: tx.reference,
      userId: meta?.userId ?? null,
      purpose: meta?.purpose ?? "unknown",
      milestoneId: meta?.milestoneId ?? null,
      amountMinor: tx.amount,
      currency: tx.currency,
      status,
      raw: tx,
    });
  }

  if (status !== "success") return "not-successful";
  if (meta?.purpose === "milestone" && meta.milestoneId) {
    return fundMilestone(db, {
      milestoneId: meta.milestoneId,
      amountMinor: tx.amount,
      currency: tx.currency,
      reference: tx.reference,
    });
  }
  return "recorded";
}
