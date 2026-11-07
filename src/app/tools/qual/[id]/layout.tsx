import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icons";
import { StudyTabs } from "@/components/qual/StudyTabs";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getStudy, responseCounts } from "@/server/qual";
import { timeLeft, toolAccessFor } from "@/server/toolAccess";

export const dynamic = "force-dynamic";

export default async function StudyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const s = await getStudy(db, user.id, id);
  if (!s) notFound();
  const counts = await responseCounts(db, id);
  const access = await toolAccessFor(db, "qual", user);
  const status = s.status === "LIVE" ? { t: "Live", c: "bg-amber text-ink" } : s.status === "CLOSED" ? { t: "Closed", c: "bg-white/15 text-white" } : { t: "Draft", c: "bg-white/15 text-white" };
  return (
    <div>
      <div className="bg-green-deep text-white">
        <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
          <Link href="/tools/qual" className="text-sm font-bold text-on-green-muted no-underline hover:text-white">‹ Qualitative Studio</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 text-[26px] leading-tight font-extrabold sm:text-[30px]">{s.title}</h1>
            <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${status.c}`}>{status.t}</span>
          </div>
          <p className="mt-1 text-sm text-on-green-muted">
            {counts.submitted} response{counts.submitted === 1 ? "" : "s"}
            {counts.inProgress ? ` · ${counts.inProgress} in progress` : ""}
            {access.kind === "trial" ? ` · Free trial: ${timeLeft(access.endsAt)} left` : access.kind === "ended" ? " · Trial ended" : ""}
          </p>
          <StudyTabs id={id} responses={counts.submitted} />
        </div>
      </div>
      {access.kind === "ended" && (
        <div className="border-b border-amber/40 bg-amber-tint">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-sm text-amber-deep sm:px-6">
            <Icon name="clock" size={16} /> Your free trial has ended. Your study and responses are safe; upgrade to publish, transcribe and analyse.
            <Link href="/tools/qual/upgrade" className="font-bold text-amber-deep underline">Upgrade</Link>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
