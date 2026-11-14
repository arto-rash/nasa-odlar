"""The landing map's fires: real detections of one month, as a small static file.

    python -m odlar.hero_snapshot [2025-08]    # writes web/public/hero-fires.json

Read from FIRMS' yearly world archive (vegetation fires of nominal or better
confidence): every detection around the Caucasus, where the map settles, and an
even sample of the rest. Rows are [lon, lat, sensor (0 MODIS, 1 VIIRS), FRP].
"""

from __future__ import annotations

import csv
import io
import json
import random
import sys
import zipfile
from pathlib import Path

from odlar.config import CACHE_DIR

TARGET = 26_000
HOME = (34.0, 35.0, 56.0, 45.0)  # lon/lat box seen when the camera has landed


def rows(path: Path, month: str, sensor: int):
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.endswith(".csv"):
                continue
            with z.open(name) as f:
                for r in csv.DictReader(io.TextIOWrapper(f, "utf-8")):
                    if not r["acq_date"].startswith(month) or r.get("type") != "0":
                        continue
                    conf = r["confidence"]
                    if conf == "l" or (conf.isdigit() and int(conf) < 50):
                        continue
                    yield float(r["longitude"]), float(r["latitude"]), sensor, float(r["frp"])


def main() -> None:
    month = sys.argv[1] if len(sys.argv) > 1 else "2025-08"
    year = month[:4]
    rand = random.Random(2026)
    home, world = [], []
    for file, sensor, keep in ((f"modis_{year}", 0, 0.35), (f"viirs-snpp_{year}", 1, 0.04)):
        for lon, lat, s, frp in rows(CACHE_DIR / "firms_global" / f"{file}_all_countries.zip", month, sensor):
            row = [round(lon, 2), round(lat, 2), s, round(frp)]
            if HOME[0] <= lon <= HOME[2] and HOME[1] <= lat <= HOME[3]:
                home.append(row)
            elif rand.random() < keep:
                world.append(row)
    room = max(TARGET - len(home), 0)
    sample = rand.sample(world, min(room, len(world)))
    out = Path(__file__).resolve().parents[2] / "web" / "public" / "hero-fires.json"
    out.write_text(json.dumps(home + sample, separators=(",", ":")))
    print(f"{month}: {len(home)} around the Caucasus, {len(sample)} of {len(world)} elsewhere, "
          f"MODIS {sum(1 for r in home + sample if r[2] == 0)}, {out.stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
