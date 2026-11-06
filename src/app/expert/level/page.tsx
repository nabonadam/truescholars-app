import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { evaluateLevel, expertStats, LEVEL_INFO, LEVEL_ORDER, progressTowards, type Level } from "@/server/levels";

export const metadata: Metadata = { title: "Your level" };
export const dynamic = "force-dynamic";

export default async function LevelPage() {
  const user = await requireUser("EXPERT");
  const db = getDb();
  const result = await evaluateLevel(db, user.id); // keeps tenure-based progress current
  const level = (result?.level ?? "NEW") as Level;
  const stats = await expertStats(db, user.id);
  const idx = LEVEL_ORDER.indexOf(level);
  const next = LEVEL_ORDER[idx + 1] as Exclude<Level, "NEW"> | undefined;
  const checks = next ? progressTowards(stats, next) : [];
  const done = checks.filter((c) => c.met).length;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="relative overflow-hidden rounded-lg bg-green p-6 text-white sm:p-10">
        <div className="pointer-events-none absolute -right-10 -bottom-20 size-72 rounded-full bg-amber/15" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-6">
          <span className="grid size-20 place-items-center rounded-full bg-amber text-ink shadow-lg"><Icon name="trophy" size={38} /></span>
          <div className="flex-1">
            <span className="text-xs font-bold tracking-wider text-amber uppercase">Your seller level</span>
            <h1 className="text-4xl font-extrabold text-white">{LEVEL_INFO[level].name}</h1>
            <ul className="mt-2 flex flex-wrap gap-2">
              {LEVEL_INFO[level].perks.map((p) => <li key={p} className="rounded-full bg-white/10 px-3 py-1 text-sm">{p}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <ol className="grid gap-3 sm:grid-cols-4" aria-label="Levels">
        {LEVEL_ORDER.map((l, i) => {
          const state = i < idx ? "done" : i === idx ? "current" : "locked";
          return (
            <li key={l} className={`flex flex-col gap-2 rounded-md border-2 p-4 ${state === "current" ? "border-amber bg-amber-tint" : state === "done" ? "border-green/30 bg-green-tint" : "border-line bg-white"}`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold">{LEVEL_INFO[l].name}</span>
                <span className="text-xs font-bold">{state === "done" ? "✓" : state === "current" ? "You're here" : "🔒"}</span>
              </div>
              <span className="text-sm text-ink-muted">{LEVEL_INFO[l].credits} credits a month</span>
            </li>
          );
        })}
      </ol>

      {next ? (
        <div className="card flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">Your path to {LEVEL_INFO[next].name}</h2>
              <p className="text-ink-muted">{done} of {checks.length} requirements met. Levels are re-checked every time a client approves your work.</p>
            </div>
            <div className="font-display text-3xl font-bold text-green">{Math.round((done / checks.length) * 100)}%</div>
          </div>
          <ul className="flex flex-col gap-4">
            {checks.map((c) => {
              const pct = c.goal ? Math.min(100, (c.current / c.goal) * 100) : 0;
              return (
                <li key={c.key} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-bold">
                      <span className={`grid size-5 place-items-center rounded-full text-[11px] ${c.met ? "bg-green text-white" : "border-2 border-line"}`}>{c.met ? "✓" : ""}</span>
                      {c.label}
                    </span>
                    <span className="text-ink-muted">{c.show}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-parchment">
                    <div className={`h-full rounded-full ${c.met ? "bg-green" : "bg-amber"}`} style={{ width: `${c.met ? 100 : pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="rounded-sm bg-parchment p-4 text-sm">
            <b>Unlocks:</b> {LEVEL_INFO[next].perks.join(" · ")}
          </div>
        </div>
      ) : (
        <div className="card text-center">
          <h2 className="text-2xl font-bold">You&apos;re at the top</h2>
          <p className="text-ink-muted">Keep delivering great work on time to stay Top rated.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/jobs" className="card flex items-center gap-3 font-bold text-ink no-underline hover:shadow-md"><Icon name="briefcase" className="text-green" /> Find work</Link>
        <Link href="/expert/services" className="card flex items-center gap-3 font-bold text-ink no-underline hover:shadow-md"><Icon name="package" className="text-green" /> Improve your services</Link>
        <Link href="/earnings" className="card flex items-center gap-3 font-bold text-ink no-underline hover:shadow-md"><Icon name="wallet" className="text-green" /> Earnings</Link>
      </div>
    </section>
  );
}
