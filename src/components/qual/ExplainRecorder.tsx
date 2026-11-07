"use client";

import { useEffect, useRef, useState } from "react";
import { fmtSeconds, type Question } from "@/lib/qual";
import { Icon } from "../Icons";

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const MAX = 180;

/** Lets the researcher record a short spoken explanation of a question, listen back, re-record or remove it. */
export function ExplainRecorder({ studyId, q, set }: { studyId: string; q: Question; set: (p: Partial<Question>) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErr("This browser can't record audio. Try Chrome, Edge or Safari.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setErr("Allow microphone access in your browser to record an explanation.");
      return;
    }
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported?.(m));
    const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => upload(new Blob(chunks.current, { type: r.mimeType || mimeType || "audio/webm" }), (Date.now() - started.current) / 1000);
    rec.current = r;
    started.current = Date.now();
    r.start(1000);
    setSecs(0);
    setState("recording");
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSecs(s);
      if (s >= MAX) stop();
    }, 250);
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const r = rec.current;
    if (r && r.state !== "inactive") {
      r.stop();
      r.stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function upload(blob: Blob, seconds: number) {
    setState("saving");
    try {
      const res = await fetch(`/api/qual/${studyId}/explain`, { method: "POST", headers: { "content-type": blob.type, "x-seconds": String(Math.round(seconds)) }, body: blob });
      const j = (await res.json().catch(() => ({}))) as { key?: string; mime?: string; seconds?: number; error?: string };
      if (!res.ok || !j.key) throw new Error(j.error || "We couldn't save that recording. Please try again.");
      set({ explain: { key: j.key, mime: j.mime ?? blob.type, seconds: j.seconds ?? Math.round(seconds) } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "We couldn't save that recording.");
    }
    setState("idle");
  }

  return (
    <div className="rounded-sm border border-dashed border-line bg-parchment/60 p-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink"><Icon name="mic" size={15} className="text-green" /> Spoken explanation</span>
        <span className="text-[12.5px] text-ink-muted">Optional. Respondents who don&apos;t understand the question can play it.</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        {state === "recording" ? (
          <>
            <span className="flex items-center gap-2 text-sm font-bold text-red-700"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" /> Recording {fmtSeconds(secs)} / {fmtSeconds(MAX)}</span>
            <button type="button" onClick={stop} className="btn-primary min-h-9 px-4 text-sm">Stop</button>
          </>
        ) : state === "saving" ? (
          <span className="text-sm text-ink-muted">Saving…</span>
        ) : q.explain ? (
          <>
            <audio controls preload="none" src={`/api/qual/${studyId}/explain?k=${encodeURIComponent(q.explain.key)}`} className="h-9 max-w-full" />
            <span className="text-[12.5px] text-ink-muted">{fmtSeconds(q.explain.seconds)}</span>
            <button type="button" onClick={start} className="text-[13px] font-bold text-green">Re-record</button>
            <button type="button" onClick={() => confirm("Remove this explanation?") && set({ explain: null })} className="text-[13px] font-bold text-red-700">Remove</button>
          </>
        ) : (
          <button type="button" onClick={start} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-green/30 bg-white px-3.5 text-[13px] font-bold text-green hover:border-green">
            <Icon name="mic" size={14} /> Record an explanation
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}
