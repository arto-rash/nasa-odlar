from datetime import date

import httpx
import numpy as np
import pandas as pd
import respx

from odlar.ingest import openmeteo, power
from odlar.ingest.synthetic import add_dryness

POWER_PAYLOAD = {
    "geometry": {"type": "Point", "coordinates": [47.0, 40.0, 210.5]},
    "properties": {"parameter": {
        "T2M_MAX": {"20240101": 13.2, "20240102": -999.0, "20240103": 15.0},
        "T2M": {"20240101": 8.0, "20240102": 7.0, "20240103": 9.0},
        "RH2M": {"20240101": 70.0, "20240102": 71.0, "20240103": 60.0},
        "WS10M": {"20240101": 3.0, "20240102": 2.5, "20240103": 4.0},
        "PRECTOTCORR": {"20240101": 0.0, "20240102": 5.2, "20240103": 0.0},
    }},
}


def test_parse_power_handles_fill_and_elevation():
    df, elev = power.parse_power(POWER_PAYLOAD)
    assert elev == 210.5
    assert set(df.columns) == {"tmax", "tmean", "rh", "wind", "precip"}
    assert np.isnan(df.loc["2024-01-02", "tmax"])
    assert df.index.name == "date"


@respx.mock
def test_power_uses_re_community_and_caches(tmp_path):
    route = respx.get(power.POWER_URL).mock(return_value=httpx.Response(200, json=POWER_PAYLOAD))
    regions = pd.DataFrame({"region_id": [1], "slug": ["az-test"], "lat": [40.0], "lon": [47.0]})
    w, elev = power.fetch_regions_weather(regions, date(2024, 1, 1), date(2024, 1, 3), cache_dir=tmp_path)
    assert route.calls[0].request.url.params["community"] == "RE"
    assert len(w) == 3 and elev[1] == 210.5
    power.fetch_regions_weather(regions, date(2024, 1, 1), date(2024, 1, 5), cache_dir=tmp_path)
    assert route.call_count == 1  # older cache reused


@respx.mock
def test_power_fetches_once_per_grid_cell(tmp_path):
    route = respx.get(power.POWER_URL).mock(return_value=httpx.Response(200, json=POWER_PAYLOAD))
    # two regions in one 0.5 x 0.625 cell, one in the next cell east
    regions = pd.DataFrame({"region_id": [1, 2, 3], "slug": ["a", "b", "c"],
                            "lat": [40.1, 39.9, 40.0], "lon": [47.1, 46.9, 47.7]})
    w, elev = power.fetch_regions_weather(regions, date(2024, 1, 1), date(2024, 1, 3), cache_dir=tmp_path)
    assert route.call_count == 2
    assert {float(c.request.url.params["longitude"]) for c in route.calls} == {47.5, 46.875}
    assert len(w) == 9 and set(elev.index) == {1, 2, 3}


@respx.mock
def test_openmeteo_shares_points_on_a_grid():
    day = {"time": ["2026-10-25"], "temperature_2m_max": [14], "temperature_2m_mean": [10],
           "relative_humidity_2m_mean": [80], "wind_speed_10m_mean": [2.0], "precipitation_sum": [1.0]}
    route = respx.get(openmeteo.FORECAST_URL).mock(
        side_effect=lambda req: httpx.Response(200, json=[{"daily": day}] * len(req.url.params["latitude"].split(","))))
    regions = pd.DataFrame({"region_id": [1, 2, 3], "lat": [40.2, 39.8, 42.0], "lon": [47.1, 46.9, 47.0]})
    df = openmeteo.fetch_forecast(regions, days=1, step=1.0)
    assert len(route.calls[0].request.url.params["latitude"].split(",")) == 2
    assert sorted(df["region_id"]) == [1, 2, 3]
    exact = openmeteo.fetch_forecast(regions, days=1)
    assert len(route.calls[1].request.url.params["latitude"].split(",")) == 3 and len(exact) == 3


def test_openmeteo_parse_multi():
    payload = [{"daily": {"time": ["2026-10-25", "2026-10-26"], "temperature_2m_max": [14, 17],
                          "temperature_2m_mean": [10, 12], "relative_humidity_2m_mean": [80, 60],
                          "wind_speed_10m_mean": [2.0, 3.0], "precipitation_sum": [1.0, 0.0]}}] * 2
    df = openmeteo.parse(payload, [5, 6])
    assert len(df) == 4 and set(df["region_id"]) == {5, 6}
    assert {"tmax", "rh", "wind", "precip"} <= set(df.columns)


def test_climatological_forecast_shape():
    days = pd.date_range("2020-01-01", "2023-12-31")
    w = pd.DataFrame({"region_id": 1, "date": days, "tmax": 20.0, "tmean": 15.0, "rh": 50.0, "wind": 2.0,
                      "precip": 0.5})
    fc = openmeteo.climatological_forecast(w, pd.Timestamp("2024-06-01"), days=7)
    assert len(fc) == 7 and (fc["precip"] == 0).all()


def test_add_dryness_days_since_rain_resets():
    w = pd.DataFrame({"region_id": 1, "date": pd.date_range("2020-07-01", periods=6),
                      "tmax": 30.0, "tmean": 25.0, "rh": 30.0, "wind": 3.0,
                      "precip": [0, 0, 5, 0, 0, 0]})
    out = add_dryness(w)
    assert out["days_since_rain"].tolist() == [1, 2, 0, 1, 2, 3]
    assert (out["vpd"] > 0).all()
