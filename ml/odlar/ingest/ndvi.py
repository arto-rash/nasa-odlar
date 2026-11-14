"""Vegetation greenness (NDVI) per region.

Two sources:

* ``ornl_point_series`` — MODIS MOD13Q1 250 m 16-day NDVI from the ORNL DAAC
  MODIS Web Service (no login needed). Used when ``ODLAR_NDVI=modis``.
* ``climatological_ndvi`` — a smooth seasonal curve per region, used offline and
  in tests. Flagged as ``source="climatology"`` so the UI can say so.
"""

from __future__ import annotations

from datetime import date

import httpx
import numpy as np
import pandas as pd

ORNL_URL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset"


def climatological_ndvi(regions: pd.DataFrame, days: pd.DatetimeIndex,
                        elevation: pd.Series | None = None) -> pd.DataFrame:
    doy = days.day_of_year.to_numpy()
    frames = []
    for r in regions.itertuples():
        elev = float(elevation.get(r.region_id, 600)) if elevation is not None else 600.0
        # Lowland winter-wheat areas green up early and brown after the June harvest;
        # highlands peak in mid-summer.
        mu = 120 + min(max(elev, 0), 2500) / 2500 * 80
        amp = 0.32 if elev < 1800 else 0.22
        ndvi = 0.18 + amp * np.exp(-0.5 * ((doy - mu) / 48) ** 2)
        frames.append(pd.DataFrame({"date": days, "region_id": r.region_id, "ndvi": ndvi.round(4)}))
    out = pd.concat(frames, ignore_index=True)
    out["ndvi_source"] = "climatology"
    return out


def ornl_point_series(lat: float, lon: float, start: date, end: date,
                      client: httpx.Client | None = None) -> pd.DataFrame:
    """MOD13Q1 NDVI at a point (10 composites per request, the service's limit)."""
    client = client or httpx.Client(timeout=60)
    dates = client.get("https://modis.ornl.gov/rst/api/v1/MOD13Q1/dates",
                       params={"latitude": lat, "longitude": lon}).json()["dates"]
    want = [d for d in dates if start <= date.fromisoformat(d["calendar_date"]) <= end]
    rows = []
    for i in range(0, len(want), 10):
        chunk = want[i:i + 10]
        resp = client.get(ORNL_URL, params={
            "latitude": lat, "longitude": lon, "band": "250m_16_days_NDVI",
            "startDate": chunk[0]["modis_date"], "endDate": chunk[-1]["modis_date"],
            "kmAboveBelow": 0, "kmLeftRight": 0,
        }, headers={"Accept": "application/json"})
        resp.raise_for_status()
        for s in resp.json().get("subset", []):
            val = s["data"][0]
            if val > -3000:
                rows.append({"date": pd.Timestamp(s["calendar_date"]), "ndvi": val * 0.0001})
    return pd.DataFrame(rows)
