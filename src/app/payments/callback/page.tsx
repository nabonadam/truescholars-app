import Link from "next/link";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { verifyTransaction } from "@/lib/paystack";
import { applyVerifiedTransaction } from "@/server/payments";

export const dynamic = "force-dynamic";

/** Paystack sends the customer back here. We never trust the URL: we verify with Paystack first. */
export default async function PaymentCallback({ searchParams }: { searchParams: Promise<{ reference?: string; order?: string }> }) {
  const { reference, order } = await searchParams;
  let title = "We couldn't confirm this payment";
  let detail = "No payment reference was provided.";
  let ok = false;

  if (reference) {
    try {
      const tx = await verifyTransaction(reference);
      const result = await applyVerifiedTransaction(getDb(), tx);
      ok = result !== "not-successful";
      title = ok ? "Payment confirmed" : "Payment not completed";
      detail = ok
        ? `${formatMoney(tx.amount, tx.currency)} received. Reference ${tx.reference}.`
        : `Paystack reports this payment as "${tx.status}". You have not been charged.`;
    } catch (err) {
      detail = err instanceof Error ? err.message : "Unknown error";
    }
  }

  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <div className="card flex flex-col gap-4 text-center">
        <h1 className={`text-2xl font-bold ${ok ? "text-green" : "text-amber-deep"}`}>{title}</h1>
        <p className="text-ink-muted">{detail}</p>
        <Link href={order ? `/orders/${order}` : "/dashboard"} className="btn-primary mx-auto">{order ? "View your order" : "Back to dashboard"}</Link>
      </div>
    </section>
  );
}
