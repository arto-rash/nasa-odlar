"""NASA FIRMS active-fire archive client and record normalization.

Uses the FIRMS area API (``/api/area/csv/{key}/{source}/{bbox}/{days}/{date}``),
which returns at most 5 days per call. Each call is cached on disk as raw CSV so
a long archive pull can be stopped and resumed without spending transactions.
"""

from __future__ import annotations

import io
import os
import time
import zipfile
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

    def _get(self, url: str, retries: int = 12) -> str:
        for attempt in range(retries):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                resp = self.client.get(url)
                if "exceeding allowed transaction limit" in resp.text[:200].lower():
                    # 5,000 transactions per 10 minutes per key (large areas cost more):
                    # wait for the window to roll over instead of failing the build
                    print("  FIRMS transaction limit reached; waiting 2 min", flush=True)
                    time.sleep(120)
                    continue
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
        # the pilot box predates per-box caching; any other box gets its own folder
        sub = source if bbox == PILOT_BBOX else f"{source}/{bbox.as_firms()}"
        path = self.cache_dir / sub / f"{start:%Y%m%d}_{days}.csv"
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


def fetch_recent(map_key: str, start: date, end: date, bbox: BBox | list[BBox] = PILOT_BBOX,
                 cache_dir: Path | None = None) -> pd.DataFrame:
    """Near-real-time detections (all satellites) for a short recent window.

    NRT files are still filling in for the last days, so nothing is cached unless
    ``cache_dir`` is given; any failed request raises instead of returning a gap.
    """
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        client = FirmsClient(map_key, cache_dir=cache_dir or Path(tmp))
        boxes = bbox if isinstance(bbox, list) else [bbox]
        frames = [client.fetch(src, start, end, b) for b in boxes for src in NRT_SOURCES]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.concat(frames, ignore_index=True)
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"])


# NOAA-21 (2024+) has no yearly country files, so its past years come from the
# rate-limited area API, which is the slowest part of a world build. The harmonized
# record and the models use S-NPP and MODIS only; NOAA-21 adds map points. Set
# ODLAR_NOAA21_HISTORY=1 to fetch its past years too (this year is always fetched).
NOAA21_HISTORY = os.environ.get("ODLAR_NOAA21_HISTORY", "0") == "1"

# FIRMS yearly per-country archive files (science quality, with the ``type`` column).
COUNTRY_FILES = {"modis": "MODIS_SP", "viirs-snpp": "VIIRS_SNPP_SP", "viirs-jpss1": "VIIRS_NOAA20_SP"}
COUNTRY_URL = FIRMS_BASE + "/data/country/{kind}/{year}/{kind}_{year}_{country}.csv"


def country_file(kind: str, year: int, country: str, client: httpx.Client,
                 cache_dir: Path = CACHE_DIR / "firms_country") -> pd.DataFrame:
    """One yearly country file, cached on disk; an empty frame if FIRMS has none."""
    path = cache_dir / kind / f"{year}_{country}.csv"
    missing = path.with_suffix(".missing")
    if missing.exists():
        return pd.DataFrame()
    raw = from_global_zip(kind, year, country)
    if raw is not None:
        return normalize(raw, COUNTRY_FILES[kind]) if len(raw) else pd.DataFrame()
    if not path.exists():
        for attempt in range(5):
            try:
                resp = client.get(COUNTRY_URL.format(kind=kind, year=year, country=country.replace(" ", "_")))
            except httpx.TransportError:
                time.sleep(5 * (attempt + 1))
                continue
            if resp.status_code == 404:
                missing.parent.mkdir(parents=True, exist_ok=True)
                missing.touch()
                return pd.DataFrame()
            if resp.status_code < 500:
                break
            time.sleep(5 * (attempt + 1))
        resp.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
    raw = pd.read_csv(path)
    return normalize(raw, COUNTRY_FILES[kind]) if len(raw) else pd.DataFrame()


GLOBAL_DIR = CACHE_DIR / "firms_global"
GLOBAL_URL = FIRMS_BASE + "/data/country/zips/{kind}_{year}_all_countries.zip"


def from_global_zip(kind: str, year: int, country: str, global_dir: Path = GLOBAL_DIR) -> pd.DataFrame | None:
    """The country's file from FIRMS' yearly all-countries zip, if that zip has been
    downloaded (``download_global``); None when there is no zip for that year.
    A country absent from the zip had no detections: an empty frame."""
    zpath = global_dir / f"{kind}_{year}_all_countries.zip"
    if not zpath.exists():
        return None
    member = f"{kind}/{year}/{kind}_{year}_{country.replace(' ', '_')}.csv"
    with zipfile.ZipFile(zpath) as z:
        if member not in z.namelist():
            return pd.DataFrame()
        with z.open(member) as f:
            return pd.read_csv(f)


def download_global(start_year: int, end_year: int, global_dir: Path = GLOBAL_DIR) -> None:
    """Fetch the yearly all-countries zips (the whole world: ~12 GB in total)."""
    global_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=None, follow_redirects=True) as http:
        for kind, source in COUNTRY_FILES.items():
            for year in range(max(start_year, SOURCES[source][2].year), end_year + 1):
                path = global_dir / f"{kind}_{year}_all_countries.zip"
                if path.exists():
                    continue
                tmp = path.with_suffix(".part")
                with http.stream("GET", GLOBAL_URL.format(kind=kind, year=year)) as resp:
                    if resp.status_code == 404:
                        print(f"  {path.name}: none", flush=True)
                        continue
                    resp.raise_for_status()
                    with tmp.open("wb") as out:
                        for chunk in resp.iter_bytes(1 << 20):
                            out.write(chunk)
                os.replace(tmp, path)
                print(f"  {path.name}: {path.stat().st_size / 1e6:.0f} MB", flush=True)


def fetch_country_archive(map_key: str, country: str, bbox: BBox, start: date, end: date) -> pd.DataFrame:
    """Yearly country files through last year, then the area API (science quality
    where FIRMS has it, NRT after) for this year. NOAA-21 has no country files, so
    its whole record comes from the area API."""
    last_file_year = end.year - 1
    frames = []
    with httpx.Client(timeout=300) as http:
        for kind, source in COUNTRY_FILES.items():
            first = max(start.year, SOURCES[source][2].year)
            for year in range(first, last_file_year + 1):
                frames.append(country_file(kind, year, country, http))
    frames.append(fetch_archive(map_key, date(end.year, 1, 1), end, bbox))
    client = FirmsClient(map_key)
    n21_start = SOURCES["VIIRS_NOAA21_NRT"][2]
    if NOAA21_HISTORY and n21_start.year <= last_file_year:
        frames.append(client.fetch("VIIRS_NOAA21_NRT", n21_start, date(last_file_year, 12, 31), bbox))
    df = pd.concat([f for f in frames if len(f)], ignore_index=True)
    df = df[(pd.to_datetime(df["acq_date"]) >= pd.Timestamp(start)) & (pd.to_datetime(df["acq_date"]) <= pd.Timestamp(end))]
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"]).reset_index(drop=True)


def batch_bboxes(batch, regions) -> list[BBox]:
    """Area-API boxes for a batch: the pilot box, or one box per country."""
    if batch.firms == "area":
        return [PILOT_BBOX]
    out = []
    for r in regions[regions["level"] == "country"].itertuples():
        w, so, e, n = r.geometry.bounds
        out.append(BBox(round(w - 0.05, 2), round(so - 0.05, 2), round(e + 0.05, 2), round(n + 0.05, 2)))
    return out


def fetch_batch(map_key: str, batch, regions, start: date, end: date) -> pd.DataFrame:
    """The full detection record for a batch's countries."""
    if batch.firms == "area":
        return fetch_archive(map_key, start, end)
    from odlar.grid.regions import COUNTRIES
    by_code = {m["code"]: m for m in COUNTRIES.values()}
    frames = []
    for r, box in zip(regions[regions["level"] == "country"].itertuples(), batch_bboxes(batch, regions), strict=True):
        name = by_code[r.country].get("firms_name")
        if not name:  # FIRMS has no file for some microstates: no detections on record
            print(f"  FIRMS: no country files for {r.country}; skipped", flush=True)
            continue
        print(f"  FIRMS {name}: country files + area API {box.as_firms()}", flush=True)
        frames.append(fetch_country_archive(map_key, name, box, start, end))
    frames = [f for f in frames if len(f)]
    if not frames:
        raise ValueError(f"no FIRMS detections at all for batch {batch.name}")
    df = pd.concat(frames, ignore_index=True)
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"]).reset_index(drop=True)


# FIRMS' public whole-world files of the last 7 days (no key, one per satellite),
# refreshed every few hours: the daily refresh of every batch reads these.
GLOBAL_NRT = {
    "MODIS_NRT": "modis-c6.1/csv/MODIS_C6_1_Global_7d.csv",
    "VIIRS_SNPP_NRT": "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv",
    "VIIRS_NOAA20_NRT": "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv",
    "VIIRS_NOAA21_NRT": "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv",
}


def download_global_nrt(out_dir: Path) -> None:
    """Fetch the four global 7-day files into ``out_dir`` (skips files already there)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=300, follow_redirects=True) as http:
        for source, path in GLOBAL_NRT.items():
            dst = out_dir / f"{source}.csv"
            if dst.exists():
                continue
            resp = http.get(f"{FIRMS_BASE}/data/active_fire/{path}")
            resp.raise_for_status()
            dst.with_suffix(".part").write_bytes(resp.content)
            os.replace(dst.with_suffix(".part"), dst)


def global_recent(nrt_dir: Path, start: date, end: date, bboxes: list[BBox]) -> tuple[pd.DataFrame, date | None]:
    """Detections in ``bboxes`` between ``start`` and ``end`` from the global 7-day
    files, and the first day those files cover (None if they hold nothing)."""
    frames, first = [], None
    for source in GLOBAL_NRT:
        path = nrt_dir / f"{source}.csv"
        if not path.exists():
            continue
        raw = pd.read_csv(path)
        if raw.empty:
            continue
        d = pd.to_datetime(raw["acq_date"]).dt.date
        first = min(first, d.min()) if first else d.min()
        inside = np.zeros(len(raw), dtype=bool)
        for b in bboxes:
            inside |= raw["longitude"].between(b.west, b.east).to_numpy() & raw["latitude"].between(b.south, b.north).to_numpy()
        raw = raw[inside & (d >= start).to_numpy() & (d <= end).to_numpy()]
        if len(raw):
            frames.append(normalize(raw, source))
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=COLUMNS)
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"]), first


def fetch_refresh(map_key: str, start: date, end: date, bboxes: list[BBox], nrt_dir: Path | None = None) -> pd.DataFrame:
    """New detections for the daily refresh: the global 7-day files (downloaded
    into a temporary folder unless ``nrt_dir`` already has them), plus the keyed
    area API for any days before those files begin."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        folder = nrt_dir or Path(tmp)
        download_global_nrt(folder)
        recent, first = global_recent(folder, start, end, bboxes)
    frames = [recent]
    if first is None or start < first:
        older_end = (first - timedelta(days=1)) if first else end
        frames.append(fetch_recent(map_key, start, min(older_end, end), bboxes))
    frames = [f for f in frames if len(f)]
    if not frames:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.concat(frames, ignore_index=True)
    return df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat", "lon"]).reset_index(drop=True)
