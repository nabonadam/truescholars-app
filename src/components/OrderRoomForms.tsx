"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { playSent } from "@/lib/sounds";
import {
  approveAction,
  deliverAction,
  reviewAction,
  revisionAction,
  sendMessageAction,
  type FormState,
} from "@/app/actions/orderRoom";

const ACCEPT =
  ".pdf,.doc,.docx,.odt,.rtf,.txt,.md,.xls,.xlsx,.csv,.ods,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.zip,.dta,.do,.log,.smcl,.sav,.sps,.r,.rmd,.py,.ipynb,.nvp,.nvpx,.mp3,.m4a,.wav";

function Note({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return <p role="alert" className="rounded-sm bg-amber-tint px-3 py-2 text-sm text-amber-deep">{state.error}</p>;
}

/** Resets the form after each successful submit. */
function useResetOnOk(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state?.ok]);
  return ref;
}

/**
 * Near-real-time updates: checks a tiny fingerprint of the order every 3 seconds (only while the tab
 * is visible) and reloads the page data only when something changed. Checks immediately on return.
 */
export function LivePulse({ url, initial, seconds = 3 }: { url: string; initial: string; seconds?: number }) {
  const router = useRouter();
  const last = useRef(initial);
  useEffect(() => {
    last.current = initial;
  }, [initial]);
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const { v } = (await res.json()) as { v: string };
          if (v !== last.current) {
            last.current = v;
            router.refresh();
          }
        }
      } catch {
        /* offline: try again next tick */
      } finally {
        busy = false;
      }
    };
    const t = setInterval(check, seconds * 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [url, router, seconds]);
  return null;
}

/** Re-fetches the page every N seconds (used on lists such as the inbox). */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

export function MessageComposer({ orderId, rows = 3 }: { orderId: string; rows?: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(sendMessageAction, undefined);
  const ref = useResetOnOk(state);
  useEffect(() => {
    if (state?.ok) playSent();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="body" className="sr-only">Message</label>
      <textarea
        id="body"
        name="body"
        rows={rows}
        maxLength={5000}
        placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
        className="field"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!pending) e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer text-sm font-bold text-green">
          <input type="file" name="files" multiple accept={ACCEPT} className="block max-w-56 text-xs text-ink-muted file:mr-2 file:rounded-full file:border-0 file:bg-green-tint file:px-3 file:py-2 file:font-bold file:text-green" />
        </label>
        <button className="btn-primary ml-auto" disabled={pending}>{pending ? "Sending…" : "Send"}</button>
      </div>
      <Note state={state} />
    </form>
  );
}

export function DeliveryForm({ orderId, milestoneId }: { orderId: string; milestoneId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deliverAction, undefined);
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <label htmlFor={`note-${milestoneId}`} className="label">Delivery note</label>
      <textarea id={`note-${milestoneId}`} name="note" rows={3} required className="field" placeholder="What's included, and anything the client should check." />
      <label className="label" htmlFor={`files-${milestoneId}`}>Files (up to 5, 10 MB each)</label>
      <input id={`files-${milestoneId}`} type="file" name="files" multiple required accept={ACCEPT} className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-green-tint file:px-4 file:py-2 file:font-bold file:text-green" />
      <Note state={state} />
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Delivering…" : "Deliver work"}</button>
    </form>
  );
}

export function ClientDecision({ orderId, milestoneId, revisionsLeft, expertFirstName }: { orderId: string; milestoneId: string; revisionsLeft: number; expertFirstName: string }) {
  const [approveState, approve, approving] = useActionState<FormState, FormData>(approveAction, undefined);
  const [revState, revise, revising] = useActionState<FormState, FormData>(revisionAction, undefined);
  const [showRevision, setShowRevision] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <form action={approve}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="milestoneId" value={milestoneId} />
          <button className="btn-primary" disabled={approving}>{approving ? "Approving…" : `Approve and pay ${expertFirstName}`}</button>
        </form>
        {revisionsLeft > 0 && !showRevision && (
          <button type="button" className="btn-outline border border-line" onClick={() => setShowRevision(true)}>
            Request a revision ({revisionsLeft} left)
          </button>
        )}
      </div>
      <Note state={approveState} />
      {showRevision && (
        <form action={revise} className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="milestoneId" value={milestoneId} />
          <label htmlFor="reason" className="label">What should change?</label>
          <textarea id="reason" name="reason" rows={3} required className="field" />
          <Note state={revState} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={revising}>{revising ? "Sending…" : "Send revision request"}</button>
            <button type="button" className="btn-outline border border-line" onClick={() => setShowRevision(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ReviewForm({ orderId, subjectName }: { orderId: string; subjectName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewAction, undefined);
  const [rating, setRating] = useState(0);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="rating" value={rating} />
      <fieldset>
        <legend className="label">How was working with {subjectName}?</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              aria-pressed={rating >= n}
              onClick={() => setRating(n)}
              className={`grid size-11 place-items-center rounded-sm text-2xl ${rating >= n ? "text-amber-deep" : "text-line"}`}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <label htmlFor="review-body" className="label">Comments (optional, shown publicly)</label>
      <textarea id="review-body" name="body" rows={3} maxLength={1500} className="field" />
      <Note state={state} />
      <button className="btn-primary self-start" disabled={pending || rating === 0}>{pending ? "Posting…" : "Post review"}</button>
    </form>
  );
}
