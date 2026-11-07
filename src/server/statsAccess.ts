/**
 * Who may use the Statistics Assistant: everyone gets a free trial (2 days by default, no card),
 * starting the first time they open it. Admins always have access; an admin can grant more time.
 * After access ends people can still open their sessions and download what they made.
 */

import { desc, eq, ilike, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { col } from "@/db/col";
import { statAccess, statRuns, statSessions, users } from "@/db/schema";
import { notify } from "./notifications";

export const trialDays = () => Math.max(1, Number(process.env.STATS_TRIAL_DAYS) || 2);
const DAY = 24 * 60 * 60 * 1000;

export type Access =
  | { kind: "admin" }
  | { kind: "trial"; endsAt: Date }
  | { kind: "granted"; endsAt: Date }
  | { kind: "ended"; endedAt: Date };

export const canRun = (a: Access) => a.kind !== "ended";

/** For the dashboard: reads access without starting the trial ("new" = not tried yet). */
export async function peekAccess(db: DB, user: { id: string; roles: string[] }, now = new Date()): Promise<{ access: Access | { kind: "new" }; upgradeRequestedAt: Date | null }> {
  if (user.roles.includes("ADMIN")) return { access: { kind: "admin" }, upgradeRequestedAt: null };
  const [row] = await db.select({ id: statAccess.userId, req: statAccess.upgradeRequestedAt }).from(statAccess).where(eq(statAccess.userId, user.id));
  if (!row) return { access: { kind: "new" }, upgradeRequestedAt: null };
  return { access: await accessFor(db, user, now), upgradeRequestedAt: row.req };
}

/** Someone asks to keep using the tool after the trial: recorded, and every admin is told. */
export async function requestUpgrade(db: DB, user: { id: string; name?: string | null; email?: string | null }, now = new Date()) {
  await db.insert(statAccess).values({ userId: user.id, trialStartedAt: now }).onConflictDoNothing();
  const [row] = await db.select({ req: statAccess.upgradeRequestedAt }).from(statAccess).where(eq(statAccess.userId, user.id));
  if (row?.req && now.getTime() - row.req.getTime() < DAY) return; // one request a day is enough
  await db.update(statAccess).set({ upgradeRequestedAt: now }).where(eq(statAccess.userId, user.id));
  const admins = await db.select({ id: users.id }).from(users).where(sql`'ADMIN' = any(${users.roles})`);
  for (const a of admins) {
    await notify(db, {
      userId: a.id,
      kind: "TOOL_ACCESS",
      title: `${user.name ?? "Someone"} wants to upgrade the Statistics Assistant`,
      body: `${user.email ?? ""} asked for continued access. Give them days in Statistics access.`,
      link: `/admin/stats?q=${encodeURIComponent(user.email ?? "")}`,
    });
  }
}

/** Reads access, starting the trial clock on the first visit. */
export async function accessFor(db: DB, user: { id: string; roles: string[] }, now = new Date()): Promise<Access> {
  if (user.roles.includes("ADMIN")) return { kind: "admin" };
  await db.insert(statAccess).values({ userId: user.id, trialStartedAt: now }).onConflictDoNothing();
  const [row] = await db.select().from(statAccess).where(eq(statAccess.userId, user.id));
  const trialEnd = new Date(row.trialStartedAt.getTime() + trialDays() * DAY);
  if (row.accessUntil && row.accessUntil > now && row.accessUntil > trialEnd) return { kind: "granted", endsAt: row.accessUntil };
  if (trialEnd > now) return { kind: "trial", endsAt: trialEnd };
  const endedAt = row.accessUntil && row.accessUntil > trialEnd ? row.accessUntil : trialEnd;
  return { kind: "ended", endedAt };
}

/** "1 day 14 hours", "5 hours", "12 minutes" */
export function timeLeft(until: Date, now = new Date()) {
  const ms = Math.max(0, until.getTime() - now.getTime());
  const hours = Math.round(ms / 3_600_000); // a fresh trial reads "2 days", not "1 day 23 hours"
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  const m = Math.max(1, Math.round(ms / 60_000));
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d > 0) return h ? `${unit(d, "day")} ${unit(h, "hour")}` : unit(d, "day");
  if (h > 0 && ms >= 3_600_000) return unit(h, "hour");
  return unit(m, "minute");
}

// ───────── admin ─────────

/** Gives a person access for `days` more days from now (or from the end of their current access). */
export async function grantAccess(db: DB, email: string, days: number, note?: string, now = new Date(), opts: { quiet?: boolean } = {}) {
  const [u] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u) throw new Error("No account uses that email.");
  if (!(days > 0 && days <= 3650)) throw new Error("Choose between 1 and 3650 days.");
  await db.insert(statAccess).values({ userId: u.id, trialStartedAt: now }).onConflictDoNothing();
  const [row] = await db.select().from(statAccess).where(eq(statAccess.userId, u.id));
  const trialEnd = new Date(row.trialStartedAt.getTime() + trialDays() * DAY);
  const from = [now, row.accessUntil ?? now, trialEnd].reduce((a, b) => (b > a ? b : a));
  const until = new Date(from.getTime() + days * DAY);
  await db.update(statAccess).set({ accessUntil: until, upgradeRequestedAt: null, note: note?.trim() || row.note }).where(eq(statAccess.userId, u.id));
  if (!opts.quiet) await notify(db, { userId: u.id, kind: "TOOL_ACCESS", title: "Your Statistics Assistant access is on", body: `You can run analyses until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.`, link: "/tools/stats" });
  return { name: u.name, until };
}

export async function endAccess(db: DB, userId: string, now = new Date()) {
  await db
    .update(statAccess)
    .set({ accessUntil: null, trialStartedAt: new Date(now.getTime() - trialDays() * DAY - 1000) })
    .where(eq(statAccess.userId, userId));
}

export async function listStatsUsers(db: DB, q?: string) {
  const runs = sql<number>`(select count(*)::int from ${statRuns} r join ${statSessions} s on s.id = r.session_id where s.owner_id = ${col(statAccess.userId)} and r.status = 'DONE')`;
  const base = db
    .select({ userId: statAccess.userId, name: users.name, email: users.email, trialStartedAt: statAccess.trialStartedAt, accessUntil: statAccess.accessUntil, upgradeRequestedAt: statAccess.upgradeRequestedAt, note: statAccess.note, runs })
    .from(statAccess)
    .innerJoin(users, eq(users.id, statAccess.userId));
  const term = q?.trim();
  return (term ? base.where(or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`))) : base).orderBy(desc(statAccess.trialStartedAt)).limit(200);
}
