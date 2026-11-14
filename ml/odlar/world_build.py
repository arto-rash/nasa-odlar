"""Build every world batch in turn and ship each one to the server as it finishes.

    caffeinate -dimsu python -m odlar.world_build            # needs FIRMS_MAP_KEY
    python -m odlar.world_build --only western_europe --no-ship

Light batches go first so whole regions go live early; the heavy single-country
batches (year-by-year ingestion) come last. A batch waits until all of its
countries have boundary files (odlar.grid.osm_boundaries --world). Each build
runs in its own process with its own log (data/world_logs/<batch>.log); a
failure is recorded and the runner moves on. Batches already built are skipped,
so the runner can be restarted at any time. Progress: data/world_status.json.

Shipping a batch: rsync its artifacts to the server, run its first refresh
there (brings it to yesterday and clears the gateway cache), then sync the
gateway's region table. The ML API picks the new batch up by itself.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime

from odlar.config import ARTIFACTS_DIR, BATCHES, BOUNDARY_DIR, DATA_DIR, WORLD_FILE

STATUS_FILE = DATA_DIR / "world_status.json"
LOG_DIR = DATA_DIR / "world_logs"
HOST = os.environ.get("ODLAR_HOST", "portfelim-hz")
COMPOSE = "cd /opt/odlar/deploy && docker compose -f docker-compose.prod.yml"


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


_status_lock = threading.Lock()


def load_status() -> dict:
    return json.loads(STATUS_FILE.read_text()) if STATUS_FILE.exists() else {}


def save_status(status: dict) -> None:
    with _status_lock:
        tmp = STATUS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(status, indent=1))
        os.replace(tmp, STATUS_FILE)


def ordered_batches(only: list[str] | None) -> list[dict]:
    world = json.loads(WORLD_FILE.read_text())
    batches = [b for b in world["batches"] if not only or b["name"] in only]
    return sorted(batches, key=lambda b: (b.get("stream", False), b.get("weight", 0)))


def boundaries_ready(batch: dict, countries: dict) -> bool:
    return all((BOUNDARY_DIR / f"{countries[i]['file']}_OSM.geojson").exists() for i in batch["countries"])


def build(name: str) -> bool:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (LOG_DIR / f"{name}.log").open("w") as log:
        proc = subprocess.run([sys.executable, "-u", "-m", "odlar.pipeline", "--source", "firms", "--batch", name],
                              stdout=log, stderr=subprocess.STDOUT, check=False)
    return proc.returncode == 0


def ship(name: str) -> bool:
    """Upload one batch and bring it live on the server."""
    src = ARTIFACTS_DIR / name
    steps = [
        ["ssh", HOST, f"mkdir -p /opt/odlar/artifacts/{name}"],
        ["rsync", "-az", "--delete", f"{src}/", f"{HOST}:/opt/odlar/artifacts/{name}/"],
        ["ssh", HOST, f"{COMPOSE} --profile jobs run --rm -T refresh python -m odlar.refresh --batch {name}; "
                      f"{COMPOSE} exec -T api php artisan odlar:sync-regions && "
                      f"{COMPOSE} exec -T api php artisan cache:clear"],
    ]
    with (LOG_DIR / f"{name}.log").open("a") as log:
        for cmd in steps:
            log.write(f"\n$ {' '.join(cmd)}\n")
            log.flush()
            if subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, check=False).returncode:
                return False
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="comma-separated batch names")
    ap.add_argument("--no-ship", action="store_true", help="build only, do not upload")
    ap.add_argument("--rebuild", action="store_true", help="build batches that already have a store")
    a = ap.parse_args()
    if not os.environ.get("FIRMS_MAP_KEY"):
        raise SystemExit("FIRMS_MAP_KEY not set")
    from odlar.grid.regions import COUNTRIES
    status = load_status()
    pending = [b for b in ordered_batches(a.only.split(",") if a.only else None)
               if b["name"] in BATCHES and (a.rebuild or not (BATCHES[b["name"]].store_dir / "meta.json").exists()
                                            or status.get(b["name"], {}).get("state") in
                                            ("built", "uploading", "ship_failed"))]
    print(f"{now()} {len(pending)} batches to do", flush=True)

    # Uploads (about 1 MB/s from here) run in the background, one at a time and
    # in order, so the next build does not wait for the previous upload.
    uploads: queue.Queue[str | None] = queue.Queue()

    def uploader() -> None:
        while (name := uploads.get()) is not None:
            ok = ship(name)
            status[name].update({"state": "live" if ok else "ship_failed", "shipped": now()})
            save_status(status)
            print(f"{now()} {name}: {status[name]['state']}", flush=True)

    shipper = threading.Thread(target=uploader, daemon=False)
    shipper.start()
    while pending:
        ready = [b for b in pending if boundaries_ready(b, COUNTRIES)]
        if not ready:
            print(f"{now()} waiting for boundaries of {len(pending)} batches", flush=True)
            time.sleep(300)
            continue
        b = ready[0]
        pending.remove(b)
        name = b["name"]
        if a.rebuild or not (BATCHES[name].store_dir / "meta.json").exists():
            status[name] = {"state": "building", "started": now()}
            save_status(status)
            print(f"{now()} building {name} ({len(b['countries'])} countries)", flush=True)
            t0 = time.time()
            ok = build(name)
            status[name] = {"state": "built" if ok else "failed", "finished": now(),
                            "minutes": round((time.time() - t0) / 60, 1)}
            save_status(status)
            print(f"{now()} {name}: {status[name]['state']} in {status[name]['minutes']} min", flush=True)
            if not ok:
                continue
        if not a.no_ship:
            status[name]["state"] = "uploading"
            save_status(status)
            uploads.put(name)
    uploads.put(None)
    shipper.join()
    print(f"{now()} done", flush=True)


if __name__ == "__main__":
    main()
