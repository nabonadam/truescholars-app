"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  acceptOfferAction,
  adminResolveAction,
  cancelDisputeAction,
  markPaidAction,
  offerAction,
  openDisputeAction,
  payoutMethodAction,
  rejectPayoutAction,
  withdrawAction,
  type TrustState,
} from "@/app/actions/trust";
import { formatMoney } from "@/lib/money";

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.zip,.dta,.do,.sav,.r,.rmd,.nvp,.nvpx,.pptx";

function Note({ state, ok }: { state: TrustState; ok?: string }) {
  if (state?.error)
    return (
      <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm font-medium text-amber-deep">
        {state.error}
      </p>
    );
  if (state?.ok && ok)
    return (
      <p role="status" className="rounded-sm bg-green-tint px-4 py-3 text-sm font-medium text-green">
        {ok}
      </p>
    );
  return null;
}

// ───────────── Open a dispute ─────────────

const REASONS: { v: string; label: string; hint: string }[] = [
  { v: "QUALITY", label: "Quality", hint: "The work doesn't meet what was agreed" },
  { v: "NOT_DELIVERED", label: "Not delivered", hint: "Nothing has been delivered" },
  { v: "LATE", label: "Very late", hint: "Well past the due date" },
  { v: "SCOPE", label: "Scope", hint: "We disagree about what's included" },
  { v: "UNRESPONSIVE", label: "No response", hint: "The other person stopped replying" },
  { v: "OTHER", label: "Something else", hint: "Explain below" },
];

export function OpenDisputeForm({ orderId, milestoneId }: { orderId: string; milestoneId: string }) {
  const [state, action, pending] = useActionState<TrustState, FormData>(openDisputeAction, undefined);
  const [reason, setReason] = useState("");
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <input type="hidden" name="reason" value={reason} />
      <fieldset>
        <legend className="label">What went wrong?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {REASONS.map((r) => (
            <button
              key={r.v}
              type="button"
              aria-pressed={reason === r.v}
              onClick={() => setReason(r.v)}
              className={`flex flex-col items-start rounded-sm border-2 p-3 text-left ${reason === r.v ? "border-green bg-green-tint" : "border-line bg-white hover:border-green/40"}`}
            >
              <span className="font-bold">{r.label}</span>
              <span className="text-xs text-ink-muted">{r.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="details" className="label">Explain what happened</label>
        <textarea id="details" name="details" rows={6} maxLength={3000} required className="field" placeholder="Be specific and factual: what was agreed, what was delivered, and what you'd consider a fair outcome." />
      </div>
      <div>
        <label htmlFor="files" className="label">Evidence <span className="font-normal text-ink-muted">(optional: screenshots, files, up to 5)</span></label>
        <input id="files" name="files" type="file" multiple accept={ACCEPT} className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-green-tint file:px-4 file:py-2 file:font-bold file:text-green" />
      </div>
      <Note state={state} />
      <button className="btn-primary self-start" disabled={pending || !reason}>{pending ? "Opening…" : "Open dispute"}</button>
    </form>
  );
}

// ───────────── Settlement slider ─────────────

function SplitPicker({ amountMinor, feeBps, value, onChange }: { amountMinor: number; feeBps: number; value: number; onChange: (v: number) => void }) {
  const pct = amountMinor ? Math.round((value / amountMinor) * 100) : 0;
  const fee = Math.round((value * feeBps) / 10_000);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-12 overflow-hidden rounded-full border border-line text-sm font-bold" aria-hidden="true">
        <div className="flex items-center justify-center bg-green text-white transition-all" style={{ width: `${pct}%` }}>{pct >= 15 ? `${pct}%` : ""}</div>
        <div className="flex flex-1 items-center justify-center bg-amber text-ink transition-all">{100 - pct >= 15 ? `${100 - pct}%` : ""}</div>
      </div>
      <label htmlFor="split" className="sr-only">Share for the expert</label>
      <input
        id="split"
        type="range"
        min={0}
        max={amountMinor}
        step={Math.max(100, Math.round(amountMinor / 100))}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-green"
      />
      <div className="flex flex-wrap gap-2">
        {[0, 25, 50, 75, 100].map((p) => (
          <button key={p} type="button" onClick={() => onChange(Math.round((amountMinor * p) / 100))} className={`rounded-full border px-3 py-1 text-xs font-bold ${pct === p ? "border-green bg-green text-white" : "border-line bg-white"}`}>
            {p === 0 ? "Full refund" : p === 100 ? "Pay in full" : `${p}% to expert`}
          </button>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-sm bg-green-tint p-3">
          <dt className="text-xs font-bold text-green uppercase">Expert receives</dt>
          <dd className="font-display text-xl font-bold text-green">{formatMoney(value)}</dd>
          <dd className="text-xs text-ink-muted">{formatMoney(value - fee)} after the {feeBps / 100}% fee</dd>
        </div>
        <div className="rounded-sm bg-amber-tint p-3">
          <dt className="text-xs font-bold text-amber-deep uppercase">Client gets back</dt>
          <dd className="font-display text-xl font-bold text-amber-deep">{formatMoney(amountMinor - value)}</dd>
          <dd className="text-xs text-ink-muted">Refunded to the original payment</dd>
        </div>
      </dl>
    </div>
  );
}

export function OfferForm({ disputeId, amountMinor, feeBps, initial }: { disputeId: string; amountMinor: number; feeBps: number; initial: number }) {
  const [state, action, pending] = useActionState<TrustState, FormData>(offerAction, undefined);
  const [value, setValue] = useState(initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="disputeId" value={disputeId} />
      <input type="hidden" name="releaseMinor" value={value} />
      <SplitPicker amountMinor={amountMinor} feeBps={feeBps} value={value} onChange={setValue} />
      <Note state={state} ok="Offer sent. We've let the other side know." />
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Sending…" : "Propose this split"}</button>
    </form>
  );
}

export function AdminDecisionForm({ disputeId, amountMinor, feeBps, initial }: { disputeId: string; amountMinor: number; feeBps: number; initial: number }) {
  const [state, action, pending] = useActionState<TrustState, FormData>(adminResolveAction, undefined);
  const [value, setValue] = useState(initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="disputeId" value={disputeId} />
      <input type="hidden" name="releaseMinor" value={value} />
      <SplitPicker amountMinor={amountMinor} feeBps={feeBps} value={value} onChange={setValue} />
      <div>
        <label htmlFor="decision" className="label">Decision, shown to both sides</label>
        <textarea id="decision" name="decision" rows={4} required className="field" placeholder="What you reviewed and why this split is fair." />
      </div>
      <Note state={state} ok="Dispute resolved. Both sides have been notified." />
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Resolving…" : "Resolve dispute"}</button>
    </form>
  );
}

export function AcceptOfferButton({ disputeId, label }: { disputeId: string; label: string }) {
  const [state, action, pending] = useActionState<TrustState, FormData>(acceptOfferAction, undefined);
  const [sure, setSure] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="disputeId" value={disputeId} />
      {sure ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={pending}>{pending ? "Settling…" : "Yes, accept and close"}</button>
          <button type="button" onClick={() => setSure(false)} className="btn-outline">Back</button>
        </div>
      ) : (
        <button type="button" onClick={() => setSure(true)} className="btn-primary self-start">{label}</button>
      )}
      <Note state={state} />
    </form>
  );
}

export function CancelDisputeButton({ disputeId }: { disputeId: string }) {
  const [state, action, pending] = useActionState<TrustState, FormData>(cancelDisputeAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="disputeId" value={disputeId} />
      <button className="text-sm font-bold text-ink-muted underline" disabled={pending}>{pending ? "Withdrawing…" : "Withdraw this dispute"}</button>
      <Note state={state} />
    </form>
  );
}

// ───────────── Earnings ─────────────

const NETWORKS = ["MTN Mobile Money", "Telecel Cash", "AirtelTigo Money"];

export function PayoutMethodForm({ existing }: { existing: { kind: string; provider: string; accountName: string; accountNumber: string } | null }) {
  const [state, action, pending] = useActionState<TrustState, FormData>(payoutMethodAction, undefined);
  const [kind, setKind] = useState(existing?.kind ?? "momo");
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-2 gap-2">
        {[
          { v: "momo", label: "Mobile Money", hint: "MTN, Telecel, AirtelTigo" },
          { v: "bank", label: "Bank account", hint: "Any Ghanaian bank" },
        ].map((k) => (
          <button key={k.v} type="button" aria-pressed={kind === k.v} onClick={() => setKind(k.v)} className={`rounded-sm border-2 p-3 text-left ${kind === k.v ? "border-green bg-green-tint" : "border-line bg-white"}`}>
            <span className="block font-bold">{k.label}</span>
            <span className="text-xs text-ink-muted">{k.hint}</span>
          </button>
        ))}
      </div>
      {kind === "momo" ? (
        <div>
          <label htmlFor="provider" className="label">Network</label>
          <select id="provider" name="provider" defaultValue={existing?.kind === "momo" ? existing.provider : ""} required className="field">
            <option value="" disabled>Choose your network</option>
            {NETWORKS.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label htmlFor="provider" className="label">Bank</label>
          <input id="provider" name="provider" defaultValue={existing?.kind === "bank" ? existing.provider : ""} required className="field" placeholder="e.g. GCB Bank, Ecobank, Fidelity" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="accountName" className="label">Account name</label>
          <input id="accountName" name="accountName" defaultValue={existing?.accountName ?? ""} required autoComplete="name" className="field" placeholder="As registered" />
        </div>
        <div>
          <label htmlFor="accountNumber" className="label">{kind === "momo" ? "Mobile number" : "Account number"}</label>
          <input id="accountNumber" name="accountNumber" defaultValue={existing?.kind === kind ? existing.accountNumber : ""} required inputMode="numeric" className="field" placeholder={kind === "momo" ? "024 123 4567" : "Digits only"} />
        </div>
      </div>
      <Note state={state} ok="Saved. Future withdrawals go to this account." />
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Saving…" : existing ? "Update payout account" : "Save payout account"}</button>
    </form>
  );
}

export function WithdrawForm({ availableMinor, minMinor, destination }: { availableMinor: number; minMinor: number; destination: string }) {
  const [state, action, pending] = useActionState<TrustState, FormData>(withdrawAction, undefined);
  const [amount, setAmount] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) setAmount("");
  }, [state]);
  const can = availableMinor >= minMinor;
  return (
    <form ref={ref} action={action} className="flex flex-col gap-3">
      <label htmlFor="amount" className="text-sm font-bold text-on-green-muted">Amount to withdraw (GH₵)</label>
      <div className="flex gap-2">
        <input id="amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!can} className="field !bg-white" placeholder={(availableMinor / 100).toFixed(2)} />
        <button type="button" onClick={() => setAmount((availableMinor / 100).toFixed(2))} disabled={!can} className="rounded-full border border-white/40 px-4 text-sm font-bold text-white">Max</button>
      </div>
      <button className="btn-amber" disabled={pending || !can}>{pending ? "Requesting…" : "Withdraw"}</button>
      <p className="text-xs text-on-green-muted">{can ? `To ${destination}. Usually paid within 1–2 working days.` : `You can withdraw once you have at least ${formatMoney(minMinor)}.`}</p>
      {state?.error && <p role="alert" className="rounded-sm bg-amber px-3 py-2 text-sm font-medium text-ink">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-sm bg-white/15 px-3 py-2 text-sm font-medium text-white">Request sent. We&apos;ll notify you when it&apos;s paid.</p>}
    </form>
  );
}

// ───────────── Admin payouts ─────────────

export function PayoutDecision({ withdrawalId }: { withdrawalId: string }) {
  const [paidState, paid, paying] = useActionState<TrustState, FormData>(markPaidAction, undefined);
  const [rejState, reject, rejecting] = useActionState<TrustState, FormData>(rejectPayoutAction, undefined);
  const [mode, setMode] = useState<"pay" | "reject">("pay");
  return (
    <div className="flex flex-col gap-3">
      {mode === "pay" ? (
        <form action={paid} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="withdrawalId" value={withdrawalId} />
          <div className="min-w-48 flex-1">
            <label htmlFor={`ref-${withdrawalId}`} className="text-xs font-bold text-ink-muted">Transaction ID after sending</label>
            <input id={`ref-${withdrawalId}`} name="reference" required className="field !py-2" placeholder="e.g. MoMo transaction ID" />
          </div>
          <button className="btn-primary min-h-10" disabled={paying}>{paying ? "Saving…" : "Mark as paid"}</button>
          <button type="button" onClick={() => setMode("reject")} className="min-h-10 px-3 text-sm font-bold text-ink-muted">Reject</button>
        </form>
      ) : (
        <form action={reject} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="withdrawalId" value={withdrawalId} />
          <div className="min-w-48 flex-1">
            <label htmlFor={`note-${withdrawalId}`} className="text-xs font-bold text-ink-muted">Reason, sent to the expert</label>
            <input id={`note-${withdrawalId}`} name="note" required className="field !py-2" placeholder="e.g. The account name doesn't match" />
          </div>
          <button className="btn-outline min-h-10" disabled={rejecting}>{rejecting ? "Rejecting…" : "Reject and return funds"}</button>
          <button type="button" onClick={() => setMode("pay")} className="min-h-10 px-3 text-sm font-bold text-ink-muted">Back</button>
        </form>
      )}
      <Note state={mode === "pay" ? paidState : rejState} />
    </div>
  );
}
