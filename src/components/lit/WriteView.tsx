"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { editParagraphAction, outlineAction, refreshReviewAction, saveOutlineAction, updateReviewAction, writeSectionAction } from "@/app/actions/lit";
import { STYLES, type PaperMeta, type Style, pno } from "@/lib/cite";
import { citationOrder, paragraphText, sentenceText } from "@/lib/litText";
import type { Paragraph, Section, Warning, WriteState } from "@/server/litAnalysis";
import { Icon } from "../Icons";

type P = { n: number; meta: PaperMeta };

export function WriteView({ reviewId, state, papers, style, warnings, canRun, aiOn }: { reviewId: string; state: WriteState; papers: P[]; style: Style; warnings: Warning[]; canRun: boolean; aiOn: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [words, setWords] = useState(String(state.targetWords ?? 3500));
  const [writing, setWriting] = useState<{ at: number; total: number; heading: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const byId = useMemo(() => Object.fromEntries(papers.map((p) => [pno(p.n), p])), [papers]);
  const outline = state.outline ?? [];
  const sections = state.sections ?? {};
  const order = citationOrder(outline.map((s) => sections[s.id] ?? []));
  const writtenCount = outline.filter((s) => sections[s.id]?.length).length;
  const totalWords = outline.reduce((a, s) => a + (sections[s.id] ?? []).reduce((b, pa) => b + paragraphText(pa, byId, style, order).split(/\s+/).length, 0), 0);
  const counts = outline.flatMap((s) => (sections[s.id] ?? []).flatMap((pa) => (pa.edited ? [] : pa.sentences.map((x) => x.status))));
  const verified = counts.filter((x) => x === "verified").length;
  const unverified = counts.filter((x) => x === "unverified").length;

  if (!state.synthesis) {
    return (
      <div className="card mx-auto max-w-xl p-8 text-center">
        <h2 className="text-2xl font-extrabold">Synthesise first</h2>
        <p className="mt-2 text-ink-muted">The writing is built from the synthesis: themes, debates and gaps across your papers.</p>
        <Link href={`/tools/lit/${reviewId}/synthesis`} className="btn-primary mt-5">Go to synthesis</Link>
      </div>
    );
  }

  async function writeAll(only?: string) {
    setErr(null);
    const todo = only ? outline.filter((s) => s.id === only) : outline.filter((s) => !sections[s.id]?.length);
    for (let i = 0; i < todo.length; i++) {
      setWriting({ at: i, total: todo.length, heading: todo[i].heading });
      const r = await writeSectionAction(reviewId, todo[i].id);
      if (r?.error) {
        setErr(r.error);
        break;
      }
    }
    setWriting(null);
    await refreshReviewAction(reviewId);
    router.refresh();
  }

  const plan = () =>
    start(async () => {
      if (writtenCount && !confirm("A new outline replaces the sections written so far. Continue?")) return;
      const r = await outlineAction(reviewId, Number(words) || 3500);
      setErr(r?.error ?? null);
      router.refresh();
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <aside className="flex flex-col gap-4">
        <div className="card p-5">
          <h2 className="text-lg font-extrabold">1. Plan</h2>
          <p className="mt-1 text-[13px] text-ink-muted">Critical and concise: ten pages of real synthesis beat fifty of summaries. About 350 words make a page.</p>
          <label className="mt-3 block text-[13px] font-bold">Target length (words)
            <input type="number" min={1200} max={15000} step={100} value={words} onChange={(e) => setWords(e.target.value)} className="field mt-1 py-2" />
          </label>
          <button type="button" disabled={busy || !canRun || !aiOn} onClick={plan} className={outline.length ? "mt-3 w-full rounded-full border border-green/30 bg-white px-4 py-2 text-sm font-bold text-green hover:border-green disabled:opacity-50" : "btn-amber mt-3 w-full"}>
            {busy ? "Planning…" : outline.length ? "Make a new outline" : "Plan the review"}
          </button>
        </div>
        {outline.length > 0 && <OutlineEditor reviewId={reviewId} outline={outline} themes={state.synthesis.themes} sections={sections} onWrite={(id) => writeAll(id)} disabled={!!writing || !canRun || !aiOn} />}
        {outline.length > 0 && (
          <div className="card p-5">
            <h2 className="text-lg font-extrabold">2. Write</h2>
            <p className="mt-1 text-[13px] text-ink-muted">{writtenCount} of {outline.length} sections written{totalWords ? ` · about ${totalWords.toLocaleString()} words` : ""}.</p>
            {writing ? (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-parchment"><div className="h-full rounded-full bg-amber transition-all" style={{ width: `${Math.round(((writing.at + 0.5) / writing.total) * 100)}%` }} /></div>
                <p className="mt-1 text-[12.5px] text-ink-muted">Writing “{writing.heading}”…</p>
              </div>
            ) : (
              writtenCount < outline.length && <button type="button" disabled={!canRun || !aiOn} onClick={() => writeAll()} className="btn-amber mt-3 w-full"><Icon name="play" size={14} /> Write {outline.length - writtenCount} section{outline.length - writtenCount === 1 ? "" : "s"}</button>
            )}
            {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
        {writtenCount > 0 && <Downloads reviewId={reviewId} style={style} />}
      </aside>

      <section className="min-w-0">
        {!outline.length ? (
          <div className="card grid min-h-[300px] place-items-center p-8 text-center">
            <div>
              <h2 className="text-xl font-extrabold">Start with an outline</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">You approve the structure before anything is written: an introduction, sections built on your themes, the gaps that lead to your research question, and a conclusion.</p>
            </div>
          </div>
        ) : (
          <>
            {writtenCount > 0 && (
              <div className="mb-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="rounded-full bg-green-tint px-2.5 py-1 font-bold text-green">{verified} sentences checked against the papers</span>
                  {unverified > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 font-bold text-red-800">{unverified} without a matching passage</span>}
                  <span className="text-ink-muted">Hover over a sentence to see the passage it rests on. Underlined in red: check it yourself.</span>
                </div>
                <CriticalCheck warnings={warnings} outline={outline} />
              </div>
            )}
            <article className="card p-6 sm:p-9">
              {outline.map((s) => (
                <div key={s.id} id={`sec-${s.id}`} className="mb-8 last:mb-0">
                  <h2 className="mb-3 text-[22px] font-extrabold text-green">{s.heading}</h2>
                  {sections[s.id]?.length ? (
                    sections[s.id].map((pa, i) => <ParagraphView key={i} reviewId={reviewId} sectionId={s.id} index={i} pa={pa} byId={byId} style={style} order={order} warn={warnings.filter((w) => w.sectionId === s.id && w.paragraph === i)} />)
                  ) : (
                    <p className="text-[14px] text-ink-muted italic">Not written yet. {s.purpose}</p>
                  )}
                </div>
              ))}
            </article>
          </>
        )}
      </section>
    </div>
  );
}

function ParagraphView({ reviewId, sectionId, index, pa, byId, style, order, warn }: { reviewId: string; sectionId: string; index: number; pa: Paragraph; byId: Record<string, P>; style: Style; order: Record<string, number>; warn: Warning[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => paragraphText(pa, byId, style, order));
  const [busy, start] = useTransition();
  const save = (t: string | null) => start(async () => { await editParagraphAction(reviewId, sectionId, index, t); setEditing(false); router.refresh(); });
  return (
    <div id={`p-${sectionId}-${index}`} className={`group relative mb-4 rounded-sm ${warn.length ? "border-l-4 border-amber pl-3" : ""}`}>
      {editing ? (
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.max(5, Math.ceil(text.length / 90))} className="field text-[15px] leading-relaxed" aria-label="Paragraph" />
          <div className="flex gap-3 text-sm">
            <button type="button" disabled={busy} onClick={() => save(text)} className="btn-primary min-h-9 px-4">Save</button>
            {pa.edited && <button type="button" disabled={busy} onClick={() => save(null)} className="font-bold text-ink-muted">Restore the checked version</button>}
            <button type="button" onClick={() => setEditing(false)} className="font-bold text-ink-muted">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[16px] leading-[1.8] text-ink [text-indent:2em]">
            {pa.edited ? pa.edited : pa.sentences.map((s, i) => {
              const t = sentenceText(s, byId, style, order);
              if (s.status === "analysis") return <span key={i}>{t} </span>;
              const ev = s.evidence.map((e) => `${e.p}${e.page ? ` p.${e.page}` : ""}: “${e.quote}”`).join("\n\n");
              return (
                <span key={i} title={s.status === "verified" ? ev : "No passage in the cited papers was matched to this sentence. Check it before you keep it."} className={s.status === "verified" ? "cursor-help decoration-green/40 decoration-dotted underline-offset-4 hover:underline" : "cursor-help underline decoration-red-500 decoration-wavy underline-offset-4"}>
                  {t}{" "}
                </span>
              );
            })}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12.5px] opacity-70 group-hover:opacity-100">
            {pa.edited && <span className="rounded-full bg-parchment px-2 py-0.5 font-bold text-ink-muted">Edited by you</span>}
            <button type="button" onClick={() => setEditing(true)} className="font-bold text-green">Edit</button>
            {warn.map((w, i) => <span key={i} className="text-amber-deep">⚑ {w.message}</span>)}
          </div>
        </>
      )}
    </div>
  );
}

function CriticalCheck({ warnings, outline }: { warnings: Warning[]; outline: Section[] }) {
  const heading = Object.fromEntries(outline.map((s) => [s.id, s.heading]));
  if (!warnings.length) return <div className="rounded-sm bg-green-tint p-3 text-[14px] text-green"><b>Critical check passed.</b> No author-by-author paragraphs, single-source paragraphs or unsupported claims were found.</div>;
  return (
    <details className="rounded-sm border border-amber/50 bg-amber-tint p-3 text-[14px]" open={warnings.length <= 6}>
      <summary className="cursor-pointer font-bold text-amber-deep">Critical check: {warnings.length} thing{warnings.length === 1 ? "" : "s"} a supervisor would question</summary>
      <ul className="mt-2 space-y-1">
        {warnings.map((w, i) => (
          <li key={i}><a href={`#p-${w.sectionId}-${w.paragraph}`} className="font-bold text-ink">{heading[w.sectionId]}, paragraph {w.paragraph + 1}:</a> <span className="text-ink-muted">{w.message}</span></li>
        ))}
      </ul>
    </details>
  );
}

function OutlineEditor({ reviewId, outline, themes, sections, onWrite, disabled }: { reviewId: string; outline: Section[]; themes: { id: string; name: string }[]; sections: Record<string, Paragraph[]>; onWrite: (id: string) => void; disabled: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(outline);
  const [dirty, setDirty] = useState(false);
  const [busy, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const set = (i: number, patch: Partial<Section>) => { setList((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };
  const move = (i: number, by: number) => { setList((xs) => { const ys = [...xs]; const [x] = ys.splice(i, 1); ys.splice(i + by, 0, x); return ys; }); setDirty(true); };
  const save = () => start(async () => { await saveOutlineAction(reviewId, list); setDirty(false); router.refresh(); });
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Outline</h2>
        {dirty && <button type="button" disabled={busy} onClick={save} className="btn-primary min-h-8 px-3 text-[13px]">{busy ? "Saving…" : "Save outline"}</button>}
      </div>
      <ol className="mt-3 space-y-2">
        {list.map((s, i) => (
          <li key={s.id} className="rounded-sm border border-line">
            <div className="flex items-center gap-2 p-2.5">
              <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[14px] font-bold">{i + 1}. {s.heading}</span>
                <span className="block text-[12px] text-ink-muted">~{s.words} words{sections[s.id]?.length ? " · written" : ""}</span>
              </button>
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="px-1 text-ink-muted disabled:opacity-30">↑</button>
              <button type="button" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)} className="px-1 text-ink-muted disabled:opacity-30">↓</button>
            </div>
            {open === s.id && (
              <div className="space-y-2 border-t border-line p-2.5">
                <input value={s.heading} onChange={(e) => set(i, { heading: e.target.value })} className="field py-1.5 text-sm font-bold" aria-label="Heading" />
                <textarea value={s.purpose} onChange={(e) => set(i, { purpose: e.target.value })} rows={2} className="field py-1.5 text-[13px]" placeholder="The argument this section makes" aria-label="Purpose" />
                <textarea value={s.points.join("\n")} onChange={(e) => set(i, { points: e.target.value.split("\n") })} rows={4} className="field py-1.5 text-[13px]" placeholder="Points to cover, one per line" aria-label="Points" />
                <div className="flex flex-wrap gap-1.5">
                  {themes.map((t) => {
                    const on = s.themeIds.includes(t.id);
                    return <button key={t.id} type="button" onClick={() => set(i, { themeIds: on ? s.themeIds.filter((x) => x !== t.id) : [...s.themeIds, t.id] })} className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${on ? "bg-green text-white" : "bg-parchment text-ink-muted"}`}>{t.name}</button>;
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[13px]">
                  <label className="flex items-center gap-1.5">Words <input type="number" min={100} max={4000} step={50} value={s.words} onChange={(e) => set(i, { words: Number(e.target.value) })} className="w-20 rounded-[8px] border border-line px-2 py-1" /></label>
                  <button type="button" disabled={disabled || dirty} title={dirty ? "Save the outline first" : undefined} onClick={() => onWrite(s.id)} className="font-bold text-green disabled:opacity-40">{sections[s.id]?.length ? "Rewrite" : "Write"} this section</button>
                  <button type="button" onClick={() => { if (confirm("Remove this section?")) { setList((xs) => xs.filter((_, j) => j !== i)); setDirty(true); } }} className="font-bold text-red-700">Remove</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => { setList((xs) => [...xs, { id: `S${Date.now().toString(36)}`, heading: "New section", purpose: "", points: [], themeIds: [], words: 400 }]); setDirty(true); }} className="mt-2 text-[13px] font-bold text-green">+ Add a section</button>
    </div>
  );
}

function Downloads({ reviewId, style }: { reviewId: string; style: Style }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const link = (f: string, label: string) => <a href={`/api/lit/${reviewId}/export?f=${f}`} className="flex items-center gap-2 font-bold text-green"><Icon name="download" size={14} /> {label}</a>;
  return (
    <div className="card p-5">
      <h2 className="text-lg font-extrabold">3. Download</h2>
      <label className="mt-2 block text-[13px] font-bold">Citation style
        <select value={style} disabled={busy} onChange={(e) => start(async () => { await updateReviewAction(reviewId, { style: e.target.value }); router.refresh(); })} className="field mt-1 py-2 text-sm">
          {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <div className="mt-3 flex flex-col gap-2 text-sm">
        {link("review", "Literature review (Word)")}
        {link("bibliography", "Annotated bibliography (Word)")}
        {link("matrix", "Synthesis matrix (Excel)")}
        {link("ris", "References: RIS (Zotero, Mendeley, EndNote)")}
        {link("bibtex", "References: BibTeX")}
      </div>
      <p className="mt-3 text-[12px] text-ink-muted">Read and revise before submitting, and follow your institution&apos;s rules on AI assistance.</p>
    </div>
  );
}
