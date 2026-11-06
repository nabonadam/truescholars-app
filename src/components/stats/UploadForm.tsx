"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { sampleAction, uploadAction } from "@/app/actions/stats";
import { Icon } from "../Icons";

export function UploadForm() {
  const [state, action] = useActionState(uploadAction, undefined);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setFile(f);
    if (input.current && input.current.files?.[0] !== f) {
      const dt = new DataTransfer();
      dt.items.add(f);
      input.current.files = dt.files;
    }
    requestAnimationFrame(() => form.current?.requestSubmit());
  };

  return (
    <form ref={form} action={action}>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-9 text-center transition ${over ? "border-amber bg-amber-tint/50" : "border-green/25 bg-white hover:border-green/60"}`}
      >
        <input ref={input} type="file" name="file" accept=".dta,.sav,.xlsx,.xls,.csv,.tsv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        <Uploading file={file} />
      </label>
      {state?.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

function Uploading({ file }: { file: File | null }) {
  const { pending } = useFormStatus();
  if (pending && file) {
    return (
      <>
        <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-green/20 border-t-green" />
        <span className="mt-3 font-bold">Reading {file.name}…</span>
        <span className="text-sm text-ink-muted">Checking variables, labels and missing values</span>
      </>
    );
  }
  return (
    <>
      <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-green text-amber"><Icon name="upload" size={22} /></span>
      <span className="mt-3 text-[17px] font-bold">Drop your dataset here</span>
      <span className="mt-0.5 text-sm text-ink-muted">or click to choose · Stata .dta, SPSS .sav, Excel or CSV · up to 50 MB</span>
    </>
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
