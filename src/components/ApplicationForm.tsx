"use client";

import { useActionState } from "react";
import { submitApplicationAction, type FormState } from "@/app/actions/vetting";

export function ApplicationForm({ qualifications, fields }: { qualifications: readonly string[]; fields: readonly string[] }) {
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cvUrl" className="label">Link to your CV</label>
          <input id="cvUrl" name="cvUrl" type="url" required placeholder="https://drive.google.com/…" className="field" />
        </div>
        <div>
          <label htmlFor="sampleUrl" className="label">Link to a work sample (optional)</label>
          <input id="sampleUrl" name="sampleUrl" type="url" placeholder="https://…" className="field" />
        </div>
      </div>
      <p className="-mt-3 text-xs text-ink-muted">Share a Google Drive or Dropbox link set to &ldquo;anyone with the link can view&rdquo;. File upload is coming soon.</p>

      {state?.error && (
        <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">{state.error}</p>
      )}
      <button type="submit" className="btn-primary self-start" disabled={pending}>
        {pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
