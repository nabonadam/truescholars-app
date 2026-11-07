from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
from engine.data import load_bytes

SAMPLE = Path(__file__).resolve().parents[1] / "sample" / "ghana_households_simulated.dta"
H = {"X-Stats-Key": "k"}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(main, "KEY", "k")
    base = load_bytes(SAMPLE.read_bytes(), "s.dta")
    monkeypatch.setattr(main, "fetch", lambda _id: base)
    main.STATES.items.clear()
    return TestClient(main.app)


def test_auth(client):
    assert client.post("/load", json={"datasetId": "x"}).status_code == 401
    assert client.post("/load", json={"datasetId": "x"}, headers={"X-Stats-Key": "bad"}).status_code == 401


def test_run_with_history_and_exports(client):
    r = client.post("/run", headers=H, json={"datasetId": "d", "history": [], "commands": ["mvdecode income, mv(99999)", "gen lninc = ln(income)"]}).json()
    assert r["changed"] and any(v["name"] == "lninc" for v in r["dataset"]["variables"])
    hist = ["mvdecode income, mv(99999)", "gen lninc = ln(income)"]
    r = client.post("/run", headers=H, json={"datasetId": "d", "history": hist, "commands": ["regress wellbeing lninc i.urban"]}).json()
    res = r["results"][0]
    assert res["ok"] and "Number of obs" in res["log"] and not r["changed"]
    docx = client.post("/export/docx", headers=H, json={"title": "Results", "tables": res["tables"]})
    assert docx.status_code == 200 and docx.content[:2] == b"PK"
    xlsx = client.post("/export/xlsx", headers=H, json={"tables": res["tables"], "logs": [["regress wellbeing lninc i.urban", res["log"]]]})
    assert xlsx.status_code == 200
    dta = client.post("/data/dta", headers=H, json={"datasetId": "d", "history": hist})
    back = load_bytes(dta.content, "x.dta")
    assert "lninc" in back.df and back.value_label("region", 1) == load_bytes(SAMPLE.read_bytes(), "s.dta").value_label("region", 1)


def test_gzip_storage_and_shared_cache(monkeypatch):
    """Stored uploads are gzip-compressed; analyses reuse the cached data without changing it."""
    import gzip

    import main

    raw = SAMPLE.read_bytes()

    class Conn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, *_a):
            class R:
                def fetchone(self_inner):
                    return (gzip.compress(raw), "s.dta")

            return R()

    import psycopg

    monkeypatch.setattr(psycopg, "connect", lambda *a, **k: Conn())
    monkeypatch.setattr(main, "KEY", "k")
    main.BASE.items.clear()
    main.STATES.items.clear()
    c = TestClient(main.app)
    r = c.post("/run", headers=H, json={"datasetId": "z", "history": [], "commands": ["summarize age"]}).json()
    assert r["results"][0]["ok"] and not r["changed"]
    r = c.post("/run", headers=H, json={"datasetId": "z", "history": [], "commands": ["gen a2 = age*2"]}).json()
    assert r["changed"]
    base = main.BASE.get("z")
    assert "a2" not in base.df  # the shared original was not modified
    r = c.post("/run", headers=H, json={"datasetId": "z", "history": ["gen a2 = age*2"], "commands": ["summarize a2"]}).json()
    assert r["results"][0]["ok"]


def test_model_is_remembered_between_requests(client):
    r1 = client.post("/run", headers=H, json={"datasetId": "d", "history": [], "commands": ["logit food_insecure age i.urban"]}).json()
    est = r1["lastEstimation"]
    assert est == "logit food_insecure age i.urban"
    r2 = client.post("/run", headers=H, json={"datasetId": "d", "history": [], "commands": ["margins urban", "predict p"], "lastEstimation": est}).json()
    assert all(x["ok"] for x in r2["results"]), r2["results"]
    assert r2["lastMargins"] == "margins urban" and r2["changed"]
    hist = [h for h in [est, "predict p"]]
    r3 = client.post("/run", headers=H, json={"datasetId": "d", "history": hist, "commands": ["marginsplot", "summarize p"], "lastEstimation": est, "lastMargins": "margins urban"}).json()
    assert r3["results"][0]["ok"] and r3["results"][0]["images"] and r3["results"][1]["ok"]
    r4 = client.post("/run", headers=H, json={"datasetId": "d", "history": [], "commands": ["estat vif"]}).json()
    assert not r4["results"][0]["ok"] and "last estimates not found" in r4["results"][0]["error"]
