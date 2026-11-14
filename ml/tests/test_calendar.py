import numpy as np
import pandas as pd
import pytest

from odlar.calendar.engine import (
    anomalies,
    build_calendar,
    circular_smooth,
    climatology,
    complete_years,
    current_status,
    season_profile,
    year_matrix,
    year_metrics,
)


def make_series(years, curve_fn, seed=0, overrides=None):
    rng = np.random.default_rng(seed)
    weeks = pd.date_range(f"{years[0]}-01-01", f"{years[-1]}-12-31", freq="W-MON")
    woy = np.minimum((weeks.day_of_year - 1) // 7, 51)
    lam = np.array([curve_fn(w) for w in woy], dtype=float)
    for (year, mult, wk_shift) in (overrides or []):
        m = weeks.year == year
        lam[m] = np.array([curve_fn((w - wk_shift) % 52) for w in woy[m]]) * mult
    return pd.DataFrame({"week": weeks, "harmonized": rng.poisson(lam).astype(float)})


def summer(w):
    return 40 * np.exp(-0.5 * ((w - 30) / 3.5) ** 2) + 0.2


def bimodal(w):
    return 25 * np.exp(-0.5 * ((w - 12) / 2.5) ** 2) + 40 * np.exp(-0.5 * ((w - 31) / 3) ** 2) + 0.2


def winter(w):
    d = min(abs(w - 1), 52 - abs(w - 1))
    return 30 * np.exp(-0.5 * (d / 3) ** 2) + 0.2


YEARS = list(range(2001, 2026))


def test_year_matrix_shape():
    s = make_series(YEARS, summer)
    m = year_matrix(s)
    assert m.shape == (25, 52)
    assert m.to_numpy().sum() == pytest.approx(s.harmonized.sum())


def test_single_summer_season_timing():
    s = make_series(YEARS, summer)
    clim = climatology(year_matrix(s), complete_years(s))
    prof = season_profile(clim)
    assert 24 <= prof.start <= 27
    assert 33 <= prof.end <= 36
    assert prof.peak_week in (29, 30, 31)
    assert not prof.bimodal
    assert prof.critical[0].start <= 30 <= prof.critical[0].end
    assert prof.critical[0].share > 0.5


def test_bimodal_detection():
    s = make_series(YEARS, bimodal)
    prof = season_profile(climatology(year_matrix(s), YEARS))
    assert prof.bimodal
    weeks = sorted(p.week for p in prof.peaks[:2])
    assert abs(weeks[0] - 12) <= 1 and abs(weeks[1] - 31) <= 1
    assert len(prof.critical) >= 2


def test_season_wrapping_new_year():
    s = make_series(YEARS, winter)
    prof = season_profile(climatology(year_matrix(s), YEARS))
    assert prof.start >= 45 or prof.start <= 1  # starts in late December
    assert 2 <= prof.end <= 6
    assert prof.length < 15


def test_anomaly_detection_high_total_and_early_start():
    s = make_series(YEARS, summer, overrides=[(2010, 3.0, 0), (2018, 1.0, -5)])
    m = year_matrix(s)
    prof = season_profile(climatology(m, YEARS))
    a = anomalies(year_metrics(m, prof.offset), prof.offset, YEARS).set_index("year")
    assert a.loc[2010, "anomalous"]
    assert any(r["code"] == "high_total" for r in a.loc[2010, "reasons"])
    assert any(r["code"] == "early_start" for r in a.loc[2018, "reasons"])
    normal = a.drop([2010, 2018])
    assert normal["anomalous"].mean() < 0.15


def test_current_status_percentiles():
    s = make_series(YEARS + [2026], summer, overrides=[(2026, 3.0, 0)])
    s = s[s.week <= "2026-08-03"]
    m = year_matrix(s)
    st = current_status(s, m, YEARS)
    assert st["year"] == 2026
    assert st["ytd_percentile"] > 90
    assert st["ytd_rank"] == 1
    assert st["n_years"] == 25


def test_build_calendar_payload_is_json_ready():
    import json
    s = make_series(YEARS, bimodal)
    raw = s.rename(columns={"harmonized": "value"})
    cal = build_calendar(s, raw=raw)
    json.dumps(cal)
    assert len(cal["matrix"]) == len(cal["years"]) == len(cal["raw_matrix"])
    assert len(cal["climatology"]["mean"]) == 52


def test_empty_region_is_handled():
    s = pd.DataFrame({"week": pd.date_range("2010-01-04", "2015-12-28", freq="W-MON"), "harmonized": 0.0})
    cal = build_calendar(s)
    assert cal["season"]["start"] is None and cal["season"]["peaks"] == []
    assert cal["anomalies"] == []


def test_circular_smooth_preserves_mass():
    v = np.random.default_rng(1).random(52)
    assert circular_smooth(v).sum() == pytest.approx(v.sum())
