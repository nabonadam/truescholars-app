"""Graphs in the style of Stata 18's default scheme (stcolor): histogram, graph bar/hbar/box,
twoway (scatter, line, connected, lfit, lfitci, area), marginsplot and the ROC curve."""

from __future__ import annotations

import base64
import io
import math
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats as st  # noqa: E402

from .data import Dataset, StataError, is_numeric  # noqa: E402
from .expr import resolve_var  # noqa: E402
from .result import Result  # noqa: E402
from .statcmds import _levels, level_label, nice, sample  # noqa: E402
from .syntax import Command, _parse_options, _split_top  # noqa: E402
from .weights import weights  # noqa: E402

# Stata 18 "stcolor" palette
PALETTE = ["#1a85ff", "#d41159", "#00bf7d", "#f5b324", "#8f00ff", "#00a6c8", "#a0522d", "#5e5e5e"]
GRID = "#e6e6e6"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9.5, "axes.edgecolor": "#5e5e5e", "axes.linewidth": 0.8,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.axisbelow": True,
    "axes.spines.top": False, "axes.spines.right": False, "xtick.color": "#333", "ytick.color": "#333",
    "axes.titlesize": 11.5, "axes.titleweight": "normal", "legend.frameon": False, "figure.dpi": 100,
})


def _q(s) -> str | None:
    """An option's text without Stata's quotes."""
    if not isinstance(s, str):
        return None
    s = s.strip()
    m = re.match(r'^"(.*)"', s) or re.match(r"^`\"(.*)\"'", s)
    return m.group(1) if m else s


def _png(fig, title: str) -> dict:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return {"title": title, "png": base64.b64encode(buf.getvalue()).decode(), "width": 1100, "height": 800}


def _finish(ax, cmd: Command, title: str | None, xt: str | None, yt: str | None):
    if title:
        ax.set_title(title, loc="center", pad=10)
    if xt is not None:
        ax.set_xlabel(xt)
    if yt is not None:
        ax.set_ylabel(yt)
    note = _q(cmd.opt("note"))
    if note:
        ax.figure.text(0.01, -0.02, note, fontsize=8, color="#555")


def _fig():
    return plt.subplots(figsize=(5.5, 4))


def _result(img: dict, caption: str) -> Result:
    return Result(log=f"(graph: {caption})", images=[img], summary={"graph": caption})


# ───────────── histogram ─────────────


def histogram(ds: Dataset, cmd: Command) -> Result:
    v = resolve_var(cmd.args.strip().split()[0], ds.df)
    if not is_numeric(ds.df[v]):
        raise StataError(f"{v} is a string variable")
    sub = sample(ds, cmd, [v])
    kind, w = weights(ds, cmd, sub, "fw")
    x = sub[v].astype(float).to_numpy()
    w = np.ones(len(x)) if w is None else w
    N = w.sum()
    discrete = bool(cmd.opt("discrete"))
    if discrete:
        vals = np.unique(x)
        step = np.min(np.diff(vals)) if len(vals) > 1 else 1.0
        edges = np.append(vals - step / 2, vals[-1] + step / 2)
    elif cmd.opt("width"):
        wd = float(cmd.opt("width"))
        start = float(cmd.opt("start") or x.min())
        edges = np.arange(start, x.max() + wd, wd)
    else:
        k = int(cmd.opt("bin")) if cmd.opt("bin") else int(min(math.sqrt(N), 10 * math.log10(N)))
        edges = np.linspace(x.min(), x.max(), max(k, 1) + 1)
    counts, edges = np.histogram(x, bins=edges, weights=w)
    widths = np.diff(edges)
    if cmd.opt("frequency"):
        h, ylab = counts, "Frequency"
    elif cmd.opt("percent"):
        h, ylab = 100 * counts / N, "Percent"
    elif cmd.opt("fraction"):
        h, ylab = counts / N, "Fraction"
    else:
        h, ylab = counts / (N * widths), "Density"
    fig, ax = _fig()
    ax.bar(edges[:-1], h, width=widths, align="edge", color=PALETTE[0], alpha=0.85, edgecolor="white", linewidth=0.6)
    if cmd.opt("normal"):
        m, s = (w * x).sum() / N, math.sqrt((w * (x - (w * x).sum() / N) ** 2).sum() / (N - 1))
        grid = np.linspace(edges[0], edges[-1], 200)
        dens = st.norm.pdf(grid, m, s)
        scale = {"Frequency": N * widths.mean(), "Percent": 100 * widths.mean(), "Fraction": widths.mean()}.get(ylab, 1)
        ax.plot(grid, dens * scale, color=PALETTE[1], linewidth=1.6)
    _finish(ax, cmd, _q(cmd.opt("title")), _q(cmd.opt("xtitle")) or nice(ds, v), _q(cmd.opt("ytitle")) or ylab)
    return _result(_png(fig, f"Histogram of {nice(ds, v)}"), f"histogram of {v}, {len(h)} bins")


# ───────────── graph bar / hbar / box ─────────────


def graph(ds: Dataset, cmd: Command) -> Result:
    args = cmd.args.strip()
    sub = args.split(None, 1)
    what = sub[0].lower() if sub else ""
    rest = sub[1] if len(sub) > 1 else ""
    if what in ("bar", "hbar"):
        return _bar(ds, cmd, rest, horizontal=what == "hbar")
    if what in ("box", "hbox"):
        return _box(ds, cmd, rest, horizontal=what == "hbox")
    if what == "twoway":
        cmd.args = rest
        return twoway(ds, cmd)
    raise StataError("graph supports: bar, hbar, box, hbox, twoway")


def _overs(ds: Dataset, cmd: Command) -> list[str]:
    raw = [k for k in cmd.options if k == "over"]
    if not raw:
        return []
    # options with the same name: the parser keeps the last; re-read them from the raw text
    found = re.findall(r"over\(\s*([A-Za-z_]\w*)", cmd.raw)
    return [resolve_var(v, ds.df) for v in found][:2]


def _bar(ds: Dataset, cmd: Command, rest: str, horizontal: bool) -> Result:
    m = re.match(r"^\(\s*(mean|median|sum|count|percent|max|min|sd)\s*\)\s*(.*)$", rest.strip(), re.I)
    stat = (m.group(1).lower() if m else "mean")
    yspec = (m.group(2) if m else rest).strip()
    ys = [resolve_var(t, ds.df) for t in yspec.split()] if yspec else []
    overs = _overs(ds, cmd)
    if not ys and not overs:
        raise StataError("use: graph bar (mean) y, over(group)   or   graph bar, over(group)")
    if not ys:
        stat = "percent"
    data = sample(ds, cmd, ys + overs)
    kind, w = weights(ds, cmd, data, "aw fw pw iw")
    data = data.assign(__w=np.ones(len(data)) if w is None else w)

    def agg(frame: pd.DataFrame, y: str | None) -> float:
        ww = frame["__w"].to_numpy()
        if stat == "percent":
            return 100 * ww.sum() / data["__w"].sum()
        if stat == "count":
            return float(ww.sum()) if kind == "fw" else float(len(frame))
        yy = frame[y].astype(float).to_numpy()
        if len(yy) == 0:
            return float("nan")
        if stat == "mean":
            return float((ww * yy).sum() / ww.sum())
        if stat == "sum":
            return float((ww * yy).sum())
        if stat == "median":
            return float(np.median(yy))
        if stat == "max":
            return float(yy.max())
        if stat == "min":
            return float(yy.min())
        return float(np.std(yy, ddof=1))

    fig, ax = _fig()
    series = ys if ys else [None]
    if overs:
        g1 = _levels(ds, data[overs[0]], False)
        g2 = _levels(ds, data[overs[1]], False) if len(overs) > 1 else [None]
        groups = [(a, b) for b in g2 for a in g1] if len(overs) > 1 else [(a, None) for a in g1]
        nbars = len(series)
        width = 0.8 / nbars
        pos, labels = [], []
        gap = 0
        prev_b = object()
        x = 0.0
        for a, b in groups:
            if len(overs) > 1 and b != prev_b and prev_b is not object():
                x += 0.6
            prev_b = b
            pos.append(x)
            labels.append(level_label(ds, overs[0], a) + (f"\n{level_label(ds, overs[1], b)}" if b is not None else ""))
            x += 1
        for si, y in enumerate(series):
            vals = []
            for a, b in groups:
                mask = data[overs[0]] == a
                if b is not None:
                    mask &= data[overs[1]] == b
                vals.append(agg(data[mask], y))
            offs = np.array(pos) - 0.4 + width * (si + 0.5)
            color = PALETTE[si % len(PALETTE)] if nbars > 1 else PALETTE[0]
            (ax.barh if horizontal else ax.bar)(offs, vals, width * 0.92, color=color, label=nice(ds, y) if y else None)
            if cmd.opt("blabel"):
                for o, v in zip(offs, vals):
                    (ax.text(v, o, f" {v:.1f}", va="center", fontsize=8) if horizontal else ax.text(o, v, f"{v:.1f}", ha="center", va="bottom", fontsize=8))
        (ax.set_yticks if horizontal else ax.set_xticks)(pos)
        (ax.set_yticklabels if horizontal else ax.set_xticklabels)(labels)
        _ = gap
    else:
        vals = [agg(data, y) for y in series]
        (ax.barh if horizontal else ax.bar)(range(len(vals)), vals, 0.6, color=[PALETTE[i % len(PALETTE)] for i in range(len(vals))])
        (ax.set_yticks if horizontal else ax.set_xticks)(range(len(vals)))
        (ax.set_yticklabels if horizontal else ax.set_xticklabels)([nice(ds, y) for y in series])
    if horizontal:
        ax.grid(axis="y", visible=False)
    else:
        ax.grid(axis="x", visible=False)
    if len(series) > 1 and not cmd.opt("legend") == "off":
        ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.12 if not horizontal else -0.1), ncol=min(4, len(series)), fontsize=8.5)
    ylab = {"percent": "Percent", "count": "Frequency"}.get(stat, f"{stat} of {nice(ds, series[0])}" if len(series) == 1 and series[0] else stat)
    _finish(ax, cmd, _q(cmd.opt("title")), None, None)
    (ax.set_xlabel if horizontal else ax.set_ylabel)(_q(cmd.opt("ytitle")) or ylab)
    what = f"{stat} of {', '.join(ys)}" if ys else "percent"
    return _result(_png(fig, f"Bar chart: {what}" + (f" by {', '.join(overs)}" if overs else "")), f"bar chart of {what}" + (f" over {', '.join(overs)}" if overs else ""))


def _box(ds: Dataset, cmd: Command, rest: str, horizontal: bool) -> Result:
    ys = [resolve_var(t, ds.df) for t in rest.split()]
    if not ys:
        raise StataError("use: graph box y, over(group)")
    overs = _overs(ds, cmd)
    data = sample(ds, cmd, ys + overs)
    fig, ax = _fig()
    groups, labels = [], []
    if overs:
        for lv in _levels(ds, data[overs[0]], False):
            for y in ys:
                groups.append(data.loc[data[overs[0]] == lv, y].astype(float).to_numpy())
                labels.append(level_label(ds, overs[0], lv) + (f"\n{nice(ds, y)}" if len(ys) > 1 else ""))
    else:
        groups = [data[y].astype(float).to_numpy() for y in ys]
        labels = [nice(ds, y) for y in ys]
    bp = ax.boxplot(groups, orientation="horizontal" if horizontal else "vertical", patch_artist=True, widths=0.55, whis=1.5,
                    medianprops={"color": "white", "linewidth": 1.4}, flierprops={"marker": "o", "markersize": 3.5, "markerfacecolor": PALETTE[0], "markeredgecolor": PALETTE[0], "alpha": 0.7},
                    whiskerprops={"color": PALETTE[0]}, capprops={"color": PALETTE[0]})
    for i, patch in enumerate(bp["boxes"]):
        patch.set_facecolor(PALETTE[(i % len(ys)) if len(ys) > 1 else 0])
        patch.set_edgecolor(PALETTE[(i % len(ys)) if len(ys) > 1 else 0])
    (ax.set_yticks if horizontal else ax.set_xticks)(range(1, len(labels) + 1))
    (ax.set_yticklabels if horizontal else ax.set_xticklabels)(labels)
    ax.grid(axis="y" if horizontal else "x", visible=False)
    _finish(ax, cmd, _q(cmd.opt("title")), None, None)
    (ax.set_xlabel if horizontal else ax.set_ylabel)(_q(cmd.opt("ytitle")) or (nice(ds, ys[0]) if len(ys) == 1 else ""))
    return _result(_png(fig, f"Box plot of {', '.join(nice(ds, y) for y in ys)}" + (f" by {nice(ds, overs[0])}" if overs else "")), f"box plot of {', '.join(ys)}" + (f" over {overs[0]}" if overs else ""))


# ───────────── twoway ─────────────

LAYER_TYPES = {"scatter", "sc", "line", "connected", "lfit", "lfitci", "area", "qfit", "bar"}


def _layers(text: str) -> list[str]:
    text = text.strip()
    if text.startswith("("):
        out, depth, cur = [], 0, ""
        for ch in text:
            if ch == "(":
                depth += 1
                if depth == 1:
                    cur = ""
                    continue
            if ch == ")":
                depth -= 1
                if depth == 0:
                    out.append(cur.strip())
                    continue
            if depth >= 1:
                cur += ch
        return out
    return [p.strip() for p in text.split("||") if p.strip()]


def scatter(ds: Dataset, cmd: Command) -> Result:
    body = cmd.raw.split(None, 1)[1] if " " in cmd.raw else ""
    return _twoway(ds, cmd, "scatter " + body.split(",")[0] if "||" not in body else "scatter " + body)


def twoway(ds: Dataset, cmd: Command) -> Result:
    body = cmd.raw.split(None, 1)[1] if " " in cmd.raw else ""
    if cmd.raw.split()[0].lower() in ("graph", "gr"):
        body = body.split(None, 1)[1] if " " in body else ""
    return _twoway(ds, cmd, body)


def _twoway(ds: Dataset, cmd: Command, body: str) -> Result:
    main, global_opts = (body, "")
    # global options follow the last top-level comma outside the layers
    depth = 0
    for i in range(len(body) - 1, -1, -1):
        ch = body[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
        elif ch == "," and depth == 0 and "||" not in body[i:]:
            main, global_opts = body[:i], body[i + 1 :]
            break
    gopts = _parse_options(global_opts) if global_opts.strip() else {}
    gcmd = Command(raw=cmd.raw, name="twoway", options=gopts, if_=cmd.if_, in_=cmd.in_)
    layers = _layers(main)
    if not layers:
        raise StataError("use: twoway (scatter y x) (lfit y x)   or   scatter y x || lfit y x")
    fig, ax = _fig()
    xlab = ylab = None
    legend = []
    for li, layer in enumerate(layers):
        lmain, lopt = _split_top(layer, ",")
        toks = lmain.split()
        typ = toks[0].lower()
        if typ not in LAYER_TYPES:
            raise StataError(f"twoway {typ} isn't available; use scatter, line, connected, lfit, lfitci, qfit, area or bar")
        lif = None
        if " if " in f" {lmain} ":
            lmain, lif = lmain.split(" if ", 1)
            toks = lmain.split()
        vs = [resolve_var(t, ds.df) for t in toks[1:]]
        if len(vs) < 2:
            raise StataError(f"{typ} needs y and x variables")
        y, x = vs[0], vs[-1]
        lc = Command(raw=layer, name="twoway", if_=lif or cmd.if_, in_=cmd.in_)
        d = sample(ds, lc, [y, x]).sort_values(x)
        xv, yv = d[x].astype(float).to_numpy(), d[y].astype(float).to_numpy()
        color = PALETTE[li % len(PALETTE)]
        lo = _parse_options(lopt) if lopt else {}
        label = _q(lo.get("legend")) or None
        if typ in ("scatter", "sc"):
            ax.scatter(xv, yv, s=14, color=color, alpha=0.75, linewidths=0)
            legend.append(label or nice(ds, y))
        elif typ == "line":
            ax.plot(xv, yv, color=color, linewidth=1.6)
            legend.append(label or nice(ds, y))
        elif typ == "connected":
            ax.plot(xv, yv, color=color, linewidth=1.4, marker="o", markersize=4)
            legend.append(label or nice(ds, y))
        elif typ == "area":
            ax.fill_between(xv, yv, color=color, alpha=0.55, linewidth=0)
            legend.append(label or nice(ds, y))
        elif typ == "bar":
            ax.bar(xv, yv, color=color, width=0.8 * (np.min(np.diff(np.unique(xv))) if len(np.unique(xv)) > 1 else 1))
            legend.append(label or nice(ds, y))
        elif typ in ("lfit", "lfitci", "qfit"):
            deg = 2 if typ == "qfit" else 1
            coef = np.polyfit(xv, yv, deg)
            grid = np.linspace(xv.min(), xv.max(), 100)
            fit = np.polyval(coef, grid)
            if typ == "lfitci":
                n = len(xv)
                res = yv - np.polyval(coef, xv)
                s = math.sqrt((res**2).sum() / (n - 2))
                sxx = ((xv - xv.mean()) ** 2).sum()
                se = s * np.sqrt(1 / n + (grid - xv.mean()) ** 2 / sxx)
                tcrit = st.t.ppf(0.975, n - 2)
                ax.fill_between(grid, fit - tcrit * se, fit + tcrit * se, color="#9e9e9e", alpha=0.35, linewidth=0)
                legend.append("95% CI")
            ax.plot(grid, fit, color=PALETTE[1] if li else color, linewidth=1.8)
            legend.append(label or "Fitted values")
        xlab = xlab or nice(ds, x)
        ylab = ylab or nice(ds, y)
    if len(layers) > 1 and gopts.get("legend") != "off":
        ax.legend(legend, loc="upper center", bbox_to_anchor=(0.5, -0.14), ncol=min(3, len(legend)), fontsize=8.5)
    _finish(ax, gcmd, _q(gopts.get("title")), _q(gopts.get("xtitle")) or xlab, _q(gopts.get("ytitle")) or ylab)
    what = " + ".join(l.split()[0] for l in layers)
    return _result(_png(fig, f"{ylab} and {xlab}"), f"twoway {what}")


# ───────────── marginsplot and ROC ─────────────


def marginsplot(ds: Dataset, cmd: Command) -> Result:
    m = ds.last_margins
    if not m:
        raise StataError("previous command was not margins; run margins first")
    pts = m["points"]
    fig, ax = _fig()
    try:
        xs = [float(p[0]) for p in pts]
        numeric = True
    except ValueError:
        xs = list(range(len(pts)))
        numeric = False
    if m.get("at"):  # margins, at(): use the at values on the x axis
        try:
            xs = [float(list(a.values())[0]) for a in m["at"]][: len(pts)] if len(m["at"]) == len(pts) else xs
            numeric = True
        except (ValueError, IndexError):
            pass
    est = [p[1] for p in pts]
    lo = [p[2] for p in pts]
    hi = [p[3] for p in pts]
    ax.errorbar(xs, est, yerr=[np.subtract(est, lo), np.subtract(hi, est)], fmt="o", color=PALETTE[0], ecolor=PALETTE[0], elinewidth=1.2, capsize=4, markersize=5)
    if numeric or len(pts) > 1:
        ax.plot(xs, est, color=PALETTE[0], linewidth=1.4)
    if not numeric:
        ax.set_xticks(xs)
        ax.set_xticklabels([p[0] for p in pts])
    ax.set_title(_q(cmd.opt("title")) or f"{m['title']} with 95% CIs")
    ax.set_ylabel(m["ylabel"])
    ax.set_xlabel(m.get("xlabel") or "")
    return _result(_png(fig, f"{m['title']} with 95% CIs"), "marginsplot")


def roc_image(fp: np.ndarray, tp: np.ndarray, auc: float) -> dict:
    fig, ax = plt.subplots(figsize=(4.6, 4.4))
    ax.plot(fp, tp, color=PALETTE[0], linewidth=1.6, marker="o", markersize=2.5)
    ax.plot([0, 1], [0, 1], color="#9e9e9e", linewidth=1)
    ax.set_xlabel("1 − Specificity")
    ax.set_ylabel("Sensitivity")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.text(0.5, -0.2, f"Area under ROC curve = {auc:.4f}", transform=ax.transAxes, ha="center", fontsize=9)
    return _png(fig, "ROC curve")
