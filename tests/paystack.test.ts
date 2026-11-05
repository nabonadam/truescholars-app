import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidSignature } from "@/lib/paystack";

describe("Paystack webhook signature", () => {
  const key = "sk_test_example";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "abc" } });
  const good = createHmac("sha512", key).update(body).digest("hex");

  it("accepts the correct signature", () => {
    expect(isValidSignature(body, good, key)).toBe(true);
  });
  it("rejects a tampered body, a wrong key or a missing header", () => {
    expect(isValidSignature(body + " ", good, key)).toBe(false);
    expect(isValidSignature(body, good, "sk_test_other")).toBe(false);
    expect(isValidSignature(body, null, key)).toBe(false);
    expect(isValidSignature(body, "not-hex", key)).toBe(false);
  });
});
