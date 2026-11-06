"""Datasets: loading files with their labels, and the per-dataset metadata the app shows."""

from __future__ import annotations

import io
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

    def copy(self) -> "Dataset":
        return Dataset(self.df.copy(), dict(self.var_labels), {k: dict(v) for k, v in self.value_labels.items()}, {k: dict(v) for k, v in self.label_sets.items()})

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
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext in ("dta", "sav", "zsav"):
            import pyreadstat

            with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
                tmp.write(data)
                path = tmp.name
            try:
                reader = pyreadstat.read_dta if ext == "dta" else pyreadstat.read_sav
                df, meta = reader(path, apply_value_formats=False)
            finally:
                os.unlink(path)
            var_labels = {k: v for k, v in zip(meta.column_names, meta.column_labels or []) if v}
            value_labels = {k: {(int(c) if isinstance(c, float) and c.is_integer() else c): lab for c, lab in v.items()} for k, v in (meta.variable_value_labels or {}).items()}
            return Dataset(df, var_labels, value_labels)
        if ext in ("csv", "txt", "tsv"):
            text = data.decode("utf-8-sig", errors="replace")
            sep = "\t" if ext == "tsv" or (text.count("\t") > text.count(",")) else ","
            df = pd.read_csv(io.StringIO(text), sep=sep)
        elif ext in ("xlsx", "xls"):
            df = pd.read_excel(io.BytesIO(data))
        else:
            raise StataError("Use a Stata (.dta), SPSS (.sav), Excel (.xlsx) or CSV file.")
    except StataError:
        raise
    except Exception as e:  # noqa: BLE001 - surfaced to the user in plain words
        raise StataError(f"We couldn't read that file ({type(e).__name__}). Check that it opens in Excel or Stata.") from e
    df = _clean_names(df)
    # Numbers stored as text ("12", "3.5") become numeric, like Stata's destring for clean columns.
    for c in df.columns:
        if df[c].dtype == object:
            conv = pd.to_numeric(df[c], errors="coerce")
            if conv.notna().sum() == df[c].notna().sum() and df[c].notna().any():
                df[c] = conv
    return Dataset(df)


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
