from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from odlar.grid.gridding import daily_counts, weekly_from_daily
from odlar.grid.regions import assign_regions, toy_regions
from odlar.ingest.firms import quality_filter
from odlar.ingest.synthetic import generate, synthetic_weather

START, END = date(2006, 1, 1), date(2021, 12, 31)


@pytest.fixture(scope="session")
def regions():
    return toy_regions()


@pytest.fixture(scope="session")
def weather(regions):
    return synthetic_weather(regions[regions.level != "country"], START, END, seed=3)


@pytest.fixture(scope="session")
def world(regions, weather):
    return generate(regions, weather, START, END, seed=11, scale=1.0)


@pytest.fixture(scope="session")
def hotspots(world, regions):
    h = quality_filter(world.hotspots)
    h["region_id"] = assign_regions(h, regions)
    return h.dropna(subset=["region_id"]).astype({"region_id": int}).reset_index(drop=True)


@pytest.fixture(scope="session")
def daily(hotspots, regions):
    return daily_counts(hotspots, regions, START, END)


@pytest.fixture(scope="session")
def weekly(daily):
    return weekly_from_daily(daily)


@pytest.fixture(scope="session")
def harmonized(weekly, regions):
    from odlar.harmonize.engine import harmonize
    return harmonize(weekly, regions, n_boot=40, seed=5)


@pytest.fixture(scope="session")
def counterfactual_weekly(world):
    cf = world.counterfactual.copy()
    cf["week"] = cf["date"] - pd.to_timedelta(cf["date"].dt.day_of_week, unit="D")
    return cf.groupby(["region_id", "week"], as_index=False)["viirs_cf"].sum()
