/**
 * AI usage: what every AI action costs us, and the fair-use limits that keep each plan profitable.
 *
 * An action runs inside `metered(...)`, which first checks the person's limits, then records the tokens,
 * transcription seconds and units used by every AI call made while it runs (the low-level AI functions
 * report to the current action through AsyncLocalStorage, so nothing has to be passed down by hand).
 */

import { apiAccessFor } from "./apiAccess";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { aiUsage, paymentEvents, users } from "@/db/schema";
import { accessFor } from "./statsAccess";
import { type Access, toolAccessFor } from "./toolAccess";

export type UsageTool = "stats" | "qual" | "lit";
export type UnitKind = "stats.ai" | "lit.read" | "qual.minutes";

// ───────── prices we pay (US$) ─────────

const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // per million tokens
  "claude-sonnet-5-5": { input: 2, output: 10 },
};
const DEFAULT_MODEL_PRICE = { input: 2, output: 10 };
const AUDIO_PER_MINUTE = 0.0043; // Deepgram Nova-3, pre-recorded

export const tokenCostMicros = (model: string, input: number, output: number) => {
  const p = MODEL_PRICES[model] ?? DEFAULT_MODEL_PRICE;
  return Math.round(input * p.input + output * p.output); // per-million price × tokens = micro-dollars
};
export const audioCostMicros = (seconds: number) => Math.round((seconds / 60) * AUDIO_PER_MINUTE * 1_000_000);

// ───────── fair-use limits ─────────

type Limit = { units: Partial<Record<UnitKind, number>>; costUsd: number };
/** Per calendar month on a paid plan; for the whole free trial otherwise. Admins have no limits. */
export const LIMITS: Record<UsageTool, { paid: Limit; trial: Limit }> = {
  stats: { paid: { units: { "stats.ai": 250 }, costUsd: 9 }, trial: { units: { "stats.ai": 20 }, costUsd: 1 } },
  qual: { paid: { units: { "qual.minutes": 600 }, costUsd: 11 }, trial: { units: { "qual.minutes": 30 }, costUsd: 1.5 } },
  lit: { paid: { units: { "lit.read": 150 }, costUsd: 12 }, trial: { units: { "lit.read": 10 }, costUsd: 1.5 } },
};

/** Qualitative Studio allowance on the API plan, per calendar month. */
export const API_PLAN_LIMIT: Limit = { units: { "qual.minutes": 3000 }, costUsd: 45 };

export const UNIT_LABEL: Record<UnitKind, { one: string; many: string }> = {
  "stats.ai": { one: "AI request", many: "AI requests" },
  "lit.read": { one: "paper read", many: "papers read" },
  "qual.minutes": { one: "minute transcribed", many: "minutes transcribed" },
};

export class QuotaError extends Error {}

// ───────── the current action ─────────

type Ctx = { units: Record<string, number>; inputTokens: number; outputTokens: number; audioSeconds: number; costMicros: number; blocked: string | null };
const store = new AsyncLocalStorage<Ctx>();

/** Called by the low-level AI functions before each call: refuses it when the person is over a limit. */
export function guardAi() {
  const c = store.getStore();
  if (c?.blocked) throw new QuotaError(c.blocked);
}

/** Called by the low-level AI functions after each successful call. */
export function recordTokens(model: string, input: number, output: number) {
  const c = store.getStore();
  if (!c) return;
  c.inputTokens += input;
  c.outputTokens += output;
  c.costMicros += tokenCostMicros(model, input, output);
}
export function recordAudio(seconds: number) {
  const c = store.getStore();
  if (!c || !(seconds > 0)) return;
  c.audioSeconds += seconds;
  c.costMicros += audioCostMicros(seconds);
  countUnit("qual.minutes", seconds / 60);
}
export function countUnit(kind: UnitKind, n = 1) {
  const c = store.getStore();
  if (c) c.units[kind] = (c.units[kind] ?? 0) + n;
}

async function accessOf(db: DB, user: { id: string; roles: string[] }, tool: UsageTool): Promise<Access> {
  return tool === "stats" ? accessFor(db, user) : toolAccessFor(db, tool, user);
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const nextMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/** Where someone stands against their limits for a tool right now. */
export async function usageStatus(db: DB, user: { id: string; roles: string[] }, tool: UsageTool, now = new Date()) {
  const access = await accessOf(db, user, tool);
  if (access.kind === "admin") return { access, unlimited: true as const, units: [] as { kind: UnitKind; used: number; limit: number }[], costUsedPct: 0, resetsAt: null as Date | null, blocked: null as string | null };
  // the API plan includes the Qualitative Studio, with a larger monthly allowance
  const api = tool === "qual" && (await apiAccessFor(db, user, now)).active;
  const trial = !api && access.kind === "trial";
  const limit = api ? API_PLAN_LIMIT : LIMITS[tool][trial ? "trial" : "paid"];
  // a trial's limits cover the whole trial; a paid plan's reset each calendar month
  const from = trial ? new Date(0) : monthStart(now);
  const kinds = Object.keys(limit.units) as UnitKind[];
  const [row] = await db
    .select({
      cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::float`,
      ...Object.fromEntries(kinds.map((k) => [k, sql<number>`coalesce(sum((${aiUsage.units} ->> ${k})::float), 0)::float`])),
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, user.id), eq(aiUsage.tool, tool), gte(aiUsage.createdAt, from)));
  const r = row as unknown as Record<string, number>;
  const units = kinds.map((k) => ({ kind: k, used: Math.round(Number(r[k] ?? 0) * 10) / 10, limit: limit.units[k]! }));
  const costUsedPct = Math.min(100, Math.round((Number(r.cost ?? 0) / 1_000_000 / limit.costUsd) * 100));
  const resetsAt = trial ? null : nextMonth(now);
  const when = resetsAt ? ` It resets on ${resetsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}.` : " Choose a plan to keep going.";
  const over = units.find((u) => u.used >= u.limit);
  const blocked =
    access.kind === "ended" && !api ? null
    : over ? `You've used all ${over.limit} ${UNIT_LABEL[over.kind].many} ${trial ? "in your free trial" : "for this month"}.${when}`
    : costUsedPct >= 100 ? `You've reached the fair-use limit for AI work ${trial ? "in your free trial" : "this month"}.${when}`
    : null;
  return { access, unlimited: false as const, units, costUsedPct, resetsAt, blocked };
}

/**
 * Runs an AI action for `user`: refuses it when they're over a limit, otherwise runs it and records
 * what it used (also when it fails part-way: the tokens were still spent).
 */
export async function metered<T>(
  db: DB,
  user: { id: string; roles: string[] },
  tool: UsageTool,
  action: string,
  fn: (room: { remaining: Partial<Record<UnitKind, number>> }) => Promise<T>,
  opts: { soft?: boolean } = {}, // soft: only refuse if the action actually calls the AI
): Promise<T> {
  const status = await usageStatus(db, user, tool);
  if (status.blocked && !opts.soft) throw new QuotaError(status.blocked);
  const remaining = Object.fromEntries(status.units.map((u) => [u.kind, Math.max(0, Math.floor(u.limit - u.used))])) as Partial<Record<UnitKind, number>>;
  const ctx: Ctx = { units: {}, inputTokens: 0, outputTokens: 0, audioSeconds: 0, costMicros: 0, blocked: status.blocked };
  let failed = false;
  try {
    return await store.run(ctx, () => fn({ remaining }));
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    if (ctx.costMicros > 0 || Object.keys(ctx.units).length) {
      await db
        .insert(aiUsage)
        .values({ userId: user.id, tool, action, access: status.access.kind, units: ctx.units, inputTokens: ctx.inputTokens, outputTokens: ctx.outputTokens, audioSeconds: ctx.audioSeconds, costMicros: Math.min(ctx.costMicros, 2_000_000_000), failed })
        .catch((e) => console.error("usage record failed", e));
    }
  }
}

// ───────── admin ─────────

export async function usageReport(db: DB, from: Date, to: Date, usdToGhs: number) {
  const inRange = and(gte(aiUsage.createdAt, from), sql`${aiUsage.createdAt} < ${to}`);
  const byTool = await db
    .select({ tool: aiUsage.tool, access: aiUsage.access, cost: sql<number>`sum(${aiUsage.costMicros})::float`, people: sql<number>`count(distinct ${aiUsage.userId})::int`, actions: sql<number>`count(*)::int` })
    .from(aiUsage)
    .where(inRange)
    .groupBy(aiUsage.tool, aiUsage.access);
  const topUsers = await db
    .select({
      userId: aiUsage.userId,
      name: users.name,
      email: users.email,
      cost: sql<number>`sum(${aiUsage.costMicros})::float`,
      stats: sql<number>`sum(case when ${aiUsage.tool} = 'stats' then ${aiUsage.costMicros} else 0 end)::float`,
      qual: sql<number>`sum(case when ${aiUsage.tool} = 'qual' then ${aiUsage.costMicros} else 0 end)::float`,
      lit: sql<number>`sum(case when ${aiUsage.tool} = 'lit' then ${aiUsage.costMicros} else 0 end)::float`,
      papers: sql<number>`coalesce(sum((${aiUsage.units} ->> 'lit.read')::float), 0)::float`,
      requests: sql<number>`coalesce(sum((${aiUsage.units} ->> 'stats.ai')::float), 0)::float`,
      minutes: sql<number>`coalesce(sum((${aiUsage.units} ->> 'qual.minutes')::float), 0)::float`,
    })
    .from(aiUsage)
    .leftJoin(users, eq(users.id, aiUsage.userId))
    .where(inRange)
    .groupBy(aiUsage.userId, users.name, users.email)
    .orderBy(desc(sql`sum(${aiUsage.costMicros})`))
    .limit(25);
  const [rev] = await db
    .select({ ghsMinor: sql<number>`coalesce(sum(${paymentEvents.amountMinor}), 0)::float`, n: sql<number>`count(*)::int` })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.purpose, "tool"), eq(paymentEvents.status, "success"), gte(paymentEvents.updatedAt, from), sql`${paymentEvents.updatedAt} < ${to}`));
  const costUsd = byTool.reduce((s, r) => s + Number(r.cost) / 1e6, 0);
  const revenueUsd = (Number(rev?.ghsMinor ?? 0) / 100) * (1 - 0.0195) / usdToGhs;
  return { byTool: byTool.map((r) => ({ ...r, cost: Number(r.cost) / 1e6 })), topUsers: topUsers.map((u) => ({ ...u, cost: Number(u.cost) / 1e6, stats: Number(u.stats) / 1e6, qual: Number(u.qual) / 1e6, lit: Number(u.lit) / 1e6 })), costUsd, revenueUsd, payments: Number(rev?.n ?? 0) };
}
