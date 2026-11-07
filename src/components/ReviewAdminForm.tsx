"use client";

import { useActionState } from "react";
import { hideReviewAction, type ReviewAdminState } from "@/app/actions/reviewsAdmin";

export function ReviewAdminForm({ reviewId, hidden }: { reviewId: string; hidden: boolean }) {
  const [state, action, pending] = useActionState<ReviewAdminState, FormData>(hideReviewAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="hidden" value={hidden ? "0" : "1"} />
      {!hidden && <input name="reason" required maxLength={200} placeholder="Reason (sent to the author)" className="field h-9 min-w-0 flex-1 py-1 text-sm" />}
      <button className={hidden ? "btn-outline h-9 px-3 py-1 text-sm" : "h-9 rounded-sm bg-ink px-3 text-sm font-bold text-white"} disabled={pending}>{hidden ? "Show again" : "Hide review"}</button>
      {state?.error && <span className="w-full text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
