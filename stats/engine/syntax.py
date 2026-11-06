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
}

DATA_COMMANDS = {"generate", "replace", "recode", "drop", "keep", "rename", "label", "mvdecode", "encode", "destring"}


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

    def opt(self, *names: str) -> str | bool | None:
        """Option value by any of its spellings/abbreviations; True if given without arguments."""
        for k, v in self.options.items():
            for n in names:
                if k == n or n.startswith(k):
                    return True if v is None else v
        return None


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
    word, _, rest = text.partition(" ")
    if "," in word:  # e.g. "describe,"
        word, _, tail = word.partition(",")
        rest = "," + tail + " " + rest
    name = canonical(word)
    if not name:
        raise StataError(f"command {word} is unrecognized")
    main, opts = _split_top(rest, ",")
    cmd = Command(raw=raw, name=name, by=by, options=_parse_options(opts) if opts else {})
    # in range
    m = re.search(r"\bin\s+(-?\d+|f)\s*(?:/\s*(-?\d+|l))?\s*$", main)
    if m and not re.search(r"\bif\b", main[m.start():]):
        a = 1 if m.group(1) == "f" else int(m.group(1))
        b = a if m.group(2) is None else (-1 if m.group(2) == "l" else int(m.group(2)))
        cmd.in_ = (a, b)
        main = main[: m.start()]
    # if expression
    if re.search(r"(^|\s)if\s*$", main):
        raise StataError("invalid syntax: nothing after if")
    m = re.search(r"(^|\s)if\s+", main)
    if m:
        cmd.if_ = main[m.end():].strip()
        main = main[: m.start()]
    # = exp (generate / replace); "==" never appears here at top level
    if name in ("generate", "replace"):
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
