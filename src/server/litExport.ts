/**
 * Literature Review downloads: the review (Word, with citations and a reference list in the chosen style),
 * an annotated bibliography (Word), the papers spreadsheet and synthesis matrix (CSV, opens in Excel),
 * and RIS / BibTeX for Zotero, Mendeley and EndNote.
 */

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { DB } from "@/db";
import { STYLES, type PaperMeta, type Style, bibKey, bibtex, isStyle, pno, reference, ris, sortForReferences } from "@/lib/cite";
import { citationOrder, paragraphText } from "@/lib/litText";
import { type ReviewRow, getAnalysisState, listPapers } from "./lit";
import type { Card, WriteState } from "./litAnalysis";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** "*Journal*" → italic run, for reference entries. */
const runs = (text: string, size?: number) => text.split(/(\*[^*]+\*)/g).filter(Boolean).map((t) => (t.startsWith("*") ? new TextRun({ text: t.slice(1, -1), italics: true, size }) : new TextRun({ text: t, size })));

async function docx(children: Paragraph[]) {
  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

const para = (text: string, opts: { indent?: boolean } = {}) => new Paragraph({ children: runs(text), spacing: { after: 200, line: 480 }, indent: opts.indent ? { firstLine: 720 } : undefined });
const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1, pageBreakBefore = false) =>
  new Paragraph({ heading: level, pageBreakBefore, children: [new TextRun({ text })], spacing: { before: 240, after: 160 } });

export async function litExport(db: DB, r: ReviewRow, kind: string, styleParam?: string | null): Promise<{ body: BodyInit; type: string; name: string } | null> {
  const style: Style = styleParam && isStyle(styleParam) ? styleParam : isStyle(r.style) ? (r.style as Style) : "apa";
  const papers = await listPapers(db, r.id, { status: "ACCEPTED" });
  const byId = Object.fromEntries(papers.map((p) => [pno(p.n), { meta: p.meta as PaperMeta, n: p.n }]));
  const state = await getAnalysisState<WriteState>(db, r.id);

  if (kind === "spreadsheet") {
    const all = await listPapers(db, r.id);
    const rows: unknown[][] = [["Paper", "Authors", "Year", "Title", "Journal / source", "DOI link", "Summary", "Relevance to the research question", "Read and verified by", "Checked with Crossref", "Retracted", "Status", "File"]];
    for (const p of all) {
      const m = p.meta as PaperMeta;
      const v = p.verify;
      const crossref = v?.found ? (v.mismatches?.length ? `Found; differs: ${v.mismatches.join("; ")}` : "Yes, matches") : v?.checked ? "No record found" : "Not checked";
      rows.push([pno(p.n), (m.authors ?? []).map((a) => `${a.family}${a.given ? `, ${a.given}` : ""}`).join("; "), m.year ?? "", m.title ?? "", m.journal ?? "", m.doi ? `https://doi.org/${m.doi}` : "", p.summary ?? "", p.note ?? "", p.source === "EXPERT" ? (p.confirmedAt ? "Expert (read in full, details entered by hand)" : "Expert (not yet recorded)") : "Client", crossref, v?.retracted ? "YES: retracted" : "", p.status === "ACCEPTED" ? "Accepted" : p.status === "REJECTED" ? `Rejected: ${p.rejectReason ?? ""}` : "Awaiting review", p.fileName ?? "(no PDF)"]);
    }
    return { body: csv(rows), type: "text/csv; charset=utf-8", name: "papers.csv" };
  }

  if (kind === "ris" || kind === "bibtex") {
    if (!papers.length) return null;
    const text = kind === "ris" ? papers.map((p) => ris(p.meta as PaperMeta)).join("\r\n\r\n") : papers.map((p) => bibtex(p.meta as PaperMeta, bibKey(p.meta as PaperMeta, p.n))).join("\n\n");
    return { body: text + "\n", type: kind === "ris" ? "application/x-research-info-systems" : "application/x-bibtex", name: kind === "ris" ? "references.ris" : "references.bib" };
  }

  if (kind === "matrix") {
    const syn = state.synthesis;
    if (!syn) return null;
    const rows: unknown[][] = [["Paper", "Citation", ...syn.concepts.map((c) => c.name)]];
    for (const p of papers) {
      const id = pno(p.n);
      rows.push([id, reference(p.meta as PaperMeta, style), ...syn.concepts.map((c) => syn.matrix[id]?.[c.id] ?? "")]);
    }
    return { body: csv(rows), type: "text/csv; charset=utf-8", name: "synthesis-matrix.csv" };
  }

  if (kind === "bibliography") {
    const read = papers.filter((p) => p.card);
    if (!read.length) return null;
    const children: Paragraph[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Annotated bibliography" })] }), new Paragraph({ children: [new TextRun({ text: r.title, italics: true })], spacing: { after: 300 } })];
    for (const p of sortForReferences(read, style)) {
      const c = p.card as Card;
      children.push(new Paragraph({ children: runs(reference(p.meta as PaperMeta, style, p.n)), spacing: { before: 280, after: 120 }, indent: { left: 720, hanging: 720 } }));
      for (const [label, text] of [["Introduction", c.summary.introduction], ["Methods", c.summary.methods], ["Findings", c.summary.findings], ["Conclusions", c.summary.conclusions]] as const) {
        if (text) children.push(new Paragraph({ children: [new TextRun({ text: `${label}. `, bold: true }), new TextRun({ text })], spacing: { after: 100 }, indent: { left: 720 } }));
      }
      if (c.keyTerms.length) children.push(new Paragraph({ children: [new TextRun({ text: "Key terms. ", bold: true }), new TextRun({ text: c.keyTerms.map((k) => `${k.term}: ${k.text}`).join("; ") })], spacing: { after: 100 }, indent: { left: 720 } }));
      if (c.keywords.length) children.push(new Paragraph({ children: [new TextRun({ text: "Keywords. ", bold: true }), new TextRun({ text: c.keywords.join(", ") })], spacing: { after: 100 }, indent: { left: 720 } }));
      if (c.basis === "abstract") children.push(new Paragraph({ children: [new TextRun({ text: "Read from the abstract only.", italics: true, color: "777777" })], indent: { left: 720 } }));
    }
    return { body: await docx(children), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "annotated-bibliography.docx" };
  }

  if (kind === "review") {
    const outline = state.outline ?? [];
    const written = outline.filter((s) => state.sections?.[s.id]?.length);
    if (!written.length) return null;
    const order = citationOrder(written.map((s) => state.sections![s.id]));
    const children: Paragraph[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: r.title })] }), new Paragraph({ children: [new TextRun({ text: "Research question: ", bold: true }), new TextRun({ text: r.researchQuestion })], spacing: { after: 300 } })];
    for (const s of written) {
      children.push(heading(s.heading));
      for (const pa of state.sections![s.id]) children.push(para(paragraphText(pa, byId, style, order), { indent: true }));
    }
    const used = new Set(Object.keys(order));
    const refs = style === "vancouver" ? Object.entries(order).sort((a, b) => a[1] - b[1]).map(([id]) => papers.find((p) => pno(p.n) === id)!).filter(Boolean) : sortForReferences(papers.filter((p) => used.has(pno(p.n))), style);
    children.push(heading(style === "mla" ? "Works Cited" : "References", HeadingLevel.HEADING_1, true));
    refs.forEach((p) => children.push(new Paragraph({ children: runs(reference(p.meta as PaperMeta, style, order[pno(p.n)])), spacing: { after: 160, line: 480 }, indent: { left: 720, hanging: 720 } })));
    children.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: `Citation style: ${STYLES[style]}. Prepared with the Literature Review tool, The True Scholars: sentences were checked against passages in the papers. Read and revise before submitting, and follow your institution's rules on AI assistance.`, italics: true, size: 18, color: "777777" })] }));
    return { body: await docx(children), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "literature-review.docx" };
  }
  return null;
}
