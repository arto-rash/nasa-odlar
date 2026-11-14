"""Region catalogue for the South Caucasus pilot.

Azerbaijan is modelled at district (rayon, geoBoundaries ADM2) level; Georgia and
Armenia at ADM1. Each country is also a region in its own right, used for
national aggregates and as the hierarchical fallback in harmonization.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from odlar.config import BATCHES, BOUNDARY_DIR, PRIMARY_BATCH, WORLD_FILE

COUNTRIES = {
    "AZE": {"code": "az", "iso2": "AZ", "name_en": "Azerbaijan", "name_az": "Azərbaycan", "file": "AZE_ADM2",
            "osm_level": 6},
    "GEO": {"code": "ge", "iso2": "GE", "name_en": "Georgia", "name_az": "Gürcüstan", "file": "GEO_ADM1",
            "osm_level": 4},
    "ARM": {"code": "am", "iso2": "AM", "name_en": "Armenia", "name_az": "Ermənistan", "file": "ARM_ADM1",
            "osm_level": 4},
    # OSM-only countries: the unit list and names come from OSM itself
    # (odlar.grid.osm_boundaries --osm-only), with the Azerbaijani name where OSM has one.
    "TUR": {"code": "tr", "iso2": "TR", "name_en": "Turkey", "name_az": "Türkiyə", "file": "TUR_ADM1",
            "osm_level": 4, "source": "osm", "firms_name": "Turkey"},
    "IRN": {"code": "ir", "iso2": "IR", "name_en": "Iran", "name_az": "İran", "file": "IRN_ADM1",
            "osm_level": 4, "source": "osm", "firms_name": "Iran"},
}

# Every other country (odlar.world): OSM units and names, FIRMS country files.
if WORLD_FILE.exists():
    for _iso3, _c in json.loads(WORLD_FILE.read_text())["countries"].items():
        COUNTRIES.setdefault(_iso3, _c)

AZ_NAMES = {
    "Absheron": "Abşeron", "Agdam": "Ağdam", "Agdash": "Ağdaş", "Aghjabadi": "Ağcabədi",
    "Agstafa": "Ağstafa", "Agsu": "Ağsu", "Astara": "Astara", "Babek": "Babək", "Baku": "Bakı",
    "Balakan": "Balakən", "Barda": "Bərdə", "Beylagan": "Beyləqan", "Bilasuvar": "Biləsuvar",
    "Dashkasan": "Daşkəsən", "Fuzuli": "Füzuli", "Gadabay": "Gədəbəy", "Ganja": "Gəncə",
    "Gobustan": "Qobustan", "Goranboy": "Goranboy", "Goychay": "Göyçay", "Goygol": "Göygöl",
    "Hajigabul": "Hacıqabul", "Imishli": "İmişli", "Ismailli": "İsmayıllı", "Jabrayil": "Cəbrayıl",
    "Jalilabad": "Cəlilabad", "Julfa": "Culfa", "Kalbajar": "Kəlbəcər", "Kangarli": "Kəngərli",
    "Khachmaz": "Xaçmaz", "Khankendi": "Xankəndi", "Khizi": "Xızı", "Khojaly": "Xocalı",
    "Khojavend": "Xocavənd", "Kurdamir": "Kürdəmir", "Lachin": "Laçın", "Lankaran": "Lənkəran",
    "Lerik": "Lerik", "Masally": "Masallı", "Mingachevir": "Mingəçevir", "Naftalan": "Naftalan",
    "Nakhchivan": "Naxçıvan", "Neftchala": "Neftçala", "Oghuz": "Oğuz", "Ordubad": "Ordubad",
    "Qabala": "Qəbələ", "Qakh": "Qax", "Qazakh": "Qazax", "Quba": "Quba", "Qubadli": "Qubadlı",
    "Qusar": "Qusar", "Saatly": "Saatlı", "Sabirabad": "Sabirabad", "Sadarak": "Sədərək",
    "Salyan": "Salyan", "Samukh": "Samux", "Shabran": "Şabran", "Shahbuz": "Şahbuz",
    "Shaki": "Şəki", "Shamakhi": "Şamaxı", "Shamkir": "Şəmkir", "Sharur": "Şərur",
    "Shirvan": "Şirvan", "Shusha": "Şuşa", "Siazan": "Siyəzən", "Sumqayit": "Sumqayıt",
    "Tartar": "Tərtər", "Tovuz": "Tovuz", "Ujar": "Ucar", "Yardymli": "Yardımlı",
    "Yevlakh": "Yevlax", "Zangilan": "Zəngilan", "Zaqatala": "Zaqatala", "Zardab": "Zərdab",
    # Georgia
    "Abkhazia": "Abxaziya", "Adjara": "Acarıstan", "Guria": "Quriya", "Imereti": "İmereti",
    "Kakheti": "Kaxeti", "Kvemo Kartli": "Kvemo Kartli", "Mtskheta-Mtianeti": "Msxeta-Mtianeti",
    "Racha-Lechkhumi and Kvemo Svaneti": "Raça-Leçxumi və Kvemo Svaneti",
    "Samegrelo-Zemo Svaneti": "Sameqrelo-Zemo Svaneti", "Samtskhe–Javakheti": "Samtsxe-Cavaxeti",
    "Shida Kartli": "Şida Kartli", "Tbilisi": "Tbilisi",
    # Armenia
    "Aragatsotn": "Araqatsotn", "Ararat": "Ararat", "Armavir": "Armavir", "Gegharkunik": "Geqarkunik",
    "Kotayk": "Kotayk", "Lori": "Lori", "Shirak": "Şirak", "Syunik": "Sünik", "Tavush": "Tavuş",
    "Vayots Dzor": "Vayots Dzor", "Yerevan": "İrəvan",
}


_ASCII = str.maketrans({"ı": "i", "İ": "i", "ə": "e", "Ə": "e", "ş": "s", "Ş": "s", "ç": "c", "Ç": "c",
                        "ğ": "g", "Ğ": "g", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u", "â": "a", "î": "i", "û": "u"})


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.replace("–", "-").translate(_ASCII))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def _split_name(raw: str) -> tuple[str, str]:
    """'Shaki District' -> ('Shaki', 'district'); 'Ganja City' -> ('Ganja', 'city')."""
    for suffix, kind in ((" District", "district"), (" City", "city")):
        if raw.endswith(suffix):
            return raw[: -len(suffix)], kind
    return raw, "province"


def _localized(base: str, kind: str) -> tuple[str, str]:
    az = AZ_NAMES.get(base, base)
    if kind == "district":
        return f"{base} District", f"{az} rayonu"
    if kind == "city":
        return f"{base} City", f"{az} şəhəri"
    return base, az


def _osm_names(r) -> tuple[str, str, str]:
    """(slug base, English, Azerbaijani) for an OSM-only unit: 'Kerman Province' -> 'Kerman'."""
    en = re.sub(r"\s+(Province|Region|Governorate|Oblast)$", "", str(r["shapeName"])).strip()
    az = r.get("name_az")
    return en, en, az if isinstance(az, str) and az else en


def polygonal(geom):
    """Only the areal part of a geometry: repairs and overlays can leave stray
    lines or points beside the polygons, which the map and the overlays reject."""
    if geom is None or geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [p for p in getattr(geom, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else Polygon()


# country -> neighbours whose sources' claim prevails where both cover the same
# ground: East Jerusalem and the West Bank edges (Palestine), north Kosovo (Kosovo).
YIELDS = {"ISR": ("PSE",), "JOR": ("PSE",), "SRB": ("XKX",)}


@lru_cache(maxsize=8)
def _country_shape(iso: str, boundary_dir: Path = BOUNDARY_DIR):
    meta = COUNTRIES[iso]
    osm = boundary_dir / f"{meta['file']}_OSM.geojson"
    gdf = gpd.read_file(osm if osm.exists() else boundary_dir / f"{meta['file']}.geojson").to_crs(4326)
    return unary_union([polygonal(g) for g in gdf.geometry.make_valid()])


def load_regions(batch: str = PRIMARY_BATCH, boundary_dir: Path = BOUNDARY_DIR) -> gpd.GeoDataFrame:
    """All regions (sub-national + country) of one batch, with stable integer ids
    (``batch.id_offset`` + rank within the batch)."""
    b = BATCHES[batch]
    rows = []
    taken = None
    for iso in b.countries:
        meta = COUNTRIES[iso]
        # OSM geometry (see odlar.grid.osm_boundaries) where it has been fetched
        osm = boundary_dir / f"{meta['file']}_OSM.geojson"
        gdf = gpd.read_file(osm if osm.exists() else boundary_dir / f"{meta['file']}.geojson").to_crs(4326)
        gdf["geometry"] = [polygonal(g) for g in gdf.geometry.make_valid()]
        # geoBoundaries ships a few split polygons with the same name (e.g. Lankaran
        # District twice); dissolve them so every name maps to one region.
        gdf = gdf.dissolve(by="shapeName", as_index=False)
        # Ground claimed by two countries' sources (e.g. the Artsvashen exclave)
        # stays with the country listed first, so every point has one region.
        if taken is not None:
            gdf["geometry"] = [polygonal(g) for g in gdf.geometry.difference(taken)]
            gdf = gdf[~gdf.geometry.is_empty]
        # Ground both a country's and a neighbour's source claim is left to the
        # neighbour listed here (the user's decision), whatever batch either is in.
        yielded = [_country_shape(n, boundary_dir) for n in YIELDS.get(iso, ())]
        if yielded:
            gdf["geometry"] = [polygonal(g) for g in gdf.geometry.difference(unary_union(yielded))]
            gdf = gdf[~gdf.geometry.is_empty]
        country_union = gdf.geometry.union_all()
        taken = country_union if taken is None else taken.union(country_union)
        # A big country is split into states or chunks of them ("split" entries from
        # odlar.world_split): the state is the parent region, its slug prefixes the
        # local units' slugs (county names repeat across states).
        prefix = meta.get("slug", meta["code"])
        # 'Tashkent' (the city) and 'Tashkent Region': the short form only where it is unique
        short = gdf["shapeName"].map(lambda n: _osm_names({"shapeName": n})[0])
        clash = set(short[short.duplicated(keep=False)])
        for _, r in gdf.iterrows():
            if meta.get("source") == "split":
                base = name_en = name_az = str(r["shapeName"]).strip()
                kind = "district"
            elif meta.get("source") == "osm":
                base, name_en, name_az = _osm_names(r)
                if base in clash:
                    base = name_en = str(r["shapeName"]).strip()
                kind = "province"
            else:
                base, kind = _split_name(r["shapeName"])
                name_en, name_az = _localized(base, kind)
            rows.append({
                "parent_key": prefix,
                "slug": f"{prefix}-{slugify(base)}" + ("-city" if kind == "city" else ""),
                "name_en": name_en,
                "name_az": name_az,
                "country": meta["code"],
                "level": "district" if iso == "AZE" or kind == "district" else "province",
                "kind": kind,
                "geometry": r.geometry,
            })
        country_geom = country_union
        rows.append({
            "parent_key": prefix,
            "slug": prefix, "name_en": meta["name_en"], "name_az": meta["name_az"],
            "country": meta["code"], "level": "country", "kind": meta.get("kind", "country"),
            "geometry": country_geom,
        })

    regions = gpd.GeoDataFrame(rows, crs=4326)
    regions = regions.sort_values(["country", "level", "slug"]).reset_index(drop=True)
    dup = regions["slug"].duplicated()
    if dup.any():  # any other repeat: numbered, so every slug is a unique address
        regions.loc[dup, "slug"] += "-" + (regions[dup].groupby("slug").cumcount() + 2).astype(str)
    regions.insert(0, "region_id", range(b.id_offset + 1, b.id_offset + len(regions) + 1))
    # by the country entry, not the code: the states of a split country share one code
    parent = {r.parent_key: r.region_id for r in regions.itertuples() if r.level == "country"}
    regions["parent_id"] = [None if r.level == "country" else parent[r.parent_key] for r in regions.itertuples()]
    regions = regions.drop(columns="parent_key")
    eq = regions.to_crs(6933)  # equal-area for km²
    regions["area_km2"] = (eq.geometry.area / 1e6).round(1)
    # a unit left with (almost) nothing after YIELDS goes; ids are assigned first,
    # so every other region keeps its id
    regions = regions[(regions["level"] == "country") | (regions["area_km2"] >= 1)].reset_index(drop=True)
    cent = regions.geometry.representative_point()
    regions["lat"] = cent.y.round(4)
    regions["lon"] = cent.x.round(4)
    return regions


@lru_cache(maxsize=8)
def cached_regions(batch: str = PRIMARY_BATCH) -> gpd.GeoDataFrame:
    return load_regions(batch)


def leaf_regions(regions: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return regions[regions.level != "country"].copy()


def toy_regions() -> gpd.GeoDataFrame:
    """Two-district + one-country catalogue for unit tests (no files needed)."""
    a = box(46.0, 39.5, 47.0, 40.5)
    b = box(47.0, 39.5, 48.0, 40.5)
    rows = [
        {"slug": "az-alpha", "name_en": "Alpha District", "name_az": "Alfa rayonu", "country": "az",
         "level": "district", "kind": "district", "geometry": a},
        {"slug": "az-beta", "name_en": "Beta District", "name_az": "Beta rayonu", "country": "az",
         "level": "district", "kind": "district", "geometry": b},
        {"slug": "az", "name_en": "Azerbaijan", "name_az": "Azərbaycan", "country": "az",
         "level": "country", "kind": "country", "geometry": Polygon(a.union(b).exterior)},
    ]
    regions = gpd.GeoDataFrame(rows, crs=4326)
    regions.insert(0, "region_id", [1, 2, 3])
    regions["parent_id"] = [3, 3, None]
    regions["area_km2"] = (regions.to_crs(6933).geometry.area / 1e6).round(1)
    cent = regions.geometry.representative_point()
    regions["lat"], regions["lon"] = cent.y, cent.x
    return regions


def assign_regions(points: pd.DataFrame, regions: gpd.GeoDataFrame) -> pd.Series:
    """Map each lat/lon row to its leaf region_id (NaN outside the catalogue)."""
    leaves = leaf_regions(regions)[["region_id", "geometry"]]
    pts = gpd.GeoDataFrame(points[[]], geometry=gpd.points_from_xy(points.lon, points.lat), crs=4326)
    joined = gpd.sjoin(pts, leaves, how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]
    return joined["region_id"].reindex(points.index)
