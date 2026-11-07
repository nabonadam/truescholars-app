"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CodebookEntry, Theme } from "@/server/qualAnalysis";
import { Icon } from "../Icons";

export type WordCount = { word: string; count: number; people: number };

const FONT = "'DM Sans', Arial, Helvetica, sans-serif";
const GREENS = ["#0f3d2a", "#1a6b52", "#2f7d5f", "#b5651d", "#7a4b1c"];

// ───────── downloads ─────────

const fileName = (base: string, ext: string) => `${base.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 60) || "figure"}.${ext}`;

function svgText(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("font-family", FONT);
  const [, , w, h] = (svg.getAttribute("viewBox") ?? "0 0 1000 600").split(" ").map(Number);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("class");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);
  return { text: new XMLSerializer().serializeToString(clone), w, h };
}

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function downloadSvg(svg: SVGSVGElement, base: string) {
  save(new Blob([svgText(svg).text], { type: "image/svg+xml;charset=utf-8" }), fileName(base, "svg"));
}

/** A high-resolution PNG (3× the drawing size), good for Word, PowerPoint and print. */
export async function downloadPng(svg: SVGSVGElement, base: string) {
  const { text, w, h } = svgText(svg);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("render"));
    img.src = url;
  });
  const scale = Math.max(1, Math.min(3, 3600 / w));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  canvas.toBlob((b) => b && save(b, fileName(base, "png")), "image/png");
}

/** PNG and SVG buttons for the figure inside `box`. */
export function DownloadButtons({ box, name }: { box: React.RefObject<HTMLElement | null>; name: string }) {
  const get = () => box.current?.querySelector("svg[data-figure]") as SVGSVGElement | null;
  const cls = "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-green/30 bg-white px-3 text-[12.5px] font-bold text-green hover:border-green";
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={cls} onClick={() => { const s = get(); if (s) downloadPng(s, name).catch(() => alert("Your browser couldn't make the image. Try the SVG download.")); }}>
        <Icon name="download" size={13} /> PNG image
      </button>
      <button type="button" className={cls} onClick={() => { const s = get(); if (s) downloadSvg(s, name); }} title="Scalable vector: stays sharp at any size">
        <Icon name="download" size={13} /> SVG (sharp at any size)
      </button>
    </div>
  );
}

function Figure({ title, note, name, children }: { title: string; note?: string; name: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold">{title}</h3>
          {note && <p className="text-[13px] text-ink-muted">{note}</p>}
        </div>
        <DownloadButtons box={box} name={name} />
      </div>
      <div ref={box} className="overflow-x-auto">{children}</div>
    </div>
  );
}

// ───────── word cloud ─────────

type Placed = { word: string; count: number; x: number; y: number; size: number; w: number; h: number; colour: string };

function layout(words: WordCount[], W: number, H: number): Placed[] {
  if (!words.length) return [];
  const ctx = document.createElement("canvas").getContext("2d")!;
  const max = words[0].count, min = words[words.length - 1].count;
  const placed: Placed[] = [];
  const hits = (a: Placed) => a.x - a.w / 2 < 6 || a.x + a.w / 2 > W - 6 || a.y - a.h / 2 < 6 || a.y + a.h / 2 > H - 6 || placed.some((b) => Math.abs(a.x - b.x) * 2 < a.w + b.w + 6 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 2);
  words.forEach((wd, i) => {
    const t = max === min ? 1 : Math.pow((wd.count - min) / (max - min), 0.65);
    const size = Math.round(15 + t * 63);
    ctx.font = `700 ${size}px ${FONT}`;
    const w = ctx.measureText(wd.word).width;
    const h = size * 0.92;
    const colour = GREENS[i < 3 ? 0 : i < 10 ? 1 : i % 5 === 0 ? 3 : i % 3 === 0 ? 4 : 2];
    // Archimedean spiral outwards from the centre, stretched to the canvas shape
    for (let s = 0; s < 2400; s++) {
      const a = s * 0.21;
      const r = 2.2 * a;
      const p = { word: wd.word, count: wd.count, x: W / 2 + r * Math.cos(a) * (W / H), y: H / 2 + r * Math.sin(a), size, w, h, colour };
      if (!hits(p)) {
        placed.push(p);
        break;
      }
    }
  });
  return placed;
}

function WordCloud({ words, title }: { words: WordCount[]; title: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [howMany, setHowMany] = useState(60);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const shown = useMemo(() => words.filter((w) => !hidden.has(w.word)).slice(0, howMany), [words, hidden, howMany]);
  const W = 1100, H = 620;
  useEffect(() => {
    let alive = true;
    (document.fonts?.ready ?? Promise.resolve()).then(() => alive && setPlaced(layout(shown, W, H)));
    return () => {
      alive = false;
    };
  }, [shown]);
  if (!words.length) return <div className="card p-6 text-sm text-ink-muted">There aren&apos;t enough words in the answers yet for a word cloud.</div>;
  return (
    <Figure title="Word cloud" note={`The ${shown.length} most frequent words in participants’ answers; bigger means more often. Click a word to leave it out.`} name={`${title} word cloud`}>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex items-center gap-2 text-ink-muted">
          Words
          <select className="rounded-[8px] border border-line bg-white px-2 py-1" value={howMany} onChange={(e) => setHowMany(Number(e.target.value))}>
            {[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {hidden.size > 0 && (
          <span className="flex flex-wrap items-center gap-1.5 text-ink-muted">
            Left out:
            {[...hidden].map((w) => (
              <button key={w} type="button" onClick={() => setHidden((h) => new Set([...h].filter((x) => x !== w)))} className="rounded-full bg-parchment px-2 py-0.5 font-bold hover:text-ink" title="Put it back">{w} ×</button>
            ))}
          </span>
        )}
      </div>
      <svg data-figure viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label="Word cloud" fontFamily={FONT}>
        {placed.map((p) => (
          <text
            key={p.word}
            x={p.x}
            y={p.y + p.size * 0.33}
            textAnchor="middle"
            fontSize={p.size}
            fontWeight={700}
            fill={p.colour}
            className="cursor-pointer hover:opacity-60"
            onClick={() => setHidden((h) => new Set([...h, p.word]))}
          >
            <title>{`${p.word}: ${p.count} times`}</title>
            {p.word}
          </text>
        ))}
      </svg>
    </Figure>
  );
}

// ───────── bar charts ─────────

export function BarChart({ rows, total, unit, colour, label }: { rows: { label: string; value: number }[]; total: number; unit: string; colour: string; label: string }) {
  const W = 1000;
  const left = 330, right = 90, row = 34, top = 14;
  const H = top * 2 + rows.length * row + 30;
  const max = Math.max(total, ...rows.map((r) => r.value), 1);
  const x = (v: number) => left + ((W - left - right) * v) / max;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max)).filter((v, i, a) => a.indexOf(v) === i);
  const cut = (t: string) => (t.length > 46 ? t.slice(0, 45).trimEnd() + "…" : t);
  return (
    <svg data-figure viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label={label} fontFamily={FONT}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={H - 26} stroke="#e7e2d6" strokeWidth={1} />
          <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={12} fill="#6b7d72">{t}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = top + i * row;
        return (
          <g key={r.label}>
            <text x={left - 12} y={y + row / 2 + 4.5} textAnchor="end" fontSize={13.5} fill="#13261c">{cut(r.label)}<title>{r.label}</title></text>
            <rect x={left} y={y + 7} width={Math.max(2, x(r.value) - left)} height={row - 14} rx={4} fill={colour} />
            <text x={x(r.value) + 8} y={y + row / 2 + 4.5} fontSize={13} fontWeight={700} fill="#13261c">{r.value}</text>
          </g>
        );
      })}
      <text x={W - right + 70} y={H - 8} textAnchor="end" fontSize={12} fill="#6b7d72">{unit}</text>
    </svg>
  );
}

// ───────── the Visuals tab ─────────

export function Visuals({ words, book, themes, total, title }: { words: WordCount[]; book: CodebookEntry[]; themes: Theme[]; total: number; title: string }) {
  const byId = Object.fromEntries(book.map((k) => [k.id, k]));
  const codes = [...book].sort((a, b) => b.rids.length - a.rids.length).slice(0, 15).map((k) => ({ label: k.label, value: k.rids.length }));
  const themeRows = themes
    .map((t) => ({ label: t.name, value: new Set(t.codes.flatMap((c) => byId[c]?.rids ?? [])).size }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="space-y-5">
      <WordCloud words={words} title={title} />
      {themeRows.length > 0 && (
        <Figure title="Themes across participants" note={`How many of the ${total} participants contributed to each theme.`} name={`${title} theme prevalence`}>
          <BarChart rows={themeRows} total={total} unit="participants" colour="#0f3d2a" label="Theme prevalence" />
        </Figure>
      )}
      {codes.length > 0 && (
        <Figure title="Most common codes" note={`The ${codes.length} codes found in the most participants’ answers.`} name={`${title} code frequency`}>
          <BarChart rows={codes} total={total} unit="participants" colour="#b5651d" label="Code frequency" />
        </Figure>
      )}
      {!book.length && <p className="text-sm text-ink-muted">Charts of codes and themes appear here once you run the coding and theme steps.</p>}
    </div>
  );
}
