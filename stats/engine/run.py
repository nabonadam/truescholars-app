"""Running command lines on a dataset, Stata-style: one command at a time, stop at the first error."""

from __future__ import annotations

import traceback

import numpy as np
import pandas as pd

from . import datacmds as dc
from . import statcmds as sc
from .data import Dataset, StataError, is_numeric
from .result import Result
from .syntax import DATA_COMMANDS, parse

HANDLERS = {
    "describe": dc.describe,
    "codebook": dc.codebook,
    "list": dc.list_,
    "count": dc.count,
    "generate": dc.generate,
    "replace": dc.replace,
    "recode": dc.recode,
    "drop": lambda ds, c: dc.drop_keep(ds, c, keep=False),
    "keep": lambda ds, c: dc.drop_keep(ds, c, keep=True),
    "rename": dc.rename,
    "label": dc.label,
    "mvdecode": dc.mvdecode,
    "summarize": sc.summarize,
    "tabulate": sc.tabulate,
    "tab1": sc.tabulate,
    "tab2": sc.tabulate,
    "ttest": sc.ttest,
    "oneway": sc.oneway,
    "anova": sc.anova,
    "correlate": sc.correlate,
    "pwcorr": sc.correlate,
    "spearman": sc.correlate,
    "ranksum": sc.ranksum,
    "kwallis": sc.kwallis,
    "signrank": sc.signrank,
    "regress": sc.regress,
    "logit": sc.binary_or_count,
    "logistic": sc.binary_or_count,
    "probit": sc.binary_or_count,
    "poisson": sc.binary_or_count,
}


def run_line(ds: Dataset, line: str) -> Result:
    """Runs one command; data commands change `ds` in place."""
    stripped = line.strip()
    if not stripped or stripped.startswith(("*", "//")):
        return Result(log="")
    cmd = parse(stripped)
    handler = HANDLERS[cmd.name]
    if not cmd.by:
        return handler(ds, cmd)
    if cmd.name in DATA_COMMANDS:
        raise StataError(f"by: with {cmd.name} is not available yet; use an if condition instead")
    from .expr import resolve_var

    by = [resolve_var(v, ds.df) for v in cmd.by]
    df = ds.df
    keys = df[by].dropna().drop_duplicates().sort_values(by)
    logs, tables, notes = [], [], []
    for _, key in keys.iterrows():
        mask = np.ones(len(df), dtype=bool)
        parts = []
        for v in by:
            mask &= (df[v] == key[v]).to_numpy()
            parts.append(f"{v} = {ds.value_label(v, key[v])}")
        sub = Dataset(df[mask].reset_index(drop=True), ds.var_labels, ds.value_labels, ds.label_sets)
        cmd.by = []
        r = handler(sub, cmd)
        logs += ["-" * 78, f"-> {', '.join(parts)}", "", r.log, ""]
        for t in r.tables:
            t.title = f"{t.title} ({', '.join(parts)})"
        tables += r.tables
        notes += r.notes
    return Result(log="\n".join(logs).rstrip(), tables=tables, notes=list(dict.fromkeys(notes)))


def apply_history(base: Dataset, history: list[str]) -> Dataset:
    ds = base.copy()
    for line in history:
        run_line(ds, line)
    return ds


def run_commands(ds: Dataset, commands: list[str]) -> list[dict]:
    out = []
    failed = False
    for line in commands:
        if failed:
            out.append({"command": line, "ok": False, "skipped": True, "error": "not run (an earlier command failed)"})
            continue
        try:
            r = run_line(ds, line)
            out.append({"command": line, "ok": True, **r.as_dict()})
        except StataError as e:
            failed = True
            out.append({"command": line, "ok": False, "error": str(e)})
        except Exception as e:  # noqa: BLE001
            failed = True
            traceback.print_exc()
            out.append({"command": line, "ok": False, "error": f"something went wrong running this ({type(e).__name__}); please check the variables and try again"})
    return out
