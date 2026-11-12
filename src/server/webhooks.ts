/**
 * Webhooks for the Qualitative Studio API: tell a researcher's own system (or Zapier, Make, n8n...)
 * when a response arrives.
 *
 * Each delivery is a POST with a JSON body, signed with the webhook's secret:
 *   x-ts-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">
 * A delivery that fails is retried with growing gaps (about 24 hours in all); a webhook that keeps
 * failing is switched off and its owner told.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, count, desc, eq, isNull, lte, or } from "drizzle-orm";
import type { DB } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { ApiError } from "./apiAccess";
import { notify } from "./notifications";

export const EVENTS = {
  "response.submitted": "A respondent submits their answers (before transcription).",
  "response.processed": "A submitted response has been transcribed and translated (when the study asks for it), so it is ready to read.",
} as const;
export type WebhookEvent = keyof typeof EVENTS;
export const MAX_WEBHOOKS = 10;
const MAX_FAILURES = 20;
/** Minutes to wait before attempts 2, 3, 4, 5 and 6. */
const RETRY_MINUTES = [60, 120, 240, 480, 720]; // the hourly job picks them up
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

// ───────── addresses we will (and won't) call ─────────

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function privateAddress(ip: string) {
  if (isIP(ip) === 4) return privateV4(ip);
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** Only public HTTPS addresses: never the app's own network. */
export async function checkUrl(raw: string, resolve = true) {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ApiError(400, "invalid_url", "That isn't a valid URL.");
  }
  if (u.protocol !== "https:") throw new ApiError(400, "invalid_url", "Webhook URLs must start with https://");
  if (u.username || u.password) throw new ApiError(400, "invalid_url", "Put credentials in your endpoint's own checks, not in the URL.");
  if (u.port && u.port !== "443") throw new ApiError(400, "invalid_url", "Webhook URLs must use the standard HTTPS port.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new ApiError(400, "invalid_url", "Webhook URLs must be on the public internet.");
  if (isIP(host)) {
    if (privateAddress(host)) throw new ApiError(400, "invalid_url", "Webhook URLs must be on the public internet.");
  } else if (resolve) {
    const addrs = await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new ApiError(400, "invalid_url", `We couldn't find ${host}. Check the address.`);
    if (addrs.some((a) => privateAddress(a.address))) throw new ApiError(400, "invalid_url", "Webhook URLs must be on the public internet.");
  }
  return u.toString().slice(0, 500);
}

// ───────── signing ─────────

export const sign = (secret: string, t: number, body: string) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

/** For receivers (and our tests): checks a signature header, allowing `tolerance` seconds of clock skew. */
export function verifySignature(secret: string, header: string, body: string, now = Date.now(), tolerance = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > tolerance) return false;
  const want = Buffer.from(sign(secret, t, body));
  const got = Buffer.from(parts.v1);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ───────── managing webhooks ─────────

export type WebhookView = { id: string; url: string; events: string[]; study_id: string | null; active: boolean; failures: number; last_status: string | null; last_delivery_at: string | null; created_at: string };
export const webhookView = (w: typeof webhooks.$inferSelect): WebhookView => ({ id: w.id, url: w.url, events: w.events, study_id: w.studyId, active: w.active, failures: w.failures, last_status: w.lastStatus, last_delivery_at: w.lastDeliveryAt?.toISOString() ?? null, created_at: w.createdAt.toISOString() });

export async function createWebhook(db: DB, userId: string, p: { url: string; events?: string[]; studyId?: string | null }, opts: { resolve?: boolean } = {}) {
  const url = await checkUrl(p.url, opts.resolve ?? true);
  const events = [...new Set(p.events?.length ? p.events : Object.keys(EVENTS))];
  const bad = events.find((e) => !(e in EVENTS));
  if (bad) throw new ApiError(400, "invalid_request", `Unknown event "${bad}". Use ${Object.keys(EVENTS).join(" or ")}.`);
  const [{ n }] = await db.select({ n: count() }).from(webhooks).where(eq(webhooks.userId, userId));
  if (Number(n) >= MAX_WEBHOOKS) throw new ApiError(400, "too_many_webhooks", `You can have up to ${MAX_WEBHOOKS} webhooks. Delete one you no longer use.`);
  const secret = "whsec_" + randomBytes(24).toString("base64url");
  const [row] = await db.insert(webhooks).values({ userId, url, events, studyId: p.studyId ?? null, secret }).returning();
  return { webhook: webhookView(row), secret };
}

export const listWebhooks = (db: DB, userId: string) => db.select().from(webhooks).where(eq(webhooks.userId, userId)).orderBy(desc(webhooks.createdAt));

export async function deleteWebhook(db: DB, userId: string, id: string) {
  const [row] = await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId))).returning({ id: webhooks.id });
  if (!row) throw new ApiError(404, "not_found", "Webhook not found.");
}

export async function setWebhookActive(db: DB, userId: string, id: string, active: boolean) {
  const [row] = await db.update(webhooks).set({ active, ...(active ? { failures: 0 } : {}) }).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId))).returning({ id: webhooks.id });
  if (!row) throw new ApiError(404, "not_found", "Webhook not found.");
}

// ───────── sending ─────────

export type Sender = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number }>;

const httpSender: Sender = async (url, body, headers) => {
  await checkUrl(url); // the address may have changed since it was saved
  const res = await fetch(url, { method: "POST", body, headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  await res.body?.cancel().catch(() => null);
  return { status: res.status };
};

/** Tries one delivery now; records the outcome and schedules a retry if it failed. */
export async function attempt(db: DB, deliveryId: string, send: Sender = httpSender, now = new Date()) {
  const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId));
  if (!d || d.deliveredAt) return "skipped" as const;
  const [w] = await db.select().from(webhooks).where(eq(webhooks.id, d.webhookId));
  if (!w || !w.active) return "skipped" as const;
  const body = JSON.stringify({ id: d.id, type: d.event, created_at: d.createdAt.toISOString(), data: d.payload });
  const t = Math.floor(now.getTime() / 1000);
  let status = "";
  let ok = false;
  try {
    const r = await send(w.url, body, { "content-type": "application/json", "user-agent": "TrueScholars-Webhooks/1", "x-ts-event": d.event, "x-ts-delivery": d.id, "x-ts-signature": `t=${t},v1=${sign(w.secret, t, body)}` });
    status = String(r.status);
    ok = r.status >= 200 && r.status < 300;
  } catch (err) {
    status = err instanceof ApiError ? "blocked address" : err instanceof Error && err.name === "TimeoutError" ? "timeout" : "connection failed";
  }
  const attempts = d.attempts + 1;
  if (ok) {
    await db.update(webhookDeliveries).set({ attempts, deliveredAt: now, nextAttemptAt: null, lastError: null }).where(eq(webhookDeliveries.id, d.id));
    await db.update(webhooks).set({ failures: 0, lastStatus: status, lastDeliveryAt: now }).where(eq(webhooks.id, w.id));
    return "delivered" as const;
  }
  const next = attempts < MAX_ATTEMPTS ? new Date(now.getTime() + RETRY_MINUTES[attempts - 1] * 60_000) : null;
  await db.update(webhookDeliveries).set({ attempts, nextAttemptAt: next, lastError: status }).where(eq(webhookDeliveries.id, d.id));
  const failures = w.failures + 1;
  const off = failures >= MAX_FAILURES;
  await db.update(webhooks).set({ failures, lastStatus: status, lastDeliveryAt: now, ...(off ? { active: false } : {}) }).where(eq(webhooks.id, w.id));
  if (off) {
    await notify(db, { userId: w.userId, kind: "TOOL_ACCESS", title: "A webhook was switched off", body: `${w.url} failed ${MAX_FAILURES} times in a row (last: ${status}). Fix the endpoint, then switch it back on in Settings → Developer API.`, link: "/settings/api" });
  }
  return "failed" as const;
}

/** Queues `event` for every matching webhook of `userId`, and tries each delivery straight away. */
export async function emit(db: DB, userId: string, event: WebhookEvent, studyId: string, payload: Record<string, unknown>, send?: Sender) {
  const hooks = await db.select().from(webhooks).where(and(eq(webhooks.userId, userId), eq(webhooks.active, true), or(isNull(webhooks.studyId), eq(webhooks.studyId, studyId))));
  const targets = hooks.filter((h) => h.events.includes(event));
  if (!targets.length) return [];
  const rows = await db.insert(webhookDeliveries).values(targets.map((h) => ({ webhookId: h.id, event, payload }))).returning({ id: webhookDeliveries.id });
  return Promise.all(rows.map((r) => attempt(db, r.id, send).catch((e) => (console.error("webhook", e), "failed" as const))));
}

/** A sample delivery, so a receiver can be checked before real responses arrive. */
export async function testWebhook(db: DB, userId: string, id: string, send?: Sender) {
  const [w] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)));
  if (!w) throw new ApiError(404, "not_found", "Webhook not found.");
  const [d] = await db.insert(webhookDeliveries).values({ webhookId: w.id, event: "webhook.test", payload: { message: "This is a test delivery from The True Scholars.", webhook_id: w.id } }).returning({ id: webhookDeliveries.id });
  const wasActive = w.active;
  if (!wasActive) await db.update(webhooks).set({ active: true }).where(eq(webhooks.id, w.id));
  const result = await attempt(db, d.id, send);
  // a test never schedules retries, and doesn't switch a paused webhook back on
  await db.update(webhookDeliveries).set({ nextAttemptAt: null }).where(eq(webhookDeliveries.id, d.id));
  if (!wasActive) await db.update(webhooks).set({ active: false }).where(eq(webhooks.id, w.id));
  const [after] = await db.select({ lastStatus: webhooks.lastStatus }).from(webhooks).where(eq(webhooks.id, w.id));
  return { delivered: result === "delivered", status: after?.lastStatus ?? null };
}

/** The hourly job: retries due deliveries, and forgets old ones. */
export async function retryWebhooks(db: DB, now = new Date(), send?: Sender) {
  const due = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(isNull(webhookDeliveries.deliveredAt), lte(webhookDeliveries.nextAttemptAt, now)))
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(500);
  let delivered = 0;
  for (const d of due) if ((await attempt(db, d.id, send, now)) === "delivered") delivered++;
  await db.delete(webhookDeliveries).where(lte(webhookDeliveries.createdAt, new Date(now.getTime() - 30 * 86_400_000)));
  return { tried: due.length, delivered };
}

export async function recentDeliveries(db: DB, webhookId: string, limit = 10) {
  return db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId)).orderBy(desc(webhookDeliveries.createdAt)).limit(limit);
}
