"use client";

import { useActionState } from "react";
import { rejectAction, type FormState } from "@/app/actions/vetting";

export function RejectForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(rejectAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      <label htmlFor="reject-note" className="label">Reason (shown to the applicant)</label>
      <textarea id="reject-note" name="note" rows={3} required className="field" placeholder="e.g. Please share a work sample in your main field." />
      {state?.error && <p role="alert" className="text-sm text-amber-deep">{state.error}</p>}
      <button className="btn-outline self-start" disabled={pending}>{pending ? "Rejecting…" : "Reject application"}</button>
    </form>
  );
}
