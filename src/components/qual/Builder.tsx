"use client";

import Link from "next/link";
import { ExplainRecorder } from "./ExplainRecorder";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteStudyAction, publishAction, saveDraftAction, setOpenAction } from "@/app/actions/qual";
import { LANGUAGES, QUESTION_TYPES, newQuestion, questionNumbers, type QType, type Question, type StudySettings } from "@/lib/qual";
import { Icon } from "../Icons";

const PRESETS: Record<string, string[]> = {
  "Ghana’s 16 regions": ["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"],
  "African countries": ["Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cabo Verde", "Cameroon", "Central African Republic", "Chad", "Comoros", "Congo (Brazzaville)", "Congo (DRC)", "Côte d’Ivoire", "Djibouti", "Egypt", "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia", "Gabon", "The Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Kenya", "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique", "Namibia", "Niger", "Nigeria", "Rwanda", "São Tomé and Príncipe", "Senegal", "Seychelles", "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe"],
  "Age groups": ["18–24", "25–34", "35–44", "45–54", "55–64", "65 or older"],
  "Agree / disagree": ["Strongly agree", "Agree", "Neither agree nor disagree", "Disagree", "Strongly disagree"],
  "Yes / no": ["Yes", "No"],
};

type Draft = { title: string; intro: string; questions: Question[]; settings: StudySettings };

export function Builder({ id, initial, token, status, unpublished, canPublish }: { id: string; initial: Draft; token: string; status: string; unpublished: boolean; canPublish: boolean }) {
  const [d, setD] = useState<Draft>(initial);
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const [changed, setChanged] = useState(unpublished);
  const [pending, start] = useTransition();
  const first = useRef(true);
  const nums = questionNumbers(d.questions);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave("dirty");
    setChanged(true);
    const t = setTimeout(async () => {
      setSave("saving");
      const r = await saveDraftAction(id, d);
      setSave(r?.error ? "error" : "saved");
      if (r?.error) setMsg({ t: r.error, bad: true });
    }, 1200);
    return () => clearTimeout(t);
  }, [d, id]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save === "dirty" || save === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  const setQ = (i: number, patch: Partial<Question>) => setD((x) => ({ ...x, questions: x.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const insert = (i: number, type: QType) => setD((x) => ({ ...x, questions: [...x.questions.slice(0, i), newQuestion(type), ...x.questions.slice(i)] }));
  const move = (i: number, by: number) =>
    setD((x) => {
      const qs = [...x.questions];
      const j = i + by;
      if (j < 0 || j >= qs.length) return x;
      [qs[i], qs[j]] = [qs[j], qs[i]];
      return { ...x, questions: qs };
    });
  const remove = (i: number) => setD((x) => ({ ...x, questions: x.questions.filter((_, j) => j !== i) }));
  const copy = (i: number) => setD((x) => ({ ...x, questions: [...x.questions.slice(0, i + 1), { ...x.questions[i], id: newQuestion().id }, ...x.questions.slice(i + 1)] }));
  const setS = (patch: Partial<StudySettings>) => setD((x) => ({ ...x, settings: { ...x.settings, ...patch } }));

  const publish = () =>
    start(async () => {
      setMsg(null);
      const r = await publishAction(id, d);
      if (r?.error) setMsg({ t: r.error, bad: true });
      else {
        setChanged(false);
        setSave("saved");
        setMsg({ t: r?.ok ?? "Published" });
      }
    });

  const live = status === "LIVE";
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="card flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="b-title">Study title</label>
            <input id="b-title" className="field text-lg font-bold" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} maxLength={160} />
          </div>
          <div>
            <label className="label" htmlFor="b-intro">Information and consent</label>
            <p className="mb-1.5 text-[13px] text-ink-muted">Respondents read this before they start. Say what the study is about, how long it takes, that taking part is voluntary, and how answers are kept confidential.</p>
            <textarea id="b-intro" className="field min-h-48 text-[14.5px] leading-relaxed" value={d.intro} onChange={(e) => setD({ ...d, intro: e.target.value })} />
          </div>
        </div>

        {d.questions.length === 0 && (
          <div className="rounded-md border-2 border-dashed border-line p-8 text-center text-ink-muted">No questions yet. Add your first one below.</div>
        )}
        {d.questions.map((q, i) => (
          <QuestionCard key={q.id} studyId={id} q={q} n={nums[q.id]} first={i === 0} last={i === d.questions.length - 1} set={(p) => setQ(i, p)} onMove={(by) => move(i, by)} onRemove={() => remove(i)} onCopy={() => copy(i)} onInsert={(t) => insert(i + 1, t)} />
        ))}
        <AddMenu onAdd={(t) => insert(d.questions.length, t)} big />
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between text-[13px] text-ink-muted">
            <span>{save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : save === "error" ? "Not saved" : "All changes saved"}</span>
            <span className={`h-2 w-2 rounded-full ${save === "saved" ? "bg-green" : save === "error" ? "bg-red-600" : "bg-amber"}`} />
          </div>
          {live && !changed ? (
            <p className="flex items-center gap-2 text-sm font-bold text-green"><Icon name="check" size={16} /> Live: respondents see this version</p>
          ) : (
            <button className="btn-amber" onClick={publish} disabled={pending || !canPublish}>{pending ? "Publishing…" : live ? "Publish changes" : "Publish and get the link"}</button>
          )}
          {live && changed && <p className="text-[12.5px] text-ink-muted">Respondents keep seeing the last published version until you publish your changes.</p>}
          {!canPublish && <p className="text-[12.5px] text-amber-deep">Your free trial has ended. <Link href="/tools/qual/upgrade" className="font-bold">Upgrade</Link> to publish.</p>}
          {msg && <p className={`text-sm ${msg.bad ? "text-red-700" : "font-bold text-green"}`}>{msg.t}</p>}
          {status !== "DRAFT" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a href={`/s/${token}`} target="_blank" rel="noreferrer" className="font-bold text-green">Preview as respondent ↗</a>
              <Link href={`/tools/qual/${id}/share`} className="font-bold text-green">Share</Link>
            </div>
          )}
        </div>

        <div className="card flex flex-col gap-3.5">
          <h2 className="text-lg font-bold">Settings</h2>
          <div>
            <label className="label" htmlFor="s-lang">Language people will speak</label>
            <select id="s-lang" className="field" value={d.settings.language} onChange={(e) => setS({ language: e.target.value as StudySettings["language"] })}>
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <p className="mt-1 text-[12px] text-ink-muted">Automatic transcription supports these languages. For Twi, Ewe, Dagbani and other local languages, choose “Don’t transcribe automatically” and type or paste transcripts.</p>
          </div>
          <div>
            <label className="label" htmlFor="s-max">Longest voice answer</label>
            <select id="s-max" className="field" value={d.settings.maxSeconds} onChange={(e) => setS({ maxSeconds: Number(e.target.value) })}>
              {[60, 120, 180, 300, 420, 600].map((s) => <option key={s} value={s}>{s / 60} minute{s === 60 ? "" : "s"}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Ask label="Ask for name" value={d.settings.askName} onChange={(v) => setS({ askName: v })} />
            <Ask label="Ask for email" value={d.settings.askEmail} onChange={(v) => setS({ askEmail: v })} />
          </div>
          <div>
            <label className="label" htmlFor="s-ty">Thank-you message</label>
            <textarea id="s-ty" className="field min-h-20 text-sm" value={d.settings.thankYou} onChange={(e) => setS({ thankYou: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.settings.notifyOwner} onChange={(e) => setS({ notifyOwner: e.target.checked })} className="h-4 w-4 accent-green" /> Tell me when someone responds
          </label>
        </div>

        <div className="card flex flex-col gap-2 text-sm">
          {live && <button className="text-left font-bold text-ink-muted hover:text-ink" onClick={() => start(async () => { const r = await setOpenAction(id, false); setMsg(r?.error ? { t: r.error, bad: true } : { t: r?.ok ?? "" }); })}>Close the link (stop new responses)</button>}
          {status === "CLOSED" && <button className="text-left font-bold text-green" onClick={() => start(async () => { const r = await setOpenAction(id, true); setMsg(r?.error ? { t: r.error, bad: true } : { t: r?.ok ?? "" }); })}>Reopen the link</button>}
          <button
            className="text-left font-bold text-red-700"
            onClick={() => {
              if (confirm("Delete this study, all its responses and recordings? This can't be undone.")) start(async () => { const r = await deleteStudyAction(id); if (r?.error) setMsg({ t: r.error, bad: true }); });
            }}
          >
            Delete study
          </button>
        </div>
      </aside>
    </div>
  );
}

function Ask({ label, value, onChange }: { label: string; value: "required" | "optional" | "no"; onChange: (v: "required" | "optional" | "no") => void }) {
  return (
    <div>
      <label className="label text-[13px]">{label}</label>
      <select className="field py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value as "required" | "optional" | "no")}>
        <option value="no">No</option>
        <option value="optional">Optional</option>
        <option value="required">Required</option>
      </select>
    </div>
  );
}

function AddMenu({ onAdd, big }: { onAdd: (t: QType) => void; big?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className={big ? "btn-outline w-full" : "text-[13px] font-bold text-green hover:underline"}>
        + {big ? "Add a question" : "Insert below"}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 grid w-64 gap-0.5 rounded-sm border border-line bg-white p-1.5 shadow-xl">
          {(Object.keys(QUESTION_TYPES) as QType[]).map((t) => (
            <button key={t} type="button" onClick={() => { onAdd(t); setOpen(false); }} className="rounded-[8px] px-3 py-2 text-left text-sm hover:bg-parchment">
              {QUESTION_TYPES[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard({ studyId, q, n, first, last, set, onMove, onRemove, onCopy, onInsert }: { studyId: string; q: Question; n?: number; first: boolean; last: boolean; set: (p: Partial<Question>) => void; onMove: (by: number) => void; onRemove: () => void; onCopy: () => void; onInsert: (t: QType) => void }) {
  const hasOptions = q.type === "choice" || q.type === "multi" || q.type === "dropdown";
  const [optText, setOptText] = useState(q.options.join("\n"));
  const section = q.type === "section";
  return (
    <div className={`card flex flex-col gap-3 ${section ? "border-l-4 border-l-amber" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${section ? "bg-amber-tint text-amber-deep" : "bg-green-tint text-green"}`}>{section ? "Section" : `Q${n}`}</span>
        <select className="rounded-[8px] border border-line bg-white px-2 py-1 text-[13px]" value={q.type} onChange={(e) => set({ type: e.target.value as QType, ...(["choice", "multi", "dropdown"].includes(e.target.value) && !q.options.length ? { options: [] } : {}) })} aria-label="Question type">
          {(Object.keys(QUESTION_TYPES) as QType[]).map((t) => <option key={t} value={t}>{QUESTION_TYPES[t]}</option>)}
        </select>
        <span className="flex-1" />
        <IconBtn label="Move up" disabled={first} onClick={() => onMove(-1)}>↑</IconBtn>
        <IconBtn label="Move down" disabled={last} onClick={() => onMove(1)}>↓</IconBtn>
        <IconBtn label="Duplicate" onClick={onCopy}>⧉</IconBtn>
        <IconBtn label="Delete" onClick={() => { if (!q.text || confirm("Delete this question?")) onRemove(); }}>✕</IconBtn>
      </div>
      <textarea className={`field min-h-[52px] ${section ? "text-lg font-bold" : "text-[15.5px] font-bold"}`} rows={2} value={q.text} onChange={(e) => set({ text: e.target.value })} placeholder={section ? "Section heading, e.g. About you" : "Type your question"} aria-label="Question text" />
      <input className="field py-2 text-sm" value={q.help} onChange={(e) => set({ help: e.target.value })} placeholder={section ? "Optional note shown under the heading" : "Optional hint or instruction"} aria-label="Hint" />
      {!section && <ExplainRecorder studyId={studyId} q={q} set={set} />}
      {hasOptions && (
        <div>
          <label className="label text-[13px]">Options, one per line</label>
          <textarea
            className="field min-h-28 text-sm"
            value={optText}
            onChange={(e) => {
              setOptText(e.target.value);
              set({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) });
            }}
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(PRESETS).map(([k, v]) => (
              <button key={k} type="button" className="rounded-full bg-parchment px-2.5 py-1 text-[12px] font-bold text-ink-muted hover:text-ink" onClick={() => { setOptText(v.join("\n")); set({ options: v }); }}>
                + {k}
              </button>
            ))}
          </div>
        </div>
      )}
      {q.type === "rating" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className="label text-[13px]">Scale</label>
            <select className="field py-2 text-sm" value={q.scaleMax} onChange={(e) => set({ scaleMax: Number(e.target.value) })}>
              {[3, 4, 5, 7, 10].map((n) => <option key={n} value={n}>1 to {n}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-[13px]">Label for 1</label>
            <input className="field py-2 text-sm" value={q.minLabel} onChange={(e) => set({ minLabel: e.target.value })} />
          </div>
          <div>
            <label className="label text-[13px]">Label for {q.scaleMax}</label>
            <input className="field py-2 text-sm" value={q.maxLabel} onChange={(e) => set({ maxLabel: e.target.value })} />
          </div>
        </div>
      )}
      {!section && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-green" checked={q.required} onChange={(e) => set({ required: e.target.checked })} /> Required</label>
          {q.type === "voice" && <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-green" checked={q.allowText} onChange={(e) => set({ allowText: e.target.checked })} /> Let people type instead</label>}
          <span className="flex-1" />
          <AddMenu onAdd={onInsert} />
        </div>
      )}
      {section && <div className="flex justify-end"><AddMenu onAdd={onInsert} /></div>}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-muted hover:bg-parchment hover:text-ink disabled:opacity-30">
      {children}
    </button>
  );
}
