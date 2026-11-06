import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { getDb } from "@/db";
import { ago } from "@/lib/time";
import { requireUser } from "@/server/guards";
import { budgetLabel, listJobsForClient } from "@/server/jobs";

export const metadata: Metadata = { title: "My jobs" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  OPEN: ["Open", "bg-green-tint text-green"],
  HIRED: ["Hired", "bg-amber-tint text-amber-deep"],
  CLOSED: ["Closed", "bg-line text-ink"],
  CANCELLED: ["Closed", "bg-line text-ink-muted"],
};

export default async function MyJobs() {
  const user = await requireUser();
  const jobs = await listJobsForClient(getDb(), user.id);
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Hiring</span>
          <h1 className="text-3xl font-bold">My jobs</h1>
        </div>
        <Link href="/jobs/new" className="btn-amber">+ Post a job</Link>
      </div>
      {jobs.length === 0 ? (
        <div className="card flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="grid size-14 flex-none place-items-center rounded-full bg-green text-amber"><Icon name="briefcase" size={26} /></span>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Post your first job</h2>
            <p className="text-ink-muted">Describe what you need and verified experts will send you proposals. It&apos;s free to post.</p>
          </div>
          <Link href="/jobs/new" className="btn-primary">Post a job</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((j) => {
            const [label, tone] = STATUS[j.status] ?? [j.status, "bg-line"];
            return (
              <li key={j.id}>
                <Link href={j.orderId ? `/orders/${j.orderId}` : `/jobs/${j.id}`} className="card flex flex-wrap items-center gap-4 text-ink no-underline transition-shadow hover:shadow-md">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span className={`rounded-full px-2.5 py-0.5 font-bold ${tone}`}>{label}</span>
                      <span>{j.category}</span>·<span>Posted {ago(j.createdAt)}</span>
                    </div>
                    <h2 className="truncate font-display text-lg font-bold">{j.title}</h2>
                    <div className="text-sm text-ink-muted">{budgetLabel(j)}</div>
                  </div>
                  <div className="flex items-center gap-5 text-center">
                    <div><div className="font-display text-2xl font-bold">{j.proposals}</div><div className="text-xs text-ink-muted">proposals</div></div>
                    {j.unseen > 0 && <div><div className="font-display text-2xl font-bold text-amber-deep">{j.unseen}</div><div className="text-xs text-ink-muted">new</div></div>}
                    {j.shortlisted > 0 && <div><div className="font-display text-2xl font-bold">{j.shortlisted}</div><div className="text-xs text-ink-muted">shortlisted</div></div>}
                  </div>
                  <span className="text-sm font-bold text-green">{j.orderId ? "Open order →" : j.status === "OPEN" ? "Review →" : "View →"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
