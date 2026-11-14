import io
from datetime import date

import httpx
import pandas as pd
import pytest
import respx

from odlar.config import BBox
from odlar.ingest import firms

MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type
40.1,47.2,320.1,1.0,1.0,2010-08-01,0730,Terra,MODIS,85,6.03,300.1,25.3,D,0
40.2,47.3,310.4,1.0,1.0,2010-08-01,1030,Aqua,MODIS,12,6.03,298.0,5.1,D,0
40.4,49.9,330.0,1.0,1.0,2010-08-02,1030,Aqua,MODIS,95,6.03,301.0,80.0,D,2
"""

VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type
40.1,47.2,330.0,0.4,0.4,2016-07-15,1003,N,VIIRS,n,2,290.0,3.2,D,0
40.1,47.2,320.0,0.4,0.4,2016-07-15,1003,N,VIIRS,l,2,290.0,1.1,D,0
40.1,47.3,350.0,0.4,0.4,2016-07-15,1003,N,VIIRS,h,2,295.0,10.0,N,0
"""


def test_normalize_modis():
    out = firms.normalize(pd.read_csv(io.StringIO(MODIS_CSV)), "MODIS_SP")
    assert list(out.columns) == firms.COLUMNS
    assert out["satellite"].tolist() == ["T", "A", "A"]
    assert out["sensor"].eq("MODIS").all()
    assert out["acq_date"].iloc[0] == date(2010, 8, 1)
    assert out["confidence"].tolist() == [85, 12, 95]


def test_normalize_viirs_confidence_mapping():
    out = firms.normalize(pd.read_csv(io.StringIO(VIIRS_CSV)), "VIIRS_SNPP_SP")
    assert out["confidence"].tolist() == [60, 30, 90]
    assert out["satellite"].eq("N").all()


def test_normalize_empty():
    assert firms.normalize(pd.DataFrame(), "MODIS_SP").empty


def test_quality_filter_drops_low_conf_and_static():
    m = firms.normalize(pd.read_csv(io.StringIO(MODIS_CSV)), "MODIS_SP")
    v = firms.normalize(pd.read_csv(io.StringIO(VIIRS_CSV)), "VIIRS_SNPP_SP")
    out = firms.quality_filter(pd.concat([m, v], ignore_index=True))
    assert len(out) == 3  # 1 MODIS (conf 85) + 2 VIIRS (n, h)
    assert (out["type"] == 0).all()


def test_persistent_source_mask_flags_flare():
    days = pd.date_range("2015-01-01", "2018-12-31", freq="3D")
    flare = pd.DataFrame({"lat": 40.4201, "lon": 49.9301, "acq_date": days.date})
    fire = pd.DataFrame({"lat": [40.0, 41.0], "lon": [47.0, 46.0], "acq_date": [date(2016, 8, 1), date(2017, 8, 1)]})
    df = pd.concat([flare, fire], ignore_index=True)
    mask = firms.persistent_source_mask(df)
    assert mask.iloc[: len(flare)].all()
    assert not mask.iloc[len(flare):].any()
    # the refresh applies the saved cells to new detections only
    cells = firms.persistent_cells(df)
    late = pd.DataFrame({"lat": [40.4201, 40.0], "lon": [49.9301, 47.0], "acq_date": [date(2026, 10, 1)] * 2})
    assert firms.in_cells(late, cells).tolist() == [True, False]


def test_date_windows_cover_range_exactly():
    wins = list(firms.date_windows(date(2020, 1, 1), date(2020, 1, 25)))
    assert wins == [(date(2020, 1, d), 5) for d in (1, 6, 11, 16, 21)]
    assert sum(n for _, n in wins) == 25


def test_client_requires_key():
    with pytest.raises(ValueError):
        firms.FirmsClient("")


@respx.mock
def test_client_caches_and_retries(tmp_path):
    route = respx.get(url__regex=r".*/api/area/csv/KEY/VIIRS_SNPP_SP/.*").mock(
        side_effect=[httpx.Response(500), httpx.Response(200, text=VIIRS_CSV)])
    client = firms.FirmsClient("KEY", cache_dir=tmp_path, min_interval=0)
    bbox = BBox(46, 39, 48, 41)
    df = client.fetch("VIIRS_SNPP_SP", date(2016, 7, 15), date(2016, 7, 19), bbox)
    assert len(df) == 3 and route.call_count == 2
    df2 = client.fetch("VIIRS_SNPP_SP", date(2016, 7, 15), date(2016, 7, 19), bbox)
    assert len(df2) == 3 and route.call_count == 2  # served from cache


@respx.mock
def test_client_handles_empty_window(tmp_path):
    respx.get(url__regex=r".*/api/area/csv/.*").mock(return_value=httpx.Response(200, text="latitude,longitude\n"))
    client = firms.FirmsClient("KEY", cache_dir=tmp_path, min_interval=0)
    assert client.fetch("MODIS_SP", date(2005, 1, 1), date(2005, 1, 3)).empty


@respx.mock
def test_client_raises_on_invalid_key(tmp_path, monkeypatch):
    monkeypatch.setattr(firms.time, "sleep", lambda s: None)
    respx.get(url__regex=r".*").mock(return_value=httpx.Response(200, text="Invalid MAP_KEY."))
    client = firms.FirmsClient("BAD", cache_dir=tmp_path, min_interval=0)
    with pytest.raises(httpx.HTTPError):
        client.area_csv("MODIS_SP", BBox(1, 1, 2, 2), date(2005, 1, 1), 1)


@respx.mock
def test_client_sets_a_rejected_key_aside_and_keeps_going(tmp_path):
    respx.get(url__regex=r".*/api/area/csv/BAD/.*").mock(return_value=httpx.Response(400, text="Invalid MAP_KEY."))
    good = respx.get(url__regex=r".*/api/area/csv/GOOD/.*").mock(return_value=httpx.Response(200, text=VIIRS_CSV))
    client = firms.FirmsClient("BAD,GOOD", cache_dir=tmp_path, min_interval=0)
    assert len(client.area_csv("VIIRS_SNPP_SP", BBox(46, 39, 48, 41), date(2016, 7, 15), 5)) == 3
    assert client.map_key == "GOOD" and good.call_count == 1


@respx.mock
def test_client_waits_when_every_key_is_at_its_limit(tmp_path, monkeypatch):
    waits = []
    monkeypatch.setattr(firms.time, "sleep", lambda s: waits.append(s))
    route = respx.get(url__regex=r".*/api/area/csv/.*").mock(side_effect=[
        httpx.Response(400, text="Invalid MAP_KEY."), httpx.Response(400, text="Invalid MAP_KEY."),
        httpx.Response(200, text=VIIRS_CSV)])
    client = firms.FirmsClient("K1,K2", cache_dir=tmp_path, min_interval=0)
    assert len(client.area_csv("VIIRS_SNPP_SP", BBox(46, 39, 48, 41), date(2016, 7, 15), 5)) == 3
    assert 120 in waits and route.call_count == 3
