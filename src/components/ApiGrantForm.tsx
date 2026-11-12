"use client";

import { useState, useTransition } from "react";
import { grantApiAction, type ApiState } from "@/app/actions/api";

export function ApiGrantForm() {
  const [s, setS] = useState<ApiState | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="card grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto] sm:items-end"
      action={(f) => start(async () => setS(await grantApiAction(String(f.get("email") ?? ""), Number(f.get("days") ?? 0), String(f.get("note") ?? ""))))}
    >
      <label className="flex flex-col gap-1 text-sm font-bold">Email<input name="email" type="email" required className="field font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-bold">Days<input name="days" type="number" min={1} max={3650} defaultValue={30} required className="field font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-bold">Note<input name="note" placeholder="e.g. Invoice 2026-014" className="field font-normal" /></label>
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Switch on"}</button>
      {s && <p className={`text-sm sm:col-span-4 ${s.error ? "text-red-700" : "text-green"}`}>{s.error ?? s.ok}</p>}
    </form>
  );
}
