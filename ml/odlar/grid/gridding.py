"""Aggregate hotspot detections onto the region × day / week grid."""

from __future__ import annotations

import numpy as np
import pandas as pd

SAT_COLUMNS = {"T": "modis_t", "A": "modis_a", "N": "viirs_n", "J1": "viirs_j1", "J2": "viirs_j2"}
COUNT_COLUMNS = list(SAT_COLUMNS.values())
GRID_DEG = 0.1


def week_start(dates: pd.Series | pd.DatetimeIndex) -> pd.Series:
    d = pd.to_datetime(pd.Series(dates))
    return (d - pd.to_timedelta(d.dt.day_of_week, unit="D")).dt.normalize()


def week_of_year(ws: pd.Series) -> pd.Series:
    """0..51 calendar-week bin from a week's Monday (the rare 53rd week folds into 51)."""
    return np.minimum((pd.to_datetime(ws).dt.day_of_year - 1) // 7, 51).astype(int)


def daily_counts(hotspots: pd.DataFrame, regions: pd.DataFrame, start, end) -> pd.DataFrame:
    """Dense region × day table of per-satellite detection counts and FRP sums."""
    h = hotspots.dropna(subset=["region_id"]).copy()
    h["date"] = pd.to_datetime(h["acq_date"])
    h["col"] = h["satellite"].map(SAT_COLUMNS)
    counts = h.pivot_table(index=["region_id", "date"], columns="col", values="lat", aggfunc="size", fill_value=0)
    frp = h.assign(sensor_frp=np.where(h["sensor"] == "MODIS", "frp_modis", "frp_viirs")).pivot_table(
        index=["region_id", "date"], columns="sensor_frp", values="frp", aggfunc="sum", fill_value=0.0)
    leaf_ids = regions.loc[regions.level != "country", "region_id"].to_numpy()
    idx = pd.MultiIndex.from_product([leaf_ids, pd.date_range(start, end, freq="D")], names=["region_id", "date"])
    out = counts.join(frp, how="outer").reindex(idx, fill_value=0)
    for c in COUNT_COLUMNS:
        if c not in out:
            out[c] = 0
    for c in ("frp_modis", "frp_viirs"):
        if c not in out:
            out[c] = 0.0
    out = out[COUNT_COLUMNS + ["frp_modis", "frp_viirs"]].astype(
        {c: int for c in COUNT_COLUMNS}).reset_index()
    return add_country_rows(out, regions, ["date"])


def add_country_rows(df: pd.DataFrame, regions: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """Append country aggregates (sum of leaf regions) under the country region_id."""
    parent = regions.set_index("region_id")["parent_id"].dropna().astype(int)
    leaves = df[df["region_id"].isin(parent.index)]
    agg_cols = [c for c in df.columns if c not in keys + ["region_id"]]
    country = leaves.assign(region_id=leaves["region_id"].map(parent)).groupby(
        ["region_id", *keys], as_index=False)[agg_cols].sum()
    return pd.concat([leaves, country], ignore_index=True)


def weekly_from_daily(daily: pd.DataFrame) -> pd.DataFrame:
    d = daily.copy()
    d["week"] = week_start(d["date"]).to_numpy()
    cols = COUNT_COLUMNS + ["frp_modis", "frp_viirs"]
    w = d.groupby(["region_id", "week"], as_index=False)[cols].sum()
    w["modis"] = w["modis_t"] + w["modis_a"]
    w["viirs"] = w["viirs_n"] + w["viirs_j1"] + w["viirs_j2"]
    w["woy"] = week_of_year(w["week"])
    w["year"] = pd.to_datetime(w["week"]).dt.year
    return w


def grid_cells(hotspots: pd.DataFrame, deg: float = GRID_DEG) -> pd.DataFrame:
    """Per-cell, per-year, per-sensor counts on a regular grid (for heatmaps)."""
    h = hotspots.copy()
    h["cx"] = np.floor(h["lon"] / deg).astype(int)
    h["cy"] = np.floor(h["lat"] / deg).astype(int)
    h["year"] = pd.to_datetime(h["acq_date"]).dt.year
    g = h.groupby(["cx", "cy", "year", "sensor"]).size().unstack("sensor", fill_value=0).reset_index()
    g["lon"] = (g["cx"] + 0.5) * deg
    g["lat"] = (g["cy"] + 0.5) * deg
    return g
