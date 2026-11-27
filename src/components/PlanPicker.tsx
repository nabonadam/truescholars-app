"use client";

import { useState, useTransition } from "react";
import { buyPlanAction } from "@/app/actions/plans";
import { type Months, PLANS, type PlanId, TERMS, chargeGhsMinor, money, planPrice } from "@/lib/plans";

/** Choose this tool or all three and a length, and pay through Paystack. */
export function PlanPicker({ tool, testMode, usdToGhs }: { tool: Exclude<PlanId, "all">; testMode: boolean; usdToGhs: number }) {
  const [plan, setPlan] = useState<PlanId>(tool);
  const [months, setMonths] = useState<Months>(1);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // one price list in US$; Paystack charges its cedi equivalent at today's rate
  const price = planPrice(plan, months, "USD");
  const full = PLANS[plan].USD * months;
  const ghs = (usd: number) => chargeGhsMinor(usd, "USD", usdToGhs) / 100;
  const options: PlanId[] = tool === "api" ? ["api"] : [tool, "all"];

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-bold">{tool === "api" ? "Choose a length" : "Choose a plan"}</span>
      <div role="radiogroup" aria-label="Plan" className="grid gap-2">
        {options.map((p) => (
          <label key={p} className={`flex cursor-pointer items-center gap-3 rounded-sm border p-3.5 transition hover:border-green ${plan === p ? "border-green bg-green-tint" : "border-line bg-white"}`}>
            <input type="radio" name="plan" checked={plan === p} onChange={() => setPlan(p)} className="size-4 accent-green" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{PLANS[p].name}</span>
              <span className="block text-[13px] text-ink-muted">{p === "all" ? "Statistics, Qualitative Studio and Literature Review" : p === "api" ? "Qualitative Studio, API keys and webhooks" : "This tool only"}</span>
            </span>
            <span className="text-right whitespace-nowrap">
              <span className="font-bold">{money(PLANS[p].USD, "USD")}</span><span className="text-[12px] text-ink-muted"> /month</span>
              <span className="block text-[12px] text-ink-muted">≈ {money(ghs(PLANS[p].USD), "GHS")}</span>
            </span>
          </label>
        ))}
      </div>
      <div role="radiogroup" aria-label="Length" className="grid grid-cols-3 gap-2">
        {TERMS.map((t) => (
          <button key={t.months} type="button" role="radio" aria-checked={months === t.months} onClick={() => setMonths(t.months)} className={`flex flex-col items-center rounded-sm border p-2 text-sm font-bold transition hover:border-green ${months === t.months ? "border-green bg-green-tint text-green" : "border-line bg-white"}`}>
            {t.months === 1 ? "1 month" : `${t.months} months`}
            <span className={`mt-0.5 text-[11px] ${t.discount ? "text-amber-deep" : "text-ink-muted"}`}>{t.discount ? `Save ${t.discount * 100}%` : "Monthly"}</span>
          </button>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={() => start(async () => { setErr(null); const r = await buyPlanAction(plan, months, "USD"); if (r?.error) setErr(r.error); })} className="btn-amber">
        {busy ? "Opening Paystack…" : <>Pay {money(price, "USD")} ({money(ghs(price), "GHS")}){full > price && <s className="ml-2 text-[13px] font-normal opacity-70">{money(full, "USD")}</s>}</>}
      </button>
      <p className="text-center text-[12.5px] text-ink-muted">
        Mobile Money or card, through Paystack. Paystack charges in cedis, so you pay {money(ghs(price), "GHS")} at today&apos;s rate (US$1 = GH₵{usdToGhs.toFixed(2)}). Access starts as soon as the payment goes through; your work and downloads are always kept.
      </p>
      {testMode && <p className="rounded-sm bg-amber-tint p-2 text-center text-[12.5px] text-amber-deep">Test mode: no real money is taken.</p>}
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
