"""The political-analysis curriculum: weights, data preparation, tests, post-estimation, graphs.
Each result is checked against an independent calculation (statsmodels / scipy)."""

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.outliers_influence import variance_inflation_factor

from engine.data import Dataset, load_bytes
from engine.run import run_commands

SAMPLE = Path(__file__).resolve().parents[1] / "sample" / "ghana_households_simulated.dta"


@pytest.fixture()
def ds():
    d = load_bytes(SAMPLE.read_bytes(), "s.dta")
    run_commands(d, ["mvdecode income, mv(99999)", "gen lninc = ln(income)"])
    return d


@pytest.fixture()
def wd():
    rng = np.random.default_rng(5)
    n = 400
    df = pd.DataFrame({"x": rng.normal(size=n), "g": rng.integers(1, 4, n).astype(float), "w": rng.uniform(0.2, 3, n), "f": rng.integers(1, 4, n).astype(float)})
    df["y"] = 2 + 1.5 * df.x + 0.5 * (df.g == 2) + rng.normal(size=n)
    df["b"] = (rng.uniform(size=n) < 1 / (1 + np.exp(-(0.3 + 0.9 * df.x)))).astype(float)
    return Dataset(df)


def one(d, line):
    r = run_commands(d, [line])[0]
    assert r["ok"], r.get("error")
    return r


def close(a, b, tol=1e-8):
    return math.isclose(a, b, rel_tol=tol, abs_tol=1e-12)


# ── weights ──
def test_weighted_summarize_and_tab(wd):
    df = wd.df
    s = one(wd, "summarize y [aw=w]")["summary"]["summarize"][0]
    w = df.w * len(df) / df.w.sum()
    m = (w * df.y).sum() / w.sum()
    assert close(s["mean"], m) and close(s["sd"], math.sqrt((w * (df.y - m) ** 2).sum() / (len(df) - 1)))
    rep = np.repeat(df.y.to_numpy(), df.f.astype(int))
    s = one(wd, "summarize y [fw=f]")["summary"]["summarize"][0]
    assert s["n"] == len(rep) and close(s["sd"], rep.std(ddof=1))
    chi = one(wd, "tab g b [aw=w], chi2")["summary"]["chi2"]
    assert close(chi, stats.chi2_contingency(pd.crosstab(df.g, df.b, values=w, aggfunc="sum"), correction=False)[0])
    assert "pweights not allowed" in run_commands(wd, ["summarize y [pw=w]"])[0]["error"]


def test_weighted_regressions(wd):
    df = wd.df
    n = len(df)
    X = np.column_stack([df.x, (df.g == 2) * 1.0, (df.g == 3) * 1.0, np.ones(n)])
    aw = one(wd, "regress y x i.g [aw=w]")["summary"]
    ref = sm.WLS(df.y.to_numpy(), X, weights=(df.w * n / df.w.sum()).to_numpy()).fit()
    assert close(aw["coefs"][0]["se"], ref.bse[0]) and close(aw["r2"], ref.rsquared)
    pw = one(wd, "regress y x i.g [pw=w]")["summary"]
    assert close(pw["coefs"][0]["se"], sm.WLS(df.y.to_numpy(), X, weights=df.w.to_numpy()).fit(cov_type="HC1").bse[0]) and pw["robust"]
    rep = np.repeat(np.arange(n), df.f.astype(int))
    fw = one(wd, "regress y x i.g [fw=f]")["summary"]
    assert fw["n"] == len(rep) and close(fw["coefs"][0]["se"], sm.OLS(df.y.to_numpy()[rep], X[rep]).fit().bse[0])
    lf = one(wd, "logit b x [fw=f]")["summary"]
    Xl = np.column_stack([df.x, np.ones(n)])
    rl = sm.Logit(df.b.to_numpy()[rep], Xl[rep]).fit(disp=0)
    assert close(lf["coefs"][0]["b"], rl.params[0], 1e-6) and close(lf["coefs"][0]["se"], rl.bse[0], 1e-6)
    assert "aweights not allowed" in run_commands(wd, ["logit b x [aw=w]"])[0]["error"]


def test_weighted_mean_and_correlation(wd):
    df = wd.df
    r = one(wd, "correlate x y [aw=w]")["summary"]["pairs"][0]["r"]
    c = np.cov(df.x, df.y, aweights=df.w)
    assert close(r, c[0, 1] / math.sqrt(c[0, 0] * c[1, 1]))
    m = one(wd, "mean y [pw=w], over(g)")["summary"]["means"][0]
    g = df[df.g == 1]
    est = (g.w * g.y).sum() / g.w.sum()
    se = sm.WLS(g.y.to_numpy(), np.ones(len(g)), weights=g.w.to_numpy()).fit(cov_type="HC1").bse[0]
    assert close(m["mean"], est) and close(m["se"], se)  # linearized = robust intercept-only WLS


# ── data preparation ──
def test_egen_xtile_dummies_and_seed(ds):
    one(ds, "egen z = std(income)")
    assert abs(ds.df.z.mean()) < 1e-9 and close(ds.df.z.std(), 1)
    one(ds, "bysort region: egen m = mean(income)")
    assert close(ds.df.loc[ds.df.region == 1, "m"].iloc[0], ds.df.loc[ds.df.region == 1, "income"].mean())
    one(ds, "egen idx = rowmean(age hhsize)")
    assert close(ds.df.idx.iloc[0], ds.df[["age", "hhsize"]].iloc[0].mean())
    one(ds, "xtile q = age, nquantiles(4)")
    assert sorted(ds.df.q.dropna().unique()) == [1, 2, 3, 4]
    one(ds, "tab region, gen(reg)")
    assert ds.df.reg1.sum() == (ds.df.region == 1).sum() and ds.label("reg1") == "region==Greater Accra"
    a = run_commands(ds.copy(), ["set seed 7", "gen u = runiform()"])
    d2 = ds.copy()
    run_commands(d2, ["set seed 7", "gen u = runiform()"])
    assert a[1]["ok"] and "u" in d2.df


# ── tests and measures ──
def test_prtest_ci_and_association(ds):
    df = ds.df
    s = one(ds, "prtest food_insecure, by(urban)")["summary"]
    a, b = df[df.urban == 0].food_insecure, df[df.urban == 1].food_insecure
    pp = (a.sum() + b.sum()) / (len(a) + len(b))
    z = (a.mean() - b.mean()) / math.sqrt(pp * (1 - pp) * (1 / len(a) + 1 / len(b)))
    assert close(s["z"], z)
    c = one(ds, "ci proportions farm")["summary"]["rows"][0]
    lo = stats.beta.ppf(0.025, df.farm.sum(), len(df) - df.farm.sum() + 1)
    assert close(c["ci"][0], lo)
    t = one(ds, "tab educ food_insecure, gamma taub")["summary"]
    assert close(t["taub"], stats.kendalltau(df.educ, df.food_insecure, variant="b").statistic)
    assert close(one(ds, "somersd educ food_insecure")["summary"]["somers_d"], stats.somersd(df.educ, df.food_insecure).statistic)
    ms = one(ds, "tab urban, summarize(wellbeing)")["summary"]["groups"]
    assert close(ms[0]["mean"], df[df.urban == 0].wellbeing.mean())


# ── after a model ──
def test_predict_estat_margins(ds):
    one(ds, "regress wellbeing age hhsize lninc")
    s = ds.df.dropna(subset=["wellbeing", "age", "hhsize", "lninc"])
    ols = smf.ols("wellbeing ~ age + hhsize + lninc", s).fit()
    bp = one(ds, "estat hettest")["summary"]["chi2"]
    assert close(bp, het_breuschpagan(ols.resid, np.column_stack([np.ones(len(s)), ols.fittedvalues]), robust=False)[0])
    vif = one(ds, "estat vif")["summary"]["vif"]
    X = sm.add_constant(s[["age", "hhsize", "lninc"]]).to_numpy()
    assert close(vif["age"], variance_inflation_factor(X, 1))
    one(ds, "predict rs, rstandard")
    assert close(ds.df.loc[s.index[0], "rs"], ols.get_influence().resid_studentized_internal[0])
    ic = one(ds, "estat ic")["summary"]
    assert close(ic["aic"], ols.aic)
    one(ds, "logit food_insecure lninc age i.urban")
    m = smf.logit("food_insecure ~ lninc + age + C(urban)", data=ds.df).fit(disp=0)
    ame = one(ds, "margins, dydx(lninc)")["summary"]["rows"][0]
    ref = m.get_margeff(at="overall").summary_frame().loc["lninc"]
    assert close(ame["estimate"], ref["dy/dx"], 1e-6) and close(ame["se"], ref["Std. Err."], 1e-4)
    pm = one(ds, "margins urban")["summary"]["rows"]
    dd = ds.df.dropna(subset=["lninc", "age", "urban", "food_insecure"]).copy()
    dd["urban"] = 1
    assert close(pm[1]["estimate"], m.predict(dd).mean(), 1e-9)
    assert one(ds, "margins, at(age=(20(20)60))")["summary"]["rows"][2]["term"] == "_at=3"


def test_estimation_survives_between_requests(ds):
    """predict in a later request: the history replays the model, so the do-file reproduces it."""
    from engine.run import apply_history

    one(ds, "regress wellbeing age")
    d2 = apply_history(load_bytes(SAMPLE.read_bytes(), "s.dta"), ["regress wellbeing age", "predict yhat"])
    assert "yhat" in d2.df


# ── graphs ──
def test_graphs_render(ds):
    for line in ["histogram wellbeing, normal", "graph bar (mean) wellbeing [aw=hhsize], over(region)", "graph box wellbeing, over(educ)", "scatter wellbeing age || lfit wellbeing age", "twoway (scatter wellbeing age) (lfitci wellbeing age), title(\"x\")", "graph bar, over(educ)"]:
        r = one(ds, line)
        assert r["images"] and len(r["images"][0]["png"]) > 5000, line
    one(ds, "logit food_insecure age i.urban")
    one(ds, "margins urban")
    assert one(ds, "marginsplot")["images"]
    assert one(ds, "lroc")["images"]
