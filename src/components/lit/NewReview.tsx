"use client";

import { useActionState } from "react";
import { createReviewAction, litUpgradeAction } from "@/app/actions/lit";
import { STYLES } from "@/lib/cite";
import { Icon } from "../Icons";

export const PURPOSES = ["Thesis or dissertation chapter", "Journal article", "Research proposal", "Coursework or term paper", "Systematic or scoping review", "Report or policy brief", "Other"];

export function NewReview() {
  const [state, action, pending] = useActionState(createReviewAction, undefined);
  return (
    <form action={action} className="card flex flex-col gap-4 p-6">
      <div>
        <label className="label" htmlFor="rq">Your research question</label>
        <textarea id="rq" name="rq" required minLength={10} rows={3} className="field" placeholder="How do smallholder farmers experience and adapt to changing rainfall?" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="title">Short title <span className="font-normal text-ink-muted">(optional)</span></label>
          <input id="title" name="title" className="field" placeholder="Rainfall and adaptation" />
        </div>
        <div>
          <label className="label" htmlFor="discipline">Discipline</label>
          <input id="discipline" name="discipline" className="field" placeholder="Sociology, public health, economics…" />
        </div>
        <div>
          <label className="label" htmlFor="purpose">What it's for</label>
          <select id="purpose" name="purpose" className="field">
            {PURPOSES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="style">Citation style</label>
          <select id="style" name="style" className="field" defaultValue="apa">
            {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-amber self-start" disabled={pending}>{pending ? "Creating…" : "Create the review"}</button>
      <p className="flex items-start gap-2 text-[13px] text-ink-muted"><Icon name="lock" size={15} className="mt-0.5 flex-none" /> Next you upload the papers you have, or ask a vetted expert to find them for you.</p>
    </form>
  );
}

export function LitUpgradeButton({ requested }: { requested: boolean }) {
  const [state, action, pending] = useActionState(async () => litUpgradeAction(), undefined);
  if (requested || state?.ok) {
    return (
      <div className="flex items-start gap-3 rounded-sm bg-green-tint p-4 text-green">
        <Icon name="check" size={20} className="mt-0.5 flex-none" />
        <p className="text-[15px]"><b>Request sent.</b> We&apos;ll switch your access on and send payment details to your email, usually within a day.</p>
      </div>
    );
  }
  return (
    <form action={action}>
      <button disabled={pending} className="btn-amber w-full sm:w-auto">{pending ? "Sending…" : "Request upgrade"}</button>
    </form>
  );
}
