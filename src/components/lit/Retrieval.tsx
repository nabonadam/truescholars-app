"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { acceptLiteratureAction, askReplacementsAction, cancelRequestAction, requestRetrievalAction, saveSearchLogAction, submitRetrievalAction } from "@/app/actions/lit";
import { formatMoney } from "@/lib/money";
import type { Brief } from "@/server/lit";
import type { AssignmentInfo, SearchLog } from "@/server/litRetrieval";
import { Icon } from "../Icons";
import { DownloadButtons } from "../qual/Visuals";

type ReviewInfo = { id: string; status: string; jobId: string | null; orderId: string | null; expertUserId: string | null; brief: unknown; searchLog: unknown; researchQuestion: string; title: string };

const STEPS = ["Request sent", "Expert assigned", "Literature retrieval", "Your review", "Analysis"];

function Tracker({ at }: { at: number }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 text-[12.5px] font-bold">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span className={`grid h-6 w-6 place-items-center rounded-full ${i < at ? "bg-green text-white" : i === at ? "bg-amber text-ink" : "bg-parchment text-ink-muted"}`}>{i < at ? "✓" : i + 1}</span>
          <span className={i === at ? "text-ink" : "text-ink-muted"}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 text-line">—</span>}
        </li>
      ))}
    </ol>
  );
}

const due = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null);

function Withdraw({ id, label = "Withdraw the request" }: { id: string; label?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" disabled={busy} onClick={() => confirm("Withdraw this request? Nothing has been paid, so nothing is charged.") && start(async () => { const x = await cancelRequestAction(id); if (x?.error) setErr(x.error); router.refresh(); })} className="text-sm font-bold text-ink-muted hover:text-ink">
        {busy ? "Withdrawing…" : label}
      </button>
      {err && <p className="text-sm text-red-700">{err}</p>}
    </>
  );
}

/** The client's side: ask for an expert, follow progress, then review and accept. */
export function RetrievalCard({ review, assignment: a }: { review: ReviewInfo; assignment: AssignmentInfo }) {
  const r = review;
  const log = r.searchLog as SearchLog | null;
  if (r.status === "REQUESTED") {
    return (
      <div className="card flex flex-col gap-3 p-5">
        <Tracker at={1} />
        <p className="text-[15px]"><b>Research question sent to The True Scholars for literature retrieval.</b> We&apos;re assigning a dedicated, vetted expert. You&apos;ll be notified with the expert and the price, usually within a day.</p>
        <p className="flex items-center gap-2 text-[13px] text-ink-muted"><Icon name="shield" size={14} /> Private: your question isn&apos;t posted on the marketplace. Only the expert we assign will see it.</p>
        <div><Withdraw id={r.id} /></div>
      </div>
    );
  }
  if (r.status === "RETRIEVAL") {
    const legacy = !a && r.jobId; // reviews from before private assignment
    return (
      <div className="card flex flex-col gap-3 p-5">
        <Tracker at={a?.paid || (!a && r.expertUserId) ? 2 : 1} />
        {a && !a.paid ? (
          <>
            <p className="text-[15px]"><b>{a.expert} has been assigned to find your literature.</b> The price is <b>{formatMoney(a.total)}</b>. Pay it into escrow to start: the expert is paid only after you accept the papers.</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href={`/orders/${a.orderId}`} className="btn-amber min-h-10 px-4 text-sm">Pay into escrow</Link>
              <Withdraw id={r.id} label="Withdraw instead" />
            </div>
          </>
        ) : a ? (
          <>
            <p className="text-[15px]"><b>{a.expert} is retrieving your literature.</b> {a.dueAt ? `Due by ${due(a.dueAt)}. ` : ""}You&apos;ll be notified when the papers are submitted.</p>
            <div><Link href={`/orders/${a.orderId}`} className="btn-outline min-h-10 px-4 text-sm">Message the expert</Link></div>
          </>
        ) : legacy ? (
          <>
            <p className="text-[15px]"><b>Your brief is with our experts.</b> Hire one from the proposals; the papers they find come straight into this review.</p>
            <div><Link href={`/jobs/${r.jobId}`} className="btn-primary min-h-10 px-4 text-sm">See proposals</Link></div>
          </>
        ) : (
          <p className="text-[15px]"><b>An expert is retrieving your literature.</b></p>
        )}
      </div>
    );
  }
  if (r.status === "REVIEWING") return <ReviewDelivery review={r} log={log} />;
  return (
    <div className="flex flex-col gap-4">
      {log && <SearchReport log={log} title={r.title} />}
      {!r.orderId && !r.jobId && <AskExpert review={r} />}
    </div>
  );
}

function ReviewDelivery({ review: r, log }: { review: ReviewInfo; log: SearchLog | null }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border-2 border-amber bg-white p-5">
        <Tracker at={3} />
        <h2 className="mt-3 text-xl font-extrabold">Your expert has submitted the literature</h2>
        <p className="mt-1 text-[15px] text-ink-muted">Review each paper below: open the DOI, read the expert&apos;s note, then accept or reject it. When you&apos;re happy, submit for detailed analysis and synthesis. That approves the delivery and releases the expert&apos;s payment from escrow.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={() => start(async () => { const x = await acceptLiteratureAction(r.id); if (x?.error) setMsg(x.error); })} className="btn-amber min-h-11 px-5">
            {busy ? "Submitting…" : "Submit for detailed analysis and synthesis →"}
          </button>
          <button type="button" onClick={() => setReplace(!replace)} className="text-sm font-bold text-ink-muted hover:text-ink">Ask for replacements instead</button>
        </div>
        {replace && (
          <div className="mt-3 flex flex-col gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="field text-sm" placeholder="What should the replacements cover? Reject the papers you don't want first; your reasons are sent too." />
            <button type="button" disabled={busy} onClick={() => start(async () => { const x = await askReplacementsAction(r.id, text); setMsg(x?.error ?? x?.ok ?? null); router.refresh(); })} className="btn-primary self-start min-h-10 px-4 text-sm">Send back to the expert</button>
          </div>
        )}
        {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
      </div>
      {log && <SearchReport log={log} title={r.title} />}
    </div>
  );
}

function AskExpert({ review: r }: { review: ReviewInfo }) {
  const router = useRouter();
  const b = (r.brief ?? {}) as Brief;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ papersWanted: String(b.papersWanted ?? 20), years: b.years ?? "", regions: b.regions ?? "", languages: b.languages ?? "English", include: b.include ?? "", exclude: b.exclude ?? "", notes: b.notes ?? "", days: "7" });
  const papers = Math.max(5, Math.min(200, Number(f.papersWanted) || 20));
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) {
    return (
      <div className="flex flex-col gap-4 rounded-md bg-green-deep p-5 text-white sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 flex-none place-items-center rounded-[14px] bg-amber text-ink"><Icon name="search" size={22} /></span>
        <div className="flex-1">
          <h2 className="text-lg font-extrabold">Don&apos;t have the papers yet? Send it to an expert</h2>
          <p className="text-[14px] text-on-green-muted">We assign a dedicated, vetted expert who searches the academic databases for your question and delivers the papers with a spreadsheet, DOI links, relevance notes and a documented search (PRISMA). Your question stays private: it&apos;s never posted publicly. You review every paper before anything is analysed.</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="btn-amber flex-none">Send to an expert</button>
      </div>
    );
  }
  return (
    <div className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-xl font-extrabold">Brief for literature retrieval</h2>
        <p className="text-sm text-ink-muted">Sent privately to The True Scholars, not posted on the marketplace. We assign one dedicated expert and tell you the price ($4.50 or GH₵30 a paper). You pay into escrow only once you&apos;ve seen it, and the expert is paid only after you accept the papers.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-bold">Papers wanted<input className="field mt-1" type="number" min={5} max={200} value={f.papersWanted} onChange={set("papersWanted")} /></label>
        <label className="text-sm font-bold">Years<input className="field mt-1" value={f.years} onChange={set("years")} placeholder="2010 to 2025" /></label>
        <label className="text-sm font-bold">Languages<input className="field mt-1" value={f.languages} onChange={set("languages")} /></label>
        <label className="text-sm font-bold sm:col-span-3">Regions or settings<input className="field mt-1" value={f.regions} onChange={set("regions")} placeholder="Sub-Saharan Africa; rural settings; any" /></label>
        <label className="text-sm font-bold sm:col-span-3">Include<textarea className="field mt-1" rows={2} value={f.include} onChange={set("include")} placeholder="Peer-reviewed empirical studies; qualitative and mixed methods; grey literature from UN agencies…" /></label>
        <label className="text-sm font-bold sm:col-span-3">Exclude<textarea className="field mt-1" rows={2} value={f.exclude} onChange={set("exclude")} placeholder="Opinion pieces; studies outside the date range…" /></label>
        <label className="text-sm font-bold sm:col-span-3">Anything else the expert should know<textarea className="field mt-1" rows={2} value={f.notes} onChange={set("notes")} /></label>
        <label className="text-sm font-bold">Needed within (days)<input className="field mt-1" type="number" min={1} max={60} value={f.days} onChange={set("days")} /></label>
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} className="btn-amber" onClick={() => start(async () => {
          const x = await requestRetrievalAction(r.id, { brief: { papersWanted: papers, years: f.years, regions: f.regions, languages: f.languages, include: f.include, exclude: f.exclude, notes: f.notes }, days: Number(f.days) || 7 });
          if (x?.error) setErr(x.error);
          else router.refresh();
        })}>
          {busy ? "Sending…" : "Send privately to an expert"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-bold text-ink-muted">Cancel</button>
      </div>
    </div>
  );
}

/** The documented search: PRISMA flow diagram and the methods paragraph. */
export function SearchReport({ log, title }: { log: SearchLog; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const included = log.included || Math.max(0, log.fullText - log.excludedFullText);
  return (
    <details className="card p-5" open>
      <summary className="cursor-pointer text-lg font-extrabold">How the literature was found</summary>
      <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-bold">PRISMA flow diagram</h3>
            <DownloadButtons box={box} name={`${title} PRISMA`} />
          </div>
          <div ref={box}><Prisma log={{ ...log, included }} /></div>
        </div>
        <div className="text-[14px]">
          <h3 className="font-bold">Search log</h3>
          <dl className="mt-2 space-y-1.5">
            <div><dt className="inline font-bold">Databases: </dt><dd className="inline">{log.databases.join(", ") || "-"}</dd></div>
            {log.dateRange && <div><dt className="inline font-bold">Dates: </dt><dd className="inline">{log.dateRange}</dd></div>}
            {log.searchStrings && <div><dt className="font-bold">Search strings</dt><dd className="mt-0.5 rounded-sm bg-parchment p-2 font-mono text-[12.5px] whitespace-pre-wrap">{log.searchStrings}</dd></div>}
            {log.inclusion && <div><dt className="inline font-bold">Included: </dt><dd className="inline">{log.inclusion}</dd></div>}
            {log.exclusion && <div><dt className="inline font-bold">Excluded: </dt><dd className="inline">{log.exclusion}</dd></div>}
          </dl>
        </div>
      </div>
    </details>
  );
}

export function Prisma({ log }: { log: SearchLog }) {
  const W = 760, H = 520;
  const box = (x: number, y: number, w: number, h: number, lines: string[], fill = "#ffffff") => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke="#0f3d2a" strokeWidth={1.5} />
      {lines.map((l, i) => <text key={i} x={x + w / 2} y={y + h / 2 + (i - (lines.length - 1) / 2) * 17 + 5} textAnchor="middle" fontSize={i === 0 ? 14 : 13} fontWeight={i === 0 ? 700 : 400} fill="#13261c">{l}</text>)}
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0f3d2a" strokeWidth={1.5} markerEnd="url(#arr)" />;
  const after = Math.max(0, log.identified - log.duplicates);
  return (
    <svg data-figure viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="PRISMA flow diagram" fontFamily="'DM Sans', Arial, Helvetica, sans-serif">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0f3d2a" /></marker></defs>
      {box(40, 20, 380, 64, ["Records identified", `n = ${log.identified}`, log.databases.slice(0, 3).join(", ")])}
      {arrow(230, 84, 230, 118)}
      {box(40, 120, 380, 54, ["Records after duplicates removed", `n = ${after} (${log.duplicates} removed)`])}
      {arrow(230, 174, 230, 208)}
      {box(40, 210, 380, 54, ["Titles and abstracts screened", `n = ${log.screened || after}`])}
      {arrow(420, 237, 478, 237)}
      {box(480, 210, 250, 54, ["Excluded at screening", `n = ${log.excludedScreening}`], "#fbf4e8")}
      {arrow(230, 264, 230, 298)}
      {box(40, 300, 380, 54, ["Full texts assessed for eligibility", `n = ${log.fullText}`])}
      {arrow(420, 327, 478, 327)}
      {box(480, 300, 250, 54, ["Full texts excluded", `n = ${log.excludedFullText}`], "#fbf4e8")}
      {arrow(230, 354, 230, 388)}
      {box(40, 390, 380, 54, ["Studies included in the review", `n = ${log.included}`], "#e6f0e9")}
      <text x={40} y={490} fontSize={12} fill="#6b7d72">Based on the PRISMA 2020 flow diagram. Counts recorded by the expert who searched.</text>
    </svg>
  );
}

/** The expert's side: the brief, the search log, and delivering. */
export function ExpertPanel({ review: r, papers, assignment: a }: { review: ReviewInfo; papers: number; assignment: AssignmentInfo }) {
  const router = useRouter();
  const b = (r.brief ?? {}) as Brief;
  const log = (r.searchLog as SearchLog | null) ?? null;
  const [f, setF] = useState({
    databases: log?.databases.join(", ") ?? "", searchStrings: log?.searchStrings ?? "", dateRange: log?.dateRange ?? b.years ?? "", inclusion: log?.inclusion ?? b.include ?? "", exclusion: log?.exclusion ?? b.exclude ?? "",
    identified: String(log?.identified ?? ""), duplicates: String(log?.duplicates ?? ""), screened: String(log?.screened ?? ""), excludedScreening: String(log?.excludedScreening ?? ""), fullText: String(log?.fullText ?? ""), excludedFullText: String(log?.excludedFullText ?? ""), included: String(log?.included ?? ""),
  });
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const asLog = (): Partial<SearchLog> => ({ ...f, databases: f.databases.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean), identified: Number(f.identified), duplicates: Number(f.duplicates), screened: Number(f.screened), excludedScreening: Number(f.excludedScreening), fullText: Number(f.fullText), excludedFullText: Number(f.excludedFullText), included: Number(f.included) });
  const waiting = r.status === "RETRIEVAL" && a !== null && !a.paid;
  const open = r.status === "RETRIEVAL" && !waiting;
  const brief: [string, string | number | undefined][] = [["Papers wanted", b.papersWanted], ["Purpose", b.purpose], ["Discipline", b.discipline], ["Years", b.years], ["Regions", b.regions], ["Languages", b.languages], ["Include", b.include], ["Exclude", b.exclude], ["Notes", b.notes]];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="card p-5">
        <span className="eyebrow">The client&apos;s brief</span>
        <p className="mt-2 text-[15.5px] font-bold">{r.researchQuestion}</p>
        <dl className="mt-3 space-y-1 text-[14px]">{brief.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="inline font-bold">{k}: </dt><dd className="inline text-ink-muted">{v}</dd></div>)}</dl>
        <div className="mt-4 rounded-sm bg-amber-tint p-3 text-[13px] text-amber-deep">
          <b>Copyright:</b> upload PDFs only for open-access papers. For paywalled papers add the DOI only; the client attaches their own copy through their library.
        </div>
        {a && <p className="mt-3 text-[13.5px]"><b>Your fee:</b> {formatMoney(a.total)}{a.dueAt && a.paid ? ` · due ${due(a.dueAt)}` : ""} · <Link href={`/orders/${a.orderId}`} className="font-bold text-green">Order and messages ↗</Link></p>}
        {waiting && <p className="mt-4 rounded-sm bg-amber-tint p-3 text-sm text-amber-deep"><b>Waiting for the client&apos;s payment.</b> You&apos;ll be notified when it&apos;s in escrow; then you can add papers and the search log here.</p>}
        {!open && !waiting && <p className="mt-4 rounded-sm bg-green-tint p-3 text-sm text-green"><b>Delivered.</b> The client is reviewing your papers. You&apos;ll be notified if they ask for replacements.</p>}
      </div>
      <div className="card flex flex-col gap-3 p-5">
        <h3 className="text-lg font-extrabold">Search log</h3>
        <p className="-mt-2 text-[13px] text-ink-muted">Recorded for the client&apos;s methods section and PRISMA diagram.</p>
        <label className="text-sm font-bold">Databases searched<input disabled={!open} className="field mt-1" value={f.databases} onChange={set("databases")} placeholder="Scopus, Web of Science, PubMed, Google Scholar, African Journals Online" /></label>
        <label className="text-sm font-bold">Search strings<textarea disabled={!open} className="field mt-1 font-mono text-[13px]" rows={3} value={f.searchStrings} onChange={set("searchStrings")} placeholder={'("rainfall variability" OR "climate change") AND (adaptation) AND (smallholder*)'} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">Date range<input disabled={!open} className="field mt-1" value={f.dateRange} onChange={set("dateRange")} /></label>
          <span />
          <label className="text-sm font-bold">Inclusion criteria<textarea disabled={!open} className="field mt-1" rows={2} value={f.inclusion} onChange={set("inclusion")} /></label>
          <label className="text-sm font-bold">Exclusion criteria<textarea disabled={!open} className="field mt-1" rows={2} value={f.exclusion} onChange={set("exclusion")} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["identified", "Records found"], ["duplicates", "Duplicates removed"], ["screened", "Screened"], ["excludedScreening", "Excluded at screening"], ["fullText", "Full texts assessed"], ["excludedFullText", "Full texts excluded"], ["included", "Included"]] as const).map(([k, l]) => (
            <label key={k} className="text-[12.5px] font-bold">{l}<input disabled={!open} type="number" min={0} className="field mt-1 py-2 text-sm" value={f[k]} onChange={set(k)} /></label>
          ))}
        </div>
        {open && (
          <>
            <button type="button" disabled={busy} onClick={() => start(async () => { setMsg(await saveSearchLogAction(r.id, asLog()) ?? null); router.refresh(); })} className="btn-primary self-start min-h-10 px-4 text-sm">Save search log</button>
            <div className="mt-2 border-t border-line pt-3">
              <h3 className="font-bold">Deliver to the client</h3>
              <p className="text-[13px] text-ink-muted">{papers} paper{papers === 1 ? "" : "s"} added. Submitting delivers your order milestone with the papers spreadsheet; the client then reviews each paper.</p>
              <textarea className="field mt-2 text-sm" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A short note for the client: what you found, any gaps in the literature…" />
              <button type="button" disabled={busy} onClick={() => start(async () => { await saveSearchLogAction(r.id, asLog()); const x = await submitRetrievalAction(r.id, note); setMsg(x ?? null); router.refresh(); })} className="btn-amber mt-2">Submit literature to the client</button>
            </div>
          </>
        )}
        {msg?.error && <p className="text-sm text-red-700">{msg.error}</p>}
        {msg?.ok && <p className="text-sm font-bold text-green">{msg.ok}</p>}
      </div>
    </div>
  );
}
