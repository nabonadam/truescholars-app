"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { cancelAction, confirmAction, deleteAction, interpretAction, renameAction, resetAction, submitAction } from "@/app/actions/stats";
import { looksLikeStata } from "@/lib/stata";
import { UPGRADE_PATH } from "@/lib/statsCopy";
import type { CommandResult } from "@/server/stats";
import type { VarMeta } from "@/server/statsAi";
import { Icon } from "../Icons";
import { ApaTable, CommandEcho, StataLog, tableAsText } from "./Output";
import { VariablesPanel } from "./Variables";

export type RunView = {
  id: string;
  input: string;
  mode: string;
  commands: string[];
  status: string;
  explanation: string | null;
  results: CommandResult[];
  interpretation: string | null;
  createdAt: string;
};
type SessionView = { id: string; title: string; fileName: string; nObs: number; nVars: number; history: string[]; variables: VarMeta[] };
type Mode = "ask" | "stata";

function suggestions(vars: VarMeta[]) {
  const isId = (v: VarMeta) => v.unique === v.nonmissing && v.nonmissing > 50 && /id$|^id|_no$|serial/i.test(v.name);
  const cont = vars.filter((v) => v.kind === "continuous" && !isId(v)).map((v) => v.name);
  const bin = vars.filter((v) => v.kind === "categorical" && v.unique === 2).map((v) => v.name);
  const cat = vars.filter((v) => v.kind === "categorical" && v.unique > 2).map((v) => v.name);
  const L = (n: string) => vars.find((v) => v.name === n)?.label || n;
  const out: { ask: string; cmd: string; label: string }[] = [{ label: "Describe the data", ask: "Describe this dataset", cmd: "describe" }];
  if (cont.length) out.push({ label: "Summary statistics", ask: `Give me summary statistics for ${cont.slice(0, 4).join(", ")}`, cmd: `summarize ${cont.slice(0, 4).join(" ")}` });
  if (cat[0] && bin[0]) out.push({ label: `${cat[0]} × ${bin[0]}`, ask: `Is ${L(bin[0])} associated with ${L(cat[0])}?`, cmd: `tabulate ${cat[0]} ${bin[0]}, row chi2` });
  if (cont[0] && bin[0]) out.push({ label: `Compare ${cont.at(-1)} by ${bin[0]}`, ask: `Is ${L(cont.at(-1)!)} different by ${L(bin[0])}?`, cmd: `ttest ${cont.at(-1)}, by(${bin[0]})` });
  if (cont[0] && cat[0]) out.push({ label: `ANOVA by ${cat[0]}`, ask: `Does ${L(cont.at(-1)!)} differ across ${L(cat[0])}?`, cmd: `oneway ${cont.at(-1)} ${cat[0]}, tabulate bonferroni` });
  if (cont.length >= 2) out.push({ label: "Correlations", ask: `How are ${cont.slice(0, 4).join(", ")} correlated?`, cmd: `pwcorr ${cont.slice(0, 4).join(" ")}, sig obs` });
  if (cont.length >= 2) {
    const y = cont.at(-1)!;
    const xs = [...cont.slice(0, -1).slice(0, 2), ...cat.slice(0, 1).map((c) => `i.${c}`), ...bin.slice(0, 1).map((c) => `i.${c}`)];
    out.push({ label: `Regression on ${y}`, ask: `What predicts ${L(y)}?`, cmd: `regress ${y} ${xs.join(" ")}` });
  }
  if (bin[0] && cont[0]) out.push({ label: `Logit for ${bin.at(-1)}`, ask: `What predicts ${L(bin.at(-1)!)}? Show odds ratios.`, cmd: `logistic ${bin.at(-1)} ${cont.slice(0, 2).join(" ")}` });
  return out;
}

export type AccessView = { canRun: boolean; label: string | null; urgent: boolean };

export function Workspace({ session, runs, aiEnabled, access }: { session: SessionView; runs: RunView[]; aiEnabled: boolean; access: AccessView }) {
  const [mode, setMode] = useState<Mode>(aiEnabled ? "ask" : "stata");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [doOpen, setDoOpen] = useState(false);
  const [, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const histIdx = useRef(-1);

  const typed = useMemo(() => runs.flatMap((r) => (r.mode === "STATA" && r.status !== "RESET" ? [r.input] : r.status === "DONE" ? [r.commands.join("\n")] : [])).reverse(), [runs]);
  const sugg = useMemo(() => suggestions(session.variables), [session.variables]);

  useEffect(() => {
    fetch("/api/stats/ping", { method: "POST" }).catch(() => null);
  }, []);
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [runs.length, pending, runs.at(-1)?.status, runs.at(-1)?.interpretation]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [input]);

  const send = (text = input, as: Mode = mode) => {
    const t = text.trim();
    if (!t || pending) return;
    setError(null);
    setPending(t);
    setInput("");
    histIdx.current = -1;
    start(async () => {
      const r = await submitAction(session.id, t, as === "stata" ? "stata" : "auto");
      if (r?.error) {
        setError(r.error);
        if (as === "ask") setInput(t);
      }
      setPending(null);
    });
  };

  const insert = (word: string) => {
    const el = box.current;
    const pos = el?.selectionStart ?? input.length;
    const before = input.slice(0, pos);
    const sep = before && !/\s$/.test(before) ? " " : "";
    setInput(before + sep + word + " " + input.slice(pos));
    requestAnimationFrame(() => el?.focus());
  };
  const putCommand = (cmd: string) => {
    setMode("stata");
    setInput(cmd);
    setVarsOpen(false);
    requestAnimationFrame(() => box.current?.focus());
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !input.includes("\n") && typed.length) {
      const next = Math.max(-1, Math.min(typed.length - 1, histIdx.current + (e.key === "ArrowUp" ? 1 : -1)));
      if (next === histIdx.current) return;
      e.preventDefault();
      histIdx.current = next;
      setInput(next < 0 ? "" : typed[next]);
      if (next >= 0 && mode === "ask") setMode("stata");
    }
  };

  let tableNo = 0;
  const numbered = runs.map((r) => {
    const first = tableNo + 1;
    tableNo += r.results.reduce((a, x) => a + (x.ok ? (x.tables?.length ?? 0) + (x.images?.length ?? 0) : 0), 0);
    return first;
  });

  return (
    <div className="chat-shell flex h-full">
      {/* variables */}
      <aside className={`${varsOpen ? "fixed inset-0 z-40 flex" : "hidden"} lg:static lg:flex lg:w-[290px] lg:flex-none`}>
        <div className="flex h-full w-[85vw] max-w-[320px] flex-col border-r border-line bg-parchment lg:w-full lg:max-w-none">
          <div className="flex items-center justify-between px-4 pt-3 lg:hidden">
            <span className="text-sm font-bold">Your data</span>
            <button type="button" onClick={() => setVarsOpen(false)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white" aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
          <VariablesPanel vars={session.variables} nObs={session.nObs} onInsert={(n) => { insert(n); setVarsOpen(false); }} onCommand={putCommand} />
        </div>
        <button type="button" aria-label="Close" onClick={() => setVarsOpen(false)} className="flex-1 bg-ink/40 lg:hidden" />
      </aside>

      {/* main column */}
      <section className="flex min-w-0 flex-1 flex-col">
        <TopBar session={session} access={access} hasTables={tableNo > 0} onVars={() => setVarsOpen(true)} onDoFile={() => setDoOpen(true)} />

        <div ref={feed} className="lab-paper flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[920px] px-3 py-6 sm:px-6">
            {runs.filter((r) => r.status === "IMPORT").map((r) => (
              <div key={r.id} className="mb-7"><RunBlock run={r} sessionId={session.id} firstTable={0} aiEnabled={aiEnabled} onEdit={putCommand} /></div>
            ))}
            {!runs.some((r) => r.status !== "IMPORT") && !pending && access.canRun && <Welcome sugg={sugg} aiEnabled={aiEnabled} onAsk={(t) => { setMode("ask"); setInput(t); box.current?.focus(); }} onCmd={putCommand} />}
            <div className="space-y-7">
              {runs.map((r, i) => r.status === "IMPORT" ? null : (
                <RunBlock key={r.id} run={r} sessionId={session.id} firstTable={numbered[i]} aiEnabled={aiEnabled} onEdit={putCommand} />
              ))}
              {pending && <Pending text={pending} ask={mode === "ask"} />}
            </div>
          </div>
        </div>

        {!access.canRun ? (
          <div className="border-t border-line bg-parchment px-3 py-4 sm:px-6">
            <div className="mx-auto flex max-w-[920px] flex-col items-start gap-3 rounded-[18px] bg-green px-5 py-4 text-white sm:flex-row sm:items-center">
              <Icon name="clock" size={22} className="flex-none text-amber" />
              <p className="flex-1 text-[14.5px]">
                <b>Your free trial has ended.</b> Your results and downloads are still here. Upgrade to keep running analyses.
              </p>
              <Link href={UPGRADE_PATH} className="btn-amber min-h-10 flex-none px-5 text-sm">Upgrade</Link>
            </div>
          </div>
        ) : (
        <div className="border-t border-line bg-parchment px-3 pt-2.5 pb-3 sm:px-6">
          <div className="mx-auto max-w-[920px]">
            {!input && !pending && runs.length > 0 && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                {sugg.slice(1).map((s) => (
                  <button key={s.label} type="button" onClick={() => (mode === "ask" ? setInput(s.ask) : setInput(s.cmd))} className="flex-none rounded-full border border-line bg-white px-3 py-1 text-[12.5px] font-medium text-ink-muted hover:border-green hover:text-green">
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <div className="mb-2 flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><Icon name="x" size={16} /></button>
              </div>
            )}
            <div className={`rounded-[22px] p-1.5 shadow-[0_8px_30px_-12px_rgba(11,36,24,0.45)] transition-colors ${mode === "stata" ? "bg-[#0c1f16]" : "bg-green"}`}>
              <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-1.5">
                <div className="flex rounded-full bg-black/25 p-0.5 text-[12.5px] font-bold">
                  <button type="button" onClick={() => setMode("ask")} className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${mode === "ask" ? "bg-amber text-ink" : "text-white/70 hover:text-white"}`}>
                    <Icon name="spark" size={13} /> Ask
                  </button>
                  <button type="button" onClick={() => setMode("stata")} className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-mono ${mode === "stata" ? "bg-amber text-ink" : "text-white/70 hover:text-white"}`}>
                    <span className="font-bold">.</span> Stata
                  </button>
                </div>
                <span className="hidden text-[11.5px] text-white/50 sm:block">Enter to run · Shift+Enter new line · ↑ previous command</span>
              </div>
              <div className="flex items-end gap-2 rounded-[18px] bg-white/[0.06] px-3 py-2 ring-1 ring-white/10 focus-within:ring-amber/60">
                {mode === "stata" && <span className="pb-[3px] font-mono text-[15px] font-bold text-amber">.</span>}
                <textarea
                  ref={box}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                  spellCheck={mode === "ask"}
                  placeholder={mode === "ask" ? (aiEnabled ? "Ask about your data, e.g. Does income differ between urban and rural households?" : "Plain-English requests are not switched on yet. Switch to Stata.") : sugg.find((x) => x.cmd.startsWith("regress"))?.cmd ?? sugg[1]?.cmd ?? "summarize"}
                  className={`max-h-[220px] min-h-[26px] flex-1 resize-none bg-transparent leading-[1.55] text-white outline-none placeholder:text-white/35 ${mode === "stata" ? "font-mono text-[14px]" : "text-[15px]"}`}
                  aria-label={mode === "ask" ? "Ask a question" : "Stata command"}
                />
                <button type="button" onClick={() => send()} disabled={!input.trim() || !!pending} className="grid h-9 w-9 flex-none place-items-center rounded-full bg-amber text-ink transition hover:scale-105 disabled:opacity-40 disabled:hover:scale-100" aria-label="Run">
                  {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" /> : <Icon name="play" size={15} />}
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
      </section>

      {doOpen && <DoFileDrawer sessionId={session.id} onClose={() => setDoOpen(false)} />}
    </div>
  );
}

// ───────── top bar ─────────

function TopBar({ session, access, hasTables, onVars, onDoFile }: { session: SessionView; access: AccessView; hasTables: boolean; onVars: () => void; onDoFile: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [busy, start] = useTransition();
  const base = `/api/stats/${session.id}`;
  return (
    <div className="flex items-center gap-2 border-b border-line bg-white px-3 py-2.5 sm:px-5">
      <Link href="/tools/stats" className="grid h-9 w-9 flex-none place-items-center rounded-full text-ink-muted no-underline hover:bg-parchment" aria-label="All sessions">
        <span className="text-xl leading-none">‹</span>
      </Link>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditing(false); if (title.trim() && title !== session.title) start(() => void renameAction(session.id, title)); }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full rounded-sm border border-green px-2 py-0.5 font-display text-[17px] font-bold outline-none"
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="block max-w-full truncate text-left font-display text-[17px] font-bold" title="Rename">
            {title}
          </button>
        )}
        <div className="flex items-center gap-2 truncate text-xs text-ink-muted">
          <span className="truncate font-mono">{session.fileName}</span>
          <span>·</span>
          <span className="whitespace-nowrap">{session.nObs.toLocaleString()} obs × {session.nVars} vars</span>
          {access.label && <span className={`whitespace-nowrap rounded-full px-2 py-px font-bold ${access.urgent ? "bg-amber text-ink" : "bg-green-tint text-green"}`}>{access.label}</span>}
          {session.history.length > 0 && <DataChanges session={session} busy={busy} onReset={() => start(() => void resetAction(session.id))} />}
        </div>
      </div>
      <button type="button" onClick={onVars} className="btn-outline min-h-9 px-3 text-sm lg:hidden">Variables</button>
      <button type="button" onClick={onDoFile} className="hidden min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-bold hover:border-green sm:inline-flex">
        <Icon name="code" size={15} /> Do-file
      </button>
      <details className="relative">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full bg-green px-3.5 text-sm font-bold text-white [&::-webkit-details-marker]:hidden">
          <Icon name="download" size={15} /> <span className="hidden sm:inline">Export</span>
        </summary>
        <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-sm border border-line bg-white py-1 text-sm shadow-xl">
          {hasTables ? (
            <>
              <MenuLink href={`${base}/export?fmt=docx`} title="Tables for Word" sub="APA 7 tables, .docx" />
              <MenuLink href={`${base}/export?fmt=xlsx`} title="Tables for Excel" sub="Tables + Stata log, .xlsx" />
            </>
          ) : (
            <p className="px-4 py-2 text-xs text-ink-muted">Run an analysis to export its tables.</p>
          )}
          <MenuLink href={`${base}/dofile`} title="Do-file" sub="Re-run everything in Stata, .do" />
          <div className="my-1 border-t border-line" />
          <MenuLink href={`${base}/data?fmt=dta`} title="Working data (.dta)" sub="With your changes and labels" />
          <MenuLink href={`${base}/data?fmt=csv`} title="Working data (.csv)" />
          {!session.fileName.toLowerCase().endsWith(".dta") && <MenuLink href={`${base}/data?fmt=dta&original=1`} title="Original data (.dta)" sub="Your upload as a Stata file, for the do-file" />}
          <div className="my-1 border-t border-line" />
          <form action={() => deleteAction(session.id)} onSubmit={(e) => { if (!confirm("Delete this session and its data? This cannot be undone.")) e.preventDefault(); }}>
            <button className="w-full px-4 py-2 text-left text-red-700 hover:bg-red-50">Delete session</button>
          </form>
        </div>
      </details>
    </div>
  );
}

function MenuLink({ href, title, sub }: { href: string; title: string; sub?: string }) {
  return (
    <a href={href} className="block px-4 py-2 text-ink no-underline hover:bg-parchment">
      <span className="block font-bold">{title}</span>
      {sub && <span className="block text-xs text-ink-muted">{sub}</span>}
    </a>
  );
}

function DataChanges({ session, busy, onReset }: { session: SessionView; busy: boolean; onReset: () => void }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-full bg-amber-tint px-2 py-px font-bold text-amber-deep [&::-webkit-details-marker]:hidden">
        {session.history.length} data change{session.history.length === 1 ? "" : "s"}
      </summary>
      <div className="absolute left-0 z-30 mt-2 w-80 rounded-sm border border-line bg-white p-3 text-ink shadow-xl">
        <p className="mb-2 text-xs text-ink-muted">Applied to your data, in order. Your uploaded file is never changed.</p>
        <ol className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-sm bg-[#0c1f16] p-2.5">
          {session.history.map((h, i) => (
            <li key={i}><CommandEcho command={h} /></li>
          ))}
        </ol>
        <button type="button" disabled={busy} onClick={onReset} className="flex items-center gap-1.5 text-sm font-bold text-amber-deep disabled:opacity-50">
          <Icon name="undo" size={15} /> {busy ? "Restoring…" : "Restore the original data"}
        </button>
      </div>
    </details>
  );
}

// ───────── feed ─────────

function Welcome({ sugg, aiEnabled, onAsk, onCmd }: { sugg: ReturnType<typeof suggestions>; aiEnabled: boolean; onAsk: (t: string) => void; onCmd: (c: string) => void }) {
  return (
    <div className="ts-rise mx-auto max-w-[680px] py-6 text-center">
      <span className="inline-grid h-14 w-14 place-items-center rounded-[18px] bg-green text-amber shadow-lg"><Icon name="chart" size={26} /></span>
      <h2 className="mt-4 text-[28px] leading-tight font-extrabold sm:text-[34px]">What do you want to know?</h2>
      <p className="mx-auto mt-2 max-w-md text-ink-muted">
        {aiEnabled ? "Ask in plain English and check the Stata commands before they run — or type Stata yourself." : "Type Stata commands below. Every result comes with a clean APA table."}
      </p>
      <div className="mt-7 grid gap-2.5 text-left sm:grid-cols-2">
        {sugg.slice(0, 6).map((s) => (
          <button key={s.label} type="button" onClick={() => (aiEnabled ? onAsk(s.ask) : onCmd(s.cmd))} className="group rounded-sm border border-line bg-white p-3.5 text-left transition hover:-translate-y-0.5 hover:border-green hover:shadow-md">
            <span className="block text-[14.5px] font-bold text-ink">{aiEnabled ? s.ask : s.label}</span>
            <span className="mt-1.5 block truncate font-mono text-[12px] text-ink-muted group-hover:text-green">. {s.cmd}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Pending({ text, ask }: { text: string; ask: boolean }) {
  const isPlain = ask && !looksLikeStata(text);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 7000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="ts-rise">
      {isPlain && <Asked text={text} />}
      <div className="rounded-sm bg-[#0c1f16] px-4 py-3.5">
        {isPlain ? (
          <div className="flex items-center gap-2 font-mono text-[13px] text-[#8fbfa3]">
            <span className="text-amber">.</span> reading your codebook and choosing the right test<span className="ts-caret text-amber">▌</span>
          </div>
        ) : (
          <>
            {text.split("\n").filter(Boolean).map((l, i) => <CommandEcho key={i} command={l} />)}
            <div className="mt-1 font-mono text-[13px] text-amber"><span className="ts-caret">▌</span></div>
          </>
        )}
        {slow && <p className="mt-2 font-mono text-[12px] text-white/45">starting the statistics engine; after a quiet spell this takes up to a minute…</p>}
      </div>
    </div>
  );
}

function Asked({ text, time }: { text: string; time?: string }) {
  return (
    <div className="mb-2.5 flex items-start gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-amber text-ink"><Icon name="spark" size={14} /></span>
      <div className="min-w-0">
        <p className="text-[15.5px] leading-snug font-medium text-ink">{text}</p>
        {time && <p className="mt-0.5 text-[11.5px] text-ink-muted"><When iso={time} /></p>}
      </div>
    </div>
  );
}

/** Times in the viewer's own clock (the server renders in UTC, so the time is filled in after loading). */
function When({ iso }: { iso: string }) {
  const [t, setT] = useState("");
  useEffect(() => setT(new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), [iso]);
  return <>{t}</>;
}

function RunBlock({ run, sessionId, firstTable, aiEnabled, onEdit }: { run: RunView; sessionId: string; firstTable: number; aiEnabled: boolean; onEdit: (c: string) => void }) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState(run.commands.join("\n"));
  const english = run.mode === "ENGLISH";
  const act = (fn: () => Promise<{ error?: string } | undefined>) => start(async () => { const r = await fn(); setErr(r?.error ?? null); });

  if (run.status === "IMPORT") {
    const [head, ...rest] = (run.explanation ?? "").split("\n");
    return (
      <div className="ts-rise flex gap-3.5 rounded-sm border border-green/20 bg-white p-4 sm:p-5">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[12px] bg-green text-amber"><Icon name="check" size={20} /></span>
        <div className="min-w-0">
          <p className="font-bold text-ink">{head}</p>
          <ul className="mt-1.5 space-y-1 text-[13.5px] text-ink-muted">
            {rest.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          <p className="mt-2 text-[12.5px] text-ink-muted">Download it as a Stata file any time from Export → Original data (.dta).</p>
        </div>
      </div>
    );
  }
  if (run.status === "RESET") {
    return (
      <div className="flex items-center gap-3 text-[12.5px] font-bold text-amber-deep">
        <span className="h-px flex-1 bg-amber/40" />
        <span className="flex items-center gap-1.5"><Icon name="undo" size={14} /> Original data restored</span>
        <span className="h-px flex-1 bg-amber/40" />
      </div>
    );
  }
  if (run.status === "CANCELLED") {
    return (
      <div className="opacity-60">
        <Asked text={run.input} />
        <p className="pl-10 text-sm text-ink-muted italic">Plan cancelled.</p>
      </div>
    );
  }
  if (run.status === "CLARIFY") {
    return (
      <div className="ts-rise">
        <Asked text={run.input} time={run.createdAt} />
        <div className="ml-10 rounded-sm border-l-4 border-amber bg-white p-4 text-[15px]">{run.explanation}</div>
      </div>
    );
  }
  if (run.status === "PLAN") {
    return (
      <div className="ts-rise">
        <Asked text={run.input} time={run.createdAt} />
        <div className="overflow-hidden rounded-sm border border-green/30 bg-white shadow-[0_10px_30px_-18px_rgba(11,36,24,0.6)] sm:ml-10">
          <div className="flex items-center gap-2 border-b border-line bg-green-tint px-4 py-2.5 text-[13px] font-bold text-green">
            <Icon name="wand" size={15} /> Here is the plan. Check it, edit if you like, then run.
          </div>
          {run.explanation && <p className="px-4 pt-3 text-[14.5px] text-ink">{run.explanation}</p>}
          <div className="m-3 rounded-sm bg-[#0c1f16] px-3 py-2.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(Math.max(draft.split("\n").length, 1), 10)}
              spellCheck={false}
              className="w-full resize-none bg-transparent font-mono text-[13px] leading-[1.6] text-white outline-none"
              aria-label="Commands to run"
            />
          </div>
          {err && <p className="px-4 pb-2 text-sm text-red-700">{err}</p>}
          <div className="flex items-center gap-2 px-3 pb-3">
            <button type="button" disabled={busy} onClick={() => act(() => confirmAction(sessionId, run.id, draft))} className="btn-amber min-h-10 px-4 text-sm">
              {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" /> : <Icon name="play" size={14} />} {busy ? "Running…" : "Run analysis"}
            </button>
            <button type="button" disabled={busy} onClick={() => act(() => cancelAction(sessionId, run.id))} className="min-h-10 rounded-full px-3 text-sm font-bold text-ink-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  let tableN = firstTable;
  const hasTables = run.results.some((r) => r.ok && (r.tables?.length || r.images?.length));
  return (
    <article className="ts-rise">
      {english && <Asked text={run.input} time={run.createdAt} />}
      {english && run.explanation && <p className="mb-2.5 text-[13.5px] text-ink-muted sm:pl-10">{run.explanation}</p>}
      <div className="overflow-hidden rounded-sm bg-[#0c1f16] shadow-[0_12px_32px_-18px_rgba(11,36,24,0.7)]">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-1.5 text-[11px] text-white/40">
          <span className="flex gap-1"><i className="h-2 w-2 rounded-full bg-white/15" /><i className="h-2 w-2 rounded-full bg-white/15" /><i className="h-2 w-2 rounded-full bg-white/15" /></span>
          <span className="flex-1 font-mono">Results{!english && <> · <When iso={run.createdAt} /></>}</span>
          <button type="button" onClick={() => onEdit(run.results.map((r) => r.command).join("\n") || run.commands.join("\n"))} className="rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white" title="Edit and run again">
            Edit
          </button>
          <CopyButton text={run.results.map((r) => r.command).join("\n")} label="Copy code" className="rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white" />
          {hasTables && (
            <a href={`/api/stats/${sessionId}/export?fmt=docx&run=${run.id}`} className="rounded px-1.5 py-0.5 text-white/40 no-underline hover:bg-white/10 hover:text-white">
              Word
            </a>
          )}
        </div>
        <div className="divide-y divide-white/[0.06]">
          {run.results.map((r, i) => {
            const first = tableN;
            if (r.ok) tableN += r.tables?.length ?? 0;
            return <ResultView key={i} r={r} firstTable={first} />;
          })}
        </div>
      </div>
      {run.status === "DONE" && run.results.some((r) => r.ok && r.tables?.length) && (
        run.interpretation ? (
          <Interpretation text={run.interpretation} />
        ) : (
          aiEnabled && (
            <div className="mt-2.5 sm:pl-1">
              <button type="button" disabled={busy} onClick={() => act(() => interpretAction(sessionId, run.id))} className="inline-flex items-center gap-1.5 rounded-full border border-green/30 bg-white px-3.5 py-1.5 text-[13px] font-bold text-green hover:border-green disabled:opacity-60">
                <Icon name="spark" size={14} /> {busy ? "Writing…" : "Explain these results"}
              </button>
              {err && <span className="ml-2 text-sm text-red-700">{err}</span>}
            </div>
          )
        )
      )}
    </article>
  );
}

function ResultView({ r, firstTable }: { r: CommandResult; firstTable: number }) {
  const tables = r.ok ? (r.tables ?? []) : [];
  const [view, setView] = useState<"out" | "table">("out");
  if (r.skipped) {
    return (
      <div className="px-4 py-2.5">
        <CommandEcho command={r.command} dim />
        <p className="mt-0.5 pl-4 font-mono text-[12px] text-white/35">(not run: an earlier command stopped with an error)</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1"><CommandEcho command={r.command} /></div>
        {tables.length > 0 && (
          <div className="flex flex-none rounded-full bg-white/[0.07] p-0.5 text-[11.5px] font-bold">
            <button type="button" onClick={() => setView("out")} className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 ${view === "out" ? "bg-[#1d3a2c] text-white" : "text-white/50 hover:text-white"}`}>
              <Icon name="terminal" size={12} /> Output
            </button>
            <button type="button" onClick={() => setView("table")} className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 ${view === "table" ? "bg-amber text-ink" : "text-white/50 hover:text-white"}`}>
              <Icon name="table" size={12} /> APA table
            </button>
          </div>
        )}
      </div>
      {!r.ok ? (
        <p className="mt-1.5 font-mono text-[13px] text-[#ff8f80]">{r.error}</p>
      ) : view === "out" ? (
        r.log && !(r.images?.length && r.log.startsWith("(graph:")) ? <div className="mt-2"><StataLog text={r.log} /></div> : null
      ) : (
        <div className="mt-3 space-y-3">
          {tables.map((t, i) => (
            <div key={i} className="overflow-hidden rounded-[6px]">
              <ApaTable table={t} n={firstTable + i} />
              <div className="flex justify-end bg-[#f3efe6] px-3 py-1.5">
                <CopyButton text={tableAsText(t)} label="Copy table" className="text-[12px] font-bold text-green" />
              </div>
            </div>
          ))}
        </div>
      )}
      {r.ok && !!r.images?.length && (
        <div className="mt-3 grid gap-3">
          {r.images.map((im, i) => (
            <figure key={i} className="overflow-hidden rounded-[6px] bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${im.png}`} alt={im.title} className="mx-auto block max-h-[520px] w-full max-w-[680px] object-contain p-3" />
              <figcaption className="flex items-center justify-between gap-3 bg-[#f3efe6] px-3 py-1.5 text-[12px]">
                <span className="truncate text-ink-muted italic">{im.title}</span>
                <a href={`data:image/png;base64,${im.png}`} download={`${im.title.replace(/[^\w-]+/g, "_").slice(0, 60) || "graph"}.png`} className="flex-none font-bold text-green no-underline">Download PNG</a>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {r.ok && !!r.notes?.length && (
        <ul className="mt-2.5 space-y-1">
          {r.notes.map((n, i) => (
            <li key={i} className="flex gap-2 rounded-[6px] bg-amber/10 px-2.5 py-1.5 text-[12.5px] leading-snug text-[#f7dcb3]">
              <span className="font-bold text-amber">Note</span> {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Interpretation({ text }: { text: string }) {
  return (
    <div className="relative mt-3 rounded-sm border border-line bg-white p-4 pl-5 sm:p-5 sm:pl-6">
      <span className="absolute top-4 bottom-4 left-0 w-1 rounded-r bg-amber" />
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">What this means</span>
        <CopyButton text={text} label="Copy" className="text-[12px] font-bold text-green" />
      </div>
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="mt-1.5 text-[15px] leading-relaxed text-ink">{p}</p>
      ))}
      <p className="mt-3 text-[11.5px] text-ink-muted">Written by AI from the numbers above. Check it against the output before you use it.</p>
    </div>
  );
}

function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })}
    >
      {done ? "Copied" : label}
    </button>
  );
}

// ───────── do-file ─────────

function DoFileDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    fetch(`/api/stats/${sessionId}/dofile`).then((r) => r.text()).then(setText).catch(() => setText("* Could not load the do-file."));
  }, [sessionId]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-[560px] flex-col bg-[#0c1f16] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-white">
          <Icon name="code" size={18} className="text-amber" />
          <div className="flex-1">
            <div className="font-bold">Do-file</div>
            <div className="text-xs text-white/50">Open in Stata and run to reproduce every result.</div>
          </div>
          {text && <CopyButton text={text} label="Copy" className="rounded-full px-3 py-1 text-sm font-bold text-white/70 hover:bg-white/10" />}
          <a href={`/api/stats/${sessionId}/dofile`} className="rounded-full bg-amber px-3 py-1 text-sm font-bold text-ink no-underline">Download</a>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10" aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <pre className="stata-scroll flex-1 overflow-auto p-4 font-mono text-[12.5px] leading-[1.6]">
          {text === null ? <span className="text-white/40">Loading…</span> : text.split("\n").map((l, i) => (
            <div key={i} className="flex">
              <span className="mr-4 w-6 flex-none text-right text-white/20 select-none">{i + 1}</span>
              <span className={l.startsWith("*") ? "text-[#6f9c83] italic" : "text-white"}>
                {l.startsWith("*") ? l : (<><b className="text-amber">{l.split(" ")[0]}</b>{l.slice(l.split(" ")[0].length)}</>)}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
