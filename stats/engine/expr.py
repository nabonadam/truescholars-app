"""Stata expressions, evaluated safely on a DataFrame (a small parser; nothing is passed to eval).

Follows Stata's rules: true is 1 and false is 0; arithmetic with missing gives missing; and in
comparisons missing is larger than any number, so `if age > 60` includes missing ages, exactly as
in Stata.
"""

from __future__ import annotations

import re

import numpy as np
from scipy import stats as st
import pandas as pd

from .data import StataError

TOKEN = re.compile(
    r"""\s*(?:
    (?P<num>(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|
    (?P<str>"[^"]*"|`"[^"]*"')|
    (?P<op>==|!=|~=|>=|<=|[-+*/^<>!~&|(),]|=)|
    (?P<miss>\.[a-z]?(?![\w.]))|
    (?P<name>[A-Za-z_][A-Za-z0-9_]*)
    )""",
    re.X,
)


def tokenize(text: str) -> list[tuple[str, str]]:
    pos, out = 0, []
    text = text.strip()
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m or m.end() == pos:
            raise StataError(f"invalid syntax near: {text[pos:pos + 15]}")
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
        pos = m.end()
    return out


def _num(x):
    """As a float Series/scalar; strings stay strings."""
    return x


def _is_str(x) -> bool:
    if isinstance(x, str):
        return True
    return isinstance(x, pd.Series) and not pd.api.types.is_numeric_dtype(x)


def _bool(x) -> pd.Series | float:
    if isinstance(x, pd.Series):
        return x.astype(float)
    return float(x)


def _for_compare(x):
    """Missing compares as +infinity (Stata)."""
    if isinstance(x, pd.Series) and pd.api.types.is_numeric_dtype(x):
        return x.astype(float).fillna(np.inf)
    if isinstance(x, float) and np.isnan(x):
        return np.inf
    if isinstance(x, pd.Series):
        return x.fillna("")
    return x


def _truth(x):
    """Stata truth: nonzero (missing counts as true, like Stata)."""
    if isinstance(x, pd.Series):
        if not pd.api.types.is_numeric_dtype(x):
            raise StataError("type mismatch")
        return (x.fillna(1) != 0)
    return bool(np.nan_to_num(x, nan=1) != 0)


RNG: np.random.Generator | None = None  # the current dataset's generator (set seed), set by run_line


def _rng() -> np.random.Generator:
    global RNG
    if RNG is None:
        RNG = np.random.default_rng(123456789)
    return RNG


class Parser:
    def __init__(self, text: str, df: pd.DataFrame, extra_names: dict | None = None):
        self.toks = tokenize(text)
        self.i = 0
        self.df = df
        self.extra = extra_names or {}
        self.n = len(df)

    def peek(self, val=None):
        if self.i >= len(self.toks):
            return None
        t = self.toks[self.i]
        if val is None or t[1] == val:
            return t
        return None

    def take(self, val=None):
        t = self.peek(val)
        if t is None:
            raise StataError("invalid syntax" if val is None else f"'{val}' expected")
        self.i += 1
        return t

    def parse(self):
        v = self.or_()
        if self.i != len(self.toks):
            raise StataError(f"invalid syntax near '{self.toks[self.i][1]}'")
        return v

    def or_(self):
        v = self.and_()
        while self.peek("|"):
            self.take()
            r = self.and_()
            v = _bool(_truth(v) | _truth(r)) if isinstance(v, pd.Series) or isinstance(r, pd.Series) else float(_truth(v) or _truth(r))
        return v

    def and_(self):
        v = self.not_()
        while self.peek("&"):
            self.take()
            r = self.not_()
            v = _bool(_truth(v) & _truth(r)) if isinstance(v, pd.Series) or isinstance(r, pd.Series) else float(_truth(v) and _truth(r))
        return v

    def not_(self):
        if self.peek("!") or self.peek("~"):
            self.take()
            v = self.not_()
            return _bool(~_truth(v)) if isinstance(v, pd.Series) else float(not _truth(v))
        return self.cmp()

    def cmp(self):
        v = self.add()
        t = self.peek()
        if t and t[1] in ("==", "!=", "~=", ">", "<", ">=", "<=", "="):
            op = self.take()[1]
            if op == "=":
                raise StataError("use == to compare (= is for assignment)")
            r = self.add()
            if _is_str(v) != _is_str(r):
                raise StataError("type mismatch: comparing text with a number")
            a, b = _for_compare(v), _for_compare(r)
            res = {"==": lambda: a == b, "!=": lambda: a != b, "~=": lambda: a != b, ">": lambda: a > b, "<": lambda: a < b, ">=": lambda: a >= b, "<=": lambda: a <= b}[op]()
            return _bool(res)
        return v

    def add(self):
        v = self.mul()
        while self.peek("+") or self.peek("-"):
            op = self.take()[1]
            r = self.mul()
            if op == "+" and (_is_str(v) or _is_str(r)):
                if not (_is_str(v) and _is_str(r)):
                    raise StataError("type mismatch")
                v = v + r
            else:
                if _is_str(v) or _is_str(r):
                    raise StataError("type mismatch")
                v = v + r if op == "+" else v - r
        return v

    def mul(self):
        v = self.unary()
        while self.peek("*") or self.peek("/"):
            op = self.take()[1]
            r = self.unary()
            if _is_str(v) or _is_str(r):
                raise StataError("type mismatch")
            if op == "*":
                v = v * r
            else:
                with np.errstate(divide="ignore", invalid="ignore"):
                    v = v / r
                    if isinstance(v, pd.Series):
                        v = v.replace([np.inf, -np.inf], np.nan)
                    elif not np.isfinite(v):
                        v = np.nan
        return v

    def unary(self):
        if self.peek("-"):
            self.take()
            return -self.unary()
        if self.peek("+"):
            self.take()
            return self.unary()
        return self.power()

    def power(self):
        v = self.atom()
        if self.peek("^"):
            self.take()
            r = self.unary()
            with np.errstate(invalid="ignore"):
                v = v**r
        return v

    def atom(self):
        t = self.take()
        kind, val = t
        if kind == "num":
            return float(val)
        if kind == "str":
            return val[2:-2] if val.startswith("`") else val[1:-1]
        if kind == "miss":
            return np.nan
        if kind == "op" and val == "(":
            v = self.or_()
            self.take(")")
            return v
        if kind == "name":
            if self.peek("("):
                return self.call(val)
            if val == "_n":
                return pd.Series(np.arange(1, self.n + 1, dtype=float), index=self.df.index)
            if val == "_N":
                return float(self.n)
            if val in self.extra:
                return self.extra[val]
            col = resolve_var(val, self.df)
            s = self.df[col]
            return s.astype(float) if pd.api.types.is_numeric_dtype(s) else s
        raise StataError(f"invalid syntax near '{val}'")

    def call(self, fname: str):
        self.take("(")
        args = []
        if not self.peek(")"):
            args.append(self.or_())
            while self.peek(","):
                self.take()
                args.append(self.or_())
        self.take(")")
        f = fname.lower()
        one = lambda fn: fn(args[0])  # noqa: E731
        n = self.n
        idx = self.df.index
        if f == "runiform":
            lo, hi = (float(args[0]), float(args[1])) if len(args) == 2 else (0.0, 1.0)
            return pd.Series(_rng().uniform(lo, hi, n), index=idx)
        if f in ("rnormal", "invnorm_rand"):
            m, sd = (float(args[0]) if args else 0.0), (float(args[1]) if len(args) > 1 else 1.0)
            return pd.Series(_rng().normal(m, sd, n), index=idx)
        if f == "runiformint":
            return pd.Series(_rng().integers(int(args[0]), int(args[1]) + 1, n).astype(float), index=idx)
        if f == "rbinomial":
            return pd.Series(_rng().binomial(int(args[0]), float(args[1]), n).astype(float), index=idx)
        if f == "rpoisson":
            return pd.Series(_rng().poisson(float(args[0]), n).astype(float), index=idx)
        if f in ("missing", "mi"):
            res = [(a.isna() if isinstance(a, pd.Series) and pd.api.types.is_numeric_dtype(a) else (a.fillna("") == "" if isinstance(a, pd.Series) else (a == "" if isinstance(a, str) else np.isnan(a)))) for a in args]
            out = res[0]
            for r in res[1:]:
                out = out | r
            return _bool(out)
        if f == "inrange":
            x, lo, hi = (_for_compare(a) for a in args)
            return _bool((x >= lo) & (x <= hi))
        if f == "inlist":
            x = args[0]
            out = None
            for a in args[1:]:
                c = _for_compare(x) == _for_compare(a)
                out = c if out is None else (out | c)
            return _bool(out)
        with np.errstate(divide="ignore", invalid="ignore"):
            fns = {
                "ln": lambda: one(np.log),
                "log": lambda: one(np.log),
                "log10": lambda: one(np.log10),
                "exp": lambda: one(np.exp),
                "sqrt": lambda: one(np.sqrt),
                "abs": lambda: one(np.abs),
                "int": lambda: one(np.trunc),
                "floor": lambda: one(np.floor),
                "ceil": lambda: one(np.ceil),
                "round": lambda: (np.round(args[0] / args[1]) * args[1]) if len(args) == 2 else one(np.round),
                "max": lambda: _rowwise(args, "max"),
                "min": lambda: _rowwise(args, "min"),
                "cond": lambda: _cond(args),
                "real": lambda: pd.to_numeric(args[0], errors="coerce") if isinstance(args[0], pd.Series) else float(args[0]),
                "string": lambda: args[0].map(lambda v: "" if pd.isna(v) else (str(int(v)) if float(v).is_integer() else str(v))) if isinstance(args[0], pd.Series) else str(args[0]),
                "strlen": lambda: args[0].fillna("").astype(str).str.len().astype(float) if isinstance(args[0], pd.Series) else float(len(args[0])),
                "lower": lambda: args[0].str.lower() if isinstance(args[0], pd.Series) else args[0].lower(),
                "upper": lambda: args[0].str.upper() if isinstance(args[0], pd.Series) else args[0].upper(),
                "trim": lambda: args[0].str.strip() if isinstance(args[0], pd.Series) else args[0].strip(),
                "strtrim": lambda: args[0].str.strip() if isinstance(args[0], pd.Series) else args[0].strip(),
                "itrim": lambda: args[0].str.replace(r"\s+", " ", regex=True) if isinstance(args[0], pd.Series) else " ".join(args[0].split()),
                "proper": lambda: args[0].str.title() if isinstance(args[0], pd.Series) else args[0].title(),
                "substr": lambda: _substr(*args),
                "strpos": lambda: _strfn(args[0], lambda v: float(v.find(str(args[1])) + 1)),
                "subinstr": lambda: _strfn(args[0], lambda v: v.replace(str(args[1]), str(args[2])) if len(args) < 4 or args[3] == "." or (isinstance(args[3], float) and np.isnan(args[3])) else v.replace(str(args[1]), str(args[2]), int(args[3]))),
                "regexm": lambda: _bool(args[0].fillna("").astype(str).str.contains(str(args[1]), regex=True)) if isinstance(args[0], pd.Series) else float(bool(__import__("re").search(str(args[1]), str(args[0])))),
                "word": lambda: _strfn(args[0], lambda v: (v.split() + [""] * int(args[1]))[int(args[1]) - 1] if int(args[1]) > 0 else ""),
                "wordcount": lambda: _strfn(args[0], lambda v: float(len(v.split()))),
                "mod": lambda: _dist(np.mod, args[0], args[1]),
                "normal": lambda: _dist(st.norm.cdf, args[0]),
                "normalden": lambda: _dist(st.norm.pdf, args[0]) if len(args) == 1 else _dist(lambda x, m, s: st.norm.pdf(x, m, s), *args),
                "invnormal": lambda: _dist(st.norm.ppf, args[0]),
                "ttail": lambda: _dist(lambda df_, t: st.t.sf(t, df_), args[0], args[1]),
                "invttail": lambda: _dist(lambda df_, p: st.t.isf(p, df_), args[0], args[1]),
                "chi2": lambda: _dist(lambda df_, x: st.chi2.cdf(x, df_), args[0], args[1]),
                "chi2tail": lambda: _dist(lambda df_, x: st.chi2.sf(x, df_), args[0], args[1]),
                "invchi2tail": lambda: _dist(lambda df_, p: st.chi2.isf(p, df_), args[0], args[1]),
                "ftail": lambda: _dist(lambda a, b, f_: st.f.sf(f_, a, b), args[0], args[1], args[2]),
                "invftail": lambda: _dist(lambda a, b, p: st.f.isf(p, a, b), args[0], args[1], args[2]),
                "binomialtail": lambda: _dist(lambda n, k, p: st.binom.sf(k - 1, n, p), args[0], args[1], args[2]),
                "comb": lambda: _dist(lambda n, k: __import__("scipy.special", fromlist=["comb"]).comb(n, k, exact=False), args[0], args[1]),
                "lnfactorial": lambda: _dist(lambda n: __import__("scipy.special", fromlist=["gammaln"]).gammaln(n + 1), args[0]),
            }
        if f not in fns:
            raise StataError(f"unknown function {fname}()")
        v = fns[f]()
        if isinstance(v, pd.Series) and pd.api.types.is_numeric_dtype(v):
            v = v.replace([np.inf, -np.inf], np.nan)
        return v


def _rowwise(args, how):
    frame = pd.concat([a if isinstance(a, pd.Series) else pd.Series(a, index=next(x for x in args if isinstance(x, pd.Series)).index) for a in args], axis=1)
    return frame.max(axis=1) if how == "max" else frame.min(axis=1)


def _cond(args):
    test, a, b = args[0], args[1], args[2]
    t = _truth(test)
    if isinstance(t, pd.Series):
        return pd.Series(np.where(t, a, b), index=t.index)
    return a if t else b


def _dist(fn, *args):
    """A numeric function applied elementwise; a Series comes back as a Series."""
    idx = next((a.index for a in args if isinstance(a, pd.Series)), None)
    vals = [a.astype(float).to_numpy() if isinstance(a, pd.Series) else float(a) for a in args]
    with np.errstate(all="ignore"):
        out = fn(*vals)
    return pd.Series(out, index=idx, dtype=float) if idx is not None else float(out)


def _strfn(x, fn):
    if isinstance(x, pd.Series):
        return x.map(lambda v: fn("" if pd.isna(v) else str(v)))
    return fn(str(x))


def _substr(x, start, length=None):
    def cut(v: str) -> str:
        n1 = int(start)
        i = n1 - 1 if n1 > 0 else len(v) + n1
        if length is None or (isinstance(length, float) and np.isnan(length)):
            return v[max(i, 0):]
        return v[max(i, 0): max(i, 0) + int(length)]

    return _strfn(x, cut)


def resolve_var(name: str, df: pd.DataFrame) -> str:
    """Exact name, else an unambiguous abbreviation (Stata allows `inc` for `income`)."""
    if name in df.columns:
        return name
    lower = {c.lower(): c for c in df.columns}
    if name.lower() in lower:
        return lower[name.lower()]
    hits = [c for c in df.columns if c.lower().startswith(name.lower())]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise StataError(f"variable {name} not found")
    raise StataError(f"{name} ambiguous abbreviation")


def evaluate(text: str, df: pd.DataFrame, extra: dict | None = None):
    return Parser(text, df, extra).parse()


def condition(text: str | None, df: pd.DataFrame) -> pd.Series:
    """Boolean mask for an `if` expression (True = keep)."""
    if not text:
        return pd.Series(True, index=df.index)
    v = evaluate(text, df)
    if not isinstance(v, pd.Series):
        return pd.Series(bool(_truth(v)), index=df.index)
    return _truth(v)
