import Link from "next/link";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { verifyTransaction } from "@/lib/paystack";
import { applyVerifiedTransaction } from "@/server/payments";
import { TOOL_PATH, type PlanTool } from "@/lib/plans";

const TOOL_NAME: Record<PlanTool, string> = { stats: "Statistics Assistant", qual: "Qualitative Studio", lit: "Literature Review" };

export const dynamic = "force-dynamic";

/** Paystack sends the customer back here. We never trust the URL: we verify with Paystack first. */
export default async function PaymentCallback({ searchParams }: { searchParams: Promise<{ reference?: string; order?: string; tool?: string }> }) {
  const { reference, order, tool: t } = await searchParams;
  const tool = t && t in TOOL_PATH ? (t as PlanTool) : null;
  let title = "We couldn't confirm this payment";
  let detail = "No payment reference was provided.";
  let ok = false;

  if (reference) {
    try {
      const tx = await verifyTransaction(reference);
      const result = await applyVerifiedTransaction(getDb(), tx);
      ok = result !== "not-successful" && result !== "invalid";
      title = ok ? "Payment confirmed" : "Payment not completed";
      detail = ok
        ? `${formatMoney(tx.amount, tx.currency)} received. Reference ${tx.reference}.${tool ? " Your access is on." : ""}`
        : result === "invalid"
          ? `We received ${formatMoney(tx.amount, tx.currency)} but couldn't match it to a plan. We've been alerted and will sort it out; reference ${tx.reference}.`
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
        <Link href={order ? `/orders/${order}` : tool ? TOOL_PATH[tool] : "/dashboard"} className="btn-primary mx-auto">{order ? "View your order" : tool ? `Open ${TOOL_NAME[tool]}` : "Back to dashboard"}</Link>
      </div>
    </section>
  );
}
