"""Child process for open analysis. argv: workdir, sys.prefix, site-packages paths.
Started with -I -S, a cleared environment and resource limits (see sandbox.py)."""

import sys

WORK, PREFIX = sys.argv[1], sys.argv[2]
sys.path.extend(sys.argv[3:])

import base64  # noqa: E402
import builtins  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import pickle  # noqa: E402
import traceback  # noqa: E402
import warnings  # noqa: E402

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import scipy  # noqa: E402,F401
import statsmodels.api as sm  # noqa: E402
import statsmodels.formula.api as smf  # noqa: E402
from scipy import stats  # noqa: E402

plt.figure()  # builds matplotlib's font cache now, before the audit hook
plt.close("all")
plt.rcParams.update({"axes.grid": True, "grid.color": "#e6e6e6", "axes.spines.top": False, "axes.spines.right": False, "font.size": 9.5, "axes.axisbelow": True})

with open(os.path.join(WORK, "data.pkl"), "rb") as f:
    D = pickle.load(f)
OUT = open(os.path.join(WORK, "out.json"), "w")  # noqa: SIM115 - opened before the hook closes the door
with open(os.path.join(WORK, "analysis.py")) as f:
    CODE = f.read()

READ_OK = tuple({os.path.realpath(p) for p in [PREFIX, sys.base_prefix, *sys.argv[3:], "/usr/share/fonts", "/usr/local/share/fonts", "/usr/lib/python3", "/usr/local/lib"]})
BLOCK_PREFIX = ("os.system", "os.exec", "os.spawn", "os.fork", "os.forkpty", "os.posix_spawn", "os.kill", "os.killpg", "os.remove", "os.rename",
                "os.rmdir", "os.unlink", "os.mkdir", "os.chmod", "os.chown", "os.putenv", "os.unsetenv", "os.truncate", "os.symlink", "os.link",
                "os.chdir", "os.listdir", "os.scandir", "os.walk", "subprocess", "socket", "ctypes", "shutil", "urllib", "http", "ftplib", "smtplib",
                "webbrowser", "sqlite3", "pty", "resource", "sys.setrecursionlimit", "sys.addaudithook", "glob", "fcntl", "mmap", "winreg", "_posixsubprocess")


def hook(event, args):
    if event.startswith(BLOCK_PREFIX):
        raise PermissionError(f"{event} is not allowed in an analysis")
    if event == "open":
        path, mode = args[0], args[1] if len(args) > 1 else "r"
        if isinstance(path, int):
            return
        mode = mode or "r"
        real = os.path.realpath(os.fsdecode(path))
        if any(c in str(mode) for c in "wax+") or not real.startswith(READ_OK):
            raise PermissionError("files can't be opened in an analysis")


SAFE_BUILTINS = {k: getattr(builtins, k) for k in dir(builtins) if not k.startswith("_") and k not in {
    "open", "eval", "exec", "compile", "input", "globals", "locals", "vars", "getattr", "setattr", "delattr", "breakpoint", "exit", "quit",
    "help", "memoryview", "dir", "object", "type", "super", "classmethod", "staticmethod", "property", "copyright", "credits", "license"}}
ALLOWED = {"pandas", "numpy", "scipy", "statsmodels", "linearmodels", "sklearn", "matplotlib", "math", "statistics", "itertools",
           "collections", "functools", "re", "warnings", "datetime", "textwrap", "string"}


def _import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
    if level or name.split(".")[0] not in ALLOWED:
        raise ImportError(f"import {name} is not allowed here")
    return __import__(name, globals, locals, fromlist, level)


SAFE_BUILTINS["__import__"] = _import
SAFE_BUILTINS["__build_class__"] = builtins.__build_class__

TABLES, IMAGES, NOTES, SUMMARY = [], [], [], {}


def _cell(v, decimals):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    if isinstance(v, (bool, np.bool_)):
        return "Yes" if v else "No"
    if isinstance(v, (int, np.integer)):
        return f"{int(v):,}"
    if isinstance(v, (float, np.floating)):
        v = float(v)
        if v != 0 and abs(v) < 10 ** -decimals:
            return f"{v:.2e}"
        return f"{v:,.{decimals}f}"
    if isinstance(v, (tuple, list)) and len(v) == 2 and all(isinstance(x, (int, float, np.number)) for x in v):
        return f"[{_cell(v[0], decimals)}, {_cell(v[1], decimals)}]"
    return str(v)


def _frame(df, title, note, decimals):
    df = df.copy()
    show_index = not isinstance(df.index, pd.RangeIndex)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [" ".join(str(x) for x in c if str(x)) for c in df.columns]
    cols = ([str(df.index.name or "")] if show_index else []) + [str(c) for c in df.columns]
    rows = []
    for idx, r in df.head(500).iterrows():
        cells = [_cell(v, decimals) for v in r.tolist()]
        rows.append(([" ".join(map(str, idx)) if isinstance(idx, tuple) else str(idx)] if show_index else []) + cells)
    if len(df) > 500:
        note = (note + " " if note else "") + f"First 500 of {len(df):,} rows shown."
    TABLES.append({"title": title or "Results", "columns": cols, "rows": rows, "note": note or "", "groups": []})


def show(obj, title="", note="", decimals=3):
    """Put a result in the output: a DataFrame or Series as a table, a fitted model as its summary and coefficient table."""
    if isinstance(obj, pd.DataFrame):
        return _frame(obj, title, note, decimals)
    if isinstance(obj, pd.Series):
        return _frame(obj.to_frame(obj.name or "Value"), title, note, decimals)
    if isinstance(obj, dict):
        return _frame(pd.DataFrame({"Statistic": list(obj.keys()), "Value": list(obj.values())}), title, note, decimals)
    if hasattr(obj, "params") and hasattr(obj, "summary") and callable(obj.summary):  # statsmodels / linearmodels
        print(obj.summary())
        try:
            ci = obj.conf_int()
            se = getattr(obj, "bse", None)
            se = se if se is not None else getattr(obj, "std_errors")
            pv = obj.pvalues
            t = pd.DataFrame({"B": obj.params, "SE": se, "p": pv, "95% CI": [(lo, hi) for lo, hi in np.asarray(ci)]})
            t.index.name = "Term"
            return _frame(t, title or "Model estimates", note, decimals)
        except Exception:  # noqa: BLE001
            return None
    if hasattr(obj, "summary") and isinstance(getattr(obj, "summary"), pd.DataFrame):  # fitted objects with a summary table
        return _frame(obj.summary, title or "Model estimates", note, decimals)
    print(obj)
    return None


def figure(fig=None, title=""):
    """Add a matplotlib figure (default: the current one) to the output."""
    fig = fig or plt.gcf()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    t = title or (fig.axes[0].get_title() if fig.axes else "") or "Figure"
    IMAGES.append({"title": t, "png": base64.b64encode(buf.getvalue()).decode(), "width": 1100, "height": 800})


def note(text):
    """A plain-English note under the results (assumptions, warnings)."""
    NOTES.append(str(text))


def result(**numbers):
    """Key numbers for the written interpretation."""
    SUMMARY.update(numbers)


def _plain(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (np.ndarray, pd.Series, pd.Index)):
        return [_plain(x) for x in list(o)][:200]
    if isinstance(o, pd.DataFrame):
        return o.head(50).to_dict()
    return str(o)


ns = {
    "__builtins__": SAFE_BUILTINS, "__name__": "analysis",
    "df": D["df"].copy(), "var_labels": dict(D["var_labels"]), "value_labels": {k: dict(v) for k, v in D.get("value_labels", {}).items()},
    "pd": pd, "np": np, "sm": sm, "smf": smf, "stats": stats, "plt": plt, "math": math,
    "show": show, "figure": figure, "note": note, "result": result,
}
log = io.StringIO()
sys.addaudithook(hook)
err = None
real_stdout = sys.stdout
sys.stdout = log
try:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        exec(compile(CODE, "analysis.py", "exec"), ns)  # noqa: S102 - checked code, restricted namespace
    seen = set()
    for w in caught:
        msg = str(w.message).split("\n")[0][:240]
        if msg not in seen and len(seen) < 4:
            seen.add(msg)
            NOTES.append(f"Warning: {msg}")
    for num in plt.get_fignums():
        figure(plt.figure(num))
except BaseException as e:  # noqa: BLE001
    tb = traceback.extract_tb(e.__traceback__)
    line = next((f.lineno for f in reversed(tb) if f.filename == "analysis.py"), None)
    err = f"Python error{f' on line {line}' if line else ''}: {type(e).__name__}: {str(e)[:400]}"
finally:
    sys.stdout = real_stdout
text = log.getvalue()
if len(text) > 200_000:
    text = text[:200_000] + "\n... (output truncated)"
OUT.write(json.dumps({"log": text, "tables": TABLES, "images": IMAGES[:12], "notes": NOTES, "summary": SUMMARY, "error": err}, default=_plain))
OUT.close()
