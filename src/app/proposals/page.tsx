import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { requireUser } from "@/server/guards";
import { creditBalance, expertProfileOf, listProposalsForExpert, MONTHLY_CREDITS, nextRefill } from "@/server/jobs";

export const metadata: Metadata = { title: "My proposals" };
export const dynamic = "force-dynamic";

function state(status: string, viewed: boolean): [string, string] {
  if (status === "ACCEPTED") return ["Hired", "bg-green text-white"];
  if (status === "SHORTLISTED") return ["Shortlisted ★", "bg-amber text-ink"];
  if (status === "DECLINED") return ["Not selected", "bg-line text-ink-muted"];
  if (status === "WITHDRAWN") return ["Withdrawn", "bg-line text-ink-muted"];
  return viewed ? ["Viewed by client", "bg-green-tint text-green"] : ["Sent", "bg-parchment text-ink"];
}

export default async function MyProposals() {
  const user = await requireUser("EXPERT");
  const db = getDb();
  const profile = await expertProfileOf(db, user.id);
  const [rows, credits] = await Promise.all([listProposalsForExpert(db, user.id), profile ? creditBalance(db, profile.id) : Promise.resolve(0)]);
  const active = rows.filter((r) => ["SUBMITTED", "SHORTLISTED"].includes(r.proposal.status)).length;
  const hired = rows.filter((r) => r.proposal.status === "ACCEPTED").length;
  const decided = rows.filter((r) => ["ACCEPTED", "DECLINED"].includes(r.proposal.status)).length;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Working</span>
          <h1 className="text-3xl font-bold">My proposals</h1>
        </div>
        <Link href="/jobs" className="btn-primary">Find work</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-green p-4 text-white sm:col-span-2">
          <div className="text-xs font-bold tracking-wide text-on-green-muted uppercase">Bid credits</div>
          <div className="flex items-end gap-2"><span className="font-display text-3xl font-bold text-amber">{credits}</span><span className="pb-1 text-sm text-on-green-muted">of {MONTHLY_CREDITS} free this month</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-amber" style={{ width: `${Math.min(100, (credits / MONTHLY_CREDITS) * 100)}%` }} /></div>
          <div className="mt-2 text-xs text-on-green-muted">Tops up to {MONTHLY_CREDITS} on {nextRefill(new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}. Credits come back if a client closes a job without hiring.</div>
        </div>
        <div className="rounded-md border border-line bg-white p-4"><div className="text-xs font-bold tracking-wide text-ink-muted uppercase">Active</div><div className="font-display text-3xl font-bold">{active}</div></div>
        <div className="rounded-md border border-line bg-white p-4"><div className="text-xs font-bold tracking-wide text-ink-muted uppercase">Win rate</div><div className="font-display text-3xl font-bold">{decided ? `${Math.round((hired / decided) * 100)}%` : "–"}</div></div>
      </div>

      {rows.length === 0 ? (
        <div className="card flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="grid size-14 flex-none place-items-center rounded-full bg-amber text-ink"><Icon name="spark" size={26} /></span>
          <div className="flex-1">
            <h2 className="text-xl font-bold">No proposals yet</h2>
            <p className="text-ink-muted">Browse open jobs and send your first proposal. Jobs matched to your services appear at the top.</p>
          </div>
          <Link href="/jobs" className="btn-primary">Browse jobs</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const [label, tone] = state(r.proposal.status, Boolean(r.proposal.viewedAt));
            return (
              <li key={r.proposal.id}>
                <Link href={r.orderId ? `/orders/${r.orderId}` : `/jobs/${r.proposal.jobId}`} className="card flex flex-wrap items-center gap-4 text-ink no-underline transition-shadow hover:shadow-md">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span className={`rounded-full px-2.5 py-0.5 font-bold ${tone}`}>{label}</span>
                      <span>Sent {ago(r.proposal.createdAt)}</span>·<span>for {r.clientName?.split(" ")[0]}</span>
                    </div>
                    <h2 className="truncate font-display text-lg font-bold">{r.jobTitle}</h2>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-xl font-bold">{formatMoney(r.proposal.priceMinor).replace(/\.00$/, "")}</div>
                    <div className="text-xs text-ink-muted">{r.proposal.timelineDays} days</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
