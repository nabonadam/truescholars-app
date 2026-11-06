import { and, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CiteMark } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { getDb } from "@/db";
import { paymentEvents } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/guards";
import { getOrderForUser } from "@/server/orders";

export const metadata: Metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const data = await getOrderForUser(db, id, user.id, { admin: user.roles.includes("ADMIN") });
  if (!data) notFound();
  const { order, milestones, client, expert } = data;

  const payments = await db
    .select()
    .from(paymentEvents)
    .where(and(inArray(paymentEvents.milestoneId, milestones.map((m) => m.id)), eq(paymentEvents.status, "success")));
  if (payments.length === 0) notFound(); // nothing paid yet → no receipt
  const paidTotal = payments.reduce((s, p) => s + p.amountMinor, 0);
  const receiptNo = `TTS-${order.id.slice(0, 8).toUpperCase()}`;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/orders/${order.id}`} className="text-sm font-bold text-green">← Back to order</Link>
        <PrintButton />
      </div>

      <article className="card flex flex-col gap-8 p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <CiteMark size={40} />
            <div>
              <div className="font-display text-xl font-extrabold">The True Scholars</div>
              <div className="text-sm text-ink-muted">thetruescholars.com · hello@thetruescholars.com</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl font-bold">Receipt</div>
            <div className="text-sm text-ink-muted">{receiptNo}</div>
          </div>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs font-bold tracking-wide text-ink-muted uppercase">Billed to</div>
            <div className="font-bold">{client.name}</div>
            <div className="text-sm text-ink-muted">{client.email}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-bold tracking-wide text-ink-muted uppercase">Service provided by</div>
            <div className="font-bold">{expert.name}</div>
            <div className="text-sm text-ink-muted">Vetted expert, The True Scholars</div>
          </div>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-ink-muted">
            <tr>
              <th className="py-2 font-bold">Description</th>
              <th className="py-2 font-bold">Date paid</th>
              <th className="py-2 font-bold">Reference</th>
              <th className="py-2 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const m = milestones.find((x) => x.id === p.milestoneId);
              return (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-3">
                    <div className="font-bold">{order.title}</div>
                    <div className="text-ink-muted">{m?.title}</div>
                  </td>
                  <td className="py-3">{fmt(p.updatedAt)}</td>
                  <td className="py-3 font-mono text-xs">{p.reference}</td>
                  <td className="py-3 text-right font-bold">{formatMoney(p.amountMinor, p.currency)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 text-right font-bold">Total paid</td>
              <td className="pt-4 text-right font-display text-xl font-bold">{formatMoney(paidTotal, order.currency)}</td>
            </tr>
          </tfoot>
        </table>

        <footer className="flex flex-col gap-1 border-t border-line pt-6 text-xs text-ink-muted">
          <p>Paid via Paystack (Mobile Money or card). Funds are held in escrow and released to the expert when the client approves the work.</p>
          <p>Order reference: {order.id} · Issued {fmt(new Date())}</p>
        </footer>
      </article>
    </section>
  );
}
