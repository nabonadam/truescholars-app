"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteResponseAction, flagAction, tagsAction, transcribeAllAction, transcriptAction, translateAllAction } from "@/app/actions/qual";
import { answerText, fmtSeconds, needsTranslation, pid, questionNumbers, translationOf, type Answer as Ans, type Answers, type Question } from "@/lib/qual";
import { Icon } from "../Icons";

type R = { id: string; n: number; name: string | null; email: string | null; status: string; flagged: boolean; tags: string[]; startedAt: string; submittedAt: string | null; answers: Answers };
type Chart = { id: string; n: number; text: string; multi: boolean; answered: number; bars: { label: string; value: number }[] };
type Totals = { submitted: number; inProgress: number; test: number; recordings: number; transcribed: number; minutes: number };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Responses(p: { studyId: string; questions: Question[]; language: string; translate: boolean; toTranslate: number; canWork: boolean; transcriptionOn: boolean; storage: string; charts: Chart[]; days: { d: string; n: number }[]; totals: Totals; responses: R[] }) {
  const [filter, setFilter] = useState<"done" | "progress" | "test" | "all">("done");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const nums = questionNumbers(p.questions);
  const t = p.totals;
  const needsTranscript = t.recordings - t.transcribed;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return p.responses
      .filter((r) => (filter === "all" ? true : filter === "test" ? r.flagged : filter === "progress" ? r.status !== "SUBMITTED" && !r.flagged : r.status === "SUBMITTED" && !r.flagged))
      .filter((r) => !term || [pid(r.n), r.name, r.email, ...r.tags, ...p.questions.flatMap((qq) => [answerText(qq, r.answers[qq.id]), translationOf(qq, r.answers[qq.id]) ?? ""])].join(" ").toLowerCase().includes(term))
      .reverse();
  }, [p.responses, p.questions, filter, q]);

  const translateLoop = async () => {
    let done = 0,
      failed = 0;
    for (let i = 0; i < 40; i++) {
      const r = await translateAllAction(p.studyId);
      if (r.error) return setMsg({ t: r.error, bad: true });
      done += r.done ?? 0;
      failed += r.failed ?? 0;
      if (!r.remaining) break;
      setMsg({ t: `Translated ${done} so far… ${r.remaining} to go.` });
    }
    setMsg({ t: `Translated ${done} answer${done === 1 ? "" : "s"} into English.${failed ? ` ${failed} failed; try again in a moment.` : ""}`, bad: failed > 0 && done === 0 });
  };
  const translateAll = () =>
    start(async () => {
      setMsg({ t: "Translating into English…" });
      await translateLoop();
    });

  const transcribeAll = () =>
    start(async () => {
      setMsg({ t: "Transcribing… this takes a few seconds per recording." });
      let done = 0,
        failed = 0;
      for (let i = 0; i < 40; i++) {
        const r = await transcribeAllAction(p.studyId);
        if (r.error) return setMsg({ t: r.error, bad: true });
        done += r.done ?? 0;
        failed += r.failed ?? 0;
        if (!r.remaining) break;
        setMsg({ t: `Transcribed ${done} so far… ${r.remaining} to go.` });
      }
      setMsg({ t: `Transcribed ${done} recording${done === 1 ? "" : "s"}.${failed ? ` ${failed} failed; open the response to see why, or type the transcript.` : ""}`, bad: failed > 0 && done === 0 });
      if (p.translate && done > 0) {
        setMsg({ t: "Transcribed. Now translating into English…" });
        await translateLoop();
      }
    });

  const max = Math.max(1, ...p.days.map((x) => x.n));
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Responses" value={t.submitted} sub={t.inProgress ? `${t.inProgress} still answering` : "completed"} />
        <Stat label="Recordings" value={t.recordings} sub={`${t.minutes} minute${t.minutes === 1 ? "" : "s"} of audio`} />
        <Stat label="Transcribed" value={`${t.transcribed}/${t.recordings}`} sub={needsTranscript ? `${needsTranscript} waiting` : "all done"} />
        <Stat label="Test responses" value={t.test} sub="left out of exports" />
      </div>

      <div className="card flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h2 className="font-bold">Transcripts and downloads</h2>
          <p className="text-sm text-ink-muted">
            {p.language === "none"
              ? "Automatic transcription is off for this study: open each response to type or paste transcripts."
              : p.transcriptionOn
                ? "New recordings are transcribed automatically when a respondent submits. You can edit any transcript."
                : "Automatic transcription isn't switched on yet. You can type transcripts into each response."}
            {p.translate && " Open answers are translated into English for analysis; the originals are always kept."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.translate && p.toTranslate > 0 && (
            <button className="btn-amber min-h-10 px-4 text-sm" disabled={busy || !p.canWork} onClick={translateAll}>{busy ? "Working…" : `Translate ${p.toTranslate} into English`}</button>
          )}
          {p.transcriptionOn && p.language !== "none" && needsTranscript > 0 && (
            <button className="btn-amber min-h-10 px-4 text-sm" disabled={busy || !p.canWork} onClick={transcribeAll}>{busy ? "Transcribing…" : `Transcribe ${needsTranscript}`}</button>
          )}
          <a className="btn-outline min-h-10 px-4 text-sm no-underline" href={`/api/qual/${p.studyId}/export?f=csv`}>Spreadsheet (CSV)</a>
          <a className="btn-outline min-h-10 px-4 text-sm no-underline" href={`/api/qual/${p.studyId}/export?f=transcripts`}>Transcripts (ZIP)</a>
          {t.recordings > 0 && <a className="btn-outline min-h-10 px-4 text-sm no-underline" href={`/api/qual/${p.studyId}/export?f=audio`}>Recordings (ZIP)</a>}
        </div>
      </div>
      {msg && <p className={`-mt-3 text-sm ${msg.bad ? "text-red-700" : "font-bold text-green"}`}>{msg.t}</p>}

      {(p.charts.length > 0 || p.days.length > 1) && (
        <div className="grid gap-4 md:grid-cols-2">
          {p.days.length > 1 && (
            <div className="card">
              <h3 className="font-bold">Responses by day</h3>
              <div className="mt-4 flex h-28 items-end gap-1">
                {p.days.map((x) => (
                  <div key={x.d} className="group relative flex flex-1 flex-col items-center justify-end" title={`${day(x.d)}: ${x.n}`}>
                    <div className="w-full rounded-t-[4px] bg-green" style={{ height: `${(x.n / max) * 100}%`, minHeight: 4 }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-ink-muted"><span>{day(p.days[0].d)}</span><span>{day(p.days[p.days.length - 1].d)}</span></div>
            </div>
          )}
          {p.charts.map((c) => {
            const top = Math.max(1, ...c.bars.map((b) => b.value));
            return (
              <div key={c.id} className="card">
                <h3 className="font-bold"><span className="text-ink-muted">Q{c.n}.</span> {c.text}</h3>
                <p className="text-xs text-ink-muted">{c.answered} answered{c.multi ? " · people could choose several" : ""}</p>
                <div className="mt-3 flex flex-col gap-1.5">
                  {c.bars.map((b) => (
                    <div key={b.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[13px]">
                      <span className="truncate" title={b.label}>{b.label}</span>
                      <div className="h-3.5 overflow-hidden rounded-full bg-parchment"><div className="h-full rounded-full bg-amber" style={{ width: `${(b.value / top) * 100}%` }} /></div>
                      <span className="w-14 text-right tabular-nums text-ink-muted">{b.value}{c.answered ? ` · ${Math.round((b.value / c.answered) * 100)}%` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-xl font-extrabold">Responses</h2>
          {([["done", `Completed (${t.submitted})`], ["progress", `In progress (${t.inProgress})`], ["test", `Tests (${t.test})`], ["all", "All"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-sm font-bold ${filter === k ? "bg-ink text-white" : "bg-white text-ink-muted hover:text-ink"}`}>{label}</button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search answers, names, tags" className="field ml-auto w-full py-2 text-sm sm:w-64" aria-label="Search responses" />
        </div>
        {!shown.length && (
          <div className="rounded-md border-2 border-dashed border-line p-10 text-center text-ink-muted">
            {p.responses.length ? "Nothing matches." : "No responses yet. Share your link to start collecting."}
          </div>
        )}
        {shown.map((r) => (
          <ResponseCard key={r.id} r={r} studyId={p.studyId} questions={p.questions} nums={nums} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />
        ))}
      </div>
      <p className="text-xs text-ink-muted">Recordings are stored {p.storage === "r2" ? "in secure cloud storage" : "in the app's database"} and only you can play or download them.</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</div>
      <div className="mt-1 text-[28px] leading-none font-extrabold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{sub}</div>
    </div>
  );
}

function ResponseCard({ r, studyId, questions, nums, open, toggle }: { r: R; studyId: string; questions: Question[]; nums: Record<string, number>; open: boolean; toggle: () => void }) {
  const [busy, start] = useTransition();
  const [tags, setTags] = useState(r.tags.join(", "));
  const [note, setNote] = useState<string | null>(null);
  const act = (fn: () => Promise<{ error?: string; ok?: string } | undefined>) => start(async () => { const x = await fn(); setNote(x?.error ?? x?.ok ?? null); });
  const voice = questions.filter((q) => q.type === "voice" && r.answers[q.id]?.audio).length;
  return (
    <div className={`overflow-hidden rounded-md border bg-white ${r.flagged ? "border-dashed border-ink-muted/40 opacity-80" : "border-line"}`}>
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-parchment/60" aria-expanded={open}>
        <span className="rounded-[8px] bg-green px-2 py-0.5 font-mono text-xs font-bold text-amber">{pid(r.n)}</span>
        <span className="font-bold">{r.name ?? "Anonymous"}</span>
        {r.status !== "SUBMITTED" && <span className="rounded-full bg-amber-tint px-2 text-xs font-bold text-amber-deep">In progress</span>}
        {r.flagged && <span className="rounded-full bg-line px-2 text-xs font-bold text-ink-muted">Test</span>}
        {r.tags.map((t) => <span key={t} className="rounded-full bg-green-tint px-2 text-xs font-bold text-green">{t}</span>)}
        <span className="ml-auto flex items-center gap-3 text-xs text-ink-muted">
          {voice > 0 && <span className="flex items-center gap-1"><Icon name="mic" size={13} /> {voice}</span>}
          {when(r.submittedAt ?? r.startedAt)}
          <span className={`transition ${open ? "rotate-90" : ""}`}>›</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          {r.email && <p className="text-sm text-ink-muted">{r.email}</p>}
          {questions.map((q) =>
            q.type === "section" ? (
              <h4 key={q.id} className="pt-1 text-xs font-bold tracking-wide text-amber-deep uppercase">{q.text}</h4>
            ) : (
              <Answer key={q.id} q={q} n={nums[q.id]} r={r} studyId={studyId} />
            ),
          )}
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <div className="min-w-48 flex-1">
              <label className="label text-[13px]">Tags (comma separated)</label>
              <input className="field py-2 text-sm" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. pilot, follow up" />
            </div>
            <button className="btn-outline min-h-10 px-4 text-sm" disabled={busy} onClick={() => act(() => tagsAction(studyId, r.id, tags.split(",")))}>Save tags</button>
            <button className="btn-outline min-h-10 px-4 text-sm" disabled={busy} onClick={() => act(() => flagAction(studyId, r.id, !r.flagged))}>{r.flagged ? "Not a test" : "Mark as test"}</button>
            <button className="min-h-10 px-2 text-sm font-bold text-red-700" disabled={busy} onClick={() => { if (confirm(`Delete ${pid(r.n)} and their recordings? This can't be undone.`)) act(() => deleteResponseAction(studyId, r.id)); }}>Delete</button>
          </div>
          {note && <p className="text-sm text-ink-muted">{note}</p>}
        </div>
      )}
    </div>
  );
}

function Answer({ q, n, r, studyId }: { q: Question; n: number; r: R; studyId: string }) {
  const a = r.answers[q.id];
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(a?.transcript ?? "");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="text-sm font-bold"><span className="text-ink-muted">Q{n}.</span> {q.text}</div>
      {!a || (!a.audio && !answerText(q, a)) ? (
        <p className="mt-1 text-sm text-ink-muted italic">No answer</p>
      ) : q.type === "voice" && a.audio ? (
        <div className="mt-2 flex flex-col gap-2">
          <audio controls preload="none" src={`/api/qual/audio?r=${r.id}&q=${q.id}`} className="h-10 w-full max-w-md" />
          <span className="text-xs text-ink-muted">{fmtSeconds(a.audio.seconds)} · {a.tStatus === "done" ? "AI transcript" : a.tStatus === "edited" ? "Transcript (edited)" : a.tStatus === "failed" ? `Transcription failed: ${a.tError ?? ""}` : a.tStatus === "none" ? "Not transcribed automatically" : "Waiting for transcription"}</span>
          {edit ? (
            <div className="flex flex-col gap-2">
              <textarea className="field min-h-32 text-[14.5px]" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn-primary min-h-9 px-4 text-sm" disabled={busy} onClick={() => start(async () => { const x = await transcriptAction(studyId, r.id, q.id, text); if (x?.error) setErr(x.error); else setEdit(false); })}>Save transcript</button>
                <button className="text-sm font-bold text-ink-muted" onClick={() => { setEdit(false); setText(a.transcript ?? ""); }}>Cancel</button>
              </div>
              {err && <p className="text-sm text-red-700">{err}</p>}
            </div>
          ) : (
            <div className="rounded-sm bg-parchment px-3 py-2 text-[14.5px] whitespace-pre-line">
              {a.transcript || <span className="text-ink-muted italic">No transcript yet.</span>}
              <button className="ml-2 text-xs font-bold text-green" onClick={() => setEdit(true)}>{a.transcript ? "Edit" : "Type transcript"}</button>
            </div>
          )}
          {a.text?.trim() && <p className="text-[14.5px]"><span className="text-xs font-bold text-ink-muted">Also typed: </span>{a.text}</p>}
          <Translation q={q} a={a} />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[14.5px] whitespace-pre-line">{answerText(q, a)}{q.type === "voice" && <span className="ml-2 text-xs text-ink-muted">(typed)</span>}</p>
          <Translation q={q} a={a} />
        </>
      )}
    </div>
  );
}

/** The English translation under an answer (the original stays above it). */
function Translation({ q, a }: { q: Question; a: Ans | undefined }) {
  const tr = translationOf(q, a);
  if (tr) {
    if (tr.trim() === answerText(q, a).trim()) return null; // it was already English
    return (
      <div className="mt-2 rounded-sm border-l-4 border-amber bg-white px-3 py-2 text-[14.5px] whitespace-pre-line">
        <span className="mb-0.5 block text-[11px] font-bold tracking-wide text-ink-muted uppercase">English translation · AI</span>
        {tr}
      </div>
    );
  }
  if (a?.trStatus === "failed" && needsTranslation(q, a)) return <p className="mt-1 text-xs text-red-700">Translation failed: {a.trError}. Use “Translate” above to try again.</p>;
  if (a?.translation && needsTranslation(q, a)) return <p className="mt-1 text-xs text-ink-muted">The answer changed since it was translated; translate again to update the English.</p>;
  return null;
}
