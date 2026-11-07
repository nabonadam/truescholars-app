/**
 * Analysis downloads: the report as a Word document (with the theme table and codebook as appendices),
 * the codebook as CSV (NVivo/ATLAS.ti/Excel) and the framework matrix as CSV.
 */

import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { DB } from "@/db";
import { pid } from "@/lib/qual";
import { listResponses, type StudyRow } from "./qual";
import { getAnalysis } from "./qualAnalysis";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** **bold** and *italic* inside a line of Markdown, as Word runs. */
function runs(text: string, base: { size?: number; bold?: boolean } = {}): TextRun[] {
  const out: TextRun[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**")) out.push(new TextRun({ text: part.slice(2, -2), bold: true, size: base.size }));
    else if (part.startsWith("*") && part.length > 2) out.push(new TextRun({ text: part.slice(1, -1), italics: true, size: base.size, bold: base.bold }));
    else out.push(new TextRun({ text: part, size: base.size, bold: base.bold }));
  }
  return out;
}

/** The report's Markdown as Word paragraphs: headings, bullets, block quotes and body text. */
export function markdownParagraphs(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(new Paragraph({ children: runs(para.join(" ")), spacing: { after: 160, line: 360 } }));
    para = [];
  };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][h[1].length - 1] ?? HeadingLevel.HEADING_3;
      out.push(new Paragraph({ heading: level, children: [new TextRun({ text: h[2].replace(/\*\*/g, "") })], spacing: { before: 240, after: 120 } }));
    } else if (/^\s*[-*]\s+/.test(line)) {
      flush();
      out.push(new Paragraph({ children: runs(line.replace(/^\s*[-*]\s+/, "")), bullet: { level: 0 }, spacing: { after: 80 } }));
    } else if (/^>\s?/.test(line)) {
      flush();
      out.push(new Paragraph({ children: runs(line.replace(/^>\s?/, "")), indent: { left: 720, right: 720 }, spacing: { after: 160 } }));
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };

function table(head: string[], rows: string[][], widths: number[]) {
  const mk = (text: string, i: number, header: boolean) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      borders,
      shading: header ? { type: ShadingType.CLEAR, fill: "E8EFEA", color: "auto" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, bold: header, size: 18 })] })],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => mk(h, i, true)) }), ...rows.map((r) => new TableRow({ children: r.map((c, i) => mk(c, i, false)) }))],
  });
}

export async function analysisExport(db: DB, s: StudyRow, kind: string): Promise<{ body: BodyInit; type: string; name: string } | null> {
  const { researchQuestion, state } = await getAnalysis(db, s.id);
  const rs = await listResponses(db, s.ownerId, s.id);
  const pids = Object.fromEntries(rs.map((r) => [r.id, pid(r.n)]));
  const book = state.codebook ?? [];
  const themes = state.themes ?? [];
  const themeOf = (codeId: string) => themes.find((t) => t.codes.includes(codeId))?.name ?? "";

  if (kind === "codebook") {
    if (!book.length) return null;
    const rows: unknown[][] = [["Code ID", "Code", "Definition", "Theme", "Participants", "Number of participants", "Example quotes"]];
    for (const k of book) rows.push([k.id, k.label, k.definition, themeOf(k.id), k.rids.map((r) => pids[r] ?? "").join("; "), k.rids.length, k.quotes.map((q) => `${pids[q.rid] ?? ""}: "${q.text}"`).join(" | ")]);
    return { body: csv(rows), type: "text/csv; charset=utf-8", name: "codebook.csv" };
  }

  if (kind === "matrix") {
    if (!state.matrix || !themes.length) return null;
    const rows: unknown[][] = [["Participant", ...themes.map((t) => t.name)]];
    for (const [rid, row] of Object.entries(state.matrix).sort(([a], [b]) => (pids[a] ?? "").localeCompare(pids[b] ?? ""))) rows.push([pids[rid] ?? rid, ...themes.map((t) => row[t.id] ?? "")]);
    return { body: csv(rows), type: "text/csv; charset=utf-8", name: "framework-matrix.csv" };
  }

  if (kind === "report") {
    if (!state.report && !themes.length) return null;
    const children: (Paragraph | Table)[] = [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: s.title })], spacing: { after: 120 } }),
      new Paragraph({ children: [new TextRun({ text: "Thematic analysis report", italics: true, color: "555555" })], spacing: { after: 240 } }),
    ];
    if (researchQuestion) children.push(new Paragraph({ children: [new TextRun({ text: "Research question: ", bold: true }), new TextRun({ text: researchQuestion })], spacing: { after: 240 } }));
    if (state.report) children.push(...markdownParagraphs(state.report));
    if (themes.length) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Appendix A. Themes and codes" })], pageBreakBefore: true, spacing: { after: 160 } }));
      children.push(
        table(
          ["Theme", "Central concept", "Codes"],
          themes.map((t) => [t.name, t.definition, t.codes.map((c) => book.find((k) => k.id === c)?.label ?? c).join("; ")]),
          [24, 46, 30],
        ),
      );
    }
    if (book.length) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Appendix B. Codebook" })], pageBreakBefore: true, spacing: { after: 160 } }));
      children.push(table(["Code", "Definition", "Participants", "Example"], book.map((k) => [k.label, k.definition, String(k.rids.length), k.quotes[0] ? `${pids[k.quotes[0].rid] ?? ""}: "${k.quotes[0].text}"` : ""]), [20, 38, 10, 32]));
    }
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 360 },
        children: [new TextRun({ text: "Prepared with Qualitative Studio, The True Scholars. AI-assisted coding was reviewed by the researcher; check every quote and interpretation before publication.", italics: true, size: 16, color: "777777" })],
      }),
    );
    const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
    });
    const buf = await Packer.toBuffer(doc);
    return { body: new Uint8Array(buf), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "thematic-analysis.docx" };
  }
  return null;
}
