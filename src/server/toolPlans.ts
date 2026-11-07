/** Paying for the AI tools: Paystack checkout for a plan, then access switched on exactly once. */

import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { paymentEvents, users } from "@/db/schema";
import { DAYS_PER_MONTH, PLANS, TOOL_PATH, isMonths, isPlan, planPrice } from "@/lib/plans";
import type { VerifiedTransaction } from "@/lib/paystack";
import { notify } from "./notifications";
import { grantAccess } from "./statsAccess";
import { grantToolAccess } from "./toolAccess";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Switches on the access a successful plan payment bought. Safe to call from both the webhook and the
 * return page: only the first call that claims the payment applies it.
 */
export async function applyToolPayment(db: DB, tx: VerifiedTransaction): Promise<"applied" | "already" | "invalid"> {
  const m = tx.metadata;
  if (!m || !isPlan(m.plan) || !isMonths(m.months)) return "invalid";
  if (tx.currency !== "GHS" || tx.amount < planPrice(m.plan, m.months)) {
    console.error("tool payment amount mismatch", tx.reference, tx.amount, m.plan, m.months);
    return "invalid";
  }
  const [claimed] = await db
    .update(paymentEvents)
    .set({ appliedAt: new Date() })
    .where(and(eq(paymentEvents.reference, tx.reference), isNull(paymentEvents.appliedAt)))
    .returning({ userId: paymentEvents.userId });
  if (!claimed) return "already";
  const userId = m.userId ?? claimed.userId;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId!));
  if (!u) return "invalid";
  const plan = PLANS[m.plan];
  const days = m.months * DAYS_PER_MONTH;
  const note = `Paid online · ${tx.reference}`;
  let until = new Date(0);
  for (const t of plan.tools) {
    const r = t === "stats" ? await grantAccess(db, u.email, days, note, new Date(), { quiet: true }) : await grantToolAccess(db, t, u.email, days, note, new Date(), { quiet: true });
    if (r.until > until) until = r.until;
  }
  await notify(db, {
    userId: userId!,
    kind: "TOOL_ACCESS",
    title: `Payment received: ${plan.name} is on`,
    body: `${m.months === 1 ? "One month" : `${m.months} months`} of access, until ${day(until)}. Thank you!`,
    link: TOOL_PATH[plan.tools[0]],
  });
  return "applied";
}
