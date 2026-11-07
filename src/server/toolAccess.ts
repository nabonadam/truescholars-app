/**
 * Access to the AI tools after the Statistics Assistant (Qualitative Studio first). Each tool has its
 * own free trial (2 days by default, no card), starting the first time someone opens it. Admins always
 * have access, and an admin can grant more time. After access ends people keep their work and downloads.
 */

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { qualStudies, toolAccess, users } from "@/db/schema";
import { notify } from "./notifications";
import { timeLeft, type Access } from "./statsAccess";

export { timeLeft, type Access };

export type Tool = "qual";
export const TOOLS: Record<Tool, { name: string; path: string; adminPath: string }> = {
  qual: { name: "Qualitative Studio", path: "/tools/qual", adminPath: "/admin/qual" },
};

export const toolTrialDays = () => Math.max(1, Number(process.env.TOOL_TRIAL_DAYS ?? process.env.STATS_TRIAL_DAYS) || 2);
const DAY = 24 * 60 * 60 * 1000;
const where = (userId: string, tool: Tool) => and(eq(toolAccess.userId, userId), eq(toolAccess.tool, tool));

export const canUse = (a: Access) => a.kind !== "ended";

/** Reads access, starting the trial clock on the first visit. */
export async function toolAccessFor(db: DB, tool: Tool, user: { id: string; roles: string[] }, now = new Date()): Promise<Access> {
  if (user.roles.includes("ADMIN")) return { kind: "admin" };
  await db.insert(toolAccess).values({ userId: user.id, tool, trialStartedAt: now }).onConflictDoNothing();
  const [row] = await db.select().from(toolAccess).where(where(user.id, tool));
  const trialEnd = new Date(row.trialStartedAt.getTime() + toolTrialDays() * DAY);
  if (row.accessUntil && row.accessUntil > now && row.accessUntil > trialEnd) return { kind: "granted", endsAt: row.accessUntil };
  if (trialEnd > now) return { kind: "trial", endsAt: trialEnd };
  const endedAt = row.accessUntil && row.accessUntil > trialEnd ? row.accessUntil : trialEnd;
  return { kind: "ended", endedAt };
}

/** For dashboards: reads access without starting the trial ("new" = not tried yet). */
export async function peekToolAccess(db: DB, tool: Tool, user: { id: string; roles: string[] }, now = new Date()): Promise<{ access: Access | { kind: "new" }; upgradeRequestedAt: Date | null }> {
  if (user.roles.includes("ADMIN")) return { access: { kind: "admin" }, upgradeRequestedAt: null };
  const [row] = await db.select({ req: toolAccess.upgradeRequestedAt }).from(toolAccess).where(where(user.id, tool));
  if (!row) return { access: { kind: "new" }, upgradeRequestedAt: null };
  return { access: await toolAccessFor(db, tool, user, now), upgradeRequestedAt: row.req };
}

/** Someone asks to keep using a tool after the trial: recorded, and every admin is told. */
export async function requestToolUpgrade(db: DB, tool: Tool, user: { id: string; name?: string | null; email?: string | null }, now = new Date()) {
  await db.insert(toolAccess).values({ userId: user.id, tool, trialStartedAt: now }).onConflictDoNothing();
  const [row] = await db.select({ req: toolAccess.upgradeRequestedAt }).from(toolAccess).where(where(user.id, tool));
  if (row?.req && now.getTime() - row.req.getTime() < DAY) return;
  await db.update(toolAccess).set({ upgradeRequestedAt: now }).where(where(user.id, tool));
  const admins = await db.select({ id: users.id }).from(users).where(sql`'ADMIN' = any(${users.roles})`);
  for (const a of admins) {
    await notify(db, {
      userId: a.id,
      kind: "TOOL_ACCESS",
      title: `${user.name ?? "Someone"} wants to upgrade ${TOOLS[tool].name}`,
      body: `${user.email ?? ""} asked for continued access.`,
      link: `${TOOLS[tool].adminPath}?q=${encodeURIComponent(user.email ?? "")}`,
    });
  }
}

/** Gives a person access for `days` more days from now (or from the end of their current access). */
export async function grantToolAccess(db: DB, tool: Tool, email: string, days: number, note?: string, now = new Date()) {
  const [u] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u) throw new Error("No account uses that email.");
  if (!(days > 0 && days <= 3650)) throw new Error("Choose between 1 and 3650 days.");
  await db.insert(toolAccess).values({ userId: u.id, tool, trialStartedAt: now }).onConflictDoNothing();
  const [row] = await db.select().from(toolAccess).where(where(u.id, tool));
  const trialEnd = new Date(row.trialStartedAt.getTime() + toolTrialDays() * DAY);
  const from = [now, row.accessUntil ?? now, trialEnd].reduce((a, b) => (b > a ? b : a));
  const until = new Date(from.getTime() + days * DAY);
  await db.update(toolAccess).set({ accessUntil: until, upgradeRequestedAt: null, note: note?.trim() || row.note }).where(where(u.id, tool));
  await notify(db, {
    userId: u.id,
    kind: "TOOL_ACCESS",
    title: `Your ${TOOLS[tool].name} access is on`,
    body: `You can use it until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.`,
    link: TOOLS[tool].path,
  });
  return { name: u.name, until };
}

export async function endToolAccess(db: DB, tool: Tool, userId: string, now = new Date()) {
  await db
    .update(toolAccess)
    .set({ accessUntil: null, trialStartedAt: new Date(now.getTime() - toolTrialDays() * DAY - 1000) })
    .where(where(userId, tool));
}

export async function listToolUsers(db: DB, tool: Tool, q?: string) {
  const studies = sql<number>`(select count(*)::int from ${qualStudies} s where s.owner_id = ${toolAccess.userId})`;
  const base = db
    .select({ userId: toolAccess.userId, name: users.name, email: users.email, trialStartedAt: toolAccess.trialStartedAt, accessUntil: toolAccess.accessUntil, upgradeRequestedAt: toolAccess.upgradeRequestedAt, note: toolAccess.note, items: studies })
    .from(toolAccess)
    .innerJoin(users, eq(users.id, toolAccess.userId));
  const term = q?.trim();
  const filter = term ? and(eq(toolAccess.tool, tool), or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`))) : eq(toolAccess.tool, tool);
  return base.where(filter).orderBy(desc(toolAccess.trialStartedAt)).limit(200);
}
