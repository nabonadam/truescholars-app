"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readAction } from "@/app/actions/lit";
import { type PaperMeta, pno, shortAuthors } from "@/lib/cite";
import type { Card, Point } from "@/server/litAnalysis";
import { Icon } from "../Icons";

export type ReadingPaper = { id: string; n: number; meta: PaperMeta; card: Card | null; cardStatus: string; cardError: string | null; hasFile: boolean };

export function Reading({ reviewId, papers, canRun, aiOn }: { reviewId: string; papers: ReadingPaper[]; canRun: boolean; aiOn: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const read = papers.filter((p) => p.cardStatus === "done").length;
  const unread = papers.filter((p) => p.cardStatus === "none").length;
  const failed = papers.filter((p) => p.cardStatus === "failed");

  async function readAll() {
    setErr(null);
    setProgress({ done: read + failed.length, total: papers.length });
    for (let i = 0; i < 200; i++) {
      const r = await readAction(reviewId);
      if (r.error) {
        setErr(r.error);
        break;
      }
      setProgress({ done: r.done ?? 0, total: r.total ?? 0 });
      if (r.finished) break;
    }
    setProgress(null);
    router.refresh();
  }

  async function again(id: string) {
    setErr(null);
    setProgress({ done: 0, total: 1 });
    const r = await readAction(reviewId, id);
    if (r.error) setErr(r.error);
    setProgress(null);
    router.refresh();
  }

  if (!papers.length) {
    return (
      <div className="card mx-auto max-w-xl p-8 text-center">
        <h2 className="text-2xl font-extrabold">No papers to read yet</h2>
        <p className="mt-2 text-ink-muted">Add or accept papers first.</p>
        <Link href={`/tools/lit/${reviewId}`} className="btn-primary mt-5">Go to papers</Link>
      </div>
    );
  }

  const shown = papers.filter((p) => !q || JSON.stringify([p.meta.title, p.meta.authors, p.card?.keywords]).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-5">
      <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h2 className="text-xl font-extrabold">Systematic reading</h2>
          <p className="text-sm text-ink-muted">Each paper is read in full: introduction, methods, findings, conclusions, key terms and keywords. Every point carries the exact passage and page it comes from, checked against the PDF.</p>
          {progress ? (
            <div className="mt-3 max-w-md">
              <div className="h-2 overflow-hidden rounded-full bg-parchment"><div className="h-full rounded-full bg-amber transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }} /></div>
              <p className="mt-1 text-[12.5px] text-ink-muted">Reading… {progress.done} of {progress.total} papers. A paper takes about half a minute.</p>
            </div>
          ) : (
            <p className="mt-2 text-sm font-bold text-green">{read} of {papers.length} read{failed.length ? ` · ${failed.length} couldn't be read` : ""}</p>
          )}
          {!aiOn && <p className="mt-2 text-sm text-amber-deep">AI reading isn&apos;t switched on for this site yet.</p>}
          {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        </div>
        <div className="flex flex-col gap-2">
          {unread > 0 && <button type="button" disabled={!!progress || !canRun || !aiOn} onClick={readAll} className="btn-amber"><Icon name="play" size={14} /> Read {unread} paper{unread === 1 ? "" : "s"}</button>}
          {read >= 2 && <Link href={`/tools/lit/${reviewId}/synthesis`} className="btn-primary text-center">Go to synthesis →</Link>}
        </div>
      </div>

      {failed.length > 0 && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-4 text-sm">
          <b className="text-red-800">Couldn&apos;t be read:</b>
          <ul className="mt-1 space-y-1">{failed.map((p) => <li key={p.id}>{pno(p.n)} {p.meta.title ?? ""}: {p.cardError} <button type="button" disabled={!!progress || !canRun} onClick={() => again(p.id)} className="font-bold text-green">Try again</button></li>)}</ul>
        </div>
      )}

      {read > 0 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search papers, authors, keywords" className="field w-full py-2 sm:w-80" />}
      <div className="space-y-3">
        {shown.filter((p) => p.card).map((p) => <CardView key={p.id} p={p} onReread={() => again(p.id)} busy={!!progress || !canRun} />)}
      </div>
    </div>
  );
}

function Quote({ pt, paperId, hasFile }: { pt: Point; paperId: string; hasFile: boolean }) {
  if (!pt.quote) return pt.text && pt.text !== "Not reported" ? <span className="ml-1 text-[11.5px] text-ink-muted" title="No exact passage was found for this point">(no passage found)</span> : null;
  return (
    <span className="mt-1 block border-l-2 border-amber pl-2 text-[13px] text-ink-muted">
      “{pt.quote}”{" "}
      {pt.page && hasFile ? <a href={`/api/lit/paper/${paperId}#page=${pt.page}`} target="_blank" rel="noreferrer" className="font-bold whitespace-nowrap text-green">p. {pt.page} ↗</a> : pt.page ? <span className="font-bold">p. {pt.page}</span> : null}
    </span>
  );
}

const QUALITY: Record<string, string> = { strong: "bg-green-tint text-green", moderate: "bg-amber-tint text-amber-deep", weak: "bg-red-100 text-red-800", unclear: "bg-parchment text-ink-muted" };

function CardView({ p, onReread, busy }: { p: ReadingPaper; onReread: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const c = p.card!;
  const m = p.meta;
  const checked = [c.aim, c.design, c.sample, ...c.findings, c.conclusions, ...c.limitations, ...c.keyTerms].filter((x) => x.text && x.text !== "Not reported");
  const verified = checked.filter((x) => x.verified).length;
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="mt-0.5 rounded-full bg-green px-2 py-0.5 text-[11.5px] font-bold text-white">{pno(p.n)}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{m.title ?? "Untitled"}</span>
          <span className="block text-[13px] text-ink-muted">{shortAuthors(m)} ({m.year ?? "n.d."}) · {c.design.type}{c.context.country ? ` · ${c.context.country}` : ""}</span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${QUALITY[c.quality.rating]}`}>Evidence: {c.quality.rating}</span>
            <span className="rounded-full bg-green-tint px-2 py-0.5 text-[11.5px] font-bold text-green">{verified} of {checked.length} points backed by a checked passage</span>
            {c.basis === "abstract" && <span className="rounded-full bg-amber-tint px-2 py-0.5 text-[11.5px] font-bold text-amber-deep">Abstract only</span>}
            {c.keywords.slice(0, 5).map((k) => <span key={k} className="rounded-full bg-parchment px-2 py-0.5 text-[11.5px] text-ink-muted">{k}</span>)}
          </span>
        </span>
        <span className="text-ink-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="grid gap-5 border-t border-line p-5 lg:grid-cols-2">
          <div className="space-y-3 text-[14.5px] leading-relaxed">
            {(["introduction", "methods", "findings", "conclusions"] as const).map((k) => (
              <div key={k}>
                <h4 className="text-[12px] font-bold tracking-wide text-green uppercase">{k}</h4>
                <p>{c.summary[k] || <span className="text-ink-muted">Not reported</span>}</p>
              </div>
            ))}
            {c.keyTerms.length > 0 && (
              <div>
                <h4 className="text-[12px] font-bold tracking-wide text-green uppercase">Key terms, as this paper uses them</h4>
                <ul className="mt-1 space-y-2">{c.keyTerms.map((k) => <li key={k.term}><b>{k.term}:</b> {k.text}<Quote pt={k} paperId={p.id} hasFile={p.hasFile} /></li>)}</ul>
              </div>
            )}
          </div>
          <div className="space-y-3 text-[14px]">
            <Field label="Aim" pt={c.aim} p={p} />
            <Field label="Theory or framework" pt={c.theory} p={p} />
            <Field label="Context" pt={c.context} p={p} />
            <Field label="Design" pt={c.design} p={p} />
            <Field label="Sample" pt={c.sample} p={p} />
            <div>
              <h4 className="text-[12px] font-bold tracking-wide text-green uppercase">Key findings</h4>
              <ul className="mt-1 list-disc space-y-1.5 pl-5">{c.findings.map((f, i) => <li key={i}>{f.text}<Quote pt={f} paperId={p.id} hasFile={p.hasFile} /></li>)}</ul>
            </div>
            <Field label="Conclusions" pt={c.conclusions} p={p} />
            {c.limitations.length > 0 && (
              <div>
                <h4 className="text-[12px] font-bold tracking-wide text-green uppercase">Limitations</h4>
                <ul className="mt-1 list-disc space-y-1.5 pl-5">{c.limitations.map((f, i) => <li key={i}>{f.text}<Quote pt={f} paperId={p.id} hasFile={p.hasFile} /></li>)}</ul>
              </div>
            )}
            <p className="text-[13px] text-ink-muted"><b>Quality:</b> {c.quality.notes}</p>
            <div className="flex gap-4 text-[13px]">
              {p.hasFile && <a href={`/api/lit/paper/${p.id}`} target="_blank" rel="noreferrer" className="font-bold text-green">Open PDF ↗</a>}
              <button type="button" disabled={busy} onClick={onReread} className="font-bold text-ink-muted hover:text-ink">Read again</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, pt, p }: { label: string; pt: Point; p: ReadingPaper }) {
  return (
    <div>
      <h4 className="text-[12px] font-bold tracking-wide text-green uppercase">{label}</h4>
      <p>{pt.text || <span className="text-ink-muted">Not reported</span>}<Quote pt={pt} paperId={p.id} hasFile={p.hasFile} /></p>
    </div>
  );
}
