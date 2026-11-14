"""Year files of sampled real detections, for the world view of the map.

Asking the database for one week of the whole world takes a second or two, far
too slow to move along a 26-year timeline. A fixed share of the real detections
(1 in ``RATE``, by a hash of each detection, so every week keeps its true
relative size) goes into one small binary file per year, which the browser
downloads once and then reads any week from at no cost.

    python -m odlar.week_packs               # every year
    python -m odlar.week_packs --year 2026   # one year (the daily refresh)

Explore opens on the South Caucasus, so the wider area around it (``HOME``) also
gets a file per year with every detection: that view loses nothing either.

Layout, little-endian:
    uint32 rate, uint32 weeks, uint32 points
    weeks x (uint32 day number of the Monday, uint32 points in that week)
    int16 lon x points (0.01 degrees), int16 lat x points (0.01 degrees)
    uint8 x points: top bit 1 for VIIRS, low 7 bits round(16 * log(1 + FRP))
"""

from __future__ import annotations

import argparse
import os
import struct
from pathlib import Path

import numpy as np
import pandas as pd

from odlar.config import ARTIFACTS_DIR
from odlar.store import get_store

RATE = 250
PACK_DIR = ARTIFACTS_DIR / "week_packs"
HOME = (33, 35, 58, 46)  # west, south, east, north; web/src/lib/map-data.ts has the same box


def encode(rows: pd.DataFrame, rate: int = RATE) -> bytes:
    rows = rows.assign(week=pd.to_datetime(rows["acq_date"]).dt.to_period("W-SUN").dt.start_time)
    rows = rows.sort_values("week", kind="stable")
    sizes = rows.groupby("week").size()
    head = [struct.pack("<III", rate, len(sizes), len(rows))]
    head += [struct.pack("<II", (w - pd.Timestamp(0)).days, int(n)) for w, n in sizes.items()]
    power = np.minimum(np.rint(16 * np.log1p(rows["frp"].clip(lower=0).to_numpy())), 127).astype(np.uint8)
    viirs = (rows["sensor"].str[0] == "V").to_numpy().astype(np.uint8) << 7
    return b"".join([*head,
                     np.rint(rows["lon"].to_numpy() * 100).astype("<i2").tobytes(),
                     np.rint(rows["lat"].to_numpy() * 100).astype("<i2").tobytes(),
                     (power | viirs).tobytes()])


def _write(rows: pd.DataFrame, path: Path, rate: int) -> int:
    if rows.empty:
        return 0
    data = encode(rows, rate)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)  # the API never reads half a file
    return len(data)


def write_year(year: int, out_dir: Path = PACK_DIR, rate: int = RATE) -> tuple[int, int]:
    cols, points = "lon, lat, sensor, frp, acq_date", get_store().points
    world = points.query(f"hash(lon, lat, acq_date, acq_time) % {rate} = 0", None, cols, [year])
    w, s, e, n = HOME
    home = points.query(f"lon BETWEEN {w} AND {e} AND lat BETWEEN {s} AND {n}", None, cols, [year])
    return _write(world, out_dir / f"{year}.bin", rate), _write(home, out_dir / "home" / f"{year}.bin", 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, action="append")
    a = ap.parse_args()
    for year in a.year or range(2000, pd.Timestamp.now().year + 1):
        print(year, write_year(year), flush=True)


if __name__ == "__main__":
    main()
