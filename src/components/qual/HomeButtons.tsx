"use client";

import { useActionState, useTransition } from "react";
import { newStudyAction, qualUpgradeAction } from "@/app/actions/qual";
import { Icon } from "../Icons";

export function TemplatePicker({ templates }: { templates: { key: string; title: string; blurb: string }[] }) {
  const [pending, start] = useTransition();
  const [state, run] = useActionState(async (_: unknown, key: string) => newStudyAction(key), undefined);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={pending}
            onClick={() => start(() => run(t.key))}
            className="group flex flex-col items-start gap-1 rounded-sm border border-line bg-white p-4 text-left transition hover:border-green disabled:opacity-60"
          >
            <span className="flex items-center gap-2 font-bold text-ink">
              <Icon name={t.key === "blank" ? "pen" : "clipboard"} size={16} className="text-green" /> {t.title}
            </span>
            <span className="text-[13.5px] text-ink-muted">{t.blurb}</span>
          </button>
        ))}
      </div>
      <button type="button" disabled={pending} onClick={() => start(() => run("sample"))} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-green hover:underline disabled:opacity-60">
        <Icon name="spark" size={15} /> {pending ? "Creating…" : "No data yet? Open a sample study with eight answered interviews"}
      </button>
      {state?.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </div>
  );
}

export function QualUpgradeButton({ requested }: { requested: boolean }) {
  const [state, action, pending] = useActionState(async () => qualUpgradeAction(), undefined);
  if (requested || state?.ok) {
    return (
      <div className="flex items-start gap-3 rounded-sm bg-green-tint p-4 text-green">
        <Icon name="check" size={20} className="mt-0.5 flex-none" />
        <p className="text-[15px]"><b>Request sent.</b> We&apos;ll switch your access on and send payment details to your email, usually within a day.</p>
      </div>
    );
  }
  return (
    <form action={action}>
      <button disabled={pending} className="btn-amber w-full sm:w-auto">{pending ? "Sending…" : "Request upgrade"}</button>
    </form>
  );
}
