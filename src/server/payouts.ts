/**
 * Earnings and withdrawals. Experts save a Mobile Money or bank account, then ask to withdraw;
 * the amount is set aside in the ledger straight away (PAYOUT_PENDING) so it can't be spent twice.
 * Our team sends the money and marks it paid, or rejects it and the money returns to the balance.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { expertProfiles, ledgerEntries, milestones, orders, payoutMethods, users, withdrawals, type PayoutSnapshot } from "@/db/schema";
import { planPayoutHold, planPayoutPaid, planPayoutReturn } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { expertAvailable, writeEntries } from "./escrow";
import { notify } from "./notifications";

export class PayoutError extends Error {}

export const MIN_WITHDRAWAL_MINOR = 5_000; // GH₵50
export const MOMO_PROVIDERS = ["MTN Mobile Money", "Telecel Cash", "AirtelTigo Money"] as const;

export function validatePayoutMethod(input: { kind: string; provider: string; accountName: string; accountNumber: string }): PayoutSnapshot {
  const accountName = input.accountName.trim().replace(/\s+/g, " ");
  const provider = input.provider.trim();
  if (accountName.length < 3 || accountName.length > 80) throw new PayoutError("Enter the account holder's full name, as registered.");
  if (input.kind === "momo") {
    if (!(MOMO_PROVIDERS as readonly string[]).includes(provider)) throw new PayoutError("Choose your Mobile Money network.");
    let n = input.accountNumber.replace(/[\s-]/g, "");
    if (/^\+?233\d{9}$/.test(n)) n = `0${n.slice(-9)}`;
    if (!/^0\d{9}$/.test(n)) throw new PayoutError("Enter a 10-digit Ghana mobile number, like 024 123 4567.");
    return { kind: "momo", provider, accountName, accountNumber: n };
  }
  if (input.kind === "bank") {
    if (provider.length < 3 || provider.length > 80) throw new PayoutError("Enter your bank's name.");
    const n = input.accountNumber.replace(/[\s-]/g, "");
    if (!/^\d{8,20}$/.test(n)) throw new PayoutError("Enter your account number (digits only).");
    return { kind: "bank", provider, accountName, accountNumber: n };
  }
  throw new PayoutError("Choose Mobile Money or bank.");
}

export async function savePayoutMethod(db: DB, userId: string, input: { kind: string; provider: string; accountName: string; accountNumber: string }) {
  const m = validatePayoutMethod(input);
  await db
    .insert(payoutMethods)
    .values({ userId, ...m })
    .onConflictDoUpdate({ target: payoutMethods.userId, set: { ...m, updatedAt: new Date() } });
  return m;
}

export async function getPayoutMethod(db: DB, userId: string) {
  const [m] = await db.select().from(payoutMethods).where(eq(payoutMethods.userId, userId));
  return m ?? null;
}

/** "024 ••• 4567": enough to recognise the account without showing all of it. */
export const maskAccount = (n: string) => (n.length <= 4 ? n : `${n.slice(0, 3)} ••• ${n.slice(-4)}`);

export async function requestWithdrawal(db: DB, p: { userId: string; amountMinor: number }) {
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor < MIN_WITHDRAWAL_MINOR) throw new PayoutError(`The minimum withdrawal is ${formatMoney(MIN_WITHDRAWAL_MINOR)}.`);
  const w = await db.transaction(async (tx) => {
    // One withdrawal at a time per expert: lock their profile row while we check the balance.
    const [profile] = await tx.select({ id: expertProfiles.id }).from(expertProfiles).where(eq(expertProfiles.userId, p.userId)).for("update");
    if (!profile) throw new PayoutError("Only experts can withdraw earnings.");
    const [method] = await tx.select().from(payoutMethods).where(eq(payoutMethods.userId, p.userId));
    if (!method) throw new PayoutError("Add your Mobile Money or bank details first.");
    const [pending] = await tx.select({ id: withdrawals.id }).from(withdrawals).where(and(eq(withdrawals.userId, p.userId), eq(withdrawals.status, "REQUESTED")));
    if (pending) throw new PayoutError("You already have a withdrawal being processed. You can request another once it's paid.");
    const available = await expertAvailable(tx, p.userId);
    if (p.amountMinor > available) throw new PayoutError(`You can withdraw up to ${formatMoney(available)}.`);
    const snapshot: PayoutSnapshot = { kind: method.kind, provider: method.provider, accountName: method.accountName, accountNumber: method.accountNumber };
    const [w] = await tx.insert(withdrawals).values({ userId: p.userId, amountMinor: p.amountMinor, method: snapshot }).returning();
    await writeEntries(tx, planPayoutHold({ expertId: p.userId, amountMinor: p.amountMinor, availableMinor: available, reference: `wd:${w.id}:hold` }));
    return w;
  });
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.userId));
  const admins = await db.select({ id: users.id }).from(users).where(sql`'ADMIN' = any(${users.roles})`);
  for (const a of admins) {
    await notify(db, { userId: a.id, kind: "PAYOUT", title: `Withdrawal request: ${formatMoney(w.amountMinor)}`, body: `${me?.name ?? "An expert"} · ${w.method.provider}`, link: "/admin/payouts" });
  }
  return w;
}

async function lockRequested(tx: Parameters<Parameters<DB["transaction"]>[0]>[0], withdrawalId: string) {
  const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
  if (!w) throw new PayoutError("Withdrawal not found.");
  if (w.status !== "REQUESTED") throw new PayoutError("This withdrawal has already been handled.");
  return w;
}

export async function markWithdrawalPaid(db: DB, p: { withdrawalId: string; adminId: string; payoutReference: string }) {
  const ref = p.payoutReference.trim();
  if (ref.length < 4) throw new PayoutError("Enter the transaction ID from the Mobile Money or bank transfer.");
  const w = await db.transaction(async (tx) => {
    const w = await lockRequested(tx, p.withdrawalId);
    await writeEntries(tx, planPayoutPaid({ expertId: w.userId, amountMinor: w.amountMinor, reference: `wd:${w.id}:paid` }));
    await tx.update(withdrawals).set({ status: "PAID", payoutReference: ref, decidedById: p.adminId, decidedAt: new Date() }).where(eq(withdrawals.id, w.id));
    return w;
  });
  await notify(db, {
    userId: w.userId,
    kind: "PAYOUT",
    title: `${formatMoney(w.amountMinor)} is on its way`,
    body: `Sent to your ${w.method.provider} account ${maskAccount(w.method.accountNumber)}. Reference: ${ref}.`,
    link: "/earnings",
  });
}

export async function rejectWithdrawal(db: DB, p: { withdrawalId: string; adminId: string; note: string }) {
  const note = p.note.trim();
  if (note.length < 10) throw new PayoutError("Tell the expert why (at least 10 characters).");
  const w = await db.transaction(async (tx) => {
    const w = await lockRequested(tx, p.withdrawalId);
    await writeEntries(tx, planPayoutReturn({ expertId: w.userId, amountMinor: w.amountMinor, reference: `wd:${w.id}:return` }));
    await tx.update(withdrawals).set({ status: "REJECTED", note, decidedById: p.adminId, decidedAt: new Date() }).where(eq(withdrawals.id, w.id));
    return w;
  });
  await notify(db, { userId: w.userId, kind: "PAYOUT", title: "Withdrawal not processed", body: `${formatMoney(w.amountMinor)} is back in your balance. ${note}`, link: "/earnings" });
}

// ───────────── Reading ─────────────

const sumWhere = (db: DB, where: ReturnType<typeof and>) =>
  db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
    .from(ledgerEntries)
    .where(where)
    .then((r) => Number(r[0]?.total ?? 0));

/** Everything the earnings page needs, all derived from the ledger. */
export async function earningsSummary(db: DB, userId: string, now = new Date()) {
  const myMilestones = db.select({ id: milestones.id }).from(milestones).innerJoin(orders, eq(orders.id, milestones.orderId)).where(eq(orders.expertId, userId));
  const [available, pendingPayout, inEscrow, earned, withdrawn] = await Promise.all([
    expertAvailable(db, userId),
    sumWhere(db, and(eq(ledgerEntries.account, "PAYOUT_PENDING"), eq(ledgerEntries.userId, userId))),
    sumWhere(db, and(eq(ledgerEntries.account, "ESCROW"), inArray(ledgerEntries.milestoneId, myMilestones))),
    sumWhere(db, and(eq(ledgerEntries.account, "EXPERT_AVAILABLE"), eq(ledgerEntries.userId, userId), eq(ledgerEntries.type, "RELEASE"))),
    db
      .select({ total: sql<string>`coalesce(sum(${withdrawals.amountMinor}), 0)` })
      .from(withdrawals)
      .where(and(eq(withdrawals.userId, userId), eq(withdrawals.status, "PAID")))
      .then((r) => Number(r[0]?.total ?? 0)),
  ]);

  // Earnings released to the expert, per month, for the last six months.
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const monthlyRows = await db
    .select({ month: sql<string>`to_char(${ledgerEntries.createdAt}, 'YYYY-MM')`, total: sql<string>`sum(${ledgerEntries.amountMinor})` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, "EXPERT_AVAILABLE"), eq(ledgerEntries.userId, userId), eq(ledgerEntries.type, "RELEASE"), sql`${ledgerEntries.createdAt} >= ${since}`))
    .groupBy(sql`1`);
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { key, label: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), totalMinor: Number(monthlyRows.find((r) => r.month === key)?.total ?? 0) };
  });

  return { available, pendingPayout, inEscrow, earned, withdrawn, monthly };
}

/** The expert's money history: earnings from each order, withdrawals and returns, newest first. */
export async function earningsHistory(db: DB, userId: string, limit = 50) {
  const rows = await db
    .select({ id: ledgerEntries.id, type: ledgerEntries.type, amountMinor: ledgerEntries.amountMinor, reference: ledgerEntries.reference, createdAt: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, "EXPERT_AVAILABLE"), eq(ledgerEntries.userId, userId)))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(limit);
  const msIds = rows.map((r) => r.reference?.match(/^(?:release|settle):(.+)$/)?.[1]).filter((x): x is string => Boolean(x));
  const titles = msIds.length
    ? await db.select({ id: milestones.id, title: milestones.title, orderId: orders.id, orderTitle: orders.title }).from(milestones).innerJoin(orders, eq(orders.id, milestones.orderId)).where(inArray(milestones.id, msIds))
    : [];
  return rows.map((r) => {
    const msId = r.reference?.match(/^(?:release|settle):(.+)$/)?.[1];
    const t = titles.find((x) => x.id === msId);
    const label =
      r.type === "RELEASE" ? (r.reference?.startsWith("settle:") ? "Dispute settlement" : "Payment released") : r.type === "WITHDRAWAL" ? "Withdrawal" : r.type === "REVERSAL" ? "Withdrawal returned" : r.type;
    return { ...r, label, orderId: t?.orderId ?? null, orderTitle: t?.orderTitle ?? null };
  });
}

export async function listWithdrawalsForUser(db: DB, userId: string) {
  return db.select().from(withdrawals).where(eq(withdrawals.userId, userId)).orderBy(desc(withdrawals.createdAt)).limit(20);
}

export async function listWithdrawals(db: DB, status: "REQUESTED" | "DONE" = "REQUESTED") {
  return db
    .select({ w: withdrawals, name: users.name, email: users.email })
    .from(withdrawals)
    .innerJoin(users, eq(users.id, withdrawals.userId))
    .where(status === "REQUESTED" ? eq(withdrawals.status, "REQUESTED") : sql`${withdrawals.status} <> 'REQUESTED'`)
    .orderBy(status === "REQUESTED" ? withdrawals.createdAt : desc(withdrawals.decidedAt))
    .limit(200);
}
