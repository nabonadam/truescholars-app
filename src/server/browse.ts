/** Find experts: live services with reputation, filters and sorting, plus category counts. */

import { and, avg, count, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, orders, reviews, services } from "@/db/schema";
import { searchServices } from "./services";

export type Sort = "recommended" | "rating" | "price" | "fast";
export type Budget = "" | "u200" | "200-500" | "500+";
export type Delivery = "" | "3" | "7";
export type LevelFilter = "" | "l1" | "top";

const LEVEL_RANK: Record<string, number> = { NEW: 0, LEVEL_1: 1, LEVEL_2: 2, TOP_RATED: 3 };

export async function browseServices(db: DB, o: { q?: string; category?: string; sort?: Sort; budget?: Budget; delivery?: Delivery; level?: LevelFilter }) {
  const rows = await searchServices(db, { q: o.q, category: o.category || undefined, limit: 200 });
  if (rows.length === 0) return [];
  const experts = [...new Set(rows.map((r) => r.expertUserId))];
  const [ratings, sold] = await Promise.all([
    db
      .select({ userId: reviews.subjectId, average: avg(reviews.rating), total: count(reviews.id) })
      .from(reviews)
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .where(and(inArray(reviews.subjectId, experts), inArray(orders.expertId, experts)))
      .groupBy(reviews.subjectId),
    db
      .select({ serviceId: orders.serviceId, n: count() })
      .from(orders)
      .where(and(inArray(orders.serviceId, rows.map((r) => r.id)), eq(orders.status, "COMPLETED")))
      .groupBy(orders.serviceId),
  ]);
  let list = rows.map((r) => {
    const rt = ratings.find((x) => x.userId === r.expertUserId);
    const rating = rt?.average ? Number(rt.average) : null;
    const reviewsCount = Number(rt?.total ?? 0);
    const orders = Number(sold.find((x) => x.serviceId === r.id)?.n ?? 0);
    const ageDays = (Date.now() - r.createdAt.getTime()) / 86_400_000;
    // Recommended: proven quality first, with a little lift for new services so they get seen.
    const score = (rating ?? 4.3) * 10 + Math.min(reviewsCount, 20) + Math.min(orders, 20) * 0.8 + (LEVEL_RANK[r.level] ?? 0) * 4 + (ageDays < 14 ? 4 : 0);
    return { ...r, rating, reviews: reviewsCount, orders, score, isNew: ageDays < 14 };
  });
  if (o.budget === "u200") list = list.filter((s) => s.fromMinor <= 20_000);
  if (o.budget === "200-500") list = list.filter((s) => s.fromMinor > 20_000 && s.fromMinor <= 50_000);
  if (o.budget === "500+") list = list.filter((s) => s.fromMinor > 50_000);
  if (o.delivery) list = list.filter((s) => s.fastestDays <= Number(o.delivery));
  if (o.level === "l1") list = list.filter((s) => (LEVEL_RANK[s.level] ?? 0) >= 1);
  if (o.level === "top") list = list.filter((s) => s.level === "TOP_RATED");
  const sorters: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
    recommended: (a, b) => b.score - a.score,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews,
    price: (a, b) => a.fromMinor - b.fromMinor,
    fast: (a, b) => a.fastestDays - b.fastestDays || a.fromMinor - b.fromMinor,
  };
  return list.sort(sorters[o.sort ?? "recommended"]);
}

export type BrowseService = Awaited<ReturnType<typeof browseServices>>[number];

/** How many live services each category has, for the category tiles. */
export async function categoryCounts(db: DB) {
  const rows = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name, n: count(services.id) })
    .from(categories)
    .leftJoin(services, and(eq(services.categoryId, categories.id), eq(services.status, "ACTIVE")))
    .groupBy(categories.id)
    .orderBy(categories.name);
  return rows.map((r) => ({ ...r, n: Number(r.n) }));
}
