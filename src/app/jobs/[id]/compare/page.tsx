import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { shortlistAction } from "@/app/actions/jobs";
import { HireButton } from "@/components/JobForms";
import { Avatar, LEVEL_LABEL, Stars } from "@/components/People";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { memberSince } from "@/lib/time";
import { requireUser } from "@/server/guards";
import { getJob, listProposalsForJob, type ProposalView } from "@/server/jobs";

export const metadata: Metadata = { title: "Compare proposals" };
export const dynamic = "force-dynamic";

const money = (m: number) => formatMoney(m).replace(/\.00$/, "");

export default async function Compare({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ p?: string | string[] }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { p } = await searchParams;
  const db = getDb();
  const job = await getJob(db, id).catch(() => null);
  if (!job || job.clientId !== user.id) notFound();
  const wanted = (Array.isArray(p) ? p : p ? [p] : []).slice(0, 3);
  const all = await listProposalsForJob(db, id, user.id);
  const picked = (wanted.length ? all.filter((x) => wanted.includes(x.id)) : [...all].filter((x) => x.status !== "DECLINED").sort((a, b) => b.score - a.score).slice(0, 3));

  const best = <K extends keyof ProposalView>(key: K, dir: "min" | "max") => {
    const vals = picked.map((x) => x[key] as unknown as number | null).filter((v): v is number => typeof v === "number");
    if (vals.length < 2) return null;
    return dir === "min" ? Math.min(...vals) : Math.max(...vals);
  };
  const cheapest = best("priceMinor", "min");
  const fastest = best("timelineDays", "min");
  const topRated = best("rating", "max");
  const open = job.status === "OPEN";

  const Row = ({ label, children }: { label: string; children: (x: ProposalView) => React.ReactNode }) => (
    <tr className="border-t border-line align-top">
      <th scope="row" className="sticky left-0 z-[1] w-36 bg-parchment px-4 py-4 text-left text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</th>
      {picked.map((x) => <td key={x.id} className="min-w-60 px-4 py-4 text-sm">{children(x)}</td>)}
    </tr>
  );
  const Win = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
    <span className={on ? "inline-flex items-center gap-1.5 rounded-full bg-green-tint px-2.5 py-0.5 font-bold text-green" : ""}>{children}{on && <span className="text-[11px]">best</span>}</span>
  );

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href={`/jobs/${id}#proposals`} className="text-sm font-bold text-green">← Back to proposals</Link>
      <div>
        <span className="eyebrow">Compare</span>
        <h1 className="text-2xl font-bold sm:text-3xl">{job.title}</h1>
        <p className="text-ink-muted">{wanted.length ? "Your selected proposals, side by side." : "Your three best-matched proposals, side by side."} Highlights mark the strongest on each line.</p>
      </div>
      {picked.length === 0 ? (
        <div className="card">No proposals to compare yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-parchment" />
                {picked.map((x) => (
                  <th key={x.id} scope="col" className="min-w-60 px-4 py-5 text-left align-top">
                    <div className="flex items-center gap-3">
                      <Avatar name={x.expert.name} size={48} />
                      <div className="min-w-0">
                        <div className="font-display text-lg font-bold">{x.expert.name}</div>
                        <div className="line-clamp-2 text-xs font-normal text-ink-muted">{x.expert.headline}</div>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="Price">{(x) => <Win on={x.priceMinor === cheapest}><b className="font-display text-xl">{money(x.priceMinor)}</b></Win>}</Row>
              <Row label="Budget">{(x) => <span className={x.inBudget ? "text-green" : "text-amber-deep"}>{x.inBudget ? "Within budget" : `${money(x.priceMinor - job.budgetMaxMinor)} over`}</span>}</Row>
              <Row label="Timeline">{(x) => <Win on={x.timelineDays === fastest}>{x.timelineDays} days</Win>}</Row>
              <Row label="Rating">{(x) => <Win on={x.rating !== null && x.rating === topRated}><Stars rating={x.rating} count={x.ratingCount} small /></Win>}</Row>
              <Row label="Experience">{(x) => <>{x.completed} completed · {LEVEL_LABEL[x.expert.level]}<div className="text-xs text-ink-muted">Joined {memberSince(x.expert.joined)}</div></>}</Row>
              <Row label="Fit">{(x) => (
                <div className="flex flex-col gap-1">
                  {x.topMatch ? <span className="font-bold text-green">✓ Sells in this category</span> : <span className="text-ink-muted">No service in this category yet</span>}
                  {x.sharedSkills.length > 0 && <span className="text-xs">Skills: {x.sharedSkills.join(", ")}</span>}
                </div>
              )}</Row>
              <Row label="Plan">{(x) => (
                <ol className="flex flex-col gap-1">
                  {x.milestonePlan.map((m, i) => <li key={i} className="flex justify-between gap-2"><span>{i + 1}. {m.title}</span><b>{money(m.amountMinor)}</b></li>)}
                </ol>
              )}</Row>
              <Row label="Proposal">{(x) => <p className="line-clamp-[8] whitespace-pre-line text-ink-muted">{x.pitch}</p>}</Row>
              {open && (
                <Row label="">{(x) => (x.status === "SUBMITTED" || x.status === "SHORTLISTED") ? (
                  <div className="flex flex-wrap gap-2">
                    <HireButton compact proposalId={x.id} expertName={x.expert.name} totalLabel={formatMoney(x.priceMinor)} milestones={x.milestonePlan.map((m) => ({ title: m.title, amountLabel: formatMoney(m.amountMinor), days: m.dueInDays }))} />
                    <form action={shortlistAction}>
                      <input type="hidden" name="proposalId" value={x.id} />
                      <input type="hidden" name="jobId" value={id} />
                      <input type="hidden" name="on" value={x.status === "SHORTLISTED" ? "0" : "1"} />
                      <button className="inline-flex min-h-10 items-center rounded-full border border-line px-4 text-sm font-bold">{x.status === "SHORTLISTED" ? "★ Shortlisted" : "☆ Shortlist"}</button>
                    </form>
                  </div>
                ) : <span className="text-ink-muted">{x.status.toLowerCase()}</span>}</Row>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
