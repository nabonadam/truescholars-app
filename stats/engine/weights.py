"""Stata weights: [aw=] analytic, [pw=] sampling, [fw=] frequency, [iw=] importance."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .data import Dataset, StataError
from .expr import evaluate

FULL = {"aw": "aweights", "pw": "pweights", "fw": "fweights", "iw": "iweights"}


def weight_values(ds: Dataset, cmd) -> pd.Series | None:
    """The weight expression evaluated on the whole dataset (missing where it can't be used)."""
    if not cmd.weight:
        return None
    w = evaluate(cmd.weight[1], ds.df)
    if not isinstance(w, pd.Series):
        w = pd.Series(float(w), index=ds.df.index)
    if not pd.api.types.is_numeric_dtype(w):
        raise StataError("weights must be numeric")
    return w.astype(float)


def weights(ds: Dataset, cmd, sub: pd.DataFrame, allowed: str) -> tuple[str | None, np.ndarray | None]:
    """(kind, weights for the rows of `sub`) after Stata's checks; (None, None) when unweighted.
    `allowed` lists the kinds this command accepts, e.g. "aw fw iw"."""
    if not cmd.weight:
        return None, None
    kind = cmd.weight[0]
    if kind not in allowed.split():
        alt = {"pw": "aw" if "aw" in allowed else None, "aw": "pw" if "pw" in allowed else None}.get(kind)
        hint = f"; use [{alt}=...] instead" if alt else ""
        raise StataError(f"{FULL[kind]} not allowed with {cmd.name}{hint}")
    w = weight_values(ds, cmd).loc[sub.index].to_numpy(dtype=float)
    if (w < 0).any():
        raise StataError("negative weights encountered")
    if kind == "fw" and np.any(np.mod(w, 1) != 0):
        raise StataError("may not use noninteger frequency weights")
    return kind, w


def normalized(kind: str | None, w: np.ndarray | None, n: int) -> np.ndarray:
    """Analytic weights are rescaled to sum to the number of observations, as Stata does."""
    if w is None:
        return np.ones(n)
    return w * n / w.sum() if kind in ("aw", "pw") else w


def sum_note(kind: str | None, w: np.ndarray | None) -> list[str]:
    """Stata prints '(sum of wgt is ...)' above weighted results."""
    if kind in ("aw", "pw", "iw") and w is not None:
        total = w.sum()
        txt = f"{total:,.0f}" if abs(total - round(total)) < 1e-9 else f"{total:,.4f}".rstrip("0").rstrip(".")
        return [f"(sum of wgt is {txt})"]
    return []
