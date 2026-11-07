import { count, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { startTestPayment } from "@/app/actions/payments";
import { Icon, IconTile, type IconName } from "@/components/Icons";
import { OrderProgress } from "@/components/OrderProgress";
import { ToolsShelf } from "@/components/ToolsShelf";
import { Avatar } from "@/components/UserAvatar";
import { getDb } from "@/db";
import { milestones, qualStudies, statSessions } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { isTestMode, paystackConfigured } from "@/lib/paystack";
import { ORDER_STATUS } from "@/lib/status";
import { attentionItems, progressStep } from "@/server/dashboard";
import { expertAvailable } from "@/server/escrow";
import { requireUser } from "@/server/guards";
import { peekAccess } from "@/server/statsAccess";
import { peekToolAccess } from "@/server/toolAccess";
import { unreadNotificationCount } from "@/server/notifications";
import { listFlaggedMessages, unreadByOrder } from "@/server/orderRoom";
import { clientEscrowTotal, listOrdersForUser } from "@/server/orders";
import { listServicesForExpert } from "@/server/services";
import { budgetLabel, creditBalance, expertProfileOf, recommendedJobs } from "@/server/jobs";
import { openDisputeCount } from "@/server/disputes";
import { LEVEL_INFO, type Level } from "@/server/levels";
import { listWithdrawals } from "@/server/payouts";
import { getApplicationForUser, listApplications } from "@/server/vetting";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const APP_STATUS: Record<string, string> = {
  SUBMITTED: "Application received: awaiting review",
  IN_REVIEW: "Application under review",
  REJECTED: "Not approved yet: you can update and reapply",
};
const OPEN = ["AWAITING_PAYMENT", "ACTIVE", "DELIVERED", "DISPUTED"];

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Accra" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Stat({ icon, tone, label, value, note }: { icon: IconName; tone: "green" | "amber" | "solid"; label: string; value: string; note: string }) {
  return (
    <div className="card flex items-start gap-4">
      <IconTile name={icon} tone={tone} size={48} />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-bold text-ink-muted">{label}</span>
        <span className="font-display text-2xl font-bold break-words tabular-nums lg:text-[1.65rem]">{value}</span>
        <span className="text-xs text-ink-muted">{note}</span>
      </div>
    </div>
  );
}

function Step({ n, icon, title, body, done }: { n: number; icon: IconName; title: string; body: string; done?: boolean }) {
  return (
    <li className="flex flex-col gap-3 rounded-md bg-white/70 p-4">
      <div className="flex items-center gap-3">
        <IconTile name={done ? "check" : icon} tone={done ? "solid" : "amber"} size={40} />
        <span className="text-xs font-bold tracking-wide text-ink-muted uppercase">Step {n}{done ? " · done" : ""}</span>
      </div>
      <div className="font-display text-lg font-bold">{title}</div>
      <p className="text-sm text-ink-muted">{body}</p>
    </li>
  );
}

export default async function Dashboard() {
  const user = await requireUser();
  const db = getDb();
  const isExpert = user.roles.includes("EXPERT");
  const isAdmin = user.roles.includes("ADMIN");

  const [orders, attention, inEscrow, available, services, application, openApps, flagged, unreadNotes, unreadMap] = await Promise.all([
    listOrdersForUser(db, user.id),
    attentionItems(db, user.id),
    clientEscrowTotal(db, user.id),
    isExpert ? expertAvailable(db, user.id) : Promise.resolve(0),
    isExpert ? listServicesForExpert(db, user.id) : Promise.resolve([]),
    isExpert ? Promise.resolve(null) : getApplicationForUser(db, user.id),
    isAdmin ? listApplications(db).then((r) => r.filter((a) => a.status === "SUBMITTED" || a.status === "IN_REVIEW").length) : Promise.resolve(0),
    isAdmin ? listFlaggedMessages(db).then((r) => r.length) : Promise.resolve(0),
    unreadNotificationCount(db, user.id),
    unreadByOrder(db, user.id),
  ]);
  const [statsAccess, statsSessions, qualAccess, qualStudyCount] = await Promise.all([
    peekAccess(db, user),
    db.select({ n: count() }).from(statSessions).where(eq(statSessions.ownerId, user.id)).then((r) => Number(r[0]?.n ?? 0)),
    peekToolAccess(db, "qual", user),
    db.select({ n: count() }).from(qualStudies).where(eq(qualStudies.ownerId, user.id)).then((r) => Number(r[0]?.n ?? 0)),
  ]);
  const unreadMsgs = [...unreadMap.values()].reduce((a, b) => a + b, 0);
  const profile = isExpert ? await expertProfileOf(db, user.id) : null;
  const [adminDisputes, adminPayouts] = isAdmin ? await Promise.all([openDisputeCount(db), listWithdrawals(db).then((r) => r.length)]) : [0, 0];
  const level = (profile?.level ?? "NEW") as Level;
  const [jobsForYou, credits] = profile ? await Promise.all([recommendedJobs(db, user.id, 3), creditBalance(db, profile.id)]) : [[], 0];

  const buying = orders.filter((o) => o.clientId === user.id);
  const selling = orders.filter((o) => o.expertId === user.id);
  const active = orders.filter((o) => OPEN.includes(o.status)).slice(0, 4);
  const ms = active.length ? await db.select({ orderId: milestones.orderId, status: milestones.status }).from(milestones).where(inArray(milestones.orderId, active.map((o) => o.id))) : [];
  const liveServices = services.filter((s) => s.status === "ACTIVE").length;
  const totalSpent = buying.filter((o) => o.status !== "AWAITING_PAYMENT" && o.status !== "CANCELLED").reduce((s, o) => s + o.totalMinor, 0);
  const firstName = user.name?.split(" ")[0] ?? "there";
  const isNewClient = !isExpert && buying.length === 0;
  const urgent = attention.filter((a) => a.urgent).length;

  return (
    <>
      {/* ───── Welcome banner ───── */}
      <section className="relative overflow-hidden bg-green text-white">
        <div className="pointer-events-none absolute -top-40 -right-32 size-[26rem] rounded-full bg-amber/15" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full border-2 border-dashed border-white/15" aria-hidden="true" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
          <div className="flex items-center gap-4">
            <Link href="/settings" aria-label="Account settings" className="rounded-full ring-2 ring-white/30">
              <Avatar name={user.name ?? "?"} size={56} tone="amber" src={user.image} />
            </Link>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-on-green-muted">{greeting()},</span>
              <h1 className="text-3xl font-extrabold text-white sm:text-4xl">{firstName}</h1>
            </div>
          </div>
          <p className="max-w-2xl text-lg text-on-green-muted">
            {attention.length === 0
              ? isNewClient
                ? "Welcome to The True Scholars. Vetted experts, real sources, and your money protected until you're happy."
                : "You're all caught up. Nothing needs your attention right now."
              : `You have ${attention.length} thing${attention.length === 1 ? "" : "s"} to look at${urgent ? `, ${urgent} of them time-sensitive` : ""}.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/jobs/new" className="btn-amber"><Icon name="briefcase" size={18} /> Post a job</Link>
            <Link href="/services" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-bold text-green no-underline"><Icon name="search" size={18} /> Find an expert</Link>
            {isExpert && (
              <Link href="/jobs" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/40 px-5 text-[15px] font-bold text-white no-underline">
                <Icon name="spark" size={18} /> Find work
              </Link>
            )}
            <Link href="/orders" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/40 px-5 text-[15px] font-bold text-white no-underline">
              My orders
            </Link>
            <Link href="/messages" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/40 px-5 text-[15px] font-bold text-white no-underline">
              <Icon name="message" size={18} /> Messages{unreadMsgs > 0 ? ` (${unreadMsgs})` : ""}
            </Link>
            <Link href="/notifications" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/40 px-5 text-[15px] font-bold text-white no-underline">
              <Icon name="bell" size={18} /> Notifications{unreadNotes > 0 ? ` (${unreadNotes})` : ""}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {user.roles.map((r) => (
              <span key={r} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">{r.charAt(0) + r.slice(1).toLowerCase()}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        {/* ───── AI tools ───── */}
        <ToolsShelf stats={{ ...statsAccess, sessions: statsSessions }} qual={{ ...qualAccess, studies: qualStudyCount }} />

        {/* ───── Onboarding ───── */}
        {isNewClient && (
          <div className="flex flex-col gap-4 rounded-lg bg-amber-tint p-6">
            <h2 className="text-2xl font-bold">Get research help in three steps</h2>
            <ol className="grid gap-4 md:grid-cols-3">
              <Step n={1} icon="search" title="Find an expert or post a job" body="Pick a ready-made package, or describe your project and let vetted experts send you proposals." />
              <Step n={2} icon="lock" title="Pay into escrow" body="Mobile Money or card. The expert isn't paid until you approve the work." />
              <Step n={3} icon="star" title="Approve and review" body="Get your delivery, ask for revisions if needed, then approve and rate." />
            </ol>
          </div>
        )}
        {isExpert && selling.length === 0 && (
          <div className="flex flex-col gap-4 rounded-lg bg-amber-tint p-6">
            <h2 className="text-2xl font-bold">Set up to get your first order</h2>
            <ol className="grid gap-4 md:grid-cols-3">
              <Step n={1} icon="shield" title="Get vetted" body="Your credentials have been approved." done />
              <Step n={2} icon="package" title="Publish a service" body="Clear packages with prices and delivery times." done={liveServices > 0} />
              <Step n={3} icon="wallet" title="Deliver your first order" body="Clients pay into escrow; you're paid when they approve." />
            </ol>
            {liveServices === 0 && <Link href="/expert/services/new" className="btn-primary self-start">Create your first service</Link>}
          </div>
        )}

        {/* ───── Numbers ───── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isExpert && (
            <>
              <Link href="/earnings" className="text-ink no-underline transition-shadow hover:shadow-md [&>div]:h-full">
                <Stat icon="wallet" tone="solid" label="Earnings available" value={formatMoney(available)} note="Withdraw to Mobile Money →" />
              </Link>
              <Stat icon="clock" tone="green" label="Active sales" value={String(selling.filter((o) => OPEN.includes(o.status)).length)} note={`${selling.length} in total`} />
              <Stat icon="package" tone="amber" label="Live services" value={String(liveServices)} note={`${services.length} created`} />
            </>
          )}
          <Stat icon="lock" tone={isExpert ? "green" : "solid"} label="In escrow" value={formatMoney(inEscrow)} note="Held safely until you approve" />
          {!isExpert && (
            <>
              <Stat icon="clock" tone="green" label="Active orders" value={String(buying.filter((o) => OPEN.includes(o.status)).length)} note={`${buying.length} in total`} />
              <Stat icon="receipt" tone="amber" label="Total spent" value={formatMoney(totalSpent)} note="Receipts on each order" />
            </>
          )}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-6">
            {/* ───── Needs your attention ───── */}
            <div className="card flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">Needs your attention</h2>
                {attention.length > 0 && <span className="rounded-full bg-amber px-2.5 py-0.5 text-xs font-bold text-ink">{attention.length}</span>}
              </div>
              {attention.length === 0 ? (
                <div className="flex items-center gap-4 rounded-md bg-green-tint p-4">
                  <IconTile name="check" tone="solid" size={44} />
                  <p className="text-green"><b>All caught up.</b> We&apos;ll let you know when something needs you.</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {attention.map((a) => (
                    <li key={a.key}>
                      <Link href={a.href} className={`flex items-center gap-4 rounded-md border p-3 text-ink no-underline transition-colors hover:bg-parchment ${a.urgent ? "border-amber bg-amber-tint/40" : "border-line"}`}>
                        <IconTile name={a.icon} tone={a.tone} size={42} />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">{a.title}</div>
                          <div className="text-sm text-ink-muted">{a.detail}</div>
                        </div>
                        <span className="hidden rounded-full bg-green px-4 py-2 text-sm font-bold text-white sm:inline">{a.cta}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ───── Active orders with progress ───── */}
            <div className="card flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Active orders</h2>
                {orders.length > 0 && <Link href="/orders" className="text-sm font-bold text-green">All orders →</Link>}
              </div>
              {active.length === 0 ? (
                <p className="text-ink-muted">
                  No active orders.{" "}
                  {isExpert ? "New orders from clients appear here." : <Link href="/services" className="font-bold text-green">Find an expert to get started</Link>}
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {active.map((o) => (
                    <li key={o.id}>
                      <Link href={`/orders/${o.id}`} className="flex flex-col gap-4 rounded-md border border-line p-4 text-ink no-underline hover:shadow-md">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-bold">{o.title}</div>
                            <div className="text-xs text-ink-muted">{o.clientId === user.id ? "Buying" : "Selling"} · {formatMoney(o.totalMinor, o.currency)}</div>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${ORDER_STATUS[o.status].tone}`}>{ORDER_STATUS[o.status].label}</span>
                        </div>
                        <OrderProgress step={progressStep(o.status, ms.filter((m) => m.orderId === o.id).map((m) => m.status))} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ───── Side panel ───── */}
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-lg bg-ink p-6 text-white">
              <IconTile name="shield" tone="solid" size={44} />
              <h2 className="text-lg font-bold text-white">How you&apos;re protected</h2>
              <p className="text-sm text-on-green-muted">Your payment sits in escrow until you approve the delivery. Revisions are included, and our team steps in if you can&apos;t agree.</p>
            </div>

            {isExpert && (
              <Link href="/expert/level" className="flex items-center gap-4 rounded-lg bg-amber-tint p-5 text-ink no-underline transition-shadow hover:shadow-md">
                <span className="grid size-12 flex-none place-items-center rounded-full bg-amber text-ink"><Icon name="trophy" size={24} /></span>
                <span className="flex-1">
                  <span className="block text-xs font-bold tracking-wide text-amber-deep uppercase">Your level</span>
                  <span className="block font-display text-xl font-bold">{LEVEL_INFO[level].name}</span>
                  <span className="text-sm text-ink-muted">{level === "TOP_RATED" ? "You're at the top." : "See what unlocks the next level →"}</span>
                </span>
              </Link>
            )}

            {isExpert && (
              <div className="card flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">Jobs for you</h2>
                  <span className="rounded-full bg-amber-tint px-3 py-1 text-xs font-bold text-amber-deep">{credits} credits</span>
                </div>
                {jobsForYou.length === 0 ? (
                  <p className="text-sm text-ink-muted">No matching jobs right now. We&apos;ll notify you when one is posted in your categories.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line">
                    {jobsForYou.map((j) => (
                      <li key={j.id}>
                        <Link href={`/jobs/${j.id}`} className="flex flex-col gap-0.5 py-3 text-ink no-underline hover:text-green">
                          <span className="line-clamp-2 font-bold">{j.title}</span>
                          <span className="text-xs text-ink-muted">{budgetLabel(j)} · {j.proposalCount === 0 ? "no proposals yet" : `${j.proposalCount} proposal${j.proposalCount === 1 ? "" : "s"}`}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/jobs" className="btn-primary">Browse all jobs</Link>
              </div>
            )}

            {isExpert ? (
              <div className="card flex flex-col gap-3">
                <IconTile name="package" tone="amber" />
                <h2 className="text-lg font-bold">Your services</h2>
                <p className="text-sm text-ink-muted">Clear packages win orders. Keep yours up to date.</p>
                <Link href="/expert/services" className="btn-primary">My services</Link>
              </div>
            ) : (
              <div className="card flex flex-col gap-3">
                <IconTile name="spark" tone="amber" />
                <h2 className="text-lg font-bold">Become an expert</h2>
                <p className="text-sm text-ink-muted">{application ? APP_STATUS[application.status] : "Statistician, editor or methodologist? Earn by helping researchers."}</p>
                <Link href="/apply" className="btn-outline">{application ? "View application" : "Apply now"}</Link>
              </div>
            )}

            {isAdmin && (
              <div className="card flex flex-col gap-3 border-green">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">Admin</h2>
                  <Link href="/admin" className="text-sm font-bold text-green">Overview →</Link>
                </div>
                <Link href="/admin/applications" className="flex items-center justify-between font-bold text-green no-underline">
                  Expert applications <span className="rounded-full bg-amber-tint px-3 py-1 text-xs text-amber-deep">{openApps} to review</span>
                </Link>
                <Link href="/admin/disputes" className="flex items-center justify-between font-bold text-green no-underline">
                  Open disputes <span className="rounded-full bg-amber-tint px-3 py-1 text-xs text-amber-deep">{adminDisputes}</span>
                </Link>
                <Link href="/admin/payouts" className="flex items-center justify-between font-bold text-green no-underline">
                  Payouts to send <span className="rounded-full bg-amber-tint px-3 py-1 text-xs text-amber-deep">{adminPayouts}</span>
                </Link>
                <Link href="/admin/messages" className="flex items-center justify-between font-bold text-green no-underline">
                  Flagged messages <span className="rounded-full bg-amber-tint px-3 py-1 text-xs text-amber-deep">{flagged}</span>
                </Link>
                {paystackConfigured() && isTestMode() && (
                  <form action={startTestPayment} className="border-t border-line pt-3">
                    <button className="text-sm font-bold text-ink-muted underline">Run a GH₵1 Paystack test payment</button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
