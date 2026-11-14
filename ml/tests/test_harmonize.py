import numpy as np
import pandas as pd
import pytest

from odlar.config import OVERLAP_START
from odlar.harmonize.engine import aggregate_intervals
from odlar.harmonize.validate import loyo, skill_report

PRE = pd.Timestamp(OVERLAP_START)


def _pre(harmonized, cf):
    m = harmonized.weekly.merge(cf, on=["region_id", "week"])
    return m[(m.week < PRE) & m.region_id.isin([1, 2])]


def test_recovers_counterfactual_viirs_scale(harmonized, counterfactual_weekly, weekly):
    pre = _pre(harmonized, counterfactual_weekly)
    bias = pre.harmonized.sum() / pre.viirs_cf.sum() - 1
    assert abs(bias) < 0.15, bias
    raw = weekly[(weekly.week < PRE) & weekly.region_id.isin([1, 2])].modis.sum()
    assert raw / pre.viirs_cf.sum() < 0.6  # raw MODIS is far below the VIIRS scale


def test_weekly_interval_coverage(harmonized, counterfactual_weekly):
    pre = _pre(harmonized, counterfactual_weekly)
    cov = ((pre.viirs_cf >= pre.lo) & (pre.viirs_cf <= pre.hi)).mean()
    # Two-region toy world; the full 104-region world reaches ~0.9 (see methodology).
    assert cov >= 0.80, cov


def test_annual_correlation_with_truth(harmonized, counterfactual_weekly):
    pre = _pre(harmonized, counterfactual_weekly).assign(year=lambda d: d.week.dt.year)
    a = pre.groupby(["region_id", "year"])[["harmonized", "viirs_cf"]].sum()
    assert a.corr(method="spearman").iloc[0, 1] > 0.7


def test_overlap_weeks_are_reference_sensor(harmonized, weekly):
    post = harmonized.weekly[(harmonized.weekly.week >= PRE) & harmonized.weekly.region_id.isin([1, 2])]
    m = post.merge(weekly[["region_id", "week", "viirs_n"]], on=["region_id", "week"])
    assert (m.harmonized == m.viirs_n).all()
    assert (post.method == "viirs_snpp").all()
    assert (post.lo == post.hi).all()


def test_eras_and_methods(harmonized):
    w = harmonized.weekly
    assert {"terra_aqua", "viirs_snpp"} <= set(w.method)
    assert (w.loc[w.week < pd.Timestamp("2002-07-08"), "method"] == "terra").all()
    assert (w.loc[(w.week >= pd.Timestamp("2002-07-08")) & (w.week < PRE), "method"] == "terra_aqua").all()


def test_country_is_sum_of_children(harmonized):
    w = harmonized.weekly.pivot_table(index="week", columns="region_id", values="harmonized")
    np.testing.assert_allclose(w[3], w[1] + w[2], rtol=1e-6)


def test_intervals_bracket_point_mostly(harmonized):
    w = harmonized.weekly
    pre = w[w.week < PRE]
    assert (pre.lo <= pre.hi).all()
    assert ((pre.harmonized >= pre.lo - 1e-6) & (pre.harmonized <= pre.hi + 1e-6)).mean() > 0.9
    assert (pre.harmonized >= 0).all()


def test_aggregate_intervals_annual(harmonized):
    w = harmonized.weekly[harmonized.weekly.region_id == 1]
    years = pd.Series(w.week.dt.year.to_numpy(), index=pd.DatetimeIndex(w.week))
    iv = aggregate_intervals(harmonized, 1, years)
    pre = iv.loc[iv.index < 2012]
    assert ((pre.lo <= pre.harmonized) & (pre.harmonized <= pre.hi)).all()
    post = iv.loc[iv.index >= 2013]
    assert (post.lo == post.hi).all()
    # annual intervals are narrower, relative to the total, than a naive sum of weekly bounds
    naive = w[w.week < PRE].assign(y=lambda d: d.week.dt.year).groupby("y")[["lo", "hi"]].sum()
    assert ((pre.hi - pre.lo) <= (naive.hi - naive.lo).reindex(pre.index) + 1e-6).all()


def test_transfer_table(harmonized):
    t = harmonized.transfer
    assert {"region_id", "season", "source", "q", "modis", "viirs"} <= set(t.columns)
    assert t.groupby(["region_id", "season"]).viirs.apply(lambda s: s.is_monotonic_increasing).all()


@pytest.mark.slow
def test_loyo_skill(weekly, regions):
    pred, summary = loyo(weekly, regions, n_boot=15, years=[2013, 2015])
    rep = skill_report(pred)
    assert rep["raw_modis_bias"] < -0.4
    assert abs(rep["bias"]) < 0.25
    assert rep["weekly_interval_coverage"] > 0.8
    assert rep["annual_spearman"] > 0.6
    assert set(summary.year) == {2013, 2015}
