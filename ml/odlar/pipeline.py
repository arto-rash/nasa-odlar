"""End-to-end ODLAR build: ingest → harmonize → validate → calendar → models → store.

    python -m odlar.pipeline --source synthetic          # offline demo world
    python -m odlar.pipeline --source firms              # real NASA FIRMS (needs FIRMS_MAP_KEY)
    python -m odlar.pipeline --quick                     # small bootstrap, for CI
    python -m odlar.pipeline --source firms --batch turkey_iran
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from odlar import events, store
from odlar.calendar.engine import build_calendar
from odlar.config import BATCHES, CACHE_DIR, DATA_DIR, MODIS_START, OVERLAP_START, PRIMARY_BATCH
from odlar.grid.gridding import COUNT_COLUMNS, daily_counts, grid_cells, weekly_from_daily
from odlar.grid.regions import assign_regions, leaf_regions, load_regions
from odlar.harmonize import bridge
from odlar.harmonize.engine import aggregate_intervals, harmonize
from odlar.harmonize.validate import loyo, skill_report
from odlar.ingest import firms, ndvi, openmeteo, power, stream, synthetic
from odlar.model import predict, train
from odlar.model.features import build_panel, daily_series, weekly_clim


def log(msg: str, t0: float) -> None:
    print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)


def _wait_for_heavy_turn(alone: bool) -> list:
    """Take a slot of the memory-hungry part of a build: four ordinary batches may
    run it at once, a streamed (very large) batch takes every slot. The OS releases
    the locks when this process ends, however it ends."""
    print("  waiting for the memory-heavy step to be free", flush=True)
    locks = [(DATA_DIR / name).open("w") for name in ("heavy.lock", "heavy2.lock", "heavy3.lock", "heavy4.lock")]
    if alone:
        for lock in locks:
            fcntl.flock(lock, fcntl.LOCK_EX)
        return locks
    while True:
        for lock in locks:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return [lock]
            except BlockingIOError:
                pass
        time.sleep(5)


def load_weather(regions, start: date, end: date, offline: bool,
                 step: float | None = None) -> tuple[pd.DataFrame, pd.Series, str]:
    """NASA POWER history, topped up with Open-Meteo analysis for the last days."""
    leaves = leaf_regions(regions)
    cached = sorted((CACHE_DIR / "power").glob("*.json")) if (CACHE_DIR / "power").exists() else []
    source = "nasa_power"
    try:
        if offline and not cached:
            raise RuntimeError("offline")
        w, elev = power.fetch_regions_weather(regions, date(2000, 10, 1), end - timedelta(days=7))
    except Exception as exc:  # noqa: BLE001
        if not offline:  # a real build never falls back to made-up weather: fail, retry later
            raise RuntimeError(f"NASA POWER unavailable: {exc}") from exc
        print(f"  NASA POWER unavailable ({exc}); using synthetic weather (offline run)")
        w = synthetic.synthetic_weather(leaves, date(2000, 10, 1), end)
        return w, pd.Series(dtype=float), "synthetic"
    last = pd.to_datetime(w["date"]).max().date()
    if last < end and not offline:
        try:
            gap = (end - last).days
            om = openmeteo.fetch_forecast(regions, days=1, past_days=min(gap + 1, 92), step=step)
            om = om[(om["date"] > pd.Timestamp(last)) & (om["date"] <= pd.Timestamp(end))]
            w = pd.concat([w, om[w.columns.intersection(om.columns)]], ignore_index=True)
            source = "nasa_power+open_meteo"
        except Exception as exc:  # noqa: BLE001
            print(f"  Open-Meteo top-up failed ({exc})")
    w = w[w["region_id"].isin(leaves["region_id"])]
    return w, elev, source


def run(source: str = "synthetic", n_boot: int = 200, loyo_boot: int = 40, quick: bool = False,
        end: date | None = None, offline: bool = False, batch: str = PRIMARY_BATCH,
        store_dir: Path | None = None, model_dir: Path | None = None, state_dir: Path | None = None,
        seed: int = 42) -> dict:
    t0 = time.time()
    b = BATCHES[batch]
    store_dir, model_dir, state_dir = store_dir or b.store_dir, model_dir or b.model_dir, state_dir or b.state_dir
    end = end or date.today() - timedelta(days=1)
    start = MODIS_START
    regions = load_regions(batch)
    leaves = leaf_regions(regions)
    log(f"regions: {len(regions)} ({len(leaves)} leaf)", t0)

    weather, elevation, weather_source = load_weather(regions, start, end, offline, b.weather_step)
    weather = weather.drop_duplicates(["region_id", "date"])
    end = min(end, pd.to_datetime(weather["date"]).max().date())
    log(f"weather: {weather_source}, {len(weather):,} rows, through {end}", t0)

    truth = None
    staged = None  # point files written year by year (big batches)
    if source == "firms" and b.stream:
        staged = store_dir.with_name(store_dir.name + ".staging")
        got = stream.ingest(os.environ.get("FIRMS_MAP_KEY", ""), b, regions, start, end, staged)
        hot, static_cells, daily, grid = None, got["static_cells"], got["daily"], got["grid"]
        n_hot, by_sat = got["n_kept"], got["by_satellite"]
        log(f"hotspots: {got['n_raw']:,} raw, {n_hot:,} after quality + static-source filter "
            f"({got['n_static']:,} static), ingested year by year", t0)
    elif source == "synthetic":
        # scale 0.55 ≈ 12–14k S-NPP detections a year across the three countries,
        # the order of magnitude FIRMS records for the South Caucasus
        world = synthetic.generate(regions, weather, start, end, elevation=elevation, seed=seed, scale=0.55)
        raw_hot = world.hotspots
        truth = world
    elif source == "firms":
        key = os.environ.get("FIRMS_MAP_KEY", "")
        raw_hot = firms.fetch_batch(key, b, regions, start, end)
    else:
        raise ValueError(source)
    if staged is None:
        log(f"hotspots: {len(raw_hot):,} raw detections", t0)
        hot = firms.quality_filter(raw_hot)
        static_cells = firms.persistent_cells(hot)
        static = firms.in_cells(hot, static_cells)
        hot = hot[~static.to_numpy()].reset_index(drop=True)
        hot["region_id"] = assign_regions(hot, regions)
        hot = hot.dropna(subset=["region_id"]).astype({"region_id": int})
        log(f"hotspots: {len(hot):,} after quality + static-source filter ({int(static.sum()):,} static)", t0)
        daily = daily_counts(hot, regions, start, end)
        grid, n_hot, by_sat = grid_cells(hot), len(hot), hot.groupby("satellite").size().to_dict()
    weekly = weekly_from_daily(daily)
    log(f"aggregated: {len(daily):,} region-days, {len(weekly):,} region-weeks", t0)

    harm = harmonize(weekly, regions, n_boot=n_boot, seed=seed)
    # Suomi NPP stopped in Nov 2026: its missing days continue from NOAA-20/21
    out_from, back = bridge.window()
    if pd.Timestamp(end) >= out_from:
        ratios = bridge.fit_ratios(weekly, regions, until=bridge.week_of(out_from))
        daily = bridge.apply_daily(daily, ratios, out_from, back)
        harm.weekly = bridge.apply_weekly(harm.weekly, bridge.weekly_sums(daily), regions)
    log("harmonized", t0)
    pred, _ = loyo(weekly, regions, n_boot=loyo_boot,
                   years=[2013, 2016, 2019, 2022] if quick else None)
    skill = skill_report(pred)
    if truth is not None:
        skill["synthetic_truth"] = synthetic_truth_check(harm, truth)
    skill["transfer"] = harm.transfer.to_dict(orient="records")
    skill["loyo_annual"] = pred.groupby(["region_id", "year"]).agg(
        obs=("y", "sum"), pred=("pred", "sum"), modis=("x", "sum"),
        lo=("year_lo", "first"), hi=("year_hi", "first")).reset_index().round(2).to_dict(orient="records")
    log(f"LOYO skill: bias {skill['bias']:+.3f} (raw {skill['raw_modis_bias']:+.3f}), "
        f"annual coverage {skill['annual_interval_coverage']:.2f}", t0)

    hw = harm.weekly.merge(weekly[["region_id", "week", *COUNT_COLUMNS, "modis", "viirs", "frp_modis", "frp_viirs"]],
                           on=["region_id", "week"], how="left")
    hw["naive"] = np.where(hw["week"] < pd.Timestamp(OVERLAP_START), hw["modis"], hw["viirs"])

    annual = annual_table(harm, hw)
    calendars = {}
    for rid, g in hw.groupby("region_id"):
        g = g[g["week"] >= pd.Timestamp("2001-01-01")]  # 2000 holds only Nov–Dec
        raw = g[["week", "naive"]].rename(columns={"naive": "value"})
        calendars[int(rid)] = build_calendar(g[["week", "harmonized"]], raw=raw)
    log("calendars built", t0)

    nd = ndvi.climatological_ndvi(leaves, pd.date_range(start, end + timedelta(days=8)), elevation)
    w_dry = synthetic.add_dryness(weather)

    # Forecast weather for the next 7 days.
    fc_source = "open_meteo"
    try:
        if offline:
            raise RuntimeError("offline")
        fc = openmeteo.fetch_forecast(leaves, days=8, step=b.weather_step)
        fc = fc[fc["date"] > pd.Timestamp(end)]
    except Exception as exc:  # noqa: BLE001
        print(f"  forecast unavailable ({exc}); using climatology")
        fc = openmeteo.climatological_forecast(weather, pd.Timestamp(end) + pd.Timedelta(days=1))
        fc_source = "climatology"
    w_ext = synthetic.add_dryness(pd.concat([weather, fc[weather.columns.intersection(fc.columns)]],
                                            ignore_index=True).drop_duplicates(["region_id", "date"]))

    series_h = daily_series(daily, harm.weekly, "harmonized")
    series_r = daily_series(daily, harm.weekly, "raw")
    series_h = series_h[series_h["region_id"].isin(leaves["region_id"])]
    series_r = series_r[series_r["region_id"].isin(leaves["region_id"])]
    clim_years = list(range(2001, end.year))
    ext = lambda s: pd.concat([s, pd.DataFrame({  # noqa: E731
        "region_id": np.repeat(leaves["region_id"].to_numpy(), len(fc["date"].unique())),
        "date": np.tile(np.sort(fc["date"].unique()), len(leaves)), "value": 0.0})], ignore_index=True)
    # The feature panels and model fits take 10-15 GB on a big batch, so the runners
    # sharing the machine take turns here. Held until the process ends.
    heavy_turn = _wait_for_heavy_turn(b.stream) if not offline else None  # noqa: F841 (keeps the lock open)
    panel_h = build_panel(ext(series_h), w_ext, regions, clim_years, nd, elevation)
    panel_r = build_panel(series_r, w_dry, regions, clim_years, nd, elevation)
    future = panel_h["date"] > pd.Timestamp(end) - pd.Timedelta(days=7)
    panel_h.loc[future, ["target_sum7", "target_event"]] = np.nan
    panel_h.loc[panel_h["date"] > pd.Timestamp(end) - pd.Timedelta(days=91), "target_sum13w"] = np.nan
    log(f"feature panels: {len(panel_h):,} rows", t0)

    test_years = [end.year - 3, end.year - 2, end.year - 1] if quick else list(range(end.year - 6, end.year))
    report_h = train.evaluate(panel_h[panel_h["date"] <= pd.Timestamp(end)], test_years)
    log(f"CV harmonized: AUC {report_h['overall']['roc_auc']:.3f} PR {report_h['overall']['pr_auc']:.3f} "
        f"BSS {report_h['overall']['brier_skill']:.3f}", t0)
    report_r = train.evaluate(panel_r, test_years, truth_panel=panel_h[panel_h["date"] <= pd.Timestamp(end)])
    log(f"CV raw: AUC {report_r['overall']['roc_auc']:.3f} PR {report_r['overall']['pr_auc']:.3f} "
        f"BSS {report_r['overall']['brier_skill']:.3f}", t0)

    hist = panel_h[panel_h["date"] <= pd.Timestamp(end)]
    yr = hist["date"].dt.year
    sub = hist[hist["date"].dt.day_of_year % 2 == 0]
    short = train.fit_short(sub)
    outlook = train.fit_outlook(hist[yr <= end.year])
    meta = {"trained_at": pd.Timestamp.now().isoformat(), "data_end": end.isoformat(), "source": source,
            "features": train.FEATURES, "importance": train.importance(short)}
    train.save(short, outlook, meta, model_dir)
    models = train.load(model_dir)
    log("final models trained and saved", t0)

    now_rows = panel_h[panel_h["date"] == pd.Timestamp(end)]
    risk_now = predict.short_term(models, now_rows)
    oq = models.outlook_q(now_rows)
    outlook_now = now_rows[["region_id", "clim_next13w", "clim_p10_13w", "clim_p90_13w"]].copy()
    outlook_now[["q10", "q50", "q90"]] = oq.round(1)
    ow = predict.outlook_weeks(outlook_now, weekly_clim(series_h, clim_years), end)
    fwd = predict.fire_weather_daily(fc, weather)
    # Out-of-sample risk history: last full year scored by a model that never saw it.
    hist_model = train.fit_short(sub[sub["date"].dt.year < end.year - 1])
    recent = hist[hist["date"] >= pd.Timestamp(end) - pd.Timedelta(days=400)]
    risk_hist = recent[["region_id", "date", "target_sum7", "threshold7", "value"]].copy()
    risk_hist["probability"] = hist_model.proba(recent).round(4)
    risk_hist["in_sample"] = recent["date"].dt.year < end.year - 1  # model trained on years < end.year-1
    log("inference done", t0)

    meta_store = {
        "source": source, "weather_source": weather_source, "forecast_source": fc_source,
        "ndvi_source": "climatology", "data_start": start.isoformat(), "data_end": end.isoformat(),
        "built_at": pd.Timestamp.now().isoformat(), "n_hotspots": int(n_hot),
        "n_boot": n_boot, "overlap_start": OVERLAP_START.isoformat(),
        "by_satellite": {k: int(v) for k, v in by_sat.items()},
        # what the full build covered; the refresh adds tail files after build_end
        "build_end": end.isoformat(), "build_n_hotspots": int(n_hot),
        "build_by_satellite": {k: int(v) for k, v in by_sat.items()},
    }
    if staged is not None:  # point files are already written; move them into the store
        shutil.rmtree(store_dir / "hotspots", ignore_errors=True)
        store_dir.mkdir(parents=True, exist_ok=True)
        os.replace(staged / "hotspots", store_dir / "hotspots")
        shutil.rmtree(staged, ignore_errors=True)
    store.write_all(store_dir, regions=regions, hotspots=hot, weekly=hw, annual=annual, calendars=calendars,
                    skill=skill, model_report={"harmonized": report_h, "raw": report_r,
                                               "importance": meta["importance"]},
                    risk_now=risk_now, outlook_now=outlook_now, fire_weather=fwd, risk_history=risk_hist,
                    grid=grid, meta=meta_store, weather=weather_recent(w_ext, end), outlook_weeks=ow)
    events.write_events(store_dir, end)
    store.write_state(state_dir, weather=weather, elevation=elevation, static_cells=static_cells,
                      daily_recent=daily[pd.to_datetime(daily["date"]) >= recent_start(end)], regions=regions)
    log(f"store written to {store_dir}", t0)
    return {"skill": skill, "report_h": report_h["overall"], "report_r": report_r["overall"]}


def recent_start(end: date) -> pd.Timestamp:
    """First day the refresh's feature panel needs: Jan 1 of the year before the
    start of the 400-day risk history (lags, year-to-date sums, days since fire)."""
    return pd.Timestamp(date((end - timedelta(days=400)).year - 1, 1, 1))


def weather_recent(w: pd.DataFrame, end: date, days: int = 400) -> pd.DataFrame:
    lo = pd.Timestamp(end) - pd.Timedelta(days=days)
    return w[pd.to_datetime(w["date"]) >= lo][["region_id", "date", "tmax", "rh", "wind", "precip", "vpd",
                                               "days_since_rain"]].round(2)


def annual_table(harm, hw: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for rid, g in hw.groupby("region_id"):
        years = pd.Series(pd.to_datetime(g["week"]).dt.year.to_numpy(), index=pd.DatetimeIndex(g["week"]))
        iv = aggregate_intervals(harm, int(rid), years)
        sums = g.assign(year=years.to_numpy()).groupby("year")[["modis", "viirs", "viirs_n", "naive"]].sum()
        t = iv.join(sums, how="left").reset_index(names="year")
        t["region_id"] = int(rid)
        rows.append(t)
    return pd.concat(rows, ignore_index=True)


def synthetic_truth_check(harm, world) -> dict:
    """Pre-2012 harmonized record vs the counterfactual S-NPP record of the synthetic world."""
    cf = world.counterfactual.copy()
    cf["week"] = cf["date"] - pd.to_timedelta(cf["date"].dt.day_of_week, unit="D")
    cf = cf.groupby(["region_id", "week"], as_index=False)["viirs_cf"].sum()
    m = harm.weekly.merge(cf, on=["region_id", "week"])
    pre = m[m["week"] < pd.Timestamp(OVERLAP_START)].copy()
    pre["year"] = pre["week"].dt.year
    tot = pre[pre["region_id"].isin(cf["region_id"].unique())].groupby("year")[["harmonized", "viirs_cf"]].sum()
    return {
        "bias": float(pre["harmonized"].sum() / pre["viirs_cf"].sum() - 1),
        "weekly_coverage": float(((pre["viirs_cf"] >= pre["lo"]) & (pre["viirs_cf"] <= pre["hi"])).mean()),
        "by_year": tot.reset_index().round(1).to_dict(orient="records"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=os.environ.get("ODLAR_SOURCE", "synthetic"), choices=["synthetic", "firms"])
    ap.add_argument("--boot", type=int, default=200)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--end", type=date.fromisoformat, default=None)
    ap.add_argument("--batch", default=PRIMARY_BATCH, choices=sorted(BATCHES))
    a = ap.parse_args()
    if a.source == "firms" and not os.environ.get("FIRMS_MAP_KEY"):
        raise SystemExit("FIRMS_MAP_KEY not set")
    out = run(source=a.source, n_boot=30 if a.quick else a.boot, loyo_boot=15 if a.quick else 40,
              quick=a.quick, end=a.end, offline=a.offline, batch=a.batch)
    print(json.dumps({"bias": out["skill"]["bias"], "harmonized": out["report_h"], "raw": out["report_r"]},
                     indent=1))


if __name__ == "__main__":
    main()
