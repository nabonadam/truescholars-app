/** Orders created from services (and later from accepted proposals). */

import { and, desc, eq, or } from "drizzle-orm";
import type { DB } from "@/db";
import { milestones, orders, services, serviceTiers, threadMembers, threads, users } from "@/db/schema";
import { getExpertProfileByUser, type TierName } from "./services";
import { expertProfiles } from "@/db/schema";

export class OrderError extends Error {}

export function platformFeeBps(): number {
  const raw = Number(process.env.PLATFORM_FEE_BPS ?? "1500");
  return Number.isInteger(raw) && raw >= 0 && raw <= 10_000 ? raw : 1500;
}

/**
 * Client buys a service package: creates the order (fee locked), one milestone for the package
 * price, and the order's message thread. Payment then funds the milestone into escrow.
 */
export async function createOrderFromService(
  db: DB,
  p: { clientId: string; serviceId: string; tier: TierName; answers: { question: string; answer: string }[]; feeBps?: number },
) {
  return db.transaction(async (tx) => {
    const [svc] = await tx
      .select({ service: services, expertUserId: expertProfiles.userId })
      .from(services)
      .innerJoin(expertProfiles, eq(expertProfiles.id, services.expertId))
      .where(eq(services.id, p.serviceId));
    if (!svc || svc.service.status !== "ACTIVE") throw new OrderError("This service is not available.");
    if (svc.expertUserId === p.clientId) throw new OrderError("You can't buy your own service.");

    const [tier] = await tx
      .select()
      .from(serviceTiers)
      .where(and(eq(serviceTiers.serviceId, p.serviceId), eq(serviceTiers.name, p.tier)));
    if (!tier) throw new OrderError("That package doesn't exist.");

    const [order] = await tx
      .insert(orders)
      .values({
        clientId: p.clientId,
        expertId: svc.expertUserId,
        serviceId: svc.service.id,
        tier: tier.name,
        title: svc.service.title,
        totalMinor: tier.priceMinor,
        currency: tier.currency,
        feeBps: p.feeBps ?? platformFeeBps(),
        requirements: p.answers,
      })
      .returning();

    const [milestone] = await tx
      .insert(milestones)
      .values({
        orderId: order.id,
        position: 1,
        title: `${tier.name.charAt(0) + tier.name.slice(1).toLowerCase()} package`,
        amountMinor: tier.priceMinor,
        revisionsAllowed: tier.revisions,
        dueAt: new Date(Date.now() + tier.deliveryDays * 86_400_000), // reset when funded
      })
      .returning();

    const [thread] = await tx.insert(threads).values({ orderId: order.id }).returning();
    await tx.insert(threadMembers).values([
      { threadId: thread.id, userId: p.clientId },
      { threadId: thread.id, userId: svc.expertUserId },
    ]);
    return { order, milestone };
  });
}

export async function listOrdersForUser(db: DB, userId: string) {
  return db
    .select({
      id: orders.id,
      title: orders.title,
      tier: orders.tier,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      status: orders.status,
      createdAt: orders.createdAt,
      clientId: orders.clientId,
      expertId: orders.expertId,
    })
    .from(orders)
    .where(or(eq(orders.clientId, userId), eq(orders.expertId, userId)))
    .orderBy(desc(orders.createdAt));
}

/** Order details, only for its client or expert. */
export async function getOrderForUser(db: DB, orderId: string, userId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || (order.clientId !== userId && order.expertId !== userId)) return null;
  const ms = await db.select().from(milestones).where(eq(milestones.orderId, orderId)).orderBy(milestones.position);
  const people = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(or(eq(users.id, order.clientId), eq(users.id, order.expertId)));
  return {
    order,
    milestones: ms,
    client: people.find((u) => u.id === order.clientId)!,
    expert: people.find((u) => u.id === order.expertId)!,
    role: order.clientId === userId ? ("client" as const) : ("expert" as const),
  };
}

export { getExpertProfileByUser };
