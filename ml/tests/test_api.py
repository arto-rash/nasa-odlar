"""Endpoint tests against the built store (skipped when no store exists)."""

import pytest
from fastapi.testclient import TestClient

from odlar.config import STORE_DIR

pytestmark = pytest.mark.skipif(not (STORE_DIR / "meta.json").exists(), reason="no store built")


@pytest.fixture(scope="module")
def client():
    from odlar.api.main import app
    return TestClient(app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_overview(client):
    d = client.get("/overview").json()
    assert d["n_regions"] >= 104 and {"az", "ge", "am"} <= set(d["countries"])
    assert abs(d["skill"]["bias"]) < 0.15 and d["skill"]["raw_modis_bias"] < -0.4
    assert d["model"]["harmonized"]["brier_skill"] > d["model"]["raw"]["brier_skill"]
    assert d["pilot"] and d["risk_top"]


def test_regions_and_geojson(client):
    rs = client.get("/regions").json()
    pilot = [r for r in rs if r["country"] in ("az", "ge", "am")]
    assert len(pilot) == 104 and all("risk" in r for r in rs)  # plus any other built batch
    assert len({r["id"] for r in rs}) == len(rs)
    assert any(r["annual"] for r in rs if r["level"] != "country")
    gj = client.get("/regions/geojson").json()
    assert gj["type"] == "FeatureCollection" and len(gj["features"]) == len(rs)


def test_region_detail_and_404(client):
    d = client.get("/regions/az-sabirabad").json()
    assert d["name_az"] == "Sabirabad rayonu" and d["stats"]["trend"]["p_value"] <= 1
    assert client.get("/regions/nowhere").status_code == 404


def test_locate(client):
    assert client.get("/regions/locate", params={"lat": 39.9, "lon": 48.8}).json()["region"]["slug"] == "az-sabirabad"
    assert client.get("/regions/locate", params={"lat": 0, "lon": -30}).status_code == 404  # mid-Atlantic
    assert client.get("/regions/locate", params={"lat": 100, "lon": 10}).status_code == 422


def test_series(client):
    w = client.get("/series/az/weekly", params={"start": "2010-01-01", "end": "2010-12-31"}).json()
    assert 50 <= len(w) <= 53 and all(x["lo"] <= x["hi"] for x in w)
    a = client.get("/series/az/annual").json()
    assert a["trend"]["naive"]["pct_per_decade"] > a["trend"]["harmonized"]["pct_per_decade"]


def test_calendar(client):
    c = client.get("/calendar/az").json()
    assert c["years"][0] == 2001 and len(c["matrix"][0]) == 52
    assert len(c["raw_matrix"]) == len(c["matrix"])
    m = c["month"]
    assert m["end"] <= c["coverage"]["end"] and 1 <= m["rank"] <= m["n_years"] and m["raw"]["value"] >= 0


def test_risk(client):
    r = client.get("/risk/az-sabirabad").json()
    assert 0 <= r["short"]["probability"] <= 1 and len(r["daily"]) >= 7
    assert r["outlook"]["q10"] <= r["outlook"]["q50"] <= r["outlook"]["q90"]
    country = client.get("/risk/az").json()
    assert country["short"]["hotspots"]
    m = client.get("/risk").json()
    assert m == sorted(m, key=lambda x: -x["probability"])


def test_forecast(client):
    f = client.get("/forecast/az-sabirabad").json()
    assert len(f["weeks"]) == 52 and len(f["days"]) >= 7
    ahead = [w for w in f["weeks"] if w["kind"] == "outlook"]
    assert len(ahead) == 13 and all(w["q10"] <= w["q50"] <= w["q90"] for w in ahead)
    assert abs(sum(w["q50"] for w in ahead) - f["outlook"]["q50"]) < 0.5
    assert f["weeks"][0]["week"] > f["as_of"] and 0 < f["reliability"]["week_auc"] <= 1
    assert client.get("/forecast/az").status_code == 200
    m = client.get(f"/forecast/map?week={f['weeks'][0]['week']}&bbox=44,38,51,42").json()
    assert m["week"] == f["weeks"][0]["week"] and isinstance(m["values"], list)


def test_events(client):
    r = client.get("/events?bbox=44,38,51,42&limit=5").json()
    assert set(r) == {"total", "events"} and len(r["events"]) <= 5
    if r["events"]:
        sums = [e["frp_sum"] for e in r["events"]]
        assert sums == sorted(sums, reverse=True)
        e = r["events"][0]
        d = client.get(f"/events/{e['id']}").json()
        assert d["detections"] == e["detections"]
        assert sum(x["modis"] + x["viirs"] for x in d["per_day"]) >= 1
    assert client.get("/events/not-an-id").status_code == 422
    assert client.get("/events/1.000_2.000_20000101").status_code == 404


def test_hotspots_limits(client):
    h = client.get("/hotspots", params={"start": "2025-08-01", "end": "2025-08-07", "sensor": "VIIRS"}).json()
    assert h["total"] > 0 and all(p[2] == "V" for p in h["points"])
    assert client.get("/hotspots", params={"start": "2025-01-01", "end": "2025-12-31"}).status_code == 422


def test_aoi(client):
    poly = {"type": "Polygon", "coordinates": [[[48.5, 39.7], [49.1, 39.7], [49.1, 40.1], [48.5, 40.1], [48.5, 39.7]]]}
    d = client.post("/aoi/summary", json={"geometry": poly}).json()
    assert d["detections"] > 0 and "az-sabirabad" in d["regions"] and len(d["calendar"]["matrix"][0]) == 52
    bad = {"type": "Point", "coordinates": [48, 40]}
    assert client.post("/aoi/summary", json={"geometry": bad}).status_code == 422


def test_skill_and_report(client):
    s = client.get("/harmonization/skill", params={"region": "az-sabirabad"}).json()
    assert s["transfer"] and s["loyo_annual"]
    rep = client.get("/model/report").json()
    assert rep["importance"][0]["gain"] > 0


def test_exports(client):
    r = client.get("/export/az-sabirabad", params={"kind": "annual", "format": "csv"})
    assert r.headers["content-type"].startswith("text/csv")
    assert 'filename="odlar_az-sabirabad_annual.csv"' in r.headers["content-disposition"]
    g = client.get("/export/az-sabirabad", params={"kind": "hotspots", "format": "geojson", "start": "2025-07-01", "end": "2025-07-31"})
    assert g.json()["type"] == "FeatureCollection"
    assert client.get("/export/az", params={"kind": "weekly", "format": "geojson"}).status_code == 422


def test_cache_headers(client):
    r = client.get("/regions/az")
    assert "max-age" in r.headers["cache-control"] and r.headers["etag"]


def test_internal_token(monkeypatch, client):
    import odlar.api.main as m
    monkeypatch.setattr(m, "INTERNAL_TOKEN", "secret")
    assert client.get("/overview").status_code == 401
    assert client.get("/overview", headers={"X-Internal-Token": "secret"}).status_code == 200
