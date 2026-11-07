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

    def copy(self) -> "Dataset":
        import copy

        return Dataset(self.df.copy(), dict(self.var_labels), {k: dict(v) for k, v in self.value_labels.items()}, {k: dict(v) for k, v in self.label_sets.items()}, list(self.import_notes), copy.deepcopy(self.rng), self.last_est, self.last_margins)

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
            return Dataset(df, var_labels, value_labels)
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
    numeric, encoded = [], []
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
        if 1 <= uniq <= 50 and (uniq <= 2 or uniq <= 0.5 * len(vals)) and not looks_like_dates:
            levels = sorted(vals.unique())
            codes = {v: i + 1 for i, v in enumerate(levels)}
            df[c] = df[c].map(lambda v: codes.get(str(v)) if isinstance(v, str) else np.nan).astype(float)
            value_labels[c] = {i + 1: v for i, v in enumerate(levels)}
            encoded.append(f"{c} ({', '.join(f'{i + 1} = {v}' for i, v in enumerate(levels[:4]))}{', …' if len(levels) > 4 else ''})")
    kind = {"csv": "CSV", "txt": "text", "tsv": "text", "xlsx": "Excel", "xls": "Excel"}.get(ext, ext.upper())
    notes = [f"Converted your {kind} file to Stata format: {df.shape[1]} variables, {len(df):,} observations."]
    renamed = [f"“{o}” → {n}" for n, o in zip(df.columns, original) if o != n]
    if renamed:
        notes.append(f"Renamed {len(renamed)} column{'s' if len(renamed) != 1 else ''} to valid Stata names (the original headings are kept as variable labels): {'; '.join(renamed[:6])}{'; …' if len(renamed) > 6 else ''}.")
    if encoded:
        notes.append(f"Turned {len(encoded)} text column{'s' if len(encoded) != 1 else ''} into labelled categories, as Stata's encode does: {'; '.join(encoded[:5])}{'; …' if len(encoded) > 5 else ''}.")
    if numeric:
        notes.append(f"Read {len(numeric)} column{'s' if len(numeric) != 1 else ''} of numbers stored as text as numeric: {', '.join(numeric[:8])}{', …' if len(numeric) > 8 else ''}.")
    left = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    if left:
        notes.append(f"Kept as text (too many different values to be categories): {', '.join(left[:8])}{', …' if len(left) > 8 else ''}.")
    return Dataset(df, var_labels, value_labels, {k: dict(v) for k, v in value_labels.items()}, notes)


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
