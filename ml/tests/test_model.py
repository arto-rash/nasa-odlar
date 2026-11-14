import numpy as np
import pandas as pd
import pytest

from odlar.config import RISK_LEVELS, risk_level
from odlar.ingest.ndvi import climatological_ndvi
from odlar.ingest.synthetic import add_dryness
from odlar.model import predict, train
from odlar.model.features import FEATURES, OUTLOOK_FEATURES, build_panel, daily_series

CLIM_YEARS = list(range(2008, 2015))


@pytest.fixture(scope="module")
def series(daily, harmonized):
    s = daily_series(daily, harmonized.weekly)
    return s[s.region_id.isin([1, 2])].reset_index(drop=True)


@pytest.fixture(scope="module")
def wx(weather):
    return add_dryness(weather)


@pytest.fixture(scope="module")
def panel(series, wx, regions):
    nd = climatological_ndvi(regions[regions.level != "country"], pd.date_range("2008-01-01", "2017-12-31"))
    return build_panel(series, wx, regions, CLIM_YEARS, nd, pd.Series({1: 120.0, 2: 300.0}))


def test_daily_series_matches_weekly_harmonized(series, harmonized):
    s = series.assign(week=series.date - pd.to_timedelta(series.date.dt.day_of_week, unit="D"))
    full = s.groupby(["region_id", "week"]).date.transform("size") == 7  # skip partial edge weeks
    wk = s[full].groupby(["region_id", "week"]).value.sum()
    hw = harmonized.weekly.set_index(["region_id", "week"]).harmonized.reindex(wk.index)
    np.testing.assert_allclose(wk.to_numpy(), hw.to_numpy(), rtol=1e-6, atol=1e-6)


def test_raw_series_jumps_at_viirs(daily, harmonized):
    raw = daily_series(daily, harmonized.weekly, "raw")
    raw = raw[raw.region_id.isin([1, 2])]
    yr = raw.groupby(raw.date.dt.year).value.sum()
    assert yr.loc[2013:2016].mean() > 2.0 * yr.loc[2008:2011].mean()


def test_panel_has_all_features(panel):
    missing = [f for f in FEATURES + OUTLOOK_FEATURES if f not in panel]
    assert not missing
    core = panel[(panel.date > "2008-04-01") & (panel.date < "2017-09-01")]
    assert core[FEATURES].isna().mean().max() < 0.01


def test_labels_are_next_seven_days(panel):
    p = panel[panel.region_id == 1].set_index("date")
    t = pd.Timestamp("2015-07-10")
    expect = p.loc[t + pd.Timedelta(days=1): t + pd.Timedelta(days=7), "value"].sum()
    assert p.loc[t, "target_sum7"] == pytest.approx(expect)
    assert p.loc[t, "target_event"] == float(expect > p.loc[t, "threshold7"])
    assert p["target_event"].dropna().isin([0.0, 1.0]).all()


def test_no_future_leakage(series, wx, regions):
    """Features at t must not change when activity after t changes."""
    t0 = pd.Timestamp("2016-06-01")
    a = build_panel(series, wx, regions, CLIM_YEARS)
    s2 = series.copy()
    s2.loc[s2.date > t0, "value"] = s2.loc[s2.date > t0, "value"] * 5 + 3
    b = build_panel(s2, wx, regions, CLIM_YEARS)
    cols = [f for f in FEATURES if not f.startswith("fc_")]
    ra = a[a.date == t0].set_index("region_id")[cols]
    rb = b[b.date == t0].set_index("region_id")[cols]
    pd.testing.assert_frame_equal(ra, rb)
    # ...while the label does change
    assert not np.allclose(a[a.date == t0].target_sum7, b[b.date == t0].target_sum7)


@pytest.fixture(scope="module")
def model(panel):
    yr = panel.date.dt.year
    return train.fit_short(panel[yr <= 2015])


def test_model_beats_climatology(panel, model):
    yr = panel.date.dt.year
    test = panel[(yr == 2016) & panel.target_event.notna()]
    p = model.proba(test)
    base = train.climatology_baseline(panel[yr <= 2014], test)
    s = train.score(test.target_event.to_numpy(), p, base)
    assert s["roc_auc"] > s["base_roc_auc"]
    assert s["roc_auc"] > 0.6  # two-region toy world; the full world scores ~0.85
    assert s["brier"] < s["base_brier"]


def test_calibration_is_monotone_and_bounded(model, panel):
    assert np.all(np.diff(model.iso_y) >= 0)
    p = model.proba(panel[panel.date.dt.year == 2016].dropna(subset=["target_event"]))
    assert p.min() >= 0 and p.max() <= 1


def test_shap_contributions_sum_to_margin(model, panel):
    rows = panel[panel.date == "2016-07-15"]
    contrib = model.contributions(rows)
    margin = model.clf.predict_proba(rows[FEATURES], raw_score=True)
    np.testing.assert_allclose(contrib.sum(axis=1), margin, rtol=1e-5, atol=1e-5)


def test_drivers_payload(model, panel):
    rows = panel[panel.date == "2016-07-15"].reset_index(drop=True)
    contrib = model.contributions(rows)
    d = predict.drivers(contrib[0], rows.iloc[0])
    assert 1 <= len(d) <= 4
    assert all({"code", "impact", "direction", "value"} <= set(x) for x in d)
    ups = [x for x in d if x["direction"] == "up"]
    assert all(ups[i]["impact"] >= ups[i + 1]["impact"] for i in range(len(ups) - 1))


def test_save_load_roundtrip(tmp_path, model, panel):
    yr = panel.date.dt.year
    ol = train.fit_outlook(panel[yr <= 2015])
    train.save(model, ol, {"x": 1}, tmp_path)
    loaded = train.load(tmp_path)
    rows = panel[panel.date == "2016-08-01"]
    np.testing.assert_allclose(loaded.proba(rows), model.proba(rows), atol=1e-9)
    q = loaded.outlook_q(rows)
    assert q.shape == (len(rows), 3) and np.all(np.diff(q, axis=1) >= 0)


def test_rolling_origin_evaluation(panel):
    rep = train.evaluate(panel, [2016, 2017], sample_every=3)
    assert rep["overall"]["n"] > 0
    assert 0 <= rep["overall"]["pr_auc"] <= 1
    assert len(rep["by_year"]) >= 1
    assert all("observed" in r for r in rep["reliability"])


def test_risk_levels():
    assert risk_level(0.0) == "low"
    assert risk_level(0.45) == "high"
    assert risk_level(0.95) == "extreme"
    assert len(RISK_LEVELS) == 5


def test_fire_weather_daily_ranks(wx):
    fc = pd.DataFrame({"region_id": [1, 1], "date": pd.to_datetime(["2017-07-20", "2017-07-21"]),
                       "tmax": [42.0, 15.0], "tmean": [33.0, 10.0], "rh": [10.0, 95.0], "wind": [9.0, 0.5],
                       "precip": [0.0, 30.0]})
    out = predict.fire_weather_daily(fc, wx)
    assert out.danger.iloc[0] > 90 and out.danger.iloc[1] < 10
