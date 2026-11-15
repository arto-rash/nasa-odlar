"""Wind: gusts and direction pass through the forecast; directions average as vectors."""

import numpy as np
import pandas as pd

from odlar.api.service import _wind_from, _with_wind_vectors
from odlar.model.predict import fire_weather_daily


def _weather(days=60):
    d = pd.date_range("2025-10-01", periods=days)
    return pd.DataFrame({"region_id": 1, "date": d, "tmax": 20.0, "tmean": 15.0, "rh": 50.0, "wind": 3.0, "precip": 0.0})


def test_gust_and_direction_pass_through():
    fc = pd.DataFrame({"region_id": [1, 1], "date": pd.to_datetime(["2026-11-15", "2026-11-16"]), "tmax": [25.0, 18.0],
                       "tmean": [18.0, 12.0], "rh": [30.0, 70.0], "wind": [6.0, 2.0], "precip": [0.0, 5.0],
                       "gust": [14.2, 5.0], "wdir": [315.0, 90.0]})
    out = fire_weather_daily(fc, _weather())
    assert list(out["gust"]) == [14.2, 5.0] and list(out["wdir"]) == [315.0, 90.0]
    # the danger itself ignores gusts (the record it is ranked against has none)
    out2 = fire_weather_daily(fc.assign(gust=99.0), _weather())
    assert list(out["danger"]) == list(out2["danger"])


def test_without_gusts_still_works():
    fc = pd.DataFrame({"region_id": [1], "date": pd.to_datetime(["2026-11-15"]), "tmax": [25.0], "tmean": [18.0],
                       "rh": [30.0], "wind": [6.0], "precip": [0.0]})
    out = fire_weather_daily(fc, _weather())
    assert np.isnan(out["gust"].iloc[0]) and np.isnan(out["wdir"].iloc[0])


def test_directions_average_as_vectors():
    fw = _with_wind_vectors(pd.DataFrame({"wind": [5.0, 5.0], "wdir": [350.0, 10.0]}))
    assert _wind_from(fw["u"].mean(), fw["v"].mean()) in (0.0, 360.0)  # north, not south
    fw = _with_wind_vectors(pd.DataFrame({"wind": [4.0], "wdir": [270.0]}))
    assert _wind_from(fw["u"].mean(), fw["v"].mean()) == 270.0
    assert _wind_from(float("nan"), 1.0) is None
