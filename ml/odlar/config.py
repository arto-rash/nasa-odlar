"""Shared constants and paths for the ODLAR pipeline."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("ODLAR_DATA_DIR", ROOT / "data"))
CACHE_DIR = DATA_DIR / "cache"
BOUNDARY_DIR = DATA_DIR / "boundaries"
ARTIFACTS_DIR = Path(os.environ.get("ODLAR_ARTIFACTS_DIR", ROOT / "artifacts"))


@dataclass(frozen=True)
class Batch:
    """A group of countries built, trained and refreshed together.

    Each batch has its own store, models and refresh state under
    ``artifacts/<name>/``; the API serves the union of all built batches.
    ``id_offset`` keeps region ids unique and stable across batches.
    ``firms`` picks the archive source: the 5-day area API (fine for a small
    area) or FIRMS' yearly per-country files plus the area API for the rest.
    """

    name: str
    countries: tuple[str, ...]  # ISO3 keys of odlar.grid.regions.COUNTRIES
    id_offset: int
    firms: str = "country_files"  # or "area"
    stream: bool = False  # too many detections to hold at once: ingest year by year

    @property
    def store_dir(self) -> Path:
        return ARTIFACTS_DIR / self.name / "store"

    @property
    def model_dir(self) -> Path:
        return ARTIFACTS_DIR / self.name / "models"

    @property
    def state_dir(self) -> Path:
        """Inputs the daily refresh needs that the served store does not keep."""
        return ARTIFACTS_DIR / self.name / "state"


BATCHES = {b.name: b for b in (
    Batch("caucasus", ("AZE", "GEO", "ARM"), 0, firms="area"),
    Batch("turkey_iran", ("TUR", "IRN"), 10_000),
)}
# The rest of the world (odlar.world writes this file)
WORLD_FILE = DATA_DIR / "world.json"
if WORLD_FILE.exists():
    for _b in json.loads(WORLD_FILE.read_text())["batches"]:
        BATCHES.setdefault(_b["name"], Batch(_b["name"], tuple(_b["countries"]), _b["id_offset"],
                                             stream=_b.get("stream", False)))
PRIMARY_BATCH = "caucasus"  # the pilot: headline numbers and the landing page

STORE_DIR = BATCHES[PRIMARY_BATCH].store_dir
MODEL_DIR = BATCHES[PRIMARY_BATCH].model_dir
STATE_DIR = BATCHES[PRIMARY_BATCH].state_dir


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def as_firms(self) -> str:
        return f"{self.west},{self.south},{self.east},{self.north}"


# South Caucasus pilot area: Azerbaijan, Georgia, Armenia (the "caucasus" batch).
PILOT_BBOX = BBox(west=39.5, south=38.2, east=51.0, north=43.8)

# Sensor record boundaries.
MODIS_START = date(2000, 11, 1)
VIIRS_START = date(2012, 1, 20)
OVERLAP_START = date(2012, 1, 23)  # first Monday with S-NPP science-quality data

# Harmonization target is the single-satellite S-NPP VIIRS 375 m scale. NOAA-20/21
# extend the VIIRS record past the S-NPP end of life and are tracked separately.
REFERENCE_SATELLITE = "N"  # FIRMS code for Suomi NPP

SEASONS = {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM",
           6: "JJA", 7: "JJA", 8: "JJA", 9: "SON", 10: "SON", 11: "SON"}
SEASON_ORDER = ["DJF", "MAM", "JJA", "SON"]

RISK_LEVELS = ["low", "moderate", "high", "very_high", "extreme"]
# Calibrated probability cut-offs for each risk tier (lower bounds).
RISK_CUTOFFS = [0.0, 0.2, 0.4, 0.6, 0.8]


def risk_level(p: float) -> str:
    level = RISK_LEVELS[0]
    for name, cut in zip(RISK_LEVELS, RISK_CUTOFFS, strict=True):
        if p >= cut:
            level = name
    return level
