"""One-off: re-derive the record since Suomi NPP stopped, without the daily refresh.

    python -m odlar.repair_bridge            # every built batch
    python -m odlar.repair_bridge --batch caucasus

Recomputes only the weekly and annual record and the calendars from the region-day
counts the refresh already keeps (state/daily_recent.parquet): no FIRMS or weather
calls, risk untouched (the next daily refresh re-scores it on the repaired record).
Each file is replaced atomically; meta.json is rewritten last so the API reloads.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import pandas as pd

from odlar.calendar.engine import build_calendar
from odlar.config import BATCHES
from odlar.grid.gridding import weekly_from_daily
from odlar.harmonize import bridge
from odlar.refresh import annual_update, harmonized_weekly
from odlar.store import write_json


def _replace(path: Path, write) -> None:
    part = path.with_name(path.name + ".part")
    write(part)
    os.replace(part, path)


def run(name: str) -> dict:
    b = BATCHES[name]
    store_dir, state_dir = b.store_dir, b.state_dir
    daily = pd.read_parquet(state_dir / "daily_recent.parquet")
    daily["date"] = pd.to_datetime(daily["date"])
    regions = pd.read_parquet(store_dir / "regions.parquet")
    old = pd.read_parquet(store_dir / "weekly.parquet")
    out_from, back = bridge.window()
    from_week = bridge.week_of(out_from)
    ratios = bridge.fit_ratios(old, regions, until=from_week)
    daily = bridge.apply_daily(daily, ratios, out_from, back)
    recent = daily[daily["date"] >= from_week]
    hw = harmonized_weekly(old, weekly_from_daily(recent), from_week)
    hw = bridge.apply_weekly(hw, bridge.weekly_sums(recent), regions)
    annual = annual_update(pd.read_parquet(store_dir / "annual.parquet"), hw, from_week.year)
    calendars = {}
    for rid, g in hw.groupby("region_id"):
        g = g[g["week"] >= pd.Timestamp("2001-01-01")]
        calendars[int(rid)] = build_calendar(g[["week", "harmonized"]],
                                             raw=g[["week", "naive"]].rename(columns={"naive": "value"}))

    _replace(store_dir / "weekly.parquet", lambda p: hw.sort_values(["region_id", "week"]).to_parquet(
        p, index=False, row_group_size=50_000))
    _replace(store_dir / "annual.parquet", lambda p: annual.to_parquet(p))
    _replace(store_dir / "calendars.json", lambda p: write_json(p, {str(k): v for k, v in calendars.items()}))
    meta = json.loads((store_dir / "meta.json").read_text())
    meta["snpp_bridge_from"] = out_from.date().isoformat()
    _replace(store_dir / "meta.json", lambda p: write_json(p, meta))
    new = hw[(hw["week"] >= from_week) & (hw["method"] == bridge.METHOD)]
    return {"batch": name, "bridged_weeks": int(len(new)), "bridged_total": round(float(new["harmonized"].sum()), 1)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", action="append", choices=sorted(BATCHES))
    a = ap.parse_args()
    names = a.batch or [n for n, b in BATCHES.items() if (b.store_dir / "meta.json").exists()]
    failed = []
    for name in names:
        try:
            print(json.dumps(run(name)), flush=True)
        except Exception as exc:  # noqa: BLE001 — one batch must not stop the others
            print(f"{name} failed: {exc!r}", flush=True)
            failed.append(name)
    if failed:
        raise SystemExit(f"repair failed for {failed}")


if __name__ == "__main__":
    main()
