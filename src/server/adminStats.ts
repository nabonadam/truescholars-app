/** Numbers for the admin overview, all read from the ledger and the main tables. */

import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  categories,
  disputes,
  expertApplications,
  expertProfiles,
  jobs,
  ledgerEntries,
  messages,
  orders,
  proposals,
  services,
  users,
  withdrawals,
} from "@/db/schema";

const DAY = 86_400_000;
const sum = (rows: { t: string | null }[]) => Number(rows[0]?.t ?? 0);

export async function adminOverview(db: DB, now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since60 = new Date(now.getTime() - 60 * DAY);
  const total = sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)`;
  const fund = and(eq(ledgerEntries.account, "ESCROW"), eq(ledgerEntries.type, "FUND"));

  const [
    paidIn30,
    paidInPrev30,
    paidInAll,
    escrowNow,
    fees30,
    feesAll,
    owedToExperts,
    paidOut,
    [usersAll],
    [users30],
    [expertsAll],
    [activeOrders],
    [completed30],
    [openJobs],
    [proposals30],
    [pendingApps],
    [openDisputes],
    payoutQueue,
    [flagged],
  ] = await Promise.all([
    db.select({ t: total }).from(ledgerEntries).where(and(fund, gte(ledgerEntries.createdAt, since30))),
    db.select({ t: total }).from(ledgerEntries).where(and(fund, gte(ledgerEntries.createdAt, since60), sql`${ledgerEntries.createdAt} < ${since30}`)),
    db.select({ t: total }).from(ledgerEntries).where(fund),
    db.select({ t: total }).from(ledgerEntries).where(eq(ledgerEntries.account, "ESCROW")),
    db.select({ t: total }).from(ledgerEntries).where(and(eq(ledgerEntries.account, "PLATFORM_FEES"), gte(ledgerEntries.createdAt, since30))),
    db.select({ t: total }).from(ledgerEntries).where(eq(ledgerEntries.account, "PLATFORM_FEES")),
    db.select({ t: total }).from(ledgerEntries).where(sql`${ledgerEntries.account} in ('EXPERT_AVAILABLE', 'PAYOUT_PENDING')`),
    db.select({ t: sql<string>`coalesce(sum(${withdrawals.amountMinor}), 0)` }).from(withdrawals).where(eq(withdrawals.status, "PAID")),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(users).where(gte(users.createdAt, since30)),
    db.select({ n: count() }).from(expertProfiles),
    db.select({ n: count() }).from(orders).where(sql`${orders.status} in ('ACTIVE', 'DELIVERED', 'DISPUTED')`),
    db.select({ n: count() }).from(orders).where(and(eq(orders.status, "COMPLETED"), gte(orders.updatedAt, since30))),
    db.select({ n: count() }).from(jobs).where(eq(jobs.status, "OPEN")),
    db.select({ n: count() }).from(proposals).where(gte(proposals.createdAt, since30)),
    db.select({ n: count() }).from(expertApplications).where(sql`${expertApplications.status} in ('SUBMITTED', 'IN_REVIEW')`),
    db.select({ n: count() }).from(disputes).where(eq(disputes.status, "OPEN")),
    db.select({ n: count(), t: sql<string>`coalesce(sum(${withdrawals.amountMinor}), 0)` }).from(withdrawals).where(eq(withdrawals.status, "REQUESTED")),
    db.select({ n: count() }).from(messages).where(eq(messages.flagged, true)),
  ]);

  // Money paid in per day, last 30 days
  const daily = await db
    .select({ day: sql<string>`to_char(${ledgerEntries.createdAt}, 'YYYY-MM-DD')`, t: total })
    .from(ledgerEntries)
    .where(and(fund, gte(ledgerEntries.createdAt, since30)))
    .groupBy(sql`1`);
  const signups = await db
    .select({ day: sql<string>`to_char(${users.createdAt}, 'YYYY-MM-DD')`, n: count() })
    .from(users)
    .where(gte(users.createdAt, since30))
    .groupBy(sql`1`);
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * DAY);
    const key = d.toISOString().slice(0, 10);
    return {
      key,
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
      paidIn: Number(daily.find((x) => x.day === key)?.t ?? 0),
      signups: Number(signups.find((x) => x.day === key)?.n ?? 0),
    };
  });

  return {
    money: {
      paidIn30: sum(paidIn30),
      paidInPrev30: sum(paidInPrev30),
      paidInAll: sum(paidInAll),
      escrowNow: sum(escrowNow),
      fees30: sum(fees30),
      feesAll: sum(feesAll),
      owedToExperts: sum(owedToExperts),
      paidOut: sum(paidOut),
    },
    people: { users: Number(usersAll.n), new30: Number(users30.n), experts: Number(expertsAll.n) },
    work: { activeOrders: Number(activeOrders.n), completed30: Number(completed30.n), openJobs: Number(openJobs.n), proposals30: Number(proposals30.n) },
    queues: {
      applications: Number(pendingApps.n),
      disputes: Number(openDisputes.n),
      payouts: Number(payoutQueue[0]?.n ?? 0),
      payoutsMinor: Number(payoutQueue[0]?.t ?? 0),
      flagged: Number(flagged.n),
    },
    days,
  };
}

/** Sales by category (service orders and hired jobs), for the "where the work is" panel. */
export async function salesByCategory(db: DB) {
  const live = sql`${orders.status} not in ('AWAITING_PAYMENT', 'CANCELLED')`;
  const fromServices = await db
    .select({ name: categories.name, n: count(), t: sql<string>`sum(${orders.totalMinor})` })
    .from(orders)
    .innerJoin(services, eq(services.id, orders.serviceId))
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(live)
    .groupBy(categories.name);
  const fromJobs = await db
    .select({ name: categories.name, n: count(), t: sql<string>`sum(${orders.totalMinor})` })
    .from(orders)
    .innerJoin(proposals, eq(proposals.id, orders.proposalId))
    .innerJoin(jobs, eq(jobs.id, proposals.jobId))
    .innerJoin(categories, eq(categories.id, jobs.categoryId))
    .where(live)
    .groupBy(categories.name);
  const by = new Map<string, { orders: number; minor: number }>();
  for (const r of [...fromServices, ...fromJobs]) {
    const cur = by.get(r.name) ?? { orders: 0, minor: 0 };
    by.set(r.name, { orders: cur.orders + Number(r.n), minor: cur.minor + Number(r.t ?? 0) });
  }
  return [...by.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.minor - a.minor).slice(0, 6);
}

export type Activity = { at: Date; kind: "signup" | "paid" | "job" | "dispute" | "payout" | "application"; text: string; href: string };

/** The latest things that happened across the platform, newest first. */
export async function recentActivity(db: DB, limit = 12): Promise<Activity[]> {
  const [u, paid, j, d, w, a] = await Promise.all([
    db.select({ at: users.createdAt, name: users.name, email: users.email }).from(users).orderBy(desc(users.createdAt)).limit(limit),
    db
      .select({ at: ledgerEntries.createdAt, amount: ledgerEntries.amountMinor, title: orders.title, orderId: orders.id })
      .from(ledgerEntries)
      .innerJoin(sql`milestones m`, sql`m.id = ${ledgerEntries.milestoneId}`)
      .innerJoin(orders, sql`${orders.id} = m.order_id`)
      .where(and(eq(ledgerEntries.account, "ESCROW"), eq(ledgerEntries.type, "FUND")))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limit),
    db.select({ at: jobs.createdAt, title: jobs.title, id: jobs.id }).from(jobs).orderBy(desc(jobs.createdAt)).limit(limit),
    db.select({ at: disputes.createdAt, id: disputes.id, title: orders.title }).from(disputes).innerJoin(orders, eq(orders.id, disputes.orderId)).orderBy(desc(disputes.createdAt)).limit(limit),
    db.select({ at: withdrawals.createdAt, amount: withdrawals.amountMinor, name: users.name }).from(withdrawals).innerJoin(users, eq(users.id, withdrawals.userId)).orderBy(desc(withdrawals.createdAt)).limit(limit),
    db.select({ at: expertApplications.createdAt, id: expertApplications.id, name: users.name }).from(expertApplications).innerJoin(users, eq(users.id, expertApplications.userId)).orderBy(desc(expertApplications.createdAt)).limit(limit),
  ]);
  const money = (m: number) => `GH₵${(m / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const all: Activity[] = [
    ...u.map((x) => ({ at: x.at, kind: "signup" as const, text: `${x.name ?? x.email} joined`, href: "/admin" })),
    ...paid.map((x) => ({ at: x.at, kind: "paid" as const, text: `${money(x.amount)} paid into escrow · ${x.title}`, href: `/orders/${x.orderId}` })),
    ...j.map((x) => ({ at: x.at, kind: "job" as const, text: `Job posted · ${x.title}`, href: `/jobs/${x.id}` })),
    ...d.map((x) => ({ at: x.at, kind: "dispute" as const, text: `Dispute opened · ${x.title}`, href: `/disputes/${x.id}` })),
    ...w.map((x) => ({ at: x.at, kind: "payout" as const, text: `${x.name ?? "An expert"} asked to withdraw ${money(x.amount)}`, href: "/admin/payouts" })),
    ...a.map((x) => ({ at: x.at, kind: "application" as const, text: `${x.name ?? "Someone"} applied to be an expert`, href: `/admin/applications/${x.id}` })),
  ];
  return all.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, limit);
}

