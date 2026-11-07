"use client";

import { useState, useTransition } from "react";
import { buyPlanAction } from "@/app/actions/plans";
import { PLANS, type PlanId, TERMS, planPrice } from "@/lib/plans";

const cedis = (minor: number) => `GH₵${(minor / 100).toLocaleString("en-GB")}`;

/** Choose this tool or all three, one or three months, and pay through Paystack. */
export function PlanPicker({ tool, testMode }: { tool: Exclude<PlanId, "all">; testMode: boolean }) {
  const [plan, setPlan] = useState<PlanId>(tool);
  const [months, setMonths] = useState<1 | 3>(1);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const price = planPrice(plan, months);
  const options: PlanId[] = [tool, "all"];
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Plan" className="grid gap-2">
        {options.map((p) => (
          <label key={p} className={`flex cursor-pointer items-center gap-3 rounded-sm border p-3.5 transition hover:border-green ${plan === p ? "border-green bg-green-tint" : "border-line bg-white"}`}>
            <input type="radio" name="plan" checked={plan === p} onChange={() => setPlan(p)} className="size-4 accent-green" />
            <span className="flex-1">
              <span className="block font-bold">{PLANS[p].name}</span>
              <span className="block text-[13px] text-ink-muted">{p === "all" ? "Statistics, Qualitative Studio and Literature Review" : "This tool only"}</span>
            </span>
            <span className="text-right font-bold whitespace-nowrap">{cedis(PLANS[p].monthlyMinor)}<span className="text-[12px] font-normal text-ink-muted"> /month</span></span>
          </label>
        ))}
      </div>
      <div role="radiogroup" aria-label="Length" className="grid grid-cols-2 gap-2">
        {TERMS.map((t) => (
          <button key={t.months} type="button" role="radio" aria-checked={months === t.months} onClick={() => setMonths(t.months)} className={`rounded-sm border p-2.5 text-sm font-bold transition hover:border-green ${months === t.months ? "border-green bg-green-tint text-green" : "border-line bg-white"}`}>
            {t.months === 1 ? "1 month" : `${t.months} months`}
            {t.discount ? <span className="ml-1.5 rounded-full bg-amber px-2 py-0.5 text-[11px] text-ink">Save {t.discount * 100}%</span> : null}
          </button>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={() => start(async () => { setErr(null); const r = await buyPlanAction(plan, months); if (r?.error) setErr(r.error); })} className="btn-amber">
        {busy ? "Opening Paystack…" : `Pay ${cedis(price)}`}
      </button>
      <p className="text-center text-[12.5px] text-ink-muted">Mobile Money or card, through Paystack. Access starts as soon as the payment goes through; your work and downloads are always kept.</p>
      {testMode && <p className="rounded-sm bg-amber-tint p-2 text-center text-[12.5px] text-amber-deep">Test mode: no real money is taken.</p>}
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
