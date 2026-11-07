import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { isValidSignature, verifyTransaction } from "@/lib/paystack";
import { applyVerifiedTransaction } from "@/server/payments";
import { readBody } from "@/server/rateLimit";

export const runtime = "nodejs";

/**
 * Paystack webhook (set the URL in Paystack → Settings → API Keys & Webhooks):
 *   https://app.thetruescholars.com/api/paystack/webhook
 * The signature proves the call came from Paystack; we still re-verify the transaction before booking it.
 */
export async function POST(req: Request) {
  const bytes = await readBody(req, 512 * 1024);
  if (!bytes) return NextResponse.json({ error: "too large" }, { status: 413 });
  const raw = new TextDecoder().decode(bytes);
  if (!isValidSignature(raw, req.headers.get("x-paystack-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as { event: string; data?: { reference?: string } };
  if (event.event === "charge.success" && event.data?.reference) {
    try {
      const tx = await verifyTransaction(event.data.reference);
      const result = await applyVerifiedTransaction(getDb(), tx);
      console.info("paystack webhook", event.data.reference, result);
    } catch (err) {
      // Acknowledge anyway so Paystack does not retry forever; the error is logged for follow-up.
      console.error("paystack webhook failed", event.data.reference, err);
    }
  }
  return NextResponse.json({ received: true });
}
