import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icons";
import { LitTabs } from "@/components/lit/LitTabs";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getReview, listPapers } from "@/server/lit";
import { timeLeft, toolAccessFor } from "@/server/toolAccess";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { t: string; c: string }> = {
  DRAFT: { t: "Your papers", c: "bg-white/15 text-white" },
  REQUESTED: { t: "Assigning an expert", c: "bg-amber text-ink" },
  RETRIEVAL: { t: "Expert finding literature", c: "bg-amber text-ink" },
  REVIEWING: { t: "Literature delivered: review it", c: "bg-amber text-ink" },
  ANALYSIS: { t: "Analysis", c: "bg-white/15 text-white" },
};

export default async function ReviewLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const r = await getReview(db, user.id, id);
  if (!r) notFound();
  const papers = await listPapers(db, id);
  const accepted = papers.filter((p) => p.status === "ACCEPTED");
  const counts = { papers: accepted.length, pending: papers.filter((p) => p.status === "PENDING").length, read: accepted.filter((p) => p.cardStatus === "done").length };
  const access = r.role === "owner" ? await toolAccessFor(db, "lit", user) : null;
  const st = STATUS[r.status] ?? STATUS.DRAFT;
  return (
    <div>
      <div className="bg-green-deep text-white">
        <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
          {r.role === "owner" ? (
            <Link href="/tools/lit" className="text-sm font-bold text-on-green-muted no-underline hover:text-white">‹ Literature Review</Link>
          ) : (
            <span className="text-sm font-bold text-on-green-muted">Literature retrieval job</span>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 text-[26px] leading-tight font-extrabold sm:text-[30px]">{r.title}</h1>
            <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${st.c}`}>{st.t}</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-on-green-muted">
            <b className="text-white">Research question:</b> {r.researchQuestion}
            {access?.kind === "trial" ? ` · Free trial: ${timeLeft(access.endsAt)} left` : access?.kind === "ended" ? " · Trial ended" : ""}
          </p>
          <LitTabs id={id} counts={counts} expert={r.role === "expert"} />
        </div>
      </div>
      {access?.kind === "ended" && (
        <div className="border-b border-amber/40 bg-amber-tint">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-sm text-amber-deep sm:px-6">
            <Icon name="clock" size={16} /> Your free trial has ended. Your review is safe and you can download everything; upgrade to add papers and run the AI steps.
            <Link href="/tools/lit/upgrade" className="font-bold text-amber-deep underline">Upgrade</Link>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
