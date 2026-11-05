import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { payOrderAction } from "@/app/actions/orders";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/guards";
import { getOrderForUser } from "@/server/orders";
import { ORDER_STATUS } from "@/lib/status";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const MILESTONE: Record<string, string> = {
  PENDING_FUNDING: "Awaiting payment",
  FUNDED: "Paid into escrow · in progress",
  DELIVERED: "Delivered · awaiting approval",
  REVISION_REQUESTED: "Revision requested",
  APPROVED: "Approved · paid to expert",
  REFUNDED: "Refunded",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getOrderForUser(getDb(), id, user.id);
  if (!data) notFound();
  const { order, milestones, client, expert, role } = data;
  const answers = (order.requirements as { question: string; answer: string }[] | null) ?? [];
  const status = ORDER_STATUS[order.status];

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/orders" className="text-sm font-bold text-green">← All orders</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Order</span>
          <h1 className="text-2xl font-bold sm:text-3xl">{order.title}</h1>
          <p className="text-ink-muted">
            {role === "client" ? `with ${expert.name}` : `for ${client.name}`} · {formatMoney(order.totalMinor, order.currency)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${status.tone}`}>{status.label}</span>
      </div>

      {order.status === "AWAITING_PAYMENT" && role === "client" && (
        <div className="card flex flex-wrap items-center gap-4 border-amber bg-amber-tint">
          <p className="flex-1 text-amber-deep">Your order starts once payment is in escrow.</p>
          <form action={payOrderAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="btn-primary">Pay now</button>
          </form>
        </div>
      )}

      <div className="card flex flex-col gap-3">
        <h2 className="text-xl font-bold">Milestones</h2>
        <ul className="flex flex-col divide-y divide-line">
          {milestones.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-bold">{m.title}</div>
                <div className="text-sm text-ink-muted">
                  {MILESTONE[m.status]}
                  {m.dueAt && m.status !== "PENDING_FUNDING" ? ` · due ${m.dueAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                  {` · ${m.revisionsAllowed} revision${m.revisionsAllowed === 1 ? "" : "s"}`}
                </div>
              </div>
              <span className="font-display font-bold">{formatMoney(m.amountMinor, order.currency)}</span>
            </li>
          ))}
        </ul>
      </div>

      {answers.length > 0 && (
        <div className="card flex flex-col gap-4">
          <h2 className="text-xl font-bold">Project details</h2>
          {answers.map((a) => (
            <div key={a.question}>
              <div className="text-sm font-bold text-ink-muted">{a.question}</div>
              <p className="whitespace-pre-line">{a.answer}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-sm text-ink-muted">Messaging, deliveries and approvals open here in the next update.</p>
    </section>
  );
}
