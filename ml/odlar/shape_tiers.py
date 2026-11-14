"""Province outlines light enough for regional zooms.

The stored map levels are too detailed for a view spanning a continent: thousands
of provinces at 500 m came to 3-5 MB. These tiers keep only what such a view can
show (a pixel is 0.05 degree at zoom 4 and 0.01 at zoom 6, half that on a retina
screen), simplifying each batch's borders together so neighbours still meet.

    python -m odlar.shape_tiers     # after building or rebuilding batches
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

from odlar.config import ARTIFACTS_DIR
from odlar.store import built_batches

TIER_DIR = ARTIFACTS_DIR / "shape_tiers"
TIERS = (("t4", 0.03, 0.004), ("t6", 0.01, 0.0004))  # key, tolerance, smallest islet (degrees)


def _without_specks(geom, smallest: float):
    parts = sorted(getattr(geom, "geoms", [geom]), key=lambda g: g.area, reverse=True)
    kept = [g for g in parts if g.area >= smallest] or parts[:1]
    return shapely.multipolygons(kept) if len(kept) > 1 else kept[0]


def tiers_for(rows: pd.DataFrame) -> pd.DataFrame:
    """``rows``: the batch's provinces from regions_geo.parquet, at the z1 level."""
    base = [shape(json.loads(g)).buffer(0) for g in rows["geometry"]]
    out = []
    for key, tolerance, smallest in TIERS:
        geoms = np.array([_without_specks(g, smallest) for g in base], dtype=object)
        try:
            slim = shapely.coverage_simplify(geoms, tolerance)
        except shapely.errors.GEOSException:
            slim = shapely.simplify(geoms, tolerance)
        slim = shapely.set_precision(slim, 0.001, mode="pointwise")
        keep = ~shapely.is_empty(slim)
        out.append(rows.loc[keep, ["region_id", "minx", "miny", "maxx", "maxy"]].assign(
            detail=key, geometry=shapely.to_geojson(slim[keep])))
    return pd.concat(out, ignore_index=True)


def main() -> None:
    TIER_DIR.mkdir(parents=True, exist_ok=True)
    for name, store_dir in built_batches():
        rows = pd.read_parquet(store_dir / "regions_geo.parquet",
                               filters=[("detail", "==", "z1"), ("is_country", "==", False)]).reset_index(drop=True)
        (tiers_for(rows) if len(rows) else rows.assign(detail="t4")).to_parquet(TIER_DIR / f"{name}.parquet", index=False)
    print("done", flush=True)


if __name__ == "__main__":
    main()
