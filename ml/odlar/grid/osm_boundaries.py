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
import io
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
            rows.append({"osm_id": rel["id"], "osm_name": tags.get("name:en", tags.get("name")),
                         "name_az": tags.get("name:az"), "geometry": geom})
    return gpd.GeoDataFrame(rows, columns=["osm_id", "osm_name", "name_az", "geometry"], geometry="geometry",
                            crs=4326)


def unmangle(name):
    """Undo UTF-8 text that was decoded as Latin-1 ('RegiÃ£o' -> 'Região'), which
    some geoBoundaries releases carry; anything else is returned unchanged."""
    if not isinstance(name, str):
        return name
    try:
        fixed = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name
    return fixed


def _clean_names(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if "shapeName" in gdf:
        gdf["shapeName"] = gdf["shapeName"].map(unmangle)
    return gdf


def geoboundaries(iso3: str, adm: str, client: httpx.Client, boundary_dir: Path = BOUNDARY_DIR) -> gpd.GeoDataFrame:
    """geoBoundaries open release (simplified), downloaded once into ``boundary_dir``."""
    path = boundary_dir / f"{iso3}_{adm}.geojson"
    if not path.exists():
        meta = client.get(f"https://www.geoboundaries.org/api/current/gbOpen/{iso3}/{adm}/").json()
        resp = client.get(meta["simplifiedGeometryGeoJSON"], follow_redirects=True)
        resp.raise_for_status()
        path.write_bytes(resp.content)
    return _clean_names(gpd.read_file(path).to_crs(4326))


def build_osm_only(iso3: str, client: httpx.Client) -> gpd.GeoDataFrame:
    """Countries without a legacy unit list: OSM's units and names as they are,
    the sea cut off with geoBoundaries' outline as the land reference."""
    from odlar.grid.regions import COUNTRIES
    meta = COUNTRIES[iso3]
    land = geoboundaries(iso3, "ADM0", client).geometry.make_valid().union_all()
    osm = fetch_units(meta["iso2"], meta["osm_level"], client)
    coast = fetch_coastline(land.bounds, client)
    osm["geometry"] = [land_part(g, coast, land) for g in osm.geometry]
    # a relation that mostly repeats another (an old or duplicate boundary) is dropped
    eq = osm.to_crs(6933).geometry
    order = eq.area.sort_values(ascending=False).index
    keep, covered = [], None
    for j in order:
        if covered is not None and eq[j].intersection(covered).area > 0.8 * eq[j].area:
            print(f"  dropping {osm.at[j, 'osm_name']}: duplicates other units")
            continue
        keep.append(j)
        covered = eq[j] if covered is None else covered.union(eq[j])
    osm = osm.loc[sorted(keep)]
    print(f"{iso3}: {len(osm)} OSM units, {osm['name_az'].notna().sum()} with an Azerbaijani name")
    return gpd.GeoDataFrame({"shapeName": osm["osm_name"], "name_az": osm["name_az"],
                             "osm_id": osm["osm_id"], "geometry": osm.geometry}, crs=4326)


# Too big for Overpass to return whole provinces with full geometry: their
# geoBoundaries full-resolution files are used instead.
GEOBOUNDARIES_ONLY = {"RUS", "CAN", "USA", "CHN", "BRA", "AUS", "IND", "ARG", "KAZ", "GRL", "IDN"}


def geoboundaries_full(iso3: str, adm: str, client: httpx.Client) -> gpd.GeoDataFrame:
    """geoBoundaries open release at full resolution (not cached in boundary_dir)."""
    meta = client.get(f"https://www.geoboundaries.org/api/current/gbOpen/{iso3}/{adm}/").json()
    resp = client.get(meta["gjDownloadURL"], follow_redirects=True, timeout=600)
    resp.raise_for_status()
    return _clean_names(gpd.read_file(io.BytesIO(resp.content)).to_crs(4326))


def pick_level(iso2: str, target: int, client: httpx.Client) -> int | None:
    """The OSM admin level whose unit count is closest to geoBoundaries' ADM1 count."""
    q = (f'[out:json][timeout:300];area["ISO3166-1"="{iso2}"][admin_level=2]->.a;'
         f'rel(area.a)[boundary=administrative][admin_level~"^(3|4|5|6)$"];out tags;')
    counts: dict[int, int] = {}
    for e in overpass(q, client)["elements"]:
        try:
            lvl = int(e["tags"].get("admin_level", 0))
        except ValueError:
            continue
        counts[lvl] = counts.get(lvl, 0) + 1
    ok = {lvl: n for lvl, n in counts.items() if 2 <= n <= 3 * target + 5}
    if not ok:
        return None
    return min(ok, key=lambda lvl: (abs(ok[lvl] - target), abs(lvl - 4)))


def fill_gaps(units: gpd.GeoDataFrame, land, gb: gpd.GeoDataFrame, min_km2: float = 50.0) -> gpd.GeoDataFrame:
    """Add land the OSM level leaves out (e.g. Portugal's Azores and Madeira sit
    one level up from its districts) as the geoBoundaries ADM1 units found there."""
    gap = land.difference(units.geometry.union_all())
    if gap.is_empty:
        return units
    extra = []
    for _, u in gb.iterrows():
        piece = u.geometry.intersection(gap) if u.geometry is not None else None
        if piece is None or piece.is_empty:
            continue
        eq = gpd.GeoSeries([piece, u.geometry], crs=4326).to_crs(6933).area
        if eq.iloc[0] / 1e6 >= min_km2 and eq.iloc[0] >= 0.5 * eq.iloc[1]:
            extra.append({"shapeName": u["shapeName"], "name_az": None, "osm_id": None, "geometry": piece})
    if extra:
        print(f"  added from geoBoundaries: {[e['shapeName'] for e in extra]}")
        units = pd.concat([units, gpd.GeoDataFrame(extra, crs=4326)], ignore_index=True)
    return units


def build_world(iso3: str, client: httpx.Client) -> tuple[gpd.GeoDataFrame, str]:
    """Provinces of one country: OSM at the level matching geoBoundaries' ADM1,
    or geoBoundaries' full-resolution ADM1 when OSM is too big, has no such level,
    fails, or covers under 90% of the country's land. Returns (units, source)."""
    from odlar.grid.regions import COUNTRIES
    meta = COUNTRIES[iso3]
    land = geoboundaries(iso3, "ADM0", client).geometry.make_valid().union_all()
    land_km2 = gpd.GeoSeries([land], crs=4326).to_crs(6933).area.iloc[0] / 1e6
    if iso3 not in GEOBOUNDARIES_ONLY and meta.get("n_adm1", 0) > 1:
        try:
            level = pick_level(meta["iso2"], int(meta.get("n_adm1", 10)), client)
            if level is not None:
                osm = fetch_units(meta["iso2"], level, client)
                coast = fetch_coastline(land.bounds, client)
                osm["geometry"] = [land_part(g, coast, land) for g in osm.geometry]
                osm = osm[~osm.geometry.is_empty]
                cover = gpd.GeoSeries([osm.geometry.union_all().intersection(land)], crs=4326) \
                    .to_crs(6933).area.iloc[0] / 1e6
                if len(osm) and cover >= 0.9 * land_km2:
                    out = gpd.GeoDataFrame({"shapeName": osm["osm_name"], "name_az": osm["name_az"],
                                            "osm_id": osm["osm_id"], "geometry": osm.geometry}, crs=4326)
                    return fill_gaps(out, land, geoboundaries(iso3, "ADM1", client)), f"osm level {level}"
                print(f"  {iso3}: OSM level {level} covers {cover / land_km2:.0%} of the land; using geoBoundaries")
        except Exception as exc:  # noqa: BLE001 — any OSM trouble falls back to geoBoundaries
            print(f"  {iso3}: OSM failed ({exc!r:.120}); using geoBoundaries")
    try:
        gb = geoboundaries_full(iso3, "ADM1", client)
    except Exception:  # noqa: BLE001 — a few small countries have no ADM1 release
        gb = geoboundaries(iso3, "ADM0", client).assign(shapeName=meta["name_en"])
    gb["geometry"] = gb.geometry.make_valid()
    gb = gb.dissolve(by="shapeName", as_index=False)
    return gpd.GeoDataFrame({"shapeName": gb["shapeName"], "name_az": None, "osm_id": None,
                             "geometry": gb.geometry}, crs=4326), "geoboundaries"


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
    ap.add_argument("countries", nargs="*", help="ISO3 codes; with --world, every world-catalogue country")
    ap.add_argument("--world", action="store_true", help="all countries of data/world.json not done yet")
    a = ap.parse_args()
    with httpx.Client(timeout=400, headers={"User-Agent": USER_AGENT}) as client:
        from odlar.grid.regions import COUNTRIES
        if a.world:
            done = 0
            todo = [i for i, c in COUNTRIES.items() if c.get("subregion")
                    and not (BOUNDARY_DIR / f"{c['file']}_OSM.geojson").exists()]
            for iso3 in todo:
                try:
                    gdf, source = build_world(iso3, client)
                except Exception as exc:  # noqa: BLE001 — log and move on to the next country
                    print(f"{iso3}: FAILED {exc!r:.200}", flush=True)
                    continue
                path = BOUNDARY_DIR / f"{COUNTRIES[iso3]['file']}_OSM.geojson"
                path.write_text(json.dumps(json.loads(gdf.to_json(drop_id=True)), separators=(",", ":")))
                done += 1
                print(f"{iso3}: {len(gdf)} units from {source} ({path.stat().st_size / 1e6:.1f} MB) "
                      f"[{done}/{len(todo)}]", flush=True)
            return
        for iso3 in a.countries:
            gdf = build_osm_only(iso3, client) if COUNTRIES[iso3].get("source") == "osm" else build(iso3, client)
            path = BOUNDARY_DIR / f"{COUNTRIES[iso3]['file']}_OSM.geojson"
            path.write_text(json.dumps(json.loads(gdf.to_json(drop_id=True)), separators=(",", ":")))
            print(f"  wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB)")
            time.sleep(10)


if __name__ == "__main__":
    main()
