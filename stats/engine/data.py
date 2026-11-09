"""Datasets: loading files with their labels, and the per-dataset metadata the app shows."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


class StataError(Exception):
    """A user-facing error, worded like Stata's (r(…) codes omitted)."""


@dataclass
class Dataset:
    df: pd.DataFrame
    var_labels: dict[str, str] = field(default_factory=dict)
    value_labels: dict[str, dict] = field(default_factory=dict)  # var -> {code: label}
    label_sets: dict[str, dict] = field(default_factory=dict)  # label define name -> {code: label}
    import_notes: list[str] = field(default_factory=list)  # what converting a CSV/Excel file changed
    rng: np.random.Generator = field(default_factory=lambda: np.random.default_rng(123456789))  # set seed
    last_est: dict | None = None  # the last estimation (Stata's e()), for predict / estat / margins
    last_margins: dict | None = None  # for marginsplot
    settings: dict = field(default_factory=dict)  # svyset / xtset / stset / last factor solution

    def copy(self) -> "Dataset":
        import copy

        return Dataset(self.df.copy(), dict(self.var_labels), {k: dict(v) for k, v in self.value_labels.items()}, {k: dict(v) for k, v in self.label_sets.items()}, list(self.import_notes), copy.deepcopy(self.rng), self.last_est, self.last_margins, copy.deepcopy(self.settings))

    def label(self, var: str) -> str:
        return self.var_labels.get(var, "")

    def value_label(self, var: str, value) -> str:
        labels = self.value_labels.get(var) or {}
        if value in labels:
            return str(labels[value])
        try:
            f = float(value)
            if f.is_integer() and int(f) in labels:
                return str(labels[int(f)])
            if f in labels:
                return str(labels[f])
        except (TypeError, ValueError):
            pass
        return fmt_value(value)


def fmt_value(v) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "."
    if isinstance(v, (float, np.floating)) and float(v).is_integer():
        return str(int(v))
    return str(v)


def _clean_names(df: pd.DataFrame) -> pd.DataFrame:
    """Stata-style names: letters, digits, underscore; unique; at most 32 characters."""
    seen: set[str] = set()
    names = []
    for i, c in enumerate(df.columns):
        n = "".join(ch if (ch.isalnum() or ch == "_") else "_" for ch in str(c).strip()) or f"v{i + 1}"
        if n[0].isdigit():
            n = f"_{n}"
        n = n[:32]
        base, k = n, 1
        while n.lower() in seen:
            k += 1
            n = f"{base[:29]}_{k}"
        seen.add(n.lower())
        names.append(n)
    df.columns = names
    return df


def load_bytes(data: bytes, filename: str) -> Dataset:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        return load_path(path, filename)
    finally:
        os.unlink(path)


def load_path(path: str, filename: str) -> Dataset:
    """Reads a file from disk (the engine never needs the raw bytes and the table in memory at once)."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext in ("dta", "sav", "zsav"):
            import pyreadstat

            reader = pyreadstat.read_dta if ext == "dta" else pyreadstat.read_sav
            df, meta = reader(path, apply_value_formats=False)
            var_labels = {k: v for k, v in zip(meta.column_names, meta.column_labels or []) if v}
            value_labels = {k: {(int(c) if isinstance(c, float) and c.is_integer() else c): lab for c, lab in v.items()} for k, v in (meta.variable_value_labels or {}).items()}
            notes, fixes = stata_file_notes(df, value_labels, ext)
            out = Dataset(df, var_labels, value_labels, import_notes=notes)
            out.settings["import_fixes"] = fixes
            return out
        if ext in ("csv", "txt", "tsv"):
            with open(path, "rb") as fh:
                head = fh.read(65536).decode("utf-8-sig", errors="replace")
            first = head.splitlines()[0] if head else ""
            counts = {"\t": first.count("\t"), ";": first.count(";"), ",": first.count(",")}
            sep = "\t" if ext == "tsv" else max(counts, key=lambda k: counts[k]) if any(counts.values()) else ","
            # European Excel writes "1,5" for 1.5 when the separator is ";"
            decimal = "," if sep == ";" else "."
            df = pd.read_csv(path, sep=sep, decimal=decimal, encoding="utf-8-sig", encoding_errors="replace", low_memory=False)
        elif ext in ("xlsx", "xls"):
            df = pd.read_excel(path)
        else:
            raise StataError("Use a Stata (.dta), SPSS (.sav), Excel (.xlsx) or CSV file.")
    except StataError:
        raise
    except Exception as e:  # noqa: BLE001 - surfaced to the user in plain words
        raise StataError(f"We couldn't read that file ({type(e).__name__}). Check that it opens in Excel or Stata.") from e
    return to_stata(df, ext)


def to_stata(df: pd.DataFrame, ext: str) -> Dataset:
    """Turns a spreadsheet into a proper Stata dataset, and says what changed:
    Stata-safe names (original headings kept as variable labels), numbers stored as text made
    numeric, and text categories encoded as labelled numbers, the way Stata's `encode` does
    (codes 1, 2, ... in alphabetical order). Free text, IDs and dates stay as text."""
    original = [str(c).strip() for c in df.columns]
    df = _clean_names(df)
    var_labels = {n: o[:80] for n, o in zip(df.columns, original) if o and o != n}
    value_labels: dict[str, dict] = {}
    numeric, encoded, ordinal = [], [], []
    empty = [c for c in df.columns if df[c].isna().all() or (df[c].astype(str).str.strip().isin(["", "nan", "None"]).all())]
    for c in df.columns:
        if not (pd.api.types.is_object_dtype(df[c]) or pd.api.types.is_string_dtype(df[c])):
            continue
        df[c] = df[c].astype(object).map(lambda v: (v.strip() or np.nan) if isinstance(v, str) else v)
        conv = pd.to_numeric(df[c], errors="coerce")
        if df[c].notna().any() and conv.notna().sum() == df[c].notna().sum():
            df[c] = conv
            numeric.append(c)
            continue
        vals = df[c].dropna().astype(str)
        uniq = vals.nunique()
        looks_like_dates = vals.head(50).str.match(r"^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}").mean() > 0.8 if len(vals) else False
        from .scales import natural_order

        from .scales import natural_codes

        nat = natural_codes(sorted(vals.unique())) if uniq <= 12 else None
        if (1 <= uniq <= 50 and (uniq <= 2 or uniq <= 0.5 * len(vals)) and not looks_like_dates) or nat:
            codes = nat or {v: i + 1 for i, v in enumerate(sorted(vals.unique()))}
            if nat:
                ordinal.append(c)
            df[c] = df[c].map(lambda v: codes.get(str(v)) if isinstance(v, str) else np.nan).astype(float)
            value_labels[c] = {k: v for v, k in sorted(codes.items(), key=lambda kv: kv[1])}
            shown = list(value_labels[c].items())
            encoded.append(f"{c} ({', '.join(f'{k} = {v}' for k, v in shown[:4])}{', …' if len(shown) > 4 else ''})")
    kind = {"csv": "CSV", "txt": "text", "tsv": "text", "xlsx": "Excel", "xls": "Excel"}.get(ext, ext.upper())
    notes = [f"Converted your {kind} file to Stata format: {df.shape[1]} variables, {len(df):,} observations."]
    renamed = [f"“{o}” → {n}" for n, o in zip(df.columns, original) if o != n]
    if renamed:
        notes.append(f"Renamed {len(renamed)} column{'s' if len(renamed) != 1 else ''} to valid Stata names (the original headings are kept as variable labels): {'; '.join(renamed[:6])}{'; …' if len(renamed) > 6 else ''}.")
    if encoded:
        notes.append(f"Turned {len(encoded)} text column{'s' if len(encoded) != 1 else ''} into labelled categories, as Stata's encode does: {'; '.join(encoded[:5])}{'; …' if len(encoded) > 5 else ''}.")
    if numeric:
        notes.append(f"Read {len(numeric)} column{'s' if len(numeric) != 1 else ''} of numbers stored as text as numeric: {', '.join(numeric[:8])}{', …' if len(numeric) > 8 else ''}.")
    if ordinal:
        first = list(value_labels[ordinal[0]].items())
        notes.append(f"Answer scales were numbered in their natural order, not alphabetically ({', '.join(ordinal[:6])}{', …' if len(ordinal) > 6 else ''}): for example {first[0][0]} = {first[0][1]} … {first[-1][0]} = {first[-1][1]}.")
    fixes = [f"drop {' '.join(empty)}"] if empty else []
    if empty:
        notes.append(f"{len(empty)} column{'s are' if len(empty) != 1 else ' is'} completely empty (often section headings or notes from a survey tool): {' '.join(empty[:8])}{' …' if len(empty) > 8 else ''}.")
    left = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c]) and c not in empty]
    if left:
        notes.append(f"Kept as text (too many different values to be categories): {', '.join(left[:8])}{', …' if len(left) > 8 else ''}.")
    out = Dataset(df, var_labels, value_labels, {k: dict(v) for k, v in value_labels.items()}, notes)
    out.settings["import_fixes"] = fixes
    return out


def stata_file_notes(df: pd.DataFrame, value_labels: dict, ext: str) -> tuple[list[str], list[str]]:
    """A Stata or SPSS file is loaded exactly as it is. These notes point out what will get in the way of
    analysis, with the command that fixes it, the way an experienced analyst would on first look."""
    kind = "Stata" if ext == "dta" else "SPSS"
    notes = [f"Loaded your {kind} file as it is: {df.shape[1]} variables, {len(df):,} observations."]
    empty, numeric_text, categories = [], [], []
    for c in df.columns:
        s = df[c]
        if is_numeric(s):
            if s.notna().sum() == 0:
                empty.append(c)
            continue
        vals = s.dropna().astype(str).str.strip()
        vals = vals[vals != ""]
        if vals.empty:
            empty.append(c)
            continue
        if pd.to_numeric(vals, errors="coerce").notna().all():
            numeric_text.append(c)
            continue
        uniq = vals.nunique()
        looks_like_dates = vals.head(50).str.match(r"^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}").mean() > 0.8
        from .scales import natural_codes

        if (1 <= uniq <= 30 and (uniq <= 2 or uniq <= 0.5 * len(vals)) and not looks_like_dates) or natural_codes(sorted(vals.unique())):
            categories.append(c)
    show = lambda xs, n=8: " ".join(xs[:n]) + (" …" if len(xs) > n else "")
    fixes = stata_fixes(df, empty, numeric_text, categories)
    if empty:
        notes.append(f"{len(empty)} variable{'s are' if len(empty) != 1 else ' is'} completely empty (often section headings or notes from a survey tool): {show(empty)}. You can remove {'them' if len(empty) != 1 else 'it'} with: drop {show(empty, 12)}")
    if numeric_text:
        notes.append(f"{len(numeric_text)} variable{'s hold' if len(numeric_text) != 1 else ' holds'} numbers stored as text, so {'they' if len(numeric_text) != 1 else 'it'} can't be used in calculations yet: {show(numeric_text)}. Convert with: destring {show(numeric_text, 12)}, replace")
    if categories:
        notes.append(f"{len(categories)} text variable{'s look' if len(categories) != 1 else ' looks'} like categories (for example {show(categories, 5)}). To use {'them' if len(categories) != 1 else 'it'} in tables and models, encode {'each' if len(categories) != 1 else 'it'}, e.g.: encode {categories[0]}, generate({categories[0][:28]}_n)")
    if fixes:
        notes.append("“Prepare my data” runs these fixes for you, as Stata commands you can see and keep in your do-file.")
    return (notes if len(notes) > 1 else []), fixes


def stata_fixes(df: pd.DataFrame, empty: list[str], numeric_text: list[str], categories: list[str], limit: int = 38) -> list[str]:
    """Stata commands that make a survey export analysable: drop empty columns, destring numbers,
    encode categories (answer scales in their natural order, through a value label defined first)."""
    from .scales import natural_codes

    cmds: list[str] = []
    if empty:
        cmds.append("drop " + " ".join(empty))
    if numeric_text:
        cmds.append("destring " + " ".join(numeric_text) + ", replace")
    defined: dict[tuple, str] = {}
    taken = set(df.columns)
    for c in categories:
        if len(cmds) >= limit:
            break
        vals = sorted(df[c].dropna().astype(str).str.strip().loc[lambda s: s != ""].unique())
        new = (c[:30] + "_n")
        while new in taken:
            new = new[:-1] + "x"
        taken.add(new)
        nat = natural_codes(vals)
        if nat:
            key = tuple(sorted(nat.items(), key=lambda kv: kv[1]))
            if key not in defined:
                lbl = (c[:29] + "_lb")
                defined[key] = lbl
                cmds.append(f"label define {lbl} " + " ".join(f'{k} "{v}"' for v, k in key))
            cmds.append(f"encode {c}, generate({new}) label({defined[key]})")
        else:
            cmds.append(f"encode {c}, generate({new})")
    return cmds


def is_numeric(s: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s)


def storage_type(s: pd.Series) -> str:
    if not is_numeric(s):
        width = int(s.dropna().astype(str).str.len().max() or 1) if s.notna().any() else 1
        return f"str{min(max(width, 1), 2045)}"
    v = s.dropna()
    if len(v) and np.all(np.mod(v, 1) == 0):
        lo, hi = v.min(), v.max()
        if -127 <= lo and hi <= 100:
            return "byte"
        if -32767 <= lo and hi <= 32740:
            return "int"
        return "long"
    return "double"


def variables_meta(ds: Dataset) -> list[dict]:
    """What the Variables panel and the AI see: names, labels, types and light summaries, never raw rows."""
    out = []
    for name in ds.df.columns:
        s = ds.df[name]
        numeric = is_numeric(s)
        nonmiss = int(s.notna().sum())
        uniq = int(s.nunique(dropna=True))
        item = {
            "name": name,
            "label": ds.label(name),
            "type": storage_type(s),
            "numeric": numeric,
            "nonmissing": nonmiss,
            "missing": int(len(s) - nonmiss),
            "unique": uniq,
        }
        vl = ds.value_labels.get(name)
        if vl:
            item["valueLabels"] = {fmt_value(k): str(v) for k, v in list(vl.items())[:30]}
        if numeric and nonmiss:
            item["min"] = float(s.min())
            item["max"] = float(s.max())
            item["kind"] = "categorical" if (vl or uniq <= 12) and np.all(np.mod(s.dropna(), 1) == 0) else "continuous"
            v = s.dropna().astype(float)
            if item["kind"] == "continuous":
                item["mean"] = float(v.mean())
                item["hist"] = [int(c) for c in np.histogram(v, bins=14)[0]]
            else:
                counts = v.value_counts().sort_index()
                item["levels"] = [{"value": fmt_value(k), "label": ds.value_label(name, k), "n": int(c)} for k, c in list(counts.items())[:12]]
        else:
            item["kind"] = "text"
            if uniq <= 12:
                item["values"] = [str(x) for x in s.dropna().unique()[:12]]
        out.append(item)
    return out
