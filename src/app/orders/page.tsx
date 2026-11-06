import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Avatar } from "@/components/People";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS } from "@/lib/status";
import { ago } from "@/lib/time";
import { progressStep } from "@/server/dashboard";
import { earningsSummary } from "@/server/payouts";
import { requireUser } from "@/server/guards";
import { orderBoard, type BoardOrder } from "@/server/orderBoard";
import { clientEscrowTotal } from "@/server/orders";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { v: "active", label: "Active" },
  { v: "you", label: "Needs you" },
  { v: "done", label: "Completed" },
  { v: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["v"];

const isActive = (o: BoardOrder) => !["COMPLETED", "CANCELLED"].includes(o.status);
const needsYou = (o: BoardOrder) => o.next.mine && Boolean(o.next.cta);
const cedi = (m: number) => formatMoney(m).replace(/\.00$/, "");

export default async function Orders({ searchParams }: { searchParams: Promise<{ view?: string; show?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const isExpert = user.roles.includes("EXPERT");
  const all = await orderBoard(db, user.id);
  const buying = all.filter((o) => o.role === "buying");
  const selling = all.filter((o) => o.role === "selling");
  const view = sp.view === "selling" && isExpert ? "selling" : sp.view === "buying" ? "buying" : isExpert && selling.length > buying.length ? "selling" : "buying";
  const list = view === "selling" ? selling : buying;
  const filter: Filter = (FILTERS.some((f) => f.v === sp.show) ? sp.show : "active") as Filter;
  const shown = list.filter((o) => (filter === "active" ? isActive(o) : filter === "you" ? needsYou(o) : filter === "done" ? o.status === "COMPLETED" : true));
  const counts = { active: list.filter(isActive).length, you: list.filter(needsYou).length, done: list.filter((o) => o.status === "COMPLETED").length, all: list.length };

  const [escrow, earnings] = await Promise.all([view === "buying" ? clientEscrowTotal(db, user.id) : Promise.resolve(0), view === "selling" ? earningsSummary(db, user.id) : Promise.resolve(null)]);
  const spent = buying.filter((o) => !["AWAITING_PAYMENT", "CANCELLED"].includes(o.status)).reduce((s, o) => s + o.totalMinor, 0);
  const href = (o: { view?: string; show?: string }) => {
    const p = new URLSearchParams({ view: o.view ?? view, ...(o.show ?? filter) !== "active" ? { show: o.show ?? filter } : {} });
    return `/orders?${p}`;
  };

  const stats =
    view === "buying"
      ? [
          { label: "In progress", value: String(counts.active), icon: "clock" as const },
          { label: "Need you", value: String(counts.you), icon: "spark" as const, hot: counts.you > 0 },
          { label: "Held in escrow", value: cedi(escrow), icon: "lock" as const },
          { label: "Spent so far", value: cedi(spent), icon: "receipt" as const },
        ]
      : [
          { label: "Active sales", value: String(counts.active), icon: "clock" as const },
          { label: "Need you", value: String(counts.you), icon: "spark" as const, hot: counts.you > 0 },
          { label: "In escrow for you", value: cedi(earnings?.inEscrow ?? 0), icon: "lock" as const },
          { label: "Earned so far", value: cedi(earnings?.earned ?? 0), icon: "wallet" as const },
        ];

  return (
    <>
      <section className="bg-green text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 pt-8 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-xs font-bold tracking-wider text-amber uppercase">Orders</span>
              <h1 className="text-3xl font-extrabold text-white sm:text-4xl">{view === "buying" ? "What you're buying" : "What you're selling"}</h1>
            </div>
            <div className="flex gap-2">
              {view === "buying" ? (
                <>
                  <Link href="/jobs/new" className="btn-amber">Post a job</Link>
                  <Link href="/services" className="inline-flex min-h-11 items-center rounded-full border border-white/40 px-5 text-[15px] font-bold text-white no-underline">Find an expert</Link>
                </>
              ) : (
                <Link href="/jobs" className="btn-amber">Find work</Link>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className={`flex items-center gap-3 rounded-md p-4 ${"hot" in s && s.hot ? "bg-amber text-ink" : "bg-white/8"}`}>
                <span className={`grid size-10 flex-none place-items-center rounded-full ${"hot" in s && s.hot ? "bg-ink text-amber" : "bg-white/10 text-amber"}`}><Icon name={s.icon} size={18} /></span>
                <div className="min-w-0">
                  <div className={`truncate text-xs font-bold ${"hot" in s && s.hot ? "text-ink/70" : "text-on-green-muted"}`}>{s.label}</div>
                  <div className="font-display text-xl font-bold sm:text-2xl">{s.value}</div>
                </div>
              </div>
            ))}
          </div>
          {isExpert ? (
            <nav className="-mb-px flex gap-1" aria-label="Buying or selling">
              {(["buying", "selling"] as const).map((v) => (
                <Link key={v} href={href({ view: v, show: "active" })} aria-current={view === v ? "page" : undefined} className={`rounded-t-md px-5 py-3 text-sm font-bold no-underline ${view === v ? "bg-parchment text-ink" : "text-on-green-muted hover:text-white"}`}>
                  {v === "buying" ? "Buying" : "Selling"} <span className={`ml-1 rounded-full px-2 text-xs ${view === v ? "bg-white" : "bg-white/10"}`}>{v === "buying" ? buying.length : selling.length}</span>
                </Link>
              ))}
            </nav>
          ) : (
            <div className="h-4" />
          )}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <nav className="flex flex-wrap gap-2" aria-label="Filter orders">
          {FILTERS.map((f) => (
            <Link key={f.v} href={href({ show: f.v })} aria-current={filter === f.v ? "true" : undefined} className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold no-underline ${filter === f.v ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink/40"}`}>
              {f.label}
              <span className={`rounded-full px-2 text-xs ${filter === f.v ? "bg-white/20" : f.v === "you" && counts.you ? "bg-amber text-ink" : "bg-parchment"}`}>{counts[f.v]}</span>
            </Link>
          ))}
        </nav>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-line bg-white/60 px-6 py-14 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-green text-amber"><Icon name={filter === "you" ? "check" : "package"} size={28} /></span>
            <h2 className="text-xl font-bold">{filter === "you" ? "Nothing needs you right now" : list.length === 0 ? (view === "buying" ? "No orders yet" : "No sales yet") : "Nothing here"}</h2>
            <p className="max-w-md text-ink-muted">
              {list.length === 0
                ? view === "buying"
                  ? "Hire a vetted expert from a ready-made package, or post a job and let experts send you proposals."
                  : "Publish a service or send proposals on open jobs. Your sales show up here."
                : "Try another filter."}
            </p>
            {list.length === 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {view === "buying" ? (
                  <>
                    <Link href="/services" className="btn-primary">Find an expert</Link>
                    <Link href="/jobs/new" className="btn-outline">Post a job</Link>
                  </>
                ) : (
                  <>
                    <Link href="/jobs" className="btn-primary">Find work</Link>
                    <Link href="/expert/services" className="btn-outline">My services</Link>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((o) => (
              <li key={o.id}>
                <OrderCard o={o} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function OrderCard({ o }: { o: BoardOrder }) {
  const status = ORDER_STATUS[o.status];
  const multi = o.milestones.length > 1;
  const step = progressStep(o.status, o.milestones.map((m) => m.status));
  const rail = o.disputeId ? "bg-ink" : o.next.mine && o.next.urgent ? "bg-amber" : o.status === "COMPLETED" ? "bg-green/30" : "bg-green";
  const actionHref = o.disputeId ? `/disputes/${o.disputeId}` : `/orders/${o.id}`;
  return (
    <article className="group relative flex overflow-hidden rounded-md border border-line bg-white transition-shadow hover:shadow-lg">
      <span className={`w-1.5 flex-none ${rail}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <Link href={`/orders/${o.id}`} className="flex min-w-0 flex-1 items-center gap-4 text-ink no-underline">
          <Avatar name={o.other} size={52} tone={o.role === "buying" ? "green" : "amber"} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              <span className="font-bold text-ink">{o.other}</span>
              {o.category && <><span>·</span><span>{o.category}</span></>}
              <span>·</span>
              <span>{ago(o.createdAt)}</span>
              <span className={`rounded-full px-2 py-0.5 font-bold ${status.tone}`}>{status.label}</span>
            </div>
            <h2 className="truncate font-display text-lg font-bold group-hover:text-green">{o.title}</h2>
            {/* Progress: one segment per milestone, or the four stages for a single package */}
            <div className="flex items-center gap-3">
              <div className="flex max-w-56 flex-1 gap-1" aria-hidden="true">
                {(multi ? o.milestones.map((m) => (m.status === "APPROVED" ? 2 : m.status === "PENDING_FUNDING" ? 0 : 1)) : [0, 1, 2, 3].map((i) => (i <= step ? 2 : 0))).map((v, i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full ${v === 2 ? "bg-green" : v === 1 ? "bg-amber" : "bg-line"}`} />
                ))}
              </div>
              <span className="text-xs text-ink-muted">
                {multi ? `${o.approvedCount} of ${o.milestones.length} milestones done` : ["Paid", "In progress", "Delivered", "Approved"][Math.max(0, step)] ?? ""}
              </span>
            </div>
          </div>
        </Link>
        <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <span className="font-display text-xl font-bold">{formatMoney(o.totalMinor, o.currency).replace(/\.00$/, "")}</span>
          <div className="flex flex-wrap items-center gap-2">
            {o.unread > 0 && (
              <Link href={`/messages?c=${o.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-green-tint px-3 py-1.5 text-xs font-bold text-green no-underline">
                <Icon name="message" size={14} /> {o.unread} new
              </Link>
            )}
            {o.next.cta ? (
              <Link href={actionHref} className={`inline-flex items-center rounded-full px-4 py-1.5 text-xs font-bold no-underline ${o.next.urgent ? "bg-amber text-ink" : "bg-green text-white"}`}>
                {o.next.cta} →
              </Link>
            ) : null}
          </div>
          <span className={`text-xs sm:text-right ${o.next.mine && o.next.urgent ? "font-bold text-amber-deep" : "text-ink-muted"}`}>{o.next.text}</span>
        </div>
      </div>
    </article>
  );
}
