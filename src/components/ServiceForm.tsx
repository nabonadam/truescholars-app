"use client";

import { useActionState } from "react";
import { saveServiceAction, type FormState } from "@/app/actions/services";

type Tier = { name: "BASIC" | "STANDARD" | "PRO"; priceMinor: number; deliveryDays: number; revisions: number; includes: string[] };
export type ServiceFormValues = {
  id?: string;
  title?: string;
  categoryId?: string;
  description?: string;
  requirements?: string[];
  tiers?: Tier[];
};

const TIERS = [
  { name: "BASIC", label: "Basic", hint: "Required" },
  { name: "STANDARD", label: "Standard", hint: "Optional" },
  { name: "PRO", label: "Pro", hint: "Optional" },
] as const;

export function ServiceForm({ categories, initial = {} }: { categories: { id: string; name: string }[]; initial?: ServiceFormValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveServiceAction, undefined);
  const tier = (n: Tier["name"]) => initial.tiers?.find((t) => t.name === n);

  return (
    <form action={action} className="flex flex-col gap-8">
      {initial.id && <input type="hidden" name="serviceId" value={initial.id} />}

      <div className="card flex flex-col gap-5">
        <h2 className="text-xl font-bold">Overview</h2>
        <div>
          <label htmlFor="title" className="label">Service title</label>
          <input id="title" name="title" required minLength={12} maxLength={90} defaultValue={initial.title} className="field" placeholder="I will run and interpret regression analysis in Stata" />
        </div>
        <div>
          <label htmlFor="categoryId" className="label">Category</label>
          <select id="categoryId" name="categoryId" required defaultValue={initial.categoryId ?? ""} className="field">
            <option value="" disabled>Choose a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="description" className="label">Description</label>
          <textarea id="description" name="description" required minLength={120} maxLength={4000} rows={7} defaultValue={initial.description} className="field" placeholder="What you do, how you work, what the client receives, and what you need from them." />
        </div>
      </div>

      <div className="card flex flex-col gap-5">
        <div>
          <h2 className="text-xl font-bold">Packages</h2>
          <p className="text-sm text-ink-muted">Prices in GH₵. Fill in Basic; add Standard and Pro if you offer them. Higher packages must cost more.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {TIERS.map(({ name, label, hint }) => {
            const t = tier(name);
            return (
              <fieldset key={name} className="flex flex-col gap-3 rounded-md border border-line p-4">
                <legend className="px-1 font-display text-lg font-bold">
                  {label} <span className="text-xs font-normal text-ink-muted">({hint})</span>
                </legend>
                <div>
                  <label htmlFor={`${name}_price`} className="label">Price (GH₵)</label>
                  <input id={`${name}_price`} name={`${name}_price`} type="number" min={10} step="1" required={name === "BASIC"} defaultValue={t ? t.priceMinor / 100 : undefined} className="field" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`${name}_days`} className="label">Delivery (days)</label>
                    <input id={`${name}_days`} name={`${name}_days`} type="number" min={1} max={90} defaultValue={t?.deliveryDays ?? (name === "BASIC" ? 5 : name === "STANDARD" ? 7 : 10)} className="field" />
                  </div>
                  <div>
                    <label htmlFor={`${name}_revisions`} className="label">Revisions</label>
                    <input id={`${name}_revisions`} name={`${name}_revisions`} type="number" min={0} max={10} defaultValue={t?.revisions ?? (name === "BASIC" ? 1 : name === "STANDARD" ? 2 : 3)} className="field" />
                  </div>
                </div>
                <div>
                  <label htmlFor={`${name}_includes`} className="label">What&apos;s included (one per line)</label>
                  <textarea id={`${name}_includes`} name={`${name}_includes`} rows={4} defaultValue={t?.includes.join("\n")} className="field" placeholder={"Up to 2 models\nOutput tables\nShort interpretation"} />
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>

      <div className="card flex flex-col gap-4">
        <h2 className="text-xl font-bold">Questions for the client</h2>
        <div>
          <label htmlFor="requirements" className="label">What do you need to start? (one question per line, up to 6)</label>
          <textarea id="requirements" name="requirements" rows={4} defaultValue={initial.requirements?.join("\n")} className="field" placeholder={"What is your research question?\nWhich software do you need the analysis in?\nPlease describe your dataset (size, variables)."} />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="integrity" required className="mt-1 size-4 accent-green" />
          <span>
            This service supports the client&apos;s own research and does not complete graded coursework or exams for anyone, in line with
            The True Scholars academic integrity policy.
          </span>
        </label>
      </div>

      {state?.error && <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">{state.error}</p>}
      <button className="btn-primary self-start" disabled={pending}>{pending ? "Saving…" : initial.id ? "Save changes" : "Publish service"}</button>
    </form>
  );
}
