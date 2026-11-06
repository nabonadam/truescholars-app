import type { Metadata } from "next";
import Link from "next/link";
import { Icon, IconTile } from "@/components/Icons";
import { PayoutMethodForm, WithdrawForm } from "@/components/TrustForms";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { requireUser } from "@/server/guards";
import { expertProfileOf } from "@/server/jobs";
import { LEVEL_INFO, type Level } from "@/server/levels";
import { earningsHistory, earningsSummary, getPayoutMethod, listWithdrawalsForUser, maskAccount, MIN_WITHDRAWAL_MINOR } from "@/server/payouts";

export const metadata: Metadata = { title: "Earnings" };
export const dynamic = "force-dynamic";

const money = (m: number) => formatMoney(m);
const W_STATUS: Record<string, [string, string]> = {
  REQUESTED: ["Processing", "bg-amber-tint text-amber-deep"],
  PAID: ["Paid", "bg-green-tint text-green"],
  REJECTED: ["Returned", "bg-line text-ink"],
};

export default async function Earnings() {
  const user = await requireUser("EXPERT");
  const db = getDb();
  const [s, history, method, wds, profile] = await Promise.all([
    earningsSummary(db, user.id),
    earningsHistory(db, user.id),
    getPayoutMethod(db, user.id),
    listWithdrawalsForUser(db, user.id),
    expertProfileOf(db, user.id),
  ]);
  const peak = Math.max(...s.monthly.map((m) => m.totalMinor), 1);
  const thisMonth = s.monthly.at(-1)?.totalMinor ?? 0;
  const processing = wds.find((w) => w.status === "REQUESTED");
  const level = (profile?.level ?? "NEW") as Level;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Working</span>
          <h1 className="text-3xl font-bold">Earnings</h1>
        </div>
        <Link href="/expert/level" className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink no-underline">
          <Icon name="trophy" size={16} className="text-amber-deep" /> {LEVEL_INFO[level].name}
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="relative flex flex-col gap-5 overflow-hidden rounded-lg bg-green p-6 text-white sm:p-8">
          <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-amber/10" aria-hidden="true" />
          <div>
            <div className="text-sm font-bold text-on-green-muted">Available to withdraw</div>
            <div className="font-display text-5xl font-extrabold text-amber">{money(s.available)}</div>
          </div>
          {processing ? (
            <p className="rounded-sm bg-white/10 px-4 py-3 text-sm">
              {money(processing.amountMinor)} is on its way to {processing.method.provider} {maskAccount(processing.method.accountNumber)}. Requested {ago(processing.createdAt)}.
            </p>
          ) : method ? (
            <WithdrawForm availableMinor={s.available} minMinor={MIN_WITHDRAWAL_MINOR} destination={`${method.provider} ${maskAccount(method.accountNumber)}`} />
          ) : (
            <p className="rounded-sm bg-white/10 px-4 py-3 text-sm">Add your Mobile Money or bank account below to withdraw.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Tile icon="lock" label="In escrow" value={money(s.inEscrow)} note="Paid by clients, released when they approve" />
          <Tile icon="clock" label="Being paid out" value={money(s.pendingPayout)} note="Withdrawals in progress" />
          <Tile icon="wallet" label="Earned in total" value={money(s.earned)} note="After the platform fee" />
          <Tile icon="check" label="Withdrawn" value={money(s.withdrawn)} note="Sent to your account" />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="card flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-xl font-bold">Last six months</h2>
            <span className="text-sm text-ink-muted">This month: <b className="text-ink">{money(thisMonth)}</b></span>
          </div>
          <div className="flex h-48 items-end gap-3" role="img" aria-label={`Monthly earnings: ${s.monthly.map((m) => `${m.label} ${money(m.totalMinor)}`).join(", ")}`}>
            {s.monthly.map((m, i) => (
              <div key={m.key} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <span className="text-[11px] font-bold text-ink-muted">{m.totalMinor ? formatMoney(m.totalMinor).replace(/\.\d\d$/, "") : ""}</span>
                <div className={`w-full rounded-t-md ${i === s.monthly.length - 1 ? "bg-amber" : "bg-green"}`} style={{ height: `${Math.max(3, (m.totalMinor / peak) * 100)}%`, opacity: m.totalMinor ? 1 : 0.15 }} />
                <span className="text-xs text-ink-muted">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <IconTile name="card" tone="amber" />
            <div>
              <h2 className="text-xl font-bold">Payout account</h2>
              {method && <p className="text-sm text-ink-muted">{method.provider} · {method.accountName} · {maskAccount(method.accountNumber)}</p>}
            </div>
          </div>
          {method ? (
            <details>
              <summary className="cursor-pointer text-sm font-bold text-green">Change payout account</summary>
              <div className="mt-4"><PayoutMethodForm existing={method} /></div>
            </details>
          ) : (
            <PayoutMethodForm existing={null} />
          )}
          <p className="flex gap-2 text-xs text-ink-muted"><Icon name="shield" size={14} className="flex-none text-green" /> Only you and our payments team can see these details. Make sure the name matches your expert profile.</p>
        </div>
      </div>

      {wds.length > 0 && (
        <div className="card flex flex-col gap-3">
          <h2 className="text-xl font-bold">Withdrawals</h2>
          <ul className="flex flex-col divide-y divide-line">
            {wds.map((w) => {
              const [label, tone] = W_STATUS[w.status];
              return (
                <li key={w.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone}`}>{label}</span>
                  <span className="flex-1">{w.method.provider} {maskAccount(w.method.accountNumber)} · {ago(w.createdAt)}{w.payoutReference ? ` · Ref ${w.payoutReference}` : ""}{w.note ? ` · ${w.note}` : ""}</span>
                  <b>{money(w.amountMinor)}</b>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card flex flex-col gap-3">
        <h2 className="text-xl font-bold">History</h2>
        {history.length === 0 ? (
          <p className="text-ink-muted">Your earnings appear here when clients approve your work. <Link href="/jobs" className="font-bold text-green">Find work</Link></p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className={`grid size-9 flex-none place-items-center rounded-full ${h.amountMinor > 0 ? "bg-green-tint text-green" : "bg-parchment text-ink"}`} aria-hidden="true">{h.amountMinor > 0 ? "+" : "−"}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{h.label}</span>
                  {h.orderTitle && h.orderId && <> · <Link href={`/orders/${h.orderId}`} className="text-green">{h.orderTitle}</Link></>}
                  <span className="block text-xs text-ink-muted">{ago(h.createdAt)}</span>
                </span>
                <b className={h.amountMinor > 0 ? "text-green" : ""}>{h.amountMinor > 0 ? "+" : "−"}{money(Math.abs(h.amountMinor))}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Tile({ icon, label, value, note }: { icon: "lock" | "clock" | "wallet" | "check"; label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-white p-4">
      <Icon name={icon} size={18} className="text-green" />
      <div className="text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</div>
      <div className="font-display text-xl font-bold">{value}</div>
      <div className="text-xs text-ink-muted">{note}</div>
    </div>
  );
}
