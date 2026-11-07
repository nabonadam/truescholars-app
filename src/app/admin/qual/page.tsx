import type { Metadata } from "next";
import { AdminTabs } from "@/components/AdminTabs";
import { QualEndAccessButton as EndAccessButton, QualGrantForm as GrantForm } from "@/components/qual/QualAdminForms";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { listToolUsers, timeLeft, toolTrialDays as trialDays } from "@/server/toolAccess";

export const metadata: Metadata = { title: "Qualitative Studio access" };
export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function AdminQual({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser("ADMIN");
  const { q } = await searchParams;
  const rows = await listToolUsers(getDb(), "qual", q);
  const now = new Date();
  const status = (r: (typeof rows)[number]) => {
    const trialEnd = new Date(r.trialStartedAt.getTime() + trialDays() * 86_400_000);
    if (r.accessUntil && r.accessUntil > now && r.accessUntil > trialEnd) return { text: `Access · ${timeLeft(r.accessUntil, now)} left`, tone: "bg-green-tint text-green", active: true };
    if (trialEnd > now) return { text: `Trial · ${timeLeft(trialEnd, now)} left`, tone: "bg-amber-tint text-amber-deep", active: true };
    return { text: "Ended", tone: "bg-line text-ink-muted", active: false };
  };
  const active = rows.filter((r) => status(r).active).length;
  const wanting = rows.filter((r) => r.upgradeRequestedAt).length;
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Qualitative Studio access</h1>
        <p className="text-ink-muted">
          Everyone gets a free {trialDays()}-day trial from the first time they open Qualitative Studio. Their live survey links keep collecting answers after the trial; transcription and analysis pause until you give access. Give more time here, for example after someone pays you directly.
        </p>
      </div>
      <AdminTabs active="/admin/qual" />
      <GrantForm />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">{rows.length} {rows.length === 1 ? "person has" : "people have"} tried it · {active} active now{wanting ? ` · ${wanting} waiting for an upgrade` : ""}</p>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search name or email" className="field py-2" />
          <button className="btn-outline min-h-10 px-4 text-sm">Search</button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-parchment text-left text-xs tracking-wide text-ink-muted uppercase">
            <tr>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Studies</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = status(r);
              return (
                <tr key={r.userId} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-bold">{r.name}</div>
                    <div className="text-xs text-ink-muted">{r.email}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{day(r.trialStartedAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${s.tone}`}>{s.text}</span>
                    {r.upgradeRequestedAt && <span className="ml-1.5 rounded-full bg-amber px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-ink">Wants to upgrade</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.items}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-ink-muted">{r.note}</td>
                  <td className="px-4 py-3 text-right">{s.active && <EndAccessButton userId={r.userId} />}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">No one has opened Qualitative Studio yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
