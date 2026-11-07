/** Turns written paragraphs (sentences + source ids) into text with citations in the chosen style. Client-safe. */

import { type PaperMeta, type Style, inText } from "./cite";

export type SentenceLike = { text: string; sources: string[] };
export type ParagraphLike = { sentences: SentenceLike[]; edited?: string };

/** Vancouver numbers papers in order of first citation across the whole review. */
export function citationOrder(sections: ParagraphLike[][]): Record<string, number> {
  const order: Record<string, number> = {};
  let n = 0;
  for (const paras of sections) for (const pa of paras) if (!pa.edited) for (const s of pa.sentences) for (const p of s.sources) if (!(p in order)) order[p] = ++n;
  return order;
}

export function cited(papers: Record<string, { meta: PaperMeta; n: number }>, ids: string[], style: Style, order: Record<string, number>) {
  const list = ids.map((id) => papers[id]).filter(Boolean).map((p) => ({ ...p, ref: order[`P${String(p.n).padStart(2, "0")}`] }));
  return inText(list, style);
}

/** A sentence with its citation before the full stop: "… varies by season (Mensah, 2020; Owusu, 2021)." */
export function sentenceText(s: SentenceLike, papers: Record<string, { meta: PaperMeta; n: number }>, style: Style, order: Record<string, number>) {
  const c = s.sources.length ? cited(papers, s.sources, style, order) : "";
  if (!c) return s.text;
  const m = s.text.match(/^(.*?)([.!?]["”’]?)\s*$/s);
  return m ? `${m[1]} ${c}${m[2]}` : `${s.text} ${c}`;
}

export function paragraphText(pa: ParagraphLike, papers: Record<string, { meta: PaperMeta; n: number }>, style: Style, order: Record<string, number>) {
  return pa.edited ?? pa.sentences.map((s) => sentenceText(s, papers, style, order)).join(" ");
}
