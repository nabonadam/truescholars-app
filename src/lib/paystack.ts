/** Minimal Paystack client (https://paystack.com/docs/api). Server-only: uses the secret key. */

import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return key;
}

export function paystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

export function isTestMode(): boolean {
  return (process.env.PAYSTACK_SECRET_KEY ?? "").startsWith("sk_test_");
}

interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json()) as PaystackResponse<T>;
  if (!res.ok || !body.status) throw new Error(`Paystack ${path} failed: ${body.message ?? res.status}`);
  return body.data;
}

export interface PaymentMetadata {
  purpose: "milestone" | "test";
  milestoneId?: string;
  userId: string;
}

/** Starts a payment; send the customer to the returned authorization_url. Amount in pesewas. */
export function initializeTransaction(p: {
  email: string;
  amountMinor: number;
  currency: "GHS";
  reference: string;
  callbackUrl: string;
  metadata: PaymentMetadata;
}) {
  return call<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: p.email,
      amount: p.amountMinor,
      currency: p.currency,
      reference: p.reference,
      callback_url: p.callbackUrl,
      metadata: p.metadata,
      channels: ["mobile_money", "card"],
    }),
  });
}

export interface VerifiedTransaction {
  status: string; // "success" | "failed" | "abandoned" | ...
  reference: string;
  amount: number; // pesewas
  currency: string;
  metadata: PaymentMetadata | null;
  customer: { email: string };
}

/** Always confirm with Paystack before trusting a payment. */
export function verifyTransaction(reference: string) {
  return call<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Checks the x-paystack-signature header: HMAC-SHA512 of the raw body with the secret key. */
export function isValidSignature(rawBody: string, signature: string | null, key: string = secretKey()): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newReference(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}
