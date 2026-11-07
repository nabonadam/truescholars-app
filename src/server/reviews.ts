/**
 * Ratings and feedback on marketplace orders.
 *
 * Both sides review each other once the order is completed. Clients rate the expert overall and on
 * communication, quality and timeliness, and say whether they'd recommend them; experts rate the client.
 * Reviews are blind: neither side sees the other's review until both have reviewed, or until
 * BLIND_DAYS after completion, so nobody can retaliate. The reviewed person can post one public
 * reply. Admins can hide a review that breaks the rules.
 */

import { and, avg, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { col } from "@/db/col";
import { cronMarks, orders, reviews, users } from "@/db/schema";
import { evaluateLevel } from "./levels";
import { notify } from "./notifications";

export class ReviewError extends Error {}

/** Days after completion during which reviews can be left. */
export const REVIEW_WINDOW_DAYS = 30;
/** Days after completion when a review is published even if the other side never reviews. */
export const BLIND_DAYS = 14;
const DAY = 86_400_000;

const completedOf = (o: { completedAt: Date | null; updatedAt: Date }) => o.completedAt ?? o.updatedAt;

/** SQL: the review row (from `reviews`) is published, i.e. not hidden and no longer blind. */
export const publishedReview = sql`(${reviews.hidden} = false and (
  exists (select 1 from reviews r2 where r2.order_id = ${col(reviews.orderId)} and r2.author_id <> ${col(reviews.authorId)})
  or exists (select 1 from orders o2 where o2.id = ${col(reviews.orderId)} and coalesce(o2.completed_at, o2.updated_at) < now() - make_interval(days => ${BLIND_DAYS}))
))`;

/** Runs `send` once per key (the same marks the hourly job uses). */
async function once(db: DB, key: string, send: () => Promise<unknown>) {
  const [fresh] = await db.insert(cronMarks).values({ key }).onConflictDoNothing().returning({ key: cronMarks.key });
  if (fresh) await send();
}

/** Asks both sides for a review as soon as an order is completed. */
export async function askForReviews(db: DB, orderId: string) {
  const [o] = await db
    .select({ id: orders.id, title: orders.title, status: orders.status, clientId: orders.clientId, expertId: orders.expertId, client: sql<string | null>`(select name from users where id = ${orders.clientId})`, expert: sql<string | null>`(select name from users where id = ${orders.expertId})` })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o || o.status !== "COMPLETED") return;
  const first = (n: string | null, d: string) => n?.split(" ")[0] ?? d;
  await once(db, `review-ask:${o.id}`, () =>
    Promise.all([
      notify(db, { userId: o.clientId, kind: "REVIEW_REQUEST", title: `How did ${first(o.expert, "your expert")} do?`, body: `Rate your experience on "${o.title}". It takes a minute and helps other clients choose.`, link: `/orders/${o.id}#review`, orderId: o.id }),
      notify(db, { userId: o.expertId, kind: "REVIEW_REQUEST", title: `Rate working with ${first(o.client, "your client")}`, body: `Leave feedback on "${o.title}".`, link: `/orders/${o.id}#review`, orderId: o.id }),
    ]),
  );
}

const star = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new ReviewError(`Choose a rating from 1 to 5 stars for ${what}.`);
  return n;
};

export type ReviewInput = {
  orderId: string;
  authorId: string;
  rating: number;
  body: string;
  communication?: number | null;
  quality?: number | null;
  timeliness?: number | null;
  recommend?: boolean | null;
};

export async function leaveReview(db: DB, p: ReviewInput, now = new Date()) {
  const [order] = await db.select().from(orders).where(eq(orders.id, p.orderId));
  if (!order) throw new ReviewError("Order not found");
  if (order.clientId !== p.authorId && order.expertId !== p.authorId) throw new ReviewError("You're not part of this order");
  if (order.status !== "COMPLETED") throw new ReviewError("You can review once the order is completed.");
  if (now.getTime() - completedOf(order).getTime() > REVIEW_WINDOW_DAYS * DAY) throw new ReviewError(`Reviews close ${REVIEW_WINDOW_DAYS} days after an order is completed.`);
  const rating = star(p.rating, "your overall experience");
  const body = p.body.trim();
  if (body.length > 1500) throw new ReviewError("Keep your feedback under 1,500 characters.");
  if (rating <= 2 && body.length < 20) throw new ReviewError("For a low rating, please say what went wrong (at least a sentence), so it's fair and useful.");
  const isClient = p.authorId === order.clientId;
  const detail = isClient
    ? {
        communication: p.communication == null ? null : star(p.communication, "communication"),
        quality: p.quality == null ? null : star(p.quality, "quality of work"),
        timeliness: p.timeliness == null ? null : star(p.timeliness, "delivery on time"),
        recommend: p.recommend ?? null,
      }
    : {};
  const subjectId = isClient ? order.expertId : order.clientId;
  const inserted = await db.insert(reviews).values({ orderId: order.id, authorId: p.authorId, subjectId, rating, body: body || null, ...detail }).onConflictDoNothing().returning({ id: reviews.id });
  if (!inserted.length) throw new ReviewError("You've already reviewed this order.");

  const [theirs] = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.orderId, order.id), eq(reviews.authorId, subjectId)));
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.authorId));
  const who = me?.name?.split(" ")[0] ?? (isClient ? "Your client" : "Your expert");
  await notify(db, theirs
    ? { userId: subjectId, kind: "REVIEW_RECEIVED", title: `${who} reviewed you: ${rating} star${rating === 1 ? "" : "s"}`, body: body ? body.slice(0, 200) : `For "${order.title}".`, link: `/orders/${order.id}#review`, orderId: order.id }
    : { userId: subjectId, kind: "REVIEW_RECEIVED", title: `${who} left you a review`, body: `Leave yours for "${order.title}" to see it. Both reviews show once you have, or in ${BLIND_DAYS} days.`, link: `/orders/${order.id}#review`, orderId: order.id });
  if (subjectId === order.expertId) await evaluateLevel(db, subjectId);
}

/** The reviewed person's one public reply to a published review. */
export async function replyToReview(db: DB, p: { reviewId: string; userId: string; reply: string }) {
  const [r] = await db.select({ id: reviews.id, subjectId: reviews.subjectId, authorId: reviews.authorId, orderId: reviews.orderId, reply: reviews.reply, published: publishedReview }).from(reviews).where(eq(reviews.id, p.reviewId));
  if (!r || r.subjectId !== p.userId) throw new ReviewError("You can only reply to reviews about you.");
  if (!r.published) throw new ReviewError("You can reply once the review is visible.");
  if (r.reply) throw new ReviewError("You've already replied to this review.");
  const reply = p.reply.trim();
  if (reply.length < 2) throw new ReviewError("Write a reply first.");
  if (reply.length > 1000) throw new ReviewError("Keep your reply under 1,000 characters.");
  await db.update(reviews).set({ reply, repliedAt: new Date() }).where(eq(reviews.id, r.id));
  await notify(db, { userId: r.authorId, kind: "REVIEW_RECEIVED", title: "Your review got a reply", body: reply.slice(0, 200), link: `/orders/${r.orderId}#review`, orderId: r.orderId });
}

/** Admin: hide a review that breaks the rules (or show it again). */
export async function setReviewHidden(db: DB, p: { reviewId: string; hidden: boolean; reason?: string }) {
  const reason = p.reason?.trim() || null;
  if (p.hidden && !reason) throw new ReviewError("Give a reason for hiding the review.");
  const [r] = await db.update(reviews).set({ hidden: p.hidden, hiddenReason: p.hidden ? reason : null }).where(eq(reviews.id, p.reviewId)).returning();
  if (!r) throw new ReviewError("Review not found");
  if (p.hidden) await notify(db, { userId: r.authorId, kind: "REVIEW_RECEIVED", title: "Your review was removed", body: `It broke our review rules: ${reason}`, link: `/orders/${r.orderId}#review`, orderId: r.orderId });
  const [o] = await db.select({ expertId: orders.expertId }).from(orders).where(eq(orders.id, r.orderId));
  if (o && r.subjectId === o.expertId) await evaluateLevel(db, r.subjectId);
  return r;
}

export async function reviewsForOrder(db: DB, orderId: string) {
  return db.select().from(reviews).where(eq(reviews.orderId, orderId));
}

/** What a participant sees in the order room. */
export function orderReviewState(order: { status: string; completedAt: Date | null; updatedAt: Date }, revs: (typeof reviews.$inferSelect)[], userId: string, now = new Date()) {
  const mine = revs.find((r) => r.authorId === userId) ?? null;
  const theirs = revs.find((r) => r.authorId !== userId) ?? null;
  const done = order.status === "COMPLETED";
  const completed = completedOf(order);
  const blindEnds = new Date(completed.getTime() + BLIND_DAYS * DAY);
  const closes = new Date(completed.getTime() + REVIEW_WINDOW_DAYS * DAY);
  const open = done && !mine && now < closes;
  const published = (r: typeof mine) => !!r && !r.hidden && (revs.length === 2 || now >= blindEnds);
  return { mine, theirs, open, closes, blindEnds, theirsVisible: published(theirs) ? theirs : null, theirsWaiting: !!theirs && !published(theirs) && !theirs.hidden, mineVisible: published(mine) };
}

/** Average ratings and recent written reviews an expert received from clients (published only). */
export async function expertReviewSummary(db: DB, expertUserId: string, limit = 6) {
  const fromClients = and(eq(reviews.subjectId, expertUserId), eq(orders.expertId, expertUserId), publishedReview);
  const [agg] = await db
    .select({
      average: avg(reviews.rating),
      total: count(reviews.id),
      communication: avg(reviews.communication),
      quality: avg(reviews.quality),
      timeliness: avg(reviews.timeliness),
      recommendYes: sql<number>`count(*) filter (where ${reviews.recommend} = true)`,
      recommendAnswered: sql<number>`count(${reviews.recommend})`,
    })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(fromClients);
  const recent = await db
    .select({ id: reviews.id, rating: reviews.rating, body: reviews.body, reply: reviews.reply, createdAt: reviews.createdAt, author: users.name, recommend: reviews.recommend })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(and(fromClients, sql`${reviews.body} is not null`))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
  const num = (v: unknown) => (v == null ? null : Number(v));
  const answered = Number(agg?.recommendAnswered ?? 0);
  return {
    average: num(agg?.average),
    total: Number(agg?.total ?? 0),
    aspects: { communication: num(agg?.communication), quality: num(agg?.quality), timeliness: num(agg?.timeliness) },
    recommendPct: answered ? Math.round((Number(agg?.recommendYes ?? 0) / answered) * 100) : null,
    recent,
  };
}

/** Hourly: one reminder, three days after completion, to anyone who hasn't reviewed yet. */
export async function reviewReminders(db: DB, now = new Date()) {
  const due = await db
    .select({ id: orders.id, title: orders.title, clientId: orders.clientId, expertId: orders.expertId })
    .from(orders)
    .where(and(eq(orders.status, "COMPLETED"), lt(sql`coalesce(${orders.completedAt}, ${orders.updatedAt})`, new Date(now.getTime() - 3 * DAY)), gte(sql`coalesce(${orders.completedAt}, ${orders.updatedAt})`, new Date(now.getTime() - 10 * DAY))));
  if (!due.length) return 0;
  const done = await db.select({ orderId: reviews.orderId, authorId: reviews.authorId }).from(reviews).where(inArray(reviews.orderId, due.map((o) => o.id)));
  const has = new Set(done.map((r) => `${r.orderId}:${r.authorId}`));
  let sent = 0;
  for (const o of due) {
    for (const u of [o.clientId, o.expertId]) {
      if (has.has(`${o.id}:${u}`)) continue;
      await once(db, `review-remind:${o.id}:${u}`, async () => {
        await notify(db, { userId: u, kind: "REVIEW_REQUEST", title: `Reminder: review "${o.title}"`, body: `Reviews close ${REVIEW_WINDOW_DAYS} days after an order is completed.`, link: `/orders/${o.id}#review`, orderId: o.id });
        sent++;
      });
    }
  }
  return sent;
}

/** Admin list: newest first, optionally only low ratings. */
export async function listReviewsForAdmin(db: DB, p: { low?: boolean; limit?: number } = {}) {
  return db
    .select({ id: reviews.id, rating: reviews.rating, body: reviews.body, reply: reviews.reply, hidden: reviews.hidden, hiddenReason: reviews.hiddenReason, createdAt: reviews.createdAt, orderId: reviews.orderId, title: orders.title, author: sql<string | null>`(select name from users where id = ${reviews.authorId})`, subject: sql<string | null>`(select name from users where id = ${reviews.subjectId})`, aboutExpert: sql<boolean>`${reviews.subjectId} = ${orders.expertId}` })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(p.low ? sql`${reviews.rating} <= 2` : undefined)
    .orderBy(desc(reviews.createdAt))
    .limit(p.limit ?? 100);
}

