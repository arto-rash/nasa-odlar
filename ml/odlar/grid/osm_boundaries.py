"""Full-resolution region boundaries from OpenStreetMap (Overpass API).

    python -m odlar.grid.osm_boundaries AZE GEO ARM

The basemap (OpenFreeMap) draws OSM borders, so taking the region polygons from
the same OSM relations makes them line up with what is on the map. geoBoundaries'
open releases for the pilot countries are traced from small-scale maps (an
Azerbaijani district has ~140 vertices) and visibly cut corners.

The unit list stays the geoBoundaries one, so slugs and region ids do not change;
:func:`conflate` maps OSM units onto it. Sea is cut off along the OSM coastline.
The output (``<file>_OSM.geojson``) has the same ``shapeName`` schema and is what
:func:`odlar.grid.regions.load_regions` reads. Overpass responses are cached.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path

import geopandas as gpd
import httpx
import pandas as pd
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon
from shapely.ops import linemerge, polygonize, unary_union

from odlar.config import BOUNDARY_DIR, CACHE_DIR

OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter")
USER_AGENT = "ODLAR/1.0 (NASA Space Apps 2026 fire-risk project)"


def overpass(query: str, client: httpx.Client, retries: int = 5) -> dict:
    path = CACHE_DIR / "osm" / f"{hashlib.sha1(query.encode()).hexdigest()[:16]}.json"
    if path.exists():
        return json.loads(path.read_text())
    for attempt in range(retries * len(OVERPASS)):
        try:
            resp = client.post(OVERPASS[attempt % len(OVERPASS)], data={"data": query})
        except httpx.TransportError:
            time.sleep(10)
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            time.sleep(10 * (attempt // len(OVERPASS) + 1))
            continue
        resp.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(resp.text)
        return resp.json()
    raise RuntimeError("Overpass kept failing")


def relation_polygon(rel: dict) -> Polygon | MultiPolygon | None:
    """Assemble a boundary relation from its member ways (``out geom``)."""
    rings: dict[str, list[LineString]] = {"outer": [], "inner": []}
    for m in rel.get("members", []):
        if m.get("type") != "way" or "geometry" not in m:
            continue
        role = "inner" if m.get("role") == "inner" else "outer"
        pts = [(p["lon"], p["lat"]) for p in m["geometry"]]
        if len(pts) >= 2:
            rings[role].append(LineString(pts))
    if not rings["outer"]:
        return None
    outer = unary_union(list(polygonize(linemerge(rings["outer"]))))
    if rings["inner"]:
        outer = outer.difference(unary_union(list(polygonize(linemerge(rings["inner"])))))
    return outer.buffer(0) if not outer.is_empty else None


def fetch_units(iso2: str, level: int | str, client: httpx.Client, bbox=None) -> gpd.GeoDataFrame:
    """Admin units of one level (or a level regex) in a country, optionally within a bbox."""
    where = f"({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]})" if bbox is not None else ""
    q = (f'[out:json][timeout:300];area["ISO3166-1"="{iso2}"][admin_level=2]->.a;'
         f'rel(area.a)[boundary=administrative][admin_level~"^({level})$"]{where};out geom;')
    rows = []
    for rel in overpass(q, client)["elements"]:
        geom = relation_polygon(rel)
        if geom is not None:
            tags = rel.get("tags", {})
            rows.append({"osm_id": rel["id"], "osm_name": tags.get("name:en", tags.get("name")), "geometry": geom})
    return gpd.GeoDataFrame(rows, columns=["osm_id", "osm_name", "geometry"], geometry="geometry", crs=4326)


def fetch_coastline(bounds, client: httpx.Client) -> MultiLineString | None:
    w, so, e, n = bounds
    q = f"[out:json][timeout:300];way[natural=coastline]({so - 0.2},{w - 0.2},{n + 0.2},{e + 0.2});out geom;"
    lines = [LineString([(p["lon"], p["lat"]) for p in el["geometry"]])
             for el in overpass(q, client)["elements"] if len(el.get("geometry", [])) >= 2]
    return MultiLineString(lines) if lines else None


def land_part(geom, coast, land_ref):
    """Drop the sea: OSM admin units include territorial waters. The unit is cut
    along the coastline and only faces that lie mostly on (coarse) land are kept."""
    if coast is None or geom.is_empty or not geom.intersects(coast):
        return geom
    keep = []
    for f in polygonize(unary_union([geom.boundary, coast.intersection(geom)])):
        if not geom.contains(f.representative_point()):
            continue
        share = f.intersection(land_ref).area / f.area
        if share > 0.5:
            keep.append(f)
        elif share > 0.1:
            # the coastline does not close across this face (a gap in the OSM
            # coastline): fall back to the coarse land outline for it
            keep.append(f.intersection(land_ref))
    return unary_union(keep) if keep else geom


def base_name(name: str | None) -> str:
    """'Naftalan City' / 'Sheki District' / 'Karadag Raion' -> 'naftalan' / 'sheki' / 'karadag'."""
    s = re.sub(r"\b(district|city|raion|rayon|municipality|province)\b", "", str(name or "").lower())
    return re.sub(r"[^a-z]", "", s)


def conflate(osm: gpd.GeoDataFrame, gb: gpd.GeoDataFrame, finer: gpd.GeoDataFrame | None = None,
             min_gap_km2: float = 500.0) -> gpd.GeoDataFrame:
    """Our unit list (geoBoundaries names) with OSM geometry.

    * each OSM unit goes to the unit it matches best (intersection over union), so
      an OSM unit our list does not have (e.g. Soviet-era districts) is merged
      into the one it mostly lies in;
    * a unit with no OSM counterpart (a city OSM does not split off) keeps its
      geoBoundaries shape, cut out of its OSM neighbours;
    * areas the OSM level leaves out are filled from the next finer OSM level
      (Baku's raions sit one level below the other districts), and what is still
      missing (disputed territory) from geoBoundaries.
    """
    eo, eg = osm.to_crs(6933).geometry, gb.to_crs(6933).geometry
    owner: dict[int, list[int]] = {}
    for j, g in eo.items():
        inter = eg.intersection(g).area
        iou = inter / (eg.area + g.area - inter)
        i = int(iou.idxmax())
        if inter[i] > 0.2 * g.area:
            owner.setdefault(i, []).append(j)
    # A unit left without a match takes back an OSM unit of the same name that
    # went to a neighbour (a city whose OSM territory overlaps its district more).
    for i in gb.index:
        if i in owner:
            continue
        for k, js in list(owner.items()):
            same = [j for j in js if base_name(osm.at[j, "osm_name"]) == base_name(gb.at[i, "shapeName"])]
            if same and len(js) > 1:
                owner[i] = same
                owner[k] = [j for j in js if j not in same]
                break
    geoms = {i: unary_union([osm.geometry[j] for j in js]) for i, js in owner.items()}
    missing = [i for i in gb.index if i not in geoms]
    for i in missing:
        hole = gb.geometry[i]
        geoms = {k: v.difference(hole) for k, v in geoms.items()}
        geoms[i] = hole
    covered = unary_union(list(geoms.values()))
    if finer is not None and len(finer):
        for g in finer.geometry:
            piece = g.difference(covered)
            if piece.is_empty or piece.area < 0.5 * g.area:
                continue
            inter = gb.geometry.intersection(piece).area
            i = int(inter.idxmax())
            if inter[i] > 0.5 * piece.area:
                geoms[i] = geoms[i].union(piece)
                covered = covered.union(piece)
    gap = gb.geometry.union_all().difference(covered)
    filled = []
    for part in getattr(gap, "geoms", [gap]):
        if gpd.GeoSeries([part], crs=4326).to_crs(6933).area.iloc[0] / 1e6 < min_gap_km2:
            continue
        i = int(gb.geometry.intersection(part).area.idxmax())
        geoms[i] = geoms[i].union(part)
        filled.append(gb.at[i, "shapeName"])
    out = gpd.GeoDataFrame({
        "shapeName": gb["shapeName"],
        "osm_names": [", ".join(str(osm.at[j, "osm_name"]) for j in owner.get(i, [])) or None for i in gb.index],
        "geometry": [geoms[i].buffer(0) for i in gb.index]}, crs=4326)
    out.attrs.update(missing=[gb.at[i, "shapeName"] for i in missing], filled=filled)
    return out


def build(iso3: str, client: httpx.Client, boundary_dir: Path = BOUNDARY_DIR) -> gpd.GeoDataFrame:
    from odlar.grid.regions import COUNTRIES
    meta = COUNTRIES[iso3]
    gb = gpd.read_file(boundary_dir / f"{meta['file']}.geojson").to_crs(4326)
    gb["geometry"] = gb.geometry.make_valid()
    gb = gb.dissolve(by="shapeName", as_index=False)
    level = meta["osm_level"]
    osm = fetch_units(meta["iso2"], level, client)
    coast = fetch_coastline(gb.total_bounds, client)
    land = gb.geometry.union_all()
    osm["geometry"] = [land_part(g, coast, land) for g in osm.geometry]
    # Areas this level misses are looked up one and two levels down, only there.
    gap = land.difference(osm.geometry.union_all())
    parts = gpd.GeoSeries(list(getattr(gap, "geoms", [gap])), crs=4326)
    big = parts[parts.to_crs(6933).area / 1e6 > 50]
    finer = [fetch_units(meta["iso2"], f"{level + 1}|{level + 2}", client, bbox=b) for b in big.bounds.to_numpy()]
    finer = pd.concat(finer, ignore_index=True).drop_duplicates("osm_id") if finer else None
    if finer is not None and len(finer):
        finer["geometry"] = [land_part(g, coast, land) for g in finer.geometry]
    merged = conflate(osm, gb, finer)
    print(f"{iso3}: {len(osm)} OSM units -> {len(merged)} regions; geoBoundaries shape kept for "
          f"{merged.attrs['missing']}; gaps filled in {merged.attrs['filled']}")
    for r in merged.itertuples():
        print(f"    {r.shapeName:34s} <- {r.osm_names}")
    return merged


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("countries", nargs="+")
    a = ap.parse_args()
    with httpx.Client(timeout=400, headers={"User-Agent": USER_AGENT}) as client:
        from odlar.grid.regions import COUNTRIES
        for iso3 in a.countries:
            gdf = build(iso3, client)
            path = BOUNDARY_DIR / f"{COUNTRIES[iso3]['file']}_OSM.geojson"
            path.write_text(json.dumps(json.loads(gdf.to_json(drop_id=True)), separators=(",", ":")))
            print(f"  wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB)")
            time.sleep(10)


if __name__ == "__main__":
    main()
