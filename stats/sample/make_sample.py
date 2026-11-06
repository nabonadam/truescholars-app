"""Builds the simulated Ghana household survey used for demos and tests (clearly labelled as simulated)."""

import numpy as np
import pandas as pd
import pyreadstat

rng = np.random.default_rng(2026)
n = 600
region = rng.choice([1, 2, 3, 4, 5], n, p=[0.24, 0.26, 0.2, 0.15, 0.15])
urban = (rng.random(n) < np.select([region == 1, region == 2], [0.85, 0.6], 0.3)).astype(int)
sex = rng.choice([1, 2], n, p=[0.48, 0.52])
age = np.clip(rng.normal(38, 12, n).round(), 18, 75)
educ = np.clip(rng.poisson(1.6 + 0.9 * urban - 0.4 * (region >= 3)), 0, 4)
hhsize = np.clip(rng.poisson(3.8 + 1.4 * (region >= 3)), 1, 14)
log_inc = 6.2 + 0.32 * educ + 0.38 * urban - 0.12 * (sex == 2) + 0.006 * (age - 38) - 0.25 * (region >= 3) + rng.normal(0, 0.55, n)
income = np.round(np.exp(log_inc), -1)
xb = 1.1 - 0.0016 * (income - 800) / 10 + 0.18 * hhsize - 0.35 * educ - 0.5 * urban + 0.6 * (region == 4)
food_insecure = (rng.random(n) < 1 / (1 + np.exp(-xb))).astype(int)
wellbeing = np.clip(np.round(52 + 5 * educ + 4 * urban - 9 * food_insecure + 0.004 * (income - 800) + rng.normal(0, 10, n)), 0, 100)
farm = (rng.random(n) < np.where(urban == 1, 0.15, 0.7)).astype(int)
df = pd.DataFrame({"hhid": np.arange(1001, 1001 + n), "region": region, "urban": urban, "sex": sex, "age": age, "educ": educ, "hhsize": hhsize, "income": income, "farm": farm, "food_insecure": food_insecure, "wellbeing": wellbeing})
df.loc[rng.choice(n, 14, replace=False), "income"] = 99999  # coded "don't know", as in real surveys
df.loc[rng.choice(n, 9, replace=False), "wellbeing"] = np.nan
labels = {
    "hhid": "Household ID",
    "region": "Region",
    "urban": "Place of residence",
    "sex": "Sex of household head",
    "age": "Age of household head (years)",
    "educ": "Highest education of head",
    "hhsize": "Household size",
    "income": "Monthly household income (GH₵); 99999 = don't know",
    "farm": "Household farms",
    "food_insecure": "Food insecure in the last 12 months",
    "wellbeing": "Well-being score (0–100)",
}
vlabels = {
    "region": {1: "Greater Accra", 2: "Ashanti", 3: "Northern", 4: "Upper East", 5: "Volta"},
    "urban": {0: "Rural", 1: "Urban"},
    "sex": {1: "Male", 2: "Female"},
    "educ": {0: "None", 1: "Primary", 2: "JHS/Middle", 3: "SHS", 4: "Tertiary"},
    "farm": {0: "No", 1: "Yes"},
    "food_insecure": {0: "No", 1: "Yes"},
}
pyreadstat.write_dta(df, "sample/ghana_households_simulated.dta", column_labels=[labels[c] for c in df.columns], variable_value_labels=vlabels, file_label="SIMULATED Ghana household survey (for practice only)")
print(df.describe().T[["count", "mean", "min", "max"]])
