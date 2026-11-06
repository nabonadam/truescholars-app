"""Every analysis checked against an independent calculation, plus Stata's conventions."""

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import statsmodels.formula.api as smf
from scipy import stats

from engine.data import Dataset, StataError, load_bytes
from engine.expr import condition, evaluate
from engine.fmt import g
from engine.run import apply_history, run_commands, run_line
from engine.statcmds import stata_pctile
from engine.syntax import parse

SAMPLE = Path(__file__).resolve().parents[1] / "sample" / "ghana_households_simulated.dta"


@pytest.fixture()
def ds():
    d = load_bytes(SAMPLE.read_bytes(), "s.dta")
    run_line(d, "mvdecode income, mv(99999)")
    return d


def one(ds, line):
    r = run_commands(ds, [line])[0]
    assert r["ok"], r.get("error")
    return r


# ── formats and syntax ──
def test_stata_number_format():
    assert [g(v).strip() for v in [-0.0065879234, 41.679703, 2.1655472, 0.0738724, -0.00099565, 74]] == ["-.0065879", "41.6797", "2.165547", ".0738724", "-.0009957", "74"]


def test_parse_command_line():
    c = parse("by urban: reg wellbeing age i.educ if age >= 18 in 1/100, vce(cluster region) beta")
    assert (c.name, c.by, c.args, c.if_, c.in_) == ("regress", ["urban"], "wellbeing age i.educ", "age >= 18", (1, 100))
    assert c.opt("vce") == "cluster region" and c.opt("beta") is True
    assert parse("su income, d").opt("detail") is True
    with pytest.raises(StataError, match="unrecognized"):
        parse("foo bar")


def test_missing_is_greater_than_everything(ds):
    # Stata: `if income > 2000` includes missing incomes
    n_missing = int(ds.df["income"].isna().sum())
    above = int((ds.df["income"] > 2000).sum())
    assert one(ds, "count if income > 2000")["summary"]["count"] == above + n_missing
    assert one(ds, "count if income > 2000 & !missing(income)")["summary"]["count"] == above


def test_expressions(ds):
    assert evaluate("inlist(region, 1, 3)", ds.df).sum() == ds.df["region"].isin([1, 3]).sum()
    assert math.isclose(evaluate("ln(income)", ds.df).mean(), np.log(ds.df["income"]).mean())
    assert condition("inrange(age, 18, 29)", ds.df).sum() == ds.df["age"].between(18, 29).sum()
    with pytest.raises(StataError, match="=="):
        evaluate("age = 3", ds.df)


# ── data commands ──
def test_generate_replace_recode_label(ds):
    one(ds, "gen young = age < 30")
    assert ds.df["young"].sum() == (ds.df["age"] < 30).sum()
    r = one(ds, "replace young = . if missing(income)")
    assert "real change" in r["log"]
    one(ds, 'recode educ (0 1 = 0 "Basic or none") (2/4 = 1 "Secondary+"), gen(edu2)')
    assert ds.value_label("edu2", 1) == "Secondary+"
    assert ds.df["edu2"].sum() == (ds.df["educ"] >= 2).sum()
    one(ds, 'label variable edu2 "Secondary or higher"')
    assert ds.label("edu2") == "Secondary or higher"
    with pytest.raises(StataError, match="already defined"):
        run_line(ds, "gen age = 1")


def test_history_replays_like_a_dofile():
    base = load_bytes(SAMPLE.read_bytes(), "s.dta")
    d = apply_history(base, ["mvdecode income, mv(99999)", "gen lninc = ln(income)", "keep if urban == 1"])
    assert "lninc" in d.df and d.df["urban"].eq(1).all() and "lninc" not in base.df


def test_stops_at_first_error(ds):
    out = run_commands(ds, ["summarize age", "regress nosuchvar age", "summarize hhsize"])
    assert [o["ok"] for o in out] == [True, False, False] and out[2]["skipped"]


# ── analyses vs independent calculations ──
def test_summarize_and_stata_percentiles(ds):
    s = one(ds, "summarize income, detail")["summary"]["summarize"][0]
    x = ds.df["income"].dropna().to_numpy()
    assert math.isclose(s["mean"], x.mean()) and math.isclose(s["sd"], x.std(ddof=1))
    # Stata's definition: n*p/100 integer -> average of neighbours
    assert stata_pctile(np.array([1, 2, 3, 4]), 50) == 2.5 and stata_pctile(np.array([1, 2, 3, 4, 5]), 50) == 3


def test_crosstab_chi2(ds):
    s = one(ds, "tab region food_insecure, chi2")["summary"]
    ct = pd.crosstab(ds.df["region"], ds.df["food_insecure"])
    chi2, p, dof, _ = stats.chi2_contingency(ct, correction=False)
    assert math.isclose(s["chi2"], chi2) and math.isclose(s["p"], p) and s["df"] == dof


def test_ttests(ds):
    s = one(ds, "ttest income, by(urban)")["summary"]
    a = ds.df.loc[ds.df.urban == 0, "income"].dropna()
    b = ds.df.loc[ds.df.urban == 1, "income"].dropna()
    ref = stats.ttest_ind(a, b)
    assert math.isclose(s["t"], ref.statistic) and math.isclose(s["p"], ref.pvalue)
    w = one(ds, "ttest income, by(urban) unequal")["summary"]
    refw = stats.ttest_ind(a, b, equal_var=False)
    assert math.isclose(w["t"], refw.statistic) and math.isclose(w["p"], refw.pvalue)


def test_oneway_matches_f_oneway(ds):
    s = one(ds, "oneway wellbeing educ")["summary"]
    d = ds.df.dropna(subset=["wellbeing"])
    ref = stats.f_oneway(*[d.loc[d.educ == k, "wellbeing"] for k in sorted(d.educ.unique())])
    assert math.isclose(s["F"], ref.statistic) and math.isclose(s["p"], ref.pvalue, rel_tol=1e-6, abs_tol=1e-300)


def test_regress_matches_statsmodels(ds):
    s = one(ds, "regress wellbeing age i.educ i.urban")["summary"]
    ref = smf.ols("wellbeing ~ age + C(educ) + C(urban)", data=ds.df).fit()
    assert math.isclose(s["r2"], ref.rsquared) and s["n"] == int(ref.nobs)
    assert math.isclose(s["coefs"][0]["b"], ref.params["age"]) and math.isclose(s["coefs"][0]["se"], ref.bse["age"])
    rob = one(ds, "regress wellbeing age i.educ, robust")["summary"]
    ref_r = smf.ols("wellbeing ~ age + C(educ)", data=ds.df).fit(cov_type="HC1")
    assert math.isclose(rob["coefs"][0]["se"], ref_r.bse["age"])  # Stata's robust = HC1


def test_logit_and_odds_ratios(ds):
    s = one(ds, "logistic food_insecure income hhsize i.urban")["summary"]
    ref = smf.logit("food_insecure ~ income + hhsize + C(urban)", data=ds.df).fit(disp=0)
    assert math.isclose(s["coefs"][1]["b"], ref.params["hhsize"], rel_tol=1e-6)
    assert math.isclose(s["coefs"][1]["exp_b"], math.exp(ref.params["hhsize"]), rel_tol=1e-6)
    assert math.isclose(s["pseudo_r2"], ref.prsquared, rel_tol=1e-6)


def test_correlations_and_rank_tests(ds):
    pairs = one(ds, "pwcorr age income")["summary"]["pairs"]
    d = ds.df[["age", "income"]].dropna()
    assert math.isclose(pairs[0]["r"], stats.pearsonr(d.age, d.income)[0])
    s = one(ds, "ranksum income, by(urban)")["summary"]
    a = ds.df.loc[ds.df.urban == 0, "income"].dropna()
    b = ds.df.loc[ds.df.urban == 1, "income"].dropna()
    ref = stats.mannwhitneyu(a, b, alternative="two-sided", method="asymptotic", use_continuity=False)
    assert math.isclose(s["p"], ref.pvalue, rel_tol=1e-6)
    k = one(ds, "kwallis wellbeing, by(region)")["summary"]
    d = ds.df.dropna(subset=["wellbeing"])
    assert math.isclose(k["chi2"], stats.kruskal(*[d.loc[d.region == r, "wellbeing"] for r in sorted(d.region.unique())]).statistic)


def test_anova_type3(ds):
    s = one(ds, "anova wellbeing educ urban")["summary"]
    assert s["n"] == int(ds.df["wellbeing"].notna().sum()) and len(s["effects"]) == 2


def test_every_result_has_a_table_or_log(ds):
    for line in ["describe", "codebook region", "tab1 region urban", "tab2 region urban sex", "correlate age income hhsize", "spearman age income", "signrank wellbeing = 50", "probit food_insecure hhsize", "poisson hhsize age, irr", "by urban: tab sex", "ttest wellbeing == 55"]:
        r = one(ds, line)
        assert r["log"].strip(), line


def test_load_csv_and_clean_names():
    d = load_bytes(b"Age (years),Monthly Income,group\n30,1000,a\n41,,b\n", "x.csv")
    assert list(d.df.columns) == ["Age__years_", "Monthly_Income", "group"]
    assert d.df["Monthly_Income"].isna().sum() == 1


def test_csv_becomes_a_stata_dataset():
    rows = "\n".join(f"{i};{'Male' if i % 2 else 'Female'};{['Public', 'Private', 'Mission'][i % 3]};{50 + i % 9},5;note {i};2024-03-{1 + i % 28:02d}" for i in range(1, 41))
    d = load_bytes(("ID;Gender;School type;Score;Comment;Survey date\n" + rows).encode(), "x.csv")  # semicolons, decimal commas
    assert d.value_labels["Gender"] == {1: "Female", 2: "Male"} and d.value_label("School_type", 3) == "Public"
    assert d.label("School_type") == "School type" and d.df["Score"].iloc[0] == 51.5
    assert not pd.api.types.is_numeric_dtype(d.df["Comment"]) and not pd.api.types.is_numeric_dtype(d.df["Survey_date"])
    assert any("labelled categories" in n for n in d.import_notes)
    assert one(d, "regress Score i.Gender i.School_type")["summary"]["n"] == 40  # no encode step needed


def test_encode_and_destring_for_text_data():
    names = "\n".join(f"Person {i},\"{i},200\"" for i in range(8))
    d = load_bytes(("name,amt\n" + names).encode(), "x.csv")
    assert not pd.api.types.is_numeric_dtype(d.df["name"])  # free text stays text
    one(d, "encode name, gen(name_n)")
    assert d.value_label("name_n", 1) == "Person 0"
    assert "replaced" in one(d, "destring amt, replace")["log"] and d.df["amt"].tolist()[:2] == [200, 1200]
    r = run_commands(d, ["encode name_n, gen(z)"])[0]
    assert not r["ok"] and "not a string" in r["error"]
    r = run_commands(d, ["summarize amt if"])[0]
    assert not r["ok"] and "invalid syntax" in r["error"]
