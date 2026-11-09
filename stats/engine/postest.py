"""After a model: predict, estat (hettest, vif, classification, ic), lroc, margins; and swilk."""

from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
from scipy import stats as st

from . import fmt
from .data import Dataset, StataError, is_numeric
from .datacmds import _new_name, selected
from .expr import resolve_var
from .result import Result, Table
from .statcmds import _levels, build_design, level_label, nice, sample
from .syntax import Command, expand_varlist

RULE = "-" * 78
MODEL_NAMES = {"regress": "Linear regression", "logit": "Logistic model", "logistic": "Logistic model", "probit": "Probit model", "poisson": "Poisson model"}


def _est(ds: Dataset, need: str | tuple = ()) -> dict:
    e = ds.last_est
    if not e:
        raise StataError("last estimates not found: run a regression first (regress, logit, logistic, probit or poisson)")
    if need and e["kind"] not in (need if isinstance(need, tuple) else (need,)):
        raise StataError(f"this is not available after {e['kind']}")
    return e


def design(ds: Dataset, e: dict, frame: pd.DataFrame) -> np.ndarray:
    """Design matrix (with constant) for any rows, built exactly as the model was estimated."""
    cols = build_design(ds, frame, e["terms"], levels_map=e["levels"])
    by_key = {(c.group, c.label): c.values for c in cols}
    X = [by_key.get(k, np.zeros(len(frame))) for k in e["keep"]]
    return np.column_stack(X + [np.ones(len(frame))])


def _link(kind: str, xb: np.ndarray) -> np.ndarray:
    if kind in ("logit", "logistic"):
        return 1 / (1 + np.exp(-xb))
    if kind == "probit":
        return st.norm.cdf(xb)
    if kind == "poisson":
        return np.exp(xb)
    return xb


def _complete(ds: Dataset, e: dict, frame: pd.DataFrame) -> pd.Series:
    vars_ = sorted({p[1] for t in e["terms"] for p in t.parts})
    ok = pd.Series(True, index=frame.index)
    for v in vars_:
        ok &= frame[v].notna()
    return ok


# ───────────── predict ─────────────


def predict(ds: Dataset, cmd: Command) -> Result:
    e = _est(ds)
    if e["kind"] == "pca":  # component scores: predict pc1 pc2 ...
        from .extra import pca_scores

        names = cmd.args.split()
        if not names:
            raise StataError("use: predict newvar1 [newvar2 ...] after pca")
        return pca_scores(ds, names)
    name = _new_name(cmd.args.split()[-1] if cmd.args.split() else "", ds)
    opts = {k.lower() for k in cmd.options}
    kind = e["kind"]
    df = ds.df
    keep = selected(ds, cmd)
    ok = _complete(ds, e, df) & keep
    X = design(ds, e, df[ok])
    xb = X @ e["b"]
    out = pd.Series(np.nan, index=df.index)
    if kind == "regress":
        which = "xb"
        if opts & {"residuals", "resid", "r", "re", "res"}:
            which = "residuals"
        elif opts & {"rstandard", "rsta", "rstan"}:
            which = "rstandard"
        elif opts & {"stdp"}:
            which = "stdp"
        if which == "xb":
            out[ok] = xb
            msg = "(option xb assumed; fitted values)"
        elif which == "stdp":
            out[ok] = np.sqrt(np.einsum("ij,jk,ik->i", X, e["V"], X))
            msg = ""
        else:
            y = df.loc[ok, e["y"]].astype(float).to_numpy()
            res = y - xb
            if which == "residuals":
                out[ok] = res
            else:
                Xe = e["X"]
                w = e["w"] if e.get("w") is not None else None
                XtX = Xe.T @ (Xe * (w[:, None] if w is not None else 1))
                h = np.einsum("ij,jk,ik->i", X, np.linalg.pinv(XtX), X)
                out[ok] = res / (e["rmse"] * np.sqrt(np.clip(1 - h, 1e-12, None)))
            msg = ""
    else:
        if opts & {"xb"}:
            out[ok] = xb
            msg = ""
        else:
            out[ok] = _link(kind, xb)
            msg = f"(option {'n' if kind == 'poisson' else 'pr'} assumed; {'predicted number of events' if kind == 'poisson' else 'Pr(' + e['y'] + ')'})"
    df[name] = out.astype(float)
    miss = int(out.isna().sum())
    lines = [m for m in [msg, ("(1 missing value generated)" if miss == 1 else f"({miss:,} missing values generated)") if miss else ""] if m]
    return Result(log="\n".join(lines), changes_data=True, summary={"generated": name, "est": e["cmd"]})


# ───────────── estat ─────────────


def estat(ds: Dataset, cmd: Command) -> Result:
    sub = cmd.args.split()
    what = sub[0].lower() if sub else ""
    if what.startswith("hett"):
        return _hettest(ds, cmd)
    if what == "vif":
        return _vif(ds)
    if what.startswith("class"):
        return _classification(ds, cmd)
    if what == "ic":
        return _ic(ds)
    raise StataError("estat supports: hettest, vif, classification, ic")


def _hettest(ds: Dataset, cmd: Command) -> Result:
    e = _est(ds, "regress")
    if e.get("w") is not None:
        raise StataError("estat hettest is not appropriate after weighted regression")
    X, y = e["X"], e["yv"]
    fitted = X @ e["b"]
    res = y - fitted
    n = len(y)
    s2 = (res**2).sum() / n
    u = res**2 / s2
    use_rhs = bool(cmd.opt("rhs"))
    Z = X[:, :-1] if use_rhs else fitted[:, None]
    Zc = np.column_stack([Z, np.ones(n)])
    g, *_ = np.linalg.lstsq(Zc, u, rcond=None)
    fit = Zc @ g
    mss = float(((fit - u.mean()) ** 2).sum())
    dfree = Z.shape[1]
    if cmd.opt("iid"):
        r2 = mss / float(((u - u.mean()) ** 2).sum())
        chi = n * r2
        assumption = "i.i.d. error terms"
    else:
        chi = mss / 2
        assumption = "Normal error terms"
    p = float(st.chi2.sf(chi, dfree))
    variable = "All independent variables" if use_rhs else f"Fitted values of {e['y']}"
    lines = [
        "Breusch–Pagan/Cook–Weisberg test for heteroskedasticity ",
        f"Assumption: {assumption}",
        f"Variable: {variable}",
        "",
        "H0: Constant variance",
        "",
        f"    chi2({dfree}) = {chi:>8.2f}",
        f"Prob > chi2 = {p:>8.4f}",
    ]
    notes = ["The residual variance is not constant (p < .05): consider robust standard errors (add , robust)."] if p < 0.05 else []
    t = Table("Breusch–Pagan test for heteroskedasticity", ["Test", "χ²", "df", "p"], [["Constant variance (H₀)", fmt.apa_num(chi), str(dfree), fmt.apa_p(p)]])
    return Result(log="\n".join(lines), tables=[t], notes=notes, summary={"test": "Breusch-Pagan", "chi2": chi, "df": dfree, "p": p})


def _vif(ds: Dataset) -> Result:
    e = _est(ds, "regress")
    X = e["X"][:, :-1]
    if X.shape[1] < 2:
        raise StataError("estat vif needs at least two predictors")
    def code(var: str, lab: str) -> str:
        levels, _ = e["levels"].get(var, ([], None))
        for lv in levels:
            if level_label(ds, var, lv) == lab:
                return str(int(lv)) if float(lv).is_integer() else str(lv)
        return lab

    names = []
    for g, l in e["keep"]:  # Stata names factor columns 2.sex, 1.urban#2.sex, c.age#2.sex
        if not g:
            names.append(l)
            continue
        gv, lv = g.split("#"), l.split("#")
        parts, k = [], 0
        for v in gv:
            if v.startswith("c."):
                parts.append(v)
            else:
                parts.append(f"{code(v, lv[k])}.{v}")
                k += 1
        names.append("#".join(parts))
    out = []
    for j in range(X.shape[1]):
        others = np.column_stack([np.delete(X, j, axis=1), np.ones(len(X))])
        coef, *_ = np.linalg.lstsq(others, X[:, j], rcond=None)
        r = X[:, j] - others @ coef
        tss = ((X[:, j] - X[:, j].mean()) ** 2).sum()
        r2 = 1 - (r**2).sum() / tss if tss else float("nan")
        vif = 1 / (1 - r2) if r2 < 1 else float("inf")
        out.append((names[j], vif))
    out.sort(key=lambda t: -t[1])
    lines = ["", f"{'Variable':>12} |{'VIF':>10}{'1/VIF':>12}  ", fmt.rule(13, 22)]
    for nm, v in out:
        lines.append(f"{fmt.name(nm)} |{v:>10.2f}{1 / v:>12.6f}")
    mean_vif = float(np.mean([v for _, v in out]))
    lines += [fmt.rule(13, 22), f"{'Mean VIF':>12} |{mean_vif:>10.2f}"]
    notes = [f"{nm} has a VIF above 10, a sign of strong multicollinearity." for nm, v in out if v > 10]
    t = Table("Variance inflation factors", ["Predictor", "VIF", "1/VIF"], [[nm, fmt.apa_num(v), f"{1 / v:.3f}"] for nm, v in out] + [["Mean VIF", fmt.apa_num(mean_vif), ""]])
    return Result(log="\n".join(lines), tables=[t], notes=notes, summary={"vif": {nm: v for nm, v in out}, "mean_vif": mean_vif})


def _classification(ds: Dataset, cmd: Command) -> Result:
    e = _est(ds, ("logit", "logistic", "probit"))
    cut = float(cmd.opt("cutoff") or 0.5)
    y = e["yv"] == 1
    p = e["pred"]
    plus = p >= cut
    a, b = int((plus & y).sum()), int((plus & ~y).sum())
    c, d = int((~plus & y).sum()), int((~plus & ~y).sum())
    n = a + b + c + d
    pct = lambda num, den: 100 * num / den if den else float("nan")  # noqa: E731
    model = "Logistic" if e["kind"] != "probit" else "Probit"
    lines = [
        f"{model} model for {e['y']}",
        "",
        "              -------- True --------",
        "Classified |         D            ~D  |      Total",
        "-----------+--------------------------+-----------",
        f"     +     |{a:>10,}{b:>14,}  |{a + b:>11,}",
        f"     -     |{c:>10,}{d:>14,}  |{c + d:>11,}",
        "-----------+--------------------------+-----------",
        f"   Total   |{a + c:>10,}{b + d:>14,}  |{n:>11,}",
        "",
        f"Classified + if predicted Pr(D) >= {fmt.g(cut).strip()}",
        f"True D defined as {e['y']} != 0",
        "--------------------------------------------------",
        f"Sensitivity                     Pr( +| D)  {pct(a, a + c):>7.2f}%",
        f"Specificity                     Pr( -|~D)  {pct(d, b + d):>7.2f}%",
        f"Positive predictive value       Pr( D| +)  {pct(a, a + b):>7.2f}%",
        f"Negative predictive value       Pr(~D| -)  {pct(d, c + d):>7.2f}%",
        "--------------------------------------------------",
        f"False + rate for true ~D        Pr( +|~D)  {pct(b, b + d):>7.2f}%",
        f"False - rate for true D         Pr( -| D)  {pct(c, a + c):>7.2f}%",
        f"False + rate for classified +   Pr(~D| +)  {pct(b, a + b):>7.2f}%",
        f"False - rate for classified -   Pr( D| -)  {pct(c, c + d):>7.2f}%",
        "--------------------------------------------------",
        f"Correctly classified                       {pct(a + d, n):>7.2f}%",
        "--------------------------------------------------",
    ]
    rows = [["Sensitivity", f"{pct(a, a + c):.1f}%"], ["Specificity", f"{pct(d, b + d):.1f}%"], ["Positive predictive value", f"{pct(a, a + b):.1f}%"], ["Negative predictive value", f"{pct(d, c + d):.1f}%"], ["Correctly classified", f"{pct(a + d, n):.1f}%"]]
    t = Table(f"Classification of {nice(ds, e['y'])} (cut-off {cut:g})", ["Measure", "Value"], rows)
    return Result(log="\n".join(lines), tables=[t], summary={"sensitivity": pct(a, a + c), "specificity": pct(d, b + d), "correct": pct(a + d, n)})


def _ic(ds: Dataset) -> Result:
    e = _est(ds)
    k = len(e["b"])
    n = e["n"]
    if e["kind"] == "regress":
        rss = e["rss"]
        y = e["yv"]
        tss = float(((y - y.mean()) ** 2).sum())
        llf = -n / 2 * (math.log(2 * math.pi) + math.log(rss / n) + 1)
        ll0 = -n / 2 * (math.log(2 * math.pi) + math.log(tss / n) + 1)
    else:
        llf, ll0 = e["llf"], e["ll0"]
    aic, bic = -2 * llf + 2 * k, -2 * llf + k * math.log(n)
    lines = [
        "Akaike's information criterion and Bayesian information criterion",
        "",
        "-----------------------------------------------------------------------------",
        "       Model |          N   ll(null)  ll(model)      df        AIC        BIC",
        "-------------+---------------------------------------------------------------",
        f"{'.':>12} |{n:>11,}{fmt.g(ll0, 11)}{fmt.g(llf, 11)}{k:>8}{fmt.g(aic, 11)}{fmt.g(bic, 11)}",
        "-----------------------------------------------------------------------------",
    ]
    t = Table("Information criteria", ["N", "Log likelihood", "df", "AIC", "BIC"], [[f"{n:,}", fmt.apa_num(llf), str(k), fmt.apa_num(aic), fmt.apa_num(bic)]])
    return Result(log="\n".join(lines), tables=[t], summary={"aic": aic, "bic": bic, "ll": llf})


def lroc(ds: Dataset, cmd: Command) -> Result:
    e = _est(ds, ("logit", "logistic", "probit"))
    y = e["yv"] == 1
    p = e["pred"]
    ranks = st.rankdata(p)
    n1, n0 = int(y.sum()), int((~y).sum())
    auc = (ranks[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)
    lines = [f"{'Logistic' if e['kind'] != 'probit' else 'Probit'} model for {e['y']}", "", f"Number of observations = {len(y):>8,}", f"Area under ROC curve   = {auc:>8.4f}"]
    images = []
    if not cmd.opt("nograph"):
        from .graphs import roc_image

        order = np.argsort(-p)
        tp = np.cumsum(y[order]) / n1
        fp = np.cumsum(~y[order]) / n0
        images.append(roc_image(np.r_[0, fp], np.r_[0, tp], auc))
    t = Table("Area under the ROC curve", ["N", "AUC"], [[f"{len(y):,}", f"{auc:.3f}".lstrip("0")]])
    return Result(log="\n".join(lines), tables=[t], summary={"auc": auc}, images=images)


# ───────────── swilk ─────────────


def swilk(ds: Dataset, cmd: Command) -> Result:
    vs = [v for v in expand_varlist(cmd.args, ds.df) if is_numeric(ds.df[v])]
    lines = ["", f"{'Shapiro–Wilk W test for normal data':^62}".rstrip(), "", f"{'Variable':>12} |{'Obs':>9}{'W':>12}{'V':>10}{'z':>10}{'Prob>z':>10}", fmt.rule(13, 52)]
    rows, summ = [], []
    for v in vs:
        x = sample(ds, cmd, [v])[v].astype(float).to_numpy()
        n = len(x)
        if n < 4 or n > 2000:
            raise StataError(f"{v}: swilk needs between 4 and 2,000 observations")
        W, p = st.shapiro(x)
        u = math.log(n)
        if n >= 12:  # Royston (1992): the distribution of ln(1 - W)
            mu = 0.0038915 * u**3 - 0.083751 * u**2 - 0.31082 * u - 1.5861
            z = float(st.norm.isf(p))
            V = (1 - W) / math.exp(mu)
        else:
            z = float(st.norm.isf(p))
            V = float("nan")
        lines.append(f"{fmt.name(v)} |{n:>9,}{W:>12.5f}{fmt.g(V, 10)}{z:>10.3f}{p:>10.5f}")
        rows.append([nice(ds, v), f"{n:,}", f"{W:.3f}", fmt.apa_num(z), fmt.apa_p(p)])
        summ.append({"var": v, "n": n, "W": float(W), "z": z, "p": float(p)})
    notes = [f"{s['var']} departs from normality (p < .05); consider a nonparametric test or a transformation." for s in summ if s["p"] < 0.05]
    return Result(log="\n".join(lines), tables=[Table("Shapiro–Wilk test of normality", ["Variable", "n", "W", "z", "p"], rows)], notes=notes, summary={"swilk": summ})


# ───────────── margins ─────────────


def _numlist(text: str) -> list[float]:
    """Stata numlists: 20 40 60, 20(10)60, 1/5."""
    out: list[float] = []
    for tok in text.replace(",", " ").split():
        m = re.match(r"^(-?[\d.]+)\((-?[\d.]+)\)(-?[\d.]+)$", tok)
        if m:
            a, step, b = (float(x) for x in m.groups())
            k = int(math.floor((b - a) / step + 1e-9)) + 1
            out += [a + i * step for i in range(k)]
        elif re.match(r"^-?\d+/-?\d+$", tok):
            a, b = (int(x) for x in tok.split("/"))
            out += [float(i) for i in range(a, b + 1)]
        else:
            out.append(float(tok))
    return out


def _parse_at(ds: Dataset, text: str) -> list[dict]:
    """at(age=(20 40) educ=2) or at(age=(20(10)80)) -> list of {var: value} scenarios (all combinations)."""
    specs: list[tuple[str, list[float]]] = []
    i = 0
    while i < len(text):
        m = re.match(r"\s*([A-Za-z_]\w*)\s*=\s*", text[i:])
        if not m:
            break
        v = resolve_var(m.group(1), ds.df)
        i += m.end()
        if i < len(text) and text[i] == "(":
            depth, j = 0, i
            while j < len(text):
                depth += text[j] == "("
                depth -= text[j] == ")"
                if depth == 0:
                    break
                j += 1
            vals, i = text[i + 1 : j], j + 1
        else:
            m2 = re.match(r"[^\s]+", text[i:])
            vals, i = m2.group(0), i + m2.end()
        specs.append((v, _numlist(vals)))
    if not specs:
        raise StataError("at() needs values, e.g. at(age=(20 40 60))")
    combos: list[dict] = [{}]
    for v, vals in specs:
        combos = [{**c, v: x} for c in combos for x in vals]
    return combos


def margins(ds: Dataset, cmd: Command) -> Result:
    e = _est(ds)
    kind = e["kind"]
    idx = e["sample"].intersection(ds.df.index)
    base = ds.df.loc[idx]
    base = base[_complete(ds, e, base)]
    if len(base) == 0:
        raise StataError("the estimation sample is no longer in the data")
    w = None
    if e.get("w") is not None and len(e["w"]) == len(e["sample"]):
        wser = pd.Series(e["w"], index=e["sample"])
        w = wser.loc[base.index].to_numpy()
    wts = np.ones(len(base)) if w is None else w / w.sum() * len(base)
    X0 = design(ds, e, base)
    colmeans = (X0 * wts[:, None]).mean(axis=0)
    terms_vars = {p[1]: p[0] for t in e["terms"] for p in t.parts}
    over_vars = [resolve_var(v, ds.df) for v in re.findall(r"[A-Za-z_][\w.]*", cmd.args.replace("i.", ""))] if cmd.args.strip() else []
    for v in over_vars:
        if v not in terms_vars:
            raise StataError(f"{v} is not in the model")
        if terms_vars[v] != "i":
            raise StataError(f"{v} is continuous; use margins, at({v}=(...)) or margins, dydx({v})")
    atmeans = bool(cmd.opt("atmeans"))
    at = cmd.opt("at")
    at_list = _parse_at(ds, at) if isinstance(at, str) else [{}]
    dydx = cmd.opt("dydx")
    b, V = e["b"], e["V"]
    keys = e["keep"]

    def frame_for(setting: dict) -> pd.DataFrame:
        f = base.copy()
        for v, val in setting.items():
            f[v] = val
        return f

    def Xfor(setting: dict) -> np.ndarray:
        X = design(ds, e, frame_for(setting))
        if atmeans:  # hold every other covariate at its mean (of each design column, as Stata does)
            fixed = set(setting)
            for j, (g, lab) in enumerate(keys):
                involved = set(g.replace("c.", "").split("#")) if g else {lab.replace("c.", "")}
                if not (involved & fixed):
                    X[:, j] = colmeans[j]
        return X

    def avg_pred(bb: np.ndarray, X: np.ndarray) -> float:
        return float((wts * _link(kind, X @ bb)).sum() / wts.sum())

    def grad(fun) -> np.ndarray:
        g = np.zeros(len(b))
        for j in range(len(b)):
            h = 1e-6 * max(1.0, abs(b[j]))
            bp, bm = b.copy(), b.copy()
            bp[j] += h
            bm[j] -= h
            g[j] = (fun(bp) - fun(bm)) / (2 * h)
        return g

    rows: list[tuple[str, str, float, float]] = []  # (group heading, label, estimate, se)
    if isinstance(dydx, str):
        title = "Average marginal effects" if not atmeans else "Conditional marginal effects"
        dvars = [v for v, k in terms_vars.items()] if dydx.strip() in ("*", "_all") else [resolve_var(v.replace("i.", "").replace("c.", ""), ds.df) for v in dydx.split()]
        for v in dvars:
            if v not in terms_vars:
                raise StataError(f"{v} is not in the model")
            for setting in at_list:
                if terms_vars[v] == "c":
                    sd = float(base[v].astype(float).std() or 1)
                    hstep = 1e-4 * sd

                    def fun(bb, setting=setting, v=v, hstep=hstep):
                        up = {**setting, v: base[v].astype(float) + hstep} if v not in setting else {**setting, v: setting[v] + hstep}
                        dn = {**setting, v: base[v].astype(float) - hstep} if v not in setting else {**setting, v: setting[v] - hstep}
                        return (avg_pred(bb, Xfor(up)) - avg_pred(bb, Xfor(dn))) / (2 * hstep)

                    est = fun(b)
                    g = grad(fun)
                    rows.append(("", v, est, math.sqrt(max(g @ V @ g, 0))))
                else:
                    levels, bl = e["levels"][v]
                    for lv in levels:
                        if lv == bl:
                            continue

                        def fun(bb, lv=lv, setting=setting, v=v, bl=bl):
                            return avg_pred(bb, Xfor({**setting, v: lv})) - avg_pred(bb, Xfor({**setting, v: bl}))

                        g = grad(fun)
                        rows.append((v, level_label(ds, v, lv), fun(b), math.sqrt(max(g @ V @ g, 0))))
        col_head = "dy/dx"
    else:
        title = "Adjusted predictions" if atmeans or (isinstance(at, str) and not over_vars and False) else "Predictive margins"
        if atmeans:
            title = "Adjusted predictions"
        cells = [{}]
        for v in over_vars:
            levels, _ = e["levels"][v]
            cells = [{**c, v: lv} for c in cells for lv in levels]
        for ai, setting in enumerate(at_list):
            for cell in cells:
                full = {**setting, **cell}

                def fun(bb, full=full):
                    return avg_pred(bb, Xfor(full))

                g = grad(fun)
                label = "#".join(level_label(ds, v, cell[v]) for v in over_vars) if over_vars else ""
                head = "#".join(over_vars) if over_vars else ""
                if len(at_list) > 1:
                    head = f"_at{'#' + head if head else ''}"
                    label = f"{ai + 1}" + (f"#{label}" if label else "")
                rows.append((head, label or "_cons", fun(b), math.sqrt(max(g @ V @ g, 0))))
        col_head = "Margin"
    use_t = kind == "regress" and e.get("df_r")
    stat_name = "t" if use_t else "z"
    crit = st.t.ppf(0.975, e["df_r"]) if use_t else 1.959963984540054
    expr_txt = {"regress": "Linear prediction, predict()", "poisson": "Predicted number of events, predict()"}.get(kind, f"Pr({e['y']}), predict()")
    lines = [f"{title:<56}Number of obs = {len(base):>6,}", f"Model VCE: {'Robust' if e.get('robust') else ('OLS' if kind == 'regress' else 'OIM')}", "", f"Expression: {expr_txt}"]
    if isinstance(dydx, str):
        lines.append(f"dy/dx wrt:  {' '.join(dvars)}")
    if len(at_list) > 1 or (at_list and at_list[0]):
        lines.append("")
        for i, setting in enumerate(at_list):
            desc = "  ".join(f"{v} = {fmt.g(val).strip()}" for v, val in setting.items())
            lines.append(f"{(str(i + 1) + '._at: ') if len(at_list) > 1 else 'At: '}{desc}")
    if atmeans:
        lines.append("At: all other covariates held at their means")
    lines += ["", RULE, f"{'':12} |{'Delta-method':>24}", f"{'':12} |{col_head:>11}   std. err.{stat_name:>7}    P>|{stat_name}|     [95% conf. interval]", fmt.rule(13, 64)]
    apa_rows, summ, last = [], [], None
    plot_points = []
    for head, label, est, se in rows:
        if head and head != last:
            lines.append(f"{fmt.name(head)} |")
        last = head or None
        z = est / se if se else float("nan")
        p = float(2 * (st.t.sf(abs(z), e["df_r"]) if use_t else st.norm.sf(abs(z))))
        lo, hi = est - crit * se, est + crit * se
        lines.append(f"{fmt.name(label)} |{fmt.g(est, 11)}{fmt.g(se, 11)}{z:>9.2f}{fmt.p(p)}{fmt.g(lo, 13)}{fmt.g(hi, 12)}")
        apa_rows.append([(f"{head}: " if head and head != "_at" else "") + label, fmt.apa_num(est, 3 if abs(est) < 1 else 2), fmt.apa_num(se, 3), f"[{fmt.apa_num(lo, 3 if abs(est) < 1 else 2)}, {fmt.apa_num(hi, 3 if abs(est) < 1 else 2)}]", fmt.apa_p(p)])
        summ.append({"term": f"{head}={label}" if head else label, "estimate": est, "se": se, "p": p, "ci": [lo, hi]})
        plot_points.append((label, est, lo, hi))
    lines.append(RULE)
    ds.last_margins = {"title": title, "points": plot_points, "ylabel": col_head if col_head != "Margin" else ("Linear prediction" if kind == "regress" else ("Predicted count" if kind == "poisson" else f"Pr({e['y']})")), "xlabel": (" × ".join(over_vars) if over_vars else (", ".join(at_list[0].keys()) if len(at_list) > 1 else "")), "at": at_list if len(at_list) > 1 else None}
    t = Table(f"{title}: {nice(ds, e['y'])}", ["Term", "dy/dx" if col_head == "dy/dx" else "Estimate", "SE", "95% CI", "p"], apa_rows, note=f"N = {len(base):,}. Delta-method standard errors." + (" Covariates held at their means." if atmeans else ""))
    return Result(log="\n".join(lines), tables=[t], summary={"margins": title, "rows": summ})
