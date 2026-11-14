"""Shared constants and paths for the ODLAR pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("ODLAR_DATA_DIR", ROOT / "data"))
CACHE_DIR = DATA_DIR / "cache"
BOUNDARY_DIR = DATA_DIR / "boundaries"
STORE_DIR = Path(os.environ.get("ODLAR_STORE_DIR", ROOT / "artifacts" / "store"))
MODEL_DIR = Path(os.environ.get("ODLAR_MODEL_DIR", ROOT / "artifacts" / "models"))
# Inputs the daily refresh needs that the served store does not keep.
STATE_DIR = Path(os.environ.get("ODLAR_STATE_DIR", ROOT / "artifacts" / "state"))


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def as_firms(self) -> str:
        return f"{self.west},{self.south},{self.east},{self.north}"


# South Caucasus pilot area: Azerbaijan, Georgia, Armenia.
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
