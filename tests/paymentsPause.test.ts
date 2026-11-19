import { afterEach, describe, expect, it } from "vitest";
import { initializeTransaction, paymentsOpen } from "@/lib/paystack";

const keep = { ...process.env };
afterEach(() => { process.env = { ...keep }; });

describe("payments pause switch", () => {
  it("stays closed until PAYMENTS_ENABLED=1, even with a Paystack key", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_x";
    delete process.env.PAYMENTS_ENABLED;
    expect(paymentsOpen()).toBe(false);
    process.env.PAYMENTS_ENABLED = "0";
    expect(paymentsOpen()).toBe(false);
    process.env.PAYMENTS_ENABLED = "1";
    expect(paymentsOpen()).toBe(true);
  });
  it("needs a key as well as the switch", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYMENTS_ENABLED = "1";
    expect(paymentsOpen()).toBe(false);
  });
  it("refuses to start a transaction while paused", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_x";
    delete process.env.PAYMENTS_ENABLED;
    expect(() => initializeTransaction({ email: "a@b.c", amountMinor: 100, currency: "GHS", reference: "r", callbackUrl: "https://x", metadata: { purpose: "test", userId: "u" } })).toThrow(/paused/);
  });
});

describe("marketplace payments", () => {
  it("stay closed even when tool payments are open", async () => {
    const { marketplacePaymentsOpen } = await import("@/lib/paystack");
    process.env.PAYSTACK_SECRET_KEY = "sk_live_x";
    process.env.PAYMENTS_ENABLED = "1";
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    expect(paymentsOpen()).toBe(true);
    expect(marketplacePaymentsOpen()).toBe(false);
    expect(() => initializeTransaction({ email: "a@b.c", amountMinor: 100, currency: "GHS", reference: "r", callbackUrl: "https://x", metadata: { purpose: "milestone", milestoneId: "m", userId: "u" } })).toThrow(/Marketplace/);
  });
});
