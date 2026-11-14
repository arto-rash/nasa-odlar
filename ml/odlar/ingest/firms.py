"""NASA FIRMS active-fire archive client and record normalization.

Uses the FIRMS area API (``/api/area/csv/{key}/{source}/{bbox}/{days}/{date}``),
which returns at most 5 days per call. Each call is cached on disk as raw CSV so
a long archive pull can be stopped and resumed without spending transactions.
"""

from __future__ import annotations

import io
import time
from collections.abc import Iterable
from datetime import date, timedelta
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from odlar.config import CACHE_DIR, PILOT_BBOX, BBox

FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov"
MAX_DAYS_PER_CALL = 5  # FIRMS area API now rejects day ranges above 5

# FIRMS source -> (sensor, satellite code, first date of record)
SOURCES: dict[str, tuple[str, str, date]] = {
    "MODIS_SP": ("MODIS", "MODIS", date(2000, 11, 1)),
    "MODIS_NRT": ("MODIS", "MODIS", date(2000, 11, 1)),
    "VIIRS_SNPP_SP": ("VIIRS", "N", date(2012, 1, 20)),
    "VIIRS_SNPP_NRT": ("VIIRS", "N", date(2012, 1, 20)),
    "VIIRS_NOAA20_SP": ("VIIRS", "J1", date(2018, 4, 1)),
    "VIIRS_NOAA20_NRT": ("VIIRS", "J1", date(2018, 4, 1)),
    "VIIRS_NOAA21_NRT": ("VIIRS", "J2", date(2024, 1, 17)),
}

VIIRS_CONFIDENCE = {"l": 30, "low": 30, "n": 60, "nominal": 60, "h": 90, "high": 90}

COLUMNS = ["sensor", "satellite", "source", "acq_date", "acq_time", "lat", "lon",
           "frp", "confidence", "daynight", "type"]


def normalize(raw: pd.DataFrame, source: str) -> pd.DataFrame:
    """Map a raw FIRMS CSV frame onto the common ODLAR hotspot schema."""
    sensor, sat_code, _ = SOURCES[source]
    if raw.empty:
        return pd.DataFrame(columns=COLUMNS)
    out = pd.DataFrame({
        "sensor": sensor,
        "source": source,
        "acq_date": pd.to_datetime(raw["acq_date"]).dt.date,
        "acq_time": raw["acq_time"].astype(int),
        "lat": raw["latitude"].astype(float),
        "lon": raw["longitude"].astype(float),
        "frp": pd.to_numeric(raw.get("frp"), errors="coerce").astype(float),
        "daynight": raw.get("daynight", pd.Series("D", index=raw.index)).astype(str),
        "type": pd.to_numeric(raw.get("type", pd.Series(0, index=raw.index)), errors="coerce")
        .fillna(0).astype(int),
    })
    if sensor == "MODIS":
        sat = raw.get("satellite", pd.Series("Terra", index=raw.index)).astype(str).str[0].str.upper()
        out["satellite"] = sat.map({"T": "T", "A": "A"}).fillna("T")
        out["confidence"] = pd.to_numeric(raw["confidence"], errors="coerce").fillna(0).astype(int)
    else:
        out["satellite"] = sat_code
        conf = raw["confidence"].astype(str).str.strip().str.lower()
        out["confidence"] = conf.map(VIIRS_CONFIDENCE).fillna(60).astype(int)
    return out[COLUMNS]


def quality_filter(df: pd.DataFrame, min_modis_conf: int = 30) -> pd.DataFrame:
    """Drop low-confidence detections and non-vegetation sources.

    FIRMS ``type``: 0 presumed vegetation fire, 1 active volcano, 2 other static
    land source (gas flares, industry), 3 offshore. Only type 0 is kept.
    """
    keep = df["type"] == 0
    keep &= ~((df["sensor"] == "MODIS") & (df["confidence"] < min_modis_conf))
    keep &= ~((df["sensor"] == "VIIRS") & (df["confidence"] <= 30))
    return df[keep].reset_index(drop=True)


def persistent_source_mask(df: pd.DataFrame, cell_deg: float = 0.01, min_month_share: float = 0.2,
                           min_months: int = 24) -> pd.Series:
    """Flag detections at persistent static heat sources (gas flares, refineries).

    NRT products carry no ``type`` column, so persistent emitters such as the
    Absheron/Sangachal flares are found empirically: a ~1 km cell that is hot in
    more than ``min_month_share`` of all months of record is not a vegetation fire.
    """
    if df.empty:
        return pd.Series(False, index=df.index)
    cells = persistent_cells(df, cell_deg, min_month_share, min_months)
    return in_cells(df, cells, cell_deg)


def persistent_cells(df: pd.DataFrame, cell_deg: float = 0.01, min_month_share: float = 0.2,
                     min_months: int = 24) -> pd.DataFrame:
    """The ``(cx, cy)`` cells flagged by :func:`persistent_source_mask`."""
    cx = np.floor(df["lon"] / cell_deg).astype(int)
    cy = np.floor(df["lat"] / cell_deg).astype(int)
    month = pd.to_datetime(df["acq_date"]).dt.to_period("M")
    n_months = max(month.nunique(), 1)
    cells = pd.DataFrame({"cx": cx, "cy": cy, "m": month})
    active = cells.drop_duplicates().groupby(["cx", "cy"]).size()
    persistent = active[(active >= min_months) & (active / n_months >= min_month_share)]
    return persistent.index.to_frame(index=False)


def in_cells(df: pd.DataFrame, cells: pd.DataFrame, cell_deg: float = 0.01) -> pd.Series:
    key = pd.MultiIndex.from_arrays([np.floor(df["lon"] / cell_deg).astype(int),
                                     np.floor(df["lat"] / cell_deg).astype(int)])
    return pd.Series(key.isin(pd.MultiIndex.from_frame(cells[["cx", "cy"]])), index=df.index)


def date_windows(start: date, end: date, step: int = MAX_DAYS_PER_CALL) -> Iterable[tuple[date, int]]:
    """Yield (window_start, n_days) chunks covering [start, end] inclusive."""
    cur = start
    while cur <= end:
        n = min(step, (end - cur).days + 1)
        yield cur, n
        cur += timedelta(days=n)


class FirmsClient:
    def __init__(self, map_key: str, cache_dir: Path = CACHE_DIR / "firms",
                 client: httpx.Client | None = None, min_interval: float = 0.15):
        if not map_key:
            raise ValueError("FIRMS_MAP_KEY is required for real ingestion")
        self.map_key = map_key
        self.cache_dir = cache_dir
        self.client = client or httpx.Client(timeout=120)
        self.min_interval = min_interval
        self._last = 0.0

    def _get(self, url: str, retries: int = 5) -> str:
        for attempt in range(retries):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                resp = self.client.get(url)
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
                resp.raise_for_status()
                text = resp.text
                if text.lower().startswith("invalid") or "exceeding" in text.lower()[:200]:
                    raise httpx.HTTPError(text[:200])
                return text
            except httpx.HTTPError:
                if attempt == retries - 1:
                    raise
                time.sleep(min(60, 2 ** attempt * 2))
        raise RuntimeError("unreachable")

    def area_csv(self, source: str, bbox: BBox, start: date, days: int) -> pd.DataFrame:
        path = self.cache_dir / source / f"{start:%Y%m%d}_{days}.csv"
        if path.exists():
            text = path.read_text()
        else:
            url = f"{FIRMS_BASE}/api/area/csv/{self.map_key}/{source}/{bbox.as_firms()}/{days}/{start:%Y-%m-%d}"
            text = self._get(url)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        if not text.strip() or text.strip().count("\n") == 0:
            return pd.DataFrame()
        return pd.read_csv(io.StringIO(text))

    def fetch(self, source: str, start: date, end: date, bbox: BBox = PILOT_BBOX,
              progress: bool = False) -> pd.DataFrame:
        parts = []
        windows = list(date_windows(max(start, SOURCES[source][2]), end))
        for i, (ws, n) in enumerate(windows):
            raw = self.area_csv(source, bbox, ws, n)
            if not raw.empty:
                parts.append(normalize(raw, source))
            if progress and i % 50 == 0:
                print(f"  {source}: {i + 1}/{len(windows)} windows", flush=True)
        if not parts:
            return pd.DataFrame(columns=COLUMNS)
        return pd.concat(parts, ignore_index=True)

    def availability(self) -> pd.DataFrame:
        text = self._get(f"{FIRMS_BASE}/api/data_availability/csv/{self.map_key}/all")
        return pd.read_csv(io.StringIO(text))


def fetch_archive(map_key: str, start: date, end: date, bbox: BBox = PILOT_BBOX) -> pd.DataFrame:
    """Science-quality archive where available, NRT for the most recent months."""
    client = FirmsClient(map_key)
    avail = client.availability().set_index("data_id")
    frames = []
    for sp, nrt in (("MODIS_SP", "MODIS_NRT"), ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
                    ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"), (None, "VIIRS_NOAA21_NRT")):
        sp_end = start - timedelta(days=1)
        if sp and sp in avail.index:
            sp_end = min(end, pd.to_datetime(avail.loc[sp, "max_date"]).date())
            frames.append(client.fetch(sp, start, sp_end, bbox, progress=True))
        if nrt in avail.index:
            nrt_start = max(sp_end + timedelta(days=1), pd.to_datetime(avail.loc[nrt, "min_date"]).date())
            if nrt_start <= end:
                frames.append(client.fetch(nrt, nrt_start, end, bbox, progress=True))
    df = pd.concat([f for f in frames if not f.empty], ignore_index=True)
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"])


NRT_SOURCES = ("MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")


def fetch_recent(map_key: str, start: date, end: date, bbox: BBox = PILOT_BBOX,
                 cache_dir: Path | None = None) -> pd.DataFrame:
    """Near-real-time detections (all satellites) for a short recent window.

    NRT files are still filling in for the last days, so nothing is cached unless
    ``cache_dir`` is given; any failed request raises instead of returning a gap.
    """
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        client = FirmsClient(map_key, cache_dir=cache_dir or Path(tmp))
        frames = [client.fetch(src, start, end, bbox) for src in NRT_SOURCES]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.concat(frames, ignore_index=True)
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"])
