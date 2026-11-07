"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { addDoiAction, decidePaperAction, deletePaperAction, paperMetaAction, paperNoteAction, recheckAction } from "@/app/actions/lit";
import type { PaperMeta } from "@/lib/cite";
import { pno } from "@/lib/cite";
import { Icon } from "../Icons";

export type PaperView = {
  id: string;
  n: number;
  source: string;
  status: string;
  rejectReason: string | null;
  fileName: string | null;
  hasFile: boolean;
  pages: number | null;
  meta: PaperMeta;
  verify: { checked: boolean; found: boolean; titleMatch?: boolean; retracted?: boolean; message?: string } | null;
  note: string | null;
  cardStatus: string;
};

const fmtAuthors = (m: PaperMeta) => {
  const a = m.authors ?? [];
  if (!a.length) return "Authors unknown";
  return a.length > 3 ? `${a.slice(0, 3).map((x) => x.family).join(", ")} et al.` : a.map((x) => x.family).join(", ");
};

export function Papers({ reviewId, papers, role, canWork }: { reviewId: string; papers: PaperView[]; role: "owner" | "expert"; canWork: boolean }) {
  const router = useRouter();
  const pending = papers.filter((p) => p.status === "PENDING");
  const accepted = papers.filter((p) => p.status === "ACCEPTED");
  const rejected = papers.filter((p) => p.status === "REJECTED");
  const owner = role === "owner";
  return (
    <div className="flex flex-col gap-6">
      {canWork && <Uploader reviewId={reviewId} expert={!owner} onDone={() => router.refresh()} />}

      {owner && pending.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-extrabold">Delivered by your expert: review each paper</h2>
            <AcceptAll reviewId={reviewId} ids={pending.map((p) => p.id)} />
          </div>
          <p className="mb-3 text-sm text-ink-muted">Check each paper&apos;s details, its DOI link and the expert&apos;s note. Accept the ones you want in your review; reject the rest with a short reason so the expert can replace them.</p>
          <div className="space-y-2">{pending.map((p) => <PaperRow key={p.id} reviewId={reviewId} p={p} owner={owner} />)}</div>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold">{owner ? `Papers in your review (${accepted.length})` : `Papers you've added (${papers.length})`}</h2>
          {papers.length > 0 && (
            <div className="flex flex-wrap gap-3 text-sm">
              <a className="font-bold text-green" href={`/api/lit/${reviewId}/export?f=spreadsheet`}><Icon name="download" size={14} /> Spreadsheet (Excel)</a>
              {owner && accepted.length > 0 && <a className="font-bold text-green" href={`/api/lit/${reviewId}/export?f=ris`}><Icon name="download" size={14} /> RIS (Zotero, Mendeley, EndNote)</a>}
              {owner && accepted.length > 0 && <a className="font-bold text-green" href={`/api/lit/${reviewId}/export?f=bibtex`}><Icon name="download" size={14} /> BibTeX</a>}
            </div>
          )}
        </div>
        {(owner ? accepted : papers).length ? (
          <div className="space-y-2">{(owner ? accepted : papers).map((p) => <PaperRow key={p.id} reviewId={reviewId} p={p} owner={owner} />)}</div>
        ) : (
          <p className="rounded-sm border border-dashed border-line p-6 text-center text-sm text-ink-muted">No papers yet. Upload PDFs above{owner ? ", or ask an expert to find them" : ""}.</p>
        )}
        {owner && accepted.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-sm bg-green-tint p-4">
            <span className="text-[15px] text-green"><b>Ready when you are.</b> {accepted.filter((p) => p.cardStatus === "done").length} of {accepted.length} papers read.</span>
            <Link href={`/tools/lit/${reviewId}/reading`} className="btn-primary min-h-10 px-4 text-sm">Read the papers →</Link>
          </div>
        )}
      </section>

      {owner && rejected.length > 0 && (
        <details className="rounded-sm border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold text-ink-muted">Rejected papers ({rejected.length})</summary>
          <div className="mt-3 space-y-2">{rejected.map((p) => <PaperRow key={p.id} reviewId={reviewId} p={p} owner={owner} />)}</div>
        </details>
      )}
    </div>
  );
}

function Uploader({ reviewId, expert, onDone }: { reviewId: string; expert: boolean; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<{ name: string; state: "waiting" | "uploading" | "done" | "error"; msg?: string }[]>([]);
  const [drag, setDrag] = useState(false);
  const [doi, setDoi] = useState("");
  const [doiMsg, setDoiMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();

  async function upload(files: File[]) {
    const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return;
    setItems(pdfs.map((f) => ({ name: f.name, state: "waiting" })));
    for (let i = 0; i < pdfs.length; i++) {
      setItems((xs) => xs.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
      try {
        const res = await fetch(`/api/lit/${reviewId}/papers`, { method: "POST", headers: { "content-type": "application/pdf", "x-file-name": encodeURIComponent(pdfs[i].name) }, body: pdfs[i] });
        const j = (await res.json().catch(() => ({}))) as { error?: string; textFound?: boolean };
        if (!res.ok) throw new Error(j.error || "Upload failed");
        setItems((xs) => xs.map((x, k) => (k === i ? { ...x, state: "done", msg: j.textFound === false ? "No readable text (scanned?). Details and abstract still used." : undefined } : x)));
      } catch (e) {
        setItems((xs) => xs.map((x, k) => (k === i ? { ...x, state: "error", msg: e instanceof Error ? e.message : "Upload failed" } : x)));
      }
    }
    onDone();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files]); }}
        className={`rounded-md border-2 border-dashed p-6 text-center transition ${drag ? "border-green bg-green-tint" : "border-line bg-white"}`}
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-green-tint text-green"><Icon name="upload" size={22} /></span>
        <p className="mt-3 font-bold">Drop PDFs here, or <button type="button" onClick={() => input.current?.click()} className="text-green underline">choose files</button></p>
        <p className="mt-1 text-[13px] text-ink-muted">Up to 40 MB each. Each paper is read page by page and checked with Crossref.{expert ? " The client reviews every paper you add." : ""}</p>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => upload([...(e.target.files ?? [])])} />
        {items.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-left text-[13.5px]">
            {items.map((x, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${x.state === "done" ? "bg-green" : x.state === "error" ? "bg-red-600" : x.state === "uploading" ? "animate-pulse bg-amber" : "bg-line"}`} />
                <span className="min-w-0 flex-1"><span className="font-bold">{x.name}</span>{x.state === "uploading" ? " · reading and checking…" : ""}{x.msg && <span className={`block ${x.state === "error" ? "text-red-700" : "text-ink-muted"}`}>{x.msg}</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card p-5">
        <h3 className="font-bold">Add by DOI</h3>
        <p className="mt-1 text-[13px] text-ink-muted">For a paper behind a paywall: add its DOI now{expert ? "; the client attaches their own copy through their library" : " and attach the PDF later from your library"}.</p>
        <div className="mt-3 flex gap-2">
          <input value={doi} onChange={(e) => setDoi(e.target.value)} className="field py-2 text-sm" placeholder="10.1016/j.jrurstud.2021.01.002" aria-label="DOI" />
          <button type="button" disabled={busy || !doi.trim()} onClick={() => start(async () => { const r = await addDoiAction(reviewId, doi); setDoiMsg(r?.error ?? null); if (!r?.error) { setDoi(""); onDone(); } })} className="btn-primary min-h-10 px-4 text-sm">{busy ? "…" : "Add"}</button>
        </div>
        {doiMsg && <p className="mt-2 text-sm text-red-700">{doiMsg}</p>}
      </div>
    </div>
  );
}

function AcceptAll({ reviewId, ids }: { reviewId: string; ids: string[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button type="button" disabled={busy} onClick={() => start(async () => { for (const id of ids) await decidePaperAction(reviewId, id, true); router.refresh(); })} className="rounded-full border border-green/30 bg-white px-3 py-1 text-[13px] font-bold text-green hover:border-green">
      {busy ? "Accepting…" : `Accept all ${ids.length}`}
    </button>
  );
}

function Badge({ p }: { p: PaperView }) {
  const v = p.verify;
  if (v?.retracted) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11.5px] font-bold text-red-800">Retracted: don&apos;t rely on it</span>;
  if (v?.found && v.titleMatch !== false) return <span className="rounded-full bg-green-tint px-2 py-0.5 text-[11.5px] font-bold text-green" title="Its DOI and details match the official Crossref record">✓ Verified with Crossref</span>;
  if (v?.found && v.titleMatch === false) return <span className="rounded-full bg-amber-tint px-2 py-0.5 text-[11.5px] font-bold text-amber-deep" title="The DOI exists, but its title differs from the PDF's first page">DOI and PDF don&apos;t match</span>;
  return <span className="rounded-full bg-parchment px-2 py-0.5 text-[11.5px] font-bold text-ink-muted" title={v?.message}>Not verified</span>;
}

function PaperRow({ reviewId, p, owner }: { reviewId: string; p: PaperView; owner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const m = p.meta;
  const run = (fn: () => Promise<{ error?: string; ok?: string } | undefined>) =>
    start(async () => {
      const r = await fn();
      setMsg(r?.error ?? r?.ok ?? null);
      router.refresh();
    });
  const canEdit = owner || p.status === "PENDING";
  return (
    <div className={`rounded-sm border bg-white ${p.status === "PENDING" ? "border-amber/50" : "border-line"}`}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 p-3.5 text-left">
        <span className="mt-0.5 rounded-full bg-green px-2 py-0.5 text-[11.5px] font-bold text-white">{pno(p.n)}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-ink">{m.title || p.fileName || "Untitled"}</span>
          <span className="block text-[13px] text-ink-muted">{fmtAuthors(m)} · {m.year ?? "n.d."}{m.journal ? ` · ${m.journal}` : ""}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge p={p} />
            {!p.hasFile && <span className="rounded-full bg-amber-tint px-2 py-0.5 text-[11.5px] font-bold text-amber-deep">No PDF yet</span>}
            {p.cardStatus === "done" && <span className="rounded-full bg-green-tint px-2 py-0.5 text-[11.5px] font-bold text-green">Read</span>}
            {p.source === "EXPERT" && <span className="rounded-full bg-parchment px-2 py-0.5 text-[11.5px] font-bold text-ink-muted">From your expert</span>}
            {p.status === "REJECTED" && p.rejectReason && <span className="text-[12px] text-ink-muted">Rejected: {p.rejectReason}</span>}
          </span>
          {p.note && <span className="mt-1.5 block border-l-2 border-amber pl-2 text-[13px] text-ink">{p.note}</span>}
        </span>
        <span className="text-ink-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-line p-3.5">
          {editing ? (
            <MetaForm p={p} onCancel={() => setEditing(false)} onSave={(meta) => run(async () => { const r = await paperMetaAction(reviewId, p.id, meta); if (!r?.error) setEditing(false); return r; })} busy={busy} />
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
              {m.doi && <a href={`https://doi.org/${m.doi}`} target="_blank" rel="noreferrer" className="font-bold text-green">doi.org/{m.doi} ↗</a>}
              {p.hasFile && <a href={`/api/lit/paper/${p.id}`} target="_blank" rel="noreferrer" className="font-bold text-green">Open PDF{p.pages ? ` (${p.pages} pages)` : ""} ↗</a>}
              {!p.hasFile && owner && <AttachPdf paperId={p.id} onDone={() => router.refresh()} />}
              {canEdit && <button type="button" onClick={() => setEditing(true)} className="font-bold text-ink-muted hover:text-ink">Edit details</button>}
              {canEdit && <button type="button" disabled={busy} onClick={() => run(() => recheckAction(reviewId, p.id))} className="font-bold text-ink-muted hover:text-ink">Check with Crossref again</button>}
              {!owner && p.status === "PENDING" && <NoteEditor reviewId={reviewId} p={p} />}
              {owner && p.status !== "ACCEPTED" && <button type="button" disabled={busy} onClick={() => run(() => decidePaperAction(reviewId, p.id, true))} className="btn-primary min-h-9 px-3 text-sm">Accept</button>}
              {owner && p.status !== "REJECTED" && (
                <button type="button" disabled={busy} onClick={() => { const reason = p.source === "EXPERT" ? prompt("Why are you rejecting this paper? (the expert sees this)") : "Removed by you"; if (reason !== null) run(() => decidePaperAction(reviewId, p.id, false, reason || "")); }} className="font-bold text-red-700">
                  Reject
                </button>
              )}
              {(owner ? p.source === "CLIENT" : p.status === "PENDING") && <button type="button" disabled={busy} onClick={() => confirm("Remove this paper and its PDF?") && run(() => deletePaperAction(reviewId, p.id))} className="font-bold text-red-700">Remove</button>}
            </div>
          )}
          {p.verify?.message && !p.verify.found && <p className="mt-2 text-[13px] text-ink-muted">{p.verify.message}</p>}
          {msg && <p className="mt-2 text-sm text-ink-muted">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function NoteEditor({ reviewId, p }: { reviewId: string; p: PaperView }) {
  const [note, setNote] = useState(p.note ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <span className="flex w-full items-center gap-2">
      <input value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} className="field py-1.5 text-sm" placeholder="Why this paper is relevant (the client sees this)" />
      <button type="button" onClick={async () => { await paperNoteAction(reviewId, p.id, note); setSaved(true); }} className="font-bold text-green">{saved ? "Saved" : "Save note"}</button>
    </span>
  );
}

function AttachPdf({ paperId, onDone }: { paperId: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} className="font-bold text-green">{state ?? "Attach your PDF"}</button>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setState("Attaching…");
        const res = await fetch(`/api/lit/paper/${paperId}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: f });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setState(res.ok ? "Attached" : j.error ?? "Failed");
        if (res.ok) onDone();
      }} />
    </>
  );
}

function MetaForm({ p, onSave, onCancel, busy }: { p: PaperView; onSave: (m: PaperMeta) => void; onCancel: () => void; busy: boolean }) {
  const m = p.meta;
  const [f, setF] = useState({ title: m.title ?? "", authors: (m.authors ?? []).map((a) => `${a.family}${a.given ? `, ${a.given}` : ""}`).join("; "), year: m.year ? String(m.year) : "", journal: m.journal ?? "", volume: m.volume ?? "", issue: m.issue ?? "", pages: m.pages ?? "", doi: m.doi ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-2 sm:grid-cols-6">
      <input className="field py-2 text-sm sm:col-span-6" value={f.title} onChange={set("title")} placeholder="Title" aria-label="Title" />
      <input className="field py-2 text-sm sm:col-span-4" value={f.authors} onChange={set("authors")} placeholder="Authors: Family, Given; Family, Given" aria-label="Authors" />
      <input className="field py-2 text-sm sm:col-span-2" value={f.year} onChange={set("year")} placeholder="Year" aria-label="Year" />
      <input className="field py-2 text-sm sm:col-span-3" value={f.journal} onChange={set("journal")} placeholder="Journal or source" aria-label="Journal" />
      <input className="field py-2 text-sm" value={f.volume} onChange={set("volume")} placeholder="Vol." aria-label="Volume" />
      <input className="field py-2 text-sm" value={f.issue} onChange={set("issue")} placeholder="Issue" aria-label="Issue" />
      <input className="field py-2 text-sm" value={f.pages} onChange={set("pages")} placeholder="Pages" aria-label="Pages" />
      <input className="field py-2 text-sm sm:col-span-5" value={f.doi} onChange={set("doi")} placeholder="DOI" aria-label="DOI" />
      <div className="flex gap-2 sm:col-span-6">
        <button type="button" disabled={busy} onClick={() => onSave({ title: f.title, year: Number(f.year) || null, journal: f.journal, volume: f.volume, issue: f.issue, pages: f.pages, doi: f.doi, authors: f.authors.split(";").map((s) => s.trim()).filter(Boolean).map((s) => { const [family, given] = s.split(",").map((x) => x.trim()); return { family, given }; }) })} className="btn-primary min-h-9 px-4 text-sm">Save</button>
        <button type="button" onClick={onCancel} className="px-2 text-sm font-bold text-ink-muted">Cancel</button>
      </div>
    </div>
  );
}
