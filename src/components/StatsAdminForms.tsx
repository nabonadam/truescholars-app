"use client";

import { useActionState } from "react";
import { endAccessAction, grantAction } from "@/app/actions/statsAdmin";

export function GrantForm({ email = "" }: { email?: string }) {
  const [state, action, pending] = useActionState(grantAction, undefined);
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
      <div>
        <label className="label" htmlFor="g-email">Email</label>
        <input id="g-email" name="email" type="email" required defaultValue={email} className="field" placeholder="student@example.com" />
      </div>
      <div>
        <label className="label" htmlFor="g-days">Days</label>
        <input id="g-days" name="days" type="number" min={1} max={3650} required defaultValue={30} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="g-note">Note (optional)</label>
        <input id="g-note" name="note" className="field" placeholder="Paid by MoMo, ref 1234" />
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Give access"}</button>
      {state?.error && <p className="text-sm text-red-700 sm:col-span-4">{state.error}</p>}
      {state?.ok && <p className="text-sm font-bold text-green sm:col-span-4">{state.ok}</p>}
    </form>
  );
}

export function EndAccessButton({ userId }: { userId: string }) {
  return (
    <form action={() => endAccessAction(userId)} onSubmit={(e) => { if (!confirm("End this person's access now?")) e.preventDefault(); }}>
      <button className="text-xs font-bold text-red-700 hover:underline">End access</button>
    </form>
  );
}
