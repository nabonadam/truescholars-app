"""Parsing Stata command lines: [by varlist:] command [varlist] [=exp] [if exp] [in range] [, options]"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field

import pandas as pd

from .data import StataError
from .expr import resolve_var

# Full name -> shortest accepted abbreviation (Stata's own minimums).
COMMANDS = {
    "describe": "d",
    "codebook": "codebook",
    "summarize": "su",
    "tabulate": "ta",
    "tab1": "tab1",
    "tab2": "tab2",
    "ttest": "ttest",
    "oneway": "oneway",
    "anova": "anova",
    "correlate": "cor",
    "pwcorr": "pwcorr",
    "spearman": "spearman",
    "ranksum": "ranksum",
    "kwallis": "kwallis",
    "signrank": "signrank",
    "regress": "reg",
    "logit": "logit",
    "logistic": "logistic",
    "probit": "probit",
    "poisson": "poisson",
    "generate": "g",
    "replace": "replace",
    "recode": "recode",
    "drop": "drop",
    "keep": "keep",
    "rename": "ren",
    "label": "la",
    "mvdecode": "mvdecode",
    "encode": "encode",
    "destring": "destring",
    "list": "l",
    "count": "count",
    "mean": "mean",
    "proportion": "prop",
    "ci": "ci",
    "prtest": "prtest",
    "somersd": "somersd",
    "lambda": "lambda",
    "egen": "egen",
    "xtile": "xtile",
    "sample": "sample",
    "set": "set",
    "version": "vers",
    "sort": "sort",
    "gsort": "gsort",
    "predict": "predict",
    "estat": "estat",
    "margins": "margins",
    "swilk": "swilk",
    "histogram": "hist",
    "graph": "gr",
    "scatter": "sc",
    "twoway": "tw",
    "marginsplot": "marginsplot",
    "lroc": "lroc",
    "svyset": "svyset",
    "xtset": "xtset",
    "xtreg": "xtreg",
    "mixed": "mixed",
    "ologit": "ologit",
    "oprobit": "oprobit",
    "mlogit": "mlogit",
    "nbreg": "nbreg",
    "ivregress": "ivregress",
    "factor": "factor",
    "rotate": "rotate",
    "alpha": "alpha",
    "stset": "stset",
    "stcox": "stcox",
    "sts": "sts",
    "tabstat": "tabstat",
    "misstable": "misstable",
    "duplicates": "duplicates",
    "qreg": "qreg",
    "glm": "glm",
    "tobit": "tobit",
    "test": "test",
    "lincom": "lincom",
    "testparm": "testparm",
    "mediate": "mediate",
    "pca": "pca",
    "cluster": "cluster",
    "power": "power",
    "collapse": "collapse",
    "reshape": "reshape",
    "kdensity": "kdensity",
    "qnorm": "qnorm",
    "display": "di",
}

# Real Stata commands we deliberately don't run, with what to do instead.
NOT_HERE = {
    ("ssc", "net", "ado", "adoupdate", "update", "which"): "Installing Stata packages (ssc/net install) isn't possible here: this workspace runs its own engine that speaks Stata's language, not Stata itself. Ask in plain English for what the package does, or use the built-in commands.",
    ("use", "import", "insheet", "sysuse", "webuse", "infile"): "Your data is already loaded from your upload. To work with a different file, start a new session with it.",
    ("save", "saveold", "export", "outsheet", "outreg2", "esttab", "estout", "putdocx", "putexcel", "asdoc", "log", "cmdlog"): "Saving and exporting work through the Export menu: Word or Excel tables, the do-file, and your data as .dta or .csv.",
    ("graphbox", "boxplot", "pnorm", "melogit", "meologit", "mepoisson", "xtlogit", "xtprobit", "xtpoisson", "gsem", "sem", "streg", "heckman", "zinb", "zip", "arima", "var", "kmeans", "teffects", "psmatch2", "fracreg", "betareg", "nl", "irt", "lca"): "This one isn't a built-in command yet. Describe it in plain English (for example 'run a multilevel logistic model of passed on hours with random intercepts for school') and the assistant will write and run it as an advanced analysis.",
    ("cd", "dir", "ls", "shell", "capture", "quietly", "noisily", "macro", "local", "global", "foreach", "forvalues", "program", "preserve", "restore", "merge", "append", "tsset", "help", "search"): "This command isn't a built-in command yet. Ask for it in plain English: the assistant can run it as an advanced analysis.",
}


def _not_here(word: str) -> str | None:
    w = word.lower()
    for words, message in NOT_HERE.items():
        if w in words:
            return message
    return None


DATA_COMMANDS = {"alpha", "collapse", "reshape", "duplicates", "cluster", "generate", "replace", "recode", "drop", "keep", "rename", "label", "mvdecode", "encode", "destring", "egen", "xtile", "sample", "set", "sort", "gsort", "predict", "svyset", "xtset", "stset"}


def canonical(word: str) -> str | None:
    w = word.lower()
    if w in COMMANDS:
        return w
    if w in ("sum", "summ", "summa", "summar", "summari", "summariz"):
        return "summarize"
    if w in ("tab", "tabu", "tabul", "tabula", "tabulat"):
        return "tabulate"
    if w in ("gen", "gene", "gener", "genera", "generat"):
        return "generate"
    if w in ("reg", "regr", "regre", "regres"):
        return "regress"
    if w in ("corr", "corre", "correl", "correla", "correlat"):
        return "correlate"
    for full, short in COMMANDS.items():
        if full.startswith(w) and len(w) >= len(short):
            return full
    return None


@dataclass
class Command:
    raw: str
    name: str
    by: list[str] = field(default_factory=list)
    args: str = ""  # everything between the command word and if/in/options
    exp: str | None = None  # after "=" (generate/replace)
    if_: str | None = None
    in_: tuple[int, int] | None = None
    options: dict[str, str | None] = field(default_factory=dict)
    weight: tuple[str, str] | None = None  # ("aw" | "pw" | "fw" | "iw", expression)
    _design: tuple | None = None  # set by estimation commands (terms, factor levels)
    svy: bool = False  # svy: prefix

    def opt(self, *names: str) -> str | bool | None:
        """Option value by any of its spellings; True if given without arguments. Abbreviations
        need at least 3 letters (Stata's rule for most options), plus a few short forms Stata allows."""
        for k, v in self.options.items():
            for n in names:
                if k == n or SHORT.get(k) == n or (len(k) >= 3 and n.startswith(k)):
                    return True if v is None else v
        return None


SHORT = {"d": "detail", "r": "robust", "ro": "robust", "nq": "nquantiles", "g": "generate", "ge": "generate", "co": "column", "ce": "cell", "ex": "exact", "m": "missing", "mi": "missing", "su": "summarize", "sum": "summarize", "fr": "frequency", "freq": "frequency", "perc": "percent", "per": "percent", "norm": "normal", "w": "width", "nog": "nograph"}


def _split_top(text: str, sep: str) -> tuple[str, str | None]:
    """Split at the first `sep` outside quotes and parentheses."""
    depth, quote = 0, False
    for i, ch in enumerate(text):
        if ch == '"':
            quote = not quote
        elif not quote:
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth -= 1
            elif ch == sep and depth == 0:
                return text[:i], text[i + 1 :]
    return text, None


def _parse_options(text: str) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    i, text = 0, text.strip()
    while i < len(text):
        m = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)", text[i:])
        if not m:
            raise StataError(f"invalid options: {text[i:]}")
        name = m.group(1).lower()
        i += m.end()
        val = None
        if i < len(text) and text[i] == "(":
            depth, j = 0, i
            while j < len(text):
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            if depth != 0:
                raise StataError("unmatched parenthesis in options")
            val = text[i + 1 : j].strip()
            i = j + 1
        out[name] = val
    return out


def parse(line: str) -> Command:
    raw = line.strip()
    if not raw:
        raise StataError("empty command")
    text = raw
    by: list[str] = []
    m = re.match(r"^(?:bysort|bys|by)\s+([^:]+):\s*(.*)$", text, re.I | re.S)
    if m:
        by = m.group(1).replace("(", " ").replace(")", " ").split()
        text = m.group(2)
    svy = False
    m = re.match(r"^svy\s*(?:,[^:]*)?:\s*(.*)$", text, re.I | re.S)
    if m:
        svy, text = True, m.group(1)
    word, _, rest = text.partition(" ")
    if "," in word:  # e.g. "describe,"
        word, _, tail = word.partition(",")
        rest = "," + tail + " " + rest
    name = canonical(word)
    if not name:
        hint = _not_here(word)
        raise StataError(f"{word}: {hint}" if hint else f"command {word} is unrecognized. See the list of available commands on the Statistics Assistant page.")
    main, opts = _split_top(rest, ",")
    cmd = Command(raw=raw, name=name, by=by, options=_parse_options(opts) if opts else {}, svy=svy)
    wm = re.search(r"\[\s*(aw|aweights?|pw|pweights?|fw|fweights?|iw|iweights?|weight)\s*=\s*([^\]]+)\]", main, re.I)
    if wm:
        kind = wm.group(1).lower()[:2]
        cmd.weight = ("aw" if kind == "we" else kind, wm.group(2).strip())
        main = main[: wm.start()] + " " + main[wm.end():]
    # in range
    m = re.search(r"\bin\s+(-?\d+|f)\s*(?:/\s*(-?\d+|l))?\s*$", main)
    if m and not re.search(r"\bif\b", main[m.start():]):
        a = 1 if m.group(1) == "f" else int(m.group(1))
        b = a if m.group(2) is None else (-1 if m.group(2) == "l" else int(m.group(2)))
        cmd.in_ = (a, b)
        main = main[: m.start()]
    # if expression
    if name in ("twoway", "graph", "scatter") and ("(" in main or "||" in main):
        cmd.args = main.strip()  # layers carry their own if conditions; the handler reads them
        return cmd
    if re.search(r"(^|\s)if\s*$", main):
        raise StataError("invalid syntax: nothing after if")
    m = re.search(r"(^|\s)if\s+", main)
    if m:
        cmd.if_ = main[m.end():].strip()
        main = main[: m.start()]
    # = exp (generate / replace); "==" never appears here at top level
    if name in ("generate", "replace", "egen", "xtile", "predict"):
        if name == "predict" and "=" not in main:
            cmd.args = main.strip()
            return cmd
        lhs, rhs = _split_top(main, "=")
        if rhs is None:
            raise StataError(f"{name} needs: {name} newvar = expression")
        cmd.args, cmd.exp = lhs.strip(), rhs.strip()
    else:
        cmd.args = main.strip()
    return cmd


# ───────────── varlists ─────────────


def expand_varlist(text: str, df: pd.DataFrame, allow_empty_all: bool = True) -> list[str]:
    """Expands names, abbreviations, wildcards (inc*, q?) and ranges (q1-q10, in dataset order)."""
    cols = list(df.columns)
    if not text.strip():
        return cols if allow_empty_all else []
    out: list[str] = []
    for tok in text.split():
        if tok in ("_all", "*"):
            out.extend(cols)
        elif "-" in tok and not tok.startswith("-"):
            a, b = tok.split("-", 1)
            ia, ib = cols.index(resolve_var(a, df)), cols.index(resolve_var(b, df))
            out.extend(cols[min(ia, ib) : max(ia, ib) + 1])
        elif any(ch in tok for ch in "*?~"):
            hits = [c for c in cols if fnmatch.fnmatchcase(c.lower(), tok.lower().replace("~", "*"))]
            if not hits:
                raise StataError(f"variable {tok} not found")
            out.extend(hits)
        else:
            out.append(resolve_var(tok, df))
    seen: set[str] = set()
    return [c for c in out if not (c in seen or seen.add(c))]


@dataclass
class Term:
    """One regressor: a list of components, each ('c', var) or ('i', var, base)."""

    parts: list[tuple]


def parse_fvlist(text: str, df: pd.DataFrame) -> list[Term]:
    """Factor-variable lists: x, i.x, ib2.x, ib(last).x, c.x, i.a#i.b, c.x##i.g, i.(a b)."""
    terms: list[Term] = []
    tokens = re.findall(r"[A-Za-z0-9_.()#*?~-]+", text)
    # expand i.(a b) groups
    expanded: list[str] = []
    joined = " ".join(tokens)
    for m in re.finditer(r"(\b[ib][A-Za-z0-9()]*)\.\(([^)]*)\)|(\S+)", joined):
        if m.group(1):
            expanded.extend(f"{m.group(1)}.{v}" for v in m.group(2).split())
        else:
            expanded.append(m.group(3))
    for tok in expanded:
        if "##" in tok:
            comps = [_component(p, df) for p in tok.split("##")]
            # full factorial: all main effects and all interactions
            n = len(comps)
            for mask in range(1, 1 << n):
                terms.append(Term([comps[k] for k in range(n) if mask >> k & 1]))
        elif "#" in tok:
            terms.append(Term([_component(p, df) for p in tok.split("#")]))
        else:
            comp = _component(tok, df)
            if comp[0] == "c" and any(ch in tok for ch in "*?") or "-" in tok:
                for v in expand_varlist(tok, df):
                    terms.append(Term([("c", v)]))
            else:
                terms.append(Term([comp]))
    return terms


def _component(tok: str, df: pd.DataFrame) -> tuple:
    m = re.match(r"^(i|ib\(?(?:first|last|freq|\d+)\)?|c)\.(.+)$", tok, re.I)
    if not m:
        return ("c", resolve_var(tok, df) if not any(ch in tok for ch in "*?-") else tok)
    prefix, var = m.group(1).lower(), resolve_var(m.group(2), df)
    if prefix == "c":
        return ("c", var)
    base = None
    b = re.match(r"ib\(?(first|last|freq|\d+)\)?", prefix)
    if b:
        base = b.group(1)
    return ("i", var, base)
