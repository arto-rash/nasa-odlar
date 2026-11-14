"""Open-Meteo 7-day forecast for region centroids (no API key needed)."""

from __future__ import annotations

import time

import httpx
import numpy as np
import pandas as pd

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
DAILY = ["temperature_2m_max", "temperature_2m_mean", "relative_humidity_2m_mean",
         "wind_speed_10m_mean", "precipitation_sum"]
RENAME = {"temperature_2m_max": "tmax", "temperature_2m_mean": "tmean", "relative_humidity_2m_mean": "rh",
          "wind_speed_10m_mean": "wind", "precipitation_sum": "precip"}


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
                   chunk: int = 50, past_days: int = 0) -> pd.DataFrame:
    """Daily forecast (and optionally the last ``past_days`` of analysis) per region."""
    client = client or httpx.Client(timeout=60)
    frames = []
    for i in range(0, len(regions), chunk):
        part = regions.iloc[i:i + chunk]
        params = {
            "latitude": ",".join(f"{v:.4f}" for v in part["lat"]),
            "longitude": ",".join(f"{v:.4f}" for v in part["lon"]),
            "daily": ",".join(DAILY), "forecast_days": days, "timezone": "Asia/Baku", "wind_speed_unit": "ms",
            "past_days": past_days,
        }
        for attempt in range(5):
            resp = client.get(FORECAST_URL, params=params)
            if resp.status_code < 500 and resp.status_code != 429:
                break
            time.sleep(2 + attempt * 4)
        resp.raise_for_status()
        frames.append(parse(resp.json(), part["region_id"].tolist()))
        if i + chunk < len(regions):
            # every location counts as a call: stay under ~600 per minute
            time.sleep(chunk / 600 * 60)
    return pd.concat(frames, ignore_index=True)


def climatological_forecast(weather: pd.DataFrame, start: pd.Timestamp, days: int = 8) -> pd.DataFrame:
    """Fallback when offline: per-region mean weather for the same calendar days."""
    w = weather.assign(doy=pd.to_datetime(weather["date"]).dt.day_of_year)
    dates = pd.date_range(start, periods=days, freq="D")
    want = pd.DataFrame({"date": dates, "doy": dates.day_of_year})
    clim = w.groupby(["region_id", "doy"])[["tmax", "tmean", "rh", "wind", "precip"]].mean().reset_index()
    out = want.merge(clim, on="doy").drop(columns="doy")
    out["precip"] = np.where(out["precip"] < 1.0, 0.0, out["precip"])
    return out
