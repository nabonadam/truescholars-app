/**
 * The developer API for the Qualitative Studio: the API plan, API keys and request authentication.
 *
 * Keys look like `ts_live_<32 characters>`. Only a SHA-256 hash is stored; the key itself is shown
 * once, when it is created. Each key carries scopes: read (studies, responses, analysis), write
 * (create and manage studies and webhooks) and submit (send in responses).
 */

import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { apiAccess, apiKeys, users } from "@/db/schema";
import { notify } from "./notifications";
import { hit } from "./rateLimit";

export const SCOPES = ["read", "write", "submit"] as const;
export type Scope = (typeof SCOPES)[number];
export const MAX_KEYS = 10;
/** Requests per key: per minute (bursts) and per day. */
export const RATE = { perMinute: 120, perDay: 20_000 };
const DAY = 86_400_000;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// ───────── the API plan ─────────

export async function apiAccessFor(db: DB, user: { id: string; roles?: string[] }, now = new Date()) {
  if (user.roles?.includes("ADMIN")) return { active: true, until: null as Date | null, admin: true };
  const [row] = await db.select().from(apiAccess).where(eq(apiAccess.userId, user.id));
  return { active: !!row && row.accessUntil > now, until: row?.accessUntil ?? null, admin: false };
}

/** Adds `days` of API access (after a payment, or granted by an admin). */
export async function grantApiAccess(db: DB, userId: string, days: number, note?: string, now = new Date(), opts: { quiet?: boolean } = {}) {
  if (!(days > 0 && days <= 3650)) throw new Error("Choose between 1 and 3650 days.");
  const [row] = await db.select().from(apiAccess).where(eq(apiAccess.userId, userId));
  const from = row && row.accessUntil > now ? row.accessUntil : now;
  const until = new Date(from.getTime() + days * DAY);
  await db
    .insert(apiAccess)
    .values({ userId, accessUntil: until, note: note ?? null })
    .onConflictDoUpdate({ target: apiAccess.userId, set: { accessUntil: until, note: note ?? row?.note ?? null } });
  if (!opts.quiet) {
    await notify(db, { userId, kind: "TOOL_ACCESS", title: "Your Qualitative Studio API access is on", body: `Create an API key in Settings → Developer API. Access until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.`, link: "/settings/api" });
  }
  return { until };
}

export async function listApiSubscribers(db: DB) {
  return db
    .select({ userId: apiAccess.userId, until: apiAccess.accessUntil, note: apiAccess.note, name: users.name, email: users.email, keys: sql<number>`(select count(*)::int from api_keys k where k.user_id = ${apiAccess.userId} and k.revoked_at is null)`, lastUsed: sql<Date | null>`(select max(k.last_used_at) from api_keys k where k.user_id = ${apiAccess.userId})` })
    .from(apiAccess)
    .innerJoin(users, eq(users.id, apiAccess.userId))
    .orderBy(desc(apiAccess.accessUntil));
}

// ───────── keys ─────────

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

function newKey() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(32);
  return "ts_live_" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createApiKey(db: DB, user: { id: string; roles?: string[] }, p: { name: string; scopes: string[] }) {
  if (!(await apiAccessFor(db, user)).active) throw new ApiError(402, "plan_required", "API keys need the Qualitative Studio API plan.");
  const name = p.name.trim().slice(0, 60);
  if (!name) throw new ApiError(400, "invalid_request", "Give the key a name, for example the app that will use it.");
  const scopes = [...new Set(p.scopes)].filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  if (!scopes.length) throw new ApiError(400, "invalid_request", "Choose at least one scope: read, write or submit.");
  const [{ n }] = await db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)));
  if (Number(n) >= MAX_KEYS) throw new ApiError(400, "too_many_keys", `You can have up to ${MAX_KEYS} active keys. Revoke one you no longer use.`);
  const key = newKey();
  const [row] = await db.insert(apiKeys).values({ userId: user.id, name, prefix: key.slice(0, 14), keyHash: hashKey(key), scopes }).returning();
  return { key, row };
}

export async function listApiKeys(db: DB, userId: string) {
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(db: DB, userId: string, id: string) {
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
  if (!row) throw new ApiError(404, "not_found", "That key doesn't exist or is already revoked.");
}

// ───────── authenticating a request ─────────

export type ApiContext = { user: { id: string; name: string | null; email: string; roles: string[] }; key: { id: string; name: string; scopes: string[] } };

export async function authenticate(db: DB, req: Request, now = new Date()): Promise<ApiContext> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (req.headers.get("x-api-key") ?? "").trim();
  if (!key) throw new ApiError(401, "unauthorized", "Send your API key as: Authorization: Bearer ts_live_...");
  if (!/^ts_live_[A-Za-z0-9]{32}$/.test(key)) throw new ApiError(401, "unauthorized", "That API key isn't valid.");
  const [row] = await db
    .select({ id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes, revokedAt: apiKeys.revokedAt, lastUsedAt: apiKeys.lastUsedAt, userId: users.id, userName: users.name, email: users.email, roles: users.roles })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.keyHash, hashKey(key)));
  if (!row || row.revokedAt) throw new ApiError(401, "unauthorized", "That API key isn't valid or has been revoked.");
  const user = { id: row.userId, name: row.userName, email: row.email, roles: row.roles as string[] };
  if (!(await apiAccessFor(db, user, now)).active) throw new ApiError(402, "plan_required", "The Qualitative Studio API plan on this account has ended. Renew it at https://app.thetruescholars.com/developers.");
  const [minute, day] = await Promise.all([hit(db, `api:m:${row.id}`, RATE.perMinute, 60, now), hit(db, `api:d:${row.id}`, RATE.perDay, 86_400, now)]);
  if (!minute || !day) throw new ApiError(429, "rate_limited", `Too many requests: up to ${RATE.perMinute} a minute and ${RATE.perDay.toLocaleString("en-US")} a day per key.`);
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));
  }
  return { user, key: { id: row.id, name: row.name, scopes: row.scopes as string[] } };
}

export function requireScope(ctx: ApiContext, scope: Scope) {
  if (!ctx.key.scopes.includes(scope)) throw new ApiError(403, "insufficient_scope", `This key doesn't have the "${scope}" scope. Create a key with it in Settings → Developer API.`);
}
