/** What each user should do next, plus order progress, for the dashboard. */

import { and, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/db";
import { milestones, orders, reviews, users } from "@/db/schema";
import { listJobsForClient, nextFundable } from "./jobs";
import { unreadByOrder } from "./orderRoom";

export type AttentionItem = {
  key: string;
  icon: "package" | "card" | "star" | "message" | "clock" | "refresh" | "spark" | "briefcase";
  tone: "amber" | "green" | "solid";
  title: string;
  detail: string;
  href: string;
  cta: string;
  urgent?: boolean;
};

const DAY = 86_400_000;
const inDays = (d: Date, now: Date) => Math.max(0, Math.round((d.getTime() - now.getTime()) / DAY));
const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function attentionItems(db: DB, userId: string, now = new Date()): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  for (const j of await listJobsForClient(db, userId)) {
    if (j.status === "OPEN" && j.unseen > 0) {
      items.push({
        key: `props-${j.id}`, icon: "spark", tone: "amber", urgent: true, href: `/jobs/${j.id}`, cta: "Review",
        title: `${j.unseen} new proposal${j.unseen === 1 ? "" : "s"} for “${short(j.title)}”`,
        detail: "Compare experts, shortlist the best and hire when you're ready.",
      });
    }
  }

  const myOrders = await db
    .select()
    .from(orders)
    .where(or(eq(orders.clientId, userId), eq(orders.expertId, userId)));
  if (myOrders.length === 0) return items;

  const ids = myOrders.map((o) => o.id);
  const [ms, revs, people, unread] = await Promise.all([
    db.select().from(milestones).where(inArray(milestones.orderId, ids)),
    db.select({ orderId: reviews.orderId }).from(reviews).where(and(inArray(reviews.orderId, ids), eq(reviews.authorId, userId))),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(myOrders.flatMap((o) => [o.clientId, o.expertId]))])),
    unreadByOrder(db, userId),
  ]);
  const first = (id: string) => people.find((p) => p.id === id)?.name?.split(" ")[0] ?? "Someone";
  const reviewed = new Set(revs.map((r) => r.orderId));

  for (const o of myOrders) {
    const isClient = o.clientId === userId;
    const other = first(isClient ? o.expertId : o.clientId);
    const title = short(o.title);
    const href = `/orders/${o.id}`;

    for (const m of ms.filter((x) => x.orderId === o.id)) {
      if (isClient && m.status === "DELIVERED") {
        const days = m.autoApproveAt ? inDays(m.autoApproveAt, now) : null;
        items.push({
          key: `deliv-${m.id}`, icon: "package", tone: "amber", urgent: true, href, cta: "Review",
          title: `${other} delivered “${title}”`,
          detail: days === null ? "Review it, then approve or ask for a revision." : `Approves automatically ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} if you don't respond.`,
        });
      }
      if (!isClient && (m.status === "FUNDED" || m.status === "REVISION_REQUESTED")) {
        const revision = m.status === "REVISION_REQUESTED";
        const days = m.dueAt ? Math.round((m.dueAt.getTime() - now.getTime()) / DAY) : null;
        items.push({
          key: `work-${m.id}`, icon: revision ? "refresh" : "clock", tone: revision ? "amber" : "green", urgent: revision || (days !== null && days <= 1), href, cta: "Deliver",
          title: revision ? `${other} asked for a revision on “${title}”` : `Deliver “${title}” for ${other}`,
          detail: days === null ? "Paid into escrow." : days < 0 ? `Overdue by ${-days} day${days === -1 ? "" : "s"}.` : days === 0 ? "Due today." : `Due in ${days} day${days === 1 ? "" : "s"}.`,
        });
      }
    }

    if (isClient && o.status === "AWAITING_PAYMENT") {
      items.push({ key: `pay-${o.id}`, icon: "card", tone: "amber", href, cta: "Pay", title: `Finish paying for “${title}”`, detail: `${other} starts once your payment is in escrow.` });
    }
    const mine = ms.filter((x) => x.orderId === o.id);
    const next = o.status === "ACTIVE" && nextFundable(mine);
    if (isClient && next && mine.length > 1) {
      items.push({
        key: `next-${next.id}`, icon: "card", tone: "amber", href, cta: "Fund",
        title: `Ready for milestone ${next.position} of “${title}”`,
        detail: `Fund “${short(next.title, 40)}” so ${other} can carry on.`,
      });
    }
    if (o.status === "COMPLETED" && !reviewed.has(o.id)) {
      items.push({ key: `rev-${o.id}`, icon: "star", tone: "green", href, cta: "Rate", title: `Rate ${other} for “${title}”`, detail: "Your review helps others choose with confidence." });
    }
    const n = unread.get(o.id) ?? 0;
    if (n > 0) {
      items.push({ key: `msg-${o.id}`, icon: "message", tone: "solid", href: `/messages?c=${o.id}`, cta: "Reply", title: `${n} new message${n === 1 ? "" : "s"} from ${other}`, detail: `About “${title}”.` });
    }
  }
  return items.sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
}

/** 0 Paid · 1 In progress · 2 Delivered · 3 Approved, for the progress tracker. */
export function progressStep(orderStatus: string, milestoneStatuses: string[]): number {
  if (orderStatus === "COMPLETED") return 3;
  if (orderStatus === "AWAITING_PAYMENT" || orderStatus === "CANCELLED") return -1;
  if (milestoneStatuses.includes("DELIVERED")) return 2;
  return 1;
}
