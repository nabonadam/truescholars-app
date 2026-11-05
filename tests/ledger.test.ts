import { describe, expect, it } from "vitest";
import { assertBalanced, balanceOf, planFund, planPartial, planRefund, planRelease, planWithdrawal } from "@/lib/ledger";
import { feeFor, formatMoney } from "@/lib/money";

describe("money", () => {
  it("rounds fees to the nearest pesewa", () => {
    expect(feeFor(100_000, 1500)).toBe(15_000); // GH₵1,000 at 15% = GH₵150
    expect(feeFor(333, 1500)).toBe(50); // 49.95 → 50
    expect(() => feeFor(100, 10_001)).toThrow();
  });
  it("formats cedis", () => {
    expect(formatMoney(100_000)).toBe("GH₵1,000.00");
  });
});

describe("ledger plans", () => {
  const m = "milestone-1";
  const expert = "expert-1";

  it("funding moves money from outside into escrow", () => {
    const e = planFund({ milestoneId: m, amountMinor: 50_000, reference: "ref1" });
    expect(balanceOf(e, "ESCROW", { milestoneId: m })).toBe(50_000);
    expect(balanceOf(e, "EXTERNAL")).toBe(-50_000);
  });

  it("release pays the expert and the platform fee, emptying escrow", () => {
    const e = [
      ...planFund({ milestoneId: m, amountMinor: 100_000, reference: "ref1" }),
      ...planRelease({ milestoneId: m, expertId: expert, amountMinor: 100_000, feeBps: 1500, reference: "rel" }),
    ];
    assertBalanced(e);
    expect(balanceOf(e, "ESCROW", { milestoneId: m })).toBe(0);
    expect(balanceOf(e, "EXPERT_AVAILABLE", { userId: expert })).toBe(85_000);
    expect(balanceOf(e, "PLATFORM_FEES")).toBe(15_000);
  });

  it("zero fee writes no fee entry", () => {
    const e = planRelease({ milestoneId: m, expertId: expert, amountMinor: 1_000, feeBps: 0, reference: "r" });
    expect(e.some((x) => x.type === "FEE")).toBe(false);
  });

  it("refund returns escrow to the client", () => {
    const e = [
      ...planFund({ milestoneId: m, amountMinor: 20_000, reference: "ref1" }),
      ...planRefund({ milestoneId: m, amountMinor: 20_000, reference: "rf" }),
    ];
    expect(balanceOf(e, "ESCROW", { milestoneId: m })).toBe(0);
    expect(balanceOf(e, "EXTERNAL")).toBe(0);
  });

  it("partial settlement splits escrow between expert and client", () => {
    const e = [
      ...planFund({ milestoneId: m, amountMinor: 100_000, reference: "ref1" }),
      ...planPartial({ milestoneId: m, expertId: expert, escrowMinor: 100_000, releaseMinor: 40_000, feeBps: 1500, reference: "s" }),
    ];
    assertBalanced(e);
    expect(balanceOf(e, "ESCROW", { milestoneId: m })).toBe(0);
    expect(balanceOf(e, "EXPERT_AVAILABLE", { userId: expert })).toBe(34_000);
    expect(balanceOf(e, "PLATFORM_FEES")).toBe(6_000);
    expect(balanceOf(e, "EXTERNAL")).toBe(-40_000); // client got 60,000 of 100,000 back
  });

  it("rejects bad amounts and overdrawn withdrawals", () => {
    expect(() => planFund({ milestoneId: m, amountMinor: 0, reference: "x" })).toThrow();
    expect(() => planFund({ milestoneId: m, amountMinor: 10.5, reference: "x" })).toThrow();
    expect(() => planWithdrawal({ expertId: expert, amountMinor: 501, availableMinor: 500, reference: "w" })).toThrow();
    expect(() => planPartial({ milestoneId: m, expertId: expert, escrowMinor: 100, releaseMinor: 101, feeBps: 0, reference: "s" })).toThrow();
  });
});
