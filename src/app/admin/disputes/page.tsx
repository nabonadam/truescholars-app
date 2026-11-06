import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/AdminTabs";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { listDisputes, REASONS, type ReasonCode } from "@/server/disputes";
import { requireUser } from "@/server/guards";

export const metadata: Metadata = { title: "Disputes" };
export const dynamic = "force-dynamic";

const OUTCOME: Record<string, string> = { RESOLVED_RELEASE: "Paid to expert", RESOLVED_PARTIAL: "Split", RESOLVED_REFUND: "Refunded", CANCELLED: "Withdrawn" };

export default async function AdminDisputes({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("ADMIN");
  const { show } = await searchParams;
  const closed = show === "closed";
  const rows = await listDisputes(getDb(), closed ? "closed" : "open");
  const now = new Date();
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Disputes</h1>
        <p className="text-ink-muted">Each dispute freezes one milestone&apos;s escrow. The two sides get {3} days to agree a split; after that, decide from the order, messages and evidence.</p>
      </div>
      <AdminTabs active="/admin/disputes" counts={closed ? {} : { "/admin/disputes": rows.length }} />
      <div className="flex gap-2 text-sm">
        <Link href="/admin/disputes" className={`rounded-full px-3 py-1.5 font-bold no-underline ${!closed ? "bg-green text-white" : "text-ink"}`}>Open</Link>
        <Link href="/admin/disputes?show=closed" className={`rounded-full px-3 py-1.5 font-bold no-underline ${closed ? "bg-green text-white" : "text-ink"}`}>Closed</Link>
      </div>
      {rows.length === 0 ? (
        <div className="card text-ink-muted">{closed ? "No closed disputes yet." : "No open disputes. Everyone's getting along."}</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const ready = r.dispute.respondBy ? r.dispute.respondBy < now : false;
            return (
              <li key={r.dispute.id}>
                <Link href={`/disputes/${r.dispute.id}`} className="card flex flex-wrap items-center gap-4 text-ink no-underline hover:shadow-md">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      {closed ? (
                        <span className="rounded-full bg-line px-2.5 py-0.5 font-bold">{OUTCOME[r.dispute.status] ?? r.dispute.status}</span>
                      ) : ready ? (
                        <span className="rounded-full bg-amber px-2.5 py-0.5 font-bold text-ink">Ready for decision</span>
                      ) : (
                        <span className="rounded-full bg-green-tint px-2.5 py-0.5 font-bold text-green">Parties talking</span>
                      )}
                      <span className="text-ink-muted">{REASONS[r.dispute.reason as ReasonCode] ?? r.dispute.reason} · opened {ago(r.dispute.createdAt)}</span>
                      {r.dispute.offerReleaseMinor !== null && !closed && <span className="text-ink-muted">· offer on the table</span>}
                    </div>
                    <h2 className="truncate font-display text-lg font-bold">{r.title}</h2>
                    <p className="text-sm text-ink-muted">{r.clientName} (client) vs {r.expertName} (expert) · {r.milestoneTitle}</p>
                  </div>
                  <b className="font-display text-xl">{formatMoney(r.amountMinor ?? 0, r.currency)}</b>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
