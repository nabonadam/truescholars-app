import { describe, expect, it } from "vitest";
import { looksLikeStata, splitCommands } from "@/lib/stata";

describe("telling Stata from English", () => {
  it("runs typed commands directly", () => {
    for (const s of ["summarize age income", "su income, d", "tab region urban, row chi2", "reg wellbeing age i.educ, robust", "by urban: tab sex", "gen lninc = ln(income)\nregress wellbeing lninc", "* comment\nlogistic food_insecure hhsize", "ssc install kobo2stata", "graph bar score"]) expect(looksLikeStata(s), s).toBe(true);
  });
  it("sends questions to the assistant", () => {
    for (const s of ["Describe the sample", "Is income different between urban and rural?", "regression of wellbeing on age please", "Compare the means of age", "list all the women"]) expect(looksLikeStata(s), s).toBe(false);
  });
  it("splits a do-file block into commands", () => {
    expect(splitCommands("* note\n\nsu age\n  tab sex  \n// x")).toEqual(["su age", "tab sex"]);
  });
});
