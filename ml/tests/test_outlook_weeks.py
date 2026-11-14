import numpy as np
import pandas as pd

from odlar.model.predict import outlook_mondays, outlook_weeks, spread_outlook, week_bin


def test_outlook_starts_the_monday_after_the_data_week():
    w = outlook_mondays("2026-11-07", 13)  # a Saturday
    assert w[0] == pd.Timestamp("2026-11-09") and len(w) == 13
    assert all(d.weekday() == 0 for d in w)
    assert outlook_mondays("2026-11-09", 1)[0] == pd.Timestamp("2026-11-16")  # a Monday: its week is filling


def test_week_bin_matches_the_calendar():
    assert list(week_bin(pd.DatetimeIndex(["2026-01-01", "2026-01-07", "2026-01-08", "2026-12-31"]))) == [0, 0, 1, 51]


def test_spread_keeps_totals_and_follows_the_season():
    mean = np.zeros(52)
    mean[45:52] = 10  # a late-year season
    weeks = outlook_mondays("2026-10-01", 13)
    df = spread_outlook({"q10": 5, "q50": 20, "q90": 60}, mean, mean * 0.5, mean * 2, weeks)
    assert np.isclose(df["q50"].sum(), 20) and np.isclose(df["q90"].sum(), 60)
    busy = df["woy"].between(45, 51)
    assert df.loc[busy, "q50"].min() > 10 * df.loc[~busy, "q50"].max()


def test_outlook_weeks_for_many_regions():
    clim = pd.DataFrame({"region_id": np.repeat([1, 2], 52), "woy": np.tile(np.arange(52), 2),
                         "clim_mean": np.r_[np.ones(52), np.zeros(52)], "clim_p10": 0.0, "clim_p90": 2.0})
    now = pd.DataFrame({"region_id": [1, 2, 3], "q10": [1.0, 0.0, 1.0], "q50": [13.0, 1.3, 2.0], "q90": [26.0, 2.6, 3.0]})
    ow = outlook_weeks(now, clim, "2026-11-07")
    assert set(ow["region_id"]) == {1, 2}  # region 3 has no climatology
    assert len(ow) == 26
    r1 = ow[ow["region_id"] == 1]
    assert np.allclose(r1["q50"], 1.0) and np.allclose(r1["normal"], 1.0)
    assert np.isclose(ow.loc[ow["region_id"] == 2, "q50"].sum(), 1.3, atol=0.02)  # no usual season: spread evenly
