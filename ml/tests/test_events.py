import numpy as np
import pandas as pd

from odlar.events import build_events


def _det(lat, lon, day, sensor="VIIRS", frp=5.0, region=7):
    return {"sensor": sensor, "acq_date": pd.Timestamp(day), "lat": lat, "lon": lon, "frp": frp, "region_id": region}


def test_neighbouring_pixels_over_days_are_one_fire():
    rows = [_det(40.0 + 0.004 * i, 47.0 + 0.003 * i, f"2026-11-0{1 + i % 5}") for i in range(12)]
    rows.append(_det(40.01, 47.01, "2026-11-04", "MODIS", 30.0))
    rows.append(_det(41.5, 48.5, "2026-11-09", frp=2.0, region=9))  # far away: its own fire
    ev = build_events(pd.DataFrame(rows), "2026-11-10")
    assert len(ev) == 2
    big = ev.iloc[0]
    assert big["detections"] == 13 and big["modis"] == 1 and big["viirs"] == 12
    assert big["first_seen"] == pd.Timestamp("2026-11-01") and big["days"] == 5
    assert big["frp_max"] == 30.0 and big["region_id"] == 7
    assert big["west"] <= big["lon"] <= big["east"] and big["south"] <= big["lat"] <= big["north"]
    small = ev.iloc[1]
    assert small["active"] and small["region_id"] == 9 and small["detections"] == 1


def test_window_and_activity():
    rows = [_det(40.0, 47.0, "2026-10-01"), _det(40.0, 47.0, "2026-11-03"), _det(42.0, 45.0, "2026-11-10")]
    ev = build_events(pd.DataFrame(rows), "2026-11-10")
    assert len(ev) == 2  # 1 October is outside the 14 days
    assert set(ev["active"]) == {True, False}


def test_ids_are_stable_as_the_fire_grows():
    base = [_det(40.0, 47.0, "2026-11-02"), _det(40.005, 47.0, "2026-11-03")]
    a = build_events(pd.DataFrame(base), "2026-11-03")
    b = build_events(pd.DataFrame(base + [_det(40.01, 47.005, "2026-11-04")]), "2026-11-04")
    assert a["event_id"].iat[0] == b["event_id"].iat[0]


def test_empty_and_many():
    assert build_events(pd.DataFrame(columns=["sensor", "acq_date", "lat", "lon", "frp", "region_id"]), "2026-11-10").empty
    rng = np.random.default_rng(0)
    n = 50_000
    big = pd.DataFrame({"sensor": "VIIRS", "acq_date": pd.Timestamp("2026-11-05"), "lat": rng.uniform(0, 10, n),
                        "lon": rng.uniform(0, 10, n), "frp": 3.0, "region_id": 1})
    ev = build_events(big, "2026-11-10")
    assert ev["detections"].sum() == n
