/**
 * Pure escrow ledger rules (no database). Every movement is a list of entries that sums to zero:
 *
 *   fund      EXTERNAL −a            → ESCROW(milestone) +a
 *   release   ESCROW(milestone) −a   → EXPERT_AVAILABLE(expert) +(a−fee), PLATFORM_FEES +fee
 *   refund    ESCROW(milestone) −a   → EXTERNAL +a
 *   withdraw  EXPERT_AVAILABLE −a    → EXTERNAL +a
 *   payout    EXPERT_AVAILABLE −a    → PAYOUT_PENDING +a   (requested; money set aside)
 *             PAYOUT_PENDING −a      → EXTERNAL +a         (paid out) or → EXPERT_AVAILABLE +a (rejected)
 */

import { assertMinor, feeFor } from "./money";

export type LedgerAccount = "EXTERNAL" | "ESCROW" | "EXPERT_AVAILABLE" | "PLATFORM_FEES" | "PAYOUT_PENDING";
export type LedgerEntryType = "FUND" | "RELEASE" | "FEE" | "REFUND" | "WITHDRAWAL" | "REVERSAL";

export interface PlannedEntry {
  account: LedgerAccount;
  type: LedgerEntryType;
  amountMinor: number; // signed
  userId?: string;
  milestoneId?: string;
  reference?: string;
}

export function assertBalanced(entries: PlannedEntry[]): void {
  const sum = entries.reduce((s, e) => s + e.amountMinor, 0);
  if (sum !== 0) throw new Error(`Ledger movement does not balance (sum ${sum})`);
}

export function planFund(p: { milestoneId: string; amountMinor: number; reference: string }): PlannedEntry[] {
  assertMinor(p.amountMinor);
  const entries: PlannedEntry[] = [
    { account: "EXTERNAL", type: "FUND", amountMinor: -p.amountMinor, reference: p.reference },
    { account: "ESCROW", type: "FUND", amountMinor: p.amountMinor, milestoneId: p.milestoneId, reference: p.reference },
  ];
  assertBalanced(entries);
  return entries;
}

export function planRelease(p: {
  milestoneId: string;
  expertId: string;
  amountMinor: number;
  feeBps: number;
  reference: string;
}): PlannedEntry[] {
  assertMinor(p.amountMinor);
  const fee = feeFor(p.amountMinor, p.feeBps);
  const entries: PlannedEntry[] = [
    { account: "ESCROW", type: "RELEASE", amountMinor: -p.amountMinor, milestoneId: p.milestoneId, reference: p.reference },
    { account: "EXPERT_AVAILABLE", type: "RELEASE", amountMinor: p.amountMinor - fee, userId: p.expertId, reference: p.reference },
  ];
  if (fee > 0) entries.push({ account: "PLATFORM_FEES", type: "FEE", amountMinor: fee, reference: p.reference });
  assertBalanced(entries);
  return entries;
}

export function planRefund(p: { milestoneId: string; amountMinor: number; reference: string }): PlannedEntry[] {
  assertMinor(p.amountMinor);
  const entries: PlannedEntry[] = [
    { account: "ESCROW", type: "REFUND", amountMinor: -p.amountMinor, milestoneId: p.milestoneId, reference: p.reference },
    { account: "EXTERNAL", type: "REFUND", amountMinor: p.amountMinor, reference: p.reference },
  ];
  assertBalanced(entries);
  return entries;
}

/** Dispute outcome: pay the expert part of the escrow and refund the rest to the client. */
export function planPartial(p: {
  milestoneId: string;
  expertId: string;
  escrowMinor: number;
  releaseMinor: number;
  feeBps: number;
  reference: string;
}): PlannedEntry[] {
  assertMinor(p.escrowMinor, "escrow");
  if (!Number.isSafeInteger(p.releaseMinor) || p.releaseMinor < 0 || p.releaseMinor > p.escrowMinor) {
    throw new Error("release amount must be between 0 and the escrowed amount");
  }
  const refund = p.escrowMinor - p.releaseMinor;
  const entries: PlannedEntry[] = [];
  if (p.releaseMinor > 0) entries.push(...planRelease({ ...p, amountMinor: p.releaseMinor }));
  if (refund > 0) entries.push(...planRefund({ milestoneId: p.milestoneId, amountMinor: refund, reference: p.reference }));
  assertBalanced(entries);
  return entries;
}

export function planWithdrawal(p: {
  expertId: string;
  amountMinor: number;
  availableMinor: number;
  reference: string;
}): PlannedEntry[] {
  assertMinor(p.amountMinor);
  if (p.amountMinor > p.availableMinor) throw new Error("Withdrawal exceeds available balance");
  const entries: PlannedEntry[] = [
    { account: "EXPERT_AVAILABLE", type: "WITHDRAWAL", amountMinor: -p.amountMinor, userId: p.expertId, reference: p.reference },
    { account: "EXTERNAL", type: "WITHDRAWAL", amountMinor: p.amountMinor, reference: p.reference },
  ];
  assertBalanced(entries);
  return entries;
}

/** An expert asks to be paid: the money leaves their available balance and waits for payout. */
export function planPayoutHold(p: { expertId: string; amountMinor: number; availableMinor: number; reference: string }): PlannedEntry[] {
  assertMinor(p.amountMinor);
  if (p.amountMinor > p.availableMinor) throw new Error("Withdrawal exceeds available balance");
  const entries: PlannedEntry[] = [
    { account: "EXPERT_AVAILABLE", type: "WITHDRAWAL", amountMinor: -p.amountMinor, userId: p.expertId, reference: p.reference },
    { account: "PAYOUT_PENDING", type: "WITHDRAWAL", amountMinor: p.amountMinor, userId: p.expertId, reference: p.reference },
  ];
  assertBalanced(entries);
  return entries;
}

/** The payout was sent (e.g. by Mobile Money): it leaves the platform. */
export function planPayoutPaid(p: { expertId: string; amountMinor: number; reference: string }): PlannedEntry[] {
  assertMinor(p.amountMinor);
  const entries: PlannedEntry[] = [
    { account: "PAYOUT_PENDING", type: "WITHDRAWAL", amountMinor: -p.amountMinor, userId: p.expertId, reference: p.reference },
    { account: "EXTERNAL", type: "WITHDRAWAL", amountMinor: p.amountMinor, reference: p.reference },
  ];
  assertBalanced(entries);
  return entries;
}

/** The payout was rejected: the money goes back to the expert's available balance. */
export function planPayoutReturn(p: { expertId: string; amountMinor: number; reference: string }): PlannedEntry[] {
  assertMinor(p.amountMinor);
  const entries: PlannedEntry[] = [
    { account: "PAYOUT_PENDING", type: "REVERSAL", amountMinor: -p.amountMinor, userId: p.expertId, reference: p.reference },
    { account: "EXPERT_AVAILABLE", type: "REVERSAL", amountMinor: p.amountMinor, userId: p.expertId, reference: p.reference },
  ];
  assertBalanced(entries);
  return entries;
}

/** Sum of entries for one account (optionally one owner). */
export function balanceOf(
  entries: Pick<PlannedEntry, "account" | "amountMinor" | "userId" | "milestoneId">[],
  account: LedgerAccount,
  owner?: { userId?: string; milestoneId?: string },
): number {
  return entries
    .filter(
      (e) =>
        e.account === account &&
        (owner?.userId === undefined || e.userId === owner.userId) &&
        (owner?.milestoneId === undefined || e.milestoneId === owner.milestoneId),
    )
    .reduce((s, e) => s + e.amountMinor, 0);
}
