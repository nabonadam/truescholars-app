"""The Statistics Assistant engine: runs Stata-syntax commands on a stored dataset.

The app stores uploads in Postgres (stat_datasets.data). Every request names a dataset and the
data-changing commands already run in the session (its history); the engine replays them on a
cached copy, so results are always reproducible from the do-file alone.
"""

from __future__ import annotations

import hmac
import os
import threading
from collections import OrderedDict

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from engine.data import Dataset, StataError, load_bytes, variables_meta
from engine.export import dataset_bytes, docx_bytes, xlsx_bytes
from engine.run import apply_history, run_commands

app = FastAPI(title="True Scholars statistics engine", docs_url=None, redoc_url=None)
KEY = os.environ.get("STATS_KEY", "")
DB = os.environ.get("DATABASE_URL", "")


def auth(x_stats_key: str = Header(default="")):
    if not KEY or not hmac.compare_digest(x_stats_key, KEY):
        raise HTTPException(401, "unauthorized")


class LRU:
    """Small in-memory cache: raw datasets by id, and replayed states by (id, history)."""

    def __init__(self, size: int):
        self.size, self.items, self.lock = size, OrderedDict(), threading.Lock()

    def get(self, key):
        with self.lock:
            if key in self.items:
                self.items.move_to_end(key)
                return self.items[key]
        return None

    def put(self, key, value):
        with self.lock:
            self.items[key] = value
            self.items.move_to_end(key)
            while len(self.items) > self.size:
                self.items.popitem(last=False)


BASE = LRU(8)
STATES = LRU(16)


def fetch(dataset_id: str) -> Dataset:
    hit = BASE.get(dataset_id)
    if hit:
        return hit
    import psycopg

    with psycopg.connect(DB, connect_timeout=10) as conn:
        row = conn.execute("select data, file_name from stat_datasets where id = %s", (dataset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "dataset not found")
    ds = load_bytes(bytes(row[0]), row[1])
    BASE.put(dataset_id, ds)
    return ds


def state(dataset_id: str, history: list[str]) -> Dataset:
    key = (dataset_id, tuple(history))
    hit = STATES.get(key)
    if hit:
        return hit.copy()
    ds = apply_history(fetch(dataset_id), history)
    STATES.put(key, ds)
    return ds.copy()


def overview(ds: Dataset) -> dict:
    return {"nObs": int(len(ds.df)), "nVars": int(ds.df.shape[1]), "variables": variables_meta(ds)}


class LoadBody(BaseModel):
    datasetId: str
    history: list[str] = Field(default_factory=list)


class RunBody(LoadBody):
    commands: list[str]


class ExportBody(BaseModel):
    title: str = ""
    tables: list[dict]
    logs: list[tuple[str, str]] = Field(default_factory=list)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/load", dependencies=[Depends(auth)])
def load(body: LoadBody):
    try:
        return overview(state(body.datasetId, body.history))
    except StataError as e:
        raise HTTPException(422, f"Replaying your earlier commands failed: {e}") from e


@app.post("/run", dependencies=[Depends(auth)])
def run(body: RunBody):
    try:
        ds = state(body.datasetId, body.history)
    except StataError as e:
        raise HTTPException(422, f"Replaying your earlier commands failed: {e}") from e
    results = run_commands(ds, body.commands)
    changed = any(r.get("ok") and r.get("changesData") for r in results)
    out = {"results": results, "changed": changed}
    if changed:
        kept = [r["command"] for r in results if r.get("ok") and r.get("changesData")]
        STATES.put((body.datasetId, tuple(body.history + kept)), ds.copy())
        out["dataset"] = overview(ds)
    return out


@app.post("/export/{fmt}", dependencies=[Depends(auth)])
def export(fmt: str, body: ExportBody):
    if fmt == "docx":
        return Response(docx_bytes(body.title, body.tables), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    if fmt == "xlsx":
        return Response(xlsx_bytes(body.tables, body.logs), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    raise HTTPException(404, "unknown format")


@app.post("/data/{fmt}", dependencies=[Depends(auth)])
def data(fmt: str, body: LoadBody):
    if fmt not in ("dta", "csv"):
        raise HTTPException(404, "unknown format")
    ds = state(body.datasetId, body.history)
    return Response(dataset_bytes(ds, fmt), media_type="text/csv" if fmt == "csv" else "application/x-stata-dta")
