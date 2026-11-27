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

/**
 * Payments are paused until PAYMENTS_ENABLED=1 is set on the server, even if a Paystack key is present.
 * While paused nobody can be charged: plans, checkouts, hiring and escrow funding are all switched off,
 * and free trials keep running.
 */
export function paymentsOpen(): boolean {
  return paystackConfigured() && process.env.PAYMENTS_ENABLED === "1";
}

/**
 * Marketplace payments (orders, milestones, hiring) stay off even when payments are open: the old flow held
 * client money until approval, which Paystack treats as regulated escrow. Turn on only after the marketplace
 * has been moved to direct split payments and MARKETPLACE_PAYMENTS_ENABLED=1 is set.
 */
export function marketplacePaymentsOpen(): boolean {
  return paymentsOpen() && process.env.MARKETPLACE_PAYMENTS_ENABLED === "1";
}

export const MARKETPLACE_PAUSED = "Paying experts through The True Scholars opens soon. You can browse, post jobs and talk to experts in the meantime, and nobody can be charged yet.";

export const PAYMENTS_PAUSED = "Payments open soon. For now, everything runs on the free trial, so you won't be charged.";

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
  purpose: "milestone" | "tool" | "test";
  milestoneId?: string;
  plan?: string;
  months?: number;
  currency?: "GHS" | "USD"; // the price list the person chose (the charge itself is always in GHS)
  price?: number; // the price they saw, in whole units of that currency
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
  if (!paymentsOpen()) throw new Error("Payments are paused (PAYMENTS_ENABLED is not 1)");
  if (p.metadata.purpose === "milestone" && !marketplacePaymentsOpen()) throw new Error("Marketplace payments are paused (MARKETPLACE_PAYMENTS_ENABLED is not 1)");
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

/**
 * Newer Paystack-Signature header: "t=<unix>,v1=<key id>:<hex>" (one or two v1 values during rotation),
 * HMAC-SHA512 over "<t>.<raw body>" keyed with the whole whsec_ signing secret. Rejects stale timestamps (>300s).
 */
export function isValidSignedHeader(
  rawBody: string,
  header: string | null,
  secret: string | undefined = process.env.PAYSTACK_WEBHOOK_SECRET,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  });
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v.slice(v.indexOf(":") + 1));
  if (!t || !/^\d+$/.test(t) || sigs.length === 0 || Math.abs(now - Number(t)) > 300) return false;
  const expected = createHmac("sha512", secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((hex) => /^[0-9a-f]{128}$/.test(hex) && timingSafeEqual(expected, Buffer.from(hex, "hex")));
}

/** Accepts the new Paystack-Signature header when a signing secret is set, else the legacy x-paystack-signature. */
export function isAuthenticWebhook(rawBody: string, headers: Headers): boolean {
  const signed = headers.get("paystack-signature");
  if (signed && process.env.PAYSTACK_WEBHOOK_SECRET) return isValidSignedHeader(rawBody, signed);
  return isValidSignature(rawBody, headers.get("x-paystack-signature"));
}

export function newReference(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}
