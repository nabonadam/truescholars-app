import Link from "next/link";
import { ago } from "@/lib/time";
import { budgetLabel, LEVELS, TIMELINES, type JobCard as Job, type Level } from "@/server/jobs";

export function proposalsBand(n: number) {
  if (n === 0) return "Be the first to bid";
  if (n < 5) return "Fewer than 5 proposals";
  if (n < 10) return "5 to 10 proposals";
  if (n < 20) return "10 to 20 proposals";
  return "20+ proposals";
}

export const timelineLabel = (days: number | null) => TIMELINES.find((t) => t.days === days)?.label ?? "Flexible";

export function JobCard({ job, highlight = false }: { job: Job; highlight?: boolean }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className={`group flex h-full flex-col gap-3 rounded-md border bg-white p-5 text-ink no-underline transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-6 ${highlight ? "border-amber" : "border-line"}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <span className="font-bold tracking-wide text-green uppercase">{job.category}</span>
        <span>·</span>
        <span>Posted {ago(job.createdAt)}</span>
        {job.applied && <span className="ml-auto rounded-full bg-green-tint px-2.5 py-0.5 font-bold text-green">✓ Applied</span>}
      </div>
      <h3 className="font-display text-lg leading-snug font-bold group-hover:text-green">{job.title}</h3>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span><span className="text-ink-muted">Budget</span> <b>{budgetLabel(job)}</b></span>
        <span className="text-ink-muted">{timelineLabel(job.timelineDays)}</span>
        {job.level !== "any" && <span className="text-ink-muted">{LEVELS[job.level as Level]}</span>}
      </div>
      <p className="line-clamp-2 text-[15px] text-ink-muted">{job.description}</p>
      {job.skills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {job.skills.slice(0, 5).map((s) => (
            <li key={s} className="rounded-full bg-parchment px-3 py-1 text-xs font-medium text-ink">{s}</li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-muted">
        <span className={job.proposalCount < 5 ? "font-bold text-green" : ""}>{proposalsBand(job.proposalCount)}</span>
        <span>{job.clientHires > 0 ? `Client has hired ${job.clientHires} time${job.clientHires === 1 ? "" : "s"}` : "New client"}</span>
        <span className="ml-auto inline-flex items-center gap-1 font-bold text-amber-deep" title="Bid credits needed to send a proposal">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity=".25" /><circle cx="12" cy="12" r="5" /></svg>
          {job.credits} credits
        </span>
      </div>
    </Link>
  );
}
