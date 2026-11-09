"""More of Stata, printed the way Stata prints it:

summary tables   tabstat, misstable summarize, duplicates
models           qreg, glm, tobit, mediate
after a model    test, lincom
multivariate     pca, cluster kmeans
planning         power (onemean, twomeans, pairedmeans, oneproportion, twoproportions, onecorrelation)
data             collapse, reshape
graphs           kdensity, qnorm
calculator       display
"""

from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import optimize
from scipy import stats as st

from . import fmt
from .data import Dataset, StataError, is_numeric
from .datacmds import selected
from .expr import evaluate, resolve_var
from .result import Result, Table
from .statcmds import _apa_reg_rows, _coef_table, _hdr, level_label, nice, remember, sample, stata_pctile
from .syntax import Command, expand_varlist, parse_fvlist

RULE = "-" * 78
Z = 1.959963984540054


def _pz(z):
    return 2 * st.norm.sf(np.abs(z))


def _num(ds: Dataset, vars_: list[str]):
    bad = [v for v in vars_ if not is_numeric(ds.df[v])]
    if bad:
        raise StataError(f"{' '.join(bad)}: string variable{'s' if len(bad) > 1 else ''} not allowed here; convert with destring (numbers stored as text) or encode (categories)")


def _model_design(ds: Dataset, cmd: Command, need: str):
    from .models import _design

    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError(f"use: {need}")
    y = resolve_var(toks[0], ds.df)
    _num(ds, [y])
    sub, cols, omitted, X = _design(ds, cmd, y, toks[1])
    return y, sub, cols, omitted, X


# ───────────── tabstat ─────────────

_STAT_NAMES = {
    "mean": "Mean", "sd": "SD", "n": "N", "count": "N", "min": "Min", "max": "Max", "sum": "Sum", "median": "p50",
    "p50": "p50", "p1": "p1", "p5": "p5", "p10": "p10", "p25": "p25", "p75": "p75", "p90": "p90", "p95": "p95",
    "p99": "p99", "iqr": "IQR", "var": "Variance", "variance": "Variance", "cv": "CV", "semean": "SE(mean)",
    "range": "Range", "skewness": "Skewness", "kurtosis": "Kurtosis", "q": "q",
}


def _stat(x: np.ndarray, s: str) -> float:
    if s in ("n", "count"):
        return float(len(x))
    if not len(x):
        return float("nan")
    if s == "mean":
        return float(x.mean())
    if s in ("sd", "var", "variance", "cv", "semean"):
        sd = float(x.std(ddof=1)) if len(x) > 1 else float("nan")
        return {"sd": sd, "var": sd**2, "variance": sd**2, "cv": sd / x.mean() if x.mean() else float("nan"), "semean": sd / math.sqrt(len(x))}[s]
    if s == "min":
        return float(x.min())
    if s == "max":
        return float(x.max())
    if s == "sum":
        return float(x.sum())
    if s == "range":
        return float(x.max() - x.min())
    if s in ("median", "p50"):
        return stata_pctile(x, 50)
    if s == "iqr":
        return stata_pctile(x, 75) - stata_pctile(x, 25)
    if s == "skewness":
        return float(st.skew(x)) if len(x) > 2 else float("nan")
    if s == "kurtosis":
        return float(st.kurtosis(x, fisher=False)) if len(x) > 3 else float("nan")
    m = re.fullmatch(r"p(\d{1,2})", s)
    if m:
        return stata_pctile(x, int(m.group(1)))
    raise StataError(f"{s}: unknown statistic")


def tabstat(ds: Dataset, cmd: Command) -> Result:
    vars_ = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    if not vars_:
        raise StataError("varlist required")
    _num(ds, vars_)
    raw = cmd.opt("statistics", "stats", "s")
    stats = (raw if isinstance(raw, str) else "mean").lower().split()
    stats = ["p25" if s == "q" else s for s in stats]
    for s in stats:
        if s not in _STAT_NAMES and not re.fullmatch(r"p\d{1,2}", s):
            raise StataError(f"{s}: unknown statistic (use mean, sd, n, min, max, sum, median, p25, p75, iqr, var, cv, semean, skewness, kurtosis)")
    by = cmd.opt("by")
    byv = resolve_var(by, ds.df) if isinstance(by, str) else None
    mask = selected(ds, cmd)
    df = ds.df[mask]
    groups = [(None, df)] if not byv else [(lv, df[df[byv] == lv]) for lv in sorted(df[byv].dropna().unique().tolist())] + [("Total", df)]
    heads = [_STAT_NAMES.get(s, s) for s in stats]
    w = max(12, max(len(v) for v in vars_) + 1)
    lines = []
    rows = []
    for lv, g in groups:
        if byv:
            lines += ["", f"-> {byv} = {'Total' if lv == 'Total' else level_label(ds, byv, lv)}"]
        lines += [f"{'Variable':>{w}} |" + "".join(f"{h:>11}" for h in heads), "-" * (w + 1) + "+" + "-" * (11 * len(heads))]
        for v in vars_:
            x = g[v].dropna().to_numpy(dtype=float)
            vals = [_stat(x, s) for s in stats]
            lines.append(f"{v:>{w}} |" + "".join(fmt.g(val, 11) for val in vals))
            label = ("Total" if lv == "Total" else level_label(ds, byv, lv)) if byv else None
            rows.append(([label] if byv else []) + [nice(ds, v)] + [str(int(val)) if s in ("n", "count") else fmt.apa_num(val) for s, val in zip(stats, vals)])
        lines.append("-" * (w + 1) + "+" + "-" * (11 * len(heads)))
    cols = ([nice(ds, byv)] if byv else []) + ["Variable"] + heads
    t = Table("Descriptive statistics" + (f" by {nice(ds, byv)}" if byv else ""), cols, rows, note=f"N = {int(mask.sum()):,} observations.")
    return Result(log="\n".join(lines).strip("\n"), tables=[t], summary={"stats": stats, "by": byv, "rows": rows[:40]})


# ───────────── misstable / duplicates ─────────────


def misstable(ds: Dataset, cmd: Command) -> Result:
    sub_cmd, _, rest = cmd.args.strip().partition(" ")
    if not sub_cmd.lower().startswith(("sum", "pat")):
        raise StataError("use: misstable summarize [varlist]  or  misstable patterns [varlist]")
    vars_ = expand_varlist(rest, ds.df)
    df = ds.df[selected(ds, cmd)]
    miss = {v: (df[v].isna() | ((df[v].astype(str).str.strip() == "") if not is_numeric(df[v]) else False)) for v in vars_}
    if sub_cmd.lower().startswith("pat"):
        with_miss = [v for v in vars_ if miss[v].any()]
        if not with_miss:
            return Result(log="(no missing values)")
        pat = pd.DataFrame({v: np.where(miss[v], "0", "1") for v in with_miss})
        counts = pat.apply(lambda r: "".join(r), axis=1).value_counts()
        lines = ["Missing-value patterns", "  (1 means complete)", "", f"{'Percent':>9}  Pattern", f"{'':>9}  " + "  ".join(f"{i + 1}" for i in range(len(with_miss))), "  " + "-" * 40]
        for p, n in counts.head(20).items():
            lines.append(f"{100 * n / len(df):>8.0f}%  " + "  ".join(p))
        lines += ["  " + "-" * 40, "Variables are  " + "  ".join(f"({i + 1}) {v}" for i, v in enumerate(with_miss))]
        return Result(log="\n".join(lines))
    lines = [f"{'':>34}Obs<.", f"{'':>22}+------------------------------", f"{'Variable':>15} |{'Obs=.':>10}{'Obs>.':>8}{'Obs<.':>10} |{'Unique':>9}{'Min':>11}{'Max':>11}", "-" * 16 + "+" + "-" * 28 + "+" + "-" * 31]
    rows = []
    for v in vars_:
        n_miss = int(miss[v].sum())
        if not n_miss:
            continue
        s = df[v][~miss[v]]
        uniq = int(s.nunique())
        if is_numeric(df[v]):
            mn, mx = (fmt.g(s.min(), 11), fmt.g(s.max(), 11)) if len(s) else ("", "")
        else:
            mn = mx = "    (text)"
        lines.append(f"{fmt.name(v, 15)} |{n_miss:>10,}{'':>8}{len(s):>10,} |{uniq:>9,}{mn:>11}{mx:>11}")
        rows.append([nice(ds, v), f"{n_miss:,}", f"{100 * n_miss / len(df):.1f}%", f"{len(s):,}"])
    lines.append("-" * 76)
    if not rows:
        return Result(log="(no missing values)", summary={"missing": {}})
    t = Table("Missing values", ["Variable", "Missing", "% missing", "Observed"], rows, note=f"N = {len(df):,}. Only variables with missing values are listed.")
    return Result(log="\n".join(lines), tables=[t], summary={"missing": {r[0]: r[1] for r in rows}})


def duplicates(ds: Dataset, cmd: Command) -> Result:
    sub_cmd, _, rest = cmd.args.strip().partition(" ")
    sub_cmd = sub_cmd.lower()
    vars_ = expand_varlist(rest, ds.df)
    key = ds.df[vars_].astype(str)
    dup = key.duplicated(keep=False)
    surplus = int(key.duplicated(keep="first").sum())
    if sub_cmd.startswith("rep"):
        size = key.groupby(list(key.columns), dropna=False).transform("size") if len(vars_) > 1 else key.groupby(vars_[0]).transform("size")
        size = size.iloc[:, 0] if isinstance(size, pd.DataFrame) else size
        tab = size.value_counts().sort_index()
        lines = [f"Duplicates in terms of {'all variables' if len(vars_) == ds.df.shape[1] else ' '.join(vars_)}", "", "-" * 38, f"{'Copies':>10} | {'Observations':>12}{'Surplus':>12}", "-" * 11 + "+" + "-" * 26]
        for c, n in tab.items():
            lines.append(f"{c:>10} | {n:>12,}{n - n // c:>12,}")
        lines.append("-" * 38)
        return Result(log="\n".join(lines), summary={"surplus": surplus})
    if sub_cmd.startswith("drop"):
        if rest.strip() and not cmd.opt("force"):
            raise StataError("duplicates drop with a varlist needs the force option: duplicates drop varlist, force")
        before = len(ds.df)
        ds.df = ds.df[~key.duplicated(keep="first")].reset_index(drop=True)
        n = before - len(ds.df)
        return Result(log=f"Duplicates in terms of {'all variables' if not rest.strip() else ' '.join(vars_)}\n\n({n:,} observation{'' if n == 1 else 's'} deleted)", changes_data=True, summary={"dropped": n})
    if sub_cmd.startswith("tag"):
        g = cmd.opt("generate")
        if not isinstance(g, str):
            raise StataError("use: duplicates tag varlist, generate(newvar)")
        name = g.strip()
        if name in ds.df.columns:
            raise StataError(f"variable {name} already defined")
        counts = key.groupby(list(key.columns)).transform("size")
        counts = counts.iloc[:, 0] if isinstance(counts, pd.DataFrame) else counts
        ds.df[name] = (counts - 1).astype(float)
        return Result(log=f"Duplicates in terms of {' '.join(vars_)}", changes_data=True)
    if sub_cmd.startswith("l"):
        shown = ds.df[dup].head(30)
        return Result(log=f"Duplicates in terms of {' '.join(vars_)}\n\n{shown.to_string() if len(shown) else '(0 observations are duplicates)'}")
    raise StataError("use: duplicates report | list | tag | drop [varlist]")


# ───────────── qreg / glm / tobit ─────────────


def qreg(ds: Dataset, cmd: Command) -> Result:
    y, sub, cols, omitted, X = _model_design(ds, cmd, "qreg outcome predictors [, quantile(.5)]")
    q = cmd.opt("quantile")
    q = float(q) if isinstance(q, str) else 0.5
    if q > 1:
        q /= 100
    if not 0 < q < 1:
        raise StataError("quantile() must be between 0 and 1 (or 1 and 99)")
    yv = sub[y].astype(float).to_numpy()
    Xc = np.column_stack([X, np.ones(len(yv))])
    res = sm.QuantReg(yv, Xc).fit(q=q, max_iter=5000)
    b, se = np.asarray(res.params), np.asarray(res.bse)
    df_r = len(yv) - Xc.shape[1]
    t = b / se
    pv = 2 * st.t.sf(np.abs(t), df_r)
    tc = st.t.ppf(0.975, df_r)
    lo, hi = b - tc * se, b + tc * se
    resid = yv - Xc @ b
    rho = lambda u: np.sum(u * (q - (u < 0)))
    raw_sum = rho(resid)
    min_sum = rho(yv - stata_pctile(yv, q * 100))
    pseudo = 1 - raw_sum / min_sum if min_sum else float("nan")
    title = "Median regression" if abs(q - 0.5) < 1e-9 else f"{q:.2f} Quantile regression"
    lines = [f"{title:<56}Number of obs = {len(yv):>6,}", f"  Raw sum of deviations {fmt.g(min_sum, 12).strip()} (about {fmt.g(stata_pctile(yv, q * 100)).strip()})", f"  Min sum of deviations {fmt.g(raw_sum, 12).strip()}{'':>18}Pseudo R2     = {pseudo:>6.4f}", ""]
    lines += _coef_table(y, cols, omitted, b, se, t, pv, lo, hi, "t", "Coefficient")
    rows, groups = _apa_reg_rows(cols, b, se, t, pv, lo, hi, labels=ds.var_labels)
    tab = Table(f"{'Median' if abs(q - 0.5) < 1e-9 else f'Quantile ({q:.2f})'} regression predicting {nice(ds, y)}", ["Predictor", "B", "SE", "t", "p", "95% CI"], rows, note=f"N = {len(yv):,}. Pseudo R² = {fmt.apa_num(pseudo)}. Coefficients are changes in the {int(round(q * 100))}th percentile of {nice(ds, y)}.", groups=groups)
    remember(ds, cmd, "regress", y, sub, cols, b, np.asarray(res.cov_params()), df_r, None, {"n": len(yv), "X": Xc, "yv": yv, "robust": False})
    return Result(log="\n".join(lines), tables=[tab], summary={"model": "qreg", "quantile": q, "n": len(yv), "pseudo_r2": pseudo, "coefs": [{"term": c.label, "b": float(b[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})


_FAMILIES = {
    "gaussian": (sm.families.Gaussian, "identity"), "normal": (sm.families.Gaussian, "identity"),
    "binomial": (sm.families.Binomial, "logit"), "poisson": (sm.families.Poisson, "log"),
    "gamma": (sm.families.Gamma, "inverse"), "igaussian": (sm.families.InverseGaussian, "power(-2)"),
    "nbinomial": (sm.families.NegativeBinomial, "log"),
}
_LINKS = {
    "identity": sm.families.links.Identity, "logit": sm.families.links.Logit, "probit": sm.families.links.Probit,
    "log": sm.families.links.Log, "cloglog": sm.families.links.CLogLog, "inverse": sm.families.links.InversePower,
}


def glm(ds: Dataset, cmd: Command) -> Result:
    y, sub, cols, omitted, X = _model_design(ds, cmd, "glm outcome predictors, family(binomial|poisson|gaussian|gamma|nbinomial) [link(...)] [eform]")
    fam_name = str(cmd.opt("family") or "gaussian").lower().split()[0]
    fam_name = {"gau": "gaussian", "bin": "binomial", "poi": "poisson", "gam": "gamma", "nb": "nbinomial"}.get(fam_name[:3], fam_name) if fam_name[:3] in ("gau", "bin", "poi", "gam") or fam_name.startswith("nb") else fam_name
    if fam_name not in _FAMILIES:
        raise StataError(f"family({fam_name}) not available; use gaussian, binomial, poisson, gamma, igaussian or nbinomial")
    fam_cls, default_link = _FAMILIES[fam_name]
    link_name = str(cmd.opt("link") or default_link).lower()
    link_key = {"ident": "identity", "logi": "logit", "prob": "probit", "clog": "cloglog", "inv": "inverse", "pow": "inverse"}
    link_name = next((v for k, v in link_key.items() if link_name.startswith(k)), link_name)
    if link_name not in _LINKS:
        raise StataError(f"link({link_name}) not available; use identity, logit, probit, log, cloglog or inverse")
    yv = sub[y].astype(float).to_numpy()
    Xc = np.column_stack([X, np.ones(len(yv))])
    family = fam_cls(link=_LINKS[link_name]())
    robust = bool(cmd.opt("robust")) or str(cmd.opt("vce") or "").lower().startswith("r")
    res = sm.GLM(yv, Xc, family=family).fit(cov_type="HC1" if robust else "nonrobust")
    b, se = np.asarray(res.params), np.asarray(res.bse)
    z = b / se
    pv = _pz(z)
    lo, hi = b - Z * se, b + Z * se
    eform = bool(cmd.opt("eform")) or bool(cmd.opt("irr")) or bool(cmd.opt("or"))
    n, k = Xc.shape
    disp = float(res.scale)
    lines = [
        f"{'Generalized linear models':<52}Number of obs     = {n:>8,}",
        f"{'Optimization     : ML':<52}Residual df       = {n - k:>8,}",
        f"{'':<52}Scale parameter   = {disp:>8.6g}",
        f"{'Deviance         = ' + format(res.deviance, '.9g'):<52}(1/df) Deviance   = {res.deviance / max(n - k, 1):>8.6g}",
        f"{'Pearson          = ' + format(res.pearson_chi2, '.9g'):<52}(1/df) Pearson    = {res.pearson_chi2 / max(n - k, 1):>8.6g}",
        "",
        f"{'Variance function: ' + fam_name.title():<52}",
        f"{'Link function    : ' + link_name.title():<52}AIC               = {res.aic / n:>8.6g}",
        f"{'Log likelihood   = ' + format(res.llf, '.9g'):<52}BIC               = {res.bic_llf:>8.6g}",
        "",
    ]
    word = {"logit": "Odds ratio", "log": "IRR" if fam_name in ("poisson", "nbinomial") else "exp(b)"}.get(link_name, "exp(b)")
    if eform:
        lines += _coef_table(y, cols, omitted, np.exp(b), np.exp(b) * se, z, pv, np.exp(lo), np.exp(hi), "z", word, "Robust" if robust else "")
        rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, transform=np.exp, labels=ds.var_labels)
        tab = Table(f"Generalized linear model ({fam_name}, {link_name} link) predicting {nice(ds, y)}", ["Predictor", word, "95% CI", "z", "p"], rows, note=f"N = {n:,}. AIC = {fmt.apa_num(res.aic)}.", groups=groups)
    else:
        lines += _coef_table(y, cols, omitted, b, se, z, pv, lo, hi, "z", "Coefficient", "Robust" if robust else "")
        rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, labels=ds.var_labels)
        tab = Table(f"Generalized linear model ({fam_name}, {link_name} link) predicting {nice(ds, y)}", ["Predictor", "B", "SE", "z", "p", "95% CI"], rows, note=f"N = {n:,}. AIC = {fmt.apa_num(res.aic)}.", groups=groups)
    kind = {"logit": "logit", "probit": "probit", "log": "poisson"}.get(link_name, "regress")
    remember(ds, cmd, kind, y, sub, cols, b, np.asarray(res.cov_params()), None, None, {"n": n, "llf": float(res.llf), "X": Xc, "yv": yv, "pred": np.asarray(res.fittedvalues), "robust": robust})
    return Result(log="\n".join(lines), tables=[tab], summary={"model": "glm", "family": fam_name, "link": link_name, "n": n, "aic": float(res.aic), "coefs": [{"term": c.label, "b": float(b[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})


def tobit(ds: Dataset, cmd: Command) -> Result:
    y, sub, cols, omitted, X = _model_design(ds, cmd, "tobit outcome predictors, ll(#) ul(#)")
    yv = sub[y].astype(float).to_numpy()
    llo, ulo = cmd.opt("ll"), cmd.opt("ul")
    lower = (float(llo) if isinstance(llo, str) and llo.strip() else float(np.min(yv))) if llo is not None else -np.inf
    upper = (float(ulo) if isinstance(ulo, str) and ulo.strip() else float(np.max(yv))) if ulo is not None else np.inf
    if lower == -np.inf and upper == np.inf:
        raise StataError("tobit needs a censoring limit: ll(#) and/or ul(#), e.g. tobit hours age educ, ll(0)")
    Xc = np.column_stack([X, np.ones(len(yv))])
    k = Xc.shape[1]
    cl, cu = yv <= lower, yv >= upper
    mid = ~(cl | cu)

    def nll(p):
        b, s = p[:k], math.exp(p[k])
        xb = Xc @ b
        ll = np.sum(st.norm.logpdf((yv[mid] - xb[mid]) / s) - math.log(s))
        if cl.any():
            ll += np.sum(st.norm.logcdf((lower - xb[cl]) / s))
        if cu.any():
            ll += np.sum(st.norm.logsf((upper - xb[cu]) / s))
        return -ll

    b0 = np.linalg.lstsq(Xc, yv, rcond=None)[0]
    start = np.append(b0, math.log(max(np.std(yv - Xc @ b0), 1e-6)))
    opt = optimize.minimize(nll, start, method="BFGS", options={"maxiter": 2000, "gtol": 1e-7})
    from statsmodels.tools.numdiff import approx_hess

    H = approx_hess(opt.x, nll)
    V = np.linalg.pinv(H)
    b, se = opt.x[:k], np.sqrt(np.diag(V)[:k])
    sigma, se_sigma = math.exp(opt.x[k]), math.exp(opt.x[k]) * math.sqrt(max(V[k, k], 0))
    df_r = len(yv) - k
    t = b / se
    pv = 2 * st.t.sf(np.abs(t), df_r)
    tc = st.t.ppf(0.975, df_r)
    lo, hi = b - tc * se, b + tc * se
    ll = -float(opt.fun)
    sig0 = np.std(yv)

    def nll0(p):
        mu, s = p[0], math.exp(p[1])
        out = np.sum(st.norm.logpdf((yv[mid] - mu) / s) - math.log(s))
        out += np.sum(st.norm.logcdf((lower - mu) / s)) if cl.any() else 0
        out += np.sum(st.norm.logsf((upper - mu) / s)) if cu.any() else 0
        return -out

    ll0 = -float(optimize.minimize(nll0, [yv.mean(), math.log(max(sig0, 1e-6))], method="BFGS").fun)
    lr = 2 * (ll - ll0)
    lines = [f"{'Tobit regression':<56}Number of obs = {len(yv):>6,}", f"{'':<56}{'Uncensored':<14}= {int(mid.sum()):>6,}", f"{'Limits: Lower = ' + (fmt.g(lower).strip() if np.isfinite(lower) else '-inf'):<56}{'Left-censored':<14}= {int(cl.sum()):>6,}", f"{'        Upper = ' + (fmt.g(upper).strip() if np.isfinite(upper) else '+inf'):<56}{'Right-censored':<14}= {int(cu.sum()):>6,}", "", f"{'':<56}LR chi2({k - 1})   = {lr:>6.2f}", f"{'':<56}Prob > chi2   = {st.chi2.sf(lr, k - 1):>6.4f}", f"{'Log likelihood = ' + format(ll, '.8g'):<56}Pseudo R2     = {1 - ll / ll0:>6.4f}", ""]
    lines += _coef_table(y, cols, omitted, b, se, t, pv, lo, hi, "t", "Coefficient")[:-1]
    lines += [fmt.rule(13, 64), f"{'var(e.' + y[:6] + ')':>12} |{fmt.g(sigma**2, 11)}{fmt.g(2 * sigma * se_sigma, 11)}", RULE]
    rows, groups = _apa_reg_rows(cols, b, se, t, pv, lo, hi, labels=ds.var_labels)
    tab = Table(f"Tobit regression predicting {nice(ds, y)}", ["Predictor", "B", "SE", "t", "p", "95% CI"], rows, note=f"N = {len(yv):,} ({int(cl.sum()):,} left-censored, {int(cu.sum()):,} right-censored). σ = {fmt.apa_num(sigma)}. Coefficients are effects on the latent (uncensored) outcome.", groups=groups)
    remember(ds, cmd, "regress", y, sub, cols, b, V[:k, :k], df_r, None, {"n": len(yv), "X": Xc, "yv": yv, "robust": False})
    return Result(log="\n".join(lines), tables=[tab], summary={"model": "tobit", "n": len(yv), "left": int(cl.sum()), "right": int(cu.sum()), "sigma": sigma, "coefs": [{"term": c.label, "b": float(b[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})


# ───────────── test / lincom ─────────────


def _coef_index(ds: Dataset, e: dict, name: str) -> int:
    name = name.strip()
    if name in ("_cons", "_b[_cons]"):
        return len(e["keep"])
    m = re.fullmatch(r"_b\[(.+)\]", name)
    if m:
        name = m.group(1)
    if "#" not in name:
        m = re.fullmatch(r"(\d+)(?:b?)\.(\w+)", name)
        if m:
            var = resolve_var(m.group(2), ds.df)
            lab = level_label(ds, var, float(m.group(1)))
            for i, (g, l) in enumerate(e["keep"]):
                if g == var and l == lab:
                    return i
            raise StataError(f"{name} not found (it may be the base level, which has no coefficient)")
        var = resolve_var(name.replace("c.", ""), ds.df)
        for i, (g, l) in enumerate(e["keep"]):
            if not g and l == var:
                return i
    for i, (g, l) in enumerate(e["keep"]):
        if l == name or f"{g}#{l}" == name:
            return i
    raise StataError(f"{name} not found among the coefficients of the last model")


def _linear(ds: Dataset, e: dict, text: str) -> tuple[np.ndarray, float]:
    """A linear combination like 'x1 + 2*x2 - 3.region + 1.5' -> (weights over b, constant)."""
    k = len(e["b"])
    c, const = np.zeros(k), 0.0
    text = text.replace(" ", "")
    if not text:
        return c, const
    for sign, body in re.findall(r"([+-]?)([^+-]+(?:[eE][+-]?\d+)?)", text if text[0] in "+-" else "+" + text):
        s = -1.0 if sign == "-" else 1.0
        if "*" in body:
            a, bname = body.split("*", 1)
            try:
                mult, ref = float(a), bname
            except ValueError:
                mult, ref = float(bname), a
            c[_coef_index(ds, e, ref)] += s * mult
        else:
            try:
                const += s * float(body)
            except ValueError:
                c[_coef_index(ds, e, body)] += s
    return c, const


def _need_est(ds: Dataset) -> dict:
    e = ds.last_est
    if not e:
        raise StataError("last estimates not found: run a model first (regress, logit, poisson, glm...)")
    if e.get("kind") in ("mlogit", "ologit", "oprobit") or np.asarray(e["b"]).ndim != 1:
        raise StataError(f"test and lincom aren't available after {e.get('kind')} yet")
    return e


def test(ds: Dataset, cmd: Command) -> Result:
    e = _need_est(ds)
    b, V = np.asarray(e["b"], dtype=float), np.asarray(e["V"], dtype=float)
    text = (cmd.args + ("=" + cmd.exp if cmd.exp is not None else "")).strip()
    eqs = re.findall(r"\(([^()]+)\)", text) or [text]
    R, r, shown = [], [], []
    for eq in eqs:
        if "=" in eq:
            lhs, rhs = eq.split("=", 1)
            c1, k1 = _linear(ds, e, lhs)
            c2, k2 = _linear(ds, e, rhs)
            R.append(c1 - c2)
            r.append(k2 - k1)
            shown.append(f"{lhs.strip()} - ({rhs.strip()}) = 0")
        else:
            for tok in eq.split():
                c = np.zeros(len(b))
                c[_coef_index(ds, e, tok)] = 1
                R.append(c)
                r.append(0.0)
                shown.append(f"{tok} = 0")
    R, r = np.array(R), np.array(r)
    d = R @ b - r
    W = float(d @ np.linalg.pinv(R @ V @ R.T) @ d)
    q = len(r)
    lines = [""] + [f" ({i + 1})  {s}" for i, s in enumerate(shown)] + [""]
    if e.get("df_r"):
        F = W / q
        p = float(st.f.sf(F, q, e["df_r"]))
        lines += [f"{'':7}F({q}, {int(e['df_r'])}) = {F:>8.2f}", f"{'':12}Prob > F = {p:>8.4f}"]
        summ = {"F": F, "df1": q, "df2": int(e["df_r"]), "p": p}
        stat_txt = f"F({q}, {int(e['df_r'])}) = {fmt.apa_num(F)}"
    else:
        p = float(st.chi2.sf(W, q))
        lines += [f"{'':11}chi2({q}) = {W:>8.2f}", f"{'':9}Prob > chi2 = {p:>8.4f}"]
        summ = {"chi2": W, "df": q, "p": p}
        stat_txt = f"χ²({q}) = {fmt.apa_num(W)}"
    t = Table("Wald test of linear restrictions", ["Hypothesis", "Statistic", "p"], [["; ".join(shown), stat_txt, fmt.apa_p(p)]], note=f"After: {e['cmd']}")
    return Result(log="\n".join(lines), tables=[t], summary=summ)


def lincom(ds: Dataset, cmd: Command) -> Result:
    e = _need_est(ds)
    b, V = np.asarray(e["b"], dtype=float), np.asarray(e["V"], dtype=float)
    c, const = _linear(ds, e, cmd.args)
    est = float(c @ b + const)
    se = float(math.sqrt(max(c @ V @ c, 0)))
    df_r = e.get("df_r")
    stat = est / se if se else float("nan")
    if df_r:
        p = float(2 * st.t.sf(abs(stat), df_r))
        crit = st.t.ppf(0.975, df_r)
        sname = "t"
    else:
        p = float(2 * st.norm.sf(abs(stat)))
        crit = Z
        sname = "z"
    lo, hi = est - crit * se, est + crit * se
    eform = next((w for w in ("or", "irr", "eform", "hr", "rrr") if cmd.opt(w)), None)
    head = {"or": "Odds ratio", "irr": "IRR", "hr": "Haz. ratio", "rrr": "RRR", "eform": "exp(b)"}.get(eform or "", "Coefficient")
    shown = (np.exp(est), np.exp(est) * se, np.exp(lo), np.exp(hi)) if eform else (est, se, lo, hi)
    lines = ["", f" ( 1)  {cmd.args.strip()} = 0", "", "-" * 78, f"{'':12} | {head:>11} {'Std. err.':>10}{sname:>9}{'P>|' + sname + '|':>8}     [95% conf. interval]", fmt.rule(13, 64), f"{'(1)':>12} |{fmt.g(shown[0], 11)}{fmt.g(shown[1], 11)}{stat:>9.2f}{fmt.p(p)}{fmt.g(shown[2], 13)}{fmt.g(shown[3], 12)}", "-" * 78]
    t = Table(f"Linear combination: {cmd.args.strip()}", ["Estimate", "SE", sname, "p", "95% CI"], [[fmt.apa_num(shown[0]), fmt.apa_num(shown[1]), fmt.apa_num(stat), fmt.apa_p(p), f"[{fmt.apa_num(shown[2])}, {fmt.apa_num(shown[3])}]"]], note=f"After: {e['cmd']}")
    return Result(log="\n".join(lines), tables=[t], summary={"estimate": est, "se": se, "p": p, "ci": [lo, hi]})


# ───────────── mediate ─────────────


def _groups_in_parens(text: str) -> list[list[str]]:
    groups = re.findall(r"\(([^()]*)\)", text)
    if len(groups) != 3:
        raise StataError("use: mediate (outcome [covariates]) (mediator [covariates]) (treatment)")
    return [g.split() for g in groups]


def mediate(ds: Dataset, cmd: Command) -> Result:
    gy, gm, gt = _groups_in_parens(cmd.args)
    y, m, t = resolve_var(gy[0], ds.df), resolve_var(gm[0], ds.df), resolve_var(gt[0], ds.df)
    cov_y = [resolve_var(v, ds.df) for v in gy[1:]]
    cov_m = [resolve_var(v, ds.df) for v in gm[1:]]
    allv = list(dict.fromkeys([y, m, t] + cov_y + cov_m))
    _num(ds, allv)
    sub = sample(ds, cmd, allv)
    n = len(sub)
    if n < 20:
        raise StataError("mediate needs at least 20 complete observations")
    reps = cmd.opt("reps")
    reps = int(reps) if isinstance(reps, str) else 1000
    tvals = sub[t].astype(float).to_numpy()
    binary_t = set(np.unique(tvals)) <= {0.0, 1.0}
    contrast = 1.0 if binary_t else float(np.std(tvals, ddof=1))

    def fit(df: pd.DataFrame):
        Xm = np.column_stack([df[t].to_numpy(float)] + [df[v].to_numpy(float) for v in cov_m] + [np.ones(len(df))])
        a = np.linalg.lstsq(Xm, df[m].to_numpy(float), rcond=None)[0][0]
        Xy = np.column_stack([df[m].to_numpy(float), df[t].to_numpy(float)] + [df[v].to_numpy(float) for v in cov_y] + [np.ones(len(df))])
        coef = np.linalg.lstsq(Xy, df[y].to_numpy(float), rcond=None)[0]
        return a, coef[0], coef[1]

    a, bm, cp = fit(sub)
    nie, nde = a * bm * contrast, cp * contrast
    te = nie + nde
    rng = np.random.default_rng(int(ds.rng.integers(0, 2**31 - 1)))
    boot = np.empty((reps, 3))
    arr = sub.reset_index(drop=True)
    for r_ in range(reps):
        idx = rng.integers(0, n, n)
        a_, b_, c_ = fit(arr.iloc[idx])
        boot[r_] = (a_ * b_ * contrast, c_ * contrast, (a_ * b_ + c_) * contrast)
    est = np.array([nie, nde, te])
    se = boot.std(axis=0, ddof=1)
    z = est / se
    pv = _pz(z)
    lo, hi = np.percentile(boot, 2.5, axis=0), np.percentile(boot, 97.5, axis=0)
    prop = nie / te if te else float("nan")
    names = ["NIE (indirect)", "NDE (direct)", "TE (total)"]
    unit = "a change from 0 to 1" if binary_t else f"a one-SD increase ({fmt.g(contrast).strip()})"
    lines = [f"{'Causal mediation analysis':<56}Number of obs = {n:>6,}", "", f"Outcome model  : linear", f"Mediator model : linear", f"Mediator       : {m}", f"Treatment      : {t} ({'binary' if binary_t else 'continuous'})", "", "-" * 78, f"{'':12} |{'Bootstrap':>24}", f"{y[:12]:>12} | {'Coefficient':>11} {'std. err.':>10}{'z':>9}{'P>|z|':>8}     [95% conf. interval]", fmt.rule(13, 64)]
    for i, nm in enumerate(["NIE", "NDE", "TE"]):
        lines.append(f"{nm:>12} |{fmt.g(est[i], 11)}{fmt.g(se[i], 11)}{z[i]:>9.2f}{fmt.p(pv[i])}{fmt.g(lo[i], 13)}{fmt.g(hi[i], 12)}")
    lines += ["-" * 78, f"Proportion mediated (NIE/TE) = {prop:.4f}", f"Paths: a ({t} -> {m}) = {fmt.g(a).strip()}, b ({m} -> {y}) = {fmt.g(bm).strip()}, c' = {fmt.g(cp).strip()}", f"Effects are for {unit} in {t}; percentile CIs from {reps:,} bootstrap replications."]
    rows = [[names[i], fmt.apa_num(est[i]), fmt.apa_num(se[i]), fmt.apa_p(pv[i]) + fmt.stars(pv[i]), f"[{fmt.apa_num(lo[i])}, {fmt.apa_num(hi[i])}]"] for i in range(3)]
    tab = Table(f"Mediation of the effect of {nice(ds, t)} on {nice(ds, y)} through {nice(ds, m)}", ["Effect", "Estimate", "Bootstrap SE", "p", "95% CI"], rows, note=f"N = {n:,}. Proportion mediated = {fmt.apa_num(prop)}. Percentile confidence intervals from {reps:,} bootstrap samples. Effects are for {unit} in {nice(ds, t)}.")
    notes = ["Mediation estimates are causal only if there is no unmeasured confounding of the treatment–mediator, treatment–outcome and mediator–outcome relationships; add known confounders as covariates."]
    return Result(log="\n".join(lines), tables=[tab], notes=notes, summary={"nie": nie, "nde": nde, "te": te, "p_nie": float(pv[0]), "ci_nie": [float(lo[0]), float(hi[0])], "proportion_mediated": prop, "a": a, "b": bm, "c_prime": cp, "n": n})


# ───────────── pca / cluster kmeans ─────────────


def pca(ds: Dataset, cmd: Command) -> Result:
    vars_ = expand_varlist(cmd.args, ds.df, allow_empty_all=False)
    if len(vars_) < 2:
        raise StataError("pca needs at least two variables")
    _num(ds, vars_)
    sub = sample(ds, cmd, vars_)
    R = np.corrcoef(sub[vars_].to_numpy(float), rowvar=False)
    ev, vec = np.linalg.eigh(R)
    order = np.argsort(ev)[::-1]
    ev, vec = ev[order], vec[:, order]
    vec = vec * np.sign(vec[np.argmax(np.abs(vec), axis=0), range(vec.shape[1])])
    comps = cmd.opt("components", "factors")
    kk = int(comps) if isinstance(comps, str) else len(vars_)
    kk = max(1, min(kk, len(vars_)))
    total = ev.sum()
    lines = [f"{'Principal components/correlation':<52}Number of obs    = {len(sub):>8,}", f"{'':<52}Number of comp.  = {kk:>8}", f"{'Rotation: (unrotated = principal)':<52}Rho              = {ev[:kk].sum() / total:>8.4f}", "", "-" * 74, f"{'Component':>12} | {'Eigenvalue':>11}{'Difference':>12}{'Proportion':>12}{'Cumulative':>12}", "-" * 13 + "+" + "-" * 60]
    cum = 0.0
    rows = []
    for i, e_ in enumerate(ev):
        cum += e_ / total
        diff = ev[i] - ev[i + 1] if i + 1 < len(ev) else float("nan")
        lines.append(f"{'Comp' + str(i + 1):>12} | {e_:>11.5f}{(f'{diff:12.5f}' if not math.isnan(diff) else ''):>12}{e_ / total:>12.4f}{cum:>12.4f}")
        rows.append([f"Component {i + 1}", fmt.apa_num(e_), f"{100 * e_ / total:.1f}%", f"{100 * cum:.1f}%"])
    lines += ["-" * 74, "", "Principal components (eigenvectors)", "", "-" * 74, f"{'Variable':>12} |" + "".join(f"{'Comp' + str(j + 1):>10}" for j in range(kk)), "-" * 13 + "+" + "-" * 60]
    for i, v in enumerate(vars_):
        lines.append(f"{fmt.name(v)} |" + "".join(f"{vec[i, j]:>10.4f}" for j in range(kk)))
    lines.append("-" * 74)
    n_kaiser = int((ev > 1).sum())
    t1 = Table("Principal components: eigenvalues and variance explained", ["Component", "Eigenvalue", "% of variance", "Cumulative %"], rows, note=f"N = {len(sub):,}. {n_kaiser} component{'s' if n_kaiser != 1 else ''} with eigenvalue > 1 (Kaiser criterion).")
    load = vec[:, :kk] * np.sqrt(ev[:kk])
    t2 = Table("Component loadings", ["Variable"] + [f"PC{j + 1}" for j in range(kk)], [[nice(ds, v)] + [fmt.apa_num(load[i, j]) for j in range(kk)] for i, v in enumerate(vars_)], note="Loadings are correlations between each variable and the component.")
    ds.last_est = {"cmd": cmd.raw, "kind": "pca", "vars": vars_, "vec": vec[:, :kk], "mean": sub[vars_].mean().to_numpy(float), "sd": sub[vars_].std(ddof=1).to_numpy(float), "b": np.zeros(1), "V": np.zeros((1, 1)), "keep": []}
    return Result(log="\n".join(lines), tables=[t1, t2], summary={"eigenvalues": ev.tolist(), "kaiser": n_kaiser, "variance_first": float(ev[0] / total)})


def pca_scores(ds: Dataset, names: list[str]) -> Result:
    e = ds.last_est
    vars_ = e["vars"]
    Zs = (ds.df[vars_].to_numpy(float) - e["mean"]) / e["sd"]
    S = Zs @ e["vec"]
    for j, nm in enumerate(names[: S.shape[1]]):
        if nm in ds.df.columns:
            raise StataError(f"variable {nm} already defined")
        ds.df[nm] = S[:, j]
        ds.var_labels[nm] = f"Scores for component {j + 1}"
    return Result(log=f"(score{'s' if len(names) > 1 else ''} for component{'s' if len(names) > 1 else ''} 1{'-' + str(min(len(names), S.shape[1])) if len(names) > 1 else ''} saved)", changes_data=True)


def cluster(ds: Dataset, cmd: Command) -> Result:
    method, _, rest = cmd.args.strip().partition(" ")
    if not method.lower().startswith(("kmeans", "kmedians")):
        raise StataError("use: cluster kmeans varlist, k(#) [name(newvar)]")
    vars_ = expand_varlist(rest, ds.df, allow_empty_all=False)
    _num(ds, vars_)
    k = cmd.opt("k")
    if not isinstance(k, str):
        raise StataError("cluster kmeans needs the number of groups: k(#)")
    k = int(k)
    name = cmd.opt("name", "generate")
    name = name.strip() if isinstance(name, str) else "_clus_1"
    if name in ds.df.columns:
        raise StataError(f"variable {name} already defined")
    sub = sample(ds, cmd, vars_)
    from sklearn.cluster import KMeans

    Xv = sub[vars_].to_numpy(float)
    std = bool(cmd.opt("standardize"))
    if std:
        Xv = (Xv - Xv.mean(0)) / Xv.std(0, ddof=1)
    km = KMeans(n_clusters=k, n_init=20, random_state=int(ds.rng.integers(0, 2**31 - 1))).fit(Xv)
    # number the groups by size (largest = 1), so results don't depend on the random start
    order = np.argsort(-np.bincount(km.labels_, minlength=k))
    remap = {old: new + 1 for new, old in enumerate(order)}
    g = pd.Series(np.nan, index=ds.df.index)
    g.loc[sub.index] = [remap[x] for x in km.labels_]
    ds.df[name] = g
    ds.var_labels[name] = f"k-means cluster ({k} groups)"
    rows = []
    for c in range(1, k + 1):
        members = sub[g.loc[sub.index] == c]
        rows.append([f"Cluster {c}", f"{len(members):,}"] + [fmt.apa_num(members[v].mean()) for v in vars_])
    lines = [f"cluster name: {name}", f"(k-means with k = {k}{', standardized variables' if std else ''}; {len(sub):,} observations)", ""]
    lines += [f"{'Cluster':>10} {'N':>7}" + "".join(f"{v[:10]:>11}" for v in vars_)]
    lines += [f"{r[0]:>10} {r[1]:>7}" + "".join(f"{x:>11}" for x in r[2:]) for r in rows]
    t = Table(f"k-means clusters ({k} groups): sizes and means", ["Cluster", "N"] + [nice(ds, v) for v in vars_], rows, note=f"N = {len(sub):,}. Clusters are numbered by size. Within-cluster sum of squares = {fmt.apa_num(km.inertia_)}.")
    return Result(log="\n".join(lines), tables=[t], changes_data=True, summary={"k": k, "sizes": [r[1] for r in rows]})


# ───────────── power ─────────────


def _nums(text: str) -> list[float]:
    try:
        return [float(x) for x in text.split()]
    except ValueError as e:
        raise StataError("power: give the values as numbers, e.g. power twomeans 50 55, sd(10)") from e


def power(ds: Dataset, cmd: Command) -> Result:
    kind, _, rest = cmd.args.strip().partition(" ")
    kind = kind.lower()
    vals = _nums(rest)
    alpha = float(cmd.opt("alpha") or 0.05)
    target = float(cmd.opt("power") or 0.8)
    n_given = cmd.opt("n")
    n_given = int(float(n_given)) if isinstance(n_given, str) else None
    za = st.norm.ppf(1 - alpha / 2)
    lines, label, groups = [], "", 1

    def means_power(n, d, df_of, nc_of):
        df_ = df_of(n)
        tcrit = st.t.ppf(1 - alpha / 2, df_)
        nc = nc_of(n, d)
        return float(st.nct.sf(tcrit, df_, nc) + st.nct.cdf(-tcrit, df_, nc))

    def solve(fn):
        """Smallest n with power >= target: double until reached, then bisect."""
        if fn(2) >= target:
            return 2
        lo_, hi_ = 2, 4
        while fn(hi_) < target:
            lo_, hi_ = hi_, hi_ * 2
            if hi_ > 50_000_000:
                raise StataError("the required sample size is unrealistically large; check the effect size")
        while hi_ - lo_ > 1:
            mid = (lo_ + hi_) // 2
            lo_, hi_ = (mid, hi_) if fn(mid) < target else (lo_, mid)
        return hi_

    if kind.startswith("twomean"):
        if len(vals) != 2:
            raise StataError("use: power twomeans mean1 mean2, sd(#)")
        sd = float(cmd.opt("sd") or 1)
        d = abs(vals[1] - vals[0]) / sd
        f = lambda n: means_power(n, d, lambda n: 2 * n - 2, lambda n, d: d * math.sqrt(n / 2))
        groups, label = 2, f"Two-sample t test, means {vals[0]:g} vs {vals[1]:g}, SD = {sd:g} (Cohen's d = {d:.3f})"
    elif kind.startswith("pairedmean"):
        if len(vals) != 2:
            raise StataError("use: power pairedmeans mean_pre mean_post, sddiff(#)")
        sdd = float(cmd.opt("sddiff") or 1)
        d = abs(vals[1] - vals[0]) / sdd
        f = lambda n: means_power(n, d, lambda n: n - 1, lambda n, d: d * math.sqrt(n))
        label = f"Paired t test, mean difference {vals[1] - vals[0]:g}, SD of differences = {sdd:g}"
    elif kind.startswith("onemean"):
        if len(vals) != 2:
            raise StataError("use: power onemean null_mean alternative_mean, sd(#)")
        sd = float(cmd.opt("sd") or 1)
        d = abs(vals[1] - vals[0]) / sd
        f = lambda n: means_power(n, d, lambda n: n - 1, lambda n, d: d * math.sqrt(n))
        label = f"One-sample t test, H0: mean = {vals[0]:g} vs {vals[1]:g}, SD = {sd:g}"
    elif kind.startswith("twoprop"):
        if len(vals) != 2:
            raise StataError("use: power twoproportions p1 p2")
        p1, p2 = vals
        pbar = (p1 + p2) / 2

        def f(n):
            se0, se1 = math.sqrt(2 * pbar * (1 - pbar) / n), math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / n)
            return float(st.norm.cdf((abs(p2 - p1) - za * se0) / se1))

        groups, label = 2, f"Two-sample proportions test, {p1:g} vs {p2:g}"
    elif kind.startswith("oneprop"):
        if len(vals) != 2:
            raise StataError("use: power oneproportion null_p alternative_p")
        p0, pa = vals

        def f(n):
            return float(st.norm.cdf((abs(pa - p0) * math.sqrt(n) - za * math.sqrt(p0 * (1 - p0))) / math.sqrt(pa * (1 - pa))))

        label = f"One-sample proportion test, H0: p = {p0:g} vs {pa:g}"
    elif kind.startswith("onecorr"):
        if len(vals) == 1:
            vals = [0.0] + vals
        r0, ra = vals
        dz = abs(math.atanh(ra) - math.atanh(r0))
        f = lambda n: float(st.norm.cdf(dz * math.sqrt(max(n - 3, 0.0)) - za)) if n > 3 else 0.0
        label = f"Correlation test, H0: r = {r0:g} vs {ra:g}"
    else:
        raise StataError("power: use onemean, twomeans, pairedmeans, oneproportion, twoproportions or onecorrelation")
    if n_given:
        per = n_given / groups if groups == 2 else n_given
        pw = f(int(per))
        result = f"Power = {pw:.4f}"
        summ = {"power": pw, "n": n_given}
        rows = [["Total N", f"{n_given:,}"], ["Power", f"{pw:.3f}"]]
    else:
        per = solve(f)
        total = per * groups
        result = f"N = {total:,}" + (f"  (N per group = {per:,})" if groups == 2 else "")
        summ = {"n": total, "n_per_group": per if groups == 2 else None, "power": f(per)}
        rows = [["Required N", f"{total:,}"]] + ([["N per group", f"{per:,}"]] if groups == 2 else []) + [["Achieved power", f"{f(per):.3f}"]]
    lines = ["Estimated sample size" if not n_given else "Estimated power", label, "", f"Study parameters:", f"        alpha = {alpha:>8.4f}", f"        power = {target:>8.4f}" if not n_given else f"            N = {n_given:>8,}", "", result]
    t = Table("Power analysis", ["Quantity", "Value"], [["Test", label], ["α (two-sided)", f"{alpha:g}"]] + ([["Target power", f"{target:g}"]] if not n_given else []) + rows)
    return Result(log="\n".join(lines), tables=[t], summary=summ)


# ───────────── collapse / reshape ─────────────


def collapse(ds: Dataset, cmd: Command) -> Result:
    spec = cmd.args.strip()
    by = cmd.opt("by")
    byv = [resolve_var(v, ds.df) for v in by.split()] if isinstance(by, str) else []
    current, outs = "mean", []
    for tok in re.findall(r"\([^)]*\)|\S+", spec):
        if tok.startswith("("):
            current = tok[1:-1].strip().lower()
            continue
        if "=" in tok:
            new, src = tok.split("=", 1)
            outs.append((current, new, resolve_var(src, ds.df)))
        else:
            for v in expand_varlist(tok, ds.df, allow_empty_all=False):
                outs.append((current, v, v))
    if not outs:
        raise StataError("use: collapse (mean) varlist (sd) newname=var ..., by(groupvars)")
    _num(ds, list({s for _, _, s in outs}))
    df = ds.df[selected(ds, cmd)]
    fn = {"mean": "mean", "sum": "sum", "count": "count", "median": "median", "p50": "median", "sd": "std", "min": "min", "max": "max", "first": "first", "last": "last", "iqr": lambda s: s.quantile(.75) - s.quantile(.25)}
    pieces = {}
    for stat, new, src in outs:
        m = re.fullmatch(r"p(\d{1,2})", stat)
        how = (lambda s, q=int(m.group(1)) / 100: s.quantile(q)) if m and stat != "p50" else fn.get(stat)
        if how is None:
            raise StataError(f"({stat}) is not a collapse statistic")
        pieces[new] = (df.groupby(byv)[src].agg(how) if byv else pd.Series([df[src].agg(how)]))
    out = pd.DataFrame(pieces).reset_index() if byv else pd.DataFrame(pieces)
    labels = {new: f"({stat}) {ds.label(src) or src}" for stat, new, src in outs}
    ds.df = out.reset_index(drop=True)
    ds.var_labels = {**{v: ds.var_labels[v] for v in byv if v in ds.var_labels}, **labels}
    ds.value_labels = {v: ds.value_labels[v] for v in byv if v in ds.value_labels}
    return Result(log=f"(collapsed to {len(ds.df):,} observation{'s' if len(ds.df) != 1 else ''} and {ds.df.shape[1]} variables)", changes_data=True)


def reshape(ds: Dataset, cmd: Command) -> Result:
    how, _, stubs = cmd.args.strip().partition(" ")
    how = how.lower()
    i = cmd.opt("i")
    j = cmd.opt("j")
    if not isinstance(i, str) or not isinstance(j, str) or how not in ("long", "wide"):
        raise StataError("use: reshape long stub1 stub2, i(id) j(newvar)  or  reshape wide stub1 stub2, i(id) j(var)")
    ids = [resolve_var(v, ds.df) for v in i.split()]
    j = j.split()[0]
    stubs = stubs.split()
    before = ds.df.shape
    if how == "long":
        df = ds.df.copy()
        long = pd.wide_to_long(df, stubnames=stubs, i=ids, j=j, sep="", suffix=r"\d+").reset_index()
        missing = [s for s in stubs if s not in long.columns]
        if missing:
            raise StataError(f"no variables found starting with {' '.join(missing)} followed by numbers")
        ds.df = long.sort_values(ids + [j]).reset_index(drop=True)
    else:
        jv = resolve_var(j, ds.df)
        others = [c for c in ds.df.columns if c not in ids + [jv] + stubs]
        wide = ds.df.pivot_table(index=ids, columns=jv, values=stubs, aggfunc="first")
        wide.columns = [f"{s}{int(v) if float(v).is_integer() else v}" for s, v in wide.columns]
        keep = ds.df.groupby(ids)[others].first() if others else None
        ds.df = (wide.join(keep) if keep is not None else wide).reset_index()
    after = ds.df.shape
    lines = [f"(j = {' '.join(map(str, sorted(pd.unique(ds.df[j]) if how == 'long' else [])))[:60]})" if how == "long" else "", "", f"Data{'':>27}wide   ->   long" if how == "long" else f"Data{'':>27}long   ->   wide", "-" * 60, f"Number of observations {before[0]:>14,}   -> {after[0]:>8,}", f"Number of variables {before[1]:>17,}   -> {after[1]:>8,}", "-" * 60]
    return Result(log="\n".join(lines).strip("\n"), changes_data=True)


# ───────────── graphs: kdensity / qnorm ─────────────


def kdensity(ds: Dataset, cmd: Command) -> Result:
    from .graphs import _fig, _finish, _png, _q, _result

    v = resolve_var(cmd.args.split()[0], ds.df)
    _num(ds, [v])
    x = sample(ds, cmd, [v])[v].to_numpy(float)
    kde = st.gaussian_kde(x)
    grid = np.linspace(x.min() - 0.1 * np.ptp(x), x.max() + 0.1 * np.ptp(x), 300)
    fig, ax = _fig()
    ax.plot(grid, kde(grid), color="#1a476f", lw=1.6, label="Kernel density estimate")
    if cmd.opt("normal"):
        ax.plot(grid, st.norm.pdf(grid, x.mean(), x.std(ddof=1)), color="#90353b", lw=1.2, ls="--", label="Normal density")
        ax.legend(frameon=False, fontsize=8)
    title = _q(cmd.opt("title")) or "Kernel density estimate"
    _finish(ax, cmd, title, _q(cmd.opt("xtitle")) or nice(ds, v), "Density")
    return _result(_png(fig, title), f"kdensity {v}")


def qnorm(ds: Dataset, cmd: Command) -> Result:
    from .graphs import _fig, _finish, _png, _q, _result

    v = resolve_var(cmd.args.split()[0], ds.df)
    _num(ds, [v])
    x = np.sort(sample(ds, cmd, [v])[v].to_numpy(float))
    n = len(x)
    theo = st.norm.ppf((np.arange(1, n + 1) - 0.5) / n, x.mean(), x.std(ddof=1))
    fig, ax = _fig()
    ax.scatter(theo, x, s=10, color="#1a476f")
    lims = [min(theo.min(), x.min()), max(theo.max(), x.max())]
    ax.plot(lims, lims, color="#90353b", lw=1)
    title = _q(cmd.opt("title")) or f"Normal quantile plot of {v}"
    _finish(ax, cmd, title, "Inverse Normal", nice(ds, v))
    return _result(_png(fig, title), f"qnorm {v}")


# ───────────── display ─────────────


def display(ds: Dataset, cmd: Command) -> Result:
    text = (cmd.args + (" = " + cmd.exp if cmd.exp is not None else "")).strip()
    if not text:
        return Result(log="")
    m = re.fullmatch(r'"(.*)"', text)
    if m:
        return Result(log=m.group(1))
    e = ds.last_est
    extra = {}
    if e and "_b[" in text:
        for nm in set(re.findall(r"_b\[([^\]]+)\]", text)):
            extra[f"_b[{nm}]"] = float(np.asarray(e["b"])[_coef_index(ds, e, nm)])
        for k_, v_ in extra.items():
            text = text.replace(k_, repr(v_))
    one = pd.DataFrame(index=[0])
    v = evaluate(text, one)
    if isinstance(v, pd.Series):
        v = v.iloc[0]
    return Result(log=fmt.g(v).strip() if isinstance(v, (int, float, np.floating)) else str(v), summary={"value": v if isinstance(v, str) else float(v)})
