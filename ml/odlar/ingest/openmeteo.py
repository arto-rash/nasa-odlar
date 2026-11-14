"""Open-Meteo 7-day forecast for region centroids (no API key needed)."""

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
DAILY = ["temperature_2m_max", "temperature_2m_mean", "relative_humidity_2m_mean",
         "wind_speed_10m_mean", "precipitation_sum"]
RENAME = {"temperature_2m_max": "tmax", "temperature_2m_mean": "tmean", "relative_humidity_2m_mean": "rh",
          "wind_speed_10m_mean": "wind", "precipitation_sum": "precip"}


CACHE_ENV = "OPEN_METEO_CACHE"  # folder shared by one refresh's batches


def _cached(cache_dir: str | None, past_days: int) -> pd.DataFrame | None:
    files = list(Path(cache_dir).glob("*.parquet")) if cache_dir else []
    if not files:
        return None
    rows = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    return rows[rows["past"] >= past_days]


def parse(payload: list[dict] | dict, region_ids: list[int]) -> pd.DataFrame:
    items = payload if isinstance(payload, list) else [payload]
    frames = []
    for rid, item in zip(region_ids, items, strict=True):
        daily = item["daily"]
        df = pd.DataFrame({RENAME[k]: daily[k] for k in DAILY})
        df["date"] = pd.to_datetime(daily["time"])
        df["region_id"] = rid
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def fetch_forecast(regions: pd.DataFrame, days: int = 8, client: httpx.Client | None = None,
                   chunk: int = 50, past_days: int = 0, step: float | None = None) -> pd.DataFrame:
    """Daily forecast (and optionally the last ``past_days`` of analysis) per region.

    With ``step`` (degrees), regions share the point at the centre of their grid
    cell: one call per cell, which keeps tens of thousands of small regions inside
    the free daily limit (10,000 locations). With ``OPEN_METEO_CACHE`` set, a cell
    already fetched by another batch of the same run is not paid for twice."""
    client = client or httpx.Client(timeout=60)
    pts = regions[["region_id", "lat", "lon"]].copy()
    if step:
        pts["lat"] = (pts["lat"] / step).round() * step
        pts["lon"] = (pts["lon"] / step).round() * step
    cells = pts.drop_duplicates(["lat", "lon"]).reset_index(drop=True)
    cells["cell"] = range(len(cells))
    pts = pts.merge(cells[["lat", "lon", "cell"]], on=["lat", "lon"])
    cache_dir = os.environ.get(CACHE_ENV)
    frames = []
    todo = cells
    hit = _cached(cache_dir, past_days) if step else None
    if hit is not None:
        found = cells.merge(hit, on=["lat", "lon"]).drop_duplicates(["cell", "date"])
        if len(found):
            frames.append(found[[*RENAME.values(), "date", "cell"]].rename(columns={"cell": "region_id"}))
            todo = cells[~cells["cell"].isin(found["cell"])]
    for i in range(0, len(todo), chunk):
        part = todo.iloc[i:i + chunk]
        params = {
            "latitude": ",".join(f"{v:.4f}" for v in part["lat"]),
            "longitude": ",".join(f"{v:.4f}" for v in part["lon"]),
            "daily": ",".join(DAILY), "forecast_days": days, "timezone": "auto", "wind_speed_unit": "ms",
            "past_days": past_days,
        }
        for attempt in range(5):
            resp = client.get(FORECAST_URL, params=params)
            if resp.status_code < 500 and resp.status_code != 429:
                break
            time.sleep(2 + attempt * 4)
        resp.raise_for_status()
        parsed = parse(resp.json(), part["cell"].tolist())
        frames.append(parsed)
        if cache_dir and step:
            keep = parsed.merge(part[["cell", "lat", "lon"]], left_on="region_id", right_on="cell")
            keep = keep.drop(columns=["region_id", "cell"])
            keep.assign(past=past_days).to_parquet(Path(cache_dir) / f"{uuid.uuid4().hex}.parquet")
        if i + chunk < len(todo):
            # every location counts as a call: stay under ~600 per minute
            time.sleep(chunk / 600 * 60)
    by_cell = pd.concat(frames, ignore_index=True).rename(columns={"region_id": "cell"})
    out = pts[["region_id", "cell"]].merge(by_cell, on="cell").drop(columns="cell")
    return out[[*RENAME.values(), "date", "region_id"]]


def climatological_forecast(weather: pd.DataFrame, start: pd.Timestamp, days: int = 8) -> pd.DataFrame:
    """Fallback when offline: per-region mean weather for the same calendar days."""
    w = weather.assign(doy=pd.to_datetime(weather["date"]).dt.day_of_year)
    dates = pd.date_range(start, periods=days, freq="D")
    want = pd.DataFrame({"date": dates, "doy": dates.day_of_year})
    clim = w.groupby(["region_id", "doy"])[["tmax", "tmean", "rh", "wind", "precip"]].mean().reset_index()
    out = want.merge(clim, on="doy").drop(columns="doy")
    out["precip"] = np.where(out["precip"] < 1.0, 0.0, out["precip"])
    return out
