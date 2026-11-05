"use client";

import { useActionState } from "react";
import { checkoutAction, type FormState } from "@/app/actions/orders";

export function CheckoutForm({ serviceId, tier, questions, priceLabel }: { serviceId: string; tier: string; questions: string[]; priceLabel: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(checkoutAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="tier" value={tier} />
      {questions.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">The expert needs to know</h2>
          {questions.map((q, i) => (
            <div key={q}>
              <label htmlFor={`answer_${i}`} className="label">{q}</label>
              <textarea id={`answer_${i}`} name={`answer_${i}`} required rows={3} className="field" />
            </div>
          ))}
        </div>
      )}
      {state?.error && <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">{state.error}</p>}
      <button className="btn-primary w-full sm:w-auto sm:self-start" disabled={pending}>
        {pending ? "Opening secure payment…" : `Pay ${priceLabel} into escrow`}
      </button>
      <p className="text-xs text-ink-muted">You&apos;ll pay on Paystack&apos;s secure page by Mobile Money or card. The expert is only paid when you approve the delivery.</p>
    </form>
  );
}
