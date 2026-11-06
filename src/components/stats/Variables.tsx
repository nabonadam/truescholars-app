"use client";

import { useState } from "react";
import type { VarMeta } from "@/server/statsAi";
import { Icon } from "../Icons";

/** A tiny picture of each variable: a histogram for continuous, level shares for categorical. */
function Glyph({ v }: { v: VarMeta }) {
  if (v.kind === "continuous" && v.hist?.length) {
    const max = Math.max(...v.hist, 1);
    const w = 46 / v.hist.length;
    return (
      <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden className="flex-none">
        {v.hist.map((c, i) => {
          const h = Math.max(1, (c / max) * 16);
          return <rect key={i} x={1 + i * w} y={17 - h} width={Math.max(w - 0.8, 1)} height={h} rx="0.6" className="fill-green/70" />;
        })}
      </svg>
    );
  }
  if (v.kind === "categorical" && v.levels?.length) {
    const total = v.levels.reduce((a, l) => a + l.n, 0) || 1;
    let x = 0;
    const tones = ["#0f3d2a", "#f4a261", "#5d8a72", "#e8c49a", "#2f6a4f", "#c47a3d", "#9db8a8", "#8a4b16"];
    return (
      <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden className="flex-none">
        {v.levels.map((l, i) => {
          const w = (l.n / total) * 46;
          const r = <rect key={i} x={1 + x} y="5" width={Math.max(w - 0.6, 0.6)} height="8" fill={tones[i % tones.length]} />;
          x += w;
          return r;
        })}
      </svg>
    );
  }
  return <span className="grid h-[18px] w-12 flex-none place-items-center font-mono text-[11px] text-ink-muted">Aa</span>;
}

const fmt = (n?: number) => (n === undefined ? "" : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : Number(n.toPrecision(4)).toString());

export function VariablesPanel({ vars, nObs, onInsert, onCommand }: { vars: VarMeta[]; nObs: number; onInsert: (name: string) => void; onCommand: (cmd: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const shown = q ? vars.filter((v) => (v.name + " " + v.label).toLowerCase().includes(q.toLowerCase())) : vars;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold">Variables</h2>
          <span className="text-xs text-ink-muted">{vars.length} · {nObs.toLocaleString()} obs</span>
        </div>
        <label className="mt-2.5 flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 focus-within:border-green">
          <Icon name="search" size={15} className="text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter variables" className="w-full bg-transparent text-sm outline-none" />
        </label>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 py-2">
        {shown.map((v) => {
          const isOpen = open === v.name;
          return (
            <li key={v.name} className={`rounded-sm ${isOpen ? "bg-white shadow-[0_1px_0_#ece3d3]" : ""}`}>
              <div className="group flex items-center gap-2.5 rounded-sm px-2 py-2 hover:bg-white">
                <button type="button" onClick={() => setOpen(isOpen ? null : v.name)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <Glyph v={v} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px] font-bold text-ink">{v.name}</span>
                    <span className="block truncate text-xs text-ink-muted">{v.label || v.type}</span>
                  </span>
                  {v.missing > 0 && <span className="rounded-full bg-amber-tint px-1.5 text-[10.5px] font-bold text-amber-deep" title={`${v.missing} missing`}>{v.missing}</span>}
                </button>
                <button type="button" onClick={() => onInsert(v.name)} title={`Insert ${v.name}`} className="grid h-7 w-7 flex-none place-items-center rounded-full text-green opacity-60 hover:bg-green-tint hover:opacity-100 group-hover:opacity-100">
                  <span className="text-lg leading-none">+</span>
                </button>
              </div>
              {isOpen && (
                <div className="px-3 pb-3 text-xs text-ink-muted">
                  <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{v.type}</span>
                    <span>{v.nonmissing.toLocaleString()} valid</span>
                    {v.missing > 0 && <span>{v.missing} missing</span>}
                    <span>{v.unique} distinct</span>
                  </div>
                  {v.kind === "continuous" && (
                    <div className="mb-2 font-mono text-[11.5px] text-ink">
                      min {fmt(v.min)} · mean {fmt(v.mean)} · max {fmt(v.max)}
                    </div>
                  )}
                  {v.levels && (
                    <ul className="mb-2 space-y-0.5">
                      {v.levels.slice(0, 8).map((l) => (
                        <li key={l.value} className="flex justify-between gap-2 text-ink">
                          <span className="truncate"><span className="font-mono text-ink-muted">{l.value}</span> {l.label !== l.value && l.label}</span>
                          <span className="tabular-nums text-ink-muted">{l.n}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {v.kind === "continuous" && <Chip onClick={() => onCommand(`summarize ${v.name}, detail`)}>summarize</Chip>}
                    {v.kind === "categorical" && <Chip onClick={() => onCommand(`tabulate ${v.name}`)}>tabulate</Chip>}
                    <Chip onClick={() => onCommand(`codebook ${v.name}`)}>codebook</Chip>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {!shown.length && <li className="px-3 py-6 text-center text-sm text-ink-muted">No variable matches “{q}”.</li>}
      </ul>
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border border-green/25 bg-green-tint px-2.5 py-0.5 font-mono text-[11.5px] font-medium text-green hover:border-green">
      {children}
    </button>
  );
}
