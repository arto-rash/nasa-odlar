"""Fetch this year's FIRMS data for upcoming world batches ahead of their builds.

    FIRMS_MAP_KEY=k1,k2,... python -m odlar.world_prefetch [--ahead 4]

The rate-limited area API (this year's detections) is the slow part of a world
build, while the computing needs the laptop's memory and runs one batch at a
time. This worker downloads the next batches' area-API data into the shared
cache while the current batch computes; the build then finds it cached. It uses
the same requests as the build (same boxes, dates and windows), so every
download is reused. Old years come from the yearly files and need no prefetch.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date, timedelta

from odlar.config import BATCHES
from odlar.grid.regions import COUNTRIES, load_regions
from odlar.ingest import firms
from odlar.world_build import STATUS_FILE, boundaries_ready, ordered_batches


def prefetch(name: str, key: str, end: date) -> None:
    regions = load_regions(name)
    for meta, boxes in firms.country_bboxes(BATCHES[name], regions):
        if not meta.get("firms_name"):
            continue
        for box in boxes:
            firms.fetch_archive(key, date(end.year, 1, 1), end, box)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ahead", type=int, default=6, help="how many batches to keep ready ahead of the build")
    ap.add_argument("--worker", default="0/1", help="i/n: with n workers, this one takes every n-th batch from i")
    a = ap.parse_args()
    me, n_workers = (int(x) for x in a.worker.split("/"))
    key = os.environ.get("FIRMS_MAP_KEY", "")
    if not key:
        raise SystemExit("FIRMS_MAP_KEY not set")
    done: set[str] = set()
    while True:
        status = json.loads(STATUS_FILE.read_text()) if STATUS_FILE.exists() else {}
        todo = [b for b in ordered_batches(None)
                if b["name"] in BATCHES and status.get(b["name"], {}).get("state") not in ("live", "built", "failed",
                                                                                              "uploading", "building")
                and not (BATCHES[b["name"]].store_dir / "meta.json").exists()]
        window = todo[: a.ahead * n_workers]
        nxt = [b for i, b in enumerate(window) if i % n_workers == me
               and b["name"] not in done and boundaries_ready(b, COUNTRIES)]
        if not todo:
            print("prefetch: nothing left", flush=True)
            return
        if not nxt:
            if all(b["name"] in done for i, b in enumerate(todo) if i % n_workers == me):
                print("prefetch: my batches are all fetched", flush=True)
                return
            time.sleep(60)
            continue
        b = nxt[0]
        end = date.today() - timedelta(days=1)  # the build's own end date
        t0 = time.time()
        try:
            prefetch(b["name"], key, end)
            print(f"prefetch: {b['name']} ready in {(time.time() - t0) / 60:.1f} min", flush=True)
        except Exception as exc:  # noqa: BLE001 — the build will fetch whatever is missing itself
            print(f"prefetch: {b['name']} failed ({exc!r:.150}); the build will fetch it", flush=True)
        done.add(b["name"])


if __name__ == "__main__":
    main()
