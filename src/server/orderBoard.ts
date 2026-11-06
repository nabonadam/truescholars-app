/** Everything the Orders page shows: each order with the other person, progress and what happens next. */

import { and, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, disputes, jobs, milestones, orders, proposals, reviews, services, users } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { unreadByOrder } from "./orderRoom";

const DAY = 86_400_000;
const inDays = (d: Date, now: Date) => Math.round((d.getTime() - now.getTime()) / DAY);
const whenText = (days: number) => (days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);

export type NextStep = { text: string; mine: boolean; urgent: boolean; cta?: string };

export async function orderBoard(db: DB, userId: string, now = new Date()) {
  const rows = await db.select().from(orders).where(or(eq(orders.clientId, userId), eq(orders.expertId, userId)));
  if (rows.length === 0) return [];
  const ids = rows.map((o) => o.id);
  const [ms, people, svc, viaJobs, openDisputes, myReviews, unread] = await Promise.all([
    db.select().from(milestones).where(inArray(milestones.orderId, ids)).orderBy(milestones.position),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(rows.flatMap((o) => [o.clientId, o.expertId]))])),
    db.select({ id: services.id, category: categories.name }).from(services).innerJoin(categories, eq(categories.id, services.categoryId)).where(inArray(services.id, rows.map((o) => o.serviceId).filter((x): x is string => Boolean(x)))),
    db
      .select({ proposalId: proposals.id, category: categories.name })
      .from(proposals)
      .innerJoin(jobs, eq(jobs.id, proposals.jobId))
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .where(inArray(proposals.id, rows.map((o) => o.proposalId).filter((x): x is string => Boolean(x)))),
    db.select({ orderId: disputes.orderId, id: disputes.id }).from(disputes).where(and(inArray(disputes.orderId, ids), eq(disputes.status, "OPEN"))),
    db.select({ orderId: reviews.orderId }).from(reviews).where(and(inArray(reviews.orderId, ids), eq(reviews.authorId, userId))),
    unreadByOrder(db, userId),
  ]);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";

  return rows
    .map((o) => {
      const role = o.clientId === userId ? ("buying" as const) : ("selling" as const);
      const other = name(role === "buying" ? o.expertId : o.clientId);
      const first = other.split(" ")[0];
      const mine = ms.filter((m) => m.orderId === o.id);
      const approved = mine.filter((m) => m.status === "APPROVED");
      const current = mine.find((m) => ["FUNDED", "DELIVERED", "REVISION_REQUESTED"].includes(m.status)) ?? mine.find((m) => m.status === "PENDING_FUNDING") ?? null;
      const dispute = openDisputes.find((d) => d.orderId === o.id) ?? null;
      const reviewed = myReviews.some((r) => r.orderId === o.id);
      const category = svc.find((s) => s.id === o.serviceId)?.category ?? viaJobs.find((p) => p.proposalId === o.proposalId)?.category ?? null;

      let next: NextStep;
      if (dispute) next = { text: "In dispute: payment frozen", mine: true, urgent: true, cta: "Resolve" };
      else if (o.status === "COMPLETED") next = reviewed ? { text: "Completed", mine: false, urgent: false } : { text: `Rate ${first}`, mine: true, urgent: false, cta: "Rate" };
      else if (o.status === "CANCELLED") next = { text: "Cancelled", mine: false, urgent: false };
      else if (!current) next = { text: "In progress", mine: false, urgent: false };
      else if (current.status === "PENDING_FUNDING")
        next = role === "buying"
          ? { text: mine.length > 1 ? `Fund milestone ${current.position} (${formatMoney(current.amountMinor, o.currency).replace(/\.00$/, "")})` : "Pay to start", mine: true, urgent: true, cta: "Pay" }
          : { text: `Waiting for ${first} to fund${mine.length > 1 ? ` milestone ${current.position}` : ""}`, mine: false, urgent: false };
      else if (current.status === "DELIVERED") {
        const d = current.autoApproveAt ? inDays(current.autoApproveAt, now) : null;
        next = role === "buying"
          ? { text: `Review the delivery${d !== null ? ` · approves automatically ${whenText(d)}` : ""}`, mine: true, urgent: true, cta: "Review" }
          : { text: `Waiting for ${first} to approve${d !== null ? ` · auto-approves ${whenText(d)}` : ""}`, mine: false, urgent: false };
      } else {
        const d = current.dueAt ? inDays(current.dueAt, now) : null;
        const revision = current.status === "REVISION_REQUESTED";
        next = role === "selling"
          ? { text: `${revision ? "Revision requested" : "Deliver"}${d !== null ? ` · due ${whenText(d)}` : ""}`, mine: true, urgent: revision || (d !== null && d <= 1), cta: "Deliver" }
          : { text: `${first} is working on it${d !== null ? ` · due ${whenText(d)}` : ""}`, mine: false, urgent: false };
      }

      return {
        id: o.id,
        title: o.title,
        status: o.status,
        role,
        other,
        otherId: role === "buying" ? o.expertId : o.clientId,
        category,
        tier: o.tier,
        totalMinor: o.totalMinor,
        currency: o.currency,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        milestones: mine.map((m) => ({ position: m.position, title: m.title, status: m.status })),
        approvedCount: approved.length,
        current: current ? { position: current.position, title: current.title, status: current.status } : null,
        unread: unread.get(o.id) ?? 0,
        disputeId: dispute?.id ?? null,
        next,
      };
    })
    .sort((a, b) => Number(b.next.mine && b.next.urgent) - Number(a.next.mine && a.next.urgent) || b.updatedAt.getTime() - a.updatedAt.getTime());
}

export type BoardOrder = Awaited<ReturnType<typeof orderBoard>>[number];
