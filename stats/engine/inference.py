"""Estimates and tests from the political-analysis curriculum: mean, proportion, ci, prtest,
mean-comparison tables (tabulate, summarize()), and ordinal/nominal measures of association
(gamma, Kendall's tau-b, Somers' D, lambda). Printed the way Stata prints them."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats as st

from . import fmt
from .data import Dataset, StataError, is_numeric
from .expr import resolve_var
from .result import Result, Table
from .statcmds import _levels, level_label, nice, sample
from .syntax import Command, expand_varlist
from .weights import sum_note, weights

RULE = "-" * 78


def _level(cmd: Command) -> float:
    lv = cmd.opt("level")
    return float(lv) / 100 if isinstance(lv, str) else 0.95


def _over(ds: Dataset, cmd: Command) -> str | None:
    o = cmd.opt("over")
    return resolve_var(o.split(",")[0].strip(), ds.df) if isinstance(o, str) else None


def _groups(ds: Dataset, sub: pd.DataFrame, over: str | None):
    if not over:
        return [(None, np.ones(len(sub), dtype=bool))]
    return [(lv, (sub[over] == lv).to_numpy()) for lv in _levels(ds, sub[over], False)]


def _mean_se(y: np.ndarray, w: np.ndarray, g: np.ndarray, kind: str | None) -> tuple[float, float, float]:
    """(estimate, standard error, number of obs) for the mean of y within group g.
    Unweighted and fw: s/sqrt(n). pw/aw/iw: linearized (Taylor) standard error, as Stata's mean."""
    yg, wg = y[g], w[g]
    W = wg.sum()
    m = float((wg * yg).sum() / W)
    if kind in (None, "fw"):
        n = W
        var = float((wg * (yg - m) ** 2).sum() / (n - 1)) if n > 1 else float("nan")
        return m, math.sqrt(var / n) if n > 1 else float("nan"), n
    z = wg * (yg - m) / W
    ng = len(yg)
    return m, math.sqrt(ng / (ng - 1) * float((z**2).sum())) if ng > 1 else float("nan"), ng


# ───────────── mean ─────────────


def mean(ds: Dataset, cmd: Command) -> Result:
    vs = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    for v in vs:
        if not is_numeric(ds.df[v]):
            raise StataError(f"{v} is a string variable")
    over = _over(ds, cmd)
    sub = sample(ds, cmd, vs + ([over] if over else []))
    if len(sub) == 0:
        raise StataError("no observations")
    kind, wraw = weights(ds, cmd, sub, "aw pw fw iw")
    w = np.ones(len(sub)) if wraw is None else wraw
    N = int(round(w.sum())) if kind == "fw" else len(sub)
    lev = _level(cmd)
    tcrit = st.t.ppf(1 - (1 - lev) / 2, N - 1)
    lines = sum_note(kind, wraw) + [f"{'Mean estimation':<46}Number of obs = {N:>9,}", ""]
    lab_w = 15 if over else 12
    lines += ["-" * (lab_w + 50), f"{'':{lab_w}} |       Mean   Std. err.     [{lev:.0%} conf. interval]".replace("95%", "95%"), "-" * lab_w + "-+" + "-" * 49]
    rows, summ = [], []
    for v in vs:
        y = sub[v].astype(float).to_numpy()
        if over:
            lines.append(f"{('c.' + v + '@' + over)[:lab_w]:<{lab_w}} |")
        for lv, g in _groups(ds, sub, over):
            if g.sum() == 0:
                continue
            m, se, n = _mean_se(y, w, g, kind)
            lo, hi = m - tcrit * se, m + tcrit * se
            label = level_label(ds, over, lv) if over else v
            lines.append(f"{fmt.name(label, lab_w)} |{fmt.g(m, 11)}{fmt.g(se, 11)}{fmt.g(lo, 14)}{fmt.g(hi, 11)}")
            rows.append([(f"{nice(ds, v)}: " if len(vs) > 1 and over else "") + (label if over else nice(ds, v)), _n(n), fmt.apa_num(m), fmt.apa_num(se), f"[{fmt.apa_num(lo)}, {fmt.apa_num(hi)}]"])
            summ.append({"var": v, "group": label if over else None, "mean": m, "se": se, "n": n, "ci": [lo, hi]})
    lines.append("-" * (lab_w + 50))
    wnote = f" Weighted ({cmd.weight[0]}={cmd.weight[1]}); {'linearized' if kind in ('pw', 'aw', 'iw') else 'standard'} standard errors." if kind else ""
    title = f"Mean of {nice(ds, vs[0])}" + (f" by {nice(ds, over)}" if over else "") if len(vs) == 1 else "Means"
    t = Table(title, ["Group" if over else "Variable", "n", "M", "SE", f"{lev:.0%} CI"], rows, note=f"N = {N:,}.{wnote}")
    return Result(log="\n".join(lines), tables=[t], summary={"means": summ, "weight": cmd.weight})


def _n(n: float) -> str:
    return f"{int(round(n)):,}" if abs(n - round(n)) < 1e-9 else f"{n:,.1f}"


# ───────────── proportion ─────────────


def proportion(ds: Dataset, cmd: Command) -> Result:
    vs = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    over = _over(ds, cmd)
    sub = sample(ds, cmd, vs + ([over] if over else []))
    if len(sub) == 0:
        raise StataError("no observations")
    kind, wraw = weights(ds, cmd, sub, "pw fw iw aw")
    w = np.ones(len(sub)) if wraw is None else wraw
    N = int(round(w.sum())) if kind == "fw" else len(sub)
    lev = _level(cmd)
    tcrit = st.t.ppf(1 - (1 - lev) / 2, N - 1)
    lines = sum_note(kind, wraw) + [f"{'Proportion estimation':<46}Number of obs = {N:>9,}", "", "-" * 62, f"{'':12} |{'Logit':>40}", f"{'':12} | Proportion   Std. err.     [{lev:.0%} conf. interval]", fmt.rule(13, 48)]
    rows, summ = [], []
    for v in vs:
        lines.append(f"{fmt.name(v)} |")
        for olv, g in _groups(ds, sub, over):
            if over:
                lines.append(f"{fmt.name(level_label(ds, over, olv))} |")
            for lv in _levels(ds, sub[v], False):
                ind = (sub[v] == lv).to_numpy().astype(float)
                p, se, n = _mean_se(ind, w, g, kind)
                if 0 < p < 1:
                    l = math.log(p / (1 - p))
                    sl = se / (p * (1 - p))
                    lo, hi = 1 / (1 + math.exp(-(l - tcrit * sl))), 1 / (1 + math.exp(-(l + tcrit * sl)))
                else:
                    lo = hi = float("nan")
                lab = level_label(ds, v, lv)
                lines.append(f"{fmt.name(lab)} |{fmt.g(p, 11)}{fmt.g(se, 11)}{fmt.g(lo, 14)}{fmt.g(hi, 11)}")
                grp = f"{level_label(ds, over, olv)}: " if over else ""
                rows.append([grp + lab, f"{p:.3f}".lstrip("0"), f"{se:.3f}".lstrip("0"), f"[{lo:.3f}, {hi:.3f}]".replace("0.", ".")])
                summ.append({"var": v, "value": lab, "group": level_label(ds, over, olv) if over else None, "proportion": p, "se": se, "ci": [lo, hi]})
    lines.append("-" * 62)
    wnote = f" Weighted ({cmd.weight[0]}={cmd.weight[1]})." if kind else ""
    t = Table(f"Proportions of {nice(ds, vs[0])}" + (f" by {nice(ds, over)}" if over else ""), ["Category", "Proportion", "SE", f"{lev:.0%} CI"], rows, note=f"N = {N:,}. Confidence intervals use the logit transform, as Stata does.{wnote}")
    return Result(log="\n".join(lines), tables=[t], summary={"proportions": summ})


# ───────────── ci ─────────────


def ci(ds: Dataset, cmd: Command) -> Result:
    toks = cmd.args.split(None, 1)
    if not toks or toks[0].lower() not in ("means", "mean", "proportions", "proportion", "prop"):
        raise StataError("use: ci means varlist   or   ci proportions varlist")
    which = "means" if toks[0].lower().startswith("mean") else "proportions"
    vs = expand_varlist(toks[1] if len(toks) > 1 else "", ds.df, allow_empty_all=False)
    lev = _level(cmd)
    lines, rows, summ = [], [], []
    if which == "means":
        lines += [f"{'Variable':>12} |{'Obs':>11}{'Mean':>12}{'Std. err.':>13}{f'[{lev:.0%} conf. interval]':>28}", fmt.rule(13, 63)]
    else:
        method = "wilson" if cmd.opt("wilson") else "wald" if cmd.opt("wald") else "agresti" if cmd.opt("agresti") else "jeffreys" if cmd.opt("jeffreys") else "exact"
        head = {"exact": "Binomial exact", "wilson": "Wilson", "wald": "Binomial Wald", "agresti": "Agresti–Coull", "jeffreys": "Jeffreys"}[method]
        lines += [f"{'':57}{head}", f"{'Variable':>12} |{'Obs':>11}{'Proportion':>12}{'Std. err.':>13}{f'[{lev:.0%} conf. interval]':>28}", fmt.rule(13, 63)]
    for v in vs:
        if not is_numeric(ds.df[v]):
            raise StataError(f"{v} is a string variable")
        sub = sample(ds, cmd, [v])
        kind, wraw = weights(ds, cmd, sub, "aw fw") if which == "means" else weights(ds, cmd, sub, "fw")
        y = sub[v].astype(float).to_numpy()
        w = np.ones(len(y)) if wraw is None else (wraw * len(y) / wraw.sum() if kind == "aw" else wraw)
        n = w.sum() if kind == "fw" else len(y)
        if which == "means":
            m = float((w * y).sum() / w.sum())
            var = float((w * (y - m) ** 2).sum() / (w.sum() - 1)) if w.sum() > 1 else float("nan")
            se = math.sqrt(var / n)
            tc = st.t.ppf(1 - (1 - lev) / 2, n - 1)
            lo, hi = m - tc * se, m + tc * se
            lines.append(f"{fmt.name(v)} |{_n(n):>11}{fmt.g(m, 12)}{fmt.g(se, 13)}{fmt.g(lo, 15)}{fmt.g(hi, 12)}")
            rows.append([nice(ds, v), _n(n), fmt.apa_num(m), fmt.apa_num(se), f"[{fmt.apa_num(lo)}, {fmt.apa_num(hi)}]"])
            summ.append({"var": v, "n": n, "mean": m, "se": se, "ci": [lo, hi]})
        else:
            if not set(np.unique(y)) <= {0.0, 1.0}:
                raise StataError(f"{v} must be coded 0/1 for ci proportions (create an indicator with generate)")
            x = float((w * y).sum())
            p = x / n
            se = math.sqrt(p * (1 - p) / n)
            a = 1 - lev
            zc = st.norm.ppf(1 - a / 2)
            if method == "exact":
                lo = 0.0 if x == 0 else float(st.beta.ppf(a / 2, x, n - x + 1))
                hi = 1.0 if x == n else float(st.beta.ppf(1 - a / 2, x + 1, n - x))
            elif method == "wald":
                lo, hi = p - zc * se, p + zc * se
            elif method == "wilson":
                c = (p + zc**2 / (2 * n)) / (1 + zc**2 / n)
                h = zc * math.sqrt(p * (1 - p) / n + zc**2 / (4 * n * n)) / (1 + zc**2 / n)
                lo, hi = c - h, c + h
            elif method == "agresti":
                nt = n + zc**2
                pt = (x + zc**2 / 2) / nt
                h = zc * math.sqrt(pt * (1 - pt) / nt)
                lo, hi = pt - h, pt + h
            else:
                lo, hi = float(st.beta.ppf(a / 2, x + 0.5, n - x + 0.5)), float(st.beta.ppf(1 - a / 2, x + 0.5, n - x + 0.5))
            lines.append(f"{fmt.name(v)} |{_n(n):>11}{fmt.g(p, 12)}{fmt.g(se, 13)}{fmt.g(lo, 15)}{fmt.g(hi, 12)}")
            rows.append([nice(ds, v), _n(n), f"{p:.3f}".lstrip("0"), f"{se:.3f}".lstrip("0"), f"[{lo:.3f}, {hi:.3f}]".replace("0.", ".")])
            summ.append({"var": v, "n": n, "proportion": p, "se": se, "ci": [lo, hi], "method": method})
    col = "M" if which == "means" else "Proportion"
    t = Table(f"{lev:.0%} confidence intervals", ["Variable", "n", col, "SE", f"{lev:.0%} CI"], rows)
    return Result(log="\n".join(lines), tables=[t], summary={"ci": which, "rows": summ})


# ───────────── prtest ─────────────


def _pvals(z: float) -> tuple[float, float, float]:
    return float(st.norm.cdf(z)), float(2 * st.norm.sf(abs(z))), float(st.norm.sf(z))


def prtest(ds: Dataset, cmd: Command) -> Result:
    args = cmd.args.strip()
    by = cmd.opt("by")
    lev = _level(cmd)
    zc = st.norm.ppf(1 - (1 - lev) / 2)

    def vals(v, sub):
        y = sub[v].astype(float).to_numpy()
        if not set(np.unique(y)) <= {0.0, 1.0}:
            raise StataError(f"{v} is not a 0/1 variable")
        return y

    if "==" in args:
        a, b = [x.strip() for x in args.split("==", 1)]
        va = resolve_var(a, ds.df)
        try:
            p0 = float(b)
            two_var = False
        except ValueError:
            vb = resolve_var(b, ds.df)
            two_var = True
        if not two_var:
            sub = sample(ds, cmd, [va])
            y = vals(va, sub)
            n, p = len(y), y.mean()
            se = math.sqrt(p * (1 - p) / n)
            z = (p - p0) / math.sqrt(p0 * (1 - p0) / n)
            lo, hi = p - zc * se, p + zc * se
            pl, pt, pr = _pvals(z)
            lines = [
                f"{'One-sample test of proportion':<48}{fmt.name(va, 10)}: Number of obs = {n:>8,}",
                "",
                RULE,
                f"{'Variable':>12} |       Mean   Std. err.{'':22}[{lev:.0%} conf. interval]",
                fmt.rule(13, 64),
                f"{fmt.name(va)} |{fmt.g(p, 11)}{fmt.g(se, 11)}{'':23}{fmt.g(lo, 10)}{fmt.g(hi, 12)}",
                RULE,
                f"    p = proportion({va}){'':>{max(1, 47 - len(va))}}z = {z:>9.4f}",
                f"H0: p = {fmt.g(p0).strip()}",
                "",
                f"     Ha: p < {fmt.g(p0).strip():<17}Ha: p != {fmt.g(p0).strip():<17}Ha: p > {fmt.g(p0).strip()}",
                f" Pr(Z < z) = {pl:.4f}         Pr(|Z| > |z|) = {pt:.4f}          Pr(Z > z) = {pr:.4f}",
            ]
            t = Table(f"One-sample test of the proportion of {nice(ds, va)}", ["n", "Proportion", "SE", f"{lev:.0%} CI", "H₀", "z", "p"], [[f"{n:,}", f"{p:.3f}".lstrip("0"), f"{se:.3f}".lstrip("0"), f"[{lo:.3f}, {hi:.3f}]".replace("0.", "."), fmt.g(p0).strip(), fmt.apa_num(z), fmt.apa_p(pt)]])
            return Result(log="\n".join(lines), tables=[t], summary={"test": "one-sample proportion", "n": n, "p_hat": p, "p0": p0, "z": z, "p": pt})
        sub = sample(ds, cmd, [va, vb])
        y1, y2 = vals(va, sub), vals(vb, sub)
        groups = [(va, y1), (vb, y2)]
        head = "Two-sample test of proportions"
    elif isinstance(by, str):
        v = resolve_var(args, ds.df)
        g = resolve_var(by, ds.df)
        sub = sample(ds, cmd, [v, g])
        levels = _levels(ds, sub[g], False)
        if len(levels) != 2:
            raise StataError(f"{g} must have exactly 2 groups (it has {len(levels)})")
        y = vals(v, sub)
        groups = [(level_label(ds, g, lv), y[(sub[g] == lv).to_numpy()]) for lv in levels]
        head = "Two-sample test of proportions"
    else:
        raise StataError("use: prtest var == 0.5  |  prtest var, by(group)  |  prtest var1 == var2")
    (la, a), (lb, b) = groups
    n1, n2 = len(a), len(b)
    p1, p2 = a.mean(), b.mean()
    se1, se2 = math.sqrt(p1 * (1 - p1) / n1), math.sqrt(p2 * (1 - p2) / n2)
    d = p1 - p2
    se_d = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    pp = (a.sum() + b.sum()) / (n1 + n2)
    se0 = math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2))
    z = d / se0
    pl, pt, pr = _pvals(z)
    zi = [p1 / se1 if se1 else float("nan"), p2 / se2 if se2 else float("nan")]
    lines = [
        f"{head:<51}{fmt.name(la, 10)}: Number of obs = {n1:>8,}",
        f"{'':51}{fmt.name(lb, 10)}: Number of obs = {n2:>8,}",
        RULE,
        f"{'Group':>12} |       Mean   Std. err.      z    P>|z|     [{lev:.0%} conf. interval]",
        fmt.rule(13, 64),
        f"{fmt.name(la)} |{fmt.g(p1, 11)}{fmt.g(se1, 11)}{'':23}{fmt.g(p1 - zc * se1, 10)}{fmt.g(p1 + zc * se1, 12)}",
        f"{fmt.name(lb)} |{fmt.g(p2, 11)}{fmt.g(se2, 11)}{'':23}{fmt.g(p2 - zc * se2, 10)}{fmt.g(p2 + zc * se2, 12)}",
        fmt.rule(13, 64),
        f"{'diff':>12} |{fmt.g(d, 11)}{fmt.g(se_d, 11)}{'':23}{fmt.g(d - zc * se_d, 10)}{fmt.g(d + zc * se_d, 12)}",
        f"{'':12} |  under H0:{fmt.g(se0, 11)}{z:>8.2f}{pt:>8.3f}",
        RULE,
        f"        diff = prop({la}) - prop({lb}){'':>{max(1, 34 - len(la) - len(lb))}}z = {z:>9.4f}",
        "    H0: diff = 0",
        "",
        "    Ha: diff < 0                 Ha: diff != 0                 Ha: diff > 0",
        f" Pr(Z < z) = {pl:.4f}         Pr(|Z| > |z|) = {pt:.4f}          Pr(Z > z) = {pr:.4f}",
    ]
    _ = zi
    t = Table(f"Difference in proportions: {la} vs {lb}", ["Group", "n", "Proportion", "SE"], [[la, f"{n1:,}", f"{p1:.3f}".lstrip("0"), f"{se1:.3f}".lstrip("0")], [lb, f"{n2:,}", f"{p2:.3f}".lstrip("0"), f"{se2:.3f}".lstrip("0")]], note=f"Difference = {d:.3f}, {lev:.0%} CI [{d - zc * se_d:.3f}, {d + zc * se_d:.3f}]; z = {z:.2f}, p {('< .001' if pt < 0.001 else '= ' + fmt.apa_p(pt))}.")
    return Result(log="\n".join(lines), tables=[t], summary={"test": "two-sample proportions", "groups": [la, lb], "n": [n1, n2], "proportions": [p1, p2], "diff": d, "z": z, "p": pt})


# ───────────── tabulate, summarize() ─────────────


def tab_summarize(ds: Dataset, cmd: Command, vars_: list[str], yvar: str) -> Result:
    """Mean-comparison table: tabulate x [z], summarize(y) [means standard freq]."""
    y = resolve_var(yvar, ds.df)
    if not is_numeric(ds.df[y]):
        raise StataError(f"{y} is a string variable")
    sub = sample(ds, cmd, vars_ + [y])
    kind, wraw = weights(ds, cmd, sub, "aw fw")
    w = np.ones(len(sub)) if wraw is None else wraw
    yv = sub[y].astype(float).to_numpy()
    only_means = bool(cmd.opt("means"))

    def stats(mask):
        ww, yy = w[mask], yv[mask]
        if len(yy) == 0:
            return float("nan"), float("nan"), 0
        m = float((ww * yy).sum() / ww.sum())
        n = len(yy)
        if kind == "aw":
            var = float((ww * (yy - m) ** 2).sum() / ww.sum() * n / (n - 1)) if n > 1 else float("nan")
            freq = n
        else:
            tot = ww.sum()
            var = float((ww * (yy - m) ** 2).sum() / (tot - 1)) if tot > 1 else float("nan")
            freq = tot
        return m, math.sqrt(var) if var == var else float("nan"), freq

    G = lambda x: fmt.g(x, 12, sig=8, fw=11)  # noqa: E731  (tabulate, summarize prints 8 digits)
    rv = vars_[0]
    rlev = _levels(ds, sub[rv], False)
    if len(vars_) == 1:
        lines = sum_note(kind, wraw) + [f"{fmt.name(nice(ds, rv) if len(nice(ds, rv)) <= 12 else rv)} |{'Summary of ' + nice(ds, y):^37}"[:52].rstrip(), f"{fmt.name(rv)} |        Mean   Std. dev.       {'Obs.' if kind == 'aw' else 'Freq.'}", fmt.rule(13, 36)]
        lines[0] = f"{'':12} |{'Summary of ' + nice(ds, y):^37}".rstrip()
        rows, summ = [], []
        for lv in rlev:
            m, sd, f = stats((sub[rv] == lv).to_numpy())
            lab = level_label(ds, rv, lv)
            lines.append(f"{fmt.name(lab)} |{G(m)}{G(sd)}{_n(f):>12}")
            rows.append([lab, fmt.apa_num(m), fmt.apa_num(sd), _n(f)])
            summ.append({"group": lab, "mean": m, "sd": sd, "n": f})
        m, sd, f = stats(np.ones(len(sub), dtype=bool))
        lines += [fmt.rule(13, 36), f"{'Total':>12} |{G(m)}{G(sd)}{_n(f):>12}"]
        rows.append(["Total", fmt.apa_num(m), fmt.apa_num(sd), _n(f)])
        wnote = f" Weighted ({cmd.weight[0]}={cmd.weight[1]})." if kind else ""
        t = Table(f"Mean {nice(ds, y)} by {nice(ds, rv)}", [nice(ds, rv), "M", "SD", "n"], rows, note=f"Mean comparison.{wnote}")
        return Result(log="\n".join(lines), tables=[t], summary={"mean_comparison": y, "by": rv, "groups": summ, "total_mean": m})
    cv = vars_[1]
    clev = _levels(ds, sub[cv], False)
    if len(clev) > 8:
        raise StataError("too many columns for a mean table (at most 8)")
    width = 11 * (len(clev) + 1)
    lines = sum_note(kind, wraw) + [f"{'Means' + ('' if only_means else ', Standard deviations and Frequencies') + ' of ' + nice(ds, y):^{13 + width}}".rstrip(), "", f"{'':12} |{nice(ds, cv)[:width - 11]:^{11 * len(clev)}}|", f"{fmt.name(rv)} |" + "".join(f"{level_label(ds, cv, c)[:10]:>11}" for c in clev) + f" |{'Total':>10}", fmt.rule(13, 11 * len(clev)) + "+" + "-" * 11]
    rows = []
    for r in rlev + [None]:
        rmask = np.ones(len(sub), dtype=bool) if r is None else (sub[rv] == r).to_numpy()
        cells = [stats(rmask & (sub[cv] == c).to_numpy()) for c in clev] + [stats(rmask)]
        lab = "Total" if r is None else level_label(ds, rv, r)
        if r is None:
            lines.append(fmt.rule(13, 11 * len(clev)) + "+" + "-" * 11)
        lines.append(f"{fmt.name(lab)} |" + "".join(f"{fmt.g(m, 11)}" for m, _, _ in cells[:-1]) + f" |{fmt.g(cells[-1][0], 10)}")
        if not only_means:
            lines.append(f"{'':12} |" + "".join(f"{fmt.g(sd, 11)}" for _, sd, _ in cells[:-1]) + f" |{fmt.g(cells[-1][1], 10)}")
            lines.append(f"{'':12} |" + "".join(f"{_n(f):>11}" for _, _, f in cells[:-1]) + f" |{_n(cells[-1][2]):>10}")
            if r is not None:
                lines.append(f"{'':12} |{'':{11 * len(clev)}} |")
        rows.append([lab] + [f"{fmt.apa_num(m)} ({_n(f)})" for m, _, f in cells])
    t = Table(f"Mean {nice(ds, y)} by {nice(ds, rv)} and {nice(ds, cv)}", [nice(ds, rv)] + [level_label(ds, cv, c) for c in clev] + ["Total"], rows, note="Cells show M (n)." + (f" Weighted ({cmd.weight[0]}={cmd.weight[1]})." if kind else ""))
    return Result(log="\n".join(lines).rstrip(), tables=[t], summary={"mean_comparison": y, "rows": rv, "cols": cv})


# ───────────── ordinal and nominal association ─────────────


def _pq(T: np.ndarray):
    """Concordance sums for an r x c table: A (concordant) and D (discordant) per cell, P, Q."""
    r, c = T.shape
    A = np.zeros_like(T, dtype=float)
    D = np.zeros_like(T, dtype=float)
    for i in range(r):
        for j in range(c):
            A[i, j] = T[i + 1 :, j + 1 :].sum() + T[:i, :j].sum()
            D[i, j] = T[i + 1 :, :j].sum() + T[:i, j + 1 :].sum()
    return A, D, float((T * A).sum()), float((T * D).sum())


def gamma_taub(T: np.ndarray) -> dict:
    """Goodman–Kruskal gamma and Kendall's tau-b with asymptotic standard errors (ASE1)."""
    T = T.astype(float)
    n = T.sum()
    A, D, P, Q = _pq(T)
    out = {}
    if P + Q > 0:
        g = (P - Q) / (P + Q)
        ase = 4 / (P + Q) ** 2 * math.sqrt(float((T * (Q * A - P * D) ** 2).sum()))
        out["gamma"], out["gamma_ase"] = g, ase
    ri, cj = T.sum(1), T.sum(0)
    wr, wc = n * n - (ri**2).sum(), n * n - (cj**2).sum()
    w = math.sqrt(wr * wc)
    if w > 0:
        tb = (P - Q) / w
        dmat = A - D
        v = ri[:, None] * wc + cj[None, :] * wr
        inner = float((T * (2 * w * dmat + tb * v) ** 2).sum()) - n**3 * tb**2 * (wr + wc) ** 2
        out["taub"], out["taub_ase"] = tb, math.sqrt(max(inner, 0)) / w**2
    return out


def somers(T: np.ndarray) -> tuple[float, float]:
    """Somers' D of the column variable on the row variable (rows = independent), with ASE."""
    T = T.astype(float)
    n = T.sum()
    A, D, P, Q = _pq(T)
    ri = T.sum(1)
    wr = n * n - (ri**2).sum()
    d = (P - Q) / wr
    ase = 2 / wr**2 * math.sqrt(float((T * (wr * (A - D) - (P - Q) * (n - ri)[:, None]) ** 2).sum()))
    return d, ase


def _crosstab(ds: Dataset, cmd: Command, rv: str, cv: str):
    sub = sample(ds, cmd, [rv, cv])
    kind, wraw = weights(ds, cmd, sub, "fw aw")
    w = np.ones(len(sub)) if wraw is None else (wraw * len(sub) / wraw.sum() if kind == "aw" else wraw)
    rl, cl = _levels(ds, sub[rv], False), _levels(ds, sub[cv], False)
    T = np.array([[w[((sub[rv] == r) & (sub[cv] == c)).to_numpy()].sum() for c in cl] for r in rl])
    return T, rl, cl, sub


def somersd(ds: Dataset, cmd: Command) -> Result:
    vs = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    if len(vs) != 2:
        raise StataError("use: somersd independent_var dependent_var")
    x, y = vs
    T, _, _, sub = _crosstab(ds, cmd, x, y)
    d, ase = somers(T)
    z = d / ase if ase else float("nan")
    pv = float(2 * st.norm.sf(abs(z)))
    lo, hi = d - 1.959963984540054 * ase, d + 1.959963984540054 * ase
    n = int(round(T.sum()))
    lines = [
        f"Somers' D with variable: {x}",
        "Transformation: Untransformed",
        f"Valid observations: {n:,}",
        "",
        "Symmetric 95% CI",
        RULE,
        f"{'':12} |{'Asymptotic':>24}",
        f"{fmt.name(y)} | Coefficient  std. err.      z    P>|z|     [95% conf. interval]",
        fmt.rule(13, 64),
        f"{fmt.name(y)} |{fmt.g(d, 11)}{fmt.g(ase, 11)}{z:>9.2f}{fmt.p(pv)}{fmt.g(lo, 13)}{fmt.g(hi, 12)}",
        RULE,
    ]
    t = Table(f"Somers' D: {nice(ds, y)} on {nice(ds, x)}", ["Measure", "Value", "ASE", "z", "p", "95% CI"], [["Somers' D", fmt.apa_num(d), fmt.apa_num(ase), fmt.apa_num(z), fmt.apa_p(pv), f"[{fmt.apa_num(lo)}, {fmt.apa_num(hi)}]"]], note=f"N = {n:,}. {nice(ds, x)} is the independent variable.")
    return Result(log="\n".join(lines), tables=[t], summary={"somers_d": d, "ase": ase, "z": z, "p": pv, "n": n}, notes=["Standard errors are asymptotic; the somersd package reports jackknife errors, which can differ slightly."])


def lambda_(ds: Dataset, cmd: Command) -> Result:
    vs = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    if len(vs) != 2:
        raise StataError("use: lambda dependent_var independent_var")
    y, x = vs
    T, _, _, _ = _crosstab(ds, cmd, x, y)  # rows = independent x, columns = dependent y
    n = T.sum()
    lam_y = (T.max(1).sum() - T.sum(0).max()) / (n - T.sum(0).max()) if n > T.sum(0).max() else float("nan")
    lam_x = (T.max(0).sum() - T.sum(1).max()) / (n - T.sum(1).max()) if n > T.sum(1).max() else float("nan")
    denom = 2 * n - T.sum(0).max() - T.sum(1).max()
    lam_s = (T.max(1).sum() + T.max(0).sum() - T.sum(0).max() - T.sum(1).max()) / denom if denom else float("nan")
    lines = [
        f"Lambda (Goodman and Kruskal), N = {int(round(n)):,}",
        "",
        f"  {y} dependent on {x}:{'':>{max(1, 30 - len(x) - len(y))}}lambda = {lam_y:>8.4f}",
        f"  {x} dependent on {y}:{'':>{max(1, 30 - len(x) - len(y))}}lambda = {lam_x:>8.4f}",
        f"  Symmetric:{'':>{max(1, 26)}}lambda = {lam_s:>8.4f}",
    ]
    t = Table(f"Lambda: {nice(ds, y)} and {nice(ds, x)}", ["Direction", "λ"], [[f"{nice(ds, y)} dependent", fmt.apa_r(lam_y)], [f"{nice(ds, x)} dependent", fmt.apa_r(lam_x)], ["Symmetric", fmt.apa_r(lam_s)]], note="Proportional reduction in error when predicting the dependent variable's categories.")
    return Result(log="\n".join(lines), tables=[t], summary={"lambda": lam_y, "lambda_reverse": lam_x, "lambda_symmetric": lam_s})
