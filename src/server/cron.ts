/**
 * The hourly job: approves deliveries left unanswered past their window, and sends reminders.
 * Every reminder is recorded in cron_marks under a key, so running the job again never repeats one.
 */

import { and, eq, gt, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { authTokens, cronMarks, litReviews, milestones, orders, statAccess, toolAccess, users } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { notify } from "./notifications";
import { autoApproveDue } from "./orderRoom";
import { refreshUsdRate } from "./fx";
import { sweepLimits } from "./rateLimit";
import { moveToR2 } from "./qualStorage";
import { trialDays as statsTrialDays } from "./statsAccess";
import { TOOLS, toolTrialDays } from "./toolAccess";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const day = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

/** Runs `send` only the first time `key` is seen. */
async function once(db: DB, key: string, send: () => Promise<unknown>) {
  const [fresh] = await db.insert(cronMarks).values({ key }).onConflictDoNothing().returning({ key: cronMarks.key });
  if (!fresh) return false;
  try {
    await send();
    return true;
  } catch (err) {
    await db.delete(cronMarks).where(eq(cronMarks.key, key)); // try again next hour
    throw err;
  }
}

async function adminIds(db: DB) {
  return (await db.select({ id: users.id }).from(users).where(sql`'ADMIN'::role = any(${users.roles})`)).map((u) => u.id);
}

const NAMES = { stats: "Statistics Assistant", qual: TOOLS.qual.name, lit: TOOLS.lit.name } as const;
const PATHS = { stats: "/tools/stats", qual: TOOLS.qual.path, lit: TOOLS.lit.path } as const;

/** "Your free trial ends tomorrow" and "your access ends in 3 days". */
async function accessReminders(db: DB, now: Date) {
  let sent = 0;
  const rows = [
    ...(await db.select({ userId: statAccess.userId, start: statAccess.trialStartedAt, until: statAccess.accessUntil }).from(statAccess)).map((r) => ({ ...r, tool: "stats" as const, trial: statsTrialDays() })),
    ...(await db.select({ userId: toolAccess.userId, start: toolAccess.trialStartedAt, until: toolAccess.accessUntil, tool: toolAccess.tool }).from(toolAccess)).map((r) => ({ ...r, tool: r.tool as "qual" | "lit", trial: toolTrialDays() })),
  ];
  for (const r of rows) {
    const trialEnd = new Date(r.start.getTime() + r.trial * DAY);
    const paid = r.until && r.until > trialEnd ? r.until : null;
    const name = NAMES[r.tool];
    if (!paid && trialEnd > now && trialEnd.getTime() - now.getTime() <= DAY) {
      if (await once(db, `trial:${r.tool}:${r.userId}:${r.start.toISOString()}`, () => notify(db, { userId: r.userId, kind: "TOOL_ACCESS", title: `Your ${name} free trial ends tomorrow`, body: "Your work and downloads are always kept. Choose a plan to keep using it.", link: `${PATHS[r.tool]}/upgrade` }))) sent++;
    }
    if (paid && paid > now && paid.getTime() - now.getTime() <= 3 * DAY) {
      if (await once(db, `renew:${r.tool}:${r.userId}:${paid.toISOString()}`, () => notify(db, { userId: r.userId, kind: "TOOL_ACCESS", title: `Your ${name} access ends ${day(paid)}`, body: "Renew to keep running analyses. Your work and downloads are always kept.", link: `${PATHS[r.tool]}/upgrade` }))) sent++;
    }
  }
  return sent;
}

/** Tells the client a day before a delivery is approved for them automatically. */
async function autoApproveWarnings(db: DB, now: Date) {
  let sent = 0;
  const due = await db
    .select({ id: milestones.id, at: milestones.autoApproveAt, title: milestones.title, orderId: orders.id, orderTitle: orders.title, clientId: orders.clientId })
    .from(milestones)
    .innerJoin(orders, eq(orders.id, milestones.orderId))
    .where(and(eq(milestones.status, "DELIVERED"), isNotNull(milestones.autoApproveAt), gt(milestones.autoApproveAt, now), lte(milestones.autoApproveAt, new Date(now.getTime() + DAY))));
  for (const m of due) {
    if (await once(db, `autoapprove:${m.id}:${m.at!.toISOString()}`, () => notify(db, { userId: m.clientId, kind: "DELIVERED", title: `Please review the delivery for “${m.orderTitle}”`, body: `If you don't respond, it will be approved automatically on ${day(m.at!)} and the expert paid. Approve it, or ask for a revision.`, link: `/orders/${m.orderId}`, orderId: m.orderId }))) sent++;
  }
  return sent;
}

/** Literature retrieval: nudge unpaid clients, warn experts of deadlines, tell admins about stalled ones. */
async function retrievalReminders(db: DB, now: Date) {
  let sent = 0;
  const rows = await db
    .select({ id: litReviews.id, title: litReviews.title, ownerId: litReviews.ownerId, expertId: litReviews.expertUserId, orderId: litReviews.orderId, assignedAt: litReviews.assignedAt })
    .from(litReviews)
    .where(and(eq(litReviews.status, "RETRIEVAL"), isNotNull(litReviews.orderId)));
  if (!rows.length) return 0;
  const ms = await db.select({ orderId: milestones.orderId, status: milestones.status, dueAt: milestones.dueAt, amount: milestones.amountMinor }).from(milestones).where(inArray(milestones.orderId, rows.map((r) => r.orderId!)));
  const admins = await adminIds(db);
  for (const r of rows) {
    const m = ms.find((x) => x.orderId === r.orderId);
    if (!m) continue;
    const since = r.assignedAt ? now.getTime() - r.assignedAt.getTime() : 0;
    if (m.status === "PENDING_FUNDING") {
      if (since >= 2 * DAY && (await once(db, `unpaid:${r.orderId}`, () => notify(db, { userId: r.ownerId, kind: "LIT_REVIEW", title: `Your literature expert is waiting to start “${r.title}”`, body: `Pay ${formatMoney(m.amount)} into escrow so they can begin. The expert is paid only after you accept the papers.`, link: `/orders/${r.orderId}`, orderId: r.orderId! })))) sent++;
      if (since >= 5 * DAY) {
        for (const a of admins) if (await once(db, `unpaid-admin:${r.orderId}:${a}`, () => notify(db, { userId: a, kind: "LIT_REQUEST", title: `Unpaid for 5 days: “${r.title}”`, body: "The client hasn't paid. Consider following up, or taking it back from the expert.", link: "/admin/retrieval" }))) sent++;
      }
      continue;
    }
    if ((m.status === "FUNDED" || m.status === "REVISION_REQUESTED") && m.dueAt && r.expertId) {
      const left = m.dueAt.getTime() - now.getTime();
      if (left > 0 && left <= DAY && (await once(db, `due:${r.orderId}:${m.dueAt.toISOString()}`, () => notify(db, { userId: r.expertId!, kind: "LIT_REVIEW", title: `Due tomorrow: literature for “${r.title}”`, body: "Finish the paper records and the search log, then submit the literature to the client.", link: `/tools/lit/${r.id}` })))) sent++;
      if (left <= -DAY) {
        for (const a of admins) if (await once(db, `overdue-admin:${r.orderId}:${m.dueAt.toISOString()}:${a}`, () => notify(db, { userId: a, kind: "LIT_REQUEST", title: `Overdue by a day: “${r.title}”`, body: "The literature retriever hasn't delivered. Check in with them.", link: "/admin/retrieval" }))) sent++;
      }
    }
  }
  return sent;
}

export async function runHourly(db: DB, now = new Date()) {
  const out: Record<string, unknown> = {};
  const jobs: [string, () => Promise<unknown>][] = [
    ["autoApprove", () => autoApproveDue(db, now)],
    ["autoApproveWarnings", () => autoApproveWarnings(db, now)],
    ["accessReminders", () => accessReminders(db, now)],
    ["retrievalReminders", () => retrievalReminders(db, now)],
    ["moveFilesToR2", () => moveToR2(db, 40)],
    ["exchangeRate", () => refreshUsdRate(db, now)],
    ["sweep", async () => {
      await sweepLimits(db, now);
      await db.delete(authTokens).where(lt(authTokens.expiresAt, new Date(now.getTime() - 7 * DAY)));
      return "ok";
    }],
  ];
  for (const [name, job] of jobs) {
    try {
      out[name] = await job();
    } catch (err) {
      console.error("cron job failed", name, err);
      out[name] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}
