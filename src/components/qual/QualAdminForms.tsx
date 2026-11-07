"use client";

import { useActionState } from "react";
import { qualEndAccessAction, qualGrantAction } from "@/app/actions/qualAdmin";

export function QualGrantForm({ email = "" }: { email?: string }) {
  const [state, action, pending] = useActionState(qualGrantAction, undefined);
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
      <div>
        <label className="label" htmlFor="qg-email">Email</label>
        <input id="qg-email" name="email" type="email" required defaultValue={email} className="field" placeholder="client@example.com" />
      </div>
      <div>
        <label className="label" htmlFor="qg-days">Days</label>
        <input id="qg-days" name="days" type="number" min={1} max={3650} required defaultValue={30} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="qg-note">Note (optional)</label>
        <input id="qg-note" name="note" className="field" placeholder="Paid by MoMo, ref 1234" />
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Give access"}</button>
      {state?.error && <p className="text-sm text-red-700 sm:col-span-4">{state.error}</p>}
      {state?.ok && <p className="text-sm font-bold text-green sm:col-span-4">{state.ok}</p>}
    </form>
  );
}

export function QualEndAccessButton({ userId }: { userId: string }) {
  return (
    <form action={() => qualEndAccessAction(userId)} onSubmit={(e) => { if (!confirm("End this person's access now?")) e.preventDefault(); }}>
      <button className="text-xs font-bold text-red-700 hover:underline">End access</button>
    </form>
  );
}
