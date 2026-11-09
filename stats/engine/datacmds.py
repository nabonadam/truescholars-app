"""Data commands (generate, replace, recode, drop/keep, rename, label, mvdecode) and data views
(describe, codebook, list, count). Messages match Stata's wording."""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from . import fmt
from .data import Dataset, StataError, fmt_value, is_numeric, storage_type
from .expr import condition, evaluate, resolve_var
from .result import Result, Table
from .syntax import Command, expand_varlist

NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")


def selected(ds: Dataset, cmd: Command) -> pd.Series:
    mask = condition(cmd.if_, ds.df)
    if cmd.in_:
        a, b = cmd.in_
        n = len(ds.df)
        a = n + a + 1 if a < 0 else a
        b = n + b + 1 if b < 0 else b
        pos = np.zeros(n, dtype=bool)
        pos[max(a, 1) - 1 : min(b, n)] = True
        mask = mask & pos
    return mask


def _new_name(name: str, ds: Dataset) -> str:
    if not NAME_RE.match(name):
        raise StataError(f"{name} invalid name")
    if name in ds.df.columns:
        raise StataError(f"variable {name} already defined")
    return name


def generate(ds: Dataset, cmd: Command) -> Result:
    parts = cmd.args.split()
    if len(parts) == 2 and parts[0] in ("byte", "int", "long", "float", "double") or (len(parts) == 2 and re.match(r"str\d*$", parts[0])):
        parts = parts[1:]
    if len(parts) != 1:
        raise StataError("generate needs: generate newvar = expression")
    name = _new_name(parts[0], ds)
    val = evaluate(cmd.exp, ds.df)
    mask = selected(ds, cmd)
    if not isinstance(val, pd.Series):
        val = pd.Series(val, index=ds.df.index)
    if pd.api.types.is_numeric_dtype(val):
        out = val.astype(float).where(mask, np.nan)
        missing = int(out.isna().sum())
    else:
        out = val.where(mask, "")
        missing = int((out == "").sum())
    ds.df[name] = out
    log = f"(1 missing value generated)" if missing == 1 else (f"({missing:,} missing values generated)" if missing else "")
    return Result(log=log, changes_data=True, summary={"generated": name, "missing": missing})


def replace(ds: Dataset, cmd: Command) -> Result:
    name = resolve_var(cmd.args.strip(), ds.df)
    val = evaluate(cmd.exp, ds.df)
    mask = selected(ds, cmd)
    old = ds.df[name]
    if not isinstance(val, pd.Series):
        val = pd.Series(val, index=ds.df.index)
    if is_numeric(old) != pd.api.types.is_numeric_dtype(val):
        raise StataError("type mismatch")
    new = old.where(~mask, val.astype(old.dtype) if is_numeric(old) else val)
    if is_numeric(old):
        new = new.astype(float)
        changed = int(((new != old.astype(float)) & ~(new.isna() & old.isna())).sum())
    else:
        changed = int((new.fillna("") != old.fillna("")).sum())
    ds.df[name] = new
    return Result(log=f"({changed:,} real change{'' if changed == 1 else 's'} made)", changes_data=True, summary={"replaced": name, "changes": changed})


RULE_RE = re.compile(r"\(([^()]*)\)")


def _rule_matcher(spec: str, s: pd.Series):
    """One side of a recode rule: '1 2 3', '1/5', 'min/18', '.', 'missing', 'nonmissing', 'else'."""
    spec = spec.strip()
    if spec in ("else", "*"):
        return "else"
    if spec in ("missing", "miss"):
        return s.isna()
    if spec in ("nonmissing", "nonmiss"):
        return s.notna()
    mask = pd.Series(False, index=s.index)
    for part in spec.split():
        if "/" in part:
            lo, hi = part.split("/")
            lo_v = s.min() if lo == "min" else float(lo)
            hi_v = s.max() if hi == "max" else float(hi)
            mask |= (s >= lo_v) & (s <= hi_v)
        elif part == ".":
            mask |= s.isna()
        else:
            mask |= s == float(part)
    return mask


def recode(ds: Dataset, cmd: Command) -> Result:
    m = re.match(r"^(.*?)\s*(\(.*)$", cmd.args, re.S)
    if not m:
        raise StataError("recode needs rules, e.g. recode age (min/17=1) (18/max=2), gen(agegrp)")
    vars_ = expand_varlist(m.group(1), ds.df, allow_empty_all=False)
    rules = RULE_RE.findall(m.group(2))
    if not rules:
        raise StataError("invalid recode rules")
    gen = cmd.opt("generate")
    targets = gen.split() if isinstance(gen, str) else vars_
    if len(targets) != len(vars_):
        raise StataError("generate() needs one new name per variable")
    mask_in = selected(ds, cmd)
    labels: dict = {}
    total = 0
    for var, target in zip(vars_, targets):
        s = ds.df[var]
        if not is_numeric(s):
            raise StataError(f"{var} is a string variable; recode works on numbers")
        out = s.astype(float).copy()
        done = pd.Series(False, index=s.index)
        else_val = None
        for r in rules:
            if "=" not in r:
                raise StataError(f"invalid rule ({r})")
            lhs, rhs = r.split("=", 1)
            lab = re.search(r'"([^"]*)"', rhs)
            val_txt = re.sub(r'"[^"]*"', "", rhs).strip()
            val = np.nan if val_txt == "." else float(val_txt)
            if lab:
                labels[int(val) if not np.isnan(val) and float(val).is_integer() else val] = lab.group(1)
            match = _rule_matcher(lhs, s)
            if isinstance(match, str):
                else_val = val
                continue
            hit = match & ~done & mask_in
            out[hit] = val
            done |= match
        if else_val is not None:
            out[~done & mask_in] = else_val
        changed = int(((out != s.astype(float)) & ~(out.isna() & s.isna())).sum())
        total += changed
        if gen:
            _new_name(target, ds)
            ds.df[target] = out.where(mask_in, np.nan)
            if ds.label(var):
                ds.var_labels[target] = f"RECODE of {var} ({ds.label(var)})"
        else:
            ds.df[var] = out
        if labels:
            ds.value_labels[target] = dict(labels)
    log = f"({total:,} difference{'' if total == 1 else 's'} between {' '.join(vars_)} and {' '.join(targets)})" if gen else f"({' '.join(vars_)}: {total:,} change{'' if total == 1 else 's'} made)"
    return Result(log=log, changes_data=True, summary={"recoded": vars_, "into": targets})


def drop_keep(ds: Dataset, cmd: Command, keep: bool) -> Result:
    if cmd.if_ or cmd.in_:
        mask = selected(ds, cmd)
        before = len(ds.df)
        ds.df = ds.df[mask if keep else ~mask].reset_index(drop=True)
        dropped = before - len(ds.df)
        return Result(log=f"({dropped:,} observation{'' if dropped == 1 else 's'} deleted)", changes_data=True, summary={"observationsDeleted": dropped})
    vars_ = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    if not vars_:
        raise StataError("varlist required")
    if keep:
        gone = [c for c in ds.df.columns if c not in vars_]
        ds.df = ds.df[vars_]
    else:
        gone = vars_
        ds.df = ds.df.drop(columns=vars_)
    for v in gone:
        ds.var_labels.pop(v, None)
        ds.value_labels.pop(v, None)
    return Result(log="", changes_data=True, summary={"variablesDropped": gone})


def rename(ds: Dataset, cmd: Command) -> Result:
    parts = cmd.args.split()
    if len(parts) != 2:
        raise StataError("rename needs: rename oldname newname")
    old = resolve_var(parts[0], ds.df)
    new = _new_name(parts[1], ds)
    ds.df = ds.df.rename(columns={old: new})
    for d in (ds.var_labels, ds.value_labels):
        if old in d:
            d[new] = d.pop(old)
    return Result(log="", changes_data=True)


def label(ds: Dataset, cmd: Command) -> Result:
    text = cmd.args
    m = re.match(r'^var(?:iable)?\s+(\S+)\s+"(.*)"\s*$', text)
    if m:
        ds.var_labels[resolve_var(m.group(1), ds.df)] = m.group(2)[:80]
        return Result(log="", changes_data=True)
    m = re.match(r"^de(?:fine)?\s+(\S+)\s+(.*)$", text)
    if m:
        pairs = re.findall(r'(-?\d+(?:\.\d+)?)\s+"([^"]*)"', m.group(2))
        if not pairs:
            raise StataError('label define needs pairs like: label define yesno 0 "No" 1 "Yes"')
        cur = ds.label_sets.get(m.group(1), {}) if (cmd.opt("modify") or cmd.opt("add")) else {}
        cur.update({(int(float(k)) if float(k).is_integer() else float(k)): v for k, v in pairs})
        ds.label_sets[m.group(1)] = cur
        for var, labs in list(ds.value_labels.items()):
            if labs is ds.label_sets.get(m.group(1)):
                ds.value_labels[var] = cur
        return Result(log="", changes_data=True)
    m = re.match(r"^val(?:ues)?\s+(.+?)\s+(\S+)$", text)
    if m:
        lbl = m.group(2)
        if lbl != "." and lbl not in ds.label_sets:
            raise StataError(f"value label {lbl} not found")
        for v in expand_varlist(m.group(1), ds.df, allow_empty_all=False):
            if lbl == ".":
                ds.value_labels.pop(v, None)
            else:
                ds.value_labels[v] = ds.label_sets[lbl]
        return Result(log="", changes_data=True)
    raise StataError('use: label variable x "text" | label define name 1 "A" 2 "B" | label values x name')


def mvdecode(ds: Dataset, cmd: Command) -> Result:
    mv = cmd.opt("mv")
    if not isinstance(mv, str):
        raise StataError("mvdecode needs mv(): e.g. mvdecode income, mv(98 99)")
    codes = [float(x) for x in re.split(r"[\s|=.]+", mv) if x.strip() and re.match(r"^-?\d+(\.\d+)?$", x)]
    lines = []
    for v in expand_varlist(cmd.args, ds.df):
        s = ds.df[v]
        if not is_numeric(s):
            continue
        hit = s.isin(codes)
        k = int(hit.sum())
        if k:
            ds.df[v] = s.astype(float).mask(hit)
            lines.append(f"{fmt.name(v)}: {k:,} missing value{'' if k == 1 else 's'} generated")
    return Result(log="\n".join(lines), changes_data=True)


def encode(ds: Dataset, cmd: Command) -> Result:
    """String to numeric codes 1, 2, ... in alphabetical order, with the text kept as value labels."""
    var = resolve_var(cmd.args.strip(), ds.df)
    target = cmd.opt("generate")
    if not isinstance(target, str):
        raise StataError("must specify gen(): e.g. encode sex, gen(sex_n)")
    target = _new_name(target.strip(), ds)
    s = ds.df[var]
    if is_numeric(s):
        raise StataError(f"{var} is not a string variable; it is already numeric")
    text = s.where(s.notna(), "").astype(str)
    levels = sorted(v for v in text.unique() if v != "")
    lbl = cmd.opt("label")
    if isinstance(lbl, str):
        # Stata: use an existing value label's codes; text not in it gets the next codes (unless noextend)
        name = lbl.strip()
        labels = dict(ds.label_sets.get(name, {}))
        codes = {v: k for k, v in labels.items()}
        nxt = int(max([k for k in labels if isinstance(k, (int, float))] or [0])) + 1
        extra = [v for v in levels if v not in codes]
        if extra and cmd.opt("noextend"):
            raise StataError(f"{len(extra)} value{'s' if len(extra) > 1 else ''} of {var} not in label {name}: {', '.join(extra[:5])}")
        for v in extra:
            codes[v] = nxt
            labels[nxt] = v
            nxt += 1
        ds.label_sets[name] = labels
    else:
        name = target
        codes = {v: i + 1 for i, v in enumerate(levels)}
        labels = {i + 1: v for i, v in enumerate(levels)}
        ds.label_sets[name] = labels
    keep = selected(ds, cmd)
    ds.df[target] = text.map(codes).where(keep).astype(float)
    ds.value_labels[target] = ds.label_sets[name]
    if ds.label(var):
        ds.var_labels[target] = ds.label(var)
    return Result(log="", changes_data=True, summary={"encoded": var, "into": target, "levels": len(levels)})


def destring(ds: Dataset, cmd: Command) -> Result:
    """Text that holds numbers becomes numeric; `force` turns anything else into missing."""
    vars_ = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    gen, rep, force = cmd.opt("generate"), cmd.opt("replace"), cmd.opt("force")
    if not gen and not rep:
        raise StataError("must specify either generate() or replace")
    targets = [t for t in str(gen).split()] if isinstance(gen, str) else vars_
    if len(targets) != len(vars_):
        raise StataError("generate() needs one new name per variable")
    lines = []
    for v, t in zip(vars_, targets):
        s = ds.df[v]
        if is_numeric(s):
            lines.append(f"{v}: already numeric; no {'replace' if rep else 'generate'}")
            continue
        clean = s.astype("string").str.strip().str.replace(",", "", regex=False)
        num = pd.to_numeric(clean, errors="coerce")
        bad = int((num.isna() & clean.fillna("").ne("")).sum())
        if bad and not force:
            lines.append(f"{v}: contains nonnumeric characters; no {'replace' if rep else 'generate'}")
            continue
        if not rep:
            _new_name(t, ds)
        ds.df[t] = num.astype(float)
        if rep:
            lines.append(f"{v}: all characters numeric; replaced as {storage_type(ds.df[t])}" + (f" ({bad} missing values generated)" if bad else ""))
        else:
            lines.append(f"{v}: all characters numeric; {t} generated as {storage_type(ds.df[t])}" + (f" ({bad} missing values generated)" if bad else ""))
    return Result(log="\n".join(lines), changes_data=True)


# ───────────── views ─────────────


def describe(ds: Dataset, cmd: Command) -> Result:
    vars_ = expand_varlist(cmd.args, ds.df)
    n, k = ds.df.shape
    head = ["Contains data", f" Observations:{n:>14,}", f"    Variables:{k:>14,}"]
    if cmd.opt("short"):
        # Stata's describe, short: the counts only, no variable list
        return Result(log="\n".join(head + ["Sorted by: "]), summary={"observations": n, "variables": k})
    lines = [
        *head,
        "-" * 78,
        "Variable      Storage   Display    Value",
        "    name         type    format    label      Variable label",
        "-" * 78,
    ]
    rows = []
    for v in vars_:
        st = storage_type(ds.df[v])
        disp = "%9.0g" if st in ("byte", "int", "long") else "%10.0g" if st == "double" else f"%-{min(int(st[3:] or 1), 30)}s"
        vl = v[:10] if v in ds.value_labels else ""  # the value label's name (ours are named after the variable)
        name = v if len(v) <= 15 else v[:13] + "~" + v[-1]
        lines.append(f"{name:<15} {st:<7} {disp:<10} {vl:<10} {ds.label(v)}")
        rows.append([v, st, ds.label(v) or "—"])
    lines.append("-" * 78)
    return Result(log="\n".join(lines), tables=[Table("Variables in the data set", ["Variable", "Type", "Label"], rows, note=f"N = {n:,} observations.")], summary={"observations": n, "variables": k})


def codebook(ds: Dataset, cmd: Command) -> Result:
    vars_ = expand_varlist(cmd.args, ds.df)[:40]
    out = []
    for v in vars_:
        s = ds.df[v]
        out += ["-" * 78, f"{v:<40}{ds.label(v):>38}", "-" * 78, ""]
        nmiss = int(s.isna().sum()) if is_numeric(s) else int((s.fillna("") == "").sum())
        uniq = int(s.nunique(dropna=True))
        if is_numeric(s):
            st = storage_type(s)
            out.append(f"{'Type:':>20} Numeric ({st})")
            if v in ds.value_labels:
                out.append(f"{'Label:':>20} {v}")
            if s.notna().any():
                out.append(f"{'Range:':>20} [{fmt_value(s.min())},{fmt_value(s.max())}]{'Units: 1' if np.all(np.mod(s.dropna(), 1) == 0) else '':>24}")
            out.append(f"{'Unique values:':>20} {uniq:<17}Missing .: {nmiss:,}/{len(s):,}")
            out.append("")
            if uniq <= 9:
                out.append(f"{'Tabulation:':>20} Freq.   Value")
                vc = s.value_counts(dropna=False).sort_index()
                for val, c in vc.items():
                    lab = ds.value_labels.get(v, {}).get(int(val) if pd.notna(val) and float(val).is_integer() else val, "")
                    out.append(f"{'':>20} {c:>5,}   {fmt_value(val):<8}{lab}")
            else:
                d = s.dropna()
                out.append(f"{'Mean:':>20} {fmt.g(d.mean()).strip()}")
                out.append(f"{'Std. dev.:':>20} {fmt.g(d.std()).strip()}")
                q = d.quantile([0.1, 0.25, 0.5, 0.75, 0.9]).tolist()
                out.append(f"{'Percentiles:':>20} {'10%':>9} {'25%':>9} {'50%':>9} {'75%':>9} {'90%':>9}")
                out.append(f"{'':>20} " + " ".join(fmt.g(x) for x in q))
        else:
            out.append(f"{'Type:':>20} String ({storage_type(s)})")
            out.append(f"{'Unique values:':>20} {uniq:<17}Missing \"\": {nmiss:,}/{len(s):,}")
            if uniq <= 9:
                out.append("")
                out.append(f"{'Tabulation:':>20} Freq.  Value")
                for val, c in s.value_counts().items():
                    out.append(f"{'':>20} {c:>5,}  \"{val}\"")
        out.append("")
    return Result(log="\n".join(out))


def list_(ds: Dataset, cmd: Command) -> Result:
    vars_ = expand_varlist(cmd.args, ds.df)[:8]
    mask = selected(ds, cmd)
    sub = ds.df.loc[mask, vars_].head(50)
    widths = []
    for v in vars_:
        w = max(len(v), 8)
        if v in ds.value_labels:
            w = max(w, min(20, max((len(str(x)) for x in ds.value_labels[v].values()), default=8)))
        widths.append(w)
    head = "     | " + "  ".join(f"{v:>{w}}" for v, w in zip(vars_, widths)) + " |"
    line = "     |" + "-" * (len(head) - 7) + "|"
    out = ["     +" + "-" * (len(head) - 7) + "+", head, line]
    for i, (_, r) in enumerate(sub.iterrows(), start=1):
        cells = []
        for v, w in zip(vars_, widths):
            val = r[v]
            txt = ds.value_label(v, val) if v in ds.value_labels else (fmt.g(val, w).strip() if is_numeric(ds.df[v]) else str(val if pd.notna(val) else ""))
            cells.append(f"{txt[:w]:>{w}}")
        out.append(f"{i:>4}. | " + "  ".join(cells) + " |")
    out.append("     +" + "-" * (len(head) - 7) + "+")
    shown = len(sub)
    if int(mask.sum()) > shown:
        out.append(f"  (showing the first {shown} of {int(mask.sum()):,} observations)")
    return Result(log="\n".join(out))


def count(ds: Dataset, cmd: Command) -> Result:
    k = int(selected(ds, cmd).sum())
    return Result(log=f"  {k:,}", summary={"count": k})
