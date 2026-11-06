"""Stata's number formats and table rules, so output reads exactly like the Results window."""

from __future__ import annotations

import math


def g(x, width: int = 9, sig: int = 7, fw: int = 9) -> str:
    """Stata %9.0g: at most 7 significant digits and 7 decimals, no leading zero, `fw` characters
    at most; padded to `width` for column alignment."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return ".".rjust(width)
    x = float(x)
    if x == 0:
        return "0".rjust(width)
    mag = math.floor(math.log10(abs(x)))
    if mag >= fw - 1 or mag < -5:
        mant, e = f"{x:.{max(1, fw - 7)}e}".split("e")
        return f"{mant.rstrip('0').rstrip('.')}e{'+' if int(e) >= 0 else '-'}{abs(int(e)):02d}".rjust(width)
    decimals = max(0, min(sig - 1 - mag, fw - 2))
    while True:
        s = f"{x:.{decimals}f}"
        if "." in s:
            s = s.rstrip("0").rstrip(".")
        if s.startswith("0."):
            s = s[1:]
        elif s.startswith("-0."):
            s = "-" + s[2:]
        if len(s) <= fw or decimals == 0:
            return s.rjust(width)
        decimals -= 1


def f(x, width: int, decimals: int) -> str:
    """Stata %w.df."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return ".".rjust(width)
    return f"{float(x):{width}.{decimals}f}"


def p(x, width: int = 8) -> str:
    """P-values as Stata prints them: 0.000 to 1.000."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return ".".rjust(width)
    return f"{min(max(float(x), 0.0), 1.0):{width}.3f}"


def n(x, width: int = 9) -> str:
    """Counts with thousands separators, as in tabulate."""
    return f"{int(x):,}".rjust(width)


def name(s: str, width: int = 12) -> str:
    """Variable names, abbreviated Stata-style (first 10 + ~ + last char) when too long."""
    s = str(s)
    if len(s) > width:
        s = s[: width - 2] + "~" + s[-1]
    return s.rjust(width)


def rule(left: int, right: int, joint: str = "+") -> str:
    return "-" * left + joint + "-" * right


def stars(pv: float) -> str:
    if pv is None or (isinstance(pv, float) and math.isnan(pv)):
        return ""
    return "***" if pv < 0.001 else "**" if pv < 0.01 else "*" if pv < 0.05 else ""


def apa_num(x, decimals: int = 2) -> str:
    """APA tables: fixed decimals, minus sign, no leading zero only where APA asks (p, r)."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return "—"
    return f"{float(x):,.{decimals}f}".replace("-", "−")


def apa_p(pv) -> str:
    if pv is None or (isinstance(pv, float) and math.isnan(pv)):
        return "—"
    return "< .001" if pv < 0.001 else f"{pv:.3f}".lstrip("0")


def apa_r(x) -> str:
    """Correlations and other bounded statistics: no leading zero (APA)."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "—"
    s = f"{x:.2f}"
    return s.replace("0.", ".", 1).replace("-", "−")
