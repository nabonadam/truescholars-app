"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { sampleAction } from "@/app/actions/stats";
import { Icon } from "../Icons";

const mb = (n: number) => (n / 1024 / 1024 < 10 ? (n / 1024 / 1024).toFixed(1) : Math.round(n / 1024 / 1024).toString());

type Stage = { kind: "idle" } | { kind: "upload"; name: string; sent: number; total: number } | { kind: "read"; name: string } | { kind: "error"; message: string };

export function UploadForm({ maxMb }: { maxMb: number }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = stage.kind === "upload" || stage.kind === "read";

  // Wake the engine while the person is still choosing a file.
  useEffect(() => {
    fetch("/api/stats/ping", { method: "POST" }).catch(() => null);
  }, []);

  const send = (f: File | undefined | null) => {
    if (!f || busy) return;
    if (f.size > maxMb * 1024 * 1024) return setStage({ kind: "error", message: `${f.name} is ${mb(f.size)} MB. Datasets can be up to ${maxMb} MB.` });
    if (!/\.(dta|sav|xlsx|xls|csv|tsv|txt)$/i.test(f.name)) return setStage({ kind: "error", message: "Upload a Stata (.dta), SPSS (.sav), Excel (.xlsx) or CSV file." });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/stats/upload");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(f.name));
    xhr.upload.onprogress = (e) => setStage({ kind: "upload", name: f.name, sent: e.loaded, total: e.total || f.size });
    xhr.upload.onload = () => setStage({ kind: "read", name: f.name });
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && body.id) window.location.assign(`/tools/stats/${body.id}`);
      else setStage({ kind: "error", message: body.error ?? "The upload did not finish. Try again." });
    };
    xhr.onerror = () => setStage({ kind: "error", message: "The connection dropped during the upload. Try again." });
    setStage({ kind: "upload", name: f.name, sent: 0, total: f.size });
    xhr.send(f);
    if (input.current) input.current.value = "";
  };

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files?.[0]); }}
        className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-9 text-center transition ${busy ? "cursor-default border-green/40 bg-white" : over ? "cursor-pointer border-amber bg-amber-tint/50" : "cursor-pointer border-green/25 bg-white hover:border-green/60"}`}
      >
        <input ref={input} type="file" accept=".dta,.sav,.xlsx,.xls,.csv,.tsv" className="sr-only" disabled={busy} onChange={(e) => send(e.target.files?.[0])} />
        {stage.kind === "upload" || stage.kind === "read" ? (
          <div className="w-full max-w-sm">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-bold">{stage.name}</span>
              <span className="flex-none tabular-nums text-ink-muted">
                {stage.kind === "upload" ? `${mb(stage.sent)} of ${mb(stage.total)} MB` : "Uploaded"}
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-green-tint">
              {stage.kind === "upload" ? (
                <div className="h-full rounded-full bg-green transition-[width] duration-200" style={{ width: `${Math.max(3, (stage.sent / Math.max(stage.total, 1)) * 100)}%` }} />
              ) : (
                <div className="ts-indeterminate h-full w-1/3 rounded-full bg-amber" />
              )}
            </div>
            <p className="mt-2.5 text-[13px] text-ink-muted">
              {stage.kind === "upload" ? "Uploading…" : "Reading variables, labels and missing values. Large files take a little longer."}
            </p>
          </div>
        ) : (
          <>
            <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-green text-amber"><Icon name="upload" size={22} /></span>
            <span className="mt-3 text-[17px] font-bold">Drop your dataset here</span>
            <span className="mt-0.5 text-sm text-ink-muted">or click to choose · Stata .dta, SPSS .sav, Excel or CSV · up to {maxMb} MB</span>
          </>
        )}
      </label>
      {stage.kind === "error" && <p className="mt-2 text-sm text-red-700">{stage.message}</p>}
    </div>
  );
}

export function SampleButton() {
  const [state, action] = useActionState(sampleAction, undefined);
  return (
    <form action={action} className="inline">
      <SampleSubmit />
      {state?.error && <span className="ml-2 text-sm text-red-700">{state.error}</span>}
    </form>
  );
}

function SampleSubmit() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="font-bold text-green underline decoration-amber decoration-2 underline-offset-4 disabled:opacity-60">
      {pending ? "Opening the sample…" : "try our sample survey"}
    </button>
  );
}
