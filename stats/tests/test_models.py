"""Survey, panel, multilevel, ordinal, count, IV, factor, survival and the open-analysis sandbox, against reference libraries."""

import warnings

import numpy as np
import pandas as pd
import pytest
import statsmodels.api as sm

from engine.data import Dataset, StataError
from engine.run import run_commands

warnings.filterwarnings("ignore")


def ok(rs):
    for r in rs:
        assert r["ok"], (r["command"], r.get("error"))
    return rs


@pytest.fixture(scope="module")
def panel():
    rng = np.random.default_rng(3)
    G, T = 50, 6
    n = G * T
    df = pd.DataFrame({"id": np.repeat(np.arange(G), T), "t": np.tile(np.arange(T), G)})
    a = rng.normal(size=G)[df.id]
    df["x"] = rng.normal(size=n) + 0.5 * a
    df["z"] = rng.normal(size=n)
    df["y"] = 1 + 2 * df.x - 0.5 * df.z + a + rng.normal(size=n)
    df["ord"] = pd.cut(df.y + rng.logistic(size=n), [-99, 0, 2, 4, 99], labels=False).astype(float)
    df["cat"] = rng.integers(1, 4, n).astype(float)
    df["cnt"] = rng.negative_binomial(2, 1 / (1 + np.exp(0.3 * df.x)), n).astype(float)
    df["inst"] = df.x + rng.normal(size=n)
    df["xe"] = df.inst + rng.normal(size=n)
    df["ye"] = 1 + 1.5 * df.xe + rng.normal(size=n)
    for j in range(5):
        df[f"q{j}"] = df.x + rng.normal(size=n) * (1 + j * 0.2)
    df["time"] = rng.exponential(np.exp(-0.5 * df.x))
    df["died"] = (rng.uniform(size=n) < 0.8).astype(float)
    df["grp"] = (df.z > 0).astype(float)
    return df


def test_survey_matches_linearization():
    rng = np.random.default_rng(11)
    n = 600
    df = pd.DataFrame({"strat": np.repeat([1, 2, 3], 200), "psu": np.repeat(np.arange(60), 10), "w": rng.uniform(0.5, 3, n), "x": rng.normal(size=n)})
    df["y"] = 1 + 0.8 * df.x + rng.normal(size=60)[df.psu] + rng.normal(size=n)
    r = ok(run_commands(Dataset(df), ["svyset psu [pw=w], strata(strat)", "svy: mean y"]))
    W = df.w.sum()
    m = (df.w * df.y).sum() / W
    tot = (df.w * (df.y - m) / W).groupby([df.strat, df.psu]).sum()
    v = sum(len(g) / (len(g) - 1) * ((g - g.mean()) ** 2).sum() for _, g in tot.groupby(level=0))
    row = r[1]["summary"]["rows"][0]
    assert row["estimate"] == pytest.approx(m) and row["se"] == pytest.approx(np.sqrt(v))
    r2 = ok(run_commands(Dataset(df.copy()), ["svyset psu [pw=w]", "svy: regress y x", "svy: logit b x" if False else "svy: proportion strat"]))
    ref = sm.WLS(df.y, sm.add_constant(df.x), weights=df.w).fit(cov_type="cluster", cov_kwds={"groups": df.psu})
    assert r2[1]["summary"]["coefs"][0]["se"] == pytest.approx(ref.bse.iloc[1] * np.sqrt((n - 2) / (n - 1)))


def test_xtreg_fe_re(panel):
    from linearmodels.panel import PanelOLS, RandomEffects

    r = ok(run_commands(Dataset(panel.copy()), ["xtset id t", "xtreg y x z, fe", "xtreg y x z, re", "xtreg y x z, fe vce(cluster id)"]))
    p = panel.set_index(["id", "t"])
    fe = PanelOLS(p.y, sm.add_constant(p[["x", "z"]]), entity_effects=True).fit()
    re_ = RandomEffects(p.y, sm.add_constant(p[["x", "z"]])).fit()
    assert r[1]["summary"]["coefs"][0]["b"] == pytest.approx(fe.params["x"]) and r[1]["summary"]["coefs"][0]["se"] == pytest.approx(fe.std_errors["x"])
    assert r[1]["summary"]["r2_within"] == pytest.approx(fe.rsquared_within)
    assert r[2]["summary"]["coefs"][0]["b"] == pytest.approx(re_.params["x"]) and r[2]["summary"]["coefs"][0]["se"] == pytest.approx(re_.std_errors["x"])
    assert "sigma_u" in r[1]["log"] and "F test that all u_i=0" in r[1]["log"] and "clusters in id" in r[3]["log"]


def test_mixed_ordered_mlogit_nbreg(panel):
    r = ok(run_commands(Dataset(panel.copy()), ["mixed y x z || id:", "mixed y x || id: x", "ologit ord x z", "oprobit ord x z", "mlogit cat x z, rrr", "nbreg cnt x, irr"]))
    mm = sm.MixedLM.from_formula("y ~ x + z", groups="id", data=panel).fit(reml=False)
    assert r[0]["summary"]["coefs"][0]["b"] == pytest.approx(mm.params["x"], rel=1e-4) and r[0]["summary"]["ll"] == pytest.approx(mm.llf, rel=1e-6)
    assert "var(_cons)" in r[0]["log"] and "chibar2(01)" in r[0]["log"] and "cov(x,_cons)" in r[1]["log"]
    from statsmodels.miscmodels.ordinal_model import OrderedModel

    om = OrderedModel(panel.ord, panel[["x", "z"]], distr="logit").fit(method="bfgs", disp=False)
    assert r[2]["summary"]["coefs"][0]["b"] == pytest.approx(om.params["x"], rel=1e-4) and "/cut3" in r[2]["log"]
    base = panel.cat.value_counts().idxmax()
    assert r[4]["summary"]["base"] == str(int(base)) or r[4]["summary"]["base"].startswith(str(int(base)))
    ref = sm.NegativeBinomial(panel.cnt, sm.add_constant(panel.x)).fit(disp=0)
    assert r[5]["summary"]["coefs"][0]["b"] == pytest.approx(ref.params["x"], rel=1e-4) and r[5]["summary"]["alpha"] == pytest.approx(ref.params["alpha"], rel=1e-3)


def test_ivregress_factor_alpha(panel):
    from linearmodels.iv import IV2SLS

    r = ok(run_commands(Dataset(panel.copy()), ["ivregress 2sls ye (xe = inst)", "factor q0-q4", "factor q0-q4, pcf factors(2)", "rotate", "alpha q0-q4, item"]))
    iv = IV2SLS(panel.ye, sm.add_constant(panel[[]].assign(c=1.0))[["c"]].rename(columns={"c": "const"}), panel.xe, panel.inst).fit(cov_type="unadjusted")
    assert r[0]["summary"]["coefs"][0]["b"] == pytest.approx(iv.params["xe"]) and r[0]["summary"]["coefs"][0]["se"] == pytest.approx(iv.std_errors["xe"])
    q = panel[[f"q{j}" for j in range(5)]]
    k = 5
    C = q.cov().to_numpy()
    a = k / (k - 1) * (1 - np.trace(C) / C.sum())
    assert r[4]["summary"]["alpha"] == pytest.approx(a)
    assert r[1]["summary"]["factors"] == 1 and "Uniqueness" in r[1]["log"] and "varimax" in r[3]["log"]


def test_survival(panel):
    from lifelines import CoxPHFitter
    from lifelines.statistics import logrank_test

    r = ok(run_commands(Dataset(panel.copy()), ["stset time, failure(died)", "stcox x z", "sts test grp", "sts graph, by(grp)"]))
    c = CoxPHFitter().fit(panel[["time", "died", "x", "z"]], "time", "died")
    assert r[1]["summary"]["coefs"][0]["b"] == pytest.approx(c.params_["x"], rel=1e-3)
    lr = logrank_test(panel.time[panel.grp == 0], panel.time[panel.grp == 1], panel.died[panel.grp == 0], panel.died[panel.grp == 1])
    assert r[2]["summary"]["chi2"] == pytest.approx(lr.test_statistic)
    assert len(r[3]["images"]) == 1
    bad = run_commands(Dataset(panel.copy()), ["stcox x"])
    assert not bad[0]["ok"] and "stset" in bad[0]["error"]


def test_sandbox_runs_and_blocks(panel):
    from engine.sandbox import run_python

    d = Dataset(panel[["y", "x", "z", "id"]].copy())
    out = run_python(d, "m = smf.ols('y ~ x + z', data=df).fit()\nshow(m, title='OLS')\nplt.scatter(df.x, df.y)\nresult(r2=m.rsquared)\nprint('done')", "ols")
    assert out["ok"] and out["tables"][0]["title"] == "OLS" and len(out["images"]) == 1 and "done" in out["log"] and out["summary"]["r2"] > 0.5
    for code in ["import os", "open('/etc/passwd')", "df.__class__", "pd.read_csv('x.csv')", "getattr(df, 'x')", "'{0}'.format(1)", "import socket"]:
        with pytest.raises(StataError):
            run_python(d, code)
    with pytest.raises(StataError, match="line 2"):
        run_python(d, "x = 1\ny = undefined_name")
