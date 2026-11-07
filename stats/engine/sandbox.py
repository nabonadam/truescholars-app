"""Open analysis: AI-written Python that the person has read and approved, run in a locked-down child process.

Three layers keep it to statistics:
1. a static check of the code (only scientific imports; no dunder access, files, eval/exec, network modules);
2. a child process with no environment secrets, CPU / memory / file-size limits and a wall-clock timeout;
3. inside the child, an audit hook that blocks processes, sockets, ctypes and file access outside Python's own libraries.
"""

from __future__ import annotations

import ast
import json
import os
import pickle
import re
import subprocess
import sys
import tempfile

from .data import Dataset, StataError

ALLOWED_IMPORTS = {
    "pandas", "numpy", "scipy", "statsmodels", "linearmodels", "lifelines", "sklearn", "matplotlib",
    "math", "statistics", "itertools", "collections", "functools", "re", "warnings", "datetime", "textwrap", "string",
}
BLOCKED_NAMES = {
    "open", "eval", "exec", "compile", "__import__", "input", "globals", "locals", "vars", "getattr", "setattr", "delattr",
    "breakpoint", "exit", "quit", "help", "memoryview", "dir", "object", "type", "super", "classmethod", "staticmethod", "property",
}
BLOCKED_ATTR = re.compile(
    r"^(_.*|read_.*|to_(csv|excel|pickle|parquet|sql|hdf|stata|feather|json|clipboard|html|latex|xml|orc)|load|loads|save|savez|savez_compressed|savetxt|loadtxt|"
    r"fromfile|tofile|genfromtxt|memmap|DataSource|eval|query|savefig|format|format_map|ctypes|ctypeslib|f2py|distutils|testing|os|sys|subprocess|shutil|socket|"
    r"pickle|io|common|compat|builtins|importlib|system|popen|webuse|get_rdataset|datasets|fetch_.*|load_.*|urlopen|request|func_globals|gi_frame|f_globals|f_back|tb_frame)$"
)
TIMEOUT = int(os.environ.get("STATS_PY_TIMEOUT", "120"))
MEM_MB = int(os.environ.get("STATS_PY_MEM_MB", "2048"))


def check(code: str) -> None:
    """Raise StataError naming the first thing this code isn't allowed to do."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise StataError(f"the Python code has a syntax error on line {e.lineno}: {e.msg}") from e
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ALLOWED_IMPORTS:
                    raise StataError(f"import {a.name} is not allowed here (only scientific libraries)")
        elif isinstance(node, ast.ImportFrom):
            if node.level or (node.module or "").split(".")[0] not in ALLOWED_IMPORTS:
                raise StataError(f"from {node.module} import ... is not allowed here (only scientific libraries)")
            for a in node.names:
                if a.name == "*" or BLOCKED_ATTR.match(a.name):
                    raise StataError(f"importing {a.name} is not allowed here")
        elif isinstance(node, ast.Name) and node.id in BLOCKED_NAMES:
            raise StataError(f"{node.id}() is not allowed in an analysis")
        elif isinstance(node, ast.Name) and node.id.startswith("__"):
            raise StataError(f"{node.id} is not allowed in an analysis")
        elif isinstance(node, ast.Attribute) and BLOCKED_ATTR.match(node.attr):
            raise StataError(f".{node.attr} is not allowed in an analysis (no files, network or internals)")
        elif isinstance(node, (ast.Global, ast.Nonlocal, ast.AsyncFunctionDef, ast.Await, ast.AsyncWith)):
            raise StataError(f"{type(node).__name__.lower()} statements are not allowed in an analysis")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and "__" in node.value:
            raise StataError("strings containing __ are not allowed in an analysis")


def _limits():  # runs in the child before exec
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT, TIMEOUT + 5))
    resource.setrlimit(resource.RLIMIT_AS, (MEM_MB * 2**20, MEM_MB * 2**20))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 2**20, 64 * 2**20))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.setsid()


def run_python(ds: Dataset, code: str, title: str = "") -> dict:
    check(code)
    with tempfile.TemporaryDirectory(prefix="sbx-") as tmp:
        data_path = os.path.join(tmp, "data.pkl")
        out_path = os.path.join(tmp, "out.json")
        code_path = os.path.join(tmp, "analysis.py")
        with open(data_path, "wb") as f:
            pickle.dump({"df": ds.df, "var_labels": ds.var_labels, "value_labels": ds.value_labels, "label_sets": ds.label_sets}, f)
        with open(code_path, "w") as f:
            f.write(code)
        child = os.path.join(os.path.dirname(__file__), "sandbox_child.py")
        env = {"PATH": "/usr/bin:/bin", "HOME": tmp, "MPLBACKEND": "Agg", "MPLCONFIGDIR": tmp, "OPENBLAS_NUM_THREADS": "1",
               "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0", "LANG": "C.UTF-8"}
        try:
            p = subprocess.run([sys.executable, "-I", "-S", child, tmp, sys.prefix] + [x for x in sys.path if "site-packages" in x or "dist-packages" in x],
                               cwd=tmp, env=env, capture_output=True, text=True, timeout=TIMEOUT + 10, preexec_fn=_limits)
        except subprocess.TimeoutExpired as e:
            raise StataError(f"the analysis took longer than {TIMEOUT} seconds and was stopped; try a smaller model or a sample of the data") from e
        if not os.path.exists(out_path):
            tail = (p.stderr or "").strip().splitlines()[-3:]
            if p.returncode in (-9, -24, 137) or "MemoryError" in (p.stderr or ""):
                raise StataError("the analysis ran out of memory or time and was stopped; try a smaller model or a sample of the data")
            raise StataError("the analysis stopped unexpectedly" + (f": {tail[-1][:300]}" if tail else ""))
        with open(out_path) as f:
            out = json.load(f)
    if out.get("error"):
        raise StataError(out["error"])
    return {"command": f"python: {title}" if title else "python", "ok": True, "log": out.get("log", ""), "tables": out.get("tables", []),
            "notes": out.get("notes", []), "summary": out.get("summary", {}), "images": out.get("images", []), "changesData": False}
