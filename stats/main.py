"""The Statistics Assistant engine: runs Stata-syntax commands on a stored dataset.

The app stores uploads in Postgres (stat_datasets.data). Every request names a dataset and the
data-changing commands already run in the session (its history); the engine replays them on a
cached copy, so results are always reproducible from the do-file alone.
"""

from __future__ import annotations

import gzip
import hmac
import io
import os
import shutil
import tempfile
import threading
from collections import OrderedDict

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from engine.data import Dataset, StataError, load_path, variables_meta
from engine.export import dataset_bytes, docx_bytes, xlsx_bytes
from engine.run import apply_history, run_commands
from engine.syntax import DATA_COMMANDS, parse

app = FastAPI(title="True Scholars statistics engine", docs_url=None, redoc_url=None)
KEY = os.environ.get("STATS_KEY", "")
DB = os.environ.get("DATABASE_URL", "")


def auth(x_stats_key: str = Header(default="")):
    if not KEY or not hmac.compare_digest(x_stats_key, KEY):
        raise HTTPException(401, "unauthorized")


def _mb(ds: Dataset) -> float:
    return float(ds.df.memory_usage(deep=False).sum()) / 1e6


class LRU:
    """In-memory cache with a memory budget (MB): datasets by id, replayed states by (id, history).
    The newest entry is always kept, so one large dataset still works."""

    def __init__(self, budget_mb: float):
        self.budget, self.items, self.lock = budget_mb, OrderedDict(), threading.Lock()

    def get(self, key):
        with self.lock:
            if key in self.items:
                self.items.move_to_end(key)
                return self.items[key][0]
        return None

    def put(self, key, value: Dataset):
        with self.lock:
            self.items[key] = (value, _mb(value))
            self.items.move_to_end(key)
            while len(self.items) > 1 and sum(m for _, m in self.items.values()) > self.budget:
                self.items.popitem(last=False)


CACHE_MB = float(os.environ.get("STATS_CACHE_MB", "120"))
BASE = LRU(CACHE_MB / 2)
STATES = LRU(CACHE_MB / 2)


def fetch(dataset_id: str) -> Dataset:
    hit = BASE.get(dataset_id)
    if hit:
        return hit
    import psycopg

    with psycopg.connect(DB, connect_timeout=10) as conn:
        row = conn.execute("select data, file_name from stat_datasets where id = %s", (dataset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "dataset not found")
    blob, name = row
    row = None
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "bin"
    # The app stores uploads gzip-compressed; unpack straight to a temporary file.
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        if bytes(blob[:2]) == b"\x1f\x8b":
            with gzip.GzipFile(fileobj=io.BytesIO(blob)) as gz:
                shutil.copyfileobj(gz, tmp, 1 << 20)
        else:
            tmp.write(blob)
        path = tmp.name
    del blob
    try:
        ds = load_path(path, name)
    finally:
        os.unlink(path)
    BASE.put(dataset_id, ds)
    return ds


def state(dataset_id: str, history: list[str], writable: bool = True) -> Dataset:
    """The working data after `history`. Read-only callers share the cached copy (no extra memory)."""
    key = (dataset_id, tuple(history))
    hit = STATES.get(key) if history else None
    if hit is None:
        hit = apply_history(fetch(dataset_id), history) if history else fetch(dataset_id)
        if history:
            STATES.put(key, hit)
    return hit.copy() if writable else hit


def _changes_data(commands: list[str]) -> bool:
    for line in commands:
        try:
            if parse(line).name in DATA_COMMANDS:
                return True
        except StataError:
            return True  # let run_commands report it; be safe
    return False


def overview(ds: Dataset) -> dict:
    return {"nObs": int(len(ds.df)), "nVars": int(ds.df.shape[1]), "variables": variables_meta(ds), "importNotes": ds.import_notes, "importFixes": ds.settings.get("import_fixes", [])}


class LoadBody(BaseModel):
    datasetId: str
    history: list[str] = Field(default_factory=list)


class RunBody(LoadBody):
    commands: list[str]
    lastEstimation: str | None = None  # the session's last model, for predict / estat / margins
    lastMargins: str | None = None  # the session's last margins, for marginsplot


POST_ESTIMATION = ("predict", "estat", "margins", "marginsplot", "lroc", "test", "testparm", "lincom", "di")


def _restore_estimation(ds: Dataset, body: RunBody):
    """Re-fit the session's last model (and margins) when a request starts with post-estimation."""
    from engine.run import run_line

    first = body.commands[0].split()[0].lower() if body.commands and body.commands[0].split() else ""
    if not first.startswith(POST_ESTIMATION) and not any(c.split()[0].lower().startswith(POST_ESTIMATION) for c in body.commands if c.split()):
        return
    if body.lastEstimation and (not ds.last_est or ds.last_est.get("cmd") != body.lastEstimation):
        try:
            run_line(ds, body.lastEstimation)
        except Exception:  # noqa: BLE001 - the command itself will report what is missing
            ds.last_est = None
    if body.lastMargins and any(c.strip().lower().startswith("marginsplot") for c in body.commands) and not any(c.strip().lower().startswith("margins ") or c.strip().lower() == "margins" or c.strip().lower().startswith("margins,") for c in body.commands):
        try:
            run_line(ds, body.lastMargins)
        except Exception:  # noqa: BLE001
            pass


class PythonBody(LoadBody):
    code: str
    title: str = ""


@app.post("/python", dependencies=[Depends(auth)])
def python_(body: PythonBody):
    """Open analysis: approved Python, run in the sandbox against the session's current data."""
    from engine.sandbox import run_python

    try:
        ds = state(body.datasetId, body.history, writable=False)
    except StataError as e:
        raise HTTPException(422, f"Replaying your earlier commands failed: {e}") from e
    try:
        return {"results": [run_python(ds, body.code, body.title)], "changed": False}
    except StataError as e:
        return {"results": [{"command": f"python: {body.title}" if body.title else "python", "ok": False, "error": str(e)}], "changed": False}


class ExportBody(BaseModel):
    title: str = ""
    tables: list[dict]
    images: list[dict] = Field(default_factory=list)
    logs: list[tuple[str, str]] = Field(default_factory=list)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/load", dependencies=[Depends(auth)])
def load(body: LoadBody):
    try:
        return overview(state(body.datasetId, body.history, writable=False))
    except StataError as e:
        raise HTTPException(422, f"Replaying your earlier commands failed: {e}") from e


@app.post("/run", dependencies=[Depends(auth)])
def run(body: RunBody):
    needs_est = any(c.split()[0].lower().startswith(POST_ESTIMATION) for c in body.commands if c.split())
    try:
        ds = state(body.datasetId, body.history, writable=_changes_data(body.commands) or needs_est)
    except StataError as e:
        raise HTTPException(422, f"Replaying your earlier commands failed: {e}") from e
    ds.last_est = None
    ds.last_margins = None
    _restore_estimation(ds, body)
    results = run_commands(ds, body.commands)
    changed = any(r.get("ok") and r.get("changesData") for r in results)
    out = {"results": results, "changed": changed, "lastEstimation": ds.last_est["cmd"] if ds.last_est else None}
    margins_cmds = [r["command"] for r in results if r.get("ok") and r["command"].strip().lower().split()[0] == "margins"]
    if margins_cmds:
        out["lastMargins"] = margins_cmds[-1]
    if changed:
        kept: list[str] = []
        for r in results:
            if not (r.get("ok") and r.get("changesData")):
                continue
            est = (r.get("summary") or {}).get("est")
            if est and (not kept or kept[-1] != est):
                kept.append(est)  # predict needs its model: replaying the history re-fits it
            kept.append(r["command"])
        out["kept"] = kept
        STATES.put((body.datasetId, tuple(body.history + kept)), ds)
        out["dataset"] = overview(ds)
    return out


@app.post("/export/{fmt}", dependencies=[Depends(auth)])
def export(fmt: str, body: ExportBody):
    if fmt == "docx":
        return Response(docx_bytes(body.title, body.tables, body.images), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    if fmt == "xlsx":
        return Response(xlsx_bytes(body.tables, body.logs), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    raise HTTPException(404, "unknown format")


@app.post("/data/{fmt}", dependencies=[Depends(auth)])
def data(fmt: str, body: LoadBody):
    if fmt not in ("dta", "csv"):
        raise HTTPException(404, "unknown format")
    ds = state(body.datasetId, body.history, writable=False)
    return Response(dataset_bytes(ds, fmt), media_type="text/csv" if fmt == "csv" else "application/x-stata-dta")
