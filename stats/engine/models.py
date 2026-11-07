"""More models, printed the way Stata prints them: xtset/xtreg (fe, re), mixed, ologit/oprobit,
mlogit, nbreg, ivregress 2sls, factor/rotate, alpha, stset/stcox/sts."""

from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats as st

from . import fmt
from .data import Dataset, StataError, is_numeric
from .expr import resolve_var
from .result import Result, Table
from .statcmds import (_apa_reg_rows, _coef_table, _drop_collinear, _hdr, _levels, build_design, level_label, nice, remember, sample)
from .syntax import Command, expand_varlist, parse_fvlist

RULE = "-" * 78
Z = 1.959963984540054


def _design(ds: Dataset, cmd: Command, y: str, rhs: str, extra: list[str] | None = None):
    terms = parse_fvlist(rhs, ds.df)
    vars_ = [y] + sorted({p[1] for t in terms for p in t.parts}) + (extra or [])
    sub = sample(ds, cmd, vars_)
    if len(sub) == 0:
        raise StataError("no observations")
    rec: dict = {}
    cols = build_design(ds, sub, terms, record=rec)
    X = np.column_stack([c.values for c in cols]) if cols else np.empty((len(sub), 0))
    X, cols, omitted = _drop_collinear(X, cols)
    cmd._design = (terms, rec)
    return sub, cols, omitted, X


def _pz(z):
    return 2 * st.norm.sf(np.abs(z))


def _ll_header(title: str, n: int, chi_lab: str, chi: float, pchi: float, ll: float, pseudo: float | None = None) -> list[str]:
    lines = [f"{title:<56}Number of obs = {n:>6,}", f"{'':56}{chi_lab:<14}= {chi:>6.2f}", f"{'':56}{'Prob > chi2':<14}= {pchi:>6.4f}"]
    tail = f"{'Pseudo R2':<14}= {pseudo:>6.4f}" if pseudo is not None else ""
    lines.append(f"{'Log likelihood = ' + format(ll, '.8g'):<56}{tail}")
    return lines + [""]


# ───────────── panel: xtset / xtreg ─────────────


def xtset(ds: Dataset, cmd: Command) -> Result:
    vs = cmd.args.split()
    if not vs:
        xt = ds.settings.get("xt")
        if not xt:
            raise StataError("panel variable not set; use xtset panelvar [timevar]")
        return Result(log=f"Panel variable: {xt['id']}" + (f"\n Time variable: {xt['t']}" if xt.get("t") else ""))
    pid = resolve_var(vs[0], ds.df)
    tv = resolve_var(vs[1], ds.df) if len(vs) > 1 else None
    ds.settings["xt"] = {"id": pid, "t": tv}
    g = ds.df[pid].nunique()
    sizes = ds.df.groupby(pid).size()
    bal = "strongly balanced" if sizes.nunique() == 1 else "unbalanced"
    lines = [f"Panel variable: {pid} ({bal})"]
    if tv:
        tvals = ds.df[tv].dropna()
        lines += [f" Time variable: {tv}, {fmt.g(tvals.min()).strip()} to {fmt.g(tvals.max()).strip()}", "         Delta: 1 unit"]
    return Result(log="\n".join(lines), changes_data=True, summary={"panels": int(g)})


def xtreg(ds: Dataset, cmd: Command) -> Result:
    xt = ds.settings.get("xt")
    if not xt:
        raise StataError("panel variable not set; use xtset panelvar [timevar]")
    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError("use: xtreg y x1 x2, fe   or   , re")
    y = resolve_var(toks[0], ds.df)
    pid = xt["id"]
    sub, cols, omitted, X = _design(ds, cmd, y, toks[1], [pid])
    yv = sub[y].astype(float).to_numpy()
    g = pd.factorize(sub[pid])[0]
    G = g.max() + 1
    n, k = X.shape
    sizes = np.bincount(g)

    def gmean(a):
        a2 = a.reshape(n, -1)
        s = np.zeros((G, a2.shape[1]))
        np.add.at(s, g, a2)
        return (s / sizes[:, None])[g].reshape(a.shape)

    use_fe = bool(cmd.opt("fe")) or not cmd.opt("re")
    if use_fe and not cmd.opt("re"):
        ydm = yv - gmean(yv) + yv.mean()
        Xdm = X - gmean(X) + X.mean(axis=0)
        Xc = np.column_stack([Xdm, np.ones(n)])
        b = np.linalg.lstsq(Xc, ydm, rcond=None)[0]
        e = ydm - Xc @ b
        dfr = n - G - k
        s2 = (e**2).sum() / dfr
        XtXi = np.linalg.inv(Xc.T @ Xc)
        robust = bool(cmd.opt("robust")) or isinstance(cmd.opt("vce"), str)
        if robust:  # clustered by panel, Stata's small-sample factor
            S = np.zeros((G, k + 1))
            np.add.at(S, g, Xc * e[:, None])
            V = XtXi @ (S.T @ S) @ XtXi * (G / (G - 1)) * ((n - 1) / (n - k - 1))
            df_inf = G - 1
        else:
            V = s2 * XtXi
            df_inf = dfr
        se = np.sqrt(np.diag(V))
        tval = b / se
        pv = 2 * st.t.sf(np.abs(tval), df_inf)
        tc = st.t.ppf(0.975, df_inf)
        lo, hi = b - tc * se, b + tc * se
        xb = X @ b[:-1]
        ui = gmean(yv - xb)[np.unique(g, return_index=True)[1]] - b[-1]
        sigma_u = float(np.std(ui, ddof=1))
        sigma_e = math.sqrt(s2)
        rho = sigma_u**2 / (sigma_u**2 + sigma_e**2)
        r2w = np.corrcoef(xb - gmean(xb), yv - gmean(yv))[0, 1] ** 2 if k else float("nan")
        yb, xbb = gmean(yv)[np.unique(g, return_index=True)[1]], gmean(xb)[np.unique(g, return_index=True)[1]]
        r2b = np.corrcoef(xbb, yb)[0, 1] ** 2 if k else float("nan")
        r2o = np.corrcoef(xb, yv)[0, 1] ** 2 if k else float("nan")
        corr_u = float(np.corrcoef(ui[g], xb)[0, 1]) if k else float("nan")
        R = np.eye(k + 1)[:-1]
        F = float((R @ b) @ np.linalg.solve(R @ V @ R.T, R @ b) / k) if k else float("nan")
        pF = float(st.f.sf(F, k, df_inf))
        pooled = sm.OLS(yv, np.column_stack([X, np.ones(n)])).fit()
        rss_fe = (e**2).sum()
        Fu = ((pooled.ssr - rss_fe) / (G - 1)) / (rss_fe / dfr)
        pFu = float(st.f.sf(Fu, G - 1, dfr))
        lines = [
            f"{'Fixed-effects (within) regression':<48}{_hdr('Number of obs', f'{n:,}')}",
            f"{'Group variable: ' + pid:<48}{_hdr('Number of groups', f'{G:,}')}",
            "",
            f"{'R-squared:':<48}Obs per group:",
            f"{'     Within  = ' + format(r2w, '.4f'):<48}{'min':>16} = {sizes.min():>10,}",
            f"{'     Between = ' + format(r2b, '.4f'):<48}{'avg':>16} = {sizes.mean():>10.1f}",
            f"{'     Overall = ' + format(r2o, '.4f'):<48}{'max':>16} = {sizes.max():>10,}",
            "",
            f"{'':48}{_hdr(f'F({k},{df_inf})', f'{F:.2f}')}",
            f"{'corr(u_i, Xb) = ' + format(corr_u, '.4f'):<48}{_hdr('Prob > F', f'{pF:.4f}')}",
            "",
        ]
        if robust:
            lines.append(f"{'(Std. err. adjusted for ' + format(G, ',') + ' clusters in ' + pid + ')':>78}")
        lines += _coef_table(y, cols, omitted, b, se, tval, pv, lo, hi, "t", "Coefficient", robust_word="Robust" if robust else "")[:-1]
        lines += [
            fmt.rule(13, 64),
            f"{'sigma_u':>12} |{fmt.g(sigma_u, 11)}",
            f"{'sigma_e':>12} |{fmt.g(sigma_e, 11)}",
            f"{'rho':>12} |{fmt.g(rho, 11)}   (fraction of variance due to u_i)",
            RULE,
        ]
        if not robust:
            lines.append(f"F test that all u_i=0: F({G - 1}, {dfr}) = {Fu:.2f}{'':>20}Prob > F = {pFu:.4f}")
        rows, groups = _apa_reg_rows(cols, b, se, tval, pv, lo, hi, labels=ds.var_labels)
        note = f"N = {n:,} observations in {G:,} groups. Within R² = {fmt.apa_r(r2w)}. ρ = {fmt.apa_r(rho)}." + (" Standard errors clustered by panel." if robust else f" F test that all u_i = 0: F({G - 1}, {dfr}) = {fmt.apa_num(Fu)}, p {('< .001' if pFu < 0.001 else '= ' + fmt.apa_p(pFu))}.")
        remember(ds, cmd, "regress", y, sub, cols, b, V, df_inf, None, {"rmse": sigma_e, "rss": float(rss_fe), "n": n, "robust": robust, "X": np.column_stack([X, np.ones(n)]), "yv": yv, "fe": True})
        t = Table(f"Fixed-effects regression predicting {nice(ds, y)}", ["Predictor", "B", "SE", "t", "p", "95% CI"], rows, note=note, groups=groups)
        return Result(log="\n".join(lines), tables=[t], summary={"model": "xtreg fe", "n": n, "groups": int(G), "r2_within": r2w, "rho": rho, "F_u": Fu, "coefs": [{"term": c.label, "b": float(b[i]), "se": float(se[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})
    # random effects (Swamy–Arora GLS), via linearmodels
    from linearmodels.panel import RandomEffects

    idx = pd.MultiIndex.from_arrays([sub[pid].to_numpy(), np.arange(n)])
    exog = pd.DataFrame(np.column_stack([X, np.ones(n)]), index=idx, columns=[f"x{j}" for j in range(k)] + ["const"])
    res = RandomEffects(pd.Series(yv, index=idx), exog).fit(cov_type="clustered", cluster_entity=True) if (cmd.opt("robust") or isinstance(cmd.opt("vce"), str)) else RandomEffects(pd.Series(yv, index=idx), exog).fit()
    b = res.params.to_numpy()
    V = res.cov.to_numpy()
    se = np.sqrt(np.diag(V))
    z = b / se
    pv = _pz(z)
    lo, hi = b - Z * se, b + Z * se
    R = np.eye(k + 1)[:-1]
    chi = float((R @ b) @ np.linalg.solve(R @ V @ R.T, R @ b)) if k else float("nan")
    pchi = float(st.chi2.sf(chi, k)) if k else float("nan")
    sigma_e = math.sqrt(float(res.variance_decomposition["Residual"]))
    sigma_u = math.sqrt(float(res.variance_decomposition["Effects"]))
    rho = sigma_u**2 / (sigma_u**2 + sigma_e**2)
    xb = X @ b[:-1]
    r2w = np.corrcoef(xb - gmean(xb), yv - gmean(yv))[0, 1] ** 2 if k else float("nan")
    first = np.unique(g, return_index=True)[1]
    r2b = np.corrcoef(gmean(xb)[first], gmean(yv)[first])[0, 1] ** 2 if k else float("nan")
    r2o = np.corrcoef(xb, yv)[0, 1] ** 2 if k else float("nan")
    lines = [
        f"{'Random-effects GLS regression':<48}{_hdr('Number of obs', f'{n:,}')}",
        f"{'Group variable: ' + pid:<48}{_hdr('Number of groups', f'{G:,}')}",
        "",
        f"{'R-squared:':<48}Obs per group:",
        f"{'     Within  = ' + format(r2w, '.4f'):<48}{'min':>16} = {sizes.min():>10,}",
        f"{'     Between = ' + format(r2b, '.4f'):<48}{'avg':>16} = {sizes.mean():>10.1f}",
        f"{'     Overall = ' + format(r2o, '.4f'):<48}{'max':>16} = {sizes.max():>10,}",
        "",
        f"{'':48}{_hdr(f'Wald chi2({k})', f'{chi:.2f}')}",
        f"{'corr(u_i, X) = 0 (assumed)':<48}{_hdr('Prob > chi2', f'{pchi:.4f}')}",
        "",
    ]
    lines += _coef_table(y, cols, omitted, b, se, z, pv, lo, hi, "z", "Coefficient")[:-1]
    lines += [fmt.rule(13, 64), f"{'sigma_u':>12} |{fmt.g(sigma_u, 11)}", f"{'sigma_e':>12} |{fmt.g(sigma_e, 11)}", f"{'rho':>12} |{fmt.g(rho, 11)}   (fraction of variance due to u_i)", RULE]
    rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, labels=ds.var_labels)
    remember(ds, cmd, "regress", y, sub, cols, b, V, None, None, {"rmse": sigma_e, "rss": float("nan"), "n": n, "robust": False, "X": np.column_stack([X, np.ones(n)]), "yv": yv})
    t = Table(f"Random-effects regression predicting {nice(ds, y)}", ["Predictor", "B", "SE", "z", "p", "95% CI"], rows, note=f"N = {n:,} observations in {G:,} groups. Wald χ²({k}) = {fmt.apa_num(chi)}, p {('< .001' if pchi < 0.001 else '= ' + fmt.apa_p(pchi))}. ρ = {fmt.apa_r(rho)}.", groups=groups)
    return Result(log="\n".join(lines), tables=[t], summary={"model": "xtreg re", "n": n, "groups": int(G), "chi2": chi, "rho": rho, "coefs": [{"term": c.label, "b": float(b[i]), "se": float(se[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})


# ───────────── mixed ─────────────


def mixed(ds: Dataset, cmd: Command) -> Result:
    if "||" not in cmd.args:
        raise StataError("use: mixed y x1 x2 || group:   (add a slope: || group: x1)")
    fixed, rand = cmd.args.split("||", 1)
    m = re.match(r"\s*([A-Za-z_]\w*)\s*:\s*(.*)$", rand.strip())
    if not m:
        raise StataError("use: mixed y x || group:")
    grp = resolve_var(m.group(1), ds.df)
    slopes = [resolve_var(v, ds.df) for v in m.group(2).split()]
    toks = fixed.split(None, 1)
    y = resolve_var(toks[0], ds.df)
    sub, cols, omitted, X = _design(ds, cmd, y, toks[1] if len(toks) > 1 else "", [grp] + slopes)
    yv = sub[y].astype(float).to_numpy()
    n, k = X.shape
    Xc = np.column_stack([X, np.ones(n)])
    reml = bool(cmd.opt("reml"))
    exog_re = np.column_stack([np.ones(n)] + [sub[s].astype(float).to_numpy() for s in slopes])
    mod = sm.MixedLM(yv, Xc, groups=sub[grp].to_numpy(), exog_re=exog_re)
    import warnings

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            res = mod.fit(reml=reml, method=["lbfgs", "bfgs", "nm"])
        except Exception as e:  # noqa: BLE001
            raise StataError(f"the mixed model did not converge ({type(e).__name__})") from e
    mixed_notes = ["A variance component is at or near zero (the boundary), so that random effect may not be needed."] if any("boundary" in str(w.message) or "singular" in str(w.message).lower() for w in caught) else []
    b = np.asarray(res.fe_params)
    V = np.asarray(res.cov_params())[: k + 1, : k + 1]
    se = np.sqrt(np.diag(V))
    z = b / se
    pv = _pz(z)
    lo, hi = b - Z * se, b + Z * se
    R = np.eye(k + 1)[:-1]
    chi = float((R @ b) @ np.linalg.solve(R @ V @ R.T, R @ b)) if k else float("nan")
    pchi = float(st.chi2.sf(chi, k)) if k else float("nan")
    sizes = sub.groupby(grp).size()
    G = len(sizes)
    ll = float(res.llf)
    ols_ll = float(sm.OLS(yv, Xc).fit().llf)
    lr = max(0.0, 2 * (ll - ols_ll))
    q = (len(slopes) + 1) * (len(slopes) + 2) // 2  # unstructured covariance of the random effects
    plr = 0.5 * float(st.chi2.sf(lr, 1)) if not slopes else float(st.chi2.sf(lr, q))
    cov_re = np.asarray(res.cov_re)
    lines = [
        f"{'Mixed-effects ' + ('REML' if reml else 'ML') + ' regression':<48}{_hdr('Number of obs', f'{n:,}')}",
        f"{'Group variable: ' + grp:<48}{_hdr('Number of groups', f'{G:,}')}",
        f"{'':48}Obs per group:",
        f"{'':48}{'min':>16} = {sizes.min():>10,}",
        f"{'':48}{'avg':>16} = {sizes.mean():>10.1f}",
        f"{'':48}{'max':>16} = {sizes.max():>10,}",
        "",
        f"{'':48}{_hdr(f'Wald chi2({k})', f'{chi:.2f}')}",
        f"{'Log ' + ('restricted-' if reml else '') + 'likelihood = ' + format(ll, '.8g'):<48}{_hdr('Prob > chi2', f'{pchi:.4f}')}",
        "",
    ]
    lines += _coef_table(y, cols, omitted, b, se, z, pv, lo, hi, "z", "Coefficient")
    lines += ["", "------------------------------------------------------------------------------", "  Random-effects parameters  |   Estimate", "-----------------------------+------------------------------------------------", f"{grp + ': ' + ('Unstructured' if slopes else 'Identity'):<29}|"]
    names = ["_cons"] + slopes
    re_rows = []
    for i, nm in enumerate(names):
        lines.append(f"{'var(' + nm + ')':>28} |{fmt.g(cov_re[i, i], 11)}")
        re_rows.append([f"{nice(ds, grp)}: var({nm})", fmt.apa_num(cov_re[i, i])])
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            lines.append(f"{'cov(' + names[j] + ',' + names[i] + ')':>28} |{fmt.g(cov_re[i, j], 11)}")
            re_rows.append([f"{nice(ds, grp)}: cov({names[j]}, {names[i]})", fmt.apa_num(cov_re[i, j])])
    lines += ["-----------------------------+------------------------------------------------", f"{'var(Residual)':>28} |{fmt.g(res.scale, 11)}", "------------------------------------------------------------------------------"]
    lines.append(f"LR test vs. linear model: {'chibar2(01)' if not slopes else 'chi2(' + str(q) + ')'} = {lr:.2f}{'':>12}Prob >= chibar2 = {plr:.4f}")
    icc = cov_re[0, 0] / (cov_re[0, 0] + res.scale)
    re_rows.append(["Residual variance", fmt.apa_num(res.scale)])
    rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, labels=ds.var_labels)
    remember(ds, cmd, "regress", y, sub, cols, b, V, None, None, {"rmse": math.sqrt(res.scale), "rss": float("nan"), "n": n, "robust": False, "X": Xc, "yv": yv})
    t1 = Table(f"Multilevel model predicting {nice(ds, y)}: fixed effects", ["Predictor", "B", "SE", "z", "p", "95% CI"], rows, note=f"N = {n:,} observations in {G:,} groups of {nice(ds, grp)}. {'REML' if reml else 'ML'} estimation. ICC = {fmt.apa_r(icc)}.", groups=groups)
    t2 = Table("Random-effects parameters", ["Parameter", "Estimate"], re_rows)
    return Result(log="\n".join(lines), tables=[t1, t2], notes=mixed_notes, summary={"model": "mixed", "n": n, "groups": G, "icc": icc, "ll": ll, "lr": lr, "p_lr": plr, "var_cons": float(cov_re[0, 0]), "var_resid": float(res.scale), "coefs": [{"term": c.label, "b": float(b[i]), "se": float(se[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})


# ───────────── ologit / oprobit ─────────────


def ordered(ds: Dataset, cmd: Command) -> Result:
    from statsmodels.miscmodels.ordinal_model import OrderedModel

    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError(f"use: {cmd.name} outcome predictors")
    y = resolve_var(toks[0], ds.df)
    sub, cols, omitted, X = _design(ds, cmd, y, toks[1])
    yv = sub[y]
    cats = sorted(yv.unique())
    if len(cats) < 3:
        raise StataError(f"{y} has {len(cats)} outcomes; use logit for two outcomes")
    codes = pd.Categorical(yv, categories=cats, ordered=True)
    distr = "probit" if cmd.name == "oprobit" else "logit"
    mod = OrderedModel(codes, X, distr=distr)
    res = mod.fit(method="bfgs", disp=False, maxiter=2000)
    k = X.shape[1]
    th = res.params[k:]
    cuts = np.cumsum(np.r_[th[0], np.exp(th[1:])])
    J = np.zeros((len(th), len(th)))
    for i in range(len(th)):
        J[i, 0] = 1
        for j in range(1, i + 1):
            J[i, j] = np.exp(th[j])
    Vfull = np.asarray(res.cov_params())
    Vb = Vfull[:k, :k]
    Vc = J @ Vfull[k:, k:] @ J.T
    b = res.params[:k]
    se = np.sqrt(np.diag(Vb))
    z = b / se
    pv = _pz(z)
    lo, hi = b - Z * se, b + Z * se
    ll = float(res.llf)
    p0 = np.bincount(codes.codes) / len(codes)
    ll0 = float((np.bincount(codes.codes) * np.log(p0)).sum())
    lr = 2 * (ll - ll0)
    plr = float(st.chi2.sf(lr, k))
    pseudo = 1 - ll / ll0
    title = "Ordered logistic regression" if distr == "logit" else "Ordered probit regression"
    lines = _ll_header(title, len(sub), f"LR chi2({k})", lr, plr, ll, pseudo)
    want_or = cmd.opt("or") and distr == "logit"
    tbl = _coef_table(y, cols, omitted, np.exp(b) if want_or else b, np.exp(b) * se if want_or else se, z, pv, np.exp(lo) if want_or else lo, np.exp(hi) if want_or else hi, "z", "Odds ratio" if want_or else "Coefficient", cons_label="")
    lines += tbl[:-1] + [fmt.rule(13, 64)]
    cse = np.sqrt(np.diag(Vc))
    for i, (c, s) in enumerate(zip(cuts, cse)):
        lines.append(f"{'/cut' + str(i + 1):>12} |{fmt.g(c, 11)}{fmt.g(s, 11)}{'':26}{fmt.g(c - Z * s, 13)}{fmt.g(c + Z * s, 12)}")
    lines.append(RULE)
    rows, groups = _apa_reg_rows(cols, np.r_[b, 0], np.r_[se, 1], np.r_[z, 0], np.r_[pv, 1], np.r_[lo, 0], np.r_[hi, 0], transform=np.exp if distr == "logit" else None, with_cons=False, labels=ds.var_labels)
    rows += [[f"Cut {i + 1}", fmt.apa_num(c), fmt.apa_num(s), "", "", ""][: len(rows[0]) if rows else 6] for i, (c, s) in enumerate(zip(cuts, cse))]
    head = ["Predictor", "OR", "95% CI", "z", "p"] if distr == "logit" else ["Predictor", "B", "SE", "z", "p", "95% CI"]
    t = Table(f"{title} predicting {nice(ds, y)}", head, rows, note=f"N = {len(sub):,}. LR χ²({k}) = {fmt.apa_num(lr)}, p {('< .001' if plr < 0.001 else '= ' + fmt.apa_p(plr))}; pseudo R² = {fmt.apa_r(pseudo)}.", groups=groups)
    return Result(log="\n".join(lines), tables=[t], summary={"model": title, "n": len(sub), "chi2": lr, "p": plr, "pseudo_r2": pseudo, "cuts": cuts.tolist(), "coefs": [{"term": c.label, "b": float(b[i]), "se": float(se[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})


# ───────────── mlogit ─────────────


def mlogit(ds: Dataset, cmd: Command) -> Result:
    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError("use: mlogit outcome predictors [, baseoutcome(#) rrr]")
    y = resolve_var(toks[0], ds.df)
    sub, cols, omitted, X = _design(ds, cmd, y, toks[1])
    yv = sub[y]
    cats = sorted(yv.unique())
    base = cmd.opt("baseoutcome")
    base_v = float(base) if isinstance(base, str) else yv.value_counts().idxmax()  # Stata: most frequent
    if base_v not in [float(c) for c in cats]:
        raise StataError(f"baseoutcome({base}) is not an outcome of {y}")
    order = [c for c in cats if float(c) == base_v] + [c for c in cats if float(c) != base_v]
    codes = yv.map({c: i for i, c in enumerate(order)}).to_numpy()
    Xc = np.column_stack([X, np.ones(len(sub))])
    res = sm.MNLogit(codes, Xc).fit(disp=0, maxiter=500)
    k = Xc.shape[1]
    params = np.asarray(res.params)
    bse = np.asarray(res.bse)
    ll, ll0 = float(res.llf), float(res.llnull)
    lr = 2 * (ll - ll0)
    dfm = (len(cats) - 1) * (k - 1)
    plr = float(st.chi2.sf(lr, dfm))
    pseudo = 1 - ll / ll0
    lines = _ll_header("Multinomial logistic regression", len(sub), f"LR chi2({dfm})", lr, plr, ll, pseudo)
    rrr = bool(cmd.opt("rrr"))
    lines += [RULE, f"{fmt.name(y)} | {'RRR' if rrr else 'Coefficient':>11}  Std. err.      z    P>|z|     [95% conf. interval]", fmt.rule(13, 64)]
    rows, summ = [], []
    for j, outcome in enumerate(order):
        lab = level_label(ds, y, outcome)
        lines.append(f"{fmt.name(lab)} |{'  (base outcome)' if j == 0 else ''}")
        if j == 0:
            lines.append(fmt.rule(13, 64))
            continue
        b, se = params[:, j - 1], bse[:, j - 1]
        z = b / se
        pv = _pz(z)
        lo, hi = b - Z * se, b + Z * se
        names = [c.label for c in cols] + ["_cons"]
        for i, nm in enumerate(names):
            bb, ss, ll_, hh = (np.exp(b[i]), np.exp(b[i]) * se[i], np.exp(lo[i]), np.exp(hi[i])) if rrr else (b[i], se[i], lo[i], hi[i])
            lines.append(f"{fmt.name(nm)} |{fmt.g(bb, 11)}{fmt.g(ss, 11)}{z[i]:>9.2f}{fmt.p(pv[i])}{fmt.g(ll_, 13)}{fmt.g(hh, 12)}")
            if nm != "_cons":
                rows.append([f"{lab}: {nice(ds, nm) if nm in ds.df else nm}", fmt.apa_num(np.exp(b[i])), f"[{fmt.apa_num(np.exp(lo[i]))}, {fmt.apa_num(np.exp(hi[i]))}]", fmt.apa_num(z[i]), fmt.apa_p(pv[i]) + fmt.stars(pv[i])])
                summ.append({"outcome": lab, "term": nm, "b": float(b[i]), "rrr": float(np.exp(b[i])), "p": float(pv[i])})
        lines.append(fmt.rule(13, 64))
    lines[-1] = RULE
    base_lab = level_label(ds, y, order[0])
    t = Table(f"Multinomial logistic regression predicting {nice(ds, y)}", ["Outcome: predictor", "RRR", "95% CI", "z", "p"], rows, note=f"N = {len(sub):,}. Base outcome: {base_lab}. LR χ²({dfm}) = {fmt.apa_num(lr)}, p {('< .001' if plr < 0.001 else '= ' + fmt.apa_p(plr))}; pseudo R² = {fmt.apa_r(pseudo)}. RRR = relative-risk ratio.")
    return Result(log="\n".join(lines), tables=[t], summary={"model": "mlogit", "base": base_lab, "n": len(sub), "chi2": lr, "p": plr, "pseudo_r2": pseudo, "coefs": summ})


# ───────────── nbreg ─────────────


def nbreg(ds: Dataset, cmd: Command) -> Result:
    toks = cmd.args.split(None, 1)
    if len(toks) < 2:
        raise StataError("use: nbreg count predictors [, irr]")
    y = resolve_var(toks[0], ds.df)
    sub, cols, omitted, X = _design(ds, cmd, y, toks[1])
    yv = sub[y].astype(float).to_numpy()
    if (yv < 0).any() or np.any(np.mod(yv, 1) != 0):
        raise StataError(f"{y} must be a count (0, 1, 2, ...)")
    Xc = np.column_stack([X, np.ones(len(sub))])
    res = sm.NegativeBinomial(yv, Xc, loglike_method="nb2").fit(disp=0, maxiter=500)
    k = Xc.shape[1]
    b, se = np.asarray(res.params[:k]), np.asarray(res.bse[:k])
    alpha = float(res.params[k])
    z = b / se
    pv = _pz(z)
    lo, hi = b - Z * se, b + Z * se
    ll = float(res.llf)
    llnull = float(sm.NegativeBinomial(yv, np.ones((len(yv), 1)), loglike_method="nb2").fit(disp=0).llf)
    lr = 2 * (ll - llnull)
    plr = float(st.chi2.sf(lr, k - 1))
    pois_ll = float(sm.Poisson(yv, Xc).fit(disp=0).llf)
    lr_a = max(0.0, 2 * (ll - pois_ll))
    p_a = 0.5 * float(st.chi2.sf(lr_a, 1))
    lines = _ll_header("Negative binomial regression", len(sub), f"LR chi2({k - 1})", lr, plr, ll, 1 - ll / llnull)
    lines.insert(1, f"{'Dispersion: mean':<56}")
    irr = bool(cmd.opt("irr"))
    lines += _coef_table(y, cols, omitted, np.exp(b) if irr else b, np.exp(b) * se if irr else se, z, pv, np.exp(lo) if irr else lo, np.exp(hi) if irr else hi, "z", "IRR" if irr else "Coefficient")[:-1]
    se_a = float(res.bse[k]) if len(res.bse) > k else float("nan")
    lines += [fmt.rule(13, 64), f"{'/lnalpha':>12} |{fmt.g(math.log(alpha), 11)}{fmt.g(se_a / alpha, 11)}", fmt.rule(13, 64), f"{'alpha':>12} |{fmt.g(alpha, 11)}{fmt.g(se_a, 11)}", RULE, f"LR test of alpha=0: chibar2(01) = {lr_a:.2f}{'':>22}Prob >= chibar2 = {p_a:.3f}"]
    rows, groups = _apa_reg_rows(cols, b, se, z, pv, lo, hi, transform=np.exp, labels=ds.var_labels)
    t = Table(f"Negative binomial regression predicting {nice(ds, y)}", ["Predictor", "IRR", "95% CI", "z", "p"], rows, note=f"N = {len(sub):,}. α = {fmt.apa_num(alpha)}; LR test of α = 0: χ̄²(01) = {fmt.apa_num(lr_a)}, p {('< .001' if p_a < 0.001 else '= ' + fmt.apa_p(p_a))}.", groups=groups)
    remember(ds, cmd, "poisson", y, sub, cols, b, np.asarray(res.cov_params())[:k, :k], None, None, {"n": len(sub), "llf": ll, "ll0": llnull, "X": Xc, "yv": yv, "pred": np.exp(Xc @ b), "robust": False})
    return Result(log="\n".join(lines), tables=[t], summary={"model": "nbreg", "n": len(sub), "alpha": alpha, "lr_alpha": lr_a, "p_alpha": p_a, "coefs": [{"term": c.label, "b": float(b[i]), "irr": float(np.exp(b[i])), "p": float(pv[i])} for i, c in enumerate(cols)]})


# ───────────── ivregress 2sls ─────────────


def ivregress(ds: Dataset, cmd: Command) -> Result:
    from linearmodels.iv import IV2SLS

    m = re.match(r"^\s*(2sls|liml|gmm)\s+(\S+)\s*(.*?)\(\s*([^=]+)=\s*([^)]+)\)\s*(.*)$", cmd.args)
    if not m:
        raise StataError("use: ivregress 2sls y x1 (endogenous = instrument1 instrument2)")
    if m.group(1) != "2sls":
        raise StataError("ivregress supports 2sls")
    y = resolve_var(m.group(2), ds.df)
    exo = expand_varlist((m.group(3) + " " + m.group(6)).strip(), ds.df, allow_empty_all=False) if (m.group(3) + m.group(6)).strip() else []
    endo = expand_varlist(m.group(4), ds.df, allow_empty_all=False)
    inst = expand_varlist(m.group(5), ds.df, allow_empty_all=False)
    if len(inst) < len(endo):
        raise StataError("equation not identified; must have at least as many instruments not in the regression as there are instrumented variables")
    sub = sample(ds, cmd, [y] + exo + endo + inst)
    n = len(sub)
    ex = sub[exo].astype(float).assign(const=1.0) if exo else pd.DataFrame({"const": np.ones(n)}, index=sub.index)
    robust = bool(cmd.opt("robust")) or (isinstance(cmd.opt("vce"), str) and cmd.opt("vce").startswith("r"))
    small = bool(cmd.opt("small"))
    res = IV2SLS(sub[y].astype(float), ex, sub[endo].astype(float), sub[inst].astype(float)).fit(cov_type="robust" if robust else "unadjusted", debiased=small)
    names = endo + exo + ["_cons"]
    order = endo + exo + ["const"]
    b = res.params[order].to_numpy()
    se = res.std_errors[order].to_numpy()
    stat = b / se
    k = len(b)
    dfr = n - k
    pv = 2 * st.t.sf(np.abs(stat), dfr) if small else _pz(stat)
    crit = st.t.ppf(0.975, dfr) if small else Z
    lo, hi = b - crit * se, b + crit * se
    V = res.cov.loc[order, order].to_numpy()
    R = np.eye(k)[:-1]
    W = float((R @ b) @ np.linalg.solve(R @ V @ R.T, R @ b))
    test_lab, test_val, ptest = (f"F({k - 1}, {dfr})", W / (k - 1), float(st.f.sf(W / (k - 1), k - 1, dfr))) if small else (f"Wald chi2({k - 1})", W, float(st.chi2.sf(W, k - 1)))
    resid = res.resids.to_numpy()
    yv = sub[y].astype(float).to_numpy()
    r2 = 1 - (resid**2).sum() / ((yv - yv.mean()) ** 2).sum()
    rmse = math.sqrt((resid**2).sum() / (dfr if small else n))
    lines = [
        f"{'Instrumental variables 2SLS regression':<48}{_hdr('Number of obs', f'{n:,}')}",
        f"{'':48}{_hdr(test_lab, f'{test_val:.2f}')}",
        f"{'':48}{_hdr('Prob > ' + ('F' if small else 'chi2'), f'{ptest:.4f}')}",
        f"{'':48}{_hdr('R-squared', f'{r2:.4f}')}",
        f"{'':48}{_hdr('Root MSE', fmt.g(rmse).strip())}",
        "",
    ]
    lines += [RULE, f"{'':12} |{'Robust' if robust else '':>24}" if robust else None, f"{fmt.name(y)} | Coefficient  {'std. err.' if robust else 'Std. err.'}{'t' if small else 'z':>7}    P>|{'t' if small else 'z'}|     [95% conf. interval]", fmt.rule(13, 64)]
    lines = [l for l in lines if l is not None]
    for i, nm in enumerate(names):
        lines.append(f"{fmt.name(nm)} |{fmt.g(b[i], 11)}{fmt.g(se[i], 11)}{stat[i]:>9.2f}{fmt.p(pv[i])}{fmt.g(lo[i], 13)}{fmt.g(hi[i], 12)}")
    lines += [RULE, f"Instrumented: {' '.join(endo)}", f" Instruments: {' '.join(exo + inst)}"]
    first = []
    for e in endo:
        fs = sm.OLS(sub[e].astype(float), sm.add_constant(sub[exo + inst].astype(float))).fit()
        R2 = np.zeros((len(inst), len(fs.params)))
        for j, v in enumerate(inst):
            R2[j, list(fs.params.index).index(v)] = 1
        f_inst = float(fs.f_test(R2).fvalue)
        first.append((e, f_inst))
    notes = [f"First stage: instruments for {e} have F = {f:.1f}" + (" (below 10: weak instruments; estimates may be biased)." if f < 10 else ".") for e, f in first]
    rows = [[nice(ds, nm) if nm in ds.df else ("Constant" if nm == "_cons" else nm), fmt.apa_num(b[i]), fmt.apa_num(se[i]), fmt.apa_num(stat[i]), fmt.apa_p(pv[i]) + (fmt.stars(pv[i]) if nm != "_cons" else ""), f"[{fmt.apa_num(lo[i])}, {fmt.apa_num(hi[i])}]"] for i, nm in enumerate(names)]
    t = Table(f"Two-stage least squares regression predicting {nice(ds, y)}", ["Predictor", "B", "SE", "t" if small else "z", "p", "95% CI"], rows, note=f"N = {n:,}. Instrumented: {', '.join(endo)}; excluded instruments: {', '.join(inst)}. R² = {fmt.apa_r(r2)}.")
    return Result(log="\n".join(lines), tables=[t], notes=notes, summary={"model": "ivregress 2sls", "n": n, "r2": r2, "first_stage_F": dict(first), "coefs": [{"term": nm, "b": float(b[i]), "se": float(se[i]), "p": float(pv[i])} for i, nm in enumerate(names)]})


# ───────────── factor / rotate / alpha ─────────────


def factor(ds: Dataset, cmd: Command) -> Result:
    vs = [v for v in expand_varlist(cmd.args, ds.df, allow_empty_all=False) if is_numeric(ds.df[v])]
    if len(vs) < 3:
        raise StataError("factor needs at least three numeric variables")
    sub = sample(ds, cmd, vs)
    n, p = len(sub), len(vs)
    Rm = np.corrcoef(sub[vs].astype(float).to_numpy(), rowvar=False)
    method = "pcf" if cmd.opt("pcf") else ("ipf" if cmd.opt("ipf") else "pf")
    Rr = Rm.copy()
    if method in ("pf", "ipf"):
        smc = 1 - 1 / np.diag(np.linalg.inv(Rm))
        np.fill_diagonal(Rr, smc)
    vals, vecs = np.linalg.eigh(Rr)
    order = np.argsort(vals)[::-1]
    vals, vecs = vals[order], vecs[:, order]
    nf_opt = cmd.opt("factors")
    if isinstance(nf_opt, str):
        nf = int(nf_opt)
    else:
        nf = int((vals > (1 if method == "pcf" else 0)).sum())
    nf = max(1, min(nf, p))
    if method == "ipf":
        h2 = np.diag(Rr).copy()
        for _ in range(200):
            np.fill_diagonal(Rr, h2)
            vals, vecs = np.linalg.eigh(Rr)
            order = np.argsort(vals)[::-1]
            vals, vecs = vals[order], vecs[:, order]
            L = vecs[:, :nf] * np.sqrt(np.clip(vals[:nf], 0, None))
            new = (L**2).sum(1)
            if np.max(np.abs(new - h2)) < 1e-6:
                break
            h2 = new
    L = vecs[:, :nf] * np.sqrt(np.clip(vals[:nf], 0, None))
    L *= np.where(L.sum(0) < 0, -1, 1)
    uniq = 1 - (L**2).sum(1)
    total = vals.sum()
    lr = -(n - 1 - (2 * p + 5) / 6) * math.log(np.linalg.det(Rm))
    dfi = p * (p - 1) // 2
    mname = {"pf": "principal factors", "pcf": "principal-component factors", "ipf": "iterated principal factors"}[method]
    lines = [
        f"{'Factor analysis/correlation':<49}Number of obs    = {n:>10,}",
        f"{'    Method: ' + mname:<49}Retained factors = {nf:>10}",
        f"{'    Rotation: (unrotated)':<49}Number of params = {nf * p - nf * (nf - 1) // 2:>10}",
        "",
        "    --------------------------------------------------------------------------",
        "         Factor  |   Eigenvalue   Difference        Proportion   Cumulative",
        "    -------------+------------------------------------------------------------",
    ]
    cum = 0.0
    for i, v in enumerate(vals):
        cum += v / total
        diff = vals[i] - vals[i + 1] if i + 1 < len(vals) else float("nan")
        lines.append(f"    {'Factor' + str(i + 1):>12} |{v:>13.5f}{'' if math.isnan(diff) else format(diff, '>13.5f'):>13}{v / total:>18.4f}{cum:>13.4f}")
    lines += ["    --------------------------------------------------------------------------", f"    LR test: independent vs. saturated:  chi2({dfi}) = {lr:>8.2f} Prob>chi2 = {float(st.chi2.sf(lr, dfi)):.4f}", "", _loadings_block(vs, L, uniq, "Factor loadings (pattern matrix) and unique variances")]
    ds.settings["factor"] = {"vars": vs, "L": L.tolist(), "uniq": uniq.tolist()}
    t = _loadings_table(ds, vs, L, uniq, f"Factor loadings ({mname}, unrotated)")
    t2 = Table("Eigenvalues", ["Factor", "Eigenvalue", "Proportion", "Cumulative"], [[f"{i + 1}", fmt.apa_num(v), f"{v / total:.3f}", f"{np.cumsum(vals)[i] / total:.3f}"] for i, v in enumerate(vals[: max(nf + 2, 3)])])
    return Result(log="\n".join(lines), tables=[t, t2], summary={"method": method, "factors": nf, "eigenvalues": vals.tolist()[: nf + 2], "loadings": {v: L[i].tolist() for i, v in enumerate(vs)}})


def _loadings_block(vs, L, uniq, title):
    nf = L.shape[1]
    w = 10 * nf
    out = [title, "", "    " + "-" * (17 + w + 16), f"        Variable |" + "".join(f"{'Factor' + str(j + 1):>10}" for j in range(nf)) + " |   Uniqueness ", "    -------------+" + "-" * w + "-+-------------"]
    for i, v in enumerate(vs):
        out.append(f"    {fmt.name(v)} |" + "".join(f"{L[i, j]:>10.4f}" for j in range(nf)) + f" |{uniq[i]:>12.4f}")
    out.append("    " + "-" * (17 + w + 16))
    return "\n".join(out)


def _loadings_table(ds, vs, L, uniq, title):
    nf = L.shape[1]
    rows = [[nice(ds, v)] + [f"{L[i, j]:.2f}".replace("0.", ".") for j in range(nf)] + [f"{uniq[i]:.2f}".replace("0.", ".")] for i, v in enumerate(vs)]
    return Table(title, ["Item"] + [f"Factor {j + 1}" for j in range(nf)] + ["Uniqueness"], rows, note="Loadings of .40 or more are usually treated as meaningful.")


def _varimax(L, gamma=1.0, iters=500, tol=1e-8):
    p, k = L.shape
    R = np.eye(k)
    d = 0
    for _ in range(iters):
        Lr = L @ R
        u, s, vh = np.linalg.svd(L.T @ (Lr**3 - (gamma / p) * Lr @ np.diag((Lr**2).sum(0))))
        R = u @ vh
        d_old, d = d, s.sum()
        if d_old and d / d_old < 1 + tol:
            break
    return L @ R, R


def rotate(ds: Dataset, cmd: Command) -> Result:
    f = ds.settings.get("factor")
    if not f:
        raise StataError("no factor results to rotate: run factor first")
    L = np.array(f["L"])
    if L.shape[1] < 2:
        raise StataError("rotation needs at least two retained factors; use factor ..., factors(2)")
    if cmd.opt("promax") or cmd.opt("oblique"):
        Lv, _ = _varimax(L)
        P = np.sign(Lv) * np.abs(Lv) ** 3
        U = np.linalg.lstsq(Lv, P, rcond=None)[0]
        U = U / np.sqrt(np.diag(np.linalg.inv(U.T @ U)))
        Lr = Lv @ U
        kind = "promax(3)"
    else:
        Lr, _ = _varimax(L)
        kind = "orthogonal varimax (Kaiser off)"
    Lr *= np.where(Lr.sum(0) < 0, -1, 1)
    uniq = np.array(f["uniq"])
    var = (Lr**2).sum(0)
    lines = ["Factor analysis/correlation", f"    Rotation: {kind}", "", "    --------------------------------------------------", "         Factor  |     Variance   Proportion", "    -------------+------------------------------------"]
    tot = len(f["vars"])
    for j, v in enumerate(var):
        lines.append(f"    {'Factor' + str(j + 1):>12} |{v:>13.5f}{v / tot:>13.4f}")
    lines += ["    --------------------------------------------------", "", _loadings_block(f["vars"], Lr, uniq, "Rotated factor loadings (pattern matrix) and unique variances")]
    return Result(log="\n".join(lines), tables=[_loadings_table(ds, f["vars"], Lr, uniq, f"Rotated factor loadings ({kind.split(' (')[0]})")], summary={"rotation": kind, "loadings": {v: Lr[i].tolist() for i, v in enumerate(f["vars"])}})


def alpha(ds: Dataset, cmd: Command) -> Result:
    vs = [v for v in expand_varlist(cmd.args, ds.df, allow_empty_all=False) if is_numeric(ds.df[v])]
    if len(vs) < 2:
        raise StataError("alpha needs at least two items")
    sub = sample(ds, cmd, vs)
    Xd = sub[vs].astype(float)
    std = bool(cmd.opt("std"))
    if std:
        Xd = (Xd - Xd.mean()) / Xd.std(ddof=1)
    rev = []
    if not cmd.opt("asis"):
        total = Xd.sum(1)
        for v in vs:  # Stata reverses items that correlate negatively with the rest of the scale
            rest = total - Xd[v]
            if np.corrcoef(Xd[v], rest)[0, 1] < 0:
                rev.append(v)
                Xd[v] = -Xd[v]
    k = len(vs)
    C = np.cov(Xd.to_numpy(), rowvar=False)
    avg_cov = (C.sum() - np.trace(C)) / (k * (k - 1))
    a = k * avg_cov / (np.trace(C) / k + (k - 1) * avg_cov)
    lines = ["", f"Test scale = mean({'standardized' if std else 'unstandardized'} items)", ""]
    if rev:
        lines.insert(1, f"Reversed item{'s' if len(rev) > 1 else ''}:  {' '.join(rev)}")
    rows = []
    if cmd.opt("item"):
        scale = Xd.mean(1)
        lines += ["                                                            average", "                             item-test     item-rest       interitem", f"{'Item':<12} |  Obs  Sign   correlation   correlation      {'correlation' if std else 'covariance':<12}     alpha", "-------------+-----------------------------------------------------------------"]
        for i, v in enumerate(vs):
            others = [x for x in vs if x != v]
            Co = np.cov(Xd[others].to_numpy(), rowvar=False)
            ko = len(others)
            ac = (Co.sum() - np.trace(Co)) / (ko * (ko - 1)) if ko > 1 else float("nan")
            ai = ko * ac / (np.trace(Co) / ko + (ko - 1) * ac) if ko > 1 else float("nan")
            it = np.corrcoef(Xd[v], scale)[0, 1]
            ir = np.corrcoef(Xd[v], Xd[others].mean(1))[0, 1]
            lines.append(f"{fmt.name(v)} | {len(sub):>4}    {'-' if v in rev else '+'}   {it:>11.4f}   {ir:>11.4f}    {ac:>12.6g}   {ai:>8.4f}")
            rows.append([nice(ds, v), f"{ir:.2f}".replace("0.", "."), f"{ai:.2f}".replace("0.", ".")])
        lines += ["-------------+-----------------------------------------------------------------", f"{'Test scale':<12} |{'':>53}{avg_cov:>12.6g}   {a:>8.4f}", "-------------------------------------------------------------------------------"]
    else:
        lines += [f"Average interitem {'correlation' if std else 'covariance'}:{fmt.g(avg_cov, 17)}", f"Number of items in the scale:{k:>18}", f"Scale reliability coefficient:{a:>17.4f}"]
    tables = [Table("Scale reliability", ["Statistic", "Value"], [["Cronbach's α", f"{a:.2f}".replace("0.", ".")], ["Items", str(k)], ["N", f"{len(sub):,}"]], note="α of .70 or higher is usually considered acceptable.")]
    if rows:
        tables.append(Table("Item statistics", ["Item", "Item–rest r", "α if item deleted"], rows))
    notes = [f"{', '.join(rev)} correlated negatively with the scale and {'was' if len(rev) == 1 else 'were'} reversed (add asis to stop this)."] if rev else []
    return Result(log="\n".join(lines), tables=tables, notes=notes, summary={"alpha": a, "items": k, "n": len(sub), "reversed": rev})


# ───────────── survival: stset / stcox / sts ─────────────


def stset(ds: Dataset, cmd: Command) -> Result:
    toks = cmd.args.split()
    if not toks:
        raise StataError("use: stset timevar, failure(eventvar)")
    tv = resolve_var(toks[0], ds.df)
    fail = cmd.opt("failure")
    fv = resolve_var(fail.split("==")[0].strip(), ds.df) if isinstance(fail, str) else None
    ds.settings["st"] = {"t": tv, "d": fv}
    t = ds.df[tv]
    d = (ds.df[fv].fillna(0) != 0) if fv else pd.Series(True, index=ds.df.index)
    ok = t.notna() & (t > 0)
    lines = [
        f"Survival-time data settings",
        "",
        f"         Failure event: {fv + ' != 0 & ' + fv + ' < .' if fv else '(assumed to fail at time=' + tv + ')'}",
        f"Observed time interval: (0, {tv}]",
        f"     Exit on or before: failure",
        "",
        "-" * 78,
        f"{int(ok.sum()):>10,}  total observations",
        f"{int((~ok).sum()):>10,}  observations excluded (time missing or not positive)",
        "-" * 78,
        f"{int(ok.sum()):>10,}  observations remaining, representing",
        f"{int((d & ok).sum()):>10,}  failures in single-record/single-failure data",
        f"{fmt.g(float(t[ok].sum())).strip():>10}  total analysis time at risk and under observation",
    ]
    return Result(log="\n".join(lines), changes_data=True)


def _st(ds: Dataset) -> dict:
    s = ds.settings.get("st")
    if not s:
        raise StataError("data not st; use stset")
    return s


def stcox(ds: Dataset, cmd: Command) -> Result:
    from statsmodels.duration.hazard_regression import PHReg

    s = _st(ds)
    terms_txt = cmd.args.strip()
    if not terms_txt:
        raise StataError("use: stcox x1 x2")
    extra = [s["t"]] + ([s["d"]] if s["d"] else [])
    terms = parse_fvlist(terms_txt, ds.df)
    vars_ = sorted({p[1] for t in terms for p in t.parts}) + extra
    sub = sample(ds, cmd, vars_)
    sub = sub[sub[s["t"]] > 0]
    rec: dict = {}
    cols = build_design(ds, sub, terms, record=rec)
    X = np.column_stack([c.values for c in cols])
    X, cols, omitted = _drop_collinear(X, cols)
    time = sub[s["t"]].astype(float).to_numpy()
    status = (sub[s["d"]].fillna(0) != 0).astype(int).to_numpy() if s["d"] else np.ones(len(sub), dtype=int)
    robust = bool(cmd.opt("robust"))
    mod = PHReg(time, X, status=status, ties="breslow")
    res = mod.fit(cov_type="robust") if robust else mod.fit()
    b, se = np.asarray(res.params), np.asarray(res.bse)
    z = b / se
    pv = _pz(z)
    lo, hi = b - Z * se, b + Z * se
    ll = float(res.llf)
    ll0 = float(mod.loglike(np.zeros(len(b))))
    lr = 2 * (ll - ll0)
    k = len(b)
    plr = float(st.chi2.sf(lr, k))
    lines = [
        "Cox regression with Breslow method for ties",
        "",
        f"{'No. of subjects = ' + format(len(sub), ',')!s:<56}Number of obs = {len(sub):>6,}",
        f"No. of failures = {int(status.sum()):,}",
        f"Time at risk    = {fmt.g(time.sum()).strip()}",
        f"{'':56}{('Wald chi2(' + str(k) + ')') if robust else ('LR chi2(' + str(k) + ')'):<14}= {lr:>6.2f}",
        f"{'Log ' + ('pseudo' if robust else '') + 'likelihood = ' + format(ll, '.8g'):<56}{'Prob > chi2':<14}= {plr:>6.4f}",
        "",
    ]
    hr = not cmd.opt("nohr")
    lines += _coef_table("_t", cols, omitted, np.exp(b) if hr else b, np.exp(b) * se if hr else se, z, pv, np.exp(lo) if hr else lo, np.exp(hi) if hr else hi, "z", "Haz. ratio" if hr else "Coefficient", robust_word="Robust" if robust else "", cons_label="")
    rows, groups = _apa_reg_rows(cols, np.r_[b, 0], np.r_[se, 1], np.r_[z, 0], np.r_[pv, 1], np.r_[lo, 0], np.r_[hi, 0], transform=np.exp, with_cons=False, labels=ds.var_labels)
    t = Table("Cox proportional-hazards regression", ["Predictor", "HR", "95% CI", "z", "p"], rows, note=f"N = {len(sub):,}; {int(status.sum()):,} failures. LR χ²({k}) = {fmt.apa_num(lr)}, p {('< .001' if plr < 0.001 else '= ' + fmt.apa_p(plr))}. HR = hazard ratio.", groups=groups)
    return Result(log="\n".join(lines), tables=[t], summary={"model": "stcox", "n": len(sub), "failures": int(status.sum()), "chi2": lr, "p": plr, "coefs": [{"term": c.label, "hr": float(np.exp(b[i])), "b": float(b[i]), "p": float(pv[i])} for i, c in enumerate(cols)]})


def sts(ds: Dataset, cmd: Command) -> Result:
    s = _st(ds)
    toks = cmd.args.split()
    what = toks[0].lower() if toks else "graph"
    by = cmd.opt("by")
    by = resolve_var(by.strip(), ds.df) if isinstance(by, str) else (resolve_var(toks[1], ds.df) if what == "test" and len(toks) > 1 else None)
    sub = sample(ds, cmd, [s["t"]] + ([s["d"]] if s["d"] else []) + ([by] if by else []))
    sub = sub[sub[s["t"]] > 0]
    time = sub[s["t"]].astype(float)
    event = (sub[s["d"]].fillna(0) != 0).astype(int) if s["d"] else pd.Series(1, index=sub.index)
    if what == "test":
        from lifelines.statistics import multivariate_logrank_test

        if not by:
            raise StataError("use: sts test groupvar")
        res = multivariate_logrank_test(time, sub[by], event)
        lines = ["", f"Equality of survivor functions", "Log-rank test", "", f"{fmt.name(by)} |  Observed       Expected", "-------------+-------------------------"]
        rows = []
        lv = _levels(ds, sub[by], False)
        exp_tot = _expected_events(time.to_numpy(), event.to_numpy(), sub[by].to_numpy(), lv)
        for g, e in zip(lv, exp_tot):
            o = int(event[sub[by] == g].sum())
            lines.append(f"{fmt.name(level_label(ds, by, g))} |{o:>10,}{e:>15.2f}")
            rows.append([level_label(ds, by, g), f"{o:,}", f"{e:.2f}"])
        lines += ["-------------+-------------------------", f"{'Total':>12} |{int(event.sum()):>10,}{sum(exp_tot):>15.2f}", "", f"{'chi2(' + str(len(lv) - 1) + ') =':>14}{res.test_statistic:>9.2f}", f"{'Pr>chi2 =':>14}{res.p_value:>9.4f}"]
        t = Table(f"Log-rank test by {nice(ds, by)}", [nice(ds, by), "Observed", "Expected"], rows, note=f"χ²({len(lv) - 1}) = {fmt.apa_num(res.test_statistic)}, p {('< .001' if res.p_value < 0.001 else '= ' + fmt.apa_p(res.p_value))}.")
        return Result(log="\n".join(lines), tables=[t], summary={"test": "log-rank", "chi2": float(res.test_statistic), "p": float(res.p_value)})
    if what in ("graph", "gr"):
        from lifelines import KaplanMeierFitter

        from .graphs import PALETTE, _fig, _png, _result

        fig, ax = _fig()
        groups = [(None, np.ones(len(sub), dtype=bool))] if not by else [(g, (sub[by] == g).to_numpy()) for g in _levels(ds, sub[by], False)]
        for i, (g, m) in enumerate(groups):
            km = KaplanMeierFitter().fit(time[m], event[m])
            sf = km.survival_function_
            ax.step(sf.index, sf.iloc[:, 0], where="post", color=PALETTE[i % len(PALETTE)], linewidth=1.6, label=level_label(ds, by, g) if by else None)
        ax.set_ylim(0, 1.02)
        ax.set_xlabel("analysis time")
        ax.set_title("Kaplan–Meier survival estimate" + (f"s by {nice(ds, by)}" if by else ""))
        if by:
            ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.14), ncol=min(4, len(groups)), fontsize=8.5)
        return _result(_png(fig, "Kaplan–Meier survival estimate" + (f"s by {nice(ds, by)}" if by else "")), "Kaplan–Meier curve")
    raise StataError("sts supports: sts graph [, by(group)] and sts test group")


def _expected_events(time, event, grp, levels):
    exp = np.zeros(len(levels))
    for t in np.unique(time[event == 1]):
        at_risk = time >= t
        d = ((time == t) & (event == 1)).sum()
        n = at_risk.sum()
        for j, g in enumerate(levels):
            exp[j] += d * (at_risk & (grp == g)).sum() / n
    return exp.tolist()
