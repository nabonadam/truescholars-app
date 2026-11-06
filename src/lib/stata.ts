/** Stata syntax the engine supports: used to tell typed commands from plain English and to colour them. */

export const STATA_COMMANDS = [
  "describe", "codebook", "summarize", "tabulate", "tab1", "tab2", "ttest", "oneway", "anova",
  "correlate", "pwcorr", "spearman", "ranksum", "kwallis", "signrank", "regress", "logit",
  "logistic", "probit", "poisson", "generate", "replace", "recode", "drop", "keep", "rename",
  "label", "mvdecode", "encode", "destring", "list", "count",
] as const;

const ABBREV = new Set([
  "d", "de", "des", "desc", "su", "sum", "summ", "ta", "tab", "tabu", "cor", "corr", "reg", "regr",
  "g", "ge", "gen", "ren", "la", "lab", "l", "li", "lis", "by", "bys", "bysort",
]);

/** Real Stata commands the engine doesn't run: still sent to it, so people get a clear explanation. */
const KNOWN_ELSEWHERE = new Set([
  "ssc", "net", "ado", "which", "use", "import", "insheet", "sysuse", "webuse", "save", "saveold", "export", "outsheet",
  "outreg2", "esttab", "putdocx", "putexcel", "asdoc", "graph", "histogram", "hist", "scatter", "twoway", "kdensity",
  "cd", "set", "display", "di", "local", "global", "foreach", "forvalues", "egen", "merge", "append", "reshape",
  "collapse", "svy", "svyset", "xtreg", "xtset", "margins", "predict", "estat", "help", "preserve", "restore", "sort",
]);

const WORD = /^([a-z][a-z0-9]*)\b/i;

/** True when every non-empty, non-comment line starts with a Stata command (or a by-prefix). */
export function looksLikeStata(input: string): boolean {
  const lines = input
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*") && !l.startsWith("//"));
  if (!lines.length) return false;
  return lines.every((l) => {
    const m = l.match(WORD);
    if (!m) return false;
    const w = m[1].toLowerCase();
    if (KNOWN_ELSEWHERE.has(w) && !/\b(the|my|me|what|how|which|please)\b/i.test(l)) return true;
    if (!(ABBREV.has(w) || (STATA_COMMANDS as readonly string[]).some((c) => c === w || (w.length >= 3 && c.startsWith(w))))) return false;
    // "describe the sample" or "list all women" are English: Stata never has stop-words after the command
    return !/\b(the|my|me|what|how|which|is|are|for|of|between|whether|please|show)\b/i.test(l.split(",")[0]);
  });
}

export function splitCommands(input: string): string[] {
  return input
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*") && !l.startsWith("//"));
}
