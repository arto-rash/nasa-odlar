"""NASA POWER daily point weather (MERRA-2 based) for region centroids."""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from odlar.config import CACHE_DIR

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
PARAMS = ["T2M_MAX", "T2M", "RH2M", "WS10M", "PRECTOTCORR"]
# NB: the "AG" community returns PRECTOTCORR 24x too large (checked against the
# "RE" community and the Open-Meteo ERA5 archive), so "RE" is used.
FILL = -999.0


def parse_power(payload: dict) -> tuple[pd.DataFrame, float]:
    """Turn a POWER JSON response into a daily frame plus site elevation (m)."""
    params = payload["properties"]["parameter"]
    frame = pd.DataFrame({k: pd.Series(v, dtype="float64") for k, v in params.items()})
    frame.index = pd.to_datetime(frame.index, format="%Y%m%d")
    frame = frame.replace(FILL, np.nan)
    frame = frame.rename(columns={"T2M_MAX": "tmax", "T2M": "tmean", "RH2M": "rh",
                                  "WS10M": "wind", "PRECTOTCORR": "precip"})
    frame.index.name = "date"
    coords = payload.get("geometry", {}).get("coordinates", [None, None, np.nan])
    elevation = float(coords[2]) if len(coords) > 2 and coords[2] is not None else float("nan")
    return frame, elevation


def fetch_point(lat: float, lon: float, start: date, end: date, client: httpx.Client,
                retries: int = 4) -> dict:
    query = {
        "parameters": ",".join(PARAMS), "community": "RE", "latitude": round(lat, 4),
        "longitude": round(lon, 4), "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"), "format": "JSON",
    }
    for attempt in range(retries):
        try:
            resp = client.get(POWER_URL, params=query, timeout=120)
            if resp.status_code == 429 or resp.status_code >= 500:
                raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, json.JSONDecodeError):
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 3)
    raise RuntimeError("unreachable")


def fetch_regions_weather(regions: pd.DataFrame, start: date, end: date,
                          cache_dir: Path = CACHE_DIR / "power",
                          refresh: bool = False, workers: int = 6) -> tuple[pd.DataFrame, pd.Series]:
    """Daily weather for every region centroid, cached per region as JSON.

    An existing cache for the same start date is reused unless ``refresh`` is set;
    the pipeline tops up the most recent days from Open-Meteo instead. Missing
    points are fetched ``workers`` at a time (a 25-year point takes POWER ~1 min)."""
    cache_dir.mkdir(parents=True, exist_ok=True)

    def cached(r) -> Path:
        path = cache_dir / f"{r.slug}_{start:%Y%m%d}_{end:%Y%m%d}.json"
        older = sorted(cache_dir.glob(f"{r.slug}_{start:%Y%m%d}_*.json"))
        return older[-1] if not path.exists() and older and not refresh else path

    todo = [r for r in regions.itertuples() if not cached(r).exists()]
    if todo:
        with httpx.Client(limits=httpx.Limits(max_connections=workers)) as client:
            def get(r) -> None:
                payload = fetch_point(r.lat, r.lon, start, end, client)
                payload["odlar_community"] = "RE"
                cached(r).write_text(json.dumps(payload))

            with ThreadPoolExecutor(workers) as pool:
                for i, _ in enumerate(pool.map(get, todo), 1):
                    if i % 25 == 0 or i == len(todo):
                        print(f"  NASA POWER: {i}/{len(todo)} points", flush=True)
    frames, elevations = [], {}
    for r in regions.itertuples():
        frame, elev = parse_power(json.loads(cached(r).read_text()))
        frame["region_id"] = r.region_id
        frames.append(frame.reset_index())
        elevations[r.region_id] = elev
    weather = pd.concat(frames, ignore_index=True)
    return weather, pd.Series(elevations, name="elevation")
