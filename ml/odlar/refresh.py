"""Daily refresh: new NASA FIRMS detections and weather, current risk re-scored.

    python -m odlar.refresh              # every built batch; needs FIRMS_MAP_KEY; through yesterday (UTC)
    python -m odlar.refresh --batch turkey_iran

The full pipeline (``odlar.pipeline``) fits the harmonization and the models; this
only moves the record forward. The last ``--lookback`` days are fetched again from
the FIRMS near-real-time feed (late passes keep arriving for a few days), weather
is topped up from Open-Meteo, and the risk, outlook and fire-weather tables are
recomputed with the trained models. Nothing is refitted: from 2012 on the
harmonized record *is* VIIRS S-NPP, so new weeks need no mapping.

The new store is written next to the old one and swapped in by renaming, so the
API never reads a half-written store.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from odlar import points, store
from odlar.calendar.engine import build_calendar
from odlar.config import BATCHES, MODIS_START, OVERLAP_START
from odlar.grid.gridding import daily_counts, grid_cells, weekly_from_daily
from odlar.grid.regions import assign_regions, leaf_regions, load_regions
from odlar.ingest import firms, ndvi, openmeteo, synthetic
from odlar.model import predict, train
from odlar.model.features import build_panel, daily_series, weather_norms, weekly_clim
from odlar.pipeline import log, recent_start, weather_recent

HOT_COLUMNS = ["sensor", "satellite", "acq_date", "acq_time", "lat", "lon", "frp", "confidence", "region_id"]
WEATHER_COLUMNS = ["region_id", "date", "tmax", "tmean", "rh", "wind", "precip"]


class UpToDate(Exception):
    pass


def new_detections(key: str, regions, since: date, end: date, static_cells: pd.DataFrame,
                   fetch=firms.fetch_recent, bboxes=None) -> pd.DataFrame:
    """FIRMS NRT detections for [since, end], cleaned the same way as the archive."""
    raw = fetch(key, since, end, bboxes) if bboxes is not None else fetch(key, since, end)
    hot = firms.quality_filter(raw) if len(raw) else raw
    if len(hot):
        hot = hot[~firms.in_cells(hot, static_cells).to_numpy()]
        hot = hot.assign(region_id=assign_regions(hot, regions)).dropna(subset=["region_id"])
    hot = hot.reindex(columns=HOT_COLUMNS).astype({"region_id": int})
    hot["acq_date"] = pd.to_datetime(hot["acq_date"])
    return hot.reset_index(drop=True)


def harmonized_weekly(old: pd.DataFrame, weekly: pd.DataFrame, from_week: pd.Timestamp) -> pd.DataFrame:
    """Old weeks as stored; ``weekly`` (weeks from ``from_week``, all after the 2012
    overlap start) replaces the rest, where the harmonized record is S-NPP itself."""
    assert from_week >= pd.Timestamp(OVERLAP_START)
    new = weekly[weekly["week"] >= from_week].copy()
    new["harmonized"] = new["viirs_n"].astype(float)
    new["lo"] = new["harmonized"]
    new["hi"] = new["harmonized"]
    new["method"] = "viirs_snpp"
    new["naive"] = new["viirs"]
    hw = pd.concat([old[old["week"] < from_week], new[old.columns]], ignore_index=True)
    hw = hw.sort_values(["region_id", "week"]).reset_index(drop=True)
    return hw.astype(old.dtypes.to_dict())


def annual_update(old: pd.DataFrame, hw: pd.DataFrame, from_year: int) -> pd.DataFrame:
    """Recompute the annual rows from ``from_year`` on (all post-2012, so no draws)."""
    w = hw.assign(year=pd.to_datetime(hw["week"]).dt.year)
    w = w[w["year"] >= from_year]
    new = w.groupby(["region_id", "year"], as_index=False)[["harmonized", "modis", "viirs", "viirs_n", "naive"]].sum()
    new["lo"] = new["harmonized"]
    new["hi"] = new["harmonized"]
    out = pd.concat([old[old["year"] < from_year], new], ignore_index=True)
    out = out.sort_values(["region_id", "year"]).reset_index(drop=True)
    return out[old.columns].astype(old.dtypes.to_dict())


def update_weather(weather: pd.DataFrame, leaves, end: date, offline: bool,
                   step: float | None = None) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """Top up observed weather through ``end`` and get the next 7 days of forecast."""
    last = pd.Timestamp(weather["date"].max()).date()
    if offline:
        fc = openmeteo.climatological_forecast(weather, pd.Timestamp(end) + pd.Timedelta(days=1))
        return weather, fc, "climatology"
    past = min((date.today() - last).days + 2, 92)
    om = openmeteo.fetch_forecast(leaves, days=8, past_days=past, step=step)
    seen = om[(om["date"] > pd.Timestamp(last) - pd.Timedelta(days=2)) & (om["date"] <= pd.Timestamp(end))]
    weather = pd.concat([weather[weather["date"] < seen["date"].min()], seen[WEATHER_COLUMNS]], ignore_index=True)
    fc = om[om["date"] > pd.Timestamp(end)]
    return weather.sort_values(["region_id", "date"]).reset_index(drop=True), fc, "open_meteo"


def run(batch: str, end: date | None = None, lookback: int = 7, store_dir: Path | None = None,
        model_dir: Path | None = None, state_dir: Path | None = None, map_key: str | None = None,
        offline: bool = False, fetch=None, nrt_dir: Path | None = None) -> dict:
    """``fetch(key, start, end, bboxes)`` defaults to the global 7-day NRT files
    (``nrt_dir`` if already downloaded) topped up from the area API."""
    fetch = fetch or (lambda k, s, e, b: firms.fetch_refresh(k, s, e, b, nrt_dir))
    t0 = time.time()
    b = BATCHES[batch]
    store_dir, model_dir, state_dir = store_dir or b.store_dir, model_dir or b.model_dir, state_dir or b.state_dir
    meta = json.loads((store_dir / "meta.json").read_text())
    prev_end = date.fromisoformat(meta["data_end"])
    end = end or datetime.now(UTC).date() - timedelta(days=1)
    # Detections up to the full build's last day live in its year files; the
    # refresh keeps everything after that in small tail files and re-fetches the
    # last ``lookback`` days of that tail each run.
    build_end = date.fromisoformat(meta.get("build_end") or meta["data_end"])
    meta.setdefault("build_end", build_end.isoformat())
    meta.setdefault("build_n_hotspots", int(meta.get("n_hotspots", 0)))
    meta.setdefault("build_by_satellite", dict(meta.get("by_satellite") or {}))
    since = max(prev_end - timedelta(days=lookback - 1), build_end + timedelta(days=1))
    if end < since:
        raise UpToDate(f"store already covers {prev_end}; nothing to do for {end}")
    # the build's own polygons, so the server needs no boundary files
    regions = store.load_state_regions(state_dir)
    regions = load_regions(batch) if regions is None else regions
    leaves = leaf_regions(regions)
    boxes = firms.batch_bboxes(b, regions)

    static_cells = pd.read_parquet(state_dir / "static_cells.parquet")
    new = new_detections(map_key or os.environ.get("FIRMS_MAP_KEY", ""), regions, since, end, static_cells, fetch,
                         boxes)
    tail_years = list(range(build_end.year, end.year + 1))
    old_tail = points.read_points(store_dir, tail_years, tail=True)
    old_tail["acq_date"] = pd.to_datetime(old_tail["acq_date"])
    replaced = old_tail[old_tail["acq_date"] >= pd.Timestamp(since)]
    tail = pd.concat([old_tail[old_tail["acq_date"] < pd.Timestamp(since)], new], ignore_index=True)
    tail = tail.astype((new if len(new) else old_tail).dtypes.to_dict())
    log(f"FIRMS NRT {since}..{end}: {len(new):,} detections (was "
        f"{len(replaced):,} in that window)", t0)

    # Region-day counts of the recent window come from the refresh state; only
    # the re-fetched days are recounted. Older weeks come from the store.
    lo = recent_start(end)
    daily = pd.concat([recent_daily(state_dir, store_dir, regions, lo, build_end, since),
                       daily_counts(new, regions, since, end)], ignore_index=True)
    daily["date"] = pd.to_datetime(daily["date"])
    daily = daily[daily["date"] >= lo].sort_values(["region_id", "date"]).reset_index(drop=True)
    from_week = pd.Timestamp(since) - pd.Timedelta(days=since.weekday())
    hw = harmonized_weekly(pd.read_parquet(store_dir / "weekly.parquet"),
                           weekly_from_daily(daily[daily["date"] >= from_week]), from_week)
    annual = annual_update(pd.read_parquet(store_dir / "annual.parquet"), hw, since.year)
    calendars = {}
    for rid, g in hw.groupby("region_id"):
        g = g[g["week"] >= pd.Timestamp("2001-01-01")]
        calendars[int(rid)] = build_calendar(g[["week", "harmonized"]],
                                             raw=g[["week", "naive"]].rename(columns={"naive": "value"}))
    log("record and calendars updated", t0)

    weather = pd.read_parquet(state_dir / "weather.parquet")
    elev = pd.read_parquet(state_dir / "elevation.parquet").set_index("region_id")["elevation"]
    weather, fc, fc_source = update_weather(weather, leaves, end, offline, b.weather_step)
    end = min(end, pd.Timestamp(weather["date"].max()).date())
    fc_obs = fc[weather.columns.intersection(fc.columns)]
    cols = ["region_id", "date", "precip", "tmax"]
    full = pd.concat([weather.loc[weather["date"] >= pd.Timestamp(MODIS_START), cols], fc_obs[cols]],
                     ignore_index=True)
    if full[["precip", "tmax"]].isna().any().any():
        full = synthetic.add_dryness(full.assign(tmean=0.0, rh=0.0, wind=0.0))[cols]
    norms = weather_norms(full)
    del full
    w_ext = synthetic.add_dryness(pd.concat([weather[weather["date"] >= lo - pd.Timedelta(days=120)], fc_obs],
                                            ignore_index=True))
    log(f"weather through {end}, forecast: {fc_source}", t0)

    # Baselines come from the full record; the feature panel itself only spans the
    # recent window the outputs need (risk history covers 400 days), so it stays small.
    # Weekly sums of the daily harmonized series are the harmonized weeks, so the
    # climatology is taken straight from them.
    leaf_ids = leaves["region_id"]
    clim_years = list(range(2001, end.year))
    clim = weekly_clim(hw.loc[hw["region_id"].isin(leaf_ids), ["region_id", "week", "harmonized"]]
                       .rename(columns={"week": "date", "harmonized": "value"}), clim_years)
    series = daily_series(daily, hw, "harmonized")
    series = series[series["region_id"].isin(leaf_ids)]
    fc_dates = np.sort(fc["date"].unique())
    recent = pd.concat([series, pd.DataFrame({
        "region_id": np.repeat(leaves["region_id"].to_numpy(), len(fc_dates)),
        "date": np.tile(fc_dates, len(leaves)), "value": 0.0})], ignore_index=True)
    nd = ndvi.climatological_ndvi(leaves, pd.date_range(lo, end + timedelta(days=8)), elev)
    panel = build_panel(recent, w_ext[w_ext["date"] >= lo], regions, clim_years, nd, elev, clim=clim, norms=norms)
    panel.loc[panel["date"] > pd.Timestamp(end) - pd.Timedelta(days=7), ["target_sum7", "target_event"]] = np.nan
    log(f"feature panel: {len(panel):,} rows", t0)

    models = train.load(model_dir)
    now_rows = panel[panel["date"] == pd.Timestamp(end)]
    risk_now = predict.short_term(models, now_rows)
    outlook_now = now_rows[["region_id", "clim_next13w", "clim_p10_13w", "clim_p90_13w"]].copy()
    outlook_now[["q10", "q50", "q90"]] = models.outlook_q(now_rows).round(1)
    fwd = predict.fire_weather_daily(fc, weather)

    # Risk history: days already scored keep their out-of-sample probability; new
    # days are scored by the current model, which was trained before them.
    old_rh = pd.read_parquet(store_dir / "risk_history.parquet")
    hist = panel[(panel["date"] >= pd.Timestamp(end) - pd.Timedelta(days=400)) & (panel["date"] <= pd.Timestamp(end))]
    rh = hist[["region_id", "date", "target_sum7", "threshold7", "value"]].merge(
        old_rh[["region_id", "date", "probability", "in_sample"]], on=["region_id", "date"], how="left")
    fresh = rh["probability"].isna().to_numpy()
    if fresh.any():
        rh.loc[fresh, "probability"] = models.proba(hist[fresh]).round(4)
    rh["in_sample"] = rh["in_sample"].fillna(False).astype(bool)
    rh = rh.astype(old_rh.dtypes.to_dict())[old_rh.columns].reset_index(drop=True)
    log(f"re-scored: {int((risk_now['level'] != 'low').sum())} regions above low risk", t0)

    meta.update({"data_end": end.isoformat(), "built_at": pd.Timestamp.now().isoformat(),
                 "refreshed_at": pd.Timestamp.now(tz="UTC").isoformat(), "forecast_source": fc_source,
                 "n_hotspots": int(meta["build_n_hotspots"]) + len(tail),
                 "by_satellite": satellite_counts(meta["build_by_satellite"], tail.iloc[:0], tail)})
    tmp = store_dir.with_name(store_dir.name + ".new")
    shutil.rmtree(tmp, ignore_errors=True)
    store.write_all(tmp, regions=regions, hotspots=None, grid=None, shapes=False, weekly=hw, annual=annual, calendars=calendars,
                    skill=json.loads((store_dir / "skill.json").read_text()),
                    model_report=json.loads((store_dir / "model_report.json").read_text()),
                    risk_now=risk_now, outlook_now=outlook_now, fire_weather=fwd, risk_history=rh,
                    meta=meta, weather=weather_recent(w_ext, end))
    # The build's year files and grid are linked over unchanged; only tails are new.
    points.write_points(tmp, tail, tail_years, tail=True)
    points.carry_over(store_dir, tmp, skip={f"{y}.tail.parquet" for y in tail_years})
    for name in ("grid.parquet", "regions.geojson", "regions_geo.parquet"):
        points.link(store_dir / name, tmp / name)
    if len(tail):
        grid_cells(tail).to_parquet(tmp / "grid_tail.parquet", index=False)
    swap(tmp, store_dir)
    for name, df in (("weather", weather[WEATHER_COLUMNS]), ("daily_recent", daily)):
        part = state_dir / f"{name}.parquet.new"
        df.to_parquet(part, index=False)
        os.replace(part, state_dir / f"{name}.parquet")
    log(f"store swapped in: data through {end}", t0)
    return {"data_end": end.isoformat(), "new_detections": len(new), "risk_now": risk_now}


def recent_daily(state_dir: Path, store_dir: Path, regions, lo: pd.Timestamp, build_end: date,
                 since: date) -> pd.DataFrame:
    """Region-day counts from ``lo`` up to the day before ``since``: from the refresh
    state, or (once, for a store built before the state kept them) from the points."""
    path = state_dir / "daily_recent.parquet"
    if path.exists():
        d = pd.read_parquet(path)
        d["date"] = pd.to_datetime(d["date"])
        return d[(d["date"] >= lo) & (d["date"] < pd.Timestamp(since))]
    hot = points.read_points(store_dir, list(range(lo.year, since.year + 1)))
    hot["acq_date"] = pd.to_datetime(hot["acq_date"])
    hot = hot[(hot["acq_date"] >= lo) & (hot["acq_date"] < pd.Timestamp(since))]
    return daily_counts(hot, regions, lo.date(), since - timedelta(days=1))


def satellite_counts(old: dict, removed: pd.DataFrame, added: pd.DataFrame) -> dict:
    out = {k: int(v) for k, v in old.items()}
    for sat, n in removed.groupby("satellite").size().items():
        out[sat] = out.get(sat, 0) - int(n)
    for sat, n in added.groupby("satellite").size().items():
        out[sat] = out.get(sat, 0) + int(n)
    return out


def swap(new: Path, current: Path) -> None:
    old = current.with_name(current.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if current.exists():
        os.replace(current, old)
    os.replace(new, current)
    shutil.rmtree(old, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", type=date.fromisoformat, default=None)
    ap.add_argument("--lookback", type=int, default=7)
    ap.add_argument("--offline", action="store_true", help="no weather calls (climatological forecast)")
    ap.add_argument("--batch", action="append", choices=sorted(BATCHES),
                    help="batch to refresh (repeatable); default: every batch that has a store")
    ap.add_argument("--nrt-dir", type=Path, default=None, help="folder with FIRMS' global 7-day files")
    a = ap.parse_args()
    if not os.environ.get("FIRMS_MAP_KEY"):
        raise SystemExit("FIRMS_MAP_KEY not set")
    names = a.batch or [n for n, b in BATCHES.items() if (b.store_dir / "meta.json").exists()]
    if len(names) > 1:
        # one process per batch, so memory is handed back between batches; the
        # global NRT files are downloaded once and shared
        failed = []
        with tempfile.TemporaryDirectory() as tmp:
            nrt = a.nrt_dir or Path(tmp)
            firms.download_global_nrt(nrt)
            for name in names:
                args = [sys.executable, "-m", "odlar.refresh", "--batch", name, "--lookback", str(a.lookback),
                        "--nrt-dir", str(nrt)]
                args += (["--end", a.end.isoformat()] if a.end else []) + (["--offline"] if a.offline else [])
                if subprocess.run(args, check=False).returncode:
                    failed.append(name)
        if failed:
            raise SystemExit(f"refresh failed for {failed}")
        return
    failed = []
    for name in names:
        print(f"== {name}", flush=True)
        try:
            out = run(name, end=a.end, lookback=a.lookback, offline=a.offline, nrt_dir=a.nrt_dir)
        except UpToDate as exc:
            print(f"   {exc}", flush=True)
            continue
        except Exception as exc:  # noqa: BLE001 — one batch failing must not stop the others
            print(f"   {name} failed: {exc!r}", flush=True)
            failed.append(name)
            continue
        print(json.dumps({"batch": name, "data_end": out["data_end"], "new_detections": out["new_detections"],
                          "levels": out["risk_now"]["level"].value_counts().to_dict()}), flush=True)
    if failed:
        raise SystemExit(f"refresh failed for {failed}")


if __name__ == "__main__":
    main()
