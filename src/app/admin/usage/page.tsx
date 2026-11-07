import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/AdminTabs";
import { getDb } from "@/db";
import { usdToGhs } from "@/server/fx";
import { requireUser } from "@/server/guards";
import { LIMITS, usageReport } from "@/server/usage";

export const metadata: Metadata = { title: "AI usage and costs" };
export const dynamic = "force-dynamic";

const TOOL = { stats: "Statistics", qual: "Qualitative", lit: "Literature" } as const;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function AdminUsage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireUser("ADMIN");
  const { m } = await searchParams;
  const now = new Date();
  const back = Math.max(0, Math.min(24, Number(m) || 0));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1));
  const db = getDb();
  const fx = await usdToGhs(db);
  const r = await usageReport(db, from, to, fx.rate);
  const ghs = (n: number) => `GH₵${Math.round(n * fx.rate).toLocaleString("en-GB")}`;
  const tools = (["stats", "qual", "lit"] as const).map((t) => {
    const rows = r.byTool.filter((x) => x.tool === t);
    const cost = rows.reduce((s, x) => s + x.cost, 0);
    const trial = rows.filter((x) => x.access === "trial").reduce((s, x) => s + x.cost, 0);
    const people = rows.reduce((s, x) => s + x.people, 0);
    return { t, cost, trial, people };
  });
  const trialCost = tools.reduce((s, x) => s + x.trial, 0);
  const margin = r.revenueUsd - r.costUsd;
  const month = from.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">AI usage and costs</h1>
        <p className="max-w-3xl text-ink-muted">What the AI tools cost to run, measured from every AI call and transcription, against what clients paid for plans. US$ at GH₵{fx.rate.toFixed(2)}.</p>
      </div>
      <AdminTabs active="/admin/usage" />
      <div className="flex items-center gap-3 text-sm">
        <Link href={`/admin/usage?m=${back + 1}`} className="font-bold text-green">‹ Earlier</Link>
        <span className="font-bold">{month}</span>
        {back > 0 && <Link href={`/admin/usage?m=${back - 1}`} className="font-bold text-green">Later ›</Link>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Plan payments (after Paystack)" value={usd(r.revenueUsd)} note={`${ghs(r.revenueUsd)} · ${r.payments} payment${r.payments === 1 ? "" : "s"}`} />
        <Kpi label="AI costs" value={usd(r.costUsd)} note={ghs(r.costUsd)} />
        <Kpi label="Kept after AI" value={usd(margin)} note={r.revenueUsd ? `${Math.round((margin / r.revenueUsd) * 100)}% of plan income` : "No plan payments yet"} tone={margin >= 0 ? "good" : "bad"} />
        <Kpi label="Spent on free trials" value={usd(trialCost)} note={r.costUsd ? `${Math.round((trialCost / r.costUsd) * 100)}% of AI costs` : "-"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {tools.map((x) => (
          <div key={x.t} className="card p-5">
            <span className="eyebrow">{TOOL[x.t]}</span>
            <p className="mt-1 text-2xl font-extrabold">{usd(x.cost)}</p>
            <p className="text-[13px] text-ink-muted">{x.people} {x.people === 1 ? "person" : "people"} · {usd(x.trial)} on trials</p>
            <p className="mt-2 text-[12px] text-ink-muted">Limits: paid {usd(LIMITS[x.t].paid.costUsd)}/month, trial {usd(LIMITS[x.t].trial.costUsd)} per person</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-parchment text-left text-xs tracking-wide text-ink-muted uppercase">
            <tr>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3 text-right">Statistics</th>
              <th className="px-4 py-3 text-right">Qualitative</th>
              <th className="px-4 py-3 text-right">Literature</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Used</th>
            </tr>
          </thead>
          <tbody>
            {r.topUsers.map((u) => (
              <tr key={u.userId ?? "none"} className="border-t border-line">
                <td className="px-4 py-3">
                  <div className="font-bold">{u.name ?? "Unknown"}</div>
                  <div className="text-xs text-ink-muted">{u.email}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{usd(u.stats)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{usd(u.qual)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{usd(u.lit)}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{usd(u.cost)}</td>
                <td className="px-4 py-3 text-xs text-ink-muted">
                  {[u.requests && `${Math.round(u.requests)} AI requests`, u.papers && `${Math.round(u.papers)} papers`, u.minutes && `${Math.round(u.minutes)} min transcribed`].filter(Boolean).join(" · ") || "-"}
                </td>
              </tr>
            ))}
            {!r.topUsers.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">No AI use recorded in {month} yet. Recording started on 7 November 2026.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "bad" }) {
  return (
    <div className="card p-5">
      <span className="text-[12.5px] font-bold text-ink-muted">{label}</span>
      <p className={`mt-1 text-2xl font-extrabold ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-green" : ""}`}>{value}</p>
      <p className="text-[12.5px] text-ink-muted">{note}</p>
    </div>
  );
}
