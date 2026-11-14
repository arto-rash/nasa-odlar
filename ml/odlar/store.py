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


def write_all(store_dir: Path, *, regions: gpd.GeoDataFrame, hotspots: pd.DataFrame, weekly: pd.DataFrame,
              annual: pd.DataFrame, calendars: dict, skill: dict, model_report: dict, risk_now: pd.DataFrame,
              outlook_now: pd.DataFrame, fire_weather: pd.DataFrame, risk_history: pd.DataFrame,
              grid: pd.DataFrame, meta: dict, weather: pd.DataFrame) -> None:
    store_dir.mkdir(parents=True, exist_ok=True)
    serving_geometry(regions).to_file(store_dir / "regions.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    pd.DataFrame(regions.drop(columns="geometry")).to_parquet(store_dir / "regions.parquet")
    h = hotspots[["sensor", "satellite", "acq_date", "acq_time", "lat", "lon", "frp", "confidence", "region_id"]].copy()
    h["acq_date"] = pd.to_datetime(h["acq_date"])
    h.to_parquet(store_dir / "hotspots.parquet")
    weekly.to_parquet(store_dir / "weekly.parquet")
    annual.to_parquet(store_dir / "annual.parquet")
    risk_now.assign(drivers=risk_now["drivers"].map(json.dumps)).to_parquet(store_dir / "risk_now.parquet")
    outlook_now.to_parquet(store_dir / "outlook_now.parquet")
    fire_weather.to_parquet(store_dir / "fire_weather.parquet")
    risk_history.to_parquet(store_dir / "risk_history.parquet")
    grid.to_parquet(store_dir / "grid.parquet")
    weather.to_parquet(store_dir / "weather_recent.parquet")
    write_json(store_dir / "calendars.json", {str(k): v for k, v in calendars.items()})
    write_json(store_dir / "skill.json", skill)
    write_json(store_dir / "model_report.json", model_report)
    write_json(store_dir / "meta.json", meta)


def write_state(state_dir: Path, *, weather: pd.DataFrame, elevation: pd.Series,
                static_cells: pd.DataFrame) -> None:
    """Full-record inputs for ``odlar.refresh``: raw daily weather, region
    elevation and the persistent heat-source cells found on the full archive."""
    state_dir.mkdir(parents=True, exist_ok=True)
    w = weather[["region_id", "date", "tmax", "tmean", "rh", "wind", "precip"]].copy()
    w["date"] = pd.to_datetime(w["date"])
    w.to_parquet(state_dir / "weather.parquet")
    elevation.rename("elevation").rename_axis("region_id").reset_index().to_parquet(state_dir / "elevation.parquet")
    static_cells.to_parquet(state_dir / "static_cells.parquet")


class Store:
    """In-memory view of the store; loaded once per API process."""

    def __init__(self, store_dir: Path = STORE_DIR):
        d = store_dir
        if not (d / "meta.json").exists():
            raise FileNotFoundError(f"no ODLAR store at {d}; run `python -m odlar.pipeline` first")
        self.dir = d
        self.stamp = (d / "meta.json").stat().st_mtime_ns
        self.meta = json.loads((d / "meta.json").read_text())
        self.regions = pd.read_parquet(d / "regions.parquet")
        self.regions_geojson = json.loads((d / "regions.geojson").read_text())
        self.hotspots = pd.read_parquet(d / "hotspots.parquet")
        self.weekly = pd.read_parquet(d / "weekly.parquet")
        self.annual = pd.read_parquet(d / "annual.parquet")
        self.calendars = json.loads((d / "calendars.json").read_text())
        self.skill = json.loads((d / "skill.json").read_text())
        self.model_report = json.loads((d / "model_report.json").read_text())
        rn = pd.read_parquet(d / "risk_now.parquet")
        rn["drivers"] = rn["drivers"].map(json.loads)
        self.risk_now = rn
        self.outlook_now = pd.read_parquet(d / "outlook_now.parquet")
        self.fire_weather = pd.read_parquet(d / "fire_weather.parquet")
        self.risk_history = pd.read_parquet(d / "risk_history.parquet")
        self.grid = pd.read_parquet(d / "grid.parquet")
        self.weather = pd.read_parquet(d / "weather_recent.parquet")
        self.by_slug = {r.slug: r for r in self.regions.itertuples()}
        self.by_id = {int(r.region_id): r for r in self.regions.itertuples()}
        self.hotspots["week"] = self.hotspots["acq_date"] - pd.to_timedelta(self.hotspots["acq_date"].dt.day_of_week, unit="D")
        self.parent = self.regions.set_index("region_id")["parent_id"]


_current: Store | None = None
_lock = threading.Lock()


def get_store() -> Store:
    """The loaded store. A refresh swaps in a new store directory; the next call
    sees a different meta.json and loads it, so the API never needs a restart."""
    global _current
    d = Path(os.environ.get("ODLAR_STORE_DIR", STORE_DIR))
    meta = d / "meta.json"
    if not meta.exists():
        raise FileNotFoundError(f"no ODLAR store at {d}; run `python -m odlar.pipeline` first")
    with _lock:  # one load at a time: sync endpoints run in a thread pool
        if _current is None or _current.stamp != meta.stat().st_mtime_ns:
            _current = Store(d)
        return _current
