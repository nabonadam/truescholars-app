"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { answerable, fmtSeconds, isAnswered, type Answer, type PublishedStudy, type Question } from "@/lib/qual";

type Saved = Record<string, Answer & { audio?: Answer["audio"] | { seconds: number } }>;
type Session = { rid: string; secret: string; idx: number };

const storeKey = (token: string) => `ts-study:${token}`;
const load = (token: string): Session | null => {
  try {
    return JSON.parse(localStorage.getItem(storeKey(token)) ?? "null");
  } catch {
    return null;
  }
};
const keep = (token: string, s: Session | null) => {
  try {
    if (s) localStorage.setItem(storeKey(token), JSON.stringify(s));
    else localStorage.removeItem(storeKey(token));
  } catch {
    /* private mode: the session just won't survive a reload */
  }
};

/** POSTs to the study's respondent API; retries network failures and server errors, not our own messages. */
async function call<T = { ok: boolean }>(token: string, op: string, session: Session | null, body?: unknown, tries = 3): Promise<T> {
  let last = new Error("We couldn't reach the server. Check your connection and try again.");
  for (let i = 0; i < tries; i++) {
    let res: Response | null = null;
    try {
      res = await fetch(`/api/s/${token}/${op}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-response": session?.rid ?? "", "x-secret": session?.secret ?? "" },
        body: JSON.stringify(body ?? {}),
      });
    } catch {
      res = null; // offline or dropped: retry
    }
    if (res) {
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data as T;
      if (res.status < 500) throw new Error(data.error ?? "Something went wrong.");
      last = new Error(data.error ?? "Something went wrong. Please try again.");
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw last;
}

export function Respond({ token, study, closed }: { token: string; study: PublishedStudy; closed: boolean }) {
  const qs = study.questions;
  const st = study.settings;
  const [stage, setStage] = useState<"intro" | "q" | "done">("intro");
  const [session, setSession] = useState<Session | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Saved>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resumable, setResumable] = useState<Session | null>(null);
  const total = answerable(qs).length;
  const done = answerable(qs).filter((q) => isAnswered(q, answers[q.id] as Answer)).length;

  useEffect(() => setResumable(load(token)), [token]);

  const resume = async (s: Session) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ answers: Saved }>(token, "resume", s);
      setSession(s);
      setAnswers(r.answers);
      setIdx(Math.min(s.idx, qs.length - 1));
      setStage("q");
    } catch {
      keep(token, null);
      setResumable(null);
      setErr("We couldn't load your earlier answers, so you'll start again.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ responseId: string; secret: string }>(token, "start", null, { name, email });
      const s = { rid: r.responseId, secret: r.secret, idx: 0 };
      keep(token, s);
      setSession(s);
      setStage("q");
      setIdx(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const go = (to: number) => {
    setIdx(to);
    if (session) keep(token, { ...session, idx: to });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setLocal = useCallback((qid: string, patch: Partial<Saved[string]>) => setAnswers((a) => ({ ...a, [qid]: { ...a[qid], ...patch } })), []);

  const next = async () => {
    const q = qs[idx];
    setErr(null);
    if (q.type !== "section") {
      const a = (answers[q.id] ?? {}) as Answer;
      if (q.required && !isAnswered(q, a)) {
        setErr(q.type === "voice" ? "Please record your answer (or type it) before continuing." : "Please answer this question before continuing.");
        return;
      }
      if (q.type !== "voice" || a.text !== undefined) {
        setBusy(true);
        try {
          await call(token, "answer", session, { questionId: q.id, answer: { text: a.text, choice: a.choice, choices: a.choices, rating: a.rating } });
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Couldn't save. Check your connection and try again.");
          setBusy(false);
          return;
        }
        setBusy(false);
      }
    }
    if (idx < qs.length - 1) go(idx + 1);
    else {
      setBusy(true);
      try {
        await call(token, "submit", session);
        keep(token, null);
        setStage("done");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't submit. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div className="min-h-dvh bg-parchment">
      <style>{"body>header.site-header,body>footer{display:none!important}"}</style>
      <div className="bg-green text-white">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-5 py-3 text-[13px] text-on-green-muted">
          <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true"><path d="M23 11H14V53H23M41 11H50V53H41" fill="none" stroke="#fbf4e8" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="32" cy="32" r="7.5" fill="#f4a261" /></svg>
          <span className="truncate">{study.title}</span>
        </div>
        {stage === "q" && (
          <div className="h-1.5 bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full bg-amber transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        )}
      </div>

      <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
        {closed ? (
          <Card>
            <h1 className="text-2xl font-extrabold">This study is closed</h1>
            <p className="mt-2 text-ink-muted">It is no longer accepting responses. Thank you for your interest.</p>
          </Card>
        ) : stage === "intro" ? (
          <Card>
            <span className="eyebrow">Research study</span>
            <h1 className="mt-1 text-[26px] leading-tight font-extrabold">{study.title}</h1>
            <div className="mt-4 text-[15.5px] leading-relaxed whitespace-pre-line text-ink">{study.intro}</div>
            <div className="mt-5 rounded-sm bg-green-tint p-4 text-[14px] text-green">
              <b>{total} question{total === 1 ? "" : "s"}.</b> {qs.some((q) => q.type === "voice") ? "Some ask you to speak your answer. Find a quiet place; you can listen back and record again." : ""}
            </div>
            {resumable ? (
              <div className="mt-6 flex flex-col gap-3">
                <button className="btn-amber min-h-12" disabled={busy} onClick={() => resume(resumable)}>{busy ? "Loading…" : "Continue where I stopped"}</button>
                <button className="text-sm font-bold text-ink-muted underline" onClick={() => { keep(token, null); setResumable(null); }}>Start again instead</button>
              </div>
            ) : (
              <div className="mt-6 flex flex-col gap-3">
                {st.askName !== "no" && (
                  <div>
                    <label className="label" htmlFor="r-name">Your name{st.askName === "optional" ? " (optional)" : ""}</label>
                    <input id="r-name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  </div>
                )}
                {st.askEmail !== "no" && (
                  <div>
                    <label className="label" htmlFor="r-email">Your email{st.askEmail === "optional" ? " (optional)" : ""}</label>
                    <input id="r-email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                  </div>
                )}
                <button className="btn-amber mt-1 min-h-12" disabled={busy} onClick={start}>{busy ? "Starting…" : "I agree, let’s start"}</button>
              </div>
            )}
            {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
          </Card>
        ) : stage === "done" ? (
          <Card>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-green text-amber">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
            </span>
            <h1 className="mt-4 text-2xl font-extrabold">Thank you</h1>
            <p className="mt-2 text-[15.5px] whitespace-pre-line text-ink">{st.thankYou}</p>
          </Card>
        ) : (
          <QuestionScreen
            key={qs[idx].id}
            q={qs[idx]}
            number={answerable(qs.slice(0, idx + 1)).length}
            total={total}
            answer={answers[qs[idx].id]}
            setLocal={setLocal}
            token={token}
            session={session}
            maxSeconds={st.maxSeconds}
            err={err}
            busy={busy}
            last={idx === qs.length - 1}
            onBack={idx > 0 ? () => go(idx - 1) : undefined}
            onNext={next}
          />
        )}
        <p className="mt-6 text-center text-[12px] text-ink-muted">Powered by The True Scholars · Qualitative Studio</p>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="ts-rise rounded-md bg-white p-6 shadow-[0_14px_40px_-24px_rgba(11,36,24,0.5)] sm:p-8">{children}</div>;
}

function QuestionScreen(p: {
  q: Question;
  number: number;
  total: number;
  answer?: Saved[string];
  setLocal: (qid: string, patch: Partial<Saved[string]>) => void;
  token: string;
  session: Session | null;
  maxSeconds: number;
  err: string | null;
  busy: boolean;
  last: boolean;
  onBack?: () => void;
  onNext: () => void;
}) {
  const { q, answer: a = {}, setLocal } = p;
  const [typing, setTyping] = useState(q.type === "voice" && !!a.text && !a.audio);
  if (q.type === "section") {
    return (
      <Card>
        <span className="eyebrow">Section</span>
        <h1 className="mt-1 text-[26px] leading-tight font-extrabold">{q.text}</h1>
        {q.help && <p className="mt-3 text-[15.5px] whitespace-pre-line text-ink-muted">{q.help}</p>}
        <Nav {...p} />
      </Card>
    );
  }
  return (
    <Card>
      <div className="text-[13px] font-bold text-ink-muted">Question {p.number} of {p.total}{!q.required && " · optional"}</div>
      <h1 className="mt-1.5 text-[22px] leading-snug font-extrabold">{q.text}</h1>
      {q.help && <p className="mt-2 text-[15px] whitespace-pre-line text-ink-muted">{q.help}</p>}
      <div className="mt-5">
        {q.type === "voice" && !typing && <Recorder q={q} token={p.token} session={p.session} maxSeconds={p.maxSeconds} saved={a.audio as { seconds: number } | undefined} onSaved={(seconds) => setLocal(q.id, { audio: { seconds } as Answer["audio"], text: undefined })} />}
        {(q.type === "text" || (q.type === "voice" && typing)) && (
          <textarea className="field min-h-40 text-[16px]" value={a.text ?? ""} onChange={(e) => setLocal(q.id, { text: e.target.value })} placeholder="Type your answer here" aria-label="Your answer" />
        )}
        {q.type === "voice" && q.allowText && (
          <button
            type="button"
            className="mt-3 text-sm font-bold text-green underline decoration-amber decoration-2 underline-offset-4"
            onClick={() => {
              if (typing) setLocal(q.id, { text: undefined });
              setTyping(!typing);
            }}
          >
            {typing ? "Record my answer instead" : "I’d rather type my answer"}
          </button>
        )}
        {(q.type === "choice" || q.type === "multi") && (
          <div className="flex flex-col gap-2">
            {q.options.map((o) => {
              const on = q.type === "choice" ? a.choice === o : !!a.choices?.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => (q.type === "choice" ? setLocal(q.id, { choice: o }) : setLocal(q.id, { choices: on ? (a.choices ?? []).filter((x) => x !== o) : [...(a.choices ?? []), o] }))}
                  className={`flex min-h-12 items-center gap-3 rounded-sm border-2 px-4 py-2.5 text-left text-[15.5px] transition ${on ? "border-green bg-green-tint font-bold text-green" : "border-line bg-white hover:border-green/50"}`}
                  aria-pressed={on}
                >
                  <span className={`grid h-5 w-5 flex-none place-items-center border-2 ${q.type === "choice" ? "rounded-full" : "rounded-[5px]"} ${on ? "border-green bg-green text-white" : "border-ink-muted/40"}`}>
                    {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M5 12l5 5L20 7" /></svg>}
                  </span>
                  {o}
                </button>
              );
            })}
          </div>
        )}
        {q.type === "dropdown" && (
          <select className="field min-h-12 text-[16px]" value={a.choice ?? ""} onChange={(e) => setLocal(q.id, { choice: e.target.value || undefined })} aria-label={q.text}>
            <option value="">Choose…</option>
            {q.options.map((o) => <option key={o}>{o}</option>)}
          </select>
        )}
        {q.type === "rating" && (
          <div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: q.scaleMax }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setLocal(q.id, { rating: n })} aria-pressed={a.rating === n} className={`h-12 min-w-12 flex-1 rounded-sm border-2 text-lg font-bold ${a.rating === n ? "border-green bg-green text-white" : "border-line bg-white hover:border-green/50"}`}>{n}</button>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[12.5px] text-ink-muted"><span>{q.minLabel}</span><span>{q.maxLabel}</span></div>
          </div>
        )}
      </div>
      <Nav {...p} />
    </Card>
  );
}

function Nav({ err, busy, last, onBack, onNext }: { err: string | null; busy: boolean; last: boolean; onBack?: () => void; onNext: () => void }) {
  return (
    <>
      {err && <p className="mt-4 rounded-sm bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="mt-6 flex items-center gap-3">
        {onBack && <button type="button" className="btn-outline min-h-12 px-5" onClick={onBack} disabled={busy}>Back</button>}
        <button type="button" className="btn-amber min-h-12 flex-1" onClick={onNext} disabled={busy}>{busy ? "Saving…" : last ? "Submit my answers" : "Next"}</button>
      </div>
    </>
  );
}

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function Recorder({ q, token, session, maxSeconds, saved, onSaved }: { q: Question; token: string; session: Session | null; maxSeconds: number; saved?: { seconds: number }; onSaved: (seconds: number) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "uploading" | "saved" | "failed">(saved ? "saved" : "idle");
  const [secs, setSecs] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const blob = useRef<{ data: Blob; seconds: number } | null>(null);
  const startedAt = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const upload = async () => {
    if (!blob.current) return;
    setState("uploading");
    setMsg(null);
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(`/api/s/${token}/audio`, {
          method: "POST",
          headers: { "content-type": blob.current.data.type || "audio/webm", "x-response": session?.rid ?? "", "x-secret": session?.secret ?? "", "x-question": q.id, "x-seconds": String(blob.current.seconds) },
          body: blob.current.data,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setState("saved");
          onSaved(blob.current.seconds);
          return;
        }
        if (res.status === 400) {
          setMsg(data.error ?? "That recording couldn't be saved.");
          setState("failed");
          return;
        }
      } catch {
        /* network: retry */
      }
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
    setMsg("Your connection dropped while saving. Your recording is still here: tap Try again.");
    setState("failed");
  };

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
  };

  const startRec = async () => {
    setMsg(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMsg("This browser can't record audio. Try Chrome or Safari, or type your answer instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setMsg("We couldn't use your microphone. Allow microphone access for this site in your browser settings, then try again.");
      return;
    }
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported?.(m));
    const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      const data = new Blob(chunks.current, { type: r.mimeType || mimeType || "audio/webm" });
      blob.current = { data, seconds };
      setUrl(URL.createObjectURL(data));
      if (seconds < 1 || data.size < 500) {
        setMsg("That recording was too short. Please try again.");
        setState("idle");
        return;
      }
      void upload();
    };
    rec.current = r;
    r.start(1000);
    startedAt.current = Date.now();
    setSecs(0);
    setUrl(null);
    setState("recording");
    timer.current = setInterval(() => {
      const s = Math.round((Date.now() - startedAt.current) / 1000);
      setSecs(s);
      if (s >= maxSeconds) stop();
    }, 250);
  };

  const pct = Math.min(1, secs / maxSeconds);
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex flex-col items-center gap-4 rounded-md bg-parchment px-4 py-6 text-center">
      {state === "recording" ? (
        <>
          <button type="button" onClick={stop} className="relative grid h-32 w-32 place-items-center" aria-label="Stop recording">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120"><circle cx="60" cy="60" r={R} fill="none" stroke="#ece3d3" strokeWidth="8" /><circle cx="60" cy="60" r={R} fill="none" stroke="#f4a261" strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} /></svg>
            <span className="grid h-20 w-20 animate-pulse place-items-center rounded-full bg-red-600 text-white"><span className="h-7 w-7 rounded-[5px] bg-white" /></span>
          </button>
          <div className="font-mono text-2xl font-bold tabular-nums">{fmtSeconds(secs)} <span className="text-base text-ink-muted">/ {fmtSeconds(maxSeconds)}</span></div>
          <p className="text-sm text-ink-muted">Recording… tap the button when you’ve finished.</p>
        </>
      ) : (
        <>
          {state === "idle" && (
            <>
              <button type="button" onClick={startRec} className="grid h-24 w-24 place-items-center rounded-full bg-green text-amber shadow-lg transition hover:scale-105" aria-label="Start recording">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3" /></svg>
              </button>
              <p className="text-[15px] font-bold">Tap to record your answer</p>
              <p className="-mt-3 text-[13px] text-ink-muted">Up to {Math.round(maxSeconds / 60)} minutes. You can listen back and record again.</p>
            </>
          )}
          {state === "uploading" && <p className="flex items-center gap-2 font-bold text-green"><span className="h-4 w-4 animate-spin rounded-full border-2 border-green/30 border-t-green" /> Saving your recording…</p>}
          {state === "saved" && (
            <p className="flex items-center gap-2 font-bold text-green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>
              Answer saved{blob.current ? ` (${fmtSeconds(blob.current.seconds)})` : saved ? ` (${fmtSeconds(saved.seconds)})` : ""}
            </p>
          )}
          {url && <audio controls src={url} className="w-full max-w-sm" />}
          {state === "failed" && <button type="button" className="btn-amber min-h-11" onClick={upload}>Try again</button>}
          {(state === "saved" || state === "failed") && (
            <button type="button" onClick={startRec} className="text-sm font-bold text-green underline decoration-amber decoration-2 underline-offset-4">Record again</button>
          )}
        </>
      )}
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </div>
  );
}

