"""Fire detections on disk: one Parquet file per year, queried with DuckDB.

The detection record does not fit in memory at world scale (hundreds of
millions of points over 25 years), so the API never loads it. Each batch store
keeps ``hotspots/<year>.parquet``, rows sorted by date (then by 1° cell), so
DuckDB skips the row groups outside a weekly map query and only reads the
columns a query asks for. A query touches only the files of the years it spans.

The full build writes ``<year>.parquet``; the daily refresh only ever writes a
small ``<year>.tail.parquet`` with the detections after the build's last day, so
it never has to read or rewrite a big year file.
"""

from __future__ import annotations

import os
import shutil
import threading
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

POINTS_DIR = "hotspots"
COLUMNS = ["sensor", "satellite", "acq_date", "acq_time", "lat", "lon", "frp", "confidence", "region_id"]
ROW_GROUP = 50_000


def _sorted(df: pd.DataFrame) -> pd.DataFrame:
    """Date first: the map asks for a few weeks at a time, and date-ordered row
    groups let a weekly query skip the rest of the year. Within a day, by 1° cell."""
    cell = np.floor(df["lat"]).astype(int) * 1000 + np.floor(df["lon"]).astype(int)
    return df.assign(_cell=cell).sort_values(["acq_date", "_cell", "acq_time"]).drop(columns="_cell")


def write_points(store_dir: Path, hot: pd.DataFrame, years: list[int] | None = None, tail: bool = False) -> None:
    """Write ``hot`` as per-year files (``tail``: the refresh's tail files); only
    ``years`` if given, others untouched. A year with no rows has its file removed."""
    d = store_dir / POINTS_DIR
    d.mkdir(parents=True, exist_ok=True)
    h = hot[COLUMNS].copy()
    h["acq_date"] = pd.to_datetime(h["acq_date"])
    yr = h["acq_date"].dt.year
    suffix = ".tail.parquet" if tail else ".parquet"
    for y in sorted(set(yr.unique()) if years is None else years):
        part = _sorted(h[yr == y])
        if part.empty:
            (d / f"{y}{suffix}").unlink(missing_ok=True)
            continue
        tmp = d / f"{y}{suffix}.tmp"
        part.to_parquet(tmp, index=False, row_group_size=ROW_GROUP)
        os.replace(tmp, d / f"{y}{suffix}")


def point_files(store_dir: Path, tail: bool | None = None) -> dict[int, list[Path]]:
    """Year -> files; ``tail`` True/False keeps only tail/main files."""
    d = store_dir / POINTS_DIR
    out: dict[int, list[Path]] = {}
    for p in sorted(d.glob("*.parquet")) if d.exists() else []:
        is_tail = p.name.endswith(".tail.parquet")
        if tail is None or tail == is_tail:
            out.setdefault(int(p.name.split(".")[0]), []).append(p)
    return out


def point_years(store_dir: Path) -> list[int]:
    return sorted(point_files(store_dir))


def read_points(store_dir: Path, years: list[int] | None = None, tail: bool | None = None) -> pd.DataFrame:
    files = point_files(store_dir, tail)
    want = [p for y in sorted(files) if years is None or y in years for p in files[y]]
    if not want:
        return pd.DataFrame(columns=COLUMNS)
    return pd.concat([pd.read_parquet(p) for p in want], ignore_index=True)


def carry_over(old_store: Path, new_store: Path, skip: set[str] = frozenset()) -> None:
    """Hard-link (or copy) the old store's point files into the new one, except
    file names in ``skip`` and files the new store already has."""
    (new_store / POINTS_DIR).mkdir(parents=True, exist_ok=True)
    for files in point_files(old_store).values():
        for src in files:
            dst = new_store / POINTS_DIR / src.name
            if src.name in skip or dst.exists():
                continue
            try:
                os.link(src, dst)
            except OSError:
                shutil.copy2(src, dst)


def link(src: Path, dst: Path) -> None:
    """Hard-link ``src`` to ``dst`` (copy across filesystems); no-op if ``src`` is missing."""
    if not src.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


class Points:
    """Read-only query interface over the detection files of several batch stores."""

    def __init__(self, store_dirs: list[Path]):
        self.files: dict[int, list[str]] = {}
        for d in store_dirs:
            for y, paths in point_files(d).items():
                self.files.setdefault(y, []).extend(str(p) for p in paths)
        self._local = threading.local()

    def _con(self) -> duckdb.DuckDBPyConnection:
        con = getattr(self._local, "con", None)
        if con is None:
            con = duckdb.connect(config={"threads": 2, "memory_limit": "384MB"})
            self._local.con = con
        return con

    def _paths(self, years: range | list[int] | None) -> list[str]:
        ys = sorted(self.files) if years is None else [y for y in years if y in self.files]
        return [p for y in ys for p in self.files[y]]

    def query(self, where: str = "TRUE", params: list | None = None, columns: str = "*",
              years: range | list[int] | None = None, limit: int | None = None,
              order: str | None = None) -> pd.DataFrame:
        paths = self._paths(years)
        if not paths:
            return pd.DataFrame(columns=COLUMNS)
        sql = f"SELECT {columns} FROM read_parquet(?) WHERE {where}"
        if order:
            sql += f" ORDER BY {order}"
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        return self._con().execute(sql, [paths, *(params or [])]).df()

    def sample(self, n: int, where: str = "TRUE", params: list | None = None, columns: str = "*",
               years: range | list[int] | None = None, seed: int = 7) -> pd.DataFrame:
        """A uniform random sample of ``n`` matching rows (repeatable), for maps that
        cannot draw every point: dense areas stay dense, nothing moves."""
        paths = self._paths(years)
        if not paths:
            return pd.DataFrame(columns=COLUMNS)
        sql = (f"SELECT * FROM (SELECT {columns} FROM read_parquet(?) WHERE {where}) "
               f"USING SAMPLE reservoir({int(n)} ROWS) REPEATABLE ({int(seed)})")
        return self._con().execute(sql, [paths, *(params or [])]).df()

    def count(self, where: str = "TRUE", params: list | None = None,
              years: range | list[int] | None = None) -> int:
        paths = self._paths(years)
        if not paths:
            return 0
        return int(self._con().execute(f"SELECT count(*) FROM read_parquet(?) WHERE {where}",
                                       [paths, *(params or [])]).fetchone()[0])
