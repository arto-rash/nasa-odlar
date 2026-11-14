"""The world catalogue: every country, packed into batches.

    python -m odlar.world            # writes data/world.json

Inputs (all in ``data/boundaries``):

* ``gb_adm1_all.json``: geoBoundaries' ADM1 index (ISO3, name, UN subregion,
  number of provinces);
* ``osm_countries.json``: ISO codes and English/Azerbaijani names from OSM;
* ``firms_countries_modis2024.tsv``: FIRMS' per-country file names with their
  2024 MODIS file size, used as a proxy for how many detections a country has.

Countries are grouped by UN subregion and packed greedily into batches that stay
under a detection budget, so one batch's pipeline fits in memory; a country over
the budget on its own gets its own batch. Countries already configured by hand
(the pilot and Turkey/Iran) are left out.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from odlar.config import BOUNDARY_DIR, DATA_DIR

WORLD_FILE = DATA_DIR / "world.json"
# MODIS bytes per year ~ detections; Turkey+Iran (~4 MB) peaks at ~3.3 GB of RAM
BATCH_BUDGET_BYTES = 8_000_000
MAX_BATCH_REGIONS = 250
FIRST_OFFSET = 20_000  # 0: caucasus, 10_000: turkey_iran
OFFSET_STEP = 10_000

# FIRMS file names that do not follow the geoBoundaries/OSM English name
FIRMS_NAMES = {
    "CIV": "Cote_d_Ivoire", "COG": "Republic_of_Congo", "CZE": "Czech_Republic", "PRK": "Dem_Rep_Korea",
    "LAO": "Lao_PDR", "MKD": "Macedonia_Former_Yugoslav_Republic_of", "PSE": "Palestine", "SWZ": "Swaziland",
}
HAND_CONFIGURED = {"AZE", "GEO", "ARM", "TUR", "IRN"}
# geoBoundaries leaves the UN subregion of a few countries undefined
SUBREGION_FIX = {"CAN": "Northern America", "USA": "Northern America", "GRL": "Northern America",
                 "BMU": "Northern America", "SPM": "Northern America"}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower().replace("&", "and"))


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def build(boundary_dir: Path = BOUNDARY_DIR) -> dict:
    gb = json.loads((boundary_dir / "gb_adm1_all.json").read_text())
    osm = json.loads((boundary_dir / "osm_countries.json").read_text())
    with (boundary_dir / "firms_countries_modis2024.tsv").open() as f:
        firms = {name: int(size) for size, name in csv.reader(f, delimiter="\t")}
    by_norm = {_norm(k.replace("_", " ")): k for k in firms}

    countries: dict[str, dict] = {}
    for c in sorted(gb, key=lambda x: x["boundaryISO"]):
        iso3 = c["boundaryISO"]
        if iso3 in HAND_CONFIGURED:
            continue
        o = osm.get(iso3, {})
        en = o.get("en") or c["boundaryName"]
        firms_name = FIRMS_NAMES.get(iso3) or next(
            (by_norm[_norm(x)] for x in (c["boundaryName"], en) if x and _norm(x) in by_norm), None)
        iso2 = (o.get("iso2") or "").upper()
        if not iso2:
            continue  # no OSM country relation to take boundaries from
        countries[iso3] = {
            "code": iso2.lower(), "iso2": iso2, "name_en": en, "name_az": o.get("az") or en,
            # world boundaries live in data/boundaries/world/, outside git and the server image
            "file": f"world/{iso3}_ADM1", "osm_level": 4, "source": "osm", "firms_name": firms_name,
            "subregion": SUBREGION_FIX.get(iso3) or c.get("UNSDG-subregion") or "Other",
            "n_adm1": int(c["admUnitCount"]), "weight": firms.get(firms_name, 0) if firms_name else 0,
        }

    batches, offset = [], FIRST_OFFSET
    by_sub: dict[str, list[str]] = {}
    for iso3, c in countries.items():
        by_sub.setdefault(c["subregion"], []).append(iso3)
    for sub, isos in sorted(by_sub.items()):
        isos.sort(key=lambda i: -countries[i]["weight"])
        groups: list[list[str]] = []
        for iso3 in isos:
            c = countries[iso3]
            for g in groups:
                if (sum(countries[i]["weight"] for i in g) + c["weight"] <= BATCH_BUDGET_BYTES
                        and sum(countries[i]["n_adm1"] for i in g) + c["n_adm1"] <= MAX_BATCH_REGIONS):
                    g.append(iso3)
                    break
            else:
                groups.append([iso3])
        multi = [g for g in groups if len(g) > 1]
        for g in groups:
            # a country alone in its batch names it; shared batches take the subregion
            if len(g) == 1:
                name = slug(countries[g[0]]["name_en"])
            else:
                name = slug(sub) + (f"_{multi.index(g) + 1}" if len(multi) > 1 else "")
            weight = sum(countries[i]["weight"] for i in g)
            batches.append({"name": name, "countries": sorted(g), "id_offset": offset,
                            "stream": weight > BATCH_BUDGET_BYTES, "weight": weight})
            offset += OFFSET_STEP
    return {"countries": countries, "batches": batches}


def main() -> None:
    world = build()
    WORLD_FILE.write_text(json.dumps(world, ensure_ascii=False, indent=1))
    b = world["batches"]
    print(f"{len(world['countries'])} countries in {len(b)} batches "
          f"({sum(x['stream'] for x in b)} need year-by-year ingestion) -> {WORLD_FILE}")
    for x in sorted(b, key=lambda x: -x["weight"])[:8]:
        print(f"  {x['name']:28s} {len(x['countries']):3d} countries  {x['weight'] / 1e6:6.1f} MB")


if __name__ == "__main__":
    main()
