"""Analyses, printed the way Stata prints them, each with an APA-style table and key numbers."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats as st
import statsmodels.api as sm

from . import fmt
from .data import Dataset, StataError, fmt_value, is_numeric
from .datacmds import selected
from .result import Result, Table
from .syntax import Command, Term, expand_varlist, parse_fvlist
from .expr import resolve_var
from .weights import normalized, sum_note, weight_values, weights

W = 78  # Stata's results width


def _nonmissing(df: pd.DataFrame, vars_: list[str]) -> pd.Series:
    ok = pd.Series(True, index=df.index)
    for v in vars_:
        s = df[v]
        ok &= s.notna() if is_numeric(s) else s.fillna("").astype(str).ne("")
    return ok


def sample(ds: Dataset, cmd: Command, vars_: list[str]) -> pd.DataFrame:
    mask = selected(ds, cmd) & _nonmissing(ds.df, vars_)
    if cmd.weight:  # observations with missing or zero weight are left out, as in Stata
        w = weight_values(ds, cmd)
        mask &= w.notna() & w.ne(0)
    return ds.df[mask]


def nice(ds: Dataset, var: str) -> str:
    """A variable's label, or its name, for APA tables."""
    return ds.label(var) or var


def level_label(ds: Dataset, var: str, value) -> str:
    return ds.value_label(var, value)


def stata_pctile(x: np.ndarray, p: float) -> float:
    """Stata's summarize/centile definition."""
    x = np.sort(x)
    n = len(x)
    if n == 0:
        return float("nan")
    np_ = n * p / 100
    i = math.floor(np_)
    if np_ == i:
        return float(x[0]) if i == 0 else (float(x[-1]) if i >= n else float((x[i - 1] + x[i]) / 2))
    return float(x[min(i, n - 1)])


def _need_numeric(ds: Dataset, vars_: list[str]):
    for v in vars_:
        if not is_numeric(ds.df[v]):
            raise StataError(f"{v} is a string variable; use a numeric variable (try encode or destring in your own Stata)")


# ───────────── summarize ─────────────


def summarize(ds: Dataset, cmd: Command) -> Result:
    vars_ = expand_varlist(cmd.args, ds.df)
    mask = selected(ds, cmd)
    detail = cmd.opt("detail")
    if detail:
        if cmd.weight:
            raise StataError("summarize, detail with weights isn't available yet; run it without weights, or use mean with weights")
        return _summarize_detail(ds, cmd, [v for v in vars_ if is_numeric(ds.df[v])], mask)
    kind = cmd.weight[0] if cmd.weight else None
    if kind == "pw":
        raise StataError("pweights not allowed with summarize; use [aw=...] for weighted means, or mean ... [pw=...] for survey standard errors")
    wall = weight_values(ds, cmd)
    if kind == "fw" and wall is not None and np.any(np.mod(wall.dropna(), 1) != 0):
        raise StataError("may not use noninteger frequency weights")
    show_w = kind in ("aw", "iw")
    if show_w:
        lines = [f"{'Variable':>12} |{'Obs':>8}{'Weight':>12}{'Mean':>11}{'Std. dev.':>11}{'Min':>11}{'Max':>11}", fmt.rule(13, 65)]
    else:
        lines = [f"{'Variable':>12} |{'Obs':>11}{'Mean':>12}{'Std. dev.':>12}{'Min':>11}{'Max':>11}", fmt.rule(13, 57)]
    rows, summ = [], []
    for v in vars_:
        s_ = ds.df.loc[mask, v]
        if not is_numeric(s_):
            lines.append(f"{fmt.name(v)} |{0:>11}" if not show_w else f"{fmt.name(v)} |{0:>8}")
            continue
        keep = s_.notna()
        if wall is not None:
            wv = wall.loc[s_.index]
            if (wv < 0).any():
                raise StataError("negative weights encountered")
            keep &= wv.notna() & wv.ne(0)
        d = s_[keep].astype(float).to_numpy()
        n = len(d)
        if wall is None:
            w = np.ones(n)
        else:
            w = wall.loc[s_.index][keep].to_numpy(dtype=float)
        sw = w.sum()
        mean = float((w * d).sum() / sw) if n else float("nan")
        ss = float((w * (d - mean) ** 2).sum()) if n else float("nan")
        if kind == "aw":
            var = ss / sw * n / (n - 1) if n > 1 else float("nan")
        else:  # unweighted, fw, iw
            var = ss / (sw - 1) if sw > 1 else float("nan")
        sd = math.sqrt(var) if var == var else float("nan")
        lo, hi = (d.min(), d.max()) if n else (float("nan"), float("nan"))
        nobs = int(round(sw)) if kind == "fw" else n
        if show_w:
            lines.append(f"{fmt.name(v)} |{nobs:>8,}{fmt.g(sw, 12)}{fmt.g(mean, 11)}{fmt.g(sd, 11)}{fmt.g(lo, 11)}{fmt.g(hi, 11)}")
        else:
            lines.append(f"{fmt.name(v)} |{nobs:>11,}{fmt.g(mean, 12)}{fmt.g(sd, 12)}{fmt.g(lo, 11)}{fmt.g(hi, 11)}")
        rows.append([nice(ds, v), f"{nobs:,}", fmt.apa_num(mean), fmt.apa_num(sd), fmt.apa_num(lo), fmt.apa_num(hi)])
        summ.append({"var": v, "n": nobs, "mean": mean, "sd": sd, "min": lo, "max": hi})
    note = f"Weighted ({cmd.weight[0]}={cmd.weight[1]})." if cmd.weight else ""
    t = Table("Descriptive statistics", ["Variable", "N", "M", "SD", "Min", "Max"], rows, note=note)
    return Result(log="\n".join(lines), tables=[t] if rows else [], summary={"summarize": summ, "weight": cmd.weight})


def _summarize_detail(ds: Dataset, cmd: Command, vars_: list[str], mask) -> Result:
    out, summ = [], []
    for v in vars_:
        d = ds.df.loc[mask, v].dropna().astype(float).to_numpy()
        n = len(d)
        title = nice(ds, v)
        out.append(f"{title:^61}".rstrip())
        out.append("-" * 61)
        if n == 0:
            out += ["no observations", ""]
            continue
        srt = np.sort(d)
        pct = [(1, "1%"), (5, "5%"), (10, "10%"), (25, "25%"), (50, "50%"), (75, "75%"), (90, "90%"), (95, "95%"), (99, "99%")]
        pv = {lab: stata_pctile(d, p) for p, lab in pct}
        mean, var = d.mean(), d.var(ddof=1) if n > 1 else float("nan")
        m2 = ((d - mean) ** 2).mean()
        skew = ((d - mean) ** 3).mean() / m2**1.5 if m2 > 0 else float("nan")
        kurt = ((d - mean) ** 4).mean() / m2**2 if m2 > 0 else float("nan")
        small = list(srt[:4]) + [float("nan")] * (4 - min(4, n))
        large = list(srt[-4:]) if n >= 4 else list(srt) + [float("nan")] * (4 - n)
        G = lambda x: fmt.g(x, 12)  # noqa: E731
        out += [
            f"      Percentiles      Smallest",
            f" 1%{G(pv['1%'])}{G(small[0])}",
            f" 5%{G(pv['5%'])}{G(small[1])}",
            f"10%{G(pv['10%'])}{G(small[2])}       Obs        {n:>14,}",
            f"25%{G(pv['25%'])}{G(small[3])}       Sum of wgt.{n:>14,}",
            "",
            f"50%{G(pv['50%'])}                      Mean      {fmt.g(mean, 16)}",
            f"                        Largest       Std. dev. {fmt.g(math.sqrt(var) if n > 1 else float('nan'), 16)}",
            f"75%{G(pv['75%'])}{G(large[0])}",
            f"90%{G(pv['90%'])}{G(large[1])}       Variance  {fmt.g(var, 16)}",
            f"95%{G(pv['95%'])}{G(large[2])}       Skewness  {fmt.g(skew, 16)}",
            f"99%{G(pv['99%'])}{G(large[3])}       Kurtosis  {fmt.g(kurt, 16)}",
            "",
        ]
        summ.append({"var": v, "n": n, "mean": mean, "sd": math.sqrt(var) if n > 1 else None, "median": pv["50%"], "p25": pv["25%"], "p75": pv["75%"], "skewness": skew, "kurtosis": kurt})
    rows = [[nice(ds, s["var"]), f"{s['n']:,}", fmt.apa_num(s["mean"]), fmt.apa_num(s["sd"]), fmt.apa_num(s["median"]), f"{fmt.apa_num(s['p25'])}–{fmt.apa_num(s['p75'])}", fmt.apa_num(s["skewness"]), fmt.apa_num(s["kurtosis"])] for s in summ]
    t = Table("Descriptive statistics", ["Variable", "N", "M", "SD", "Mdn", "IQR", "Skewness", "Kurtosis"], rows)
    return Result(log="\n".join(out).rstrip(), tables=[t] if rows else [], summary={"summarize": summ})


# ───────────── tabulate ─────────────


def _levels(ds: Dataset, s: pd.Series, include_missing: bool) -> list:
    vals = s.dropna().unique().tolist() if is_numeric(s) else [x for x in s.fillna("").unique().tolist() if x != ""]
    vals = sorted(vals, key=lambda x: (isinstance(x, str), x))
    if include_missing and (s.isna().any() if is_numeric(s) else (s.fillna("") == "").any()):
        vals.append(np.nan)
    return vals


def _eq(s: pd.Series, v):
    if isinstance(v, float) and np.isnan(v):
        return s.isna() if is_numeric(s) else s.fillna("") == ""
    return s == v


def tabulate(ds: Dataset, cmd: Command) -> Result:
    vars_ = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    summ_var = cmd.opt("summarize")
    if isinstance(summ_var, str):
        from .inference import tab_summarize

        if len(vars_) > 2:
            raise StataError("tabulate, summarize() takes one or two variables")
        return tab_summarize(ds, cmd, vars_, summ_var)
    gen = cmd.opt("generate")
    if isinstance(gen, str):
        from .datamore import tab_generate

        return tab_generate(ds, cmd, vars_, gen)
    if cmd.name == "tab1" or (cmd.name == "tabulate" and len(vars_) == 1):
        results = [_tab1(ds, cmd, v) for v in vars_]
        return Result(log="\n\n".join(r.log for r in results), tables=[t for r in results for t in r.tables], notes=[n for r in results for n in r.notes], summary={"tabulations": [r.summary for r in results]})
    if cmd.name == "tab2":
        results = [_tab2(ds, cmd, a, b) for i, a in enumerate(vars_) for b in vars_[i + 1 :]]
        return Result(log="\n\n".join(r.log for r in results), tables=[t for r in results for t in r.tables], notes=[n for r in results for n in r.notes], summary={"crosstabs": [r.summary for r in results]})
    if len(vars_) != 2:
        raise StataError("too many variables specified (use tab2 for all pairs)")
    return _tab2(ds, cmd, vars_[0], vars_[1])


def _fc(x: float, width: int = 11) -> str:
    """A frequency: whole numbers with thousands separators, weighted ones as Stata shows them."""
    return f"{int(round(x)):>{width},}" if abs(x - round(x)) < 1e-9 else fmt.g(x, width)


def _tab_weights(ds: Dataset, cmd: Command, sub: pd.DataFrame) -> np.ndarray:
    """Per-row weights for tabulate (aw rescaled to sum to N; pw is not allowed, as in Stata)."""
    if not cmd.weight:
        return np.ones(len(sub))
    w_all = weight_values(ds, cmd)
    kind, w = weights(ds, cmd, sub.assign(), "aw fw iw")
    if np.isnan(w).any():
        raise StataError("missing weights; drop those observations with an if condition")
    return normalized(kind, w, len(sub))


def _tab1(ds: Dataset, cmd: Command, v: str) -> Result:
    include_missing = bool(cmd.opt("missing"))
    s = ds.df.loc[selected(ds, cmd), v]
    if not include_missing:
        s = s[_nonmissing(s.to_frame(), [v])]
    if cmd.weight:
        wv = weight_values(ds, cmd).loc[s.index]
        s = s[wv.notna() & wv.ne(0)]
    levels = _levels(ds, s, include_missing)
    if len(levels) > 3000:
        raise StataError(f"too many values ({len(levels):,}); tabulate is for categories, try summarize")
    if len(s) == 0:
        return Result(log="no observations")
    w = pd.Series(_tab_weights(ds, cmd, s.to_frame()), index=s.index)
    total = float(w.sum())
    hdr = fmt.name(v)
    lines = [f"{hdr} |      Freq.     Percent        Cum.", fmt.rule(13, 35)]
    rows, cum, out = [], 0.0, []
    for lv in levels:
        c = float(w[_eq(s, lv)].sum())
        pctv = 100 * c / total
        cum += pctv
        lab = level_label(ds, v, lv) if not (isinstance(lv, float) and np.isnan(lv)) else "."
        lines.append(f"{fmt.name(lab)} |{_fc(c)}{pctv:>12.2f}{cum:>12.2f}")
        rows.append([lab, _fc(c, 0).strip(), f"{pctv:.1f}", f"{cum:.1f}"])
        out.append({"value": lab, "freq": c, "percent": pctv})
    lines += [fmt.rule(13, 35), f"{'Total':>12} |{_fc(total)}{100:>12.2f}"]
    wnote = f" Weighted ({cmd.weight[0]}={cmd.weight[1]})." if cmd.weight else ""
    t = Table(f"Frequencies of {nice(ds, v)}", ["Value", "n", "%", "Cumulative %"], rows, note=f"N = {_fc(total, 0).strip()}.{wnote}")
    return Result(log="\n".join(lines), tables=[t], summary={"var": v, "n": total, "levels": out})


def _tab2(ds: Dataset, cmd: Command, rv: str, cv: str) -> Result:
    include_missing = bool(cmd.opt("missing"))
    sub = ds.df.loc[selected(ds, cmd), [rv, cv]]
    if not include_missing:
        sub = sub[_nonmissing(sub, [rv, cv])]
    if cmd.weight:
        wv = weight_values(ds, cmd).loc[sub.index]
        sub = sub[wv.notna() & wv.ne(0)]
        if cmd.opt("exact"):
            raise StataError("exact not allowed with weights")
    rlev, clev = _levels(ds, sub[rv], include_missing), _levels(ds, sub[cv], include_missing)
    if len(clev) > 20 or len(rlev) > 200:
        raise StataError("too many values for a cross-tabulation (at most 20 columns)")
    wt = pd.Series(_tab_weights(ds, cmd, sub), index=sub.index)
    table = np.array([[float(wt[_eq(sub[rv], r) & _eq(sub[cv], c)].sum()) for c in clev] for r in rlev])
    if not cmd.weight:
        table = table.astype(int)
    N = table.sum()
    if N == 0:
        return Result(log="no observations")
    want_row, want_col, want_cell = bool(cmd.opt("row")), bool(cmd.opt("column", "col")), bool(cmd.opt("cell"))
    nofreq = bool(cmd.opt("nofreq"))
    rlab = [level_label(ds, rv, r) if not (isinstance(r, float) and np.isnan(r)) else "." for r in rlev]
    clab = [level_label(ds, cv, c) if not (isinstance(c, float) and np.isnan(c)) else "." for c in clev]
    rt, ct = table.sum(axis=1), table.sum(axis=0)
    lines = []
    keys = ([] if nofreq else ["frequency"]) + (["row percentage"] if want_row else []) + (["column percentage"] if want_col else []) + (["cell percentage"] if want_cell else [])
    if len(keys) > 1:
        lines += ["+" + "-" * 19 + "+", "| Key" + " " * 15 + "|", "|" + "-" * 19 + "|"] + [f"|{k:^19}|" for k in keys] + ["+" + "-" * 19 + "+", ""]
    width = 11 * len(clev)
    head2 = "".join(f"{(c if len(c) <= 10 else c[:9] + '~'):>11}" for c in clab)
    lines.append(f"{'':12} |{fmt.name(cv, width):}"[: 14 + width] if False else f"{'':12} |{cv:^{width}}|")
    lines.append(f"{fmt.name(rv)} |{head2} |{'Total':>11}")
    lines.append(fmt.rule(13, width + 1) + "+" + "-" * 11)

    def block(cells, tot):
        out = []
        if not nofreq:
            out.append(("".join(f"{x:>11,}" for x in cells), f"{tot:>11,}"))
        return out

    for i, lab in enumerate(rlab):
        first = True
        rowlines = []
        if not nofreq:
            rowlines.append(("".join(_fc(x) for x in table[i]), _fc(rt[i])))
        if want_row:
            rowlines.append(("".join(f"{100 * x / rt[i] if rt[i] else 0:>11.2f}" for x in table[i]), f"{100.0:>11.2f}"))
        if want_col:
            rowlines.append(("".join(f"{100 * x / ct[j] if ct[j] else 0:>11.2f}" for j, x in enumerate(table[i])), f"{100 * rt[i] / N:>11.2f}"))
        if want_cell:
            rowlines.append(("".join(f"{100 * x / N:>11.2f}" for x in table[i]), f"{100 * rt[i] / N:>11.2f}"))
        for cells, tot in rowlines:
            lines.append(f"{fmt.name(lab) if first else '':>12} |{cells} |{tot}")
            first = False
        if len(rowlines) > 1:
            lines.append(f"{'':12} |{'':{width}} |")
    lines.append(fmt.rule(13, width + 1) + "+" + "-" * 11)
    tot_lines = []
    if not nofreq:
        tot_lines.append(("".join(_fc(x) for x in ct), _fc(N)))
    if want_row:
        tot_lines.append(("".join(f"{100 * x / N:>11.2f}" for x in ct), f"{100.0:>11.2f}"))
    if want_col:
        tot_lines.append(("".join(f"{100.0:>11.2f}" for _ in ct), f"{100.0:>11.2f}"))
    if want_cell:
        tot_lines.append(("".join(f"{100 * x / N:>11.2f}" for x in ct), f"{100.0:>11.2f}"))
    for k, (cells, tot) in enumerate(tot_lines):
        lines.append(f"{'Total' if k == 0 else '':>12} |{cells} |{tot}")

    notes, summ = [], {"row": rv, "col": cv, "n": float(N), "table": table.tolist(), "rowLabels": rlab, "colLabels": clab}
    expected = np.outer(rt, ct) / N
    valid = (rt > 0).sum() > 1 and (ct > 0).sum() > 1
    chi2 = dfree = pval = cv_ = None
    if valid:
        nzr, nzc = rt > 0, ct > 0
        tab_nz = table[np.ix_(nzr, nzc)]
        exp_nz = expected[np.ix_(nzr, nzc)]
        chi2 = float(((tab_nz - exp_nz) ** 2 / exp_nz).sum())
        dfree = (tab_nz.shape[0] - 1) * (tab_nz.shape[1] - 1)
        pval = float(st.chi2.sf(chi2, dfree))
        k = min(tab_nz.shape) - 1
        cv_ = math.sqrt(chi2 / (N * k)) if k > 0 else float("nan")
        if tab_nz.shape == (2, 2):  # Stata's Cramér's V keeps the sign for 2x2
            a, b, c, d = tab_nz.ravel()
            cv_ = (a * d - b * c) / math.sqrt(rt[nzr].prod() * ct[nzc].prod())
        small = (exp_nz < 5).mean()
        if small > 0.2:
            notes.append(f"{small:.0%} of cells have expected counts below 5, so the chi-square p-value may be inaccurate. Fisher's exact test (add the exact option) is safer here.")
        summ.update(chi2=chi2, df=dfree, p=pval, cramersV=cv_)
    lines.append("")
    if cmd.opt("chi2") and valid:
        lines.append(f"{'Pearson chi2(' + str(dfree) + ') = ':>29}{chi2:>8.4f}   Pr = {pval:.3f}")
    want_all = bool(cmd.opt("all"))
    if want_all and valid and not cmd.opt("chi2"):
        lines.append(f"{'Pearson chi2(' + str(dfree) + ') = ':>29}{chi2:>8.4f}   Pr = {pval:.3f}")
    if (cmd.opt("v") or want_all) and valid:
        lines.append("Cramér's V = ".rjust(29) + f"{cv_:>8.4f}")
    if (cmd.opt("gamma") or cmd.opt("taub") or want_all) and valid:
        from .inference import gamma_taub

        gt = gamma_taub(np.asarray(table, dtype=float))
        if (cmd.opt("gamma") or want_all) and "gamma" in gt:
            lines.append("gamma = ".rjust(29) + f"{gt['gamma']:>8.4f}  ASE = {gt['gamma_ase']:.3f}")
        if (cmd.opt("taub") or want_all) and "taub" in gt:
            lines.append("Kendall's tau-b = ".rjust(29) + f"{gt['taub']:>8.4f}  ASE = {gt['taub_ase']:.3f}")
        summ.update({k: v for k, v in gt.items()})
    if cmd.opt("exact") and valid:
        tab_nz = table[np.ix_(rt > 0, ct > 0)]
        if tab_nz.shape == (2, 2):
            ex = float(st.fisher_exact(tab_nz)[1])
            one = float(min(st.fisher_exact(tab_nz, alternative="less")[1], st.fisher_exact(tab_nz, alternative="greater")[1]))
            lines += ["Fisher's exact = ".rjust(29) + f"{'':>8}{ex:>9.3f}", "1-sided Fisher's exact = ".rjust(29) + f"{'':>8}{one:>9.3f}"]
        else:
            res = st.chi2_contingency  # noqa: F841
            rng = np.random.default_rng(20261106)
            ex = _fisher_mc(sub, rv, cv, chi2, rng)
            lines.append("Fisher's exact = ".rjust(29) + f"{'':>8}{ex:>9.3f}")
            notes.append("For tables larger than 2×2, Fisher's exact p-value is estimated by simulation (20,000 random tables); it can differ slightly from Stata's in the third decimal.")
        summ["fisher_p"] = ex
    if cmd.opt("chi2") is None and cmd.opt("exact") is None and valid:
        notes.append("Add the chi2 option (or ask for a chi-square test) to test whether the two variables are associated.")

    # APA: counts with row (or column) percentages
    use_col = want_col and not want_row
    cols = [nice(ds, rv)] + [f"{c}" for c in clab] + ["Total"]
    rows = []
    for i, lab in enumerate(rlab):
        cells = []
        for j, x in enumerate(table[i]):
            pc = 100 * x / (ct[j] if use_col else rt[i]) if (ct[j] if use_col else rt[i]) else 0
            cells.append(f"{_fc(x, 0).strip()} ({pc:.1f}%)")
        rows.append([lab] + cells + [_fc(rt[i], 0).strip()])
    rows.append(["Total"] + [_fc(x, 0).strip() for x in ct] + [_fc(N, 0).strip()])
    note = f"Cells show n ({'column' if use_col else 'row'} %)." + (f" Weighted ({cmd.weight[0]}={cmd.weight[1]})." if cmd.weight else "")
    if valid:
        note += f" χ²({dfree}, N = {_fc(N, 0).strip()}) = {chi2:.2f}, p {('< .001' if pval < 0.001 else '= ' + fmt.apa_p(pval))}; Cramér's V = {fmt.apa_r(abs(cv_))}."
    t = Table(f"{nice(ds, rv)} by {nice(ds, cv)}", cols, rows, note=note)
    return Result(log="\n".join(lines).rstrip(), tables=[t], notes=notes, summary=summ)


def _fisher_mc(sub: pd.DataFrame, rv: str, cv: str, observed_chi2: float, rng, draws: int = 20000) -> float:
    """Monte Carlo exact test: permute one margin, compare table probabilities via chi-square ordering."""
    r = pd.factorize(sub[rv])[0]
    c = pd.factorize(sub[cv])[0]
    nr, nc = r.max() + 1, c.max() + 1
    obs = np.zeros((nr, nc))
    np.add.at(obs, (r, c), 1)
    rt, ct = obs.sum(1), obs.sum(0)
    E = np.outer(rt, ct) / len(r)
    stat = lambda T: (((T - E) ** 2) / E).sum()  # noqa: E731
    s0 = stat(obs)
    hits = 0
    for _ in range(draws):
        T = np.zeros((nr, nc))
        np.add.at(T, (r, rng.permutation(c)), 1)
        hits += stat(T) >= s0 - 1e-9
    return (hits + 1) / (draws + 1)


# ───────────── t tests ─────────────


def _ci(mean, se, df_, level=0.95):
    tcrit = st.t.ppf(1 - (1 - level) / 2, df_)
    return mean - tcrit * se, mean + tcrit * se


def _ttest_tail(diff_label: str, t: float, df_: float, h0: str, df_label: str = "Degrees of freedom") -> list[str]:
    pl, pt, pr = st.t.cdf(t, df_), 2 * st.t.sf(abs(t), df_), st.t.sf(t, df_)
    dfs = f"{df_:.0f}" if float(df_).is_integer() else f"{df_:.4f}"
    return [
        f"{diff_label:<62}t = {t:>9.4f}",
        f"H0: {h0:<{38 - 4}}{df_label + ' =':>28}{dfs:>9}" if len(h0) < 34 else f"H0: {h0}   {df_label} = {dfs}",
        "",
        f"{'Ha: diff < 0':>16}{'Ha: diff != 0':>29}{'Ha: diff > 0':>29}",
        f" Pr(T < t) = {pl:.4f}{'Pr(|T| > |t|) = ':>29}{pt:.4f}{'Pr(T > t) = ':>23}{pr:.4f}",
    ]


def _trow(lab: str, n: int, mean: float, sd: float, df_: float | None = None) -> str:
    se = sd / math.sqrt(n) if n > 0 else float("nan")
    lo, hi = _ci(mean, se, n - 1 if df_ is None else df_)
    return f"{lab[:8]:>8} |{n:>8,}{fmt.g(mean, 12)}{fmt.g(se, 12)}{fmt.g(sd, 12)}{fmt.g(lo, 12)}{fmt.g(hi, 12)}"


def ttest(ds: Dataset, cmd: Command) -> Result:
    args = cmd.args.replace(" ", "")
    head = [f"{'Variable' if cmd.opt('by') is None else 'Group':>8} |     Obs        Mean    Std. err.   Std. dev.   [95% conf. interval]", fmt.rule(9, 68)]
    if "==" in args:
        left, right = args.split("==", 1)
        y = resolve_var(left, ds.df)
        try:
            mu = float(right)
            return _ttest_one(ds, cmd, y, mu, head)
        except ValueError:
            return _ttest_paired(ds, cmd, y, resolve_var(right, ds.df), head)
    by = cmd.opt("by")
    if not isinstance(by, str):
        raise StataError("use: ttest y == 0 | ttest y, by(group) | ttest before == after")
    y = resolve_var(args, ds.df)
    g = resolve_var(by, ds.df)
    _need_numeric(ds, [y])
    sub = sample(ds, cmd, [y, g])
    levels = _levels(ds, sub[g], False)
    if len(levels) != 2:
        raise StataError(f"{g} must have exactly 2 groups (it has {len(levels)})")
    a, b = (sub.loc[sub[g] == lv, y].astype(float) for lv in levels)
    la, lb = level_label(ds, g, levels[0]), level_label(ds, g, levels[1])
    unequal = bool(cmd.opt("unequal") or cmd.opt("welch"))
    n1, n2 = len(a), len(b)
    m1, m2, s1, s2 = a.mean(), b.mean(), a.std(), b.std()
    diff = m1 - m2
    if unequal:
        se = math.sqrt(s1**2 / n1 + s2**2 / n2)
        df_ = (s1**2 / n1 + s2**2 / n2) ** 2 / ((s1**2 / n1) ** 2 / (n1 - 1) + (s2**2 / n2) ** 2 / (n2 - 1))
    else:
        sp = math.sqrt(((n1 - 1) * s1**2 + (n2 - 1) * s2**2) / (n1 + n2 - 2))
        se = sp * math.sqrt(1 / n1 + 1 / n2)
        df_ = n1 + n2 - 2
    t = diff / se
    allv = pd.concat([a, b])
    lo, hi = _ci(diff, se, df_)
    lines = [f"Two-sample t test with {'unequal' if unequal else 'equal'} variances", "-" * W] + head
    lines += [_trow(la, n1, m1, s1), _trow(lb, n2, m2, s2), fmt.rule(9, 68), _trow("Combined", len(allv), allv.mean(), allv.std()), fmt.rule(9, 68)]
    lines.append(f"{'diff':>8} |{'':8}{fmt.g(diff, 12)}{fmt.g(se, 12)}{'':12}{fmt.g(lo, 12)}{fmt.g(hi, 12)}")
    lines.append("-" * W)
    lines += _ttest_tail(f"    diff = mean({la[:12]}) - mean({lb[:12]})", t, df_, "diff = 0", "Satterthwaite's degrees of freedom" if unequal else "Degrees of freedom")
    pooled = math.sqrt(((n1 - 1) * s1**2 + (n2 - 1) * s2**2) / (n1 + n2 - 2))
    d = diff / pooled if pooled else float("nan")
    p2 = 2 * st.t.sf(abs(t), df_)
    notes = []
    if not unequal and n1 > 1 and n2 > 1:
        lev = st.levene(a, b, center="mean")
        if lev.pvalue < 0.05:
            notes.append(f"The two groups' variances differ (Levene's test p = {lev.pvalue:.3f}). Consider the unequal option (Welch's t-test).")
    rows = [[la, f"{n1:,}", fmt.apa_num(m1), fmt.apa_num(s1)], [lb, f"{n2:,}", fmt.apa_num(m2), fmt.apa_num(s2)]]
    note = f"t({fmt.apa_num(df_, 0 if not unequal else 2)}) = {fmt.apa_num(t)}, p {('< .001' if p2 < 0.001 else '= ' + fmt.apa_p(p2))}; mean difference = {fmt.apa_num(diff)}, 95% CI [{fmt.apa_num(lo)}, {fmt.apa_num(hi)}]; Cohen's d = {fmt.apa_num(d)}."
    t_ = Table(f"{nice(ds, y)} by {nice(ds, g)}", [nice(ds, g), "n", "M", "SD"], rows, note=note)
    return Result(log="\n".join(lines), tables=[t_], notes=notes, summary={"test": "two-sample t", "groups": [la, lb], "n": [n1, n2], "means": [m1, m2], "sd": [s1, s2], "diff": diff, "t": t, "df": df_, "p": p2, "ci": [lo, hi], "cohens_d": d, "unequal": unequal})


def _ttest_one(ds, cmd, y, mu, head) -> Result:
    _need_numeric(ds, [y])
    d = sample(ds, cmd, [y])[y].astype(float)
    n, m, s = len(d), d.mean(), d.std()
    se = s / math.sqrt(n)
    t = (m - mu) / se
    lines = ["One-sample t test", "-" * W] + head + [_trow(y, n, m, s), "-" * W]
    lines += _ttest_tail(f"    mean = mean({y})", t, n - 1, f"mean = {fmt.g(mu).strip()}")
    lines = [l.replace("diff", "mean") if l.strip().startswith("Ha") else l for l in lines]
    p2 = 2 * st.t.sf(abs(t), n - 1)
    lo, hi = _ci(m, se, n - 1)
    note = f"t({n - 1}) = {fmt.apa_num(t)}, p {('< .001' if p2 < 0.001 else '= ' + fmt.apa_p(p2))}; test value = {fmt.g(mu).strip()}; 95% CI of the mean [{fmt.apa_num(lo)}, {fmt.apa_num(hi)}]; d = {fmt.apa_num((m - mu) / s)}."
    return Result(log="\n".join(lines), tables=[Table(f"One-sample t-test: {nice(ds, y)}", ["Variable", "n", "M", "SD"], [[nice(ds, y), f"{n:,}", fmt.apa_num(m), fmt.apa_num(s)]], note=note)], summary={"test": "one-sample t", "n": n, "mean": m, "sd": s, "mu": mu, "t": t, "df": n - 1, "p": p2})


def _ttest_paired(ds, cmd, a, b, head) -> Result:
    _need_numeric(ds, [a, b])
    sub = sample(ds, cmd, [a, b])
    x, y = sub[a].astype(float), sub[b].astype(float)
    d = x - y
    n = len(d)
    se = d.std() / math.sqrt(n)
    t = d.mean() / se
    lines = ["Paired t test", "-" * W] + head + [_trow(a, n, x.mean(), x.std()), _trow(b, n, y.mean(), y.std()), fmt.rule(9, 68), _trow("diff", n, d.mean(), d.std()), "-" * W]
    lines += _ttest_tail(f"     mean(diff) = mean({a} - {b})", t, n - 1, "mean(diff) = 0", "Degrees of freedom")
    p2 = 2 * st.t.sf(abs(t), n - 1)
    lo, hi = _ci(d.mean(), se, n - 1)
    note = f"t({n - 1}) = {fmt.apa_num(t)}, p {('< .001' if p2 < 0.001 else '= ' + fmt.apa_p(p2))}; mean difference = {fmt.apa_num(d.mean())}, 95% CI [{fmt.apa_num(lo)}, {fmt.apa_num(hi)}]."
    rows = [[nice(ds, a), f"{n:,}", fmt.apa_num(x.mean()), fmt.apa_num(x.std())], [nice(ds, b), f"{n:,}", fmt.apa_num(y.mean()), fmt.apa_num(y.std())]]
    return Result(log="\n".join(lines), tables=[Table("Paired-samples t-test", ["Measure", "n", "M", "SD"], rows, note=note)], summary={"test": "paired t", "n": n, "mean_diff": d.mean(), "t": t, "df": n - 1, "p": p2})


# ───────────── one-way ANOVA ─────────────


def oneway(ds: Dataset, cmd: Command) -> Result:
    vs = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    if len(vs) != 2:
        raise StataError("use: oneway outcome group")
    y, g = vs
    _need_numeric(ds, [y])
    sub = sample(ds, cmd, [y, g])
    levels = _levels(ds, sub[g], False)
    if len(levels) < 2:
        raise StataError(f"{g} has only one group in this sample")
    groups = [sub.loc[sub[g] == lv, y].astype(float) for lv in levels]
    allv = sub[y].astype(float)
    N, k = len(allv), len(levels)
    grand = allv.mean()
    ssb = sum(len(x) * (x.mean() - grand) ** 2 for x in groups)
    ssw = sum(((x - x.mean()) ** 2).sum() for x in groups)
    dfb, dfw = k - 1, N - k
    msb, msw = ssb / dfb, ssw / dfw if dfw > 0 else float("nan")
    F = msb / msw if msw else float("nan")
    pv = float(st.f.sf(F, dfb, dfw))
    lines = []
    if cmd.opt("tabulate"):
        lines += [f"{'':12} |{'Summary of ' + (ds.label(y) or y):^37}", f"{fmt.name(g)} |        Mean   Std. dev.       Freq.", fmt.rule(13, 37)]
        for lv, x in zip(levels, groups):
            lines.append(f"{fmt.name(level_label(ds, g, lv))} |{fmt.g(x.mean(), 12)}{fmt.g(x.std(), 12)}{len(x):>12,}")
        lines += [fmt.rule(13, 37), f"{'Total':>12} |{fmt.g(grand, 12)}{fmt.g(allv.std(), 12)}{N:>12,}", ""]
    lines += [
        f"{'Analysis of variance':^72}".rstrip(),
        "    Source              SS         df      MS            F     Prob > F",
        "-" * 72,
        f"Between groups  {fmt.g(ssb, 12)}{dfb:>8}{fmt.g(msb, 12)}{F:>12.2f}{pv:>11.4f}",
        f" Within groups  {fmt.g(ssw, 12)}{dfw:>8}{fmt.g(msw, 12)}",
        "-" * 72,
        f"    Total       {fmt.g(ssb + ssw, 12)}{N - 1:>8}{fmt.g((ssb + ssw) / (N - 1), 12)}",
    ]
    valid = [x for x in groups if len(x) > 1 and x.var() > 0]
    notes = []
    if len(valid) == k:
        bt = st.bartlett(*groups)
        lines += ["", f"Bartlett's equal-variances test: chi2({k - 1}) = {bt.statistic:>8.4f}    Prob>chi2 = {bt.pvalue:.3f}"]
        if bt.pvalue < 0.05:
            notes.append(f"Group variances differ (Bartlett p = {bt.pvalue:.3f}); consider the Kruskal–Wallis test (kwallis) as a check.")
    comps = []
    if cmd.opt("bonferroni") or cmd.opt("scheffe") or cmd.opt("sidak"):
        method = "Bonferroni" if cmd.opt("bonferroni") else "Scheffe" if cmd.opt("scheffe") else "Sidak"
        npairs = k * (k - 1) / 2
        lines += ["", f"{'Comparison of ' + (ds.label(y) or y) + ' by ' + (ds.label(g) or g):^72}".rstrip(), f"{'(' + method + ')':^72}".rstrip()]
        labs = [level_label(ds, g, lv) for lv in levels]
        lines.append(f"Row Mean-|" + "".join(f"{l[:10]:>11}" for l in labs[:-1]))
        lines.append(f"Col Mean |")
        lines.append("-" * 9 + "+" + "-" * (11 * (k - 1)))
        for i in range(1, k):
            cells, ps = [], []
            for j in range(i):
                diff = groups[i].mean() - groups[j].mean()
                se = math.sqrt(msw * (1 / len(groups[i]) + 1 / len(groups[j])))
                tval = diff / se
                p_raw = 2 * st.t.sf(abs(tval), dfw)
                if method == "Bonferroni":
                    padj = min(1.0, p_raw * npairs)
                elif method == "Sidak":
                    padj = min(1.0, 1 - (1 - p_raw) ** npairs)
                else:
                    padj = float(st.f.sf(tval**2 / (k - 1), k - 1, dfw))
                cells.append(fmt.g(diff, 11))
                ps.append(f"{padj:>11.3f}")
                comps.append({"a": labs[i], "b": labs[j], "diff": diff, "p": padj})
            lines.append(f"{labs[i][:8]:>8} |" + "".join(cells))
            lines.append(f"{'':8} |" + "".join(ps))
            lines.append(f"{'':8} |")
    eta2 = ssb / (ssb + ssw) if (ssb + ssw) else float("nan")
    rows = [[level_label(ds, g, lv), f"{len(x):,}", fmt.apa_num(x.mean()), fmt.apa_num(x.std())] for lv, x in zip(levels, groups)]
    note = f"F({dfb}, {dfw}) = {fmt.apa_num(F)}, p {('< .001' if pv < 0.001 else '= ' + fmt.apa_p(pv))}, η² = {fmt.apa_r(eta2)}."
    tables = [Table(f"{nice(ds, y)} by {nice(ds, g)}", [nice(ds, g), "n", "M", "SD"], rows, note=note)]
    tables.append(Table("Analysis of variance", ["Source", "SS", "df", "MS", "F", "p"], [["Between groups", fmt.apa_num(ssb), str(dfb), fmt.apa_num(msb), fmt.apa_num(F), fmt.apa_p(pv)], ["Within groups", fmt.apa_num(ssw), str(dfw), fmt.apa_num(msw), "", ""], ["Total", fmt.apa_num(ssb + ssw), str(N - 1), "", "", ""]]))
    return Result(log="\n".join(lines), tables=tables, notes=notes, summary={"test": "one-way ANOVA", "F": F, "df": [dfb, dfw], "p": pv, "eta2": eta2, "groups": [{"group": r[0], "n": len(x), "mean": x.mean(), "sd": x.std()} for r, x in zip(rows, groups)], "comparisons": comps})


# ───────────── correlation ─────────────


def correlate(ds: Dataset, cmd: Command) -> Result:
    vs = [v for v in expand_varlist(cmd.args, ds.df) if is_numeric(ds.df[v])]
    if len(vs) < 2:
        raise StataError("need at least two numeric variables")
    pairwise = cmd.name == "pwcorr"
    spearman = cmd.name == "spearman"
    mask = selected(ds, cmd)
    wkind = None
    if cmd.weight:
        if spearman:
            raise StataError("weights not allowed with spearman")
        wall = weight_values(ds, cmd)
        mask &= wall.notna() & wall.ne(0)
    df = ds.df.loc[mask, vs].astype(float)
    if cmd.weight:
        wkind, wfull = weights(ds, cmd, df, "aw fw")
        df = df.assign(__w=wfull)
    if not pairwise:
        df = df.dropna()
    k = len(vs)
    R = np.full((k, k), np.nan)
    P = np.full((k, k), np.nan)
    Nm = np.zeros((k, k), dtype=int)
    for i in range(k):
        for j in range(i + 1):
            pair = df[[vs[i], vs[j]] + (["__w"] if wkind else [])].dropna()
            Nm[i, j] = int(round(pair["__w"].sum())) if wkind == "fw" else len(pair)
            if i == j:
                R[i, j], P[i, j] = 1.0, np.nan
                continue
            if wkind and len(pair) > 2:
                ww = pair["__w"].to_numpy()
                a, c = pair[vs[i]].to_numpy(), pair[vs[j]].to_numpy()
                ma, mc = (ww * a).sum() / ww.sum(), (ww * c).sum() / ww.sum()
                r = float((ww * (a - ma) * (c - mc)).sum() / math.sqrt((ww * (a - ma) ** 2).sum() * (ww * (c - mc) ** 2).sum()))
                nn = Nm[i, j]
                tt = r * math.sqrt((nn - 2) / max(1e-300, 1 - r * r))
                R[i, j], P[i, j] = r, float(2 * st.t.sf(abs(tt), nn - 2))
            elif len(pair) > 2:
                r, pv = (st.spearmanr if spearman else st.pearsonr)(pair[vs[i]], pair[vs[j]])
                R[i, j], P[i, j] = float(getattr(r, "statistic", r)), float(pv)
    level = cmd.opt("star")
    starp = float(level) if isinstance(level, str) else (0.05 if level else None)
    show_sig, show_obs = bool(cmd.opt("sig")), bool(cmd.opt("obs"))
    lines = []
    if spearman and k == 2:
        n = Nm[1, 0]
        lines = [f" Number of obs = {n:>8,}", f"Spearman's rho = {R[1, 0]:>12.4f}", "", f"Test of H0: {vs[0]} and {vs[1]} are independent", f"    Prob > |t| = {P[1, 0]:>12.4f}"]
    else:
        if not pairwise:
            lines += sum_note(wkind, df["__w"].to_numpy() if wkind else None)
            lines.append(f"(obs={Nm[0, 0]:,})")
            lines.append("")
        lines.append(f"{'':12} |" + "".join(f"{fmt.name(v, 8):>9}" for v in vs))
        lines.append(fmt.rule(13, 9 * k))
        for i, v in enumerate(vs):
            lines.append(f"{fmt.name(v)} |" + "".join(f"{R[i, j]:>9.4f}{'*' if starp and i != j and P[i, j] < starp else ' '}"[:9] if j <= i else "" for j in range(k)))
            if pairwise or spearman:
                if show_sig:
                    lines.append(f"{'':12} |" + "".join(f"{P[i, j]:>9.4f}" if j < i else (" " * 9 if j == i else "") for j in range(k)))
                if show_obs:
                    lines.append(f"{'':12} |" + "".join(f"{Nm[i, j]:>9,}" if j <= i else "" for j in range(k)))
                if show_sig or show_obs:
                    lines.append(f"{'':12} |")
    # APA matrix: lower triangle with stars
    cols = ["Variable", "n"] + [str(i + 1) for i in range(k)]
    rows = []
    for i, v in enumerate(vs):
        cells = [f"{fmt.apa_r(R[i, j])}{fmt.stars(P[i, j])}" if j < i else ("—" if j == i else "") for j in range(k)]
        rows.append([f"{i + 1}. {nice(ds, v)}", f"{Nm[i, i]:,}"] + cells)
    kind = "Spearman" if spearman else "Pearson"
    note = f"{kind} correlations{', pairwise deletion' if pairwise else f', N = {len(df):,} (listwise)'}. *p < .05. **p < .01. ***p < .001."
    pairs = [{"a": vs[i], "b": vs[j], "r": R[i, j], "p": P[i, j], "n": int(Nm[i, j])} for i in range(k) for j in range(i)]
    return Result(log="\n".join(lines), tables=[Table(f"{kind} correlations", cols, rows, note=note)], summary={"method": kind, "pairs": pairs})


# ───────────── rank tests ─────────────


def _ties(x: np.ndarray) -> float:
    _, c = np.unique(x, return_counts=True)
    return float((c**3 - c).sum())


def ranksum(ds: Dataset, cmd: Command) -> Result:
    y = resolve_var(cmd.args.strip(), ds.df)
    by = cmd.opt("by")
    if not isinstance(by, str):
        raise StataError("use: ranksum outcome, by(group)")
    g = resolve_var(by, ds.df)
    _need_numeric(ds, [y])
    sub = sample(ds, cmd, [y, g])
    levels = _levels(ds, sub[g], False)
    if len(levels) != 2:
        raise StataError(f"{g} must have exactly 2 groups (it has {len(levels)})")
    x = sub[y].astype(float).to_numpy()
    ranks = st.rankdata(x)
    grp = (sub[g] == levels[0]).to_numpy()
    n1, n2 = int(grp.sum()), int((~grp).sum())
    N = n1 + n2
    R1, R2 = ranks[grp].sum(), ranks[~grp].sum()
    E1, E2 = n1 * (N + 1) / 2, n2 * (N + 1) / 2
    v_un = n1 * n2 * (N + 1) / 12
    adj = -n1 * n2 * _ties(x) / (12 * N * (N - 1))
    v = v_un + adj
    z = (R1 - E1) / math.sqrt(v)
    pv = 2 * st.norm.sf(abs(z))
    la, lb = level_label(ds, g, levels[0]), level_label(ds, g, levels[1])
    lines = [
        "Two-sample Wilcoxon rank-sum (Mann–Whitney) test",
        "",
        f"{fmt.name(g)} |      Obs    Rank sum    Expected",
        fmt.rule(13, 33),
        f"{fmt.name(la)} |{n1:>9,}{fmt.g(R1, 12)}{fmt.g(E1, 12)}",
        f"{fmt.name(lb)} |{n2:>9,}{fmt.g(R2, 12)}{fmt.g(E2, 12)}",
        fmt.rule(13, 33),
        f"{'Combined':>12} |{N:>9,}{fmt.g(R1 + R2, 12)}{fmt.g(E1 + E2, 12)}",
        "",
        f"Unadjusted variance {v_un:>10.2f}",
        f"Adjustment for ties {adj:>10.2f}",
        f"{'':20} ----------",
        f"Adjusted variance   {v:>10.2f}",
        "",
        f"H0: {y}({g}=={la}) = {y}({g}=={lb})",
        f"         z = {z:>7.3f}",
        f"Prob > |z| = {pv:>7.4f}",
    ]
    r_eff = abs(z) / math.sqrt(N)
    rows = [[la, f"{n1:,}", fmt.apa_num(np.median(x[grp])), fmt.apa_num(R1 / n1)], [lb, f"{n2:,}", fmt.apa_num(np.median(x[~grp])), fmt.apa_num(R2 / n2)]]
    note = f"Mann–Whitney U test: z = {fmt.apa_num(z)}, p {('< .001' if pv < 0.001 else '= ' + fmt.apa_p(pv))}, r = {fmt.apa_r(r_eff)}."
    return Result(log="\n".join(lines), tables=[Table(f"{nice(ds, y)} by {nice(ds, g)}", [nice(ds, g), "n", "Mdn", "Mean rank"], rows, note=note)], summary={"test": "Mann-Whitney", "z": z, "p": pv, "n": [n1, n2], "r": r_eff})


def kwallis(ds: Dataset, cmd: Command) -> Result:
    y = resolve_var(cmd.args.strip(), ds.df)
    by = cmd.opt("by")
    if not isinstance(by, str):
        raise StataError("use: kwallis outcome, by(group)")
    g = resolve_var(by, ds.df)
    _need_numeric(ds, [y])
    sub = sample(ds, cmd, [y, g])
    levels = _levels(ds, sub[g], False)
    x = sub[y].astype(float).to_numpy()
    ranks = st.rankdata(x)
    N = len(x)
    rows, H = [], 0.0
    lines = ["Kruskal–Wallis equality-of-populations rank test", "", "  +" + "-" * 34 + "+", f"  | {fmt.name(g, 12)} |   Obs | Rank sum |", "  |" + "-" * 14 + "+" + "-" * 7 + "+" + "-" * 10 + "|"]
    for lv in levels:
        m = (sub[g] == lv).to_numpy()
        n, R = int(m.sum()), ranks[m].sum()
        H += R**2 / n
        lab = level_label(ds, g, lv)
        lines.append(f"  | {fmt.name(lab, 12)} | {n:>5,} | {fmt.g(R, 8)} |")
        rows.append([lab, f"{n:,}", fmt.apa_num(np.median(x[m])), fmt.apa_num(R / n)])
    lines.append("  +" + "-" * 34 + "+")
    H = 12 / (N * (N + 1)) * H - 3 * (N + 1)
    df_ = len(levels) - 1
    Ht = H / (1 - _ties(x) / (N**3 - N))
    p, pt = st.chi2.sf(H, df_), st.chi2.sf(Ht, df_)
    lines += ["", f"chi2({df_}) = {H:>8.3f}", f"Prob = {p:.4f}", "", f"chi2({df_}) with ties = {Ht:>8.3f}", f"Prob = {pt:.4f}"]
    note = f"Kruskal–Wallis H({df_}) = {fmt.apa_num(Ht)}, p {('< .001' if pt < 0.001 else '= ' + fmt.apa_p(pt))} (corrected for ties)."
    return Result(log="\n".join(lines), tables=[Table(f"{nice(ds, y)} by {nice(ds, g)}", [nice(ds, g), "n", "Mdn", "Mean rank"], rows, note=note)], summary={"test": "Kruskal-Wallis", "chi2": Ht, "df": df_, "p": pt})


def signrank(ds: Dataset, cmd: Command) -> Result:
    args = cmd.args.replace("==", "=")
    if "=" not in args:
        raise StataError("use: signrank var = 0 | signrank before = after")
    left, right = (s.strip() for s in args.split("=", 1))
    a = resolve_var(left, ds.df)
    try:
        val = float(right)
        b = None
    except ValueError:
        b = resolve_var(right, ds.df)
    sub = sample(ds, cmd, [a] + ([b] if b else []))
    d = (sub[a].astype(float) - (sub[b].astype(float) if b else val)).to_numpy()
    n = len(d)
    ranks = st.rankdata(np.abs(d))
    pos, neg, zer = d > 0, d < 0, d == 0
    Tp, Tn, Tz = ranks[pos].sum(), ranks[neg].sum(), ranks[zer].sum()
    n0 = int(zer.sum())
    E = (n * (n + 1) / 2 - n0 * (n0 + 1) / 2) / 2
    v_un = n * (n + 1) * (2 * n + 1) / 24
    adj_t = -_ties(np.abs(d)) / 48
    adj_z = -n0 * (n0 + 1) * (2 * n0 + 1) / 24
    v = v_un + adj_t + adj_z
    z = (Tp - E) / math.sqrt(v) if v > 0 else float("nan")
    pv = 2 * st.norm.sf(abs(z))
    rhs = b if b else fmt.g(val).strip()
    lines = [
        "Wilcoxon signed-rank test",
        "",
        "        Sign |      Obs   Sum ranks    Expected",
        fmt.rule(13, 33),
        f"{'Positive':>12} |{int(pos.sum()):>9,}{fmt.g(Tp, 12)}{fmt.g(E, 12)}",
        f"{'Negative':>12} |{int(neg.sum()):>9,}{fmt.g(Tn, 12)}{fmt.g(E, 12)}",
        f"{'Zero':>12} |{n0:>9,}{fmt.g(Tz, 12)}{fmt.g(Tz, 12)}",
        fmt.rule(13, 33),
        f"{'All':>12} |{n:>9,}{fmt.g(Tp + Tn + Tz, 12)}{fmt.g(2 * E + Tz, 12)}",
        "",
        f"Unadjusted variance {v_un:>10.2f}",
        f"Adjustment for ties {adj_t:>10.2f}",
        f"Adjustment for zeros{adj_z:>10.2f}",
        f"{'':20} ----------",
        f"Adjusted variance   {v:>10.2f}",
        "",
        f"H0: {a} = {rhs}",
        f"         z = {z:>7.3f}",
        f"Prob > |z| = {pv:>7.4f}",
    ]
    note = f"Wilcoxon signed-rank test: z = {fmt.apa_num(z)}, p {('< .001' if pv < 0.001 else '= ' + fmt.apa_p(pv))}, N = {n:,}."
    return Result(log="\n".join(lines), tables=[Table("Wilcoxon signed-rank test", ["Comparison", "N", "Positive ranks", "Negative ranks", "z", "p"], [[f"{nice(ds, a)} vs {rhs}", f"{n:,}", str(int(pos.sum())), str(int(neg.sum())), fmt.apa_num(z), fmt.apa_p(pv)]], note=note)], summary={"test": "signed-rank", "z": z, "p": pv, "n": n})


# ───────────── regression ─────────────


@dataclass
class Col:
    group: str  # heading for factor terms ("" for plain variables)
    label: str  # row label
    apa: str  # predictor name for APA tables
    values: np.ndarray


def _base_level(levels: list, base, s: pd.Series):
    if base is None or base == "first":
        return levels[0]
    if base == "last":
        return levels[-1]
    if base == "freq":
        return s.value_counts().idxmax()
    b = float(base)
    if b not in [float(x) for x in levels]:
        raise StataError(f"base level {base} not found")
    return [x for x in levels if float(x) == b][0]


def build_design(ds: Dataset, sub: pd.DataFrame, terms: list[Term], levels_map: dict | None = None, record: dict | None = None) -> list[Col]:
    """Design columns for `terms`. `levels_map` fixes each factor's levels and base (used to predict
    on other rows exactly as the model was estimated); `record` receives the ones used."""
    cols: list[Col] = []
    for term in terms:
        pieces: list[list[tuple[str, str, np.ndarray]]] = []  # per component: list of (label, apa, values)
        names = []
        for comp in term.parts:
            if comp[0] == "c":
                v = comp[1]
                if not is_numeric(sub[v]):
                    raise StataError(f"{v}: string variables need i. (factor) notation or recoding")
                pieces.append([(v, nice(ds, v), sub[v].astype(float).to_numpy())])
                names.append(("c", v))
            else:
                v, base = comp[1], comp[2]
                if not is_numeric(sub[v]):
                    raise StataError(f"{v}: factor variables must be numeric codes (recode text into numbers first)")
                s = sub[v]
                if np.any(np.mod(s.dropna(), 1) != 0) or (s < 0).any():
                    raise StataError(f"{v}: factor variables may not contain negative or noninteger values")
                if levels_map and v in levels_map:
                    levels, b = levels_map[v]
                else:
                    levels = sorted(s.dropna().unique().tolist())
                    b = _base_level(levels, base, s)
                if record is not None:
                    record[v] = (levels, b)
                pieces.append([(level_label(ds, v, lv), level_label(ds, v, lv), (s == lv).to_numpy(dtype=float)) for lv in levels if lv != b])
                names.append(("i", v))
        group = "#".join(("c." + v if (k == "c" and len(names) > 1) else v) for k, v in names)
        only_continuous = all(k == "c" for k, _ in names)
        combos: list[tuple[list[str], list[str], np.ndarray]] = [([], [], np.ones(len(sub)))]
        for piece in pieces:
            combos = [(labs + [lab], apas + [apa], vals * pv) for labs, apas, vals in combos for lab, apa, pv in piece]
        for labs, apas, vals in combos:
            if only_continuous:
                lab = "#".join(f"c.{v}" for _, v in names) if len(names) > 1 else names[0][1]
                cols.append(Col("", lab, " × ".join(apas), vals))
            else:
                cont = [k == "c" for k, _ in names]
                row_lab = "#".join(l for l, c in zip(labs, cont) if not c)
                apa_lab = " × ".join(apas)
                cols.append(Col(group, row_lab, apa_lab, vals))
    return cols


def _drop_collinear(X: np.ndarray, cols: list[Col]) -> tuple[np.ndarray, list[Col], list[Col]]:
    keep, omitted = [], []
    cur = np.empty((X.shape[0], 0))
    for j in range(X.shape[1]):
        cand = np.column_stack([cur, X[:, j]])
        if np.linalg.matrix_rank(cand, tol=1e-8 * max(1.0, np.abs(cand).max())) > cur.shape[1]:
            cur = cand
            keep.append(j)
        else:
            omitted.append(cols[j])
    return cur, [cols[j] for j in keep], omitted


def _coef_table(depvar: str, cols: list[Col], omitted: list[Col], b, se, stat, pv, lo, hi, stat_name: str, coef_name: str, robust_word: str = "", cons_label: str = "_cons") -> list[str]:
    hdr_stat = f"{stat_name:>9}" if stat_name == "t" else f"{stat_name:>9}"
    lines = ["-" * W]
    if robust_word:
        lines.append(f"{'':12} |{robust_word:>24}")
    lines.append(f"{fmt.name(depvar)} | {coef_name:>11} {'Std. err.' if not robust_word else 'std. err.':>10}{hdr_stat}{'P>|' + stat_name + '|':>8}     [95% conf. interval]")
    lines.append(fmt.rule(13, 64))
    order = cols + omitted
    last_group = None
    for c in order:
        if c.group and c.group != last_group:
            lines.append(f"{fmt.name(c.group)} |")
        last_group = c.group or None
        nm = fmt.name(c.label)
        if c in omitted:
            lines.append(f"{nm} |{'0':>11}  (omitted)")
            continue
        i = cols.index(c)
        lines.append(f"{nm} |{fmt.g(b[i], 11)}{fmt.g(se[i], 11)}{stat[i]:>9.2f}{fmt.p(pv[i])}{fmt.g(lo[i], 13)}{fmt.g(hi[i], 12)}")
    if cons_label:
        i = len(cols)
        if order and order[-1].group:
            lines.append(f"{'':12} |")
        lines.append(f"{fmt.name(cons_label)} |{fmt.g(b[i], 11)}{fmt.g(se[i], 11)}{stat[i]:>9.2f}{fmt.p(pv[i])}{fmt.g(lo[i], 13)}{fmt.g(hi[i], 12)}")
    lines.append("-" * W)
    return lines


def _apa_reg_rows(cols: list[Col], b, se, stat, pv, lo, hi, transform=None, with_cons=True, decimals=2, labels=None) -> tuple[list[list[str]], list[int]]:
    rows, groups, last = [], [], None
    for i, c in enumerate(cols):
        if c.group and c.group != last:
            groups.append(len(rows))
            rows.append([" × ".join((labels or {}).get(v) or v for v in c.group.split("#")), "", "", "", "", ""])
        last = c.group or None
        name = ("    " + c.apa) if c.group else c.apa
        if transform:
            rows.append([name, fmt.apa_num(transform(b[i]), decimals), f"[{fmt.apa_num(transform(lo[i]), decimals)}, {fmt.apa_num(transform(hi[i]), decimals)}]", fmt.apa_num(stat[i]), fmt.apa_p(pv[i]) + fmt.stars(pv[i]), ""])
        else:
            rows.append([name, fmt.apa_num(b[i], decimals + 1 if abs(b[i]) < 0.1 else decimals), fmt.apa_num(se[i], decimals + 1 if abs(se[i]) < 0.1 else decimals), fmt.apa_num(stat[i]), fmt.apa_p(pv[i]) + fmt.stars(pv[i]), f"[{fmt.apa_num(lo[i])}, {fmt.apa_num(hi[i])}]"])
    if with_cons:
        i = len(cols)
        if transform:
            rows.append(["Constant", fmt.apa_num(transform(b[i]), decimals), f"[{fmt.apa_num(transform(lo[i]), decimals)}, {fmt.apa_num(transform(hi[i]), decimals)}]", fmt.apa_num(stat[i]), fmt.apa_p(pv[i]), ""])
        else:
            rows.append(["Constant", fmt.apa_num(b[i]), fmt.apa_num(se[i]), fmt.apa_num(stat[i]), fmt.apa_p(pv[i]), f"[{fmt.apa_num(lo[i])}, {fmt.apa_num(hi[i])}]"])
    if transform:
        rows = [r[:5] for r in rows]
    return rows, groups


def _prepare(ds: Dataset, cmd: Command):
    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError(f"use: {cmd.name} outcome predictors")
    y = resolve_var(toks[0], ds.df)
    terms = parse_fvlist(toks[1], ds.df)
    vars_ = [y] + sorted({p[1] for t in terms for p in t.parts})
    clus = cmd.opt("cluster")
    vce = cmd.opt("vce")
    cluster_var = None
    if isinstance(vce, str) and vce.lower().startswith("cl"):
        cluster_var = resolve_var(vce.split()[1], ds.df)
    elif isinstance(clus, str):
        cluster_var = resolve_var(clus, ds.df)
    if cluster_var:
        vars_.append(cluster_var)
    _need_numeric(ds, [y])
    sub = sample(ds, cmd, vars_)
    if len(sub) == 0:
        raise StataError("no observations")
    rec: dict = {}
    cols = build_design(ds, sub, terms, record=rec)
    X = np.column_stack([c.values for c in cols]) if cols else np.empty((len(sub), 0))
    X, cols, omitted = _drop_collinear(X, cols)
    robust = bool(cmd.opt("robust")) or (isinstance(vce, str) and vce.lower().startswith("r"))
    cmd._design = (terms, rec)  # remembered for predict / margins
    return y, sub, cols, omitted, X, robust, cluster_var


def remember(ds: Dataset, cmd: Command, kind: str, y: str, sub: pd.DataFrame, cols: list, b, V, df_r, w, extra: dict | None = None):
    """The last estimation, for predict, estat and margins (Stata's e())."""
    terms, levels = cmd._design
    ds.last_est = {
        "cmd": cmd.raw, "kind": kind, "y": y, "terms": terms, "levels": levels,
        "keep": [(c.group, c.label) for c in cols], "b": np.asarray(b, dtype=float), "V": np.asarray(V, dtype=float),
        "df_r": df_r, "sample": sub.index.copy(), "w": w, "weight": cmd.weight, **(extra or {}),
    }


def _hdr(label: str, value: str) -> str:
    """Right-hand header item, Stata-aligned: label padded to 17, then '= value'."""
    return f"{label:<17}= {value:>10}"


def regress(ds: Dataset, cmd: Command) -> Result:
    y, sub, cols, omitted, X, robust, cluster_var = _prepare(ds, cmd)
    kind, wraw = weights(ds, cmd, sub, "aw pw fw")
    yv = sub[y].astype(float).to_numpy()
    Xc = np.column_stack([X, np.ones(len(yv))])
    rows_n, k = Xc.shape
    if kind == "pw" and not cluster_var:
        robust = True  # Stata: pweights imply robust standard errors
    w = normalized(kind, wraw, rows_n)
    n = int(round(w.sum())) if kind == "fw" else rows_n  # frequency weights expand the sample
    if n <= k:
        raise StataError("insufficient observations")
    model = sm.WLS(yv, Xc, weights=w) if kind else sm.OLS(yv, Xc)
    if cluster_var:
        groups = pd.factorize(sub[cluster_var])[0]
        res = model.fit(cov_type="cluster", cov_kwds={"groups": groups, "use_correction": True, "df_correction": True})
        G = int(groups.max() + 1)
        df_inf = G - 1
    elif robust:
        res = model.fit(cov_type="HC1")
        df_inf = n - k
    elif kind == "fw":
        res = model.fit()
        e = yv - Xc @ res.params
        sigma2 = float((w * e**2).sum() / (n - k))
        res_cov = sigma2 * np.linalg.inv(Xc.T @ (Xc * w[:, None]))
        df_inf = n - k
    else:
        res = model.fit()
        df_inf = n - k
    b = res.params
    Vb = res_cov if (kind == "fw" and not robust and not cluster_var) else np.asarray(res.cov_params())
    se = np.sqrt(np.diag(Vb))
    tval = b / se
    pv = 2 * st.t.sf(np.abs(tval), df_inf)
    tc = st.t.ppf(0.975, df_inf)
    lo, hi = b - tc * se, b + tc * se
    resid = yv - Xc @ b
    rss = float((w * resid**2).sum())
    ybar = float((w * yv).sum() / w.sum())
    tss = float((w * (yv - ybar) ** 2).sum())
    mss = tss - rss
    dfm, dfr = k - 1, n - k
    r2 = 1 - rss / tss if tss else float("nan")
    adj = 1 - (1 - r2) * (n - 1) / dfr
    rmse = math.sqrt(rss / dfr)
    q = k - 1
    F_df2 = df_inf if cluster_var else dfr
    if q > 0 and not (cluster_var and q > df_inf):
        R = np.eye(k)[:-1]
        V = Vb
        Rb = R @ b
        F = float(Rb @ np.linalg.solve(R @ V @ R.T, Rb) / q)
        pF = float(st.f.sf(F, q, F_df2))
    else:
        F, pF = float("nan"), float("nan")  # Stata reports F = . when there are too few clusters
    lines = sum_note(kind, wraw)
    if robust or cluster_var:
        Fs = "." if math.isnan(F) else f"{F:.2f}"
        pFs = "." if math.isnan(pF) else f"{pF:.4f}"
        lines += [
            f"{'Linear regression':<48}{_hdr('Number of obs', f'{n:,}')}",
            f"{'':48}{_hdr(f'F({q}, {F_df2})', Fs)}",
            f"{'':48}{_hdr('Prob > F', pFs)}",
            f"{'':48}{_hdr('R-squared', f'{r2:.4f}')}",
            f"{'':48}{_hdr('Root MSE', fmt.g(rmse).strip())}",
            "",
        ]
        if cluster_var:
            lines.append(f"{'(Std. err. adjusted for ' + format(G, ',') + ' clusters in ' + cluster_var + ')':>78}")
        lines += _coef_table(y, cols, omitted, b, se, tval, pv, lo, hi, "t", "Coefficient", robust_word="Robust")
    else:
        H = lambda l, v: f"{l:<16}= {v:>9}"  # noqa: E731
        lines += [
            f"      Source |       SS           df       MS      {H('Number of obs', f'{n:,}')}",
            f"-------------+----------------------------------   {H(f'F({dfm}, {dfr})', f'{F:.2f}')}",
            f"       Model |{fmt.g(mss, 12, fw=10)}{dfm:>11,}{fmt.g(mss / dfm if dfm else float('nan'), 12, fw=10)}   {H('Prob > F', f'{pF:.4f}')}",
            f"    Residual |{fmt.g(rss, 12, fw=10)}{dfr:>11,}{fmt.g(rss / dfr, 12, fw=10)}   {H('R-squared', f'{r2:.4f}')}",
            f"-------------+----------------------------------   {H('Adj R-squared', f'{adj:.4f}')}",
            f"       Total |{fmt.g(tss, 12, fw=10)}{n - 1:>11,}{fmt.g(tss / (n - 1), 12, fw=10)}   {H('Root MSE', fmt.g(rmse).strip())}",
            "",
        ]
        lines += _coef_table(y, cols, omitted, b, se, tval, pv, lo, hi, "t", "Coefficient")
    if cmd.opt("beta"):
        def wsd(v):
            m = (w * v).sum() / w.sum()
            return math.sqrt((w * (v - m) ** 2).sum() / (w.sum() - 1))
        sy = wsd(yv)
        betas = [b[i] * wsd(X[:, i]) / sy for i in range(len(cols))]
        lines += ["", "Standardized coefficients (beta):"] + [f"{fmt.name(c.label)} |{fmt.g(bt, 11)}" for c, bt in zip(cols, betas)]
    rows, groups = _apa_reg_rows(cols, b, se, tval, pv, lo, hi, labels=ds.var_labels)
    se_kind = (f" Weighted ({cmd.weight[0]}={cmd.weight[1]})." if kind else "") + (" Robust standard errors." if robust and not cluster_var else (f" Standard errors clustered by {nice(ds, cluster_var)} ({G} clusters)." if cluster_var else ""))
    ftxt = "" if math.isnan(F) else f", F({q}, {F_df2}) = {fmt.apa_num(F)}, p {('< .001' if pF < 0.001 else '= ' + fmt.apa_p(pF))}"
    note = f"N = {n:,}. R² = {fmt.apa_r(r2)}, adjusted R² = {fmt.apa_r(adj)}{ftxt}.{se_kind} *p < .05. **p < .01. ***p < .001."
    t = Table(f"Linear regression predicting {nice(ds, y)}", ["Predictor", "B", "SE", "t", "p", "95% CI"], rows, note=note, groups=groups)
    notes = [f"{c.label if not c.group else c.group + '=' + c.label} was omitted because of collinearity." for c in omitted]
    remember(ds, cmd, "regress", y, sub, cols, b, Vb, df_inf, w if kind else None, {"rmse": rmse, "rss": rss, "n": n, "robust": robust, "cluster": cluster_var, "X": Xc, "yv": yv})
    summ = {"model": "OLS", "depvar": y, "n": n, "r2": r2, "adj_r2": adj, "F": F, "df": [q, F_df2], "p_F": pF, "robust": robust, "cluster": cluster_var, "coefs": [{"term": (c.group + "=" if c.group else "") + c.label, "b": float(b[i]), "se": float(se[i]), "t": float(tval[i]), "p": float(pv[i]), "ci": [float(lo[i]), float(hi[i])]} for i, c in enumerate(cols)] + [{"term": "_cons", "b": float(b[-1]), "p": float(pv[-1])}]}
    return Result(log="\n".join(lines), tables=[t], notes=notes, summary=summ)


def binary_or_count(ds: Dataset, cmd: Command) -> Result:
    kind = cmd.name  # logit | logistic | probit | poisson
    y, sub, cols, omitted, X, robust, cluster_var = _prepare(ds, cmd)
    yraw = sub[y].astype(float).to_numpy()
    if kind == "poisson":
        if (yraw < 0).any():
            raise StataError(f"{y} must be greater than or equal to zero")
        yv = yraw
    else:
        yv = (yraw != 0).astype(float)  # Stata: nonzero, nonmissing = 1
        if yv.min() == yv.max():
            raise StataError("outcome does not vary")
    Xc = np.column_stack([X, np.ones(len(yv))])
    n, k = Xc.shape
    wkind, wraw = weights(ds, cmd, sub, "pw fw iw")
    if wkind == "pw":
        robust = True  # pweights imply robust standard errors
    model_cls = {"logit": sm.Logit, "logistic": sm.Logit, "probit": sm.Probit, "poisson": sm.Poisson}[kind]
    G = 0
    try:
        if wkind:
            fam = sm.families.Poisson() if kind == "poisson" else sm.families.Binomial(link=sm.families.links.Probit() if kind == "probit" else sm.families.links.Logit())
            glm = sm.GLM(yv, Xc, family=fam, freq_weights=wraw)
            res = glm.fit()
            b = res.params
            if wkind in ("fw", "iw"):
                n = int(round(wraw.sum())) if wkind == "fw" else n
            if robust or cluster_var:
                scores = glm.score_obs(b)
                Hinv = np.linalg.inv(-glm.hessian(b))
                if cluster_var:
                    groups = pd.factorize(sub[cluster_var])[0]
                    G = int(groups.max() + 1)
                    S = np.zeros((G, k))
                    np.add.at(S, groups, scores)
                    V = Hinv @ (S.T @ S) @ Hinv * G / (G - 1)
                else:
                    V = Hinv @ (scores.T @ scores) @ Hinv * n / (n - 1)
            else:
                V = np.asarray(res.cov_params())
            llf, ll0 = float(res.llf), float(res.llnull)
            pred = res.predict(Xc)
        else:
            if cluster_var:
                groups = pd.factorize(sub[cluster_var])[0]
                res = model_cls(yv, Xc).fit(disp=0, cov_type="cluster", cov_kwds={"groups": groups})
                G = int(groups.max() + 1)
            else:
                res = model_cls(yv, Xc).fit(disp=0, maxiter=200)
            b = res.params
            V = np.asarray(res.cov_params())
            if robust and not cluster_var:
                rob = model_cls(yv, Xc).fit(disp=0, cov_type="HC0", start_params=b)
                V = np.asarray(rob.cov_params()) * n / (n - 1)  # Stata's robust adds n/(n-1)
            llf, ll0 = float(res.llf), float(res.llnull)
            pred = res.predict(Xc)
    except np.linalg.LinAlgError as e:
        raise StataError("a predictor perfectly predicts the outcome (perfect separation); drop or combine that predictor's categories") from e
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "separation" in msg or "singular" in msg:
            raise StataError("a predictor perfectly predicts the outcome (perfect separation); drop or combine that predictor's categories") from e
        raise StataError(f"the model did not converge ({type(e).__name__})") from e
    se = np.sqrt(np.diag(V))
    z = b / se
    pv = 2 * st.norm.sf(np.abs(z))
    lo, hi = b - 1.959963984540054 * se, b + 1.959963984540054 * se
    pseudo = 1 - llf / ll0
    q = k - 1
    if robust or cluster_var:
        R = np.eye(k)[:-1]
        Rb = R @ b
        chi = float(Rb @ np.linalg.solve(R @ V @ R.T, Rb)) if q else float("nan")
        test_lab = f"Wald chi2({q})"
    else:
        chi = 2 * (llf - ll0)
        test_lab = f"LR chi2({q})"
    pchi = float(st.chi2.sf(chi, q)) if q else float("nan")
    title = {"logit": "Logistic regression", "logistic": "Logistic regression", "probit": "Probit regression", "poisson": "Poisson regression"}[kind]
    ll_word = "Log pseudolikelihood" if (robust or cluster_var) else "Log likelihood"
    lines = sum_note(wkind, wraw) + [
        f"{title:<56}Number of obs = {n:>6,}",
        f"{'':56}{test_lab:<14}= {chi:>6.2f}",
        f"{'':56}{'Prob > chi2':<14}= {pchi:>6.4f}",
        f"{ll_word + ' = ' + format(llf, '.8g'):<56}{'Pseudo R2':<14}= {pseudo:>6.4f}",
        "",
    ]
    if cluster_var:
        lines.append(f"{'(Std. err. adjusted for ' + format(G, ',') + ' clusters in ' + cluster_var + ')':>78}")
    want_or = kind == "logistic" or (kind == "logit" and cmd.opt("or"))
    want_irr = kind == "poisson" and cmd.opt("irr")
    if want_or or want_irr:
        e = np.exp(b)
        lines += _coef_table(y, cols, omitted, e, e * se, z, pv, np.exp(lo), np.exp(hi), "z", "Odds ratio" if want_or else "IRR", robust_word="Robust" if (robust or cluster_var) else "")
        lines.append(f"Note: _cons estimates baseline {'odds' if want_or else 'incidence rate'}.")
    else:
        lines += _coef_table(y, cols, omitted, b, se, z, pv, lo, hi, "z", "Coefficient", robust_word="Robust" if (robust or cluster_var) else "")
    if kind in ("logit", "logistic", "probit"):
        correct = float(((pred >= 0.5) == (yv == 1)).mean())
        summ_extra = {"classified_correctly": correct}
    else:
        summ_extra = {}
    if kind in ("logit", "logistic"):
        rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, transform=np.exp, labels=ds.var_labels)
        cols_apa, effect = ["Predictor", "OR", "95% CI", "z", "p"], "odds ratios (OR)"
    elif kind == "poisson" and want_irr:
        rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, transform=np.exp, labels=ds.var_labels)
        cols_apa, effect = ["Predictor", "IRR", "95% CI", "z", "p"], "incidence-rate ratios (IRR)"
    else:
        rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, labels=ds.var_labels)
        cols_apa, effect = ["Predictor", "B", "SE", "z", "p", "95% CI"], "coefficients"
    note = f"N = {n:,}. {test_lab.replace('chi2', 'χ²')} = {fmt.apa_num(chi)}, p {('< .001' if pchi < 0.001 else '= ' + fmt.apa_p(pchi))}; pseudo R² = {fmt.apa_r(pseudo)}. Table shows {effect}.{' Robust standard errors.' if robust and not cluster_var else ''} *p < .05. **p < .01. ***p < .001."
    t = Table(f"{title} predicting {nice(ds, y)}", cols_apa, rows, note=note, groups=groups)
    notes = [f"{c.label if not c.group else c.group + '=' + c.label} was omitted because of collinearity." for c in omitted]
    remember(ds, cmd, kind, y, sub, cols, b, V, None, wraw, {"n": n, "llf": llf, "ll0": ll0, "X": Xc, "yv": yv, "pred": np.asarray(pred), "robust": robust or bool(cluster_var)})
    summ = {"model": title, "depvar": y, "n": n, "chi2": chi, "df": q, "p": pchi, "pseudo_r2": pseudo, "loglik": llf, **summ_extra, "coefs": [{"term": (c.group + "=" if c.group else "") + c.label, "b": float(b[i]), "exp_b": float(np.exp(b[i])), "se": float(se[i]), "z": float(z[i]), "p": float(pv[i])} for i, c in enumerate(cols)]}
    return Result(log="\n".join(lines), tables=[t], notes=notes, summary=summ)


# ───────────── factorial ANOVA ─────────────


def anova(ds: Dataset, cmd: Command) -> Result:
    import statsmodels.formula.api as smf
    from statsmodels.stats.anova import anova_lm

    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError("use: anova outcome factor1 [factor2 factor1#factor2]")
    y = resolve_var(toks[0], ds.df)
    # In anova, plain variables are categorical (Stata's rule); c. marks continuous.
    spec = " ".join(t if t.startswith(("c.", "i.")) or "#" in t else f"i.{t}" for t in toks[1].split())
    spec = " ".join("#".join(p if p.startswith(("c.", "i.")) else f"i.{p}" for p in t.split("#")) if "#" in t and "##" not in t else t for t in spec.split())
    terms = parse_fvlist(spec, ds.df)
    vars_ = [y] + sorted({p[1] for t in terms for p in t.parts})
    sub = sample(ds, cmd, vars_).copy()
    rename = {v: f"v{i}" for i, v in enumerate(vars_)}
    d = sub.rename(columns=rename)
    pieces = []
    for t in terms:
        pieces.append(":".join(f"C({rename[p[1]]}, Sum)" if p[0] == "i" else rename[p[1]] for p in t.parts))
    model = smf.ols(f"{rename[y]} ~ " + " + ".join(pieces), data=d).fit()
    tab = anova_lm(model, typ=3)
    n = int(model.nobs)
    rss, dfr = float(model.ssr), float(model.df_resid)
    tss = float(((d[rename[y]] - d[rename[y]].mean()) ** 2).sum())
    mss, dfm = tss - rss, float(model.df_model)
    Fm = (mss / dfm) / (rss / dfr)
    pm = float(st.f.sf(Fm, dfm, dfr))
    r2 = model.rsquared
    lines = [
        f"{'':25}Number of obs = {n:>10,}    R-squared     = {r2:>8.4f}",
        f"{'':25}Root MSE      = {fmt.g(math.sqrt(rss / dfr), 10)}    Adj R-squared = {model.rsquared_adj:>8.4f}",
        "",
        f"{'Source':>24} | Partial SS         df         MS        F    Prob>F",
        f"{'':14}-----------+----------------------------------------------------",
        f"{'Model':>24} |{fmt.g(mss, 11)}{int(dfm):>11}{fmt.g(mss / dfm, 11)}{Fm:>9.2f}{pm:>10.4f}",
        f"{'':24} |",
    ]
    rows = []
    labels = ["#".join(p[1] for p in t.parts) for t in terms]
    for lab, (idx, r) in zip(labels, [(i, r) for i, r in tab.iterrows() if i not in ("Intercept", "Residual")]):
        ms = r["sum_sq"] / r["df"]
        lines.append(f"{fmt.name(lab, 24)} |{fmt.g(r['sum_sq'], 11)}{int(r['df']):>11}{fmt.g(ms, 11)}{r['F']:>9.2f}{r['PR(>F)']:>10.4f}")
        lines.append(f"{'':24} |")
        partial_eta = r["sum_sq"] / (r["sum_sq"] + rss)
        rows.append([" × ".join(nice(ds, p[1]) for p in terms[labels.index(lab)].parts), fmt.apa_num(r["sum_sq"]), str(int(r["df"])), fmt.apa_num(ms), fmt.apa_num(r["F"]), fmt.apa_p(r["PR(>F)"]), fmt.apa_r(partial_eta)])
    lines += [
        f"{'Residual':>24} |{fmt.g(rss, 11)}{int(dfr):>11}{fmt.g(rss / dfr, 11)}",
        f"{'':14}-----------+----------------------------------------------------",
        f"{'Total':>24} |{fmt.g(tss, 11)}{n - 1:>11}{fmt.g(tss / (n - 1), 11)}",
    ]
    rows.append(["Residual", fmt.apa_num(rss), str(int(dfr)), fmt.apa_num(rss / dfr), "", "", ""])
    note = f"N = {n:,}. R² = {fmt.apa_r(r2)}. Partial sums of squares (Type III), as in Stata."
    return Result(log="\n".join(lines), tables=[Table(f"Analysis of variance for {nice(ds, y)}", ["Source", "SS", "df", "MS", "F", "p", "Partial η²"], rows, note=note)], summary={"test": "ANOVA", "n": n, "r2": r2, "effects": [{"term": r[0], "F": r[4], "p": r[5], "partial_eta2": r[6]} for r in rows[:-1]]})
