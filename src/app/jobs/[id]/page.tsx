import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { closeJobAction, declineAction, shortlistAction, withdrawAction } from "@/app/actions/jobs";
import { auth } from "@/auth";
import { FileLinks } from "@/components/ChatThread";
import { Icon } from "@/components/Icons";
import { HireButton, ProposalForm } from "@/components/JobForms";
import { proposalsBand, timelineLabel } from "@/components/JobCard";
import { Avatar, LEVEL_LABEL, Stars } from "@/components/People";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago, memberSince } from "@/lib/time";
import { fileMeta } from "@/server/files";
import {
  budgetLabel,
  clientStats,
  creditBalance,
  creditsFor,
  expertProfileOf,
  getJob,
  LEVELS,
  listProposalsForJob,
  myProposal,
  type Level,
  type ProposalView,
} from "@/server/jobs";
import { markLinkNotificationsRead } from "@/server/notifications";
import { platformFeeBps } from "@/server/orders";

export const metadata: Metadata = { title: "Job" };
export const dynamic = "force-dynamic";

const TABS = [
  { v: "all", label: "All" },
  { v: "new", label: "New" },
  { v: "shortlisted", label: "Shortlisted" },
  { v: "declined", label: "Declined" },
] as const;
const SORTS = [
  { v: "match", label: "Best match" },
  { v: "price", label: "Lowest price" },
  { v: "fast", label: "Fastest" },
  { v: "rating", label: "Top rated" },
] as const;

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const job = await getJob(db, id).catch(() => null);
  if (!job) notFound();
  const session = await auth().catch(() => null);
  const user = session?.user;
  const isOwner = user?.id === job.clientId;
  if (job.status === "CANCELLED" && !isOwner) notFound();

  const files = new Map((await fileMeta(db, job.attachments)).map((f) => [f.id, f]));
  const meta = (
    <div className="flex flex-wrap gap-2 text-sm">
      <Chip icon="wallet">{budgetLabel(job)} · fixed price</Chip>
      <Chip icon="clock">{timelineLabel(job.timelineDays)}</Chip>
      <Chip icon="shield">{LEVELS[job.level as Level]}</Chip>
    </div>
  );
  const details = (
    <>
      <p className="text-[15px] leading-relaxed whitespace-pre-line">{job.description}</p>
      {job.skills.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-sans text-sm font-bold">Skills</h3>
          <ul className="flex flex-wrap gap-1.5">
            {job.skills.map((s) => <li key={s} className="rounded-full bg-parchment px-3 py-1 text-sm">{s}</li>)}
          </ul>
        </div>
      )}
      {job.attachments.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-sans text-sm font-bold">Attachments</h3>
          {user ? <FileLinks ids={job.attachments} meta={files} /> : <p className="text-sm text-ink-muted"><Link href="/sign-in" className="font-bold text-green">Log in</Link> to see the attachments.</p>}
        </div>
      )}
    </>
  );

  // ─────────── Owner: manage proposals ───────────
  if (isOwner && user) {
    await markLinkNotificationsRead(db, user.id, `/jobs/${job.id}`);
    const all = await listProposalsForJob(db, job.id, user.id, { markViewed: true });
    const tab = TABS.some((t) => t.v === sp.tab) ? sp.tab! : "all";
    const sort = SORTS.some((s) => s.v === sp.sort) ? sp.sort! : "match";
    const live = all.filter((p) => p.status !== "DECLINED");
    const counts = { all: live.length, new: live.filter((p) => p.isNew).length, shortlisted: all.filter((p) => p.status === "SHORTLISTED").length, declined: all.filter((p) => p.status === "DECLINED").length };
    const shown = (tab === "declined" ? all.filter((p) => p.status === "DECLINED") : tab === "shortlisted" ? all.filter((p) => p.status === "SHORTLISTED") : tab === "new" ? live.filter((p) => p.isNew) : all.filter((p) => p.status !== "DECLINED"))
      .sort((a, b) =>
        sort === "price" ? a.priceMinor - b.priceMinor : sort === "fast" ? a.timelineDays - b.timelineDays : sort === "rating" ? (b.rating ?? 0) - (a.rating ?? 0) || b.completed - a.completed : b.score - a.score,
      );
    const avgBid = live.length ? Math.round(live.reduce((s, p) => s + p.priceMinor, 0) / live.length) : 0;
    const bestId = live.length > 1 ? [...live].sort((a, b) => b.score - a.score)[0].id : null;
    const href = (o: { tab?: string; sort?: string }) => {
      const q = new URLSearchParams();
      const t = o.tab ?? tab;
      const s = o.sort ?? sort;
      if (t !== "all") q.set("tab", t);
      if (s !== "match") q.set("sort", s);
      return `/jobs/${job.id}${q.size ? `?${q}` : ""}#proposals`;
    };
    const open = job.status === "OPEN";

    return (
      <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <Link href="/jobs/mine" className="text-sm font-bold text-green">← My jobs</Link>
        {sp.posted && (
          <div className="flex items-center gap-4 rounded-md bg-green p-5 text-white">
            <span className="grid size-12 flex-none place-items-center rounded-full bg-amber text-ink"><Icon name="check" size={24} /></span>
            <div>
              <div className="font-display text-xl font-bold">Your job is live!</div>
              <p className="text-on-green-muted">We&apos;ve alerted experts who work in {job.category}. Proposals usually start arriving within a few hours; we&apos;ll notify you.</p>
            </div>
          </div>
        )}

        <div className="card flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="eyebrow">{job.category}</span>
              <h1 className="text-2xl font-bold sm:text-3xl">{job.title}</h1>
              <p className="text-sm text-ink-muted">Posted {ago(job.createdAt)}</p>
            </div>
            <StatusPill status={job.status} />
          </div>
          {meta}
          {job.status === "HIRED" && job.orderId && (
            <Link href={`/orders/${job.orderId}`} className="flex items-center justify-between gap-3 rounded-sm bg-green-tint px-4 py-3 font-bold text-green no-underline">
              You hired for this job. Open the order <span aria-hidden="true">→</span>
            </Link>
          )}
          <details className="group border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-bold text-green">Show job details</summary>
            <div className="mt-4 flex flex-col gap-4">{details}</div>
          </details>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Proposals" value={String(counts.all)} />
          <Stat label="New" value={String(counts.new)} accent={counts.new > 0} />
          <Stat label="Shortlisted" value={String(counts.shortlisted)} />
          <Stat label="Average bid" value={avgBid ? formatMoney(avgBid).replace(/\.00$/, "") : "–"} />
        </div>

        <section id="proposals" className="flex scroll-mt-4 flex-col gap-4" aria-labelledby="ph">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="ph" className="text-2xl font-bold">Proposals</h2>
            <nav className="flex flex-wrap gap-1 text-sm" aria-label="Sort proposals">
              {SORTS.map((s) => (
                <Link key={s.v} href={href({ sort: s.v })} aria-current={sort === s.v ? "true" : undefined} className={`rounded-full px-3 py-1.5 font-bold no-underline ${sort === s.v ? "bg-ink text-white" : "text-ink hover:bg-white"}`}>
                  {s.label}
                </Link>
              ))}
            </nav>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Filter proposals">
            {TABS.map((t) => (
              <Link key={t.v} href={href({ tab: t.v })} aria-current={tab === t.v ? "true" : undefined} className={`-mb-px shrink-0 border-b-[3px] px-4 py-2.5 text-sm font-bold no-underline ${tab === t.v ? "border-amber text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>
                {t.label} <span className="ml-1 rounded-full bg-parchment px-2 text-xs">{counts[t.v]}</span>
              </Link>
            ))}
          </nav>

          {shown.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 py-12 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-amber-tint text-amber-deep"><Icon name="spark" size={28} /></span>
              <h3 className="text-xl font-bold">{all.length === 0 ? "Waiting for the first proposal" : "Nothing here"}</h3>
              <p className="max-w-md text-ink-muted">
                {all.length === 0 ? "Matching experts have been alerted. You'll get a notification and an email as soon as someone bids." : "Try another tab."}
              </p>
            </div>
          ) : (
            <>
              <form id="compare" action={`/jobs/${job.id}/compare`} className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-full border border-line bg-white/95 py-2 pr-2 pl-5 text-sm shadow-sm backdrop-blur">
                <span className="text-ink-muted">Tick up to 3 proposals to compare side by side.</span>
                <button className="btn-primary min-h-9 px-4 text-sm">Compare selected</button>
              </form>
              <ul className="flex flex-col gap-4">
                {shown.map((p) => (
                  <li key={p.id}>
                    <ProposalCard p={p} jobId={job.id} open={open} best={p.id === bestId} budgetMax={job.budgetMaxMinor} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {open && (
          <details className="self-start text-sm">
            <summary className="cursor-pointer font-bold text-ink-muted">Close this job without hiring</summary>
            <form action={closeJobAction} className="mt-3 flex flex-wrap items-center gap-3 rounded-sm bg-amber-tint p-4">
              <input type="hidden" name="jobId" value={job.id} />
              <span className="text-amber-deep">Experts who bid get their credits back. This can&apos;t be undone.</span>
              <button className="btn-outline min-h-9 px-4 text-sm">Close job</button>
            </form>
          </details>
        )}
      </section>
    );
  }

  // ─────────── Everyone else: read and bid ───────────
  const isExpert = Boolean(user?.roles.includes("EXPERT"));
  const profile = isExpert && user ? await expertProfileOf(db, user.id) : null;
  const [client, mine, balance] = await Promise.all([
    clientStats(db, job.clientId),
    profile && user ? myProposal(db, job.id, user.id) : Promise.resolve(null),
    profile ? creditBalance(db, profile.id) : Promise.resolve(0),
  ]);
  if (user) await markLinkNotificationsRead(db, user.id, `/jobs/${job.id}`);
  const cost = creditsFor(job.budgetMaxMinor);
  const canBid = job.status === "OPEN" && profile && (!mine || mine.status === "WITHDRAWN");

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/jobs" className="text-sm font-bold text-green">← All jobs</Link>
      {sp.sent && mine && mine.status !== "WITHDRAWN" && (
        <div className="flex items-center gap-4 rounded-md bg-green p-5 text-white">
          <span className="grid size-12 flex-none place-items-center rounded-full bg-amber text-ink"><Icon name="check" size={24} /></span>
          <div>
            <div className="font-display text-xl font-bold">Proposal sent</div>
            <p className="text-on-green-muted">We&apos;ve told the client. You&apos;ll see here when they view it, and we&apos;ll notify you if they shortlist or hire you.</p>
          </div>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <article className="card flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="eyebrow">{job.category}</span>
            <h1 className="text-2xl font-bold sm:text-3xl">{job.title}</h1>
            <p className="text-sm text-ink-muted">
              Posted {ago(job.createdAt)} · <span className={job.proposalCount < 5 ? "font-bold text-green" : ""}>{proposalsBand(job.proposalCount)}</span>
            </p>
          </div>
          {meta}
          {job.status !== "OPEN" && <p className="rounded-sm bg-parchment px-4 py-3 text-sm font-bold">This job is no longer taking proposals.</p>}
          <div className="flex flex-col gap-4 border-t border-line pt-5">{details}</div>
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          {mine && mine.status !== "WITHDRAWN" ? (
            <MyProposalCard p={mine} jobId={job.id} />
          ) : canBid ? (
            <div className="card flex flex-col gap-4">
              <div>
                <h2 className="text-xl font-bold">{mine?.status === "WITHDRAWN" ? "Send a new proposal" : "Send a proposal"}</h2>
                <p className="text-sm text-ink-muted">Client&apos;s budget: <b className="text-ink">{budgetLabel(job)}</b></p>
              </div>
              <ProposalForm jobId={job.id} budgetMinMinor={job.budgetMinMinor} budgetMaxMinor={job.budgetMaxMinor} feeBps={platformFeeBps()} cost={cost} balance={balance} suggestedDays={job.timelineDays} />
            </div>
          ) : job.status === "OPEN" ? (
            <div className="card flex flex-col gap-3">
              <h2 className="text-xl font-bold">Want this job?</h2>
              <p className="text-sm text-ink-muted">Only verified experts can send proposals. It takes a few minutes to apply and our team reviews every application.</p>
              {user ? <Link href="/apply" className="btn-primary">Become an expert</Link> : <Link href={`/sign-in`} className="btn-primary">Log in to bid</Link>}
            </div>
          ) : null}

          <div className="card flex flex-col gap-4">
            <h2 className="font-sans text-sm font-bold tracking-wider text-ink-muted uppercase">About the client</h2>
            <div className="flex items-center gap-3">
              <Avatar name={client.name} size={44} tone="amber" />
              <div>
                <div className="font-bold">{client.name.split(" ")[0]}</div>
                <div className="text-xs text-ink-muted">Member since {memberSince(client.memberSince)}</div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Jobs posted" value={String(client.jobsPosted)} />
              <Fact label="Hires" value={String(client.hires)} />
              <Fact label="Spent on platform" value={client.spentMinor ? formatMoney(client.spentMinor).replace(/\.00$/, "") : "–"} />
              <div>
                <dt className="text-xs text-ink-muted">Rating from experts</dt>
                <dd><Stars rating={client.rating} count={client.ratingCount} small /></dd>
              </div>
            </dl>
            <p className="flex gap-2 rounded-sm bg-green-tint p-3 text-xs text-green">
              <Icon name="lock" size={16} className="flex-none" /> Payment for each milestone is held in escrow before you start work.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Chip({ icon, children }: { icon: "wallet" | "clock" | "shield"; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-parchment px-3 py-1.5 font-medium">
      <Icon name={icon} size={15} className="text-green" />
      {children}
    </span>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-4 ${accent ? "border-amber bg-amber-tint" : "border-line bg-white"}`}>
      <div className="text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    OPEN: ["Open for proposals", "bg-green-tint text-green"],
    HIRED: ["Hired", "bg-amber-tint text-amber-deep"],
    CLOSED: ["Closed", "bg-line text-ink"],
    CANCELLED: ["Closed", "bg-line text-ink-muted"],
  };
  const [label, tone] = map[status] ?? [status, "bg-line"];
  return <span className={`rounded-full px-3 py-1 text-sm font-bold ${tone}`}>{label}</span>;
}

function ProposalCard({ p, jobId, open, best, budgetMax }: { p: ProposalView; jobId: string; open: boolean; best: boolean; budgetMax: number }) {
  const live = p.status === "SUBMITTED" || p.status === "SHORTLISTED";
  const shortlisted = p.status === "SHORTLISTED";
  return (
    <article className={`flex flex-col gap-4 rounded-md border bg-white p-5 sm:p-6 ${best ? "border-amber shadow-md" : "border-line"} ${p.status === "DECLINED" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={p.expert.name} size={56} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-bold">{p.expert.name}</h3>
            {best && <Badge tone="amber">★ Best match</Badge>}
            {p.topMatch && <Badge tone="green">Top match: sells in this category</Badge>}
            {p.isNew && <Badge tone="ink">New</Badge>}
            {p.status === "ACCEPTED" && <Badge tone="green">Hired</Badge>}
          </div>
          <p className="text-sm text-ink-muted">{p.expert.headline}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Stars rating={p.rating} count={p.ratingCount} small />
            <span className="text-xs text-ink-muted">{p.completed} completed order{p.completed === 1 ? "" : "s"}</span>
            <span className="text-xs text-ink-muted">{LEVEL_LABEL[p.expert.level]}</span>
            <span className="text-xs text-ink-muted">Joined {memberSince(p.expert.joined)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="font-display text-2xl font-bold">{formatMoney(p.priceMinor).replace(/\.00$/, "")}</span>
          <span className="text-sm text-ink-muted">{p.timelineDays} day{p.timelineDays === 1 ? "" : "s"} · {p.milestonePlan.length} milestone{p.milestonePlan.length === 1 ? "" : "s"}</span>
          <span className={`text-xs font-bold ${p.priceMinor <= budgetMax ? "text-green" : "text-amber-deep"}`}>{p.priceMinor <= budgetMax ? "Within budget" : "Above your budget"}</span>
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none">
          <p className="line-clamp-3 text-[15px] whitespace-pre-line group-open:line-clamp-none">{p.pitch}</p>
          <span className="mt-1 inline-block text-sm font-bold text-green group-open:hidden">Read full proposal and plan</span>
        </summary>
        <ol className="mt-4 flex flex-col divide-y divide-line rounded-sm border border-line">
          {p.milestonePlan.map((m, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span><b>{i + 1}.</b> {m.title} <span className="text-ink-muted">· {m.dueInDays} day{m.dueInDays === 1 ? "" : "s"}</span></span>
              <b>{formatMoney(m.amountMinor).replace(/\.00$/, "")}</b>
            </li>
          ))}
        </ol>
      </details>

      {p.sharedSkills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-muted">Matches your skills:</span>
          {p.sharedSkills.map((s) => <span key={s} className="rounded-full bg-green-tint px-2.5 py-0.5 font-bold text-green">✓ {s}</span>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <span className="mr-auto text-xs text-ink-muted">Sent {ago(p.createdAt)}</span>
        {live && (
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm font-bold">
            <input type="checkbox" name="p" value={p.id} form="compare" className="size-4 accent-green" /> Compare
          </label>
        )}
        {open && live && (
          <>
            <form action={shortlistAction}>
              <input type="hidden" name="proposalId" value={p.id} />
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="on" value={shortlisted ? "0" : "1"} />
              <button className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-bold ${shortlisted ? "border-amber bg-amber-tint text-amber-deep" : "border-line"}`} aria-pressed={shortlisted}>
                {shortlisted ? "★ Shortlisted" : "☆ Shortlist"}
              </button>
            </form>
            <form action={declineAction}>
              <input type="hidden" name="proposalId" value={p.id} />
              <input type="hidden" name="jobId" value={jobId} />
              <button className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-bold text-ink-muted hover:bg-parchment">Decline</button>
            </form>
            <HireButton
              compact
              proposalId={p.id}
              expertName={p.expert.name}
              totalLabel={formatMoney(p.priceMinor)}
              milestones={p.milestonePlan.map((m) => ({ title: m.title, amountLabel: formatMoney(m.amountMinor), days: m.dueInDays }))}
            />
          </>
        )}
      </div>
    </article>
  );
}

function Badge({ tone, children }: { tone: "amber" | "green" | "ink"; children: React.ReactNode }) {
  const t = { amber: "bg-amber text-ink", green: "bg-green-tint text-green", ink: "bg-ink text-white" }[tone];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${t}`}>{children}</span>;
}

function MyProposalCard({ p, jobId }: { p: { id: string; status: string; priceMinor: number; timelineDays: number; viewedAt: Date | null; createdAt: Date; pitch: string; creditsSpent: number }; jobId: string }) {
  const steps = [
    { label: "Sent", done: true, when: ago(p.createdAt) },
    { label: "Viewed by the client", done: Boolean(p.viewedAt), when: p.viewedAt ? ago(p.viewedAt) : "Not yet" },
    { label: p.status === "DECLINED" ? "Not selected" : p.status === "ACCEPTED" ? "Hired!" : "Shortlisted", done: ["SHORTLISTED", "ACCEPTED", "DECLINED"].includes(p.status), when: "" },
  ];
  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Your proposal</h2>
        <span className="font-display text-xl font-bold">{formatMoney(p.priceMinor).replace(/\.00$/, "")}</span>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className={`grid size-7 flex-none place-items-center rounded-full text-xs font-bold ${s.done ? (p.status === "DECLINED" && i === 2 ? "bg-line text-ink" : "bg-green text-white") : "border-2 border-line text-ink-muted"}`}>
              {s.done ? (p.status === "DECLINED" && i === 2 ? "–" : "✓") : i + 1}
            </span>
            <span className={`flex-1 ${s.done ? "font-bold" : "text-ink-muted"}`}>{s.label}</span>
            <span className="text-xs text-ink-muted">{s.when}</span>
          </li>
        ))}
      </ol>
      <div className="rounded-sm bg-parchment p-3"><p className="line-clamp-4 text-sm whitespace-pre-line text-ink-muted">{p.pitch}</p></div>
      <p className="text-xs text-ink-muted">{p.timelineDays} days · {p.creditsSpent} credits used</p>
      {p.status === "ACCEPTED" ? (
        <Link href="/orders" className="btn-primary">Go to your order</Link>
      ) : (p.status === "SUBMITTED" || p.status === "SHORTLISTED") ? (
        <form action={withdrawAction}>
          <input type="hidden" name="proposalId" value={p.id} />
          <input type="hidden" name="jobId" value={jobId} />
          <button className="text-sm font-bold text-ink-muted underline">Withdraw proposal</button>
          <span className="ml-2 text-xs text-ink-muted">(credits aren&apos;t returned)</span>
        </form>
      ) : null}
    </div>
  );
}
