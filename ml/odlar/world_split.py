"""Big countries at local-unit resolution, split into batches of ~200 units.

    python -m odlar.world_split           # downloads, then rewrites data/world.json

Province-sized units (~3,000 km²) mean counties, municipalities or districts in
the biggest countries: thousands of units, far more than one batch's feature
panel can hold in a laptop's memory. Each such country is cut along its states
(ADM1): a state becomes a parent region of its own (kind "state") and its local
units are the leaves; a state with more than ``MAX_UNITS`` units is cut into
geographic chunks. States are then packed into batches of at most ``MAX_UNITS``
units. Boundaries are the national statistical offices' layers as published by
geoBoundaries (full resolution).
"""

from __future__ import annotations

import json
import re
import time

import geopandas as gpd
import httpx
import numpy as np

from odlar.config import BOUNDARY_DIR, WORLD_FILE
from odlar.grid.osm_boundaries import unmangle

# country -> geoBoundaries level of its local units (counties, municipalities, districts)
SPLIT_LEVELS = {"AUS": "ADM2", "USA": "ADM2", "BRA": "ADM2", "RUS": "ADM2", "CHN": "ADM2", "IND": "ADM2",
                "CAN": "ADM3", "ARG": "ADM2", "IDN": "ADM2", "KAZ": "ADM2"}
MAX_UNITS = 200
SPLIT_DIR = BOUNDARY_DIR / "world" / "split"
FIRST_OFFSET = 1_000_000
OFFSET_STEP = 10_000


def slug(text: str) -> str:
    from odlar.grid.regions import slugify
    return slugify(text)


def gb_full(iso3: str, adm: str, client: httpx.Client) -> gpd.GeoDataFrame:
    """geoBoundaries full-resolution layer, downloaded once."""
    path = SPLIT_DIR / "raw" / f"{iso3}_{adm}.geojson"
    for attempt in range(5):
        if path.exists():
            break
        try:
            meta = client.get(f"https://www.geoboundaries.org/api/current/gbOpen/{iso3}/{adm}/").json()
            resp = client.get(meta["gjDownloadURL"], follow_redirects=True, timeout=1800)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            if attempt == 4:
                raise
            print(f"  {iso3} {adm}: {exc!r:.80}, retrying", flush=True)
            time.sleep(30 * (attempt + 1))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
        print(f"  {iso3} {adm}: {path.stat().st_size / 1e6:.0f} MB", flush=True)
    gdf = gpd.read_file(path).to_crs(4326)
    gdf["shapeName"] = gdf["shapeName"].map(unmangle).fillna("").astype(str)
    gdf["geometry"] = gdf.geometry.make_valid()
    return gdf[~gdf.geometry.is_empty]


def morton(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Z-order key of points, so consecutive units are close together."""
    xi = ((x - x.min()) / max(np.ptp(x), 1e-9) * 65535).astype(np.uint64)
    yi = ((y - y.min()) / max(np.ptp(y), 1e-9) * 65535).astype(np.uint64)
    key = np.zeros_like(xi)
    for bit in range(16):
        key |= ((xi >> bit) & 1) << (2 * bit) | ((yi >> bit) & 1) << (2 * bit + 1)
    return key


def split_country(iso3: str, country: dict, client: httpx.Client) -> list[dict]:
    """Pseudo-countries (states or chunks of them) of one big country, written as
    boundary files. Returns their catalogue entries."""
    units = gb_full(iso3, SPLIT_LEVELS[iso3], client)
    states = gb_full(iso3, "ADM1", client)
    pts = gpd.GeoDataFrame(units[["shapeName"]], geometry=units.geometry.representative_point(), crs=4326)
    joined = gpd.sjoin(pts, states[["shapeName", "geometry"]].rename(columns={"shapeName": "state"}),
                       how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]
    units["state"] = joined["state"].reindex(units.index)
    missing = units["state"].isna()
    if missing.any():  # on a border or offshore: nearest state
        near = gpd.sjoin_nearest(pts[missing].to_crs(6933),
                                 states[["shapeName", "geometry"]].rename(columns={"shapeName": "state"}).to_crs(6933))
        near = near[~near.index.duplicated(keep="first")]
        units.loc[missing, "state"] = near["state"].reindex(units.index[missing]).to_numpy()
    units = units.dropna(subset=["state"])
    # units sharing a name inside one state are one unit (split polygons)
    units = units.dissolve(by=["state", "shapeName"], as_index=False)
    rp = units.geometry.representative_point()
    units["x"], units["y"] = rp.x.to_numpy(), rp.y.to_numpy()

    entries = []
    for state, g in units.groupby("state", sort=False):
        g = g.iloc[np.argsort(morton(g["x"].to_numpy(), g["y"].to_numpy()), kind="stable")]
        n_chunks = int(np.ceil(len(g) / MAX_UNITS))
        for k in range(n_chunks):
            part = g.iloc[k * len(g) // n_chunks:(k + 1) * len(g) // n_chunks]
            name = state if n_chunks == 1 else f"{state} ({k + 1}/{n_chunks})"
            key = f"{iso3}-{slug(name)}"[:60]
            file = f"world/split/{key}"
            path = BOUNDARY_DIR / f"{file}_OSM.geojson"
            part[["shapeName", "geometry"]].to_file(path, driver="GeoJSON")
            (BOUNDARY_DIR / f"{file}_OSM.level").write_text(f"geoboundaries {SPLIT_LEVELS[iso3]} split, {len(part)} units")
            entries.append({
                "key": key, "code": country["code"], "iso2": country["iso2"], "name_en": name, "name_az": name,
                "file": file, "source": "split", "kind": "state",
                "slug": f"{country['code']}-{slug(name)}", "firms_name": country["firms_name"],
                "subregion": country["subregion"], "n_adm1": len(part), "parent_country": iso3,
                "weight": country["weight"] * len(part) / len(units), "x": float(part["x"].mean()),
            })
    print(f"{iso3}: {len(units)} units in {len(entries)} states/parts", flush=True)
    return entries


def pack(entries: list[dict]) -> list[list[dict]]:
    """States packed west to east into batches of at most MAX_UNITS units."""
    groups: list[list[dict]] = []
    for e in sorted(entries, key=lambda e: e["x"]):
        if groups and sum(x["n_adm1"] for x in groups[-1]) + e["n_adm1"] <= MAX_UNITS:
            groups[-1].append(e)
        else:
            groups.append([e])
    return groups


def main() -> None:
    world = json.loads(WORLD_FILE.read_text())
    countries, batches = world["countries"], world["batches"]
    split_names = set()
    offset = max([FIRST_OFFSET - OFFSET_STEP] + [b["id_offset"] for b in batches if b["id_offset"] >= FIRST_OFFSET])
    with httpx.Client(timeout=300, headers={"User-Agent": "ODLAR/1.0"}) as client:
        for iso3 in SPLIT_LEVELS:
            if any(b.get("split_of") == iso3 for b in batches):
                print(f"{iso3}: already split", flush=True)
                continue
            c = countries[iso3]
            entries = split_country(iso3, c, client)
            for e in entries:
                countries[e.pop("key")] = e
            keys = {v["file"]: k for k, v in countries.items()}
            country_slug = re.sub(r"[^a-z0-9]+", "_", c["name_en"].lower()).strip("_")
            for k, group in enumerate(pack(entries), 1):
                offset += OFFSET_STEP
                name = f"{country_slug}_{k:02d}"
                split_names.add(name)
                batches.append({"name": name, "countries": [keys[e["file"]] for e in group], "id_offset": offset,
                                "stream": False, "weight": sum(e["weight"] for e in group), "split_of": iso3})
            # the whole-country batch at state level is replaced
            batches[:] = [b for b in batches if b.get("split_of") or iso3 not in b["countries"]]
            # saved after each country, so a failure later keeps this one
            WORLD_FILE.write_text(json.dumps(world, ensure_ascii=False, indent=1))
    print(f"{len(split_names)} split batches added -> {WORLD_FILE}", flush=True)


if __name__ == "__main__":
    main()
