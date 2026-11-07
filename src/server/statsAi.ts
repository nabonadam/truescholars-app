/**
 * Claude turns a plain-English request into Stata commands, and explains finished results.
 * It sees the codebook (names, labels, value labels, summaries) and result summaries, never raw rows.
 */

export type VarMeta = {
  name: string;
  label: string;
  type: string;
  kind: "continuous" | "categorical" | "text";
  nonmissing: number;
  missing: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  valueLabels?: Record<string, string>;
  levels?: { value: string; label: string; n: number }[];
  hist?: number[];
  values?: string[];
};

export type Plan = { commands: string[]; explanation: string; clarification?: string };

export class AiUnavailable extends Error {}

const SYNTAX = `Supported commands (Stata syntax; anything else is unavailable):
describe [varlist] | codebook [varlist] | list [varlist] [if] [in] | count [if]
summarize [varlist] [if] [, detail]
tabulate var [if] [, missing]                       one-way frequencies
tabulate row col [if] [, row col cell chi2 exact V missing nofreq]   cross-tab
tab1 varlist | tab2 varlist [, chi2 ...]
ttest var == # | ttest var, by(group) [unequal] | ttest var1 == var2   (paired)
oneway y group [, tabulate bonferroni scheffe sidak]
anova y factor1 factor2 [factor1#factor2]
correlate varlist | pwcorr varlist [, sig obs star(.05)] | spearman varlist
ranksum y, by(group) | kwallis y, by(group) | signrank var == #  (or var1 = var2)
regress y x1 i.cat c.x##i.g [if] [, robust | vce(cluster id) | beta]
logit / logistic (odds ratios) / probit  y01 xvars [, robust vce(cluster id)]
poisson count xvars [, irr robust]
generate newvar = exp [if] | replace var = exp [if]   (runiform(), rnormal() work after set seed)
recode var (rule = value "label") ... , gen(newvar)     e.g. recode age (18/34 = 1 "18-34") (35/max = 2 "35+"), gen(agegrp)
drop varlist | drop if exp | keep varlist | keep if exp | rename old new
label variable var "text" | label define name 1 "a" 2 "b" | label values var name
mvdecode varlist, mv(99999)        turns codes such as 99, 999, 99999 into missing
encode textvar, gen(newvar)        text categories -> numeric codes with value labels (needed before i.newvar)
destring var, replace [force]      numbers stored as text -> numeric
Weights (add before the comma):  [pw=wt] survey/sampling weights (mean, proportion, regress, logit, logistic, probit, poisson, graph bar)
   [aw=wt] analytic weights (summarize, tabulate, correlate, regress, graph bar, tab x, summarize(y))   [fw=n] frequency weights
mean y [pw=wt], over(group)          weighted means with linearized standard errors and CIs
proportion x [pw=wt], over(group)    category proportions with CIs
tabulate x, summarize(y)             mean-comparison table (mean, sd, n of y for each x)
tabulate x z, summarize(y) means     controlled mean comparison (x by control z)
tabulate y x, col chi2 V gamma taub  (all = chi2, V, gamma, tau-b)    somersd x y    lambda y x
ci means varlist | ci proportions var01 [, wilson wald]    prtest var01 == 0.5 | prtest var01, by(group)
egen z = std(x) | egen idx = rowmean(v1 v2 v3) | egen tot = rowtotal(v1 v2) | egen m = mean(x), by(g) | egen c = cut(x), at(0 18 35 60 120) | egen g = group(a b)
xtile q = x, nquantiles(4)    tabulate x, generate(x_)   (dummy set x_1 x_2 ...)    set seed 123    sample 10 (percent)    sort x | gsort -x
After regress: predict yhat | predict e, residuals | predict rs, rstandard | estat hettest | estat vif | estat ic | swilk e
After logit/logistic/probit/poisson: predict p (probability) | margins | margins x | margins, dydx(*) | margins, dydx(x) | margins x, atmeans | margins, at(age=(20(10)60)) | marginsplot | estat classification | lroc
Graphs: histogram x [, normal percent bin(#) discrete] | graph bar (mean) y [aw=wt], over(x) [over(z)] | graph bar, over(x) (percent) | graph hbar ... | graph box y, over(x) | scatter y x || lfit y x | twoway (scatter y x) (lfitci y x) | twoway line y x, sort
Prefix: by var: <command>   (not with data-changing commands; bysort g: egen ... works)
Factor variables: i.x (first level is base), ib2.x, ib(last).x, c.x, a#b, a##b
Expressions: + - * / ^, == != > < >= <=, & | !, missing(), inrange(x,a,b), inlist(x,a,b), ln(), log10(), exp(), sqrt(), abs(), round(), cond()
Missing values are larger than any number: "if income > 1000" includes missing income unless you add "& !missing(income)".`;

const RULES = `Rules:
- Use only variable names that exist in the codebook, spelled exactly.
- Treat categorical variables (kind "categorical", or with value labels) with i. in regressions.
- Text variables (kind "text") cannot go into regressions, oneway, anova or correlations directly: encode them first (encode sex, gen(sex_n)) and use the new variable. tabulate, ttest by() and ranksum by() accept text directly.
- If a variable has obvious missing-value codes (for example 99999 or 999 well outside the rest), add an mvdecode line first, unless an earlier command already did.
- Pick the test that fits the data: a binary 0/1 outcome means logit/logistic, a count means poisson, two groups means ttest (ranksum if clearly skewed or ordinal), three or more groups means oneway (kwallis for ordinal), two categorical variables means tabulate with chi2.
- For a cross-tab, add row percentages when the first variable is the explanatory one.
- If the dataset has a weight variable (names like wt, weight, pweight, wgt, or labels mentioning weight) and the user asks for population estimates, use it: [pw=] for mean, proportion and models; [aw=] for summarize, tabulate and graphs.
- For "compare the mean of y across groups" use tabulate x, summarize(y) (add a t-test or oneway only if they ask whether the difference is significant). For "controlling for z" with categories use by z: tabulate y x, col chi2 or tabulate x z, summarize(y) means; with a model use regress or logit and margins.
- For predicted probabilities after logit/logistic use margins (margins x, or margins, at(...)) and marginsplot when they want a picture.
- When they ask to check regression assumptions: predict e, residuals then swilk e, estat hettest and estat vif.
- When they ask for a chart, choose: histogram for one numeric variable, graph bar (mean) y, over(x) for means by group, graph bar, over(x) for category shares, graph box for spread by group, scatter y x || lfit y x for two numeric variables.
- Keep to the fewest commands that answer the request. Never invent results.
- If the request cannot be answered with the supported commands, or a needed variable is missing or unclear, return no commands and ask one short clarification question.
- explanation: one or two plain sentences saying what the commands do and why that test fits, for a student.`;

function codebook(vars: VarMeta[]): string {
  return vars
    .map((v) => {
      const bits = [`${v.name} (${v.type}, ${v.kind}${v.label ? `, "${v.label}"` : ""})`, `n=${v.nonmissing}${v.missing ? `, missing=${v.missing}` : ""}`];
      if (v.levels?.length) bits.push(v.levels.map((l) => (l.label !== l.value ? `${l.value}="${l.label}"` : l.value) + ` (${l.n})`).join(", "));
      else if (v.min !== undefined) bits.push(`range ${v.min} to ${v.max}${v.mean !== undefined ? `, mean ${v.mean.toPrecision(4)}` : ""}`);
      if (v.values?.length) bits.push(`values: ${v.values.slice(0, 8).join(", ")}`);
      return "- " + bits.join("; ");
    })
    .join("\n");
}

async function claude(body: Record<string, unknown>) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiUnavailable("Plain-English requests are not switched on yet. Type Stata commands instead, for example: summarize age income");
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", ...body }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    console.error("anthropic", res.status, await res.text().catch(() => ""));
    throw new AiUnavailable("The assistant is busy right now. Try again in a moment, or type Stata commands directly.");
  }
  return (await res.json()) as { content: { type: string; text?: string; input?: unknown }[] };
}

export async function translate(input: string, ctx: { vars: VarMeta[]; nObs: number; history: string[]; recent: string[] }): Promise<Plan> {
  const system = `You are the analysis planner inside a Stata-style statistics workspace used by students and researchers in Ghana. You turn a request into Stata commands that our engine runs.\n\n${SYNTAX}\n\n${RULES}\n- Always answer by calling the plan tool, never with plain text.`;
  const user = `Dataset: ${ctx.nObs} observations.\nCodebook:\n${codebook(ctx.vars)}\n\nData changes already applied (in order):\n${ctx.history.join("\n") || "(none)"}\n\nRecent analyses:\n${ctx.recent.join("\n") || "(none)"}\n\nRequest: ${input}`;
  const out = await claude({
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: user }],
    tools: [
      {
        name: "plan",
        description: "Return the Stata commands to run, or a clarification question.",
        input_schema: {
          type: "object",
          properties: {
            commands: { type: "array", items: { type: "string" }, description: "Stata command lines, in order" },
            explanation: { type: "string" },
            clarification: { type: "string", description: "Only when no commands can be given" },
          },
          required: ["commands", "explanation"],
        },
      },
    ],
  });
  // Some models do not allow forcing a tool, so the instruction asks for it and we accept JSON text as a fallback.
  const call = out.content.find((c) => c.type === "tool_use");
  let plan = (call?.input ?? null) as Partial<Plan> | null;
  if (!plan) {
    const text = out.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const json = text.match(/\{[\s\S]*\}/);
    try {
      plan = json ? (JSON.parse(json[0]) as Partial<Plan>) : null;
    } catch {
      plan = null;
    }
    plan ??= { commands: [], explanation: "", clarification: text.trim() || "Could you say a little more about what you want to find out?" };
  }
  return {
    commands: (plan.commands ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 12),
    explanation: plan.explanation?.trim() ?? "",
    clarification: plan.clarification?.trim() || undefined,
  };
}

/** Numbers rounded the APA way before the model sees them, so it copies instead of rounding. */
export function apaRound(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => apaRound(v, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, apaRound(v, k)]));
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  if (/^(p|pv|pvalue|p_?value|prob)(_|$)|_p$/i.test(key)) return value < 0.001 ? "< .001" : value.toFixed(3).replace(/^0/, "");
  if (Number.isInteger(value)) return value;
  if (/^(r|rho|r2|r2_a|adj_r2|pseudo_r2|eta2|v|cramers_v|cohens_d|d)$/i.test(key)) return Number(value.toFixed(2));
  const a = Math.abs(value);
  if (a >= 0.1) return Number(value.toFixed(2));
  if (a >= 0.001) return Number(value.toFixed(3));
  return Number(value.toPrecision(2));
}

export async function interpret(input: string, results: { command: string; summary?: unknown; notes?: string[] }[]): Promise<string> {
  const system = `You write the results paragraph a careful supervisor would accept: plain English, APA 7 style statistics (italic symbols are not needed). The numbers in the summaries are already rounded for reporting: copy them exactly as given, never re-round, recompute or invent numbers. Say what the result means for the research question in one sentence. Mention a key assumption warning if the notes contain one. No headings, no bullet points, at most two short paragraphs, and finish every sentence.`;
  const body = results.map((r) => `. ${r.command}\nsummary: ${JSON.stringify(apaRound(r.summary ?? {}))}${r.notes?.length ? `\nnotes: ${r.notes.join(" ")}` : ""}`).join("\n\n");
  const out = await claude({ max_tokens: 1600, system, messages: [{ role: "user", content: `Request: ${input}\n\n${body}` }] });
  return out.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}
