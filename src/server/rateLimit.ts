/** Fixed-window rate limits kept in the database, so they hold across restarts and instances. */

import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { rateLimits } from "@/db/schema";

export class RateLimitError extends Error {}

/** Counts one attempt for `key`; returns false once `max` attempts were made within `windowSeconds`. */
export async function hit(db: DB, key: string, max: number, windowSeconds: number, now = new Date()): Promise<boolean> {
  const reset = new Date(now.getTime() + windowSeconds * 1000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: reset })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} <= ${now} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} <= ${now} then ${reset} else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count });
  return row.count <= max;
}

/** Throws a friendly error when over the limit. */
export async function limit(db: DB, key: string, max: number, windowSeconds: number, message = "Too many attempts. Please wait a few minutes and try again.") {
  if (!(await hit(db, key, max, windowSeconds))) throw new RateLimitError(message);
}

/** Forgets a key (for example after a successful sign-in). */
export async function clearLimit(db: DB, key: string) {
  await db.delete(rateLimits).where(sql`${rateLimits.key} = ${key}`);
}

/** Deletes expired counters (called by the hourly job). */
export async function sweepLimits(db: DB, now = new Date()) {
  await db.delete(rateLimits).where(sql`${rateLimits.resetAt} < ${now}`);
}

/** Reads a request body up to `max` bytes, refusing larger bodies without buffering more than max. */
export async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null; // without a declared size we still stop at max
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => null);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** The visitor's IP address as Render passes it on (first entry of X-Forwarded-For). */
export function clientIp(h: Headers): string {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}
