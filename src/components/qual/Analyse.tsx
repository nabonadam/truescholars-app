"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { analysisSetupAction, editAnalysisAction, runPhaseAction } from "@/app/actions/qual";
import type { AnalysisState, CodebookEntry, Phase, Theme } from "@/server/qualAnalysis";
import { Icon } from "../Icons";
import { DownloadButtons, Visuals, type WordCount } from "./Visuals";

type Participant = { rid: string; pid: string; words: number };

const STEPS: { phase: Phase; title: string; text: string }[] = [
  { phase: "familiar", title: "Familiarise", text: "A summary and first observations for each participant." },
  { phase: "codes", title: "Code", text: "Codes for each participant, each backed by exact quotes." },
  { phase: "codebook", title: "Review codes", text: "Codes with the same meaning merged into one codebook." },
  { phase: "themes", title: "Generate themes", text: "Codes grouped into themes around central ideas." },
  { phase: "matrix", title: "Framework matrix", text: "What each participant says about each theme." },
  { phase: "report", title: "Write up", text: "A findings report with method, themes, quotes and discussion." },
];
const NEEDS: Partial<Record<Phase, Phase>> = { codebook: "codes", themes: "codebook", matrix: "themes", report: "themes" };

type View = "familiar" | "codebook" | "themes" | "map" | "visuals" | "matrix" | "report";

export function Analyse(p: { studyId: string; participants: Participant[]; researchQuestion: string; background: string; state: AnalysisState; canRun: boolean; aiOn: boolean; words: WordCount[]; title: string }) {
  const router = useRouter();
  const [rq, setRq] = useState(p.researchQuestion);
  const [bg, setBg] = useState(p.background);
  const [saving, startSave] = useTransition();
  const [setupMsg, setSetupMsg] = useState<string | null>(null);
  const [running, setRunning] = useState<{ phase: Phase; done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const s = p.state;
  const [justDone, setJustDone] = useState<Partial<Record<Phase, boolean>>>({});
  const done: Partial<Record<Phase, unknown>> = { ...(s.done ?? {}), ...justDone };
  const pids = useMemo(() => Object.fromEntries(p.participants.map((x) => [x.rid, x.pid])), [p.participants]);
  const ready = p.researchQuestion.trim().length >= 10;
  const available: View[] = [
    ...(s.familiar && Object.keys(s.familiar).length ? (["familiar"] as View[]) : []),
    ...(s.codebook?.length ? (["codebook"] as View[]) : []),
    ...(s.themes?.length ? (["themes", "map"] as View[]) : []),
    "visuals",
    ...(s.matrix && Object.keys(s.matrix).length ? (["matrix"] as View[]) : []),
    ...(s.report ? (["report"] as View[]) : []),
  ];
  const [view, setView] = useState<View | null>(null);
  const shown = view && available.includes(view) ? view : available.filter((v) => v !== "visuals").at(-1) ?? "visuals";

  const saveSetup = () =>
    startSave(async () => {
      const r = await analysisSetupAction(p.studyId, rq, bg);
      setSetupMsg(r?.error ?? "Saved");
      if (!r?.error) router.refresh();
    });

  async function run(phase: Phase, restart: boolean): Promise<boolean> {
    setErr(null);
    if (restart) {
      // redoing a step clears it and everything after it
      const later = STEPS.slice(STEPS.findIndex((x) => x.phase === phase)).map((x) => x.phase);
      setJustDone((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !later.includes(k as Phase))));
    }
    let ok = true;
    setRunning({ phase, done: 0, total: 0 });
    let first = true;
    for (let guard = 0; guard < 500; guard++) {
      const r = await runPhaseAction(p.studyId, phase, restart && first);
      first = false;
      if (r.error) {
        setErr(r.error);
        ok = false;
        break;
      }
      setRunning({ phase, done: r.done ?? 0, total: r.total ?? 0 });
      if (r.finished) {
        setJustDone((d) => ({ ...d, [phase]: true }));
        break;
      }
    }
    setRunning(null);
    router.refresh();
    return ok;
  }

  async function runAll() {
    const already = { ...done };
    for (const st of STEPS) {
      if (already[st.phase]) continue;
      if (!(await run(st.phase, false))) break; // stop at the first failure; run() shows it
    }
  }

  if (!p.participants.length) {
    return (
      <div className="card mx-auto max-w-2xl p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-green-tint text-green"><Icon name="layers" size={22} /></span>
        <h2 className="mt-4 text-2xl font-extrabold">Nothing to analyse yet</h2>
        <p className="mt-2 text-ink-muted">Analysis works on submitted responses with transcribed voice answers or typed answers. Collect some responses, then transcribe them on the Responses tab.</p>
        <Link href={`/tools/qual/${p.studyId}/responses`} className="btn-primary mt-5">Go to responses</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <aside className="space-y-4">
        <div className="card p-5">
          <h2 className="text-lg font-extrabold">1. Your research question</h2>
          <p className="mt-1 text-[13px] text-ink-muted">Everything is organised around it. Add context about the study and participants to sharpen the codes.</p>
          <label className="mt-3 block text-[13px] font-bold">Research question</label>
          <textarea value={rq} onChange={(e) => setRq(e.target.value)} rows={3} className="field mt-1 w-full" placeholder="How do smallholder farmers in Northern Ghana experience and respond to changing rainfall?" />
          <label className="mt-3 block text-[13px] font-bold">Background <span className="font-normal text-ink-muted">(optional)</span></label>
          <textarea value={bg} onChange={(e) => setBg(e.target.value)} rows={3} className="field mt-1 w-full" placeholder="Who the participants are, where and when, the theory you draw on…" />
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={saveSetup} disabled={saving} className="btn-primary min-h-10 px-4 text-sm">{saving ? "Saving…" : "Save"}</button>
            {setupMsg && <span className={`text-sm ${setupMsg === "Saved" ? "text-green" : "text-red-700"}`}>{setupMsg}</span>}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-extrabold">2. Run the analysis</h2>
            <span className="text-xs text-ink-muted">{p.participants.length} participant{p.participants.length === 1 ? "" : "s"}</span>
          </div>
          {!p.aiOn && <p className="mt-2 rounded-sm bg-amber-tint p-3 text-[13px] text-amber-deep">AI analysis isn&apos;t switched on for this site yet.</p>}
          {!p.canRun && <p className="mt-2 rounded-sm bg-amber-tint p-3 text-[13px] text-amber-deep">Your trial has ended: you can read and download, but not run new steps. <Link href="/tools/qual/upgrade" className="font-bold underline">Upgrade</Link></p>}
          {!ready && <p className="mt-2 text-[13px] text-ink-muted">Save your research question to start.</p>}
          <ol className="mt-3 space-y-2">
            {STEPS.map((st, i) => {
              const isDone = !!done[st.phase];
              const blocked = !!NEEDS[st.phase] && !done[NEEDS[st.phase]!];
              const busy = running?.phase === st.phase;
              const disabled = !!running || !ready || !p.canRun || !p.aiOn || blocked;
              return (
                <li key={st.phase} className={`rounded-sm border p-3 ${isDone ? "border-green/30 bg-green-tint/50" : "border-line bg-white"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`grid h-7 w-7 flex-none place-items-center rounded-full text-[13px] font-bold ${isDone ? "bg-green text-white" : "bg-parchment text-ink"}`}>{isDone ? <Icon name="check" size={14} /> : i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{st.title}</div>
                      <div className="text-[12.5px] text-ink-muted">{st.text}</div>
                      {busy && (
                        <div className="mt-2">
                          <div className="h-1.5 overflow-hidden rounded-full bg-parchment"><div className="h-full rounded-full bg-amber transition-all" style={{ width: running.total ? `${Math.round((running.done / running.total) * 100)}%` : "15%" }} /></div>
                          <div className="mt-1 text-[12px] text-ink-muted">{running.total > 1 ? `${running.done} of ${running.total} participants` : "Working… this can take a minute"}</div>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => run(st.phase, isDone)}
                      title={blocked ? "Finish the step above first" : undefined}
                      className="flex-none rounded-full border border-green/30 px-3 py-1 text-[12.5px] font-bold text-green hover:border-green disabled:opacity-40"
                    >
                      {busy ? "…" : isDone ? "Redo" : "Run"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={runAll} disabled={!!running || !ready || !p.canRun || !p.aiOn || STEPS.every((st) => done[st.phase])} className="btn-amber mt-3 w-full min-h-10 text-sm">
            <Icon name="play" size={14} /> Run all remaining steps
          </button>
          {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
          <p className="mt-3 text-[12px] text-ink-muted">Redoing a step clears the steps after it, because they were built from it. Only transcripts and typed answers are sent to the AI, never names, emails or audio.</p>
        </div>

        {(s.codebook?.length || s.report) && (
          <div className="card p-5">
            <h2 className="text-lg font-extrabold">3. Download</h2>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              {(s.report || s.themes?.length) && <a className="flex items-center gap-2 font-bold text-green" href={`/api/qual/${p.studyId}/export?f=analysis-report`}><Icon name="download" size={15} /> Report and appendices (Word)</a>}
              {s.codebook?.length ? <a className="flex items-center gap-2 font-bold text-green" href={`/api/qual/${p.studyId}/export?f=analysis-codebook`}><Icon name="download" size={15} /> Codebook (CSV)</a> : null}
              {s.matrix && s.themes?.length ? <a className="flex items-center gap-2 font-bold text-green" href={`/api/qual/${p.studyId}/export?f=analysis-matrix`}><Icon name="download" size={15} /> Framework matrix (CSV)</a> : null}
            </div>
          </div>
        )}
      </aside>

      <section className="min-w-0">
        {!shown ? (
          <div className="card grid min-h-[320px] place-items-center p-8 text-center">
            <div>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-green-tint text-green"><Icon name="layers" size={22} /></span>
              <h2 className="mt-4 text-xl font-extrabold">Results appear here as each step finishes</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">You stay in charge: read each step, rename or remove codes and themes, and edit the report before you download it.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {available.map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${shown === v ? "bg-green text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"}`}>
                  {{ familiar: "Familiarisation", codebook: `Codebook (${s.codebook?.length ?? 0})`, themes: `Themes (${s.themes?.length ?? 0})`, map: "Thematic map", visuals: "Word cloud & charts", matrix: "Framework matrix", report: "Report" }[v]}
                </button>
              ))}
            </div>
            {shown === "familiar" && <Familiar state={s} participants={p.participants} />}
            {shown === "codebook" && <Codebook studyId={p.studyId} book={s.codebook ?? []} themes={s.themes ?? []} pids={pids} />}
            {shown === "themes" && <Themes studyId={p.studyId} themes={s.themes ?? []} book={s.codebook ?? []} pids={pids} total={p.participants.length} />}
            {shown === "map" && <ThematicMap rq={p.researchQuestion} themes={s.themes ?? []} book={s.codebook ?? []} title={p.title} />}
            {shown === "visuals" && <Visuals words={p.words} book={s.codebook ?? []} themes={s.themes ?? []} total={p.participants.length} title={p.title} />}
            {shown === "matrix" && <Matrix state={s} participants={p.participants} />}
            {shown === "report" && <Report studyId={p.studyId} text={s.report ?? ""} />}
          </>
        )}
      </section>
    </div>
  );
}

// ───────── views ─────────

function Familiar({ state, participants }: { state: AnalysisState; participants: Participant[] }) {
  return (
    <div className="space-y-3">
      {participants.filter((x) => state.familiar?.[x.rid]).map((x) => {
        const f = state.familiar![x.rid];
        return (
          <div key={x.rid} className="card p-5">
            <div className="flex items-center gap-2"><span className="rounded-full bg-green px-2.5 py-0.5 text-xs font-bold text-white">{x.pid}</span><span className="text-xs text-ink-muted">{x.words.toLocaleString()} words</span></div>
            <p className="mt-2 text-[15px]">{f.summary}</p>
            {f.notes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] text-ink-muted">{f.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </div>
        );
      })}
    </div>
  );
}

function useEdit(studyId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = (edit: Parameters<typeof editAnalysisAction>[1], after?: () => void) =>
    start(async () => {
      const r = await editAnalysisAction(studyId, edit);
      setMsg(r?.error ?? null);
      if (!r?.error) {
        after?.();
        router.refresh();
      }
    });
  return { pending, msg, save };
}

function Codebook({ studyId, book, themes, pids }: { studyId: string; book: CodebookEntry[]; themes: Theme[]; pids: Record<string, string> }) {
  const [q, setQ] = useState("");
  const list = book.filter((k) => !q || `${k.label} ${k.definition}`.toLowerCase().includes(q.toLowerCase()));
  const themeOf = (id: string) => themes.find((t) => t.codes.includes(id))?.name;
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search codes" className="field mb-3 w-full sm:w-72" />
      <div className="space-y-3">
        {list.map((k) => <CodeCard key={k.id} studyId={studyId} k={k} theme={themeOf(k.id)} pids={pids} />)}
      </div>
    </div>
  );
}

function CodeCard({ studyId, k, theme, pids }: { studyId: string; k: CodebookEntry; theme?: string; pids: Record<string, string> }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(k.label);
  const [def, setDef] = useState(k.definition);
  const [open, setOpen] = useState(false);
  const { pending, msg, save } = useEdit(studyId);
  return (
    <div className="card p-4">
      {editing ? (
        <div className="space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="field w-full font-bold" aria-label="Code label" />
          <textarea value={def} onChange={(e) => setDef(e.target.value)} rows={2} className="field w-full text-sm" aria-label="Definition" />
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => save({ kind: "code", id: k.id, label, definition: def }, () => setEditing(false))} className="btn-primary min-h-9 px-3 text-sm">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="px-2 text-sm font-bold text-ink-muted">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{k.label}</span>
              <span className="rounded-full bg-parchment px-2 py-0.5 text-[11.5px] font-bold text-ink-muted">{k.rids.length} participant{k.rids.length === 1 ? "" : "s"}</span>
              {theme && <span className="rounded-full bg-green-tint px-2 py-0.5 text-[11.5px] font-bold text-green">{theme}</span>}
            </div>
            <p className="mt-1 text-[13.5px] text-ink-muted">{k.definition}</p>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="text-[12.5px] font-bold text-green">Edit</button>
          <button type="button" disabled={pending} onClick={() => confirm(`Remove the code “${k.label}”?`) && save({ kind: "code", id: k.id, remove: true })} className="text-[12.5px] font-bold text-red-700">Remove</button>
        </div>
      )}
      {k.quotes.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen(!open)} className="text-[12.5px] font-bold text-ink-muted hover:text-ink">{open ? "Hide" : "Show"} {k.quotes.length} quote{k.quotes.length === 1 ? "" : "s"}</button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {k.quotes.map((q, i) => (
                <li key={i} className="border-l-2 border-amber pl-3 text-[13.5px]"><span className="font-bold text-ink-muted">{pids[q.rid] ?? "?"}</span> “{q.text}”</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {msg && <p className="mt-1 text-sm text-red-700">{msg}</p>}
    </div>
  );
}

function Themes({ studyId, themes, book, pids, total }: { studyId: string; themes: Theme[]; book: CodebookEntry[]; pids: Record<string, string>; total: number }) {
  const byId = Object.fromEntries(book.map((k) => [k.id, k]));
  return (
    <div className="space-y-4">
      {themes.map((t) => <ThemeCard key={t.id} studyId={studyId} t={t} byId={byId} pids={pids} total={total} />)}
    </div>
  );
}

function ThemeCard({ studyId, t, byId, pids, total }: { studyId: string; t: Theme; byId: Record<string, CodebookEntry>; pids: Record<string, string>; total: number }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [def, setDef] = useState(t.definition);
  const { pending, msg, save } = useEdit(studyId);
  const codes = t.codes.map((c) => byId[c]).filter(Boolean);
  const people = new Set(codes.flatMap((k) => k.rids)).size;
  const quotes = codes.flatMap((k) => k.quotes.slice(0, 1)).slice(0, 3);
  return (
    <div className="card overflow-hidden">
      <div className="bg-green-deep p-5 text-white">
        {editing ? (
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="field w-full font-bold text-ink" aria-label="Theme name" />
            <textarea value={def} onChange={(e) => setDef(e.target.value)} rows={3} className="field w-full text-sm text-ink" aria-label="Definition" />
            <div className="flex gap-2">
              <button type="button" disabled={pending} onClick={() => save({ kind: "theme", id: t.id, name, definition: def }, () => setEditing(false))} className="btn-amber min-h-9 px-3 text-sm">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="px-2 text-sm font-bold text-on-green-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold tracking-wide text-amber uppercase">Theme · {people} of {total} participants</div>
              <h3 className="mt-1 text-xl font-extrabold">{t.name}</h3>
              <p className="mt-1.5 text-[14.5px] text-on-green-muted">{t.definition}</p>
            </div>
            <button type="button" onClick={() => setEditing(true)} className="text-[12.5px] font-bold text-amber">Edit</button>
            <button type="button" disabled={pending} onClick={() => confirm(`Remove the theme “${t.name}”? Its codes stay in the codebook.`) && save({ kind: "theme", id: t.id, remove: true })} className="text-[12.5px] font-bold text-white/70 hover:text-white">Remove</button>
          </div>
        )}
      </div>
      <div className="p-5">
        {t.subthemes.length > 0 && (
          <div className="mb-3">
            <div className="text-[12px] font-bold text-ink-muted uppercase">Subthemes</div>
            <ul className="mt-1 flex flex-wrap gap-1.5">{t.subthemes.map((x) => <li key={x.name} className="rounded-full bg-amber-tint px-2.5 py-0.5 text-[13px] font-bold text-amber-deep">{x.name}</li>)}</ul>
          </div>
        )}
        <div className="text-[12px] font-bold text-ink-muted uppercase">Codes</div>
        <ul className="mt-1 flex flex-wrap gap-1.5">{codes.map((k) => <li key={k.id} className="rounded-full bg-green-tint px-2.5 py-0.5 text-[13px] text-green">{k.label}</li>)}</ul>
        {quotes.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {quotes.map((q, i) => <li key={i} className="border-l-2 border-amber pl-3 text-[13.5px]"><span className="font-bold text-ink-muted">{pids[q.rid] ?? "?"}</span> “{q.text}”</li>)}
          </ul>
        )}
        {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
      </div>
    </div>
  );
}

/** Research question at the centre, themes around it, their codes fanning out beyond each theme. */
function ThematicMap({ rq, themes, book, title }: { rq: string; themes: Theme[]; book: CodebookEntry[]; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const byId = Object.fromEntries(book.map((k) => [k.id, k]));
  const W = 1320, H = 900, cx = W / 2, cy = H / 2;
  const R = 290;
  const MAX = 6;
  const colours = ["#0f3d2a", "#b5651d", "#1a6b52", "#7a4b1c", "#2f5d8a", "#6b3a5d", "#4a6b1a"];
  const wrap = (text: string, n: number, max: number) => {
    const out: string[] = [];
    let line = "";
    for (const w of text.split(" ")) {
      if ((line + " " + w).trim().length > n && line) {
        out.push(line);
        line = w;
      } else line = (line + " " + w).trim();
    }
    if (line) out.push(line);
    if (out.length > max) return [...out.slice(0, max - 1), out.slice(max - 1).join(" ").slice(0, n - 1) + "…"];
    return out;
  };
  const short = (t: string, n = 24) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-1 pb-2">
        <h3 className="text-lg font-extrabold">Thematic map</h3>
        <DownloadButtons box={box} name={`${title} thematic map`} />
      </div>
      <div ref={box} className="overflow-x-auto">
      <svg data-figure viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[720px]" role="img" aria-label="Thematic map" fontFamily="'DM Sans', Arial, Helvetica, sans-serif">
        {themes.map((t, i) => {
          const a = (i / themes.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
          const all = t.codes.map((c) => byId[c]).filter(Boolean).sort((p, q) => q.rids.length - p.rids.length);
          const codes = all.slice(0, MAX);
          const colour = colours[i % colours.length];
          return (
            <g key={t.id}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={colour} strokeWidth={3} opacity={0.45} />
              {(() => {
                // codes as tidy columns beside the theme: outward side for side themes, split for top/bottom ones
                const c = Math.cos(a);
                const left = Math.abs(c) < 0.35 ? codes.slice(0, Math.ceil(codes.length / 2)) : c < 0 ? codes : [];
                const right = Math.abs(c) < 0.35 ? codes.slice(Math.ceil(codes.length / 2)) : c >= 0 ? codes : [];
                const col = (list: CodebookEntry[], side: -1 | 1) =>
                  list.map((k, j) => {
                    const kx = x + side * 128;
                    const ky = y + (j - (list.length - 1) / 2) * 25;
                    return (
                      <g key={k.id}>
                        <line x1={x + side * 100} y1={y} x2={kx} y2={ky} stroke={colour} strokeWidth={1.2} opacity={0.4} />
                        <circle cx={kx} cy={ky} r={5} fill={colour} />
                        <text x={kx + side * 9} y={ky + 4.5} textAnchor={side > 0 ? "start" : "end"} fontSize={13} fill="#2b3d33">{short(k.label, 26)}</text>
                      </g>
                    );
                  });
                return (
                  <>
                    {col(left, -1)}
                    {col(right, 1)}
                  </>
                );
              })()}
              {all.length > MAX && (
                <text x={x} y={y + (Math.sin(a) < -0.5 ? -46 : 54)} textAnchor="middle" fontSize={11.5} fill="#6b7d72">+{all.length - MAX} more</text>
              )}
              <rect x={x - 100} y={y - 36} width={200} height={72} rx={16} fill={colour} />
              {(() => {
                const lines = wrap(t.name, 24, 3);
                return (
                  <text x={x} y={y - (lines.length - 1) * 8 + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffffff">
                    {lines.map((l, n) => <tspan key={n} x={x} dy={n ? 16 : 0}>{l}</tspan>)}
                  </text>
                );
              })()}
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={98} fill="#f4a261" />
        {(() => {
          const lines = wrap(rq || "Research question", 22, 6);
          return (
            <text x={cx} y={cy - (lines.length - 1) * 8 + 4} textAnchor="middle" fontSize={13.5} fontWeight={700} fill="#13261c">
              {lines.map((l, n) => <tspan key={n} x={cx} dy={n ? 16 : 0}>{l}</tspan>)}
            </text>
          );
        })()}
      </svg>
      </div>
      <p className="px-2 pb-1 text-[12px] text-ink-muted">The six most widespread codes are shown for each theme. The full list is on the Themes tab and in the Word report.</p>
    </div>
  );
}

function Matrix({ state, participants }: { state: AnalysisState; participants: Participant[] }) {
  const themes = state.themes ?? [];
  const rows = participants.filter((x) => state.matrix?.[x.rid]);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="bg-green-tint text-left">
            <th className="sticky left-0 bg-green-tint p-3 font-bold">Participant</th>
            {themes.map((t) => <th key={t.id} className="p-3 font-bold">{t.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.rid} className="border-t border-line align-top">
              <td className="sticky left-0 bg-white p-3 font-bold">{x.pid}</td>
              {themes.map((t) => <td key={t.id} className="p-3 text-ink-muted">{state.matrix![x.rid][t.id] || <span className="text-line">–</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ studyId, text }: { studyId: string; text: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const { pending, msg, save } = useEdit(studyId);
  return (
    <div className="card p-6 sm:p-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-amber-tint px-3 py-1 text-[12.5px] font-bold text-amber-deep">Draft: check every quote and claim before you use it</span>
        <span className="flex-1" />
        {editing ? (
          <>
            <button type="button" disabled={pending} onClick={() => save({ kind: "report", text: draft }, () => setEditing(false))} className="btn-primary min-h-9 px-3 text-sm">{pending ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => { setDraft(text); setEditing(false); }} className="text-sm font-bold text-ink-muted">Cancel</button>
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-bold text-green"><Icon name="pen" size={14} /> Edit</button>
        )}
      </div>
      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={30} className="field w-full font-mono text-[13px]" aria-label="Report (Markdown)" />
      ) : (
        <article className="max-w-none text-[15.5px] leading-[1.75]">{markdown(text)}</article>
      )}
      {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
    </div>
  );
}

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("*") && part.length > 2 ? <em key={i}>{part.slice(1, -1)}</em> : <Fragment key={i}>{part}</Fragment>,
  );
}

function markdown(md: string) {
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (para.length) out.push(<p key={out.length} className="mb-4">{inline(para.join(" "))}</p>);
    if (bullets.length) out.push(<ul key={out.length} className="mb-4 list-disc space-y-1 pl-6">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    para = [];
    bullets = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const cls = h[1].length <= 2 ? "mt-8 mb-3 text-2xl font-extrabold text-green" : "mt-6 mb-2 text-lg font-extrabold";
      out.push(<h3 key={out.length} className={cls}>{h[2].replace(/\*\*/g, "")}</h3>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (para.length) { const b = bullets; bullets = []; flush(); bullets = b; }
      bullets.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (/^>\s?/.test(line)) {
      flush();
      out.push(<blockquote key={out.length} className="mb-4 border-l-4 border-amber pl-4 italic">{inline(line.replace(/^>\s?/, ""))}</blockquote>);
    } else if (!line.trim()) flush();
    else {
      if (bullets.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out;
}
