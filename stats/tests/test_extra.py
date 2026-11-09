"""The commands added in engine/extra.py, checked against known answers."""

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import statsmodels.api as sm

from engine.data import Dataset, load_bytes
from engine.run import run_commands, run_line

SAMPLE = next(Path(__file__).resolve().parent.parent.joinpath("sample").glob("*.dta"))


@pytest.fixture()
def ds():
    d = load_bytes(SAMPLE.read_bytes(), "s.dta")
    run_line(d, "mvdecode income, mv(99999)")
    return d


def ok(ds, *lines):
    out = run_commands(ds, list(lines))
    for r in out:
        assert r["ok"], f'{r["command"]}: {r.get("error")}'
    return out[-1]


def test_test_and_lincom_match_the_regression(ds):
    reg = ok(ds, "regress wellbeing age hhsize i.region")
    t_age = next(c for c in reg["summary"]["coefs"] if c["term"] == "age")
    one = ok(ds, "test age")
    assert one["summary"]["F"] == pytest.approx(t_age["t"] ** 2, rel=1e-6)
    lc = ok(ds, "lincom age")
    assert lc["summary"]["estimate"] == pytest.approx(t_age["b"], rel=1e-9)
    joint = ok(ds, "test 2.region 3.region 4.region 5.region")
    assert joint["summary"]["df1"] == 4
    assert ok(ds, "display _b[age]*10")["summary"]["value"] == pytest.approx(10 * t_age["b"])


def test_glm_binomial_logit_equals_logit(ds):
    lg = ok(ds, "logit food_insecure age hhsize")
    gm = ok(ds, "glm food_insecure age hhsize, family(binomial) link(logit)")
    for a, b in zip(lg["summary"]["coefs"], gm["summary"]["coefs"]):
        assert a["b"] == pytest.approx(b["b"], rel=1e-5)


def test_tobit_without_censored_rows_is_ols(ds):
    reg = ok(ds, "regress wellbeing age hhsize")
    tb = ok(ds, "tobit wellbeing age hhsize, ll(-1000)")
    for a, b in zip(reg["summary"]["coefs"], tb["summary"]["coefs"]):
        assert a["b"] == pytest.approx(b["b"], rel=1e-3, abs=1e-4)


def test_qreg_median(ds):
    r = ok(ds, "qreg wellbeing age i.urban")
    assert r["summary"]["quantile"] == 0.5 and 0 < r["summary"]["pseudo_r2"] < 1


@pytest.mark.parametrize("line,n", [
    ("power twomeans 0 0.5, sd(1)", 128),
    ("power twoproportions .5 .6", 776),
    ("power onemean 0 .5, sd(1)", 34),
    ("power pairedmeans 0 .5, sddiff(1)", 34),
    ("power oneproportion .5 .6", 194),
])
def test_power_matches_stata(ds, line, n):
    assert ok(ds, line)["summary"]["n"] == n


def test_power_for_a_given_n(ds):
    assert ok(ds, "power twomeans 0 0.5, sd(1) n(100)")["summary"]["power"] == pytest.approx(0.6969, abs=5e-4)


def test_mediation_indirect_is_a_times_b(ds):
    r = ok(ds, "mediate (wellbeing age) (income age) (urban), reps(100)")
    s = r["summary"]
    assert s["nie"] == pytest.approx(s["a"] * s["b"])
    assert s["te"] == pytest.approx(s["nie"] + s["nde"])


def test_pca_scores_and_kmeans(ds):
    r = ok(ds, "pca age hhsize wellbeing")
    assert sum(r["summary"]["eigenvalues"]) == pytest.approx(3)
    ok(ds, "predict pc1 pc2")
    assert ds.df["pc1"].notna().sum() > 500
    assert abs(ds.df["pc1"].corr(ds.df["pc2"])) < 1e-6  # components are uncorrelated
    ok(ds, "cluster kmeans age wellbeing, k(3) name(grp) standardize")
    assert set(ds.df["grp"].dropna().unique()) == {1.0, 2.0, 3.0}


def test_tabstat_misstable_duplicates(ds):
    r = ok(ds, "tabstat age wellbeing, stats(mean sd n) by(urban)")
    assert len(r["tables"][0]["rows"]) == 6  # 2 variables x (2 groups + total)
    m = ok(ds, "misstable summarize")
    assert "wellbeing" in m["log"]
    ds.df = pd.concat([ds.df, ds.df.iloc[[0, 1]]], ignore_index=True)
    assert ok(ds, "duplicates drop")["summary"]["dropped"] == 2


def test_collapse_and_reshape_round_trip():
    d = Dataset(pd.DataFrame({"id": [1, 1, 2, 2], "year": [2020, 2021, 2020, 2021], "inc": [10.0, 12.0, 20.0, 25.0], "g": [1, 1, 2, 2]}))
    ok(d, "reshape wide inc, i(id) j(year)")
    assert list(d.df.columns[:3]) == ["id", "inc2020", "inc2021"] and len(d.df) == 2
    ok(d, "reshape long inc, i(id) j(year)")
    assert len(d.df) == 4 and d.df.loc[d.df["year"] == 2021, "inc"].tolist() == [12.0, 25.0]
    ok(d, "collapse (mean) inc (max) top=inc, by(id)")
    assert d.df["inc"].tolist() == [11.0, 22.5] and d.df["top"].tolist() == [12.0, 25.0]


def test_new_functions(ds):
    assert ok(ds, "display normal(1.96)")["summary"]["value"] == pytest.approx(0.9750021, abs=1e-6)
    assert ok(ds, "display invttail(10, .025)")["summary"]["value"] == pytest.approx(2.228139, abs=1e-5)
    d = Dataset(pd.DataFrame({"s": ["  Kumasi  north", "accra"]}))
    ok(d, 'generate t = proper(itrim(strtrim(s)))', 'generate first = word(t, 1)', 'generate has = regexm(s, "north")')
    assert d.df["t"].tolist() == ["Kumasi North", "Accra"] and d.df["first"].tolist() == ["Kumasi", "Accra"] and d.df["has"].tolist() == [1.0, 0.0]


def test_graphs(ds):
    assert ok(ds, "kdensity wellbeing, normal")["images"]
    assert ok(ds, "qnorm wellbeing")["images"]


def test_survey_scales_and_prepare_fixes(tmp_path):
    import pyreadstat
    from engine.data import load_path

    df = pd.DataFrame({
        "note": [""] * 6,
        "q1": ["Strongly agree", "Agree", "Disagree", "Neutral", "Agree", "Strongly agree"],
        "q2": ["agree", "strongly_disagree", "agree", "neutral", "strongly_agree", "agree"],
        "freq": ["Never", "Often", "Sometimes", "Always", "Often", "Never"],
        "kids": ["1", "2", "10", "0", "3", "1"],
        "gender": ["Male", "Female", "Male", "Female", "Male", "Female"],
    })
    p = tmp_path / "kobo.dta"
    pyreadstat.write_dta(df, str(p))
    d = load_path(str(p), "kobo.dta")
    fixes = d.settings["import_fixes"]
    assert fixes[0] == "drop note" and fixes[1] == "destring kids, replace"
    assert 'label define q1_lb 2 "Disagree" 3 "Neutral" 4 "Agree" 5 "Strongly agree"' in fixes
    ok(d, *fixes)
    # natural order, and scale positions kept even when a point is unused
    assert d.df["q1_n"].tolist() == [5, 4, 2, 3, 4, 5]
    assert d.df["q2_n"].tolist() == [4, 1, 4, 3, 5, 4]
    assert d.df["freq_n"].tolist() == [1, 4, 3, 5, 4, 1]
    assert d.df["gender_n"].tolist() == [2, 1, 2, 1, 2, 1]  # not a scale: alphabetical, as Stata's encode
    assert is_num(d.df["kids"])
    r = ok(d, "alpha q1_n q2_n, generate(attitude) asis")
    assert d.df["attitude"].iloc[0] == pytest.approx(4.5)
    # a CSV gets the same natural order on import
    c = load_bytes(df.to_csv(index=False).encode(), "kobo.csv")
    assert c.value_labels["q1"] == {2: "Disagree", 3: "Neutral", 4: "Agree", 5: "Strongly agree"}
    assert c.settings["import_fixes"] == ["drop note"]


def is_num(s):
    return pd.api.types.is_numeric_dtype(s)
