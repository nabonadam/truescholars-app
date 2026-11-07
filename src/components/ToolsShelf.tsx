import Link from "next/link";
import { UPGRADE_PATH } from "@/lib/statsCopy";
import type { Access } from "@/server/statsAccess";
import { timeLeft, trialDays } from "@/server/statsAccess";
import { Icon, type IconName } from "./Icons";

type StatsState = { access: Access | { kind: "new" }; upgradeRequestedAt: Date | null; sessions: number };
type QualState = { access: Access | { kind: "new" }; upgradeRequestedAt: Date | null; studies: number };

/** The AI tools on every dashboard: the Statistics Assistant up front, what's coming next beside it. */
export function ToolsShelf({ stats, qual }: { stats: StatsState; qual: QualState }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="eyebrow">AI research tools</span>
          <h2 className="text-2xl font-bold">Your research toolkit</h2>
        </div>
        <span className="text-sm text-ink-muted">Built for students and researchers. More tools are on the way.</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        <StatsCard {...stats} />
        <div className="grid gap-4">
          <Upcoming icon="book" title="Literature Review" line="A structured, fully cited review of real studies from your research question." tags={["Real databases", "Your PDFs", "APA · Harvard"]} />
          <QualCard {...qual} />
        </div>
      </div>
    </div>
  );
}

function StatsCard({ access, upgradeRequestedAt, sessions }: StatsState) {
  const DAY = 86_400_000;
  const trialLeft = access.kind === "trial" ? Math.max(0, Math.min(1, (access.endsAt.getTime() - Date.now()) / (trialDays() * DAY))) : 0;
  const chip =
    access.kind === "new" ? { text: `Free ${trialDays()}-day trial · no card`, tone: "bg-amber text-ink" } :
    access.kind === "trial" ? { text: `Free trial · ${timeLeft(access.endsAt)} left`, tone: "bg-amber text-ink" } :
    access.kind === "granted" ? { text: "Pro access", tone: "bg-white/15 text-white" } :
    access.kind === "admin" ? { text: "Admin · unlimited", tone: "bg-white/15 text-white" } :
    { text: "Trial ended", tone: "bg-white/15 text-amber" };

  return (
    <div className="relative overflow-hidden rounded-lg bg-green-deep p-6 text-white sm:p-7">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:24px_24px]" aria-hidden="true" />
      <div className="relative grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-amber text-ink"><Icon name="chart" size={22} /></span>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${chip.tone}`}>{chip.text}</span>
          </div>
          <div>
            <h3 className="text-[26px] leading-tight font-extrabold">Statistics Assistant</h3>
            <p className="mt-1 max-w-md text-on-green-muted">
              Ask your data in plain English or Stata. Stata-style output, APA tables and a do-file for every result.
            </p>
          </div>

          {access.kind === "trial" && (
            <div className="max-w-sm">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-amber" style={{ width: `${Math.max(4, trialLeft * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-on-green-muted">{timeLeft(access.endsAt)} of your free trial left</p>
            </div>
          )}
          {access.kind === "ended" && (
            <p className="max-w-md text-[15px] text-white">
              {upgradeRequestedAt ? "Upgrade requested. We'll switch you on and email payment details soon." : "Your free trial has ended. Your sessions and downloads are safe. Upgrade to keep analysing."}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-3">
            {access.kind === "new" && <Link href="/tools/stats" className="btn-amber">Start free trial</Link>}
            {(access.kind === "trial" || access.kind === "granted" || access.kind === "admin") && (
              <Link href="/tools/stats" className="btn-amber">Open Statistics Assistant</Link>
            )}
            {access.kind === "ended" && !upgradeRequestedAt && <Link href={UPGRADE_PATH} className="btn-amber">Upgrade</Link>}
            {access.kind === "trial" && <Link href={UPGRADE_PATH} className="text-sm font-bold text-white underline decoration-amber decoration-2 underline-offset-4">Upgrade</Link>}
            {sessions > 0 && (
              <Link href="/tools/stats" className="text-sm font-bold text-on-green-muted no-underline hover:text-white">
                {sessions} session{sessions === 1 ? "" : "s"} →
              </Link>
            )}
          </div>
        </div>

        {/* a glimpse of the output */}
        <div className="hidden w-[250px] rotate-[1.5deg] rounded-sm bg-[#0c1f16] p-3.5 font-mono text-[10.5px] leading-[1.55] shadow-2xl ring-1 ring-white/10 sm:block">
          <div><span className="text-amber">. </span><b className="text-white">regress</b><span className="text-white"> score i.school</span></div>
          <div className="mt-1 text-[#3f6152]">-------------+----------------</div>
          <div><span className="text-[#cfe3d6]">     Private</span><span className="text-[#3f6152]"> | </span><span className="text-[#f7dcb3]">4.112   0.003</span></div>
          <div><span className="text-[#cfe3d6]">      Public</span><span className="text-[#3f6152]"> | </span><span className="text-[#f7dcb3]">2.871   0.021</span></div>
          <div><span className="text-[#cfe3d6]">       _cons</span><span className="text-[#3f6152]"> | </span><span className="text-[#f7dcb3]">58.40   0.000</span></div>
          <div className="mt-2 rounded-[3px] bg-white px-2 py-1.5 font-serif text-[10px] text-[#111]">
            <i>Table 1.</i> Regression predicting score
          </div>
        </div>
      </div>
    </div>
  );
}

function QualCard({ access, upgradeRequestedAt, studies }: QualState) {
  const chip =
    access.kind === "new" ? { text: `Free ${trialDays()}-day trial`, tone: "bg-amber text-ink" } :
    access.kind === "trial" ? { text: `Trial · ${timeLeft(access.endsAt)} left`, tone: "bg-amber text-ink" } :
    access.kind === "granted" ? { text: "Pro access", tone: "bg-green-tint text-green" } :
    access.kind === "admin" ? { text: "Admin", tone: "bg-green-tint text-green" } :
    { text: upgradeRequestedAt ? "Upgrade requested" : "Trial ended", tone: "bg-parchment text-ink-muted" };
  const href = access.kind === "ended" && !upgradeRequestedAt && !studies ? "/tools/qual/upgrade" : "/tools/qual";
  return (
    <Link href={href} className="group flex gap-4 rounded-lg border border-green/25 bg-white p-5 no-underline transition hover:border-green">
      <span className="grid h-11 w-11 flex-none place-items-center rounded-[13px] bg-green text-amber"><Icon name="mic" size={21} /></span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-ink">Qualitative Studio</h3>
          <span className="rounded-full bg-green px-2 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">New</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.tone}`}>{chip.text}</span>
        </div>
        <p className="text-sm text-ink-muted">Voice and text surveys by one link, transcribed and thematically coded with real quotes.</p>
        <span className="text-sm font-bold text-green">
          {studies ? `${studies} stud${studies === 1 ? "y" : "ies"} →` : access.kind === "new" ? "Start free trial →" : access.kind === "ended" ? "Upgrade →" : "Start a study →"}
        </span>
      </div>
    </Link>
  );
}

function Upcoming({ icon, title, line, tags }: { icon: IconName; title: string; line: string; tags: string[] }) {
  return (
    <div className="flex gap-4 rounded-lg border border-line bg-white p-5">
      <span className="grid h-11 w-11 flex-none place-items-center rounded-[13px] bg-green-tint text-green"><Icon name={icon} size={21} /></span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold">{title}</h3>
          <span className="rounded-full bg-amber-tint px-2 py-0.5 text-[11px] font-bold tracking-wide text-amber-deep uppercase">Coming soon</span>
        </div>
        <p className="text-sm text-ink-muted">{line}</p>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => <span key={t} className="rounded-full bg-parchment px-2 py-0.5 text-[11.5px] text-ink-muted">{t}</span>)}
        </div>
      </div>
    </div>
  );
}
