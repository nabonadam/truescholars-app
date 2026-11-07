/**
 * Seller levels, earned from real track record and re-checked whenever money is released or a
 * dispute closes. Levels can go down as well as up, so they stay meaningful to clients.
 */

import { and, avg, count, eq, gte, inArray, min, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { deliveries, disputes, expertProfiles, ledgerEntries, milestones, orders, reviews } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { notify } from "./notifications";

export type Level = "NEW" | "LEVEL_1" | "LEVEL_2" | "TOP_RATED";
export const LEVEL_ORDER: Level[] = ["NEW", "LEVEL_1", "LEVEL_2", "TOP_RATED"];

export const LEVEL_INFO: Record<Level, { name: string; credits: number; perks: string[] }> = {
  NEW: { name: "New expert", credits: 20, perks: ["20 free bid credits every month", "Verified expert badge"] },
  LEVEL_1: { name: "Level 1", credits: 30, perks: ["Level 1 badge on your services and proposals", "30 free bid credits every month", "A boost in clients' “Best match” ranking"] },
  LEVEL_2: { name: "Level 2", credits: 40, perks: ["Level 2 badge", "40 free bid credits every month", "A bigger boost in “Best match” ranking"] },
  TOP_RATED: { name: "Top rated", credits: 60, perks: ["Top rated badge", "60 free bid credits every month", "The biggest boost in “Best match” ranking"] },
};

type Req = { orders: number; earnedMinor: number; rating: number; reviews: number; onTime: number; days: number };
export const REQUIREMENTS: Record<Exclude<Level, "NEW">, Req> = {
  LEVEL_1: { orders: 3, earnedMinor: 50_000, rating: 4.5, reviews: 1, onTime: 0.8, days: 14 },
  LEVEL_2: { orders: 10, earnedMinor: 300_000, rating: 4.7, reviews: 5, onTime: 0.9, days: 60 },
  TOP_RATED: { orders: 25, earnedMinor: 1_000_000, rating: 4.8, reviews: 10, onTime: 0.95, days: 120 },
};

export type ExpertStats = { orders: number; earnedMinor: number; rating: number | null; reviews: number; onTime: number | null; days: number; lostDisputes: number };

export async function expertStats(db: DB, userId: string, now = new Date()): Promise<ExpertStats> {
  const [profile] = await db.select({ createdAt: expertProfiles.createdAt }).from(expertProfiles).where(eq(expertProfiles.userId, userId));
  const mine = db.select({ id: orders.id }).from(orders).where(eq(orders.expertId, userId));
  const [[done], [earned], [rating], timing, lost] = await Promise.all([
    db.select({ n: count() }).from(orders).where(and(eq(orders.expertId, userId), eq(orders.status, "COMPLETED"))),
    db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.account, "EXPERT_AVAILABLE"), eq(ledgerEntries.userId, userId), eq(ledgerEntries.type, "RELEASE"))),
    db.select({ average: avg(reviews.rating), total: count(reviews.id) }).from(reviews).where(and(eq(reviews.subjectId, userId), inArray(reviews.orderId, mine), eq(reviews.hidden, false))),
    db
      .select({ dueAt: milestones.dueAt, firstDelivery: min(deliveries.createdAt) })
      .from(milestones)
      .innerJoin(deliveries, eq(deliveries.milestoneId, milestones.id))
      .where(and(inArray(milestones.orderId, mine), eq(milestones.status, "APPROVED")))
      .groupBy(milestones.id),
    db
      .select({ status: disputes.status, released: disputes.releasedMinor, refunded: disputes.refundedMinor })
      .from(disputes)
      .where(and(inArray(disputes.orderId, mine), gte(disputes.resolvedAt, new Date(now.getTime() - 60 * 86_400_000)))),
  ]);
  const timed = timing.filter((t) => t.dueAt && t.firstDelivery);
  const onTimeCount = timed.filter((t) => new Date(t.firstDelivery!).getTime() <= t.dueAt!.getTime()).length;
  return {
    orders: Number(done?.n ?? 0),
    earnedMinor: Number(earned?.total ?? 0),
    rating: rating?.average ? Number(rating.average) : null,
    reviews: Number(rating?.total ?? 0),
    onTime: timed.length ? onTimeCount / timed.length : null,
    days: profile ? Math.floor((now.getTime() - profile.createdAt.getTime()) / 86_400_000) : 0,
    // Lost = refunded in full, or settled with less than half going to the expert.
    lostDisputes: lost.filter((d) => d.status === "RESOLVED_REFUND" || (d.status === "RESOLVED_PARTIAL" && (d.released ?? 0) < (d.refunded ?? 0))).length,
  };
}

export function progressTowards(s: ExpertStats, level: Exclude<Level, "NEW">) {
  const r = REQUIREMENTS[level];
  return [
    { key: "orders", label: "Completed orders", current: s.orders, goal: r.orders, met: s.orders >= r.orders, show: `${s.orders} of ${r.orders}` },
    { key: "earned", label: "Earned on the platform", current: s.earnedMinor, goal: r.earnedMinor, met: s.earnedMinor >= r.earnedMinor, show: `${formatMoney(s.earnedMinor).replace(/\.00$/, "")} of ${formatMoney(r.earnedMinor).replace(/\.00$/, "")}` },
    {
      key: "rating",
      label: `Average rating (at least ${r.reviews} review${r.reviews === 1 ? "" : "s"})`,
      current: s.rating ?? 0,
      goal: r.rating,
      met: s.reviews >= r.reviews && (s.rating ?? 0) >= r.rating,
      show: s.rating === null ? `No reviews yet · need ${r.rating}+` : `${s.rating.toFixed(1)} from ${s.reviews} · need ${r.rating}+`,
    },
    { key: "onTime", label: "Delivered on time", current: s.onTime ?? 1, goal: r.onTime, met: (s.onTime ?? 1) >= r.onTime, show: s.onTime === null ? `Nothing late so far · need ${r.onTime * 100}%` : `${Math.round(s.onTime * 100)}% · need ${r.onTime * 100}%` },
    { key: "days", label: "Time on The True Scholars", current: s.days, goal: r.days, met: s.days >= r.days, show: `${s.days} of ${r.days} days` },
    { key: "disputes", label: "No disputes lost in the last 60 days", current: s.lostDisputes === 0 ? 1 : 0, goal: 1, met: s.lostDisputes === 0, show: s.lostDisputes === 0 ? "None" : `${s.lostDisputes} lost` },
  ];
}

export function computeLevel(s: ExpertStats): Level {
  let level: Level = "NEW";
  for (const l of ["LEVEL_1", "LEVEL_2", "TOP_RATED"] as const) {
    if (progressTowards(s, l).every((c) => c.met)) level = l;
    else break;
  }
  return level;
}

/** Re-checks an expert's level; saves it and celebrates if it went up. Never throws. */
export async function evaluateLevel(db: DB, userId: string) {
  try {
    const [p] = await db.select({ id: expertProfiles.id, level: expertProfiles.level }).from(expertProfiles).where(eq(expertProfiles.userId, userId));
    if (!p) return null;
    const level = computeLevel(await expertStats(db, userId));
    if (level === p.level) return { level, changed: false };
    await db.update(expertProfiles).set({ level }).where(eq(expertProfiles.id, p.id));
    if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(p.level as Level)) {
      await notify(db, {
        userId,
        kind: "LEVEL_UP",
        title: `Congratulations, you're now ${LEVEL_INFO[level].name}!`,
        body: `${LEVEL_INFO[level].perks.join(" · ")}.`,
        link: "/expert/level",
      });
    }
    return { level, changed: true };
  } catch (err) {
    console.error("evaluateLevel failed", err);
    return null;
  }
}
