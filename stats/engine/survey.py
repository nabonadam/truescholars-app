"""Complex survey designs: svyset, and svy: mean / proportion / tabulate / regress / logit /
logistic / probit / poisson with Taylor-linearized (design-based) standard errors, as Stata."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats as st

from . import fmt
from .data import Dataset, StataError, is_numeric
from .expr import evaluate, resolve_var
from .result import Result, Table
from .syntax import Command, expand_varlist

RULE = "-" * 78


# ───────────── svyset ─────────────


def svyset(ds: Dataset, cmd: Command) -> Result:
    args = cmd.args.strip()
    if args.lower() in ("", "clear") and not cmd.weight:
        if args.lower() == "clear":
            ds.settings.pop("svy", None)
            return Result(log="(survey design cleared)", changes_data=True)
        svy = ds.settings.get("svy")
        return Result(log=_describe(svy) if svy else "no survey characteristics are set")
    psu = args.split()[0] if args else "_n"
    if psu != "_n":
        psu = resolve_var(psu, ds.df)
    if cmd.weight and cmd.weight[0] != "pw":
        raise StataError("svyset takes sampling weights: svyset psu [pw=weight], strata(stratum)")
    strata = cmd.opt("strata")
    strata = resolve_var(strata.strip(), ds.df) if isinstance(strata, str) else None
    fpc = cmd.opt("fpc")
    svy = {"psu": psu, "weight": cmd.weight[1] if cmd.weight else None, "strata": strata, "fpc": resolve_var(fpc.strip(), ds.df) if isinstance(fpc, str) else None}
    ds.settings["svy"] = svy
    return Result(log=_describe(svy), changes_data=True)


def _describe(svy: dict) -> str:
    return "\n".join([
        f"{'Sampling weights:':>18} {svy['weight'] or '<none>'}",
        f"{'VCE:':>18} linearized",
        f"{'Single unit:':>18} missing",
        f"{'Strata 1:':>18} {svy['strata'] or '<one>'}",
        f"{'Sampling unit 1:':>18} {svy['psu'] if svy['psu'] != '_n' else '<observations>'}",
        f"{'FPC 1:':>18} {svy['fpc'] or '<zero>'}",
    ])


def design(ds: Dataset, cmd: Command, vars_: list[str]):
    """Estimation sample and design arrays. Returns (sub, w, strata ids, psu ids, fpc or None)."""
    svy = ds.settings.get("svy")
    if not svy:
        raise StataError("data not set up for svy, use svyset")
    from .datacmds import selected
    from .statcmds import _nonmissing

    need = list(vars_) + [v for v in (svy["psu"] if svy["psu"] != "_n" else None, svy["strata"], svy["fpc"]) if v]
    mask = selected(ds, cmd) & _nonmissing(ds.df, need)
    if svy["weight"]:
        w_all = evaluate(svy["weight"], ds.df)
        w_all = pd.Series(w_all, index=ds.df.index) if not isinstance(w_all, pd.Series) else w_all
        mask &= w_all.notna() & w_all.gt(0)
    sub = ds.df[mask]
    if len(sub) == 0:
        raise StataError("no observations")
    w = w_all.loc[sub.index].to_numpy(dtype=float) if svy["weight"] else np.ones(len(sub))
    strata = pd.factorize(sub[svy["strata"]])[0] if svy["strata"] else np.zeros(len(sub), dtype=int)
    psu = pd.factorize(sub[svy["psu"]].astype(str) + "|" + pd.Series(strata, index=sub.index).astype(str))[0] if svy["psu"] != "_n" else np.arange(len(sub))
    fpc = sub[svy["fpc"]].to_numpy(dtype=float) if svy["fpc"] else None
    return sub, w, strata, psu, fpc


def svy_cov(U: np.ndarray, strata: np.ndarray, psu: np.ndarray, fpc: np.ndarray | None = None) -> np.ndarray:
    """Linearized variance: PSU totals of the influence contributions, centred within strata."""
    U = U.reshape(len(U), -1)
    k = U.shape[1]
    V = np.zeros((k, k))
    for h in np.unique(strata):
        inh = strata == h
        ids = psu[inh]
        uniq = np.unique(ids)
        nh = len(uniq)
        if nh < 2:
            raise StataError("missing standard error because of stratum with single sampling unit")
        Z = np.zeros((nh, k))
        idx = np.searchsorted(uniq, ids)
        np.add.at(Z, idx, U[inh])
        Zc = Z - Z.mean(axis=0)
        f = 0.0
        if fpc is not None:
            v = fpc[inh][0]
            f = nh / v if v >= 1 else v  # fpc as population count of PSUs, or as a sampling rate
        V += (1 - f) * nh / (nh - 1) * Zc.T @ Zc
    return V


def design_df(strata: np.ndarray, psu: np.ndarray) -> int:
    return len(np.unique(psu)) - len(np.unique(strata))


def _header(title: str, strata, psu, n: int, popsize: float, ddf: int, extra: list[tuple[str, str]]) -> list[str]:
    right = [("Number of obs", f"{n:,}"), ("Population size", f"{popsize:,.0f}" if abs(popsize - round(popsize)) < 1e-6 else fmt.g(popsize).strip()), ("Design df", f"{ddf:,}")] + extra
    left = [f"Number of strata = {len(np.unique(strata)):>6,}", f"Number of PSUs   = {len(np.unique(psu)):>6,}"]
    lines = [f"Survey: {title}", ""]
    for i, (lab, val) in enumerate(right):
        l = left[i] if i < len(left) else ""
        lines.append(f"{l:<48}{lab:<16}= {val:>10}")
    lines.append("")
    return lines


# ───────────── svy: mean / proportion ─────────────


def svy_mean(ds: Dataset, cmd: Command, proportion: bool = False) -> Result:
    from .statcmds import _levels, level_label, nice

    vs = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    over = cmd.opt("over")
    over = resolve_var(over.strip(), ds.df) if isinstance(over, str) else None
    sub, w, strata, psu, fpc = design(ds, cmd, vs + ([over] if over else []))
    ddf = design_df(strata, psu)
    tcrit = st.t.ppf(0.975, ddf)
    groups = [(None, np.ones(len(sub), dtype=bool))] if not over else [(lv, (sub[over] == lv).to_numpy()) for lv in _levels(ds, sub[over], False)]
    rows, summ = [], []
    col = "Proportion" if proportion else "Mean"
    lines = _header(f"{col} estimation", strata, psu, len(sub), w.sum(), ddf, [])
    lines += ["-" * 62, f"{'':12} |{'Linearized':>24}" + ("" if not proportion else f"{'Logit':>16}"), f"{'':12} |{col:>11}   std. err.     [95% conf. interval]", fmt.rule(13, 48)]
    for v in vs:
        if not proportion and not is_numeric(sub[v]):
            raise StataError(f"{v} is a string variable")
        targets = [(None, sub[v].astype(float).to_numpy())] if not proportion else [(lv, (sub[v] == lv).to_numpy().astype(float)) for lv in _levels(ds, sub[v], False)]
        if proportion or over:
            lines.append(f"{fmt.name(v if not over else ('c.' + v + '@' + over if not proportion else v))} |")
        for olv, g in groups:
            if proportion and over:
                lines.append(f"{fmt.name(level_label(ds, over, olv))} |")
            for tlv, y in targets:
                wg = w * g
                W = wg.sum()
                m = float((wg * y).sum() / W)
                U = wg * (y - m) / W
                se = math.sqrt(float(svy_cov(U, strata, psu, fpc)[0, 0]))
                if proportion and 0 < m < 1:
                    l, sl = math.log(m / (1 - m)), se / (m * (1 - m))
                    lo, hi = 1 / (1 + math.exp(-(l - tcrit * sl))), 1 / (1 + math.exp(-(l + tcrit * sl)))
                else:
                    lo, hi = m - tcrit * se, m + tcrit * se
                lab = level_label(ds, v, tlv) if proportion else (level_label(ds, over, olv) if over else v)
                lines.append(f"{fmt.name(lab)} |{fmt.g(m, 11)}{fmt.g(se, 11)}{fmt.g(lo, 14)}{fmt.g(hi, 11)}")
                grp = (level_label(ds, over, olv) + ": ") if over and proportion else ""
                rows.append([grp + (lab if proportion or over else nice(ds, v)), fmt.apa_num(m, 3 if proportion else 2), fmt.apa_num(se, 3 if proportion else 2), f"[{fmt.apa_num(lo, 3 if proportion else 2)}, {fmt.apa_num(hi, 3 if proportion else 2)}]"])
                summ.append({"var": v, "value": lab, "group": level_label(ds, over, olv) if over else None, "estimate": m, "se": se, "ci": [lo, hi]})
    lines.append("-" * 62)
    t = Table(f"Survey-weighted {col.lower()}s" + (f" by {nice(ds, over)}" if over else ""), ["Estimate", col, "SE", "95% CI"], rows, note=f"N = {len(sub):,}; population size {w.sum():,.0f}; design df = {ddf}. Linearized standard errors.")
    return Result(log="\n".join(lines), tables=[t], summary={"svy": col.lower(), "rows": summ, "design_df": ddf})


# ───────────── svy: tabulate ─────────────


def svy_tab(ds: Dataset, cmd: Command) -> Result:
    from .statcmds import _levels, level_label, nice

    vs = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    if len(vs) == 1:
        cmd.args = vs[0]
        return svy_mean(ds, cmd, proportion=True)
    if len(vs) != 2:
        raise StataError("svy: tabulate takes one or two variables")
    rv, cv = vs
    sub, w, strata, psu, fpc = design(ds, cmd, [rv, cv])
    ddf = design_df(strata, psu)
    rl, cl = _levels(ds, sub[rv], False), _levels(ds, sub[cv], False)
    W = w.sum()
    cells = [((sub[rv] == r) & (sub[cv] == c)).to_numpy().astype(float) for r in rl for c in cl]
    P = np.array([(w * x).sum() / W for x in cells]).reshape(len(rl), len(cl))
    col_pct = bool(cmd.opt("column"))
    row_pct = bool(cmd.opt("row"))
    pr, pc = P.sum(1), P.sum(0)
    # Pearson chi2 on weighted proportions, Rao–Scott first-order design correction
    n = len(sub)
    E = np.outer(pr, pc)
    X2 = n * float(((P - E) ** 2 / E).sum())
    dfree = (len(rl) - 1) * (len(cl) - 1)
    Umat = np.column_stack([w * (x - (w * x).sum() / W) / W for x in cells])
    Vd = svy_cov(Umat, strata, psu, fpc)
    p = P.ravel()
    Vsrs = (np.diag(p) - np.outer(p, p)) / n
    C = _contrast(len(rl), len(cl), pr, pc)
    A = np.linalg.pinv(C @ Vsrs @ C.T) @ (C @ Vd @ C.T)
    delta = float(np.trace(A) / dfree)
    F = X2 / (delta * dfree)
    df1, df2 = dfree, dfree * ddf
    pF = float(st.f.sf(F, df1, df2))
    shown = P / pc[None, :] if col_pct else (P / pr[:, None] if row_pct else P)
    what = "column proportion" if col_pct else ("row proportion" if row_pct else "cell proportion")
    lines = _header("Two-way tabulation", strata, psu, n, W, ddf, [])
    width = 11 * len(cl)
    lines += [f"{'':12} |{cv:^{width}}|", f"{fmt.name(rv)} |" + "".join(f"{level_label(ds, cv, c)[:10]:>11}" for c in cl) + f" |{'Total':>10}", fmt.rule(13, width) + "+" + "-" * 11]
    for i, r in enumerate(rl):
        tot = 1.0 if row_pct else (pr[i] if not col_pct else pr[i])
        lines.append(f"{fmt.name(level_label(ds, rv, r))} |" + "".join(f"{x:>11.4f}" for x in shown[i]) + f" |{tot:>10.4f}")
    lines.append(fmt.rule(13, width) + "+" + "-" * 11)
    lines.append(f"{'Total':>12} |" + "".join(f"{(1.0 if col_pct else x):>11.4f}" for x in pc) + f" |{1.0:>10.4f}")
    lines += ["", f"  Key: {what}s", "", "  Pearson:", f"    Uncorrected   chi2({dfree}) = {X2:>10.4f}", f"    Design-based  F({df1}, {df2}) = {F:>8.4f}     P = {pF:.4f}"]
    rows = [[level_label(ds, rv, r)] + [f"{100 * x:.1f}%" for x in shown[i]] for i, r in enumerate(rl)]
    t = Table(f"{nice(ds, rv)} by {nice(ds, cv)} (survey-weighted)", [nice(ds, rv)] + [level_label(ds, cv, c) for c in cl], rows, note=f"Weighted {what}s. Design-based F({df1}, {df2}) = {F:.2f}, p {('< .001' if pF < 0.001 else '= ' + fmt.apa_p(pF))} (Rao–Scott correction). Design df = {ddf}.")
    return Result(log="\n".join(lines), tables=[t], summary={"chi2_uncorrected": X2, "F": F, "df": [df1, df2], "p": pF}, notes=["The design-based F uses the first-order Rao–Scott correction; Stata's default second-order version can differ slightly in the second decimal."])


def _contrast(r: int, c: int, pr, pc) -> np.ndarray:
    """Contrasts for independence (interaction log-linear terms, linearised at the margins)."""
    rows = []
    for i in range(r - 1):
        for j in range(c - 1):
            v = np.zeros((r, c))
            v[i, j], v[i + 1, j], v[i, j + 1], v[i + 1, j + 1] = 1, -1, -1, 1
            rows.append(v.ravel())
    return np.array(rows)


# ───────────── svy: regress / logit / logistic / probit / poisson ─────────────


def svy_model(ds: Dataset, cmd: Command) -> Result:
    from .statcmds import _coef_table, _apa_reg_rows, build_design, _drop_collinear, nice, remember
    from .syntax import parse_fvlist

    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError(f"use: svy: {cmd.name} outcome predictors")
    y = resolve_var(toks[0], ds.df)
    terms = parse_fvlist(toks[1], ds.df)
    vars_ = [y] + sorted({p[1] for t in terms for p in t.parts})
    sub, w, strata, psu, fpc = design(ds, cmd, vars_)
    rec: dict = {}
    cols = build_design(ds, sub, terms, record=rec)
    X = np.column_stack([c.values for c in cols]) if cols else np.empty((len(sub), 0))
    X, cols, omitted = _drop_collinear(X, cols)
    Xc = np.column_stack([X, np.ones(len(sub))])
    n, k = Xc.shape
    yraw = sub[y].astype(float).to_numpy()
    kind = cmd.name
    if kind == "regress":
        b = np.linalg.solve(Xc.T @ (Xc * w[:, None]), Xc.T @ (w * yraw))
        e = yraw - Xc @ b
        Hinv = np.linalg.inv(Xc.T @ (Xc * w[:, None]))
        U = (Xc * (w * e)[:, None]) @ Hinv
        ybar = (w * yraw).sum() / w.sum()
        r2 = 1 - (w * e**2).sum() / (w * (yraw - ybar) ** 2).sum()
        extra_stat = [("R-squared", f"{r2:.4f}")]
        title, stat_name, coef_name = "Linear regression", "t", "Coefficient"
        yv = yraw
    else:
        yv = yraw if kind == "poisson" else (yraw != 0).astype(float)
        fam = sm.families.Poisson() if kind == "poisson" else sm.families.Binomial(link=sm.families.links.Probit() if kind == "probit" else sm.families.links.Logit())
        glm = sm.GLM(yv, Xc, family=fam, freq_weights=w)
        b = glm.fit().params
        U = glm.score_obs(b) @ np.linalg.inv(-glm.hessian(b))
        extra_stat = []
        title = {"logit": "Logistic regression", "logistic": "Logistic regression", "probit": "Probit regression", "poisson": "Poisson regression"}[kind]
        stat_name, coef_name = "t", "Coefficient"
    V = svy_cov(U, strata, psu, fpc)
    ddf = design_df(strata, psu)
    se = np.sqrt(np.diag(V))
    tval = b / se
    pv = 2 * st.t.sf(np.abs(tval), ddf)
    tc = st.t.ppf(0.975, ddf)
    lo, hi = b - tc * se, b + tc * se
    q = k - 1
    if q > 0:
        R = np.eye(k)[:-1]
        Wald = float((R @ b) @ np.linalg.solve(R @ V @ R.T, R @ b))
        F = Wald / q * (ddf - q + 1) / ddf  # adjusted Wald, as Stata
        df2 = ddf - q + 1
        pF = float(st.f.sf(F, q, df2)) if df2 > 0 else float("nan")
    else:
        F, df2, pF = float("nan"), 0, float("nan")
    lines = _header(title, strata, psu, n, w.sum(), ddf, [(f"F({q}, {df2})", f"{F:.2f}"), ("Prob > F", f"{pF:.4f}")] + extra_stat)
    want_or = kind == "logistic" or (kind == "logit" and cmd.opt("or"))
    want_irr = kind == "poisson" and cmd.opt("irr")
    if want_or or want_irr:
        ex = np.exp(b)
        lines += _coef_table(y, cols, omitted, ex, ex * se, tval, pv, np.exp(lo), np.exp(hi), stat_name, "Odds ratio" if want_or else "IRR", robust_word="Linearized")
        rows, groups = _apa_reg_rows(cols, b, se, tval, pv, lo, hi, transform=np.exp, labels=ds.var_labels)
        cols_apa = ["Predictor", "OR" if want_or else "IRR", "95% CI", "t", "p"]
    else:
        lines += _coef_table(y, cols, omitted, b, se, tval, pv, lo, hi, stat_name, coef_name, robust_word="Linearized")
        rows, groups = _apa_reg_rows(cols, b, se, tval, pv, lo, hi, labels=ds.var_labels)
        cols_apa = ["Predictor", "B", "SE", "t", "p", "95% CI"]
    cmd._design = (terms, rec)
    remember(ds, cmd, kind, y, sub, cols, b, V, ddf, w, {"n": n, "X": Xc, "yv": yv, "robust": True, "svy": True, "pred": None})
    note = f"N = {n:,}; population size {w.sum():,.0f}; design df = {ddf}. F({q}, {df2}) = {fmt.apa_num(F)}, p {('< .001' if pF < 0.001 else '= ' + fmt.apa_p(pF))}. Linearized (design-based) standard errors. *p < .05. **p < .01. ***p < .001."
    t = Table(f"Survey-weighted {title.lower()} predicting {nice(ds, y)}", cols_apa, rows, note=note, groups=groups)
    summ = {"model": f"svy {title}", "depvar": y, "n": n, "design_df": ddf, "F": F, "p_F": pF, "coefs": [{"term": (c.group + "=" if c.group else "") + c.label, "b": float(b[i]), "se": float(se[i]), "t": float(tval[i]), "p": float(pv[i])} for i, c in enumerate(cols)]}
    return Result(log="\n".join(lines), tables=[t], summary=summ)


SVY_COMMANDS = {"mean", "proportion", "tabulate", "regress", "logit", "logistic", "probit", "poisson"}


def svy_dispatch(ds: Dataset, cmd: Command) -> Result:
    if cmd.name not in SVY_COMMANDS:
        raise StataError(f"svy: {cmd.name} isn't available; svy works with mean, proportion, tabulate, regress, logit, logistic, probit and poisson")
    if cmd.weight:
        raise StataError("weights not allowed with svy:; the weight is set by svyset")
    if cmd.name == "mean":
        return svy_mean(ds, cmd)
    if cmd.name == "proportion":
        return svy_mean(ds, cmd, proportion=True)
    if cmd.name == "tabulate":
        return svy_tab(ds, cmd)
    return svy_model(ds, cmd)
