import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/AdminTabs";
import { Icon, type IconName } from "@/components/Icons";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { adminOverview, recentActivity, salesByCategory, type Activity } from "@/server/adminStats";
import { requireUser } from "@/server/guards";

export const metadata: Metadata = { title: "Admin overview" };
export const dynamic = "force-dynamic";

const cedi = (m: number) => formatMoney(m).replace(/\.00$/, "");
const short = (m: number) => (m >= 100_000_00 ? `GH₵${(m / 100_000_00).toFixed(1)}m` : m >= 1_000_00 ? `GH₵${(m / 1_000_00).toFixed(1)}k` : cedi(m));

function niceMax(v: number) {
  if (v <= 0) return 100_00;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

const ACT: Record<Activity["kind"], { icon: IconName; tone: string }> = {
  signup: { icon: "spark", tone: "bg-green-tint text-green" },
  paid: { icon: "lock", tone: "bg-green text-amber" },
  job: { icon: "briefcase", tone: "bg-parchment text-ink" },
  dispute: { icon: "scale", tone: "bg-amber text-ink" },
  payout: { icon: "wallet", tone: "bg-amber-tint text-amber-deep" },
  application: { icon: "shield", tone: "bg-green-tint text-green" },
};

export default async function AdminOverview() {
  const user = await requireUser("ADMIN");
  const db = getDb();
  const [o, cats, activity] = await Promise.all([adminOverview(db), salesByCategory(db), recentActivity(db, 12)]);
  const { money: m, people, work, queues: q, days } = o;
  const peak = niceMax(Math.max(...days.map((d) => d.paidIn)));
  const delta = m.paidInPrev30 ? Math.round(((m.paidIn30 - m.paidInPrev30) / m.paidInPrev30) * 100) : null;
  const catPeak = Math.max(1, ...cats.map((c) => c.minor));
  const hour = new Date().getUTCHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const waiting = q.applications + q.disputes + q.payouts + q.flagged;

  const queues: { href: string; label: string; n: number; note: string; icon: IconName; hot: boolean }[] = [
    { href: "/admin/applications", label: "Expert applications", n: q.applications, note: q.applications ? "Waiting for review" : "All reviewed", icon: "shield", hot: q.applications > 0 },
    { href: "/admin/disputes", label: "Open disputes", n: q.disputes, note: q.disputes ? "Payments frozen" : "None open", icon: "scale", hot: q.disputes > 0 },
    { href: "/admin/payouts", label: "Payouts to send", n: q.payouts, note: q.payouts ? `${cedi(q.payoutsMinor)} in total` : "Nothing to send", icon: "wallet", hot: q.payouts > 0 },
    { href: "/admin/messages", label: "Flagged messages", n: q.flagged, note: "Possible off-platform contact", icon: "message", hot: false },
  ];

  return (
    <>
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="pointer-events-none absolute -top-24 -right-20 size-96 rounded-full bg-amber/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 left-1/4 size-72 rounded-full bg-green/40" aria-hidden="true" />
        <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-xs font-bold tracking-wider text-amber uppercase">Admin · platform at a glance</span>
              <h1 className="text-3xl font-extrabold text-white sm:text-4xl">{greeting}, {user.name?.split(" ")[0] ?? "admin"}</h1>
              <p className="text-on-green-muted">{waiting ? `${waiting} thing${waiting === 1 ? "" : "s"} waiting for the team.` : "Nothing is waiting for the team. Nice."}</p>
            </div>
            <span className="rounded-full bg-white/10 px-4 py-2 text-sm">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</span>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {queues.map((x) => (
              <li key={x.href}>
                <Link href={x.href} className={`flex h-full items-center gap-4 rounded-md p-4 no-underline transition-transform hover:-translate-y-0.5 ${x.hot ? "bg-amber text-ink" : "bg-white/8 text-white hover:bg-white/12"}`}>
                  <span className={`grid size-11 flex-none place-items-center rounded-full ${x.hot ? "bg-ink text-amber" : "bg-white/10 text-amber"}`}><Icon name={x.icon} size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{x.label}</span>
                    <span className={`block truncate text-xs ${x.hot ? "text-ink/70" : "text-on-green-muted"}`}>{x.note}</span>
                  </span>
                  <span className="font-display text-3xl font-extrabold">{x.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
        <AdminTabs active="/admin" counts={{ "/admin/applications": q.applications, "/admin/disputes": q.disputes, "/admin/payouts": q.payouts }} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Paid in · 30 days" value={cedi(m.paidIn30)} note={delta === null ? `${cedi(m.paidInAll)} since launch` : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% on the 30 days before`} accent />
          <Kpi label="Held in escrow now" value={cedi(m.escrowNow)} note="Released when clients approve" />
          <Kpi label="Platform fees · 30 days" value={cedi(m.fees30)} note={`${cedi(m.feesAll)} since launch`} />
          <Kpi label="Owed to experts" value={cedi(m.owedToExperts)} note={`${cedi(m.paidOut)} paid out so far`} />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[1.7fr_1fr]">
          <div className="card flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold">Money paid in, last 30 days</h2>
                <p className="text-sm text-ink-muted">Payments clients made into escrow, per day. Hover a day for details.</p>
              </div>
              <span className="font-display text-2xl font-bold">{cedi(m.paidIn30)}</span>
            </div>
            <div className="relative h-56 pl-14">
              {[1, 0.5, 0].map((f) => (
                <div key={f} className="absolute right-0 left-14 border-t border-line" style={{ bottom: `${f * 100}%` }}>
                  <span className="absolute -top-2 -left-14 w-12 text-right text-[11px] text-ink-muted">{short(peak * f)}</span>
                </div>
              ))}
              <div className="relative flex h-full items-end gap-[2px]" role="img" aria-label={`Money paid in per day. Highest day ${cedi(Math.max(...days.map((d) => d.paidIn)))}.`}>
                {days.map((d) => (
                  <div key={d.key} className="group relative flex h-full flex-1 items-end">
                    <div className={`w-full rounded-t-[4px] ${d.paidIn ? "bg-green group-hover:bg-amber" : "bg-line/60"}`} style={{ height: d.paidIn ? `${Math.max(2, (d.paidIn / peak) * 100)}%` : "2px" }} />
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-sm bg-ink px-3 py-2 text-xs whitespace-nowrap text-white shadow-lg group-hover:block">
                      <b>{d.label}</b>
                      <div>{cedi(d.paidIn)} paid in</div>
                      <div className="text-on-green-muted">{d.signups} new account{d.signups === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-between pl-14 text-[11px] text-ink-muted">
              <span>{days[0].label}</span>
              <span>{days[14].label}</span>
              <span>Today</span>
            </div>
            <table className="sr-only">
              <caption>Money paid in per day</caption>
              <tbody>{days.map((d) => <tr key={d.key}><th>{d.label}</th><td>{cedi(d.paidIn)}</td></tr>)}</tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Mini icon="spark" label="People" value={String(people.users)} note={`${people.new30} joined in 30 days`} />
            <Mini icon="shield" label="Verified experts" value={String(people.experts)} note={people.users ? `${Math.round((people.experts / people.users) * 100)}% of accounts` : ""} />
            <Mini icon="clock" label="Orders in progress" value={String(work.activeOrders)} note={`${work.completed30} completed in 30 days`} />
            <Mini icon="briefcase" label="Open jobs" value={String(work.openJobs)} note={`${work.proposals30} proposals in 30 days`} />
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="card flex flex-col gap-4">
            <h2 className="text-xl font-bold">Where the work is</h2>
            {cats.length === 0 ? (
              <p className="text-ink-muted">Sales by category will appear once orders are paid.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {cats.map((c) => (
                  <li key={c.name} className="flex flex-col gap-1">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-bold">{c.name}</span>
                      <span className="text-ink-muted">{c.orders} order{c.orders === 1 ? "" : "s"} · <b className="text-ink">{cedi(c.minor)}</b></span>
                    </div>
                    <div className="h-2.5 rounded-full bg-parchment">
                      <div className="h-full rounded-full bg-green" style={{ width: `${(c.minor / catPeak) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card flex flex-col gap-3">
            <h2 className="text-xl font-bold">Latest activity</h2>
            <ul className="flex flex-col">
              {activity.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="flex items-center gap-3 rounded-sm px-2 py-2.5 text-sm text-ink no-underline hover:bg-parchment">
                    <span className={`grid size-8 flex-none place-items-center rounded-full ${ACT[a.kind].tone}`}><Icon name={ACT[a.kind].icon} size={15} /></span>
                    <span className="min-w-0 flex-1 truncate">{a.text}</span>
                    <span className="flex-none text-xs text-ink-muted">{ago(a.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

function Kpi({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-md border p-5 ${accent ? "border-green bg-green text-white" : "border-line bg-white"}`}>
      <span className={`text-xs font-bold tracking-wide uppercase ${accent ? "text-on-green-muted" : "text-ink-muted"}`}>{label}</span>
      <span className={`font-display text-3xl font-extrabold ${accent ? "text-amber" : ""}`}>{value}</span>
      <span className={`text-xs ${accent ? "text-on-green-muted" : "text-ink-muted"}`}>{note}</span>
    </div>
  );
}

function Mini({ icon, label, value, note }: { icon: IconName; label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-white p-4">
      <Icon name={icon} size={18} className="text-green" />
      <span className="text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</span>
      <span className="font-display text-2xl font-bold">{value}</span>
      <span className="text-xs text-ink-muted">{note}</span>
    </div>
  );
}
