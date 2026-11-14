"use client";

import { useActionState, useState } from "react";
import { submitApplicationAction, type FormState } from "@/app/actions/vetting";

export function ApplicationForm({ qualifications, fields, keep = false }: { qualifications: readonly string[]; fields: readonly string[]; keep?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitApplicationAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-6">
      <div>
        <label htmlFor="qualification" className="label">Highest qualification</label>
        <select id="qualification" name="qualification" required defaultValue="" className="field">
          <option value="" disabled>Choose one</option>
          {qualifications.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="label">Fields you&apos;ll offer (up to four)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((f) => (
            <label
              key={f}
              className="flex cursor-pointer items-center gap-3 rounded-sm border border-line bg-white px-4 py-3 text-sm has-checked:border-green has-checked:bg-green-tint"
            >
              <input type="checkbox" name="fields" value={f} className="size-4 accent-green" />
              {f}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-line bg-white px-4 py-3 text-sm has-checked:border-green has-checked:bg-green-tint">
        <input type="checkbox" name="litRetriever" value="1" className="mt-0.5 size-4 flex-none accent-green" />
        <span>
          <b>Also take literature retrieval assignments</b>
          <span className="block text-ink-muted">Find papers for clients&apos; literature reviews. These are assigned to you privately by The True Scholars (never posted publicly), at a set price.</span>
        </span>
      </label>

      <div>
        <label htmlFor="experienceYears" className="label">Years of relevant experience</label>
        <input id="experienceYears" name="experienceYears" type="number" min={0} max={60} required className="field max-w-40" />
      </div>

      <div>
        <label htmlFor="pitch" className="label">Why you? Tell clients what you do best</label>
        <textarea
          id="pitch"
          name="pitch"
          required
          minLength={80}
          maxLength={1500}
          rows={6}
          className="field"
          placeholder="e.g. I'm a biostatistician with 6 years of experience running regression and survival analyses in Stata and R for health research…"
        />
        <p className="mt-1 text-xs text-ink-muted">80–1,500 characters.</p>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="label">Documents for vetting</legend>
        <p className="-mt-1 text-sm text-ink-muted">
          Seen only by our vetting team, never by clients. Up to 10 MB each.{" "}
          {keep && "Your earlier documents are kept unless you upload new ones."}
        </p>
        <DocField id="cvFile" label="Your CV" hint="PDF or Word document" accept=".pdf,.doc,.docx,.odt,.rtf" required={!keep} linkName="cvUrl" linkLabel="or link to your CV instead" />
        <DocField id="sampleFile" label="A sample of your work" hint="An analysis, an edited chapter, a report… remove anything confidential" accept=".pdf,.doc,.docx,.odt,.rtf,.xls,.xlsx,.csv,.ppt,.pptx,.zip,.do,.log,.dta,.sav,.r,.rmd,.py,.ipynb,.txt" required={!keep} linkName="sampleUrl" linkLabel="or link to a sample instead" />
        <DocField id="idFile" label="Government-issued ID" hint="A photo or scan of your passport, national ID (e.g. Ghana Card) or driver's licence. Deleted 60 days after we decide." accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,image/*" required={!keep} />
      </fieldset>

      {state?.error && (
        <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">{state.error}</p>
      )}
      <button type="submit" className="btn-primary self-start" disabled={pending}>
        {pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}

function DocField({ id, label, hint, accept, required, linkName, linkLabel }: { id: string; label: string; hint: string; accept: string; required: boolean; linkName?: string; linkLabel?: string }) {
  const [useLink, setUseLink] = useState(false);
  return (
    <div className="rounded-sm border border-line bg-white p-4">
      <label htmlFor={useLink ? linkName : id} className="font-bold">{label}{required && !useLink ? "" : " (optional)"}</label>
      <p className="mb-2 text-[13px] text-ink-muted">{hint}</p>
      {useLink && linkName ? (
        <input id={linkName} name={linkName} type="url" required={required} placeholder="https://drive.google.com/… (anyone with the link can view)" className="field" />
      ) : (
        <input id={id} name={id} type="file" accept={accept} required={required} className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-green-tint file:px-4 file:py-2 file:font-bold file:text-green" />
      )}
      {linkName && (
        <button type="button" onClick={() => setUseLink(!useLink)} className="mt-2 text-[13px] font-bold text-green">
          {useLink ? "Upload a file instead" : linkLabel}
        </button>
      )}
    </div>
  );
}
