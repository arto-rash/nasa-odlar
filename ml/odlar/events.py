"""Fires now: recent detections grouped into fire events.

A detection is one hot pixel on one overpass. Pixels from both sensors are
linked when they lie in touching cells of a ~1.7 km grid (MODIS pixels are
~1 km, VIIRS 375 m) on the same or the next day, so a fire that keeps burning or
spreads stays one event, while fields burnt a week apart in the same farmland
do not merge into one. Each linked group is an event with its extent, first and
last day, size, intensity and whether both sensors saw it.

Built by the daily refresh per batch (``events_now.parquet``); the API serves
the union.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from odlar import points

WINDOW_DAYS = 14
CELL_DEG = 0.015       # ~1.7 km at the equator
ACTIVE_DAYS = 2        # seen in the last two days: still burning, as far as we know
COLUMNS = ["event_id", "lat", "lon", "west", "south", "east", "north", "first_seen", "last_seen", "days",
           "detections", "modis", "viirs", "frp_max", "frp_sum", "region_id", "active"]


def _key(cx: np.ndarray, cy: np.ndarray, day: np.ndarray) -> np.ndarray:
    # cells span ±12,000 in x and ±6,000 in y; days are counted from the window start
    return ((cx.astype(np.int64) + 20_000) * 40_000 + (cy.astype(np.int64) + 20_000)) * 64 + day.astype(np.int64)


def _components(cx: np.ndarray, cy: np.ndarray, day: np.ndarray) -> np.ndarray:
    """Label of each occupied (cell, day) by its group: touching cells on the same
    or an adjacent day (26-connected in space-time)."""
    n = len(cx)
    key = _key(cx, cy, day)
    order = np.argsort(key)
    skey = key[order]
    rows, cols = [np.arange(n)], [np.arange(n)]
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dt in (-1, 0, 1):
                if dx == 0 and dy == 0 and dt == 0:
                    continue
                nk = _key(cx + dx, cy + dy, day + dt)
                pos = np.minimum(np.searchsorted(skey, nk), n - 1)
                hit = skey[pos] == nk
                rows.append(np.flatnonzero(hit))
                cols.append(order[pos[hit]])
    r, c = np.concatenate(rows), np.concatenate(cols)
    graph = coo_matrix((np.ones(len(r), dtype=np.int8), (r, c)), shape=(n, n))
    return connected_components(graph, directed=False)[1]


def build_events(det: pd.DataFrame, end, window: int = WINDOW_DAYS) -> pd.DataFrame:
    """Fire events from detections (sensor, acq_date, lat, lon, frp, region_id)
    in the ``window`` days up to ``end``."""
    end = pd.Timestamp(end).normalize()
    d = det[["sensor", "acq_date", "lat", "lon", "frp", "region_id"]].copy()
    d["acq_date"] = pd.to_datetime(d["acq_date"]).dt.normalize()
    d = d[(d["acq_date"] > end - pd.Timedelta(days=window)) & (d["acq_date"] <= end)]
    if d.empty:
        return pd.DataFrame(columns=COLUMNS)
    d["cx"] = np.floor(d["lon"].to_numpy() / CELL_DEG).astype(np.int64)
    d["cy"] = np.floor(d["lat"].to_numpy() / CELL_DEG).astype(np.int64)
    d["day"] = ((d["acq_date"] - (end - pd.Timedelta(days=window))).dt.days).astype(np.int64)
    cells = d[["cx", "cy", "day"]].drop_duplicates().reset_index(drop=True)
    cells["label"] = _components(cells["cx"].to_numpy(), cells["cy"].to_numpy(), cells["day"].to_numpy())
    d = d.merge(cells, on=["cx", "cy", "day"], how="left")
    w = d["frp"].clip(lower=0.1)
    d["wlat"], d["wlon"], d["w"] = d["lat"] * w, d["lon"] * w, w
    d["is_modis"] = (d["sensor"] == "MODIS").astype(int)
    g = d.groupby("label")
    ev = pd.DataFrame({
        "lat": g["wlat"].sum() / g["w"].sum(), "lon": g["wlon"].sum() / g["w"].sum(),
        "west": g["lon"].min(), "south": g["lat"].min(), "east": g["lon"].max(), "north": g["lat"].max(),
        "first_seen": g["acq_date"].min(), "last_seen": g["acq_date"].max(), "days": g["acq_date"].nunique(),
        "detections": g.size(), "modis": g["is_modis"].sum(),
        "frp_max": g["frp"].max(), "frp_sum": g["frp"].sum(),
        "region_id": g["region_id"].agg(lambda s: s.mode().iat[0] if s.notna().any() else -1),
    }).reset_index(drop=True)
    ev["viirs"] = ev["detections"] - ev["modis"]
    ev["active"] = ev["last_seen"] >= end - pd.Timedelta(days=ACTIVE_DAYS - 1)
    # stable while the fire goes on: where and when it was first seen
    first = d.sort_values(["acq_date", "lat", "lon"]).groupby("label").head(1).set_index("label").sort_index()
    ev["event_id"] = [f"{la:.3f}_{lo:.3f}_{t:%Y%m%d}" for la, lo, t in
                      zip(first["lat"], first["lon"], first["acq_date"], strict=True)]
    for c in ("lat", "lon", "west", "south", "east", "north"):
        ev[c] = ev[c].astype("float64").round(4)
    ev["frp_max"] = ev["frp_max"].round(1)
    ev["frp_sum"] = ev["frp_sum"].round(1)
    ev["region_id"] = ev["region_id"].fillna(-1).astype("int64")
    return ev[COLUMNS].sort_values("frp_sum", ascending=False).reset_index(drop=True)


def write_events(store_dir: Path, end: date) -> None:
    """Fires now from the last two weeks of a store's detections."""
    since = pd.Timestamp(end) - pd.Timedelta(days=WINDOW_DAYS - 1)
    det = points.read_recent(store_dir, since, ["sensor", "acq_date", "lat", "lon", "frp", "region_id"])
    build_events(det, end).to_parquet(store_dir / "events_now.parquet", index=False)
