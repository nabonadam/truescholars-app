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
generate newvar = exp [if] | replace var = exp [if]
recode var (rule = value "label") ... , gen(newvar)     e.g. recode age (18/34 = 1 "18-34") (35/max = 2 "35+"), gen(agegrp)
drop varlist | drop if exp | keep varlist | keep if exp | rename old new
label variable var "text" | label define name 1 "a" 2 "b" | label values var name
mvdecode varlist, mv(99999)        turns codes such as 99, 999, 99999 into missing
Prefix: by var: <command>   (not with data-changing commands)
Factor variables: i.x (first level is base), ib2.x, ib(last).x, c.x, a#b, a##b
Expressions: + - * / ^, == != > < >= <=, & | !, missing(), inrange(x,a,b), inlist(x,a,b), ln(), log10(), exp(), sqrt(), abs(), round(), cond()
Missing values are larger than any number: "if income > 1000" includes missing income unless you add "& !missing(income)".`;

const RULES = `Rules:
- Use only variable names that exist in the codebook, spelled exactly.
- Treat categorical variables (kind "categorical", or with value labels) with i. in regressions.
- If a variable has obvious missing-value codes (for example 99999 or 999 well outside the rest), add an mvdecode line first, unless an earlier command already did.
- Pick the test that fits the data: a binary 0/1 outcome means logit/logistic, a count means poisson, two groups means ttest (ranksum if clearly skewed or ordinal), three or more groups means oneway (kwallis for ordinal), two categorical variables means tabulate with chi2.
- For a cross-tab, add row percentages when the first variable is the explanatory one.
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
  const system = `You are the analysis planner inside a Stata-style statistics workspace used by students and researchers in Ghana. You turn a request into Stata commands that our engine runs.\n\n${SYNTAX}\n\n${RULES}`;
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
    tool_choice: { type: "tool", name: "plan" },
  });
  const call = out.content.find((c) => c.type === "tool_use");
  const plan = (call?.input ?? {}) as Partial<Plan>;
  return {
    commands: (plan.commands ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 12),
    explanation: plan.explanation?.trim() ?? "",
    clarification: plan.clarification?.trim() || undefined,
  };
}

export async function interpret(input: string, results: { command: string; summary?: unknown; notes?: string[] }[]): Promise<string> {
  const system = `You write the results paragraph a careful supervisor would accept: plain English, APA 7 style statistics (italic symbols are not needed), exact numbers from the summaries only, two decimals (p to three, "p < .001" when smaller). Say what the result means for the research question in one sentence. Mention a key assumption warning if the notes contain one. No headings, no bullet points, at most two short paragraphs. Never invent numbers.`;
  const body = results.map((r) => `. ${r.command}\nsummary: ${JSON.stringify(r.summary ?? {}, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v))}${r.notes?.length ? `\nnotes: ${r.notes.join(" ")}` : ""}`).join("\n\n");
  const out = await claude({ max_tokens: 700, system, messages: [{ role: "user", content: `Request: ${input}\n\n${body}` }] });
  return out.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}
