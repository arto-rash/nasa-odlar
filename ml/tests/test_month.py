"""'Is this month normal here?': the month so far against the same weeks of earlier years."""

import numpy as np

from odlar.calendar.engine import month_to_date


def _cal(cur_value=30.0):
    years = list(range(2001, 2027))
    m = np.zeros((len(years), 52))
    m[:, 42:44] = 10.0  # bins of the weeks starting 26 Oct and 2 Nov: 10 a week in every year
    m[-1, 42:44] = cur_value / 2
    raw = m * 3
    raw[:14] *= 0.25  # most of the years look much quieter in the raw record (MODIS era)
    return {"years": years, "matrix": m.tolist(), "raw_matrix": raw.tolist()}


def test_month_so_far_against_median():
    out = month_to_date(_cal(30.0), "2026-11-13")  # a Friday: last full week ends Sun 8 Nov
    assert out["end"] == "2026-11-08" and out["month"] == "2026-11"
    assert out["start"] == "2026-10-26"  # whole weeks: the week of 26 Oct reaches into November
    assert out["median"] > 0 and out["n_years"] == 26
    assert out["raw"]["ratio"] > out["ratio"]  # raw data overstates against its MODIS-era median


def test_rank_and_ratio():
    hi = month_to_date(_cal(1000.0), "2026-11-13")
    lo = month_to_date(_cal(0.0), "2026-11-13")
    assert hi["rank"] == 1 and hi["ratio"] > 1
    assert lo["rank"] == 26 and lo["ratio"] == 0


def test_no_full_week_falls_back_to_previous_month():
    out = month_to_date(_cal(), "2026-12-03")  # Thursday 3 Dec: last full week ends 29 Nov
    assert out["month"] == "2026-11"
