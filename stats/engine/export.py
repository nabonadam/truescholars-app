"""Results out of the app: APA tables to Word and Excel, the working dataset to .dta / .csv."""

from __future__ import annotations

import io
import os
import tempfile

from .data import Dataset

FONT = "Times New Roman"


def docx_bytes(title: str, tables: list[dict]) -> bytes:
    """APA 7 tables: bold table number, italic title, horizontal rules only, note below."""
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt

    doc = Document()
    st = doc.styles["Normal"]
    st.font.name, st.font.size = FONT, Pt(12)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    def border(cell, *sides):
        tcPr = cell._tc.get_or_add_tcPr()
        b = OxmlElement("w:tcBorders")
        for side in sides:
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), "6")
            el.set(qn("w:color"), "000000")
            b.append(el)
        tcPr.append(b)

    if title:
        h = doc.add_paragraph()
        r = h.add_run(title)
        r.bold, r.font.size = True, Pt(13)
    for k, t in enumerate(tables, 1):
        p = doc.add_paragraph()
        p.add_run(f"Table {k}").bold = True
        p.paragraph_format.space_after = Pt(0)
        p = doc.add_paragraph()
        p.add_run(t["title"]).italic = True
        cols = t["columns"]
        tbl = doc.add_table(rows=1 + len(t["rows"]), cols=len(cols))
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        tbl.autofit = False
        # widths from content: first column holds labels, the rest share what is left of 6.5 in
        lens = [max([len(str(c))] + [len(str(r[j])) for r in t["rows"] if j < len(r)]) for j, c in enumerate(cols)]
        first = min(max(lens[0] * 0.085, 1.3), 2.8) if len(cols) > 1 else 6.5
        rest = sum(max(x, 4) for x in lens[1:]) or 1
        widths = [first] + [(6.5 - first) * max(x, 4) / rest for x in lens[1:]]
        for j, w in enumerate(widths):
            tbl.columns[j].width = Inches(w)
            for row in tbl.rows:
                row.cells[j].width = Inches(w)
        groups = set(t.get("groups") or [])
        for j, c in enumerate(cols):
            cell = tbl.rows[0].cells[j]
            cell.text = ""
            run = cell.paragraphs[0].add_run(c)
            run.font.size = Pt(10.5)
            cell.paragraphs[0].paragraph_format.space_after = Pt(1)
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.LEFT if j == 0 else WD_ALIGN_PARAGRAPH.CENTER
            border(cell, "top", "bottom")
        for i, row in enumerate(t["rows"]):
            last = i == len(t["rows"]) - 1
            for j in range(len(cols)):
                val = str(row[j]) if j < len(row) else ""
                cell = tbl.rows[i + 1].cells[j]
                cell.text = ""
                run = cell.paragraphs[0].add_run(val)
                run.font.size = Pt(10.5)
                if i in groups and j == 0:
                    run.italic = True
                para = cell.paragraphs[0]
                para.paragraph_format.space_after = Pt(1)
                if j == 0 and val.startswith(" "):
                    para.paragraph_format.left_indent = Inches(0.2)
                    run.text = val.strip()
                para.alignment = WD_ALIGN_PARAGRAPH.LEFT if j == 0 else WD_ALIGN_PARAGRAPH.CENTER
                if last:
                    border(cell, "bottom")
        if t.get("note"):
            p = doc.add_paragraph()
            p.add_run("Note. ").italic = True
            p.add_run(t["note"]).font.size = Pt(10)
        doc.add_paragraph()
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def xlsx_bytes(tables: list[dict], logs: list[tuple[str, str]] | None = None) -> bytes:
    """One sheet with every table, numbers stored as numbers; optional sheet with the Stata log."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Tables"
    thin = Side(style="thin", color="000000")
    r = 1
    widths: dict[int, int] = {}
    for k, t in enumerate(tables, 1):
        ws.cell(r, 1, f"Table {k}").font = Font(bold=True, name="Calibri")
        ws.cell(r + 1, 1, t["title"]).font = Font(italic=True, name="Calibri")
        r += 2
        for j, c in enumerate(t["columns"], 1):
            cell = ws.cell(r, j, c)
            cell.font = Font(bold=True)
            cell.border = Border(top=thin, bottom=thin)
            cell.alignment = Alignment(horizontal="left" if j == 1 else "center")
            widths[j] = max(widths.get(j, 0), len(c))
        for i, row in enumerate(t["rows"]):
            r += 1
            for j, v in enumerate(row, 1):
                s = str(v)
                num = s.replace("−", "-").replace(",", "")
                val: object = s
                try:
                    if j > 1 and num and num[-1].isdigit():
                        val = float(num)
                except ValueError:
                    pass
                cell = ws.cell(r, j, val)
                if isinstance(val, float):
                    dec = len(num.split(".")[1]) if "." in num else 0
                    cell.number_format = "0" if dec == 0 else "0." + "0" * dec
                    cell.alignment = Alignment(horizontal="center")
                if i == len(t["rows"]) - 1:
                    cell.border = Border(bottom=thin)
                if j == 1 and i in (t.get("groups") or []):
                    cell.font = Font(italic=True)
                widths[j] = max(widths.get(j, 0), len(s))
        if t.get("note"):
            r += 1
            ws.cell(r, 1, f"Note. {t['note']}").font = Font(size=9, italic=True)
        r += 3
    for j, w in widths.items():
        ws.column_dimensions[ws.cell(1, j).column_letter].width = min(max(w + 2, 8), 48)
    if logs:
        lg = wb.create_sheet("Stata log")
        row = 1
        for cmd, text in logs:
            lg.cell(row, 1, f". {cmd}").font = Font(name="Consolas", bold=True)
            row += 1
            for line in text.splitlines():
                lg.cell(row, 1, line).font = Font(name="Consolas")
                row += 1
            row += 1
        lg.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def dataset_bytes(ds: Dataset, fmt: str) -> bytes:
    if fmt == "csv":
        df = ds.df.copy()
        return df.to_csv(index=False).encode("utf-8")
    import pyreadstat

    df = ds.df.copy()
    for c in df.columns:  # .dta needs plain types
        if df[c].dtype == bool:
            df[c] = df[c].astype(int)
    labels = {v: {float(k) if not isinstance(k, str) else k: str(lab) for k, lab in m.items()} for v, m in ds.value_labels.items() if v in df.columns and m}
    with tempfile.NamedTemporaryFile(suffix=".dta", delete=False) as tmp:
        path = tmp.name
    try:
        pyreadstat.write_dta(
            df,
            path,
            column_labels=[ds.var_labels.get(c, "") for c in df.columns],
            variable_value_labels={v: {int(k) if isinstance(k, float) and k.is_integer() else k: lab for k, lab in m.items()} for v, m in labels.items()},
            version=15,
        )
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        os.unlink(path)
