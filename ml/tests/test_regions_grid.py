
import numpy as np
import pandas as pd

from odlar.grid.gridding import COUNT_COLUMNS, grid_cells, week_of_year, week_start
from odlar.grid.regions import AZ_NAMES, assign_regions, load_regions, slugify


def test_load_regions_catalogue():
    r = load_regions()
    assert len(r) == 104
    assert r["slug"].is_unique and r["region_id"].is_unique
    assert set(r.loc[r.level == "country", "slug"]) == {"az", "ge", "am"}
    leaves = r[r.level != "country"]
    assert leaves["parent_id"].notna().all()
    assert (r["area_km2"] > 0).all()
    # Azerbaijani names exist for every sub-national region
    assert leaves["name_az"].str.len().gt(0).all()
    sab = r[r.slug == "az-sabirabad"].iloc[0]
    assert sab.name_az == "Sabirabad rayonu" and sab.name_en == "Sabirabad District"
    assert r[r.slug == "az-baku-city"].iloc[0].name_az == "Bakı şəhəri"


def test_azerbaijan_area_is_plausible():
    r = load_regions()
    az = r[r.slug == "az"].iloc[0]
    assert 80_000 < az.area_km2 < 92_000  # 86,600 km² official


def test_slugify():
    assert slugify("Samtskhe–Javakheti") == "samtskhe-javakheti"
    assert slugify("Racha-Lechkhumi and Kvemo Svaneti") == "racha-lechkhumi-and-kvemo-svaneti"
    assert "Şəki" in AZ_NAMES.values()


def test_assign_regions(regions):
    pts = pd.DataFrame({"lat": [40.0, 40.0, 30.0], "lon": [46.5, 47.5, 46.5]})
    ids = assign_regions(pts, regions)
    assert ids.iloc[0] == 1 and ids.iloc[1] == 2 and np.isnan(ids.iloc[2])


def test_week_helpers():
    ws = week_start(pd.Series(pd.to_datetime(["2024-01-03", "2024-01-08", "2024-12-31"])))
    assert ws.dt.day_of_week.eq(0).all()
    woy = week_of_year(pd.Series(pd.date_range("2020-01-01", "2020-12-31", freq="W-MON")))
    assert woy.min() == 0 and woy.max() == 51


def test_daily_counts_conserve_detections(hotspots, daily, regions):
    leaves = daily[daily.region_id.isin([1, 2])]
    assert leaves[COUNT_COLUMNS].to_numpy().sum() == len(hotspots)
    country = daily[daily.region_id == 3].set_index("date")[COUNT_COLUMNS]
    summed = leaves.groupby("date")[COUNT_COLUMNS].sum()
    pd.testing.assert_frame_equal(country.sort_index(), summed.sort_index(), check_dtype=False)


def test_weekly_totals(weekly, daily):
    assert (weekly["modis"] == weekly["modis_t"] + weekly["modis_a"]).all()
    assert weekly["viirs"].sum() == daily[["viirs_n", "viirs_j1", "viirs_j2"]].to_numpy().sum()
    assert weekly["week"].dt.day_of_week.eq(0).all()


def test_no_viirs_before_launch(weekly):
    assert weekly.loc[weekly.week < "2012-01-16", "viirs"].sum() == 0
    assert weekly.loc[weekly.week >= "2012-02-01", "viirs_n"].sum() > 0


def test_grid_cells(hotspots):
    g = grid_cells(hotspots)
    assert g[["MODIS", "VIIRS"]].to_numpy().sum() == len(hotspots)
    assert g["lon"].between(46, 48).all()
