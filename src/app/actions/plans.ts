"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { paymentEvents } from "@/db/schema";
import { initializeTransaction, newReference, paystackConfigured } from "@/lib/paystack";
import { PLANS, chargeGhsMinor, isCurrency, isMonths, isPlan, planPrice } from "@/lib/plans";
import { usdToGhs } from "@/server/fx";
import { requireUser } from "@/server/guards";

/** Sends the person to Paystack (Mobile Money or card) to pay for a tool plan. */
export async function buyPlanAction(plan: string, months: number, currency: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!isPlan(plan) || !isMonths(months) || !isCurrency(currency)) return { error: "Choose a plan." };
  if (!user.email) return { error: "Your account needs an email address to pay." };
  if (!paystackConfigured()) return { error: "Online payment isn't switched on yet. Use “Ask us instead” below." };
  const db = getDb();
  const price = planPrice(plan, months, currency);
  const amountMinor = chargeGhsMinor(price, currency, (await usdToGhs(db)).rate);
  const reference = newReference("plan");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // the amount recorded here is what the payment is checked against when it comes back
  await db.insert(paymentEvents).values({ reference, userId: user.id, purpose: "tool", plan, months, amountMinor, currency: "GHS", status: "initialized" });
  let url: string;
  try {
    const r = await initializeTransaction({
      email: user.email,
      amountMinor,
      currency: "GHS",
      reference,
      callbackUrl: `${appUrl}/payments/callback?tool=${plan === "api" ? "api" : PLANS[plan].tools[0]}`,
      metadata: { purpose: "tool", plan, months, currency, price, userId: user.id },
    });
    url = r.authorization_url;
  } catch (err) {
    console.error("plan checkout failed", err);
    return { error: "We couldn't reach Paystack just now. Please try again in a minute." };
  }
  redirect(url);
}
