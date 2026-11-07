"""More data preparation: egen, xtile, dummy sets (tabulate, generate()), set seed, sample, sort."""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from .data import Dataset, StataError, is_numeric
from .datacmds import _new_name, selected
from .expr import evaluate, resolve_var
from .result import Result
from .statcmds import _levels, level_label, stata_pctile
from .syntax import Command, expand_varlist


def _missing_note(n: int) -> str:
    return "" if not n else ("(1 missing value generated)" if n == 1 else f"({n:,} missing values generated)")


def _num_series(text: str, df: pd.DataFrame) -> pd.Series:
    v = evaluate(text, df)
    if not isinstance(v, pd.Series):
        v = pd.Series(float(v), index=df.index)
    if not pd.api.types.is_numeric_dtype(v):
        raise StataError("type mismatch: this egen function needs numbers")
    return v.astype(float)


# ───────────── egen ─────────────

ROW_FUNS = {"rowmean", "rowtotal", "rowmax", "rowmin", "rowmiss", "rownonmiss", "rowsd", "anycount", "anymatch"}


def egen(ds: Dataset, cmd: Command) -> Result:
    parts = cmd.args.split()
    if len(parts) == 2 and parts[0] in ("byte", "int", "long", "float", "double"):
        parts = parts[1:]
    if len(parts) != 1:
        raise StataError("egen needs: egen newvar = function(arguments)")
    name = _new_name(parts[0], ds)
    m = re.match(r"^\s*([a-z]+)\s*\((.*)\)\s*$", cmd.exp or "", re.S)
    if not m:
        raise StataError("egen needs a function, e.g. egen z = std(income)")
    fn, arg = m.group(1).lower(), m.group(2).strip()
    df = ds.df
    keep = selected(ds, cmd)
    by_opt = cmd.opt("by")
    by = cmd.by or ([resolve_var(v, df) for v in by_opt.split()] if isinstance(by_opt, str) else [])
    by = [resolve_var(v, df) for v in by]
    labels: dict | None = None

    if fn in ROW_FUNS:
        vs = expand_varlist(arg, df, allow_empty_all=False)
        frame = df[vs].apply(pd.to_numeric, errors="coerce")
        if fn == "rowmean":
            out = frame.mean(axis=1)
        elif fn == "rowtotal":
            out = frame.sum(axis=1, min_count=1 if cmd.opt("missing") else 0)
        elif fn == "rowmax":
            out = frame.max(axis=1)
        elif fn == "rowmin":
            out = frame.min(axis=1)
        elif fn == "rowsd":
            out = frame.std(axis=1, ddof=1)
        elif fn == "rowmiss":
            out = frame.isna().sum(axis=1).astype(float)
        elif fn == "rownonmiss":
            out = frame.notna().sum(axis=1).astype(float)
        else:  # anycount / anymatch, values(numlist)
            vals = [float(x) for x in str(cmd.opt("values") or "").replace(",", " ").split()]
            if not vals:
                raise StataError(f"{fn} needs values(), e.g. values(1 2)")
            hits = frame.isin(vals)
            out = hits.sum(axis=1).astype(float) if fn == "anycount" else hits.any(axis=1).astype(float)
    elif fn in ("group", "tag") and not (fn == "group" and re.match(r"^[\d\s]+$", arg)):
        vs = expand_varlist(arg, df, allow_empty_all=False)
        sub = df[vs]
        ok = sub.notna().all(axis=1) if all(is_numeric(sub[v]) for v in vs) else sub.apply(lambda c: c.notna() & c.astype(str).ne(""), axis=0).all(axis=1)
        ok &= keep
        if fn == "tag":
            out = (~sub.duplicated() & ok).astype(float).where(ok | ~ok, 0.0)
        else:
            keys = sub[ok].drop_duplicates().sort_values(vs)
            keys = keys.assign(__g=np.arange(1, len(keys) + 1, dtype=float))
            out = sub.merge(keys, on=vs, how="left")["__g"].set_axis(df.index).where(ok)
            if cmd.opt("label") and len(vs) == 1:
                labels = {int(g): level_label(ds, vs[0], k) for k, g in zip(keys[vs[0]], keys["__g"])}
    elif fn == "cut":
        x = _num_series(arg, df)
        at, groups = cmd.opt("at"), cmd.opt("group")
        if isinstance(at, str):
            cuts = [float(v) for v in at.replace(",", " ").split()]
            idx = np.searchsorted(cuts, x.to_numpy(), side="right") - 1
            inside = (x >= cuts[0]) & (x < cuts[-1])
            codes = pd.Series(idx, index=df.index).astype(float).where(inside & x.notna())
            out = codes if cmd.opt("icodes") else codes.map(lambda i: cuts[int(i)] if i == i else np.nan)
        elif isinstance(groups, str):
            k = int(groups)
            xs = x[keep & x.notna()].to_numpy()
            qs = [stata_pctile(xs, 100 * j / k) for j in range(1, k)]
            out = pd.Series(np.searchsorted(qs, x.to_numpy(), side="right"), index=df.index).astype(float).where(keep & x.notna())  # codes 0..k-1, as Stata
        else:
            raise StataError("egen cut() needs at(numlist) or group(#)")
    else:
        x = _num_series(arg, df) if arg else pd.Series(1.0, index=df.index)
        x = x.where(keep)
        grp = [df[v] for v in by] if by else None
        g = x.groupby(grp if grp else pd.Series(0, index=df.index), dropna=False)
        if fn == "mean":
            out = g.transform("mean")
        elif fn in ("total", "sum"):
            out = g.transform(lambda s: s.sum(min_count=1) if cmd.opt("missing") else s.sum())
        elif fn == "count":
            out = g.transform("count").astype(float)
        elif fn == "sd":
            out = g.transform(lambda s: s.std(ddof=1))
        elif fn == "min":
            out = g.transform("min")
        elif fn == "max":
            out = g.transform("max")
        elif fn == "median":
            out = g.transform(lambda s: stata_pctile(s.dropna().to_numpy(), 50))
        elif fn == "pctile":
            p = float(cmd.opt("p") or 50)
            out = g.transform(lambda s: stata_pctile(s.dropna().to_numpy(), p))
        elif fn == "iqr":
            out = g.transform(lambda s: stata_pctile(s.dropna().to_numpy(), 75) - stata_pctile(s.dropna().to_numpy(), 25))
        elif fn == "std":
            mu, sdv = float(cmd.opt("mean") or 0), float(cmd.opt("sd", "std") or 1)
            out = (x - g.transform("mean")) / g.transform(lambda s: s.std(ddof=1)) * sdv + mu
        elif fn == "rank":
            method = "first" if cmd.opt("unique") else ("min" if cmd.opt("track") else ("max" if cmd.opt("field") else "average"))
            asc = not cmd.opt("field")
            out = g.rank(method=method, ascending=asc)
        else:
            raise StataError(f"unknown egen function {fn}()")
        out = out.where(keep)
        if fn not in ("count",):
            out = out.where(x.notna() | (fn in ("mean", "total", "sum", "sd", "min", "max", "median", "pctile", "iqr")))
    out = pd.Series(out, index=df.index).astype(float).where(keep)
    ds.df[name] = out
    if labels:
        ds.value_labels[name] = labels
        ds.label_sets[name] = dict(labels)
    return Result(log=_missing_note(int(out.isna().sum())), changes_data=True, summary={"generated": name, "function": fn})


# ───────────── xtile ─────────────


def xtile(ds: Dataset, cmd: Command) -> Result:
    name = _new_name(cmd.args.strip(), ds)
    if cmd.weight:
        raise StataError("weights with xtile aren't available yet")
    x = _num_series(cmd.exp or "", ds.df)
    keep = selected(ds, cmd) & x.notna()
    nq = cmd.opt("nquantiles", "nq")
    cut_var = cmd.opt("cutpoints")
    if isinstance(cut_var, str):
        cv = resolve_var(cut_var, ds.df)
        qs = sorted(ds.df[cv].dropna().astype(float).tolist())
    else:
        k = int(nq) if isinstance(nq, str) else 2
        if k < 2:
            raise StataError("nquantiles() must be at least 2")
        xs = x[keep].to_numpy()
        qs = [stata_pctile(xs, 100 * j / k) for j in range(1, k)]
    # category i holds values up to and including the i-th cut point
    out = pd.Series(np.searchsorted(qs, x.to_numpy(), side="left") + 1, index=ds.df.index).astype(float).where(keep)
    ds.df[name] = out
    return Result(log=_missing_note(int(out.isna().sum())), changes_data=True, summary={"generated": name, "quantiles": len(qs) + 1})


# ───────────── tabulate x, generate(stub) ─────────────


def tab_generate(ds: Dataset, cmd: Command, vars_: list[str], stub: str) -> Result:
    if len(vars_) != 1:
        raise StataError("tabulate, generate() takes one variable")
    v = vars_[0]
    s = ds.df[v]
    keep = selected(ds, cmd)
    levels = _levels(ds, s[keep], False)
    names = [f"{stub.strip()}{i + 1}" for i in range(len(levels))]
    for n in names:
        _new_name(n, ds)
    miss = s.isna() if is_numeric(s) else s.fillna("").astype(str).eq("")
    lines = [f"{v} | {'Freq.':>10}", "-" * 30]
    for n, lv in zip(names, levels):
        ds.df[n] = (s == lv).astype(float).where(keep & ~miss)
        ds.var_labels[n] = f"{v}=={level_label(ds, v, lv)}"
    lines = [f"(created {len(names)} indicator variables: {names[0]}–{names[-1]})"] if len(names) > 1 else [f"(created {names[0]})"]
    return Result(log="\n".join(lines), changes_data=True, summary={"generated": names})


# ───────────── set, sample, sort ─────────────


def set_(ds: Dataset, cmd: Command) -> Result:
    parts = cmd.args.split()
    if parts and parts[0].lower() == "seed":
        if len(parts) < 2:
            raise StataError("set seed needs a number")
        ds.rng = np.random.default_rng(int(float(parts[1])))
        return Result(log="", changes_data=True)
    return Result(log="")  # set more off, set linesize ...: nothing to do here


def version_(ds: Dataset, cmd: Command) -> Result:
    return Result(log="")


def sample_(ds: Dataset, cmd: Command) -> Result:
    arg = cmd.args.strip()
    try:
        num = float(arg)
    except ValueError as e:
        raise StataError("use: sample 10 (percent)  or  sample 100, count") from e
    keep = selected(ds, cmd)
    idx = ds.df.index[keep].to_numpy()
    k = int(num) if cmd.opt("count") else int(round(len(idx) * num / 100))
    if not 0 <= k <= len(idx):
        raise StataError("sample size out of range")
    chosen = set(ds.rng.choice(idx, size=k, replace=False).tolist()) if k else set()
    drop = [i for i in ds.df.index if keep[i] and i not in chosen]
    ds.df.drop(index=drop, inplace=True)
    ds.df.reset_index(drop=True, inplace=True)
    return Result(log=f"({len(drop):,} observation{'s' if len(drop) != 1 else ''} deleted)", changes_data=True)


def sort_(ds: Dataset, cmd: Command) -> Result:
    toks = cmd.args.split()
    if not toks:
        raise StataError("sort needs at least one variable")
    keys, asc = [], []
    for t in toks:
        if cmd.name == "gsort" and t[0] in "+-":
            keys.append(resolve_var(t[1:], ds.df))
            asc.append(t[0] == "+")
        else:
            keys.append(resolve_var(t.lstrip("+"), ds.df))
            asc.append(True)
    ds.df.sort_values(keys, ascending=asc, kind="mergesort", na_position="last", inplace=True)
    ds.df.reset_index(drop=True, inplace=True)
    return Result(log="", changes_data=True)
