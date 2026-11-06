import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/AdminTabs";
import { PayoutDecision } from "@/components/TrustForms";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { requireUser } from "@/server/guards";
import { listWithdrawals } from "@/server/payouts";

export const metadata: Metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function AdminPayouts({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("ADMIN");
  const { show } = await searchParams;
  const done = show === "done";
  const rows = await listWithdrawals(getDb(), done ? "DONE" : "REQUESTED");
  const total = rows.reduce((s, r) => s + r.w.amountMinor, 0);
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Payouts</h1>
        <p className="text-ink-muted">
          Send each payment by Mobile Money or bank transfer, then record the transaction ID here. The amount is already set aside from the expert&apos;s balance.
        </p>
      </div>
      <AdminTabs active="/admin/payouts" counts={done ? {} : { "/admin/payouts": rows.length }} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/payouts" className={`rounded-full px-3 py-1.5 font-bold no-underline ${!done ? "bg-green text-white" : "text-ink"}`}>To pay</Link>
        <Link href="/admin/payouts?show=done" className={`rounded-full px-3 py-1.5 font-bold no-underline ${done ? "bg-green text-white" : "text-ink"}`}>History</Link>
        {!done && rows.length > 0 && <span className="ml-auto text-ink-muted">Total to send: <b className="text-ink">{formatMoney(total)}</b></span>}
      </div>
      {rows.length === 0 ? (
        <div className="card text-ink-muted">{done ? "No payouts yet." : "Nothing to pay right now."}</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ w, name, email }) => (
            <li key={w.id} className="card flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-display text-2xl font-bold">{formatMoney(w.amountMinor, w.currency)}</div>
                  <div className="text-sm text-ink-muted">{name} · {email} · requested {ago(w.createdAt)}</div>
                </div>
                {done && <span className={`rounded-full px-3 py-1 text-sm font-bold ${w.status === "PAID" ? "bg-green-tint text-green" : "bg-line text-ink"}`}>{w.status === "PAID" ? `Paid · ${w.payoutReference}` : "Rejected"}</span>}
              </div>
              <dl className="grid gap-3 rounded-sm bg-parchment p-4 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-ink-muted">Send to</dt><dd className="font-bold">{w.method.provider}</dd></div>
                <div><dt className="text-xs text-ink-muted">Account name</dt><dd className="font-bold">{w.method.accountName}</dd></div>
                <div><dt className="text-xs text-ink-muted">{w.method.kind === "momo" ? "Mobile number" : "Account number"}</dt><dd className="font-mono font-bold">{w.method.accountNumber}</dd></div>
              </dl>
              {done ? (w.note && <p className="text-sm text-ink-muted">{w.note}</p>) : <PayoutDecision withdrawalId={w.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
