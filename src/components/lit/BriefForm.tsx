"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteReviewAction, updateReviewAction } from "@/app/actions/lit";
import { STYLES } from "@/lib/cite";
import type { Brief } from "@/server/lit";
import { PURPOSES } from "./NewReview";

export function BriefForm({ id, title, researchQuestion, brief, style, locked }: { id: string; title: string; researchQuestion: string; brief: Brief; style: string; locked: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ title, rq: researchQuestion, style, purpose: brief.purpose ?? PURPOSES[0], discipline: brief.discipline ?? "", years: brief.years ?? "", regions: brief.regions ?? "", languages: brief.languages ?? "", include: brief.include ?? "", exclude: brief.exclude ?? "", notes: brief.notes ?? "" });
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = () => start(async () => {
    const r = await updateReviewAction(id, { title: f.title, researchQuestion: f.rq, style: f.style, brief: { ...brief, purpose: f.purpose, discipline: f.discipline, years: f.years, regions: f.regions, languages: f.languages, include: f.include, exclude: f.exclude, notes: f.notes } });
    setMsg(r?.error ?? "Saved");
    router.refresh();
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="card flex flex-col gap-4 p-6">
        <h2 className="text-xl font-extrabold">Brief</h2>
        <label className="text-sm font-bold">Research question<textarea className="field mt-1" rows={3} value={f.rq} onChange={set("rq")} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">Title<input className="field mt-1" value={f.title} onChange={set("title")} /></label>
          <label className="text-sm font-bold">Discipline<input className="field mt-1" value={f.discipline} onChange={set("discipline")} /></label>
          <label className="text-sm font-bold">What it&apos;s for<select className="field mt-1" value={f.purpose} onChange={set("purpose")}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="text-sm font-bold">Citation style<select className="field mt-1" value={f.style} onChange={set("style")}>{Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-sm font-bold">Years<input className="field mt-1" value={f.years} onChange={set("years")} disabled={locked} /></label>
          <label className="text-sm font-bold">Languages<input className="field mt-1" value={f.languages} onChange={set("languages")} disabled={locked} /></label>
          <label className="text-sm font-bold sm:col-span-2">Regions or settings<input className="field mt-1" value={f.regions} onChange={set("regions")} disabled={locked} /></label>
          <label className="text-sm font-bold sm:col-span-2">Include<textarea className="field mt-1" rows={2} value={f.include} onChange={set("include")} disabled={locked} /></label>
          <label className="text-sm font-bold sm:col-span-2">Exclude<textarea className="field mt-1" rows={2} value={f.exclude} onChange={set("exclude")} disabled={locked} /></label>
          <label className="text-sm font-bold sm:col-span-2">Notes<textarea className="field mt-1" rows={2} value={f.notes} onChange={set("notes")} /></label>
        </div>
        {locked && <p className="text-[13px] text-ink-muted">The search scope is locked while an expert is working on it.</p>}
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy} onClick={save} className="btn-primary">{busy ? "Saving…" : "Save"}</button>
          {msg && <span className={`text-sm ${msg === "Saved" ? "text-green" : "text-red-700"}`}>{msg}</span>}
        </div>
      </div>
      <div className="card h-fit p-6">
        <h3 className="font-extrabold text-red-800">Delete this review</h3>
        <p className="mt-1 text-sm text-ink-muted">Removes the papers, PDFs, reading cards and writing. This can&apos;t be undone.</p>
        <button type="button" disabled={busy || locked} onClick={() => confirm("Delete this review and all its papers?") && start(async () => { const r = await deleteReviewAction(id); if (r?.error) setMsg(r.error); })} className="mt-3 rounded-full border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">Delete review</button>
      </div>
    </div>
  );
}
