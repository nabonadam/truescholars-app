import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidSignature, isValidSignedHeader } from "@/lib/paystack";

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

describe("Paystack-Signature (signing secret)", () => {
  const secret = "whsec_test123", body = '{"event":"charge.success"}', t = 1760270400;
  const sig = createHmac("sha512", secret).update(`${t}.${body}`).digest("hex");
  it("accepts a valid header", () => {
    expect(isValidSignedHeader(body, `t=${t},v1=whk_abc:${sig}`, secret, t + 10)).toBe(true);
  });
  it("accepts when one of two rotated signatures matches", () => {
    expect(isValidSignedHeader(body, `t=${t},v1=whk_old:${"0".repeat(128)},v1=whk_new:${sig}`, secret, t)).toBe(true);
  });
  it("rejects a tampered body, wrong secret and stale timestamp", () => {
    expect(isValidSignedHeader(body + " ", `t=${t},v1=whk_abc:${sig}`, secret, t)).toBe(false);
    expect(isValidSignedHeader(body, `t=${t},v1=whk_abc:${sig}`, "whsec_other", t)).toBe(false);
    expect(isValidSignedHeader(body, `t=${t},v1=whk_abc:${sig}`, secret, t + 301)).toBe(false);
  });
});
