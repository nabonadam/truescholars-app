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
