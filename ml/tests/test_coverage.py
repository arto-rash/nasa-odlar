import numpy as np
import pandas as pd

from odlar.api.service import find_gaps


def _weeks(n: int, start: str = "2010-01-04") -> pd.DataFrame:
    weeks = pd.date_range(start, periods=n, freq="7D")
    season = 1000 + 600 * np.sin(np.arange(n) / 52 * 2 * np.pi)  # a smooth yearly cycle
    return pd.DataFrame({"week": weeks.strftime("%Y-%m-%d"), "modis": season.round(), "viirs": (season * 8).round()})


def test_outage_of_the_base_sensor_is_a_gap():
    w = _weeks(120)
    w.loc[30, "modis"] = 0          # MODIS off before VIIRS: nothing observed
    w.loc[31, "modis"] *= 0.3       # partly back
    gaps = find_gaps(w, pd.Timestamp("2030-01-01"))
    assert gaps == [{"week": w.loc[30, "week"], "level": "none"}, {"week": w.loc[31, "week"], "level": "reduced"}]


def test_modis_outage_after_viirs_costs_nothing():
    w = _weeks(120)
    w.loc[60, "modis"] = 0
    assert find_gaps(w, pd.Timestamp("2010-01-04")) == []


def test_newest_week_is_partial_not_a_gap():
    w = _weeks(60)
    w.loc[59, "viirs"] = 10
    assert find_gaps(w, pd.Timestamp("2010-01-04")) == []


def test_quiet_stretches_are_ignored():
    w = _weeks(60)
    w[["modis", "viirs"]] = 20
    w.loc[30, "viirs"] = 0
    assert find_gaps(w, pd.Timestamp("2010-01-04")) == []
