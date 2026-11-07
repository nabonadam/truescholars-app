"use client";

import { useActionState, useState, useTransition } from "react";
import { addRetrieverAction, assignRetrieverAction, declineRequestAction, setRetrieverAction, unassignRetrieverAction } from "@/app/actions/litAdmin";

type Retriever = { userId: string; name: string | null; email: string; active: number; done: number };
type Msg = { ok?: string; error?: string } | undefined;

function Note({ m }: { m: Msg }) {
  if (m?.error) return <p className="text-sm text-red-700">{m.error}</p>;
  if (m?.ok) return <p className="text-sm font-bold text-green">{m.ok}</p>;
  return null;
}

/** Choose a retriever, set the price and time, assign. */
export function AssignForm({ reviewId, retrievers, price, days }: { reviewId: string; retrievers: Retriever[]; price: number; days: number }) {
  const [state, action, pending] = useActionState(assignRetrieverAction, undefined);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(undefined);
  const [busy, start] = useTransition();
  if (!retrievers.length) {
    return <p className="rounded-sm bg-amber-tint p-3 text-sm text-amber-deep">No literature retrievers yet. Add one below (they need an approved expert account), then assign this request.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] sm:items-end">
        <input type="hidden" name="reviewId" value={reviewId} />
        <label className="text-sm font-bold">
          Expert
          <select name="expert" required className="field mt-1" defaultValue="">
            <option value="" disabled>Choose a literature retriever</option>
            {retrievers.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name ?? r.email} · {r.active} active, {r.done} done
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-bold">
          Price (GH₵)
          <input name="price" type="number" min={10} step="1" required defaultValue={price} className="field mt-1" />
        </label>
        <label className="text-sm font-bold">
          Days
          <input name="days" type="number" min={1} max={60} required defaultValue={days} className="field mt-1" />
        </label>
        <label className="text-sm font-bold sm:col-span-3">
          Note for the expert <span className="font-normal text-ink-muted">(optional, the client sees it too)</span>
          <input name="note" className="field mt-1" placeholder="Prioritise studies from West Africa; include grey literature from FAO." />
        </label>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
          <button className="btn-primary" disabled={pending}>{pending ? "Assigning…" : "Assign expert"}</button>
          <button type="button" onClick={() => setDeclining(!declining)} className="text-sm font-bold text-ink-muted hover:text-ink">Decline the request</button>
        </div>
      </form>
      {declining && (
        <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="field text-sm" placeholder="Tell the client why (they'll see this)." />
          <button type="button" disabled={busy} onClick={() => start(async () => setMsg(await declineRequestAction(reviewId, reason)))} className="btn-outline self-start min-h-10 px-4 text-sm">Decline and tell the client</button>
        </div>
      )}
      <Note m={state} />
      <Note m={msg} />
    </div>
  );
}

export function UnassignButton({ reviewId }: { reviewId: string }) {
  const [msg, setMsg] = useState<Msg>(undefined);
  const [busy, start] = useTransition();
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => confirm("Take this request back from the expert? The unpaid order is cancelled and you can assign someone else.") && start(async () => setMsg(await unassignRetrieverAction(reviewId)))}
        className="text-xs font-bold text-red-700 hover:underline"
      >
        Take back and reassign
      </button>
      <Note m={msg} />
    </span>
  );
}

export function AddRetrieverForm() {
  const [state, action, pending] = useActionState(addRetrieverAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input name="email" type="email" required className="field flex-1 py-2" placeholder="expert@example.com" />
        <button className="btn-outline min-h-10 px-4 text-sm" disabled={pending}>{pending ? "Adding…" : "Add retriever"}</button>
      </div>
      <Note m={state} />
    </form>
  );
}

export function RemoveRetrieverButton({ userId }: { userId: string }) {
  const [busy, start] = useTransition();
  return (
    <button type="button" disabled={busy} onClick={() => confirm("Remove from literature retrievers? Their current assignments carry on.") && start(async () => void (await setRetrieverAction(userId, false)))} className="text-xs font-bold text-red-700 hover:underline">
      Remove
    </button>
  );
}
