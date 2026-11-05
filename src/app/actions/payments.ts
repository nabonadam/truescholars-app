"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { paymentEvents } from "@/db/schema";
import { initializeTransaction, isTestMode, newReference } from "@/lib/paystack";

/** Starts a GH₵1 Paystack TEST payment so the whole loop can be checked before real orders exist. */
export async function startTestPayment() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  if (!isTestMode()) throw new Error("Test payments are only available with Paystack test keys.");

  const reference = newReference("test");
  const amountMinor = 100; // GH₵1.00
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  await getDb().insert(paymentEvents).values({
    reference,
    userId: session.user.id,
    purpose: "test",
    amountMinor,
    currency: "GHS",
    status: "initialized",
  });

  const { authorization_url } = await initializeTransaction({
    email: session.user.email,
    amountMinor,
    currency: "GHS",
    reference,
    callbackUrl: `${appUrl}/payments/callback`,
    metadata: { purpose: "test", userId: session.user.id },
  });
  redirect(authorization_url);
}
