"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { milestones, orders, paymentEvents } from "@/db/schema";
import { initializeTransaction, newReference, paystackConfigured } from "@/lib/paystack";
import { requireUser } from "@/server/guards";
import { createOrderFromService, OrderError } from "@/server/orders";
import { getService, type TierName } from "@/server/services";

export type FormState = { error?: string } | undefined;

/** Sends the client to Paystack to fund one milestone into escrow. */
async function payMilestone(p: { milestoneId: string; amountMinor: number; email: string; userId: string; orderId: string }) {
  const reference = newReference("ms");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await getDb().insert(paymentEvents).values({
    reference,
    userId: p.userId,
    purpose: "milestone",
    milestoneId: p.milestoneId,
    amountMinor: p.amountMinor,
    currency: "GHS",
    status: "initialized",
  });
  const { authorization_url } = await initializeTransaction({
    email: p.email,
    amountMinor: p.amountMinor,
    currency: "GHS",
    reference,
    callbackUrl: `${appUrl}/payments/callback?order=${p.orderId}`,
    metadata: { purpose: "milestone", milestoneId: p.milestoneId, userId: p.userId },
  });
  redirect(authorization_url);
}

export async function checkoutAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.email) return { error: "Your account needs an email address to pay." };
  if (!paystackConfigured()) return { error: "Payments are not switched on yet. Please try again later." };

  const serviceId = String(form.get("serviceId"));
  const tier = String(form.get("tier")) as TierName;
  const svc = await getService(getDb(), serviceId);
  if (!svc) return { error: "This service is no longer available." };

  const answers = svc.service.requirements.map((question, i) => ({ question, answer: String(form.get(`answer_${i}`) ?? "").trim() }));
  if (answers.some((a) => !a.answer)) return { error: "Please answer the expert's questions so they can start." };

  let created;
  try {
    created = await createOrderFromService(getDb(), { clientId: user.id, serviceId, tier, answers });
  } catch (err) {
    if (err instanceof OrderError) return { error: err.message };
    throw err;
  }
  await payMilestone({
    milestoneId: created.milestone.id,
    amountMinor: created.milestone.amountMinor,
    email: user.email,
    userId: user.id,
    orderId: created.order.id,
  });
  return undefined;
}

/** Retry payment for an order that is still awaiting payment. */
export async function payOrderAction(form: FormData) {
  const user = await requireUser();
  const orderId = String(form.get("orderId"));
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.clientId !== user.id || !user.email) redirect("/orders");
  const [next] = (await db.select().from(milestones).where(eq(milestones.orderId, orderId)).orderBy(milestones.position)).filter(
    (m) => m.status === "PENDING_FUNDING",
  );
  if (!next) redirect(`/orders/${orderId}`);
  await payMilestone({ milestoneId: next.id, amountMinor: next.amountMinor, email: user.email, userId: user.id, orderId });
}
