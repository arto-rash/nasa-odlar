"""Year-by-year detection ingestion for countries with too many fires to hold at once.

Brazil or the Congo have ~80 million detections over the record, far more than
fit in memory as one table. Two passes over the years keep memory to about one
year of one batch:

1. read each year (country files, plus the area API for this year and NOAA-21),
   apply the quality filter, keep a compact copy on disk and note which ~1 km
   cells were hot in which months;
2. find the persistent heat sources from those cell-months (the same rule as
   :func:`odlar.ingest.firms.persistent_cells`), then per year drop them, assign
   regions and produce that year's point file, daily counts and density grid.
"""

from __future__ import annotations

import shutil
import time
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from odlar.grid.gridding import daily_counts, grid_cells
from odlar.grid.regions import assign_regions
from odlar.ingest import firms
from odlar.points import write_points


def country_year(map_key: str, country: str, bbox: firms.BBox | list[firms.BBox], year: int, start: date,
                 end: date, http: httpx.Client) -> pd.DataFrame:
    """All detections of one country for one calendar year."""
    last_file_year = end.year - 1
    lo, hi = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
    boxes = bbox if isinstance(bbox, list) else [bbox]
    frames = []
    if year <= last_file_year:
        for kind, source in firms.COUNTRY_FILES.items():
            if year >= firms.SOURCES[source][2].year:
                frames.append(firms.country_file(kind, year, country, http, boxes=boxes))
        if firms.NOAA21_HISTORY:
            n21 = firms.SOURCES["VIIRS_NOAA21_NRT"][2]
            if year >= n21.year:
                for box in boxes:
                    frames.append(firms.FirmsClient(map_key).fetch("VIIRS_NOAA21_NRT", max(lo, n21), hi, box))
    else:
        for box in boxes:
            frames.append(firms.fetch_archive(map_key, lo, hi, box))
    frames = [f for f in frames if len(f)]
    if not frames:
        return pd.DataFrame(columns=firms.COLUMNS)
    df = pd.concat(frames, ignore_index=True)
    d = pd.to_datetime(df["acq_date"])
    df = df[(d >= pd.Timestamp(lo)) & (d <= pd.Timestamp(hi))]
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"])


def ingest(map_key: str, batch, regions, start: date, end: date, staging: Path,
           cell_deg: float = 0.01, min_month_share: float = 0.2, min_months: int = 24) -> dict:
    """Run both passes. Point files land in ``staging/hotspots``; returns the daily
    counts, density grid, persistent cells and per-satellite totals."""
    t0 = time.time()
    shutil.rmtree(staging, ignore_errors=True)
    raw_dir = staging / "raw"
    raw_dir.mkdir(parents=True)
    cell_months: set[tuple[int, int, int]] = set()
    n_raw = 0
    with httpx.Client(timeout=300) as http:
        for year in range(start.year, end.year + 1):
            parts = [country_year(map_key, meta["firms_name"], cboxes, year, start, end, http)
                     for meta, cboxes in firms.country_bboxes(batch, regions)
                     if meta.get("firms_name")]
            parts = [p for p in parts if len(p)]
            if not parts:
                continue
            df = pd.concat(parts, ignore_index=True)
            df = df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"])
            n_raw += len(df)
            df = firms.quality_filter(df)
            df["acq_date"] = pd.to_datetime(df["acq_date"])
            df.to_parquet(raw_dir / f"{year}.parquet", index=False)
            month = df["acq_date"].dt.year * 12 + df["acq_date"].dt.month
            cm = pd.DataFrame({"cx": np.floor(df["lon"] / cell_deg).astype(int),
                               "cy": np.floor(df["lat"] / cell_deg).astype(int), "m": month}).drop_duplicates()
            cell_months.update(map(tuple, cm.to_numpy()))
            print(f"  {year}: {len(df):,} detections after the quality filter "
                  f"[{time.time() - t0:.0f}s]", flush=True)

    # Persistent heat sources over the whole record.
    cm = pd.DataFrame(list(cell_months), columns=["cx", "cy", "m"])
    n_months = max(cm["m"].nunique(), 1) if len(cm) else 1
    active = cm.groupby(["cx", "cy"]).size() if len(cm) else pd.Series(dtype=int)
    static_cells = active[(active >= min_months) & (active / n_months >= min_month_share)].index.to_frame(index=False) \
        if len(active) else pd.DataFrame(columns=["cx", "cy"])
    del cell_months, cm

    daily_parts, grid_parts, sats = [], [], {}
    n_static = n_kept = 0
    for path in sorted(raw_dir.glob("*.parquet")):
        year = int(path.stem)
        df = pd.read_parquet(path)
        static = firms.in_cells(df, static_cells, cell_deg).to_numpy()
        n_static += int(static.sum())
        df = df[~static].reset_index(drop=True)
        df["region_id"] = assign_regions(df, regions)
        df = df.dropna(subset=["region_id"]).astype({"region_id": int})
        n_kept += len(df)
        for k, v in df.groupby("satellite").size().items():
            sats[k] = sats.get(k, 0) + int(v)
        write_points(staging, df, [year])
        lo, hi = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
        daily_parts.append(daily_counts(df, regions, lo, hi))
        if len(df):
            grid_parts.append(grid_cells(df))
        path.unlink()
        print(f"  {year}: {len(df):,} kept [{time.time() - t0:.0f}s]", flush=True)
    raw_dir.rmdir()
    daily = pd.concat(daily_parts, ignore_index=True)
    # years with no detections at all still need their region-days
    full = daily_counts(pd.DataFrame(columns=[*firms.COLUMNS, "region_id"]), regions, start, end)
    daily = pd.concat([daily, full], ignore_index=True).drop_duplicates(["region_id", "date"], keep="first")
    daily = daily.sort_values(["region_id", "date"]).reset_index(drop=True)
    grid = pd.concat(grid_parts, ignore_index=True).fillna(0) if grid_parts else pd.DataFrame(
        columns=["cx", "cy", "year", "MODIS", "VIIRS", "lon", "lat"])
    return {"daily": daily, "grid": grid, "static_cells": static_cells, "by_satellite": sats,
            "n_raw": n_raw, "n_kept": n_kept, "n_static": n_static}
