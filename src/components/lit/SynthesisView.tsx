"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { editSynthesisAction, synthesisAction } from "@/app/actions/lit";
import { type PaperMeta, pno, shortAuthors } from "@/lib/cite";
import type { Synthesis, Theme } from "@/server/litAnalysis";
import { Icon } from "../Icons";
import { BarChart, DownloadButtons } from "../qual/Visuals";

export type SynPaper = { n: number; meta: PaperMeta; design?: string; country?: string };
type View = "themes" | "debates" | "gaps" | "matrix" | "glossary" | "landscape";
const STANCE: Record<string, string> = { supports: "bg-green-tint text-green", contradicts: "bg-red-100 text-red-800", extends: "bg-[#e3ecf7] text-[#24507a]", nuances: "bg-amber-tint text-amber-deep" };

export function SynthesisView({ reviewId, title, synthesis, papers, read, canRun, aiOn, hasWriting }: { reviewId: string; title: string; synthesis: Synthesis | null; papers: SynPaper[]; read: number; canRun: boolean; aiOn: boolean; hasWriting: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("themes");
  const label = Object.fromEntries(papers.map((p) => [pno(p.n), `${shortAuthors(p.meta)} (${p.meta.year ?? "n.d."})`]));
  const run = () =>
    start(async () => {
      if (synthesis && hasWriting && !confirm("Running the synthesis again replaces the outline and the writing built on it. Continue?")) return;
      const r = await synthesisAction(reviewId);
      setErr(r?.error ?? null);
      router.refresh();
    });

  const header = (
    <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
      <div className="flex-1">
        <h2 className="text-xl font-extrabold">Synthesis</h2>
        <p className="text-sm text-ink-muted">Across all {read} papers you&apos;ve read: the themes and what each paper contributes, where the literature agrees, where it contradicts itself and why, what is missing, and how authors define key terms. Organised by ideas, not authors.</p>
        {busy && <p className="mt-2 text-sm font-bold text-amber-deep">Synthesising… this takes one to two minutes.</p>}
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" disabled={busy || !canRun || !aiOn || read < 2} onClick={run} className={synthesis ? "rounded-full border border-green/30 bg-white px-4 py-2 text-sm font-bold text-green hover:border-green disabled:opacity-50" : "btn-amber"}>
          {synthesis ? "Run the synthesis again" : <><Icon name="play" size={14} /> Synthesise {read} papers</>}
        </button>
        {synthesis && <Link href={`/tools/lit/${reviewId}/write`} className="btn-primary text-center">Plan and write →</Link>}
      </div>
    </div>
  );
  if (read < 2) return <div className="flex flex-col gap-5">{header}<p className="text-ink-muted">Read at least two papers first. <Link href={`/tools/lit/${reviewId}/reading`} className="font-bold text-green">Go to reading</Link></p></div>;
  if (!synthesis) return <div className="flex flex-col gap-5">{header}<Landscape papers={papers} title={title} /></div>;

  const views: [View, string][] = [["themes", `Themes (${synthesis.themes.length})`], ["debates", `Agreements & debates (${synthesis.agreements.length + synthesis.contradictions.length})`], ["gaps", `Gaps (${synthesis.gaps.length})`], ["matrix", "Synthesis matrix"], ["glossary", `Key terms (${synthesis.glossary.length})`], ["landscape", "Research landscape"]];
  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="flex flex-wrap gap-1.5">
        {views.map(([v, l]) => <button key={v} type="button" onClick={() => setView(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${view === v ? "bg-green text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"}`}>{l}</button>)}
      </div>
      {view === "themes" && <div className="space-y-4">{synthesis.themes.map((t) => <ThemeCard key={t.id} reviewId={reviewId} t={t} label={label} />)}</div>}
      {view === "debates" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-lg font-extrabold">Where the literature agrees</h3>
            <ul className="space-y-2">{synthesis.agreements.map((a, i) => <li key={i} className="card p-4"><p className="font-bold">{a.statement}</p><Cites ids={a.papers} label={label} /></li>)}</ul>
          </div>
          <div>
            <h3 className="mb-2 text-lg font-extrabold">Where it disagrees, and why</h3>
            <ul className="space-y-2">
              {synthesis.contradictions.map((c, i) => (
                <li key={i} className="card p-4">
                  <p className="font-bold">{c.statement}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">{c.sides.map((s, j) => <div key={j} className="rounded-sm bg-parchment p-3 text-[13.5px]"><p>{s.position}</p><Cites ids={s.papers} label={label} /></div>)}</div>
                  {c.explanation && <p className="mt-2 text-[13.5px] text-ink-muted"><b>Why they may differ:</b> {c.explanation}</p>}
                </li>
              ))}
              {!synthesis.contradictions.length && <li className="text-sm text-ink-muted">No clear contradictions were found between these papers.</li>}
            </ul>
          </div>
        </div>
      )}
      {view === "gaps" && <Gaps reviewId={reviewId} gaps={synthesis.gaps} label={label} />}
      {view === "matrix" && <Matrix reviewId={reviewId} synthesis={synthesis} papers={papers} label={label} />}
      {view === "glossary" && (
        <div className="space-y-3">
          {synthesis.glossary.map((g) => (
            <div key={g.term} className="card p-4">
              <h3 className="text-lg font-extrabold">{g.term}</h3>
              <ul className="mt-2 space-y-1.5 text-[14px]">{g.definitions.map((d, i) => <li key={i}><span className="font-bold text-green">{label[d.p] ?? d.p}:</span> {d.definition}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {view === "landscape" && <Landscape papers={papers} title={title} />}
    </div>
  );
}

function Cites({ ids, label }: { ids: string[]; label: Record<string, string> }) {
  return <p className="mt-1.5 text-[12.5px] text-ink-muted">{ids.map((p) => label[p] ?? p).join("; ")}</p>;
}

function ThemeCard({ reviewId, t, label }: { reviewId: string; t: Theme; label: Record<string, string> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [claim, setClaim] = useState(t.claim);
  const [busy, start] = useTransition();
  const save = (edit: Parameters<typeof editSynthesisAction>[1]) => start(async () => { await editSynthesisAction(reviewId, edit); setEditing(false); router.refresh(); });
  return (
    <div className="card overflow-hidden">
      <div className="bg-green-deep p-5 text-white">
        {editing ? (
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="field font-bold text-ink" aria-label="Theme name" />
            <textarea value={claim} onChange={(e) => setClaim(e.target.value)} rows={2} className="field text-sm text-ink" aria-label="Claim" />
            <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => save({ kind: "theme", id: t.id, name, claim })} className="btn-amber min-h-9 px-3 text-sm">Save</button><button type="button" onClick={() => setEditing(false)} className="text-sm font-bold text-on-green-muted">Cancel</button></div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold tracking-wide text-amber uppercase">Theme · {t.papers.length} papers</div>
              <h3 className="mt-1 text-xl font-extrabold">{t.name}</h3>
              <p className="mt-1.5 text-[15px] text-white">{t.claim}</p>
              {t.description && <p className="mt-1 text-[14px] text-on-green-muted">{t.description}</p>}
            </div>
            <button type="button" onClick={() => setEditing(true)} className="text-[12.5px] font-bold text-amber">Edit</button>
            <button type="button" disabled={busy} onClick={() => confirm(`Remove the theme “${t.name}”?`) && save({ kind: "theme", id: t.id, remove: true })} className="text-[12.5px] font-bold text-white/70 hover:text-white">Remove</button>
          </div>
        )}
      </div>
      <ul className="divide-y divide-line">
        {t.papers.map((x, i) => (
          <li key={i} className="flex flex-wrap items-start gap-2 px-5 py-2.5 text-[14px]">
            <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${STANCE[x.stance]}`}>{x.stance}</span>
            <span className="font-bold">{label[x.p] ?? x.p}</span>
            <span className="min-w-0 flex-1 text-ink-muted">{x.point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Gaps({ reviewId, gaps, label }: { reviewId: string; gaps: Synthesis["gaps"]; label: Record<string, string> }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">These gaps are where your own study can contribute. The write-up ends with them, leading to your research question.</p>
      {gaps.map((g, i) => (
        <div key={i} className="card flex items-start gap-3 border-l-4 border-l-amber p-4">
          <div className="min-w-0 flex-1">
            <p className="font-bold">{g.gap}</p>
            <p className="mt-1 text-[14px] text-ink-muted">{g.why}</p>
            {g.papers.length > 0 && <Cites ids={g.papers} label={label} />}
          </div>
          <button type="button" disabled={busy} onClick={() => start(async () => { await editSynthesisAction(reviewId, { kind: "gap", index: i, remove: true }); router.refresh(); })} className="text-[12.5px] font-bold text-red-700">Remove</button>
        </div>
      ))}
    </div>
  );
}

function Matrix({ reviewId, synthesis, papers, label }: { reviewId: string; synthesis: Synthesis; papers: SynPaper[]; label: Record<string, string> }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
        <p className="text-sm text-ink-muted">What each paper says about each concept. Read down a column to compare papers on one idea.</p>
        <a href={`/api/lit/${reviewId}/export?f=matrix`} className="text-sm font-bold text-green"><Icon name="download" size={14} /> Download (Excel)</a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead><tr className="bg-green-tint text-left"><th className="sticky left-0 bg-green-tint p-3">Paper</th>{synthesis.concepts.map((c) => <th key={c.id} className="p-3" title={c.description}>{c.name}</th>)}</tr></thead>
          <tbody>
            {papers.map((p) => {
              const id = pno(p.n);
              const row = synthesis.matrix[id];
              if (!row) return null;
              return (
                <tr key={id} className="border-t border-line align-top">
                  <td className="sticky left-0 bg-white p-3 font-bold">{label[id]}</td>
                  {synthesis.concepts.map((c) => <td key={c.id} className="p-3 text-ink-muted">{row[c.id] || <span className="text-line">–</span>}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Landscape({ papers, title }: { papers: SynPaper[]; title: string }) {
  const count = (xs: (string | undefined)[]) => Object.entries(xs.reduce<Record<string, number>>((a, x) => (x ? ((a[x] = (a[x] ?? 0) + 1), a) : a), {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const designs = count(papers.map((p) => p.design && p.design.charAt(0).toUpperCase() + p.design.slice(1)));
  const countries = count(papers.map((p) => p.country)).slice(0, 12);
  const years = papers.map((p) => p.meta.year).filter((y): y is number => !!y);
  const periods = years.length ? count(years.map((y) => (y < 2000 ? "Before 2000" : `${y - (y % 5)}–${y - (y % 5) + 4}`))).sort((a, b) => a.label.localeCompare(b.label)) : [];
  if (!designs.length && !periods.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {designs.length > 0 && <Fig title="Study designs" name={`${title} study designs`}><BarChart rows={designs} total={papers.length} unit="papers" colour="#0f3d2a" label="Study designs" /></Fig>}
      {countries.length > 0 && <Fig title="Where the studies were done" name={`${title} countries`}><BarChart rows={countries} total={papers.length} unit="papers" colour="#b5651d" label="Countries" /></Fig>}
      {periods.length > 0 && <Fig title="When they were published" name={`${title} publication years`}><BarChart rows={periods} total={papers.length} unit="papers" colour="#2f7d5f" label="Publication years" /></Fig>}
    </div>
  );
}

function Fig({ title, name, children }: { title: string; name: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{title}</h3><DownloadButtons box={box} name={name} /></div>
      <div ref={box} className="overflow-x-auto">{children}</div>
    </div>
  );
}
