"""Suomi NPP bridge: ratio learnt from the overlap, applied to the missing days."""

from datetime import date

import numpy as np
import pandas as pd

from odlar.harmonize import bridge


def _regions():
    return pd.DataFrame({
        "region_id": [1, 2, 3, 4],
        "country": ["az", "az", "az", "ge"],
        "parent_id": [np.nan, 1, 1, np.nan],
        "level": ["country", "district", "district", "country"],
    })


def _weekly(ratio2=0.4, ratio3=0.4, n_weeks=80, j3=1):
    weeks = pd.date_range("2024-01-22", periods=n_weeks, freq="7D")
    rows = []
    for w in weeks:
        rows.append({"region_id": 2, "week": w, "viirs_j1": 100, "viirs_j2": 37, "viirs_n": int(100 * ratio2)})
        rows.append({"region_id": 3, "week": w, "viirs_j1": j3, "viirs_j2": 0, "viirs_n": 0})
        rows.append({"region_id": 4, "week": w, "viirs_j1": 20, "viirs_j2": 3, "viirs_n": 12})
    df = pd.DataFrame(rows)
    parent = df[df.region_id.isin([2, 3])].groupby("week", as_index=False)[["viirs_j1", "viirs_j2", "viirs_n"]].sum()
    return pd.concat([df, parent.assign(region_id=1)], ignore_index=True)


def test_ratio_learnt_and_borrowed():
    r = bridge.fit_ratios(_weekly(j3=0), _regions(), until=pd.Timestamp("2026-11-02"), start=pd.Timestamp("2024-01-22"))
    r2 = r[(r.region_id == 2)].ratio
    assert np.allclose(r2, 0.4, atol=0.01)
    # region 3 saw nothing: it borrows Azerbaijan's ratio, not Georgia's 0.6
    r3 = r[(r.region_id == 3)].ratio
    assert (abs(r3 - 0.4) < 0.01).all()
    # a little evidence of its own (NOAA-20 detections, no S-NPP) pulls it partway down
    r3b = bridge.fit_ratios(_weekly(j3=1), _regions(), until=pd.Timestamp("2026-11-02"), start=pd.Timestamp("2024-01-22"))
    r3b = r3b[r3b.region_id == 3].ratio
    assert ((r3b > 0.2) & (r3b < 0.35)).all()
    assert np.allclose(r[r.region_id == 4].ratio, 0.6, atol=0.02)
    # a region never seen in the overlap still gets a ratio
    assert set(r.region_id) == {1, 2, 3, 4} and r.ratio.notna().all() and (r.ratio_var > 0).all()


def test_apply_daily_and_weekly():
    regions = _regions()
    ratios = bridge.fit_ratios(_weekly(), regions, until=pd.Timestamp("2026-11-02"), start=pd.Timestamp("2024-01-22"))
    days = pd.date_range("2026-10-26", "2026-11-08")
    daily = pd.DataFrame({"region_id": np.repeat([1, 2, 3, 4], len(days)), "date": np.tile(days, 4),
                          "viirs_n": 4, "viirs_j1": 5, "viirs_j2": 5})
    d = bridge.apply_daily(daily, ratios, pd.Timestamp("2026-11-02"))
    before, after = d[d.date < "2026-11-02"], d[d.date >= "2026-11-02"]
    assert (before.snpp_eq == 4).all() and (before.bridged == 0).all()
    assert (after.bridged == 1).all()
    assert np.allclose(after[after.region_id == 2].snpp_eq, 5 * 0.4, atol=0.1)  # NOAA-20 only

    hw = pd.DataFrame({"region_id": np.repeat([1, 2, 3, 4], 2),
                       "week": np.tile(pd.to_datetime(["2026-10-26", "2026-11-02"]), 4),
                       "harmonized": 0.0, "lo": 0.0, "hi": 0.0, "method": "viirs_snpp"})
    out = bridge.apply_weekly(hw, bridge.weekly_sums(d), regions)
    old = out[out.week == "2026-10-26"]
    assert (old.method == "viirs_snpp").all() and (old.harmonized == 0).all()
    new = out[out.week == "2026-11-02"].set_index("region_id")
    assert (new.method == bridge.METHOD).all()
    assert (new.lo <= new.harmonized).all() and (new.harmonized < new.hi).all()
    # the country is the sum of its districts
    assert np.isclose(new.loc[1, "harmonized"], new.loc[2, "harmonized"] + new.loc[3, "harmonized"])


def test_status_out_and_back(tmp_path):
    f = tmp_path / "satellites.json"
    st = bridge.update_status([], date(2026, 11, 14), f)
    assert st["out_from"] == "2026-11-02" and "back_from" not in st
    assert bridge.window(f) == (pd.Timestamp("2026-11-02"), None)
    # S-NPP sends again from 20 Nov
    st = bridge.update_status([date(2026, 11, 20), date(2026, 11, 21)], date(2026, 11, 22), f)
    assert st["back_from"] == "2026-11-20"
    assert bridge.window(f) == (pd.Timestamp("2026-11-02"), pd.Timestamp("2026-11-20"))
    # and stops again later: a new outage starts on its last day
    st = bridge.update_status([date(2026, 12, 1)], date(2026, 12, 6), f)
    assert st["out_from"] == "2026-12-01" and "back_from" not in st
