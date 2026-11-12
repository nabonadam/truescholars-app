"use client";

import { useEffect, useState, useTransition } from "react";
import { buyPlanAction } from "@/app/actions/plans";
import { type Currency, type Months, PLANS, type PlanId, TERMS, chargeGhsMinor, currencyForTimeZone, money, planPrice } from "@/lib/plans";

const KEY = "ts-currency";

/** Choose this tool or all three, a length and a currency, and pay through Paystack. */
export function PlanPicker({ tool, testMode, initialCurrency, usdToGhs }: { tool: Exclude<PlanId, "all">; testMode: boolean; initialCurrency: Currency | null; usdToGhs: number }) {
  const [plan, setPlan] = useState<PlanId>(tool);
  const [months, setMonths] = useState<Months>(1);
  const [currency, setCurrency] = useState<Currency>(initialCurrency ?? "GHS");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // a choice they made before wins; otherwise their country (from the server), otherwise their time zone
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    if (saved === "GHS" || saved === "USD") setCurrency(saved);
    else if (!initialCurrency) setCurrency(currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "GHS");
  }, [initialCurrency]);
  const choose = (c: Currency) => {
    setCurrency(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {}
  };

  const price = planPrice(plan, months, currency);
  const full = PLANS[plan][currency] * months;
  const ghs = chargeGhsMinor(price, currency, usdToGhs) / 100;
  const options: PlanId[] = tool === "api" ? ["api"] : [tool, "all"];
  const seg = (on: boolean) => `rounded-full px-3 py-1 text-[13px] font-bold transition ${on ? "bg-green text-white" : "text-ink-muted hover:text-ink"}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{tool === "api" ? "Choose a length" : "Choose a plan"}</span>
        <div role="radiogroup" aria-label="Currency" className="inline-flex rounded-full border border-line bg-white p-0.5">
          <button type="button" role="radio" aria-checked={currency === "GHS"} onClick={() => choose("GHS")} className={seg(currency === "GHS")}>GH₵</button>
          <button type="button" role="radio" aria-checked={currency === "USD"} onClick={() => choose("USD")} className={seg(currency === "USD")}>US$</button>
        </div>
      </div>
      <div role="radiogroup" aria-label="Plan" className="grid gap-2">
        {options.map((p) => (
          <label key={p} className={`flex cursor-pointer items-center gap-3 rounded-sm border p-3.5 transition hover:border-green ${plan === p ? "border-green bg-green-tint" : "border-line bg-white"}`}>
            <input type="radio" name="plan" checked={plan === p} onChange={() => setPlan(p)} className="size-4 accent-green" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{PLANS[p].name}</span>
              <span className="block text-[13px] text-ink-muted">{p === "all" ? "Statistics, Qualitative Studio and Literature Review" : p === "api" ? "Qualitative Studio, API keys and webhooks" : "This tool only"}</span>
            </span>
            <span className="text-right font-bold whitespace-nowrap">{money(PLANS[p][currency], currency)}<span className="text-[12px] font-normal text-ink-muted"> /month</span></span>
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
      <button type="button" disabled={busy} onClick={() => start(async () => { setErr(null); const r = await buyPlanAction(plan, months, currency); if (r?.error) setErr(r.error); })} className="btn-amber">
        {busy ? "Opening Paystack…" : <>Pay {money(price, currency)}{full > price && <s className="ml-2 text-[13px] font-normal opacity-70">{money(full, currency)}</s>}</>}
      </button>
      <p className="text-center text-[12.5px] text-ink-muted">
        {currency === "USD"
          ? `Charged by Paystack as ${money(ghs, "GHS")} at today's rate; your bank converts it to your currency.`
          : "Mobile Money or card, through Paystack."}{" "}
        Access starts as soon as the payment goes through; your work and downloads are always kept.
      </p>
      {testMode && <p className="rounded-sm bg-amber-tint p-2 text-center text-[12.5px] text-amber-deep">Test mode: no real money is taken.</p>}
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
