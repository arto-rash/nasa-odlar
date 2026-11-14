"""Read/write the analytics store consumed by the API (parquet + JSON files)."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from odlar.config import STORE_DIR
from odlar.points import Points, write_points


def _json_default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (pd.Timestamp,)):
        return o.isoformat()
    return str(o)


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, default=_json_default, separators=(",", ":"), allow_nan=False)
                    if not _has_nan(obj) else json.dumps(_clean(obj), default=_json_default, separators=(",", ":")))


def _has_nan(obj) -> bool:
    try:
        json.dumps(obj, default=_json_default, allow_nan=False)
        return False
    except ValueError:
        return True


def _clean(obj):
    if isinstance(obj, float):
        return None if (np.isnan(obj) or np.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.floating):
        return _clean(float(obj))
    return obj


SERVE_TOLERANCE = 0.0006  # degrees, ~60 m: about a pixel at zoom 11


def serving_geometry(regions: gpd.GeoDataFrame, tolerance: float = SERVE_TOLERANCE) -> gpd.GeoDataFrame:
    """Lighter polygons for the map. Leaves are simplified as one coverage, so
    neighbours keep an identical shared edge (no slivers or overlaps), and each
    country is the union of its simplified leaves."""
    geo = regions.copy()
    leaf = (geo["level"] != "country").to_numpy()
    geo.loc[leaf, "geometry"] = shapely.coverage_simplify(geo.geometry[leaf].to_numpy(), tolerance)
    for i in np.flatnonzero(~leaf):
        kids = geo["parent_id"] == geo.at[geo.index[i], "region_id"]
        geo.at[geo.index[i], "geometry"] = shapely.union_all(geo.geometry[kids].to_numpy())
    return geo


def write_all(store_dir: Path, *, regions: gpd.GeoDataFrame, hotspots: pd.DataFrame | None, weekly: pd.DataFrame,
              annual: pd.DataFrame, calendars: dict, skill: dict, model_report: dict, risk_now: pd.DataFrame,
              outlook_now: pd.DataFrame, fire_weather: pd.DataFrame, risk_history: pd.DataFrame,
              grid: pd.DataFrame | None, meta: dict, weather: pd.DataFrame, hotspot_years: list[int] | None = None) -> None:
    """Write a batch store. Detections go to per-year files (odlar.points); with
    ``hotspot_years`` only those years are written (the caller carries the rest over)."""
    store_dir.mkdir(parents=True, exist_ok=True)
    serving_geometry(regions).to_file(store_dir / "regions.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    pd.DataFrame(regions.drop(columns="geometry")).to_parquet(store_dir / "regions.parquet")
    if hotspots is not None:  # None: the caller has already put the point files in place
        write_points(store_dir, hotspots, hotspot_years)
    weekly.to_parquet(store_dir / "weekly.parquet")
    annual.to_parquet(store_dir / "annual.parquet")
    risk_now.assign(drivers=risk_now["drivers"].map(json.dumps)).to_parquet(store_dir / "risk_now.parquet")
    outlook_now.to_parquet(store_dir / "outlook_now.parquet")
    fire_weather.to_parquet(store_dir / "fire_weather.parquet")
    risk_history.to_parquet(store_dir / "risk_history.parquet")
    if grid is not None:  # None: the caller links the previous grid over
        grid.sort_values(["year", "cy", "cx"]).to_parquet(store_dir / "grid.parquet", index=False,
                                                          row_group_size=200_000)
    weather.to_parquet(store_dir / "weather_recent.parquet")
    write_json(store_dir / "calendars.json", {str(k): v for k, v in calendars.items()})
    write_json(store_dir / "skill.json", skill)
    write_json(store_dir / "model_report.json", model_report)
    write_json(store_dir / "meta.json", meta)


def write_state(state_dir: Path, *, weather: pd.DataFrame, elevation: pd.Series,
                static_cells: pd.DataFrame, daily_recent: pd.DataFrame | None = None) -> None:
    """Full-record inputs for ``odlar.refresh``: raw daily weather, region
    elevation, the persistent heat-source cells found on the full archive and the
    recent region-day detection counts (so the refresh never reads point files)."""
    state_dir.mkdir(parents=True, exist_ok=True)
    w = weather[["region_id", "date", "tmax", "tmean", "rh", "wind", "precip"]].copy()
    w["date"] = pd.to_datetime(w["date"])
    w.to_parquet(state_dir / "weather.parquet")
    elevation.rename("elevation").rename_axis("region_id").reset_index().to_parquet(state_dir / "elevation.parquet")
    static_cells.to_parquet(state_dir / "static_cells.parquet")
    if daily_recent is not None:
        daily_recent.to_parquet(state_dir / "daily_recent.parquet", index=False)


# Loaded into memory; detections and the density grid stay on disk (``points``, ``grid_paths``).
_TABLES = ("regions", "weekly", "annual", "outlook_now", "fire_weather", "risk_history", "weather_recent")


class Store:
    """In-memory view of the served data; loaded once per API process.

    Given several batch stores it serves their union: tables are concatenated
    (region ids are unique across batches), and the per-batch skill reports and
    metadata are kept under ``skills``/``model_reports``/``meta["batches"]``. The
    top-level ``skill``/``model_report`` are the primary (pilot) batch's.
    """

    def __init__(self, store_dirs: Path | list[Path] = STORE_DIR, names: list[str] | None = None):
        dirs = [store_dirs] if isinstance(store_dirs, Path) else list(store_dirs)
        names = names or [d.parent.name for d in dirs]
        for d in dirs:
            if not (d / "meta.json").exists():
                raise FileNotFoundError(f"no ODLAR store at {d}; run `python -m odlar.pipeline` first")
        self.dirs = dirs
        self.stamp = tuple((d / "meta.json").stat().st_mtime_ns for d in dirs)
        parts: dict[str, list[pd.DataFrame]] = {t: [] for t in _TABLES}
        self.calendars, self.skills, self.model_reports, metas, feats, risk = {}, {}, {}, {}, [], []
        batch_of = {}
        for name, d in zip(names, dirs, strict=True):
            for t in _TABLES:
                parts[t].append(pd.read_parquet(d / f"{t}.parquet"))
            metas[name] = json.loads((d / "meta.json").read_text())
            feats += json.loads((d / "regions.geojson").read_text())["features"]
            self.calendars.update(json.loads((d / "calendars.json").read_text()))
            self.skills[name] = json.loads((d / "skill.json").read_text())
            self.model_reports[name] = json.loads((d / "model_report.json").read_text())
            rn = pd.read_parquet(d / "risk_now.parquet")
            rn["drivers"] = rn["drivers"].map(json.loads)
            risk.append(rn)
            batch_of.update(dict.fromkeys(parts["regions"][-1]["region_id"].astype(int), name))
        cat = {t: pd.concat(v, ignore_index=True) for t, v in parts.items()}
        primary = names[0]
        self.batch_of = batch_of
        self.skill, self.model_report = self.skills[primary], self.model_reports[primary]
        self.meta = merged_meta(metas, primary)
        self.regions, self.weekly, self.annual = cat["regions"], cat["weekly"], cat["annual"]
        self.outlook_now, self.fire_weather, self.risk_history = cat["outlook_now"], cat["fire_weather"], cat["risk_history"]
        self.weather = cat["weather_recent"]
        self.points = Points(dirs)
        # the refresh keeps the grid of its tail detections apart (grid_tail.parquet)
        self.grid_paths = [str(p) for d in dirs for p in (d / "grid.parquet", d / "grid_tail.parquet") if p.exists()]
        self.risk_now = pd.concat(risk, ignore_index=True)
        self.regions_geojson = {"type": "FeatureCollection", "features": feats}
        self.by_slug = {r.slug: r for r in self.regions.itertuples()}
        self.by_id = {int(r.region_id): r for r in self.regions.itertuples()}
        self.parent = self.regions.set_index("region_id")["parent_id"]

    def skill_for(self, region_id: int) -> dict:
        return self.skills[self.batch_of.get(int(region_id), next(iter(self.skills)))]


def merged_meta(metas: dict[str, dict], primary: str) -> dict:
    """The primary batch's metadata, with what every batch shares made common: the
    record ends where the least recent batch ends; counts are summed."""
    m = dict(metas[primary])
    if len(metas) > 1:
        m["data_end"] = min(x["data_end"] for x in metas.values())
        m["built_at"] = max(x["built_at"] for x in metas.values())
        m["n_hotspots"] = sum(int(x.get("n_hotspots", 0)) for x in metas.values())
        sats: dict[str, int] = {}
        for x in metas.values():
            for k, v in (x.get("by_satellite") or {}).items():
                sats[k] = sats.get(k, 0) + int(v)
        m["by_satellite"] = sats
    m["batches"] = {k: {f: v.get(f) for f in ("data_end", "built_at", "refreshed_at", "n_hotspots", "source")}
                    for k, v in metas.items()}
    m["primary_batch"] = primary
    return m


_current: Store | None = None
_lock = threading.Lock()


def built_batches() -> list[tuple[str, Path]]:
    """(name, store dir) of every configured batch that has a store, primary first."""
    from odlar.config import ARTIFACTS_DIR, BATCHES, PRIMARY_BATCH
    root = Path(os.environ.get("ODLAR_ARTIFACTS_DIR", ARTIFACTS_DIR))
    order = [PRIMARY_BATCH] + [n for n in BATCHES if n != PRIMARY_BATCH]
    return [(n, root / n / "store") for n in order if (root / n / "store" / "meta.json").exists()]


def get_store() -> Store:
    """The loaded store. A refresh swaps in a new store directory; the next call
    sees a different meta.json and loads it, so the API never needs a restart."""
    global _current
    found = built_batches()
    if not found:
        raise FileNotFoundError("no ODLAR store; run `python -m odlar.pipeline` first")
    with _lock:  # one load at a time: sync endpoints run in a thread pool
        stamp = tuple((d / "meta.json").stat().st_mtime_ns for _, d in found)
        if _current is None or _current.stamp != stamp:
            _current = Store([d for _, d in found], [n for n, _ in found])
        return _current
