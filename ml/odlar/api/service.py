"""Query logic behind the analytics API, kept separate from FastAPI for testing."""

from __future__ import annotations

import io
import json
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from scipy.stats import kendalltau, theilslopes
from shapely.geometry import mapping, shape

from odlar.calendar.engine import build_calendar, month_to_date
from odlar.config import OVERLAP_START, risk_level
from odlar.model.predict import outlook_mondays, spread_outlook, week_bin
from odlar.store import Store

PRE = pd.Timestamp(OVERLAP_START)


class NotFound(Exception):
    pass


def _f(v, nd: int = 3):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (np.integer, int)):
        return int(v)
    return round(float(v), nd)


def region_or_404(s: Store, slug: str):
    r = s.by_slug.get(slug)
    if r is None:
        raise NotFound(f"region '{slug}' not found")
    return r


_COUNTRY_NAMES: dict[str, tuple[str, str]] | None = None


def country_names() -> dict[str, tuple[str, str]]:
    """Country code -> (English, Azerbaijani) name. The real country entries, not
    the state-level parents a big country is split into."""
    global _COUNTRY_NAMES
    if _COUNTRY_NAMES is None:
        from odlar.grid.regions import COUNTRIES
        _COUNTRY_NAMES = {c["code"]: (c["name_en"], c["name_az"]) for c in COUNTRIES.values()
                          if c.get("source") != "split"}
    return _COUNTRY_NAMES


def _where(s: Store | None, r) -> dict:
    """Where a region is, for the small line under its name: its country, and for
    the local units of a split country also its state ("Michigan · United States")."""
    cn = country_names().get(r.country, (r.country.upper(), r.country.upper()))
    out = {"country_name_en": cn[0], "country_name_az": cn[1]}
    if s is not None and r.level != "country" and not pd.isna(r.parent_id):
        parent = s.by_id.get(int(r.parent_id))
        if parent is not None and parent.kind == "state":
            out.update(state_name_en=parent.name_en, state_name_az=parent.name_az)
    return out


def _region_dict(r, s: Store | None = None) -> dict:
    return {"id": int(r.region_id), "slug": r.slug, "name_en": r.name_en, "name_az": r.name_az,
            "country": r.country, **_where(s, r),
            "level": r.level, "kind": r.kind,
            "parent_id": None if pd.isna(r.parent_id) else int(r.parent_id),
            "area_km2": _f(r.area_km2, 1), "lat": _f(r.lat, 4), "lon": _f(r.lon, 4)}


def _risk_for(s: Store, region_id: int) -> dict | None:
    """Leaf: model output. Country: area-weighted aggregate of its districts."""
    rn = s.risk_now
    row = rn[rn["region_id"] == region_id]
    if len(row):
        r = row.iloc[0]
        return {"probability": _f(r.probability, 4), "level": r.level, "expected7": _f(r.expected7, 2)}
    kids = s.regions[s.regions["parent_id"] == region_id]
    sub = rn[rn["region_id"].isin(kids["region_id"])]
    if sub.empty:
        return None
    w = sub["region_id"].map(kids.set_index("region_id")["area_km2"])
    p = float(np.average(sub["probability"], weights=w))
    return {"probability": round(p, 4), "level": risk_level(p), "expected7": _f(sub["expected7"].sum(), 2),
            "max_level": sub.sort_values("probability").iloc[-1]["level"]}


def region_summary(s: Store) -> pd.DataFrame:
    """Per region: annual series, mean, density, decade trend and current risk,
    computed once per loaded store (vectorized: ~25,000 regions take a second)."""
    cached = getattr(s, "_summary", None)
    if cached is not None:
        return cached
    end_year = int(pd.Timestamp(s.meta["data_end"]).year)
    ann = s.annual[(s.annual["year"] >= 2001) & (s.annual["year"] < end_year)]
    wide = ann.pivot_table(index="region_id", columns="year", values="harmonized", aggfunc="first").sort_index(axis=1)
    v = wide.to_numpy(dtype=float)
    years = wide.columns.to_numpy(dtype=float)
    i, j = np.triu_indices(len(years), k=1)
    slopes = (v[:, j] - v[:, i]) / (years[j] - years[i])
    slope = np.nanmedian(slopes, axis=1) if slopes.size else np.zeros(len(v))  # Theil-Sen
    mean = np.nanmean(v, axis=1) if v.size else np.zeros(len(v))
    flat = (np.nanmax(v, axis=1) - np.nanmin(v, axis=1) == 0) | (np.sum(np.isfinite(v), axis=1) < 6)
    out = pd.DataFrame({"region_id": wide.index.astype(int),
                        "annual": [[float(x) for x in np.round(r[np.isfinite(r)], 1)] for r in v],
                        "annual_mean": np.round(mean, 1),
                        "trend_pct": np.where(flat | (mean == 0), 0.0, np.round(slope * 10 / np.where(mean == 0, 1, mean) * 100, 1))})
    out = s.regions[["region_id", "area_km2", "parent_id"]].merge(out, on="region_id", how="left")
    out["density"] = np.round(out["annual_mean"] / out["area_km2"].clip(lower=1) * 100, 3)
    # current risk: leaves from the model, parents area-weighted over their leaves
    rn = s.risk_now[["region_id", "probability", "level", "expected7"]]
    out = out.merge(rn, on="region_id", how="left")
    kids = out[out["probability"].notna() & out["parent_id"].notna()]
    if len(kids):
        w = kids["area_km2"].clip(lower=1)
        agg = pd.DataFrame({"parent": kids["parent_id"].astype(int), "pw": kids["probability"] * w, "w": w,
                            "e": kids["expected7"], "p": kids["probability"], "lvl": kids["level"]})
        g = agg.groupby("parent")
        par = pd.DataFrame({"probability": g["pw"].sum() / g["w"].sum(), "expected7": g["e"].sum(),
                            "max_level": agg.loc[g["p"].idxmax(), ["parent", "lvl"]].set_index("parent")["lvl"]})
        par["level"] = [risk_level(x) for x in par["probability"]]
        m = out["probability"].isna() & out["region_id"].isin(par.index)
        idx = out.loc[m, "region_id"]
        for col in ("probability", "level", "expected7", "max_level"):
            out.loc[m, col] = par[col].reindex(idx).to_numpy()
    s._summary = out.set_index("region_id")
    return s._summary


def _risk_dict(row) -> dict | None:
    if pd.isna(row.probability):
        return None
    d = {"probability": _f(row.probability, 4), "level": row.level, "expected7": _f(row.expected7, 2)}
    if isinstance(getattr(row, "max_level", None), str):
        d["max_level"] = row.max_level
    return d


def _search_rank(regions: pd.DataFrame, q: str) -> pd.Series:
    """0 = name starts with the query, 1 = a word starts with it, 2 = contains it, NaN = no match."""
    from odlar.grid.regions import slugify
    needle = slugify(q).replace("-", " ").strip()
    if not needle:
        return pd.Series(np.nan, index=regions.index)
    rank = pd.Series(np.nan, index=regions.index)
    for col in ("name_en", "name_az", "slug"):
        text = regions[col].fillna("").map(lambda t: slugify(str(t)).replace("-", " "))
        r = np.where(text.str.startswith(needle), 0, np.where(text.str.contains(" " + needle, regex=False), 1,
                     np.where(text.str.contains(needle, regex=False), 2, np.nan)))
        rank = pd.concat([rank, pd.Series(r, index=regions.index)], axis=1).min(axis=1, skipna=True)
    return rank


def list_regions(s: Store, country: str | None = None, parent: str | None = None, q: str | None = None,
                 level: str | None = None, limit: int | None = None, lite: bool = False) -> list[dict]:
    """Regions with their risk, annual series and trend, filtered by country, parent
    (a slug), level and a search query; ``lite`` leaves the annual series out."""
    summ = region_summary(s)
    regs = s.regions
    if country:
        regs = regs[regs["country"] == country.lower()]
    if parent:
        regs = regs[regs["parent_id"] == region_or_404(s, parent).region_id]
    if level:
        regs = regs[regs["level"] == level]
    if q:
        rank = _search_rank(regs, q)
        regs = regs.assign(_rank=rank)[rank.notna()].sort_values(["_rank", "level", "name_en"])
    if limit:
        regs = regs.head(limit)
    out = []
    for r in regs.itertuples():
        d = _region_dict(r, s)
        row = summ.loc[int(r.region_id)]
        d["risk"] = _risk_dict(row)
        if not lite:
            d["annual"] = row.annual if isinstance(row.annual, list) else []
        d["annual_mean"] = _f(row.annual_mean, 1)
        d["density"] = _f(row.density, 3)
        d["trend_pct"] = _f(row.trend_pct, 1)
        out.append(d)
    return out


WORLD_TOLERANCE = 0.1
WORLD_MIN_ISLAND = 0.02  # square degrees (~200 km2): well under a pixel at world zoom


def _without_specks(geom):
    """Drop islets too small to see; a place made only of islets keeps its largest."""
    parts = sorted(getattr(geom, "geoms", [geom]), key=lambda g: g.area, reverse=True)
    kept = [g for g in parts if g.area >= WORLD_MIN_ISLAND] or parts[:1]
    return shapely.multipolygons(kept) if len(kept) > 1 else kept[0]


def regions_geojson(s: Store) -> str:
    """Every region at full map detail (the shapes are read from disk)."""
    return region_shapes(s, None, 8.0, provinces_only=False)


def _world_outlines(s: Store) -> str:
    """Country outlines for the whole-world view, kept in memory per store. One
    screen pixel is at least 0.1 degree at these zooms, so borders are simplified
    together to that (keeping them shared) and rounded to 0.01 degree."""
    cached = getattr(s, "_outlines", None)
    if cached is not None:
        return cached
    full = json.loads(region_shapes(s, None, 3.0, provinces_only=False))["features"]
    features = [f for f in full if f["properties"]["level"] == "country"]
    shapes = np.array([_without_specks(shape(f["geometry"]).buffer(0)) for f in features], dtype=object)
    try:
        slim = shapely.coverage_simplify(shapes, WORLD_TOLERANCE)
    except shapely.errors.GEOSException:
        slim = shapely.simplify(shapes, WORLD_TOLERANCE)
    slim = shapely.set_precision(slim, 0.01, mode="pointwise")
    for f, geom in zip(features, slim, strict=True):
        f["geometry"] = mapping(geom)
    s._outlines = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    return s._outlines


def region_shapes(s: Store, bbox: tuple[float, float, float, float] | None = None, zoom: float = 8.0,
                  country: str | None = None, provinces_only: bool = True) -> str:
    """The regions in view as GeoJSON text: country outlines only when zoomed out
    (zoom < 4), provinces simplified to ~500 m up to zoom 7, full map detail after.
    Risk and density properties are current; geometry comes pre-serialized."""
    if zoom < 3 and bbox is None and country is None:
        return _world_outlines(s)
    detail = "z0" if zoom < 4 else "z1" if zoom < 7 else "z2"
    paths = s.shape_paths
    if provinces_only and not country and zoom < 7 and s.tier_paths:  # regional views: see odlar.shape_tiers
        detail, paths = ("t4" if zoom < 5 else "t6"), s.tier_paths
    where, params = ["detail = ?"], [detail]
    if zoom >= 4 and not country and provinces_only and paths is s.shape_paths:
        # a zoomed-in map draws provinces only: leave out the (heavy) country outlines
        where.append("NOT is_country")
    if bbox:
        where.append("maxx >= ? AND minx <= ? AND maxy >= ? AND miny <= ?")
        params += [bbox[0], bbox[2], bbox[1], bbox[3]]
    if country:
        ids = s.regions.loc[s.regions["country"] == country.lower(), "region_id"].astype(int).tolist()
        where.append("list_contains(?, region_id)")
        params.append(ids)
    if not s.shape_paths:
        raise NotFound("no region shapes built")
    order = "region_id" if paths is s.tier_paths else "is_country DESC, region_id"  # countries first (provinces reference them)
    rows = s.points._con().execute(
        f"SELECT region_id, geometry FROM read_parquet(?) WHERE {' AND '.join(where)} ORDER BY {order}",
        [paths, *params]).fetchall()
    recent_year = int(pd.Timestamp(s.meta["data_end"]).year)
    ann = s.annual[(s.annual["year"] >= 2003) & (s.annual["year"] < recent_year)]
    ids = [int(r[0]) for r in rows]
    clim = ann[ann["region_id"].isin(ids)].groupby("region_id")["harmonized"].mean()
    parts = []
    for rid, geom in rows:
        reg = s.by_id[int(rid)]
        rk = _risk_for(s, int(rid)) or {}
        props = {"id": int(rid), "slug": reg.slug, "name_en": reg.name_en, "name_az": reg.name_az,
                 "country": reg.country, **_where(s, reg), "level": reg.level, "probability": rk.get("probability"),
                 "risk_level": rk.get("level"),
                 "density": _f(clim.get(int(rid), 0.0) / max(float(reg.area_km2 or 1), 1) * 100, 3)}
        parts.append('{"type":"Feature","geometry":' + geom + ',"properties":' + json.dumps(props) + "}")
    return '{"type":"FeatureCollection","features":[' + ",".join(parts) + "]}"


def trend(years: np.ndarray, values: np.ndarray) -> dict:
    """Theil–Sen slope with a Mann–Kendall (Kendall tau) significance test."""
    m = np.isfinite(values)
    years, values = years[m], values[m]
    if len(values) < 6 or np.allclose(values, values[0]):
        return {"slope": 0.0, "pct_per_decade": 0.0, "p_value": 1.0, "significant": False, "intercept": None}
    slope, intercept, _lo, _hi = theilslopes(values, years)
    tau = kendalltau(years, values)
    mean = float(np.mean(values)) or 1.0
    return {"slope": round(float(slope), 3), "intercept": round(float(intercept), 3),
            "pct_per_decade": round(float(slope * 10 / mean * 100), 1),
            "p_value": round(float(tau.pvalue), 4), "significant": bool(tau.pvalue < 0.05),
            "slope_lo": round(float(_lo), 3), "slope_hi": round(float(_hi), 3)}


def pettitt(years: np.ndarray, values: np.ndarray) -> dict:
    """Pettitt's test for one abrupt change in level (rank-based, so a few big
    fire years cannot fake it). ``year``: the first year of the new level;
    ``p``: approximate two-sided p-value; ``shift``: mean after / mean before."""
    m = np.isfinite(values)
    years, x = np.asarray(years)[m], np.asarray(values, dtype=float)[m]
    n = len(x)
    if n < 8 or np.allclose(x, x[0]):
        return {"year": None, "p": 1.0, "shift": None, "significant": False}
    sgn = np.sign(x[:, None] - x[None, :])  # sgn(x_i - x_j)
    u = np.array([sgn[: t + 1, t + 1:].sum() for t in range(n - 1)])
    t = int(np.argmax(np.abs(u)))
    k = float(np.abs(u[t]))
    p = float(min(1.0, 2 * np.exp(-6 * k**2 / (n**3 + n**2))))
    before, after = x[: t + 1].mean(), x[t + 1:].mean()
    return {"year": int(years[t + 1]), "p": round(p, 4),
            "shift": round(float(after / before), 2) if before > 0 else None, "significant": p < 0.05}


def breaks_summary(s: Store) -> dict:
    """Worldwide: in how many countries the raw and the corrected record show an
    abrupt change in level, and how many of the raw ones fall when a new VIIRS
    satellite started (2012 S-NPP, 2018 NOAA-20). Cached per store."""
    cached = getattr(s, "_breaks", None)
    if cached is not None:
        return cached
    end_year = int(pd.Timestamp(s.meta["data_end"]).year)
    ctry = s.regions.loc[s.regions["level"] == "country", ["region_id", "country"]]
    a = s.annual.merge(ctry, on="region_id")
    a = a[(a["year"] >= 2001) & (a["year"] < end_year)]
    per = a.groupby(["country", "year"])[["harmonized", "naive"]].sum().reset_index()
    raw_sig = harm_sig = at_sensor = harm_at_sensor = n = 0
    sensor_years = (2012, 2013, 2018, 2019)
    for _, g in per.groupby("country"):
        if g["naive"].sum() < 500:
            continue
        n += 1
        yr = g["year"].to_numpy()
        br, bh = pettitt(yr, g["naive"].to_numpy(dtype=float)), pettitt(yr, g["harmonized"].to_numpy(dtype=float))
        raw_sig += br["significant"]
        harm_sig += bh["significant"]
        at_sensor += bool(br["significant"] and br["year"] in sensor_years)
        harm_at_sensor += bool(bh["significant"] and bh["year"] in sensor_years)
    s._breaks = {"countries": n, "raw_breaks": raw_sig, "raw_at_new_satellite": at_sensor,
                 "corrected_breaks": harm_sig, "corrected_at_new_satellite": harm_at_sensor}
    return s._breaks


def region_detail(s: Store, slug: str) -> dict:
    r = region_or_404(s, slug)
    rid = int(r.region_id)
    d = _region_dict(r, s)
    ann = s.annual[s.annual["region_id"] == rid]
    end_year = int(pd.Timestamp(s.meta["data_end"]).year)
    full = ann[(ann["year"] >= 2001) & (ann["year"] < end_year)]
    cal = s.calendar(rid) or {}
    d["risk"] = _risk_for(s, rid)
    d["children"] = [_region_dict(c, s) for c in s.regions[s.regions["parent_id"] == rid].itertuples()]
    if not pd.isna(r.parent_id):
        d["parent"] = _region_dict(s.by_id[int(r.parent_id)], s)
    d["stats"] = {
        "annual_mean": _f(full["harmonized"].mean(), 1),
        "annual_mean_raw_modis": _f(full.loc[full["year"] < 2012, "modis"].mean(), 1),
        "annual_mean_raw_viirs": _f(full.loc[full["year"] >= 2013, "viirs"].mean(), 1),
        "record_year": int(full.loc[full["harmonized"].idxmax(), "year"]) if len(full) else None,
        "record_value": _f(full["harmonized"].max(), 1),
        "density": _f(full["harmonized"].mean() / max(float(r.area_km2), 1) * 100, 3),
        "detections_total": int(ann[["modis", "viirs"]].sum().sum()),
        "trend": trend(full["year"].to_numpy(dtype=float), full["harmonized"].to_numpy(dtype=float)),
        "trend_naive": trend(full["year"].to_numpy(dtype=float), full["naive"].to_numpy(dtype=float)),
        # one abrupt change in level? (raw: usually the year a new VIIRS satellite started)
        "break": {"raw": pettitt(full["year"].to_numpy(), full["naive"].to_numpy(dtype=float)),
                  "harmonized": pettitt(full["year"].to_numpy(), full["harmonized"].to_numpy(dtype=float))},
    }
    d["season"] = cal.get("season")
    d["current"] = cal.get("current")
    d["anomalies"] = cal.get("anomalies", [])
    return d


def weekly_series(s: Store, slug: str, start: date | None = None, end: date | None = None) -> list[dict]:
    rid = int(region_or_404(s, slug).region_id)
    w = s.rows("weekly", [rid])
    if start:
        w = w[w["week"] >= pd.Timestamp(start)]
    if end:
        w = w[w["week"] <= pd.Timestamp(end)]
    cols = ["week", "modis", "viirs", "viirs_n", "naive", "harmonized", "lo", "hi", "method", "frp_modis", "frp_viirs"]
    out = w[cols].copy()
    out["week"] = out["week"].dt.strftime("%Y-%m-%d")
    for c in ("harmonized", "lo", "hi", "frp_modis", "frp_viirs"):
        out[c] = out[c].astype(float).round(2)
    return out.to_dict(orient="records")


def annual_series(s: Store, slug: str) -> dict:
    rid = int(region_or_404(s, slug).region_id)
    a = s.annual[s.annual["region_id"] == rid].sort_values("year")
    end_year = int(pd.Timestamp(s.meta["data_end"]).year)
    rows = []
    for r in a.itertuples():
        rows.append({"year": int(r.year), "harmonized": _f(r.harmonized, 1), "lo": _f(r.lo, 1), "hi": _f(r.hi, 1),
                     "modis": int(r.modis), "viirs": int(r.viirs), "viirs_n": int(r.viirs_n), "naive": int(r.naive),
                     "partial": bool(r.year >= end_year or r.year < 2001)})
    full = a[(a["year"] >= 2001) & (a["year"] < end_year)]
    yrs = full["year"].to_numpy(dtype=float)
    return {"years": rows,
            "trend": {"harmonized": trend(yrs, full["harmonized"].to_numpy(dtype=float)),
                      "naive": trend(yrs, full["naive"].to_numpy(dtype=float)),
                      "modis": trend(yrs, full["modis"].to_numpy(dtype=float))}}


def calendar(s: Store, slug: str) -> dict:
    r = region_or_404(s, slug)
    cal = s.calendar(int(r.region_id))
    if cal is None:
        raise NotFound("no calendar")
    return {"region": _region_dict(r, s), **cal, "coverage": coverage(s),
            "month": month_to_date(cal, s.meta["data_end"]),
            "spread": cell_spread(s.rows("weekly", [int(r.region_id)]), cal["years"])}


def cell_spread(w: pd.DataFrame, years: list[int]) -> list[list[float]]:
    """How uncertain each calendar cell is: half the width of its 80-90 % range
    over its value (0 = exact, as on the S-NPP years; 1 = the range is as wide
    as the value). Cells under one detection count as one, so empty weeks with
    a small range are not called uncertain. Same bins as the matrix."""
    if w.empty:
        return []
    wk = pd.to_datetime(w["week"])
    g = pd.DataFrame({"year": wk.dt.year, "woy": np.minimum((wk.dt.day_of_year - 1) // 7, 51),
                      "v": w["harmonized"].astype(float), "lo": w["lo"].astype(float), "hi": w["hi"].astype(float)})
    b = g.groupby(["year", "woy"])[["v", "lo", "hi"]].sum()
    rel = ((b["hi"] - b["lo"]) / 2 / np.maximum(b["v"], 1.0)).clip(0, 9.99)
    m = rel.unstack("woy").reindex(index=years, columns=range(52)).fillna(0.0)
    return np.round(m.to_numpy(), 2).tolist()


GAP_WINDOW = 9        # weeks in the running median a week is compared with
GAP_MIN_MEDIAN = 200  # ignore quiet stretches, where a low week is just chance
GAP_REDUCED = 0.5     # under half the usual detections: a satellite was (partly) offline
GAP_NONE = 0.1        # almost nothing: no usable observation that week


def find_gaps(weeks: pd.DataFrame, viirs_start: pd.Timestamp) -> list[dict]:
    """Weeks when the satellites the record leans on were offline. Before VIIRS
    the record is MODIS alone; after it VIIRS sets the scale, so a MODIS outage
    then costs nothing. A week is compared with the running median of the weeks
    around it, worldwide, so the season cannot pass for an outage."""
    w = weeks.sort_values("week").reset_index(drop=True)
    base = np.where(pd.to_datetime(w["week"]) < viirs_start, w["modis"], w["viirs"]).astype(float)
    med = pd.Series(base).rolling(GAP_WINDOW, center=True, min_periods=5).median().to_numpy()
    ratio = np.divide(base, med, out=np.ones_like(base), where=med > 0)
    out = []
    for i in range(len(w) - 1):  # the newest week is still filling up: that is "partial", not a gap
        if med[i] >= GAP_MIN_MEDIAN and ratio[i] < GAP_REDUCED:
            out.append({"week": pd.Timestamp(w.loc[i, "week"]).strftime("%Y-%m-%d"),
                        "level": "none" if ratio[i] < GAP_NONE else "reduced"})
    return out


def coverage(s: Store) -> dict:
    """When the record has observations: first week, data end, and the weeks a
    satellite outage left empty or thin. Global, so worked out once per store."""
    cached = getattr(s, "_coverage", None)
    if cached is not None:
        return cached
    t = pd.DataFrame(timeline(s))
    viirs = t.loc[t["viirs"] > 0, "week"]
    viirs_start = pd.Timestamp(viirs.min()) if len(viirs) else pd.Timestamp.max
    s._coverage = {"start": t["week"].min(), "end": s.meta["data_end"],
                   "viirs_start": viirs_start.strftime("%Y-%m-%d") if len(viirs) else None,
                   "gaps": find_gaps(t, viirs_start)}
    return s._coverage


def risk_detail(s: Store, slug: str) -> dict:
    r = region_or_404(s, slug)
    rid = int(r.region_id)
    leaf_ids = [rid] if r.level != "country" else s.regions.loc[s.regions["parent_id"] == rid, "region_id"].tolist()
    rn = s.risk_now[s.risk_now["region_id"].isin(leaf_ids)]
    fw = s.fire_weather[s.fire_weather["region_id"].isin(leaf_ids)]
    ol = s.outlook_now[s.outlook_now["region_id"].isin(leaf_ids)]
    hist = s.rows("risk_history", leaf_ids)
    out: dict = {"region": _region_dict(r, s), "as_of": s.meta["data_end"], "forecast_source": s.meta.get("forecast_source")}
    if rn.empty:
        raise NotFound("no risk for region")
    if len(leaf_ids) == 1:
        row = rn.iloc[0]
        out["short"] = {"probability": _f(row.probability, 4), "level": row.level, "expected7": _f(row.expected7, 2),
                        "threshold7": _f(row.threshold7, 1), "normal7": _f(row.clim_next7, 2),
                        "recent7": _f(row.lag7, 1), "drivers": row.drivers}
    else:
        agg = _risk_for(s, rid)
        top = rn.sort_values("probability", ascending=False).head(5)
        out["short"] = {**agg, "threshold7": None, "normal7": _f(rn["clim_next7"].sum(), 2),
                        "recent7": _f(rn["lag7"].sum(), 1), "drivers": top.iloc[0].drivers,
                        "hotspots": [{"slug": s.by_id[int(t.region_id)].slug, "probability": _f(t.probability, 4),
                                      "level": t.level} for t in top.itertuples()]}
    fw = _with_wind_vectors(fw)
    days = fw.groupby("date").agg(danger=("danger", "mean"), tmax=("tmax", "mean"), rh=("rh", "mean"),
                                  wind=("wind", "mean"), precip=("precip", "mean"), gust=("gust", "max"),
                                  u=("u", "mean"), v=("v", "mean")).reset_index()
    out["daily"] = [{"date": d.date.strftime("%Y-%m-%d"), "danger": _f(d.danger, 1), "tmax": _f(d.tmax, 1),
                     "rh": _f(d.rh, 0), "wind": _f(d.wind, 1), "precip": _f(d.precip, 1),
                     "gust": _f(d.gust, 1), "wind_from": _wind_from(d.u, d.v)} for d in days.itertuples()]
    out["outlook"] = {"weeks": 13, "q10": _f(ol["q10"].sum(), 1), "q50": _f(ol["q50"].sum(), 1),
                      "q90": _f(ol["q90"].sum(), 1), "normal": _f(ol["clim_next13w"].sum(), 1),
                      "normal_p10": _f(ol["clim_p10_13w"].sum(), 1), "normal_p90": _f(ol["clim_p90_13w"].sum(), 1)}
    q50, norm = out["outlook"]["q50"] or 0, out["outlook"]["normal"] or 0
    out["outlook"]["signal"] = ("above" if q50 > 1.2 * norm + 1 else "below" if q50 < 0.8 * norm - 1 else "normal")
    h = hist.groupby("date").agg(probability=("probability", "mean"), actual=("target_sum7", "sum"),
                                 threshold=("threshold7", "sum"), value=("value", "sum")).reset_index()
    out["history"] = [{"date": x.date.strftime("%Y-%m-%d"), "probability": _f(x.probability, 4),
                       "actual7": _f(x.actual, 1), "threshold7": _f(x.threshold, 1), "fires": _f(x.value, 1)}
                      for x in h.itertuples()]
    return out


def _next_monday_in_bin(as_of: pd.Timestamp, woy: int | None) -> str | None:
    """The first Monday after ``as_of`` that falls in calendar week ``woy``."""
    if woy is None:
        return None
    for m in outlook_mondays(as_of, 60):
        if week_bin(pd.DatetimeIndex([m]))[0] == woy:
            return m.strftime("%Y-%m-%d")
    return None


def reliability(s: Store) -> dict:
    """How the forecasts did when tested on years they never saw (model report)."""
    rep = (s.model_report or {}).get("harmonized", {})
    ov, ol = rep.get("overall", {}), rep.get("outlook", {})
    return {"week_auc": ov.get("roc_auc"), "week_auc_season": ov.get("base_roc_auc"),
            "outlook_coverage80": ol.get("coverage80"), "outlook_coverage80_season": ol.get("coverage80_clim"),
            "outlook_skill": ol.get("pinball_skill"), "test_years": len(ol.get("by_year", []))}


def forecast(s: Store, slug: str) -> dict:
    """Everything ahead for one region, on one timeline: the 8-day fire weather,
    the 7-day risk, the 13-week outlook spread over its weeks, and beyond that the
    usual year (the climatology, not a forecast) up to a year ahead."""
    r = region_or_404(s, slug)
    cal = s.calendar(int(r.region_id))
    if cal is None:
        raise NotFound("no calendar")
    rd = risk_detail(s, slug)
    as_of = pd.Timestamp(s.meta["data_end"])
    clim = cal["climatology"]
    mean, p10, p90 = (np.asarray(clim[k], dtype=float) for k in ("mean", "p10", "p90"))
    weeks = outlook_mondays(as_of, 52)
    o = rd["outlook"]
    ahead = spread_outlook({"q10": o["q10"] or 0.0, "q50": o["q50"] or 0.0, "q90": o["q90"] or 0.0},
                           mean, p10, p90, weeks[:13])
    rows = [{"week": x.week.strftime("%Y-%m-%d"), "woy": int(x.woy), "kind": "outlook",
             "q10": _f(x.q10, 2), "q50": _f(x.q50, 2), "q90": _f(x.q90, 2),
             "normal": _f(x.normal, 2), "normal_p10": _f(x.normal_p10, 2), "normal_p90": _f(x.normal_p90, 2)}
            for x in ahead.itertuples()]
    for m, w in zip(weeks[13:], week_bin(weeks[13:]), strict=True):
        rows.append({"week": m.strftime("%Y-%m-%d"), "woy": int(w), "kind": "typical", "q10": None, "q50": None,
                     "q90": None, "normal": _f(mean[w], 2), "normal_p10": _f(p10[w], 2), "normal_p90": _f(p90[w], 2)})
    season = cal.get("season") or {}
    return {"region": rd["region"], "as_of": rd["as_of"], "forecast_source": rd.get("forecast_source"),
            "days": rd["daily"], "week": rd["short"], "outlook": o, "weeks": rows,
            "season": {"start": _next_monday_in_bin(as_of, season.get("start")),
                       "peak": _next_monday_in_bin(as_of, season.get("peak_week")),
                       "end": _next_monday_in_bin(as_of, season.get("end"))},
            "reliability": reliability(s)}


def forecast_map(s: Store, week: date, bbox: tuple[float, float, float, float] | None = None) -> dict:
    """One week ahead for every province in view: [region id, expected, usual]."""
    paths = s.outlook_week_paths
    if not paths:
        return {"week": week.isoformat(), "values": []}
    df = s.points._con().execute(
        "SELECT region_id, q50, normal FROM read_parquet(?, union_by_name = true) WHERE week = ?",
        [paths, pd.Timestamp(week)]).df()
    reg = s.regions.set_index("region_id")
    df = df[df["region_id"].isin(reg.index)]
    df = df.assign(area=reg.loc[df["region_id"], "area_km2"].to_numpy(), top=reg.loc[df["region_id"], "parent_id"].to_numpy())
    # the outlines a zoomed-out map draws (countries, or the states of a split country)
    tops = set(s.regions.loc[s.regions["level"] == "country", "region_id"].astype(int))
    by_country = (df[df["top"].isin(tops)].groupby("top", as_index=False)[["q50", "normal", "area"]].sum()
                  .rename(columns={"top": "region_id"}))
    if bbox and len(df):
        at = reg.loc[df["region_id"], ["lon", "lat"]]
        keep = ((at["lon"] >= bbox[0] - 2) & (at["lon"] <= bbox[2] + 2)
                & (at["lat"] >= bbox[1] - 2) & (at["lat"] <= bbox[3] + 2)).to_numpy()
        df = df[keep]
    rows = pd.concat([df[["region_id", "q50", "normal", "area"]], by_country[["region_id", "q50", "normal", "area"]]])
    return {"week": week.isoformat(), "columns": ["id", "expected", "usual", "area_km2"],
            "values": [[int(a), round(float(b), 2), round(float(c), 2), round(float(d), 1)]
                       for a, b, c, d in rows.itertuples(index=False)]}


def _with_wind_vectors(fw: pd.DataFrame) -> pd.DataFrame:
    """Adds the wind as a vector (u east, v north, the way it blows), so directions of
    several regions can be averaged (350° and 10° make north, not south)."""
    fw = fw.copy()
    for col in ("gust", "wdir"):
        if col not in fw:
            fw[col] = np.nan  # a store from before the refresh fetched them
    to = np.radians((fw["wdir"].astype(float) + 180) % 360)
    fw["u"] = fw["wind"].astype(float) * np.sin(to)
    fw["v"] = fw["wind"].astype(float) * np.cos(to)
    return fw


def _wind_from(u: float, v: float) -> float | None:
    """The direction the wind comes from (meteorological degrees), from a mean vector."""
    if not (np.isfinite(u) and np.isfinite(v)) or (abs(u) < 1e-6 and abs(v) < 1e-6):
        return None
    return round(float((np.degrees(np.arctan2(u, v)) + 180) % 360), 0)


def _next_wind(s: Store) -> dict:
    """Per region, the first forecast day's wind (what a fire burning now will meet)."""
    cached = getattr(s, "_next_wind", None)
    if cached is not None:
        return cached
    fw = s.fire_weather
    if fw.empty or "wdir" not in fw:
        s._next_wind = {}
        return s._next_wind
    # each region's own first forecast day (batches refreshed on different days start apart)
    first = fw[fw["wdir"].notna()].sort_values("date").drop_duplicates("region_id")
    s._next_wind = {int(r.region_id): {"date": pd.Timestamp(r.date).strftime("%Y-%m-%d"), "speed": _f(r.wind, 1),
                                       "gust": _f(r.gust, 1), "from": _f(r.wdir, 0)}
                    for r in first.itertuples() if np.isfinite(r.wdir)}
    return s._next_wind


def _event_dict(s: Store, e) -> dict:
    reg = s.by_id.get(int(e.region_id))
    place = ({"slug": reg.slug, "name_en": reg.name_en, "name_az": reg.name_az, "country": reg.country, **_where(s, reg)}
             if reg is not None else None)
    return {"id": e.event_id, "lat": e.lat, "lon": e.lon, "bbox": [e.west, e.south, e.east, e.north],
            "first_seen": pd.Timestamp(e.first_seen).strftime("%Y-%m-%d"),
            "last_seen": pd.Timestamp(e.last_seen).strftime("%Y-%m-%d"), "days": int(e.days),
            "detections": int(e.detections), "modis": int(e.modis), "viirs": int(e.viirs),
            "frp_max": _f(e.frp_max, 1), "frp_sum": _f(e.frp_sum, 1), "active": bool(e.active), "region": place,
            "wind": _next_wind(s).get(int(e.region_id))}


def events(s: Store, bbox: tuple[float, float, float, float] | None = None, region: str | None = None,
           active: bool = False, limit: int = 200) -> dict:
    """Fires of the last two weeks (odlar.events), biggest first."""
    if not s.event_paths:
        return {"total": 0, "events": []}
    where, params = ["TRUE"], [s.event_paths]
    if bbox:
        where.append("lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?")
        params += [bbox[0], bbox[2], bbox[1], bbox[3]]
    if region:
        where.append("list_contains(?, region_id)")
        params.append(_leaf_ids(s, region_or_404(s, region)))
    if active:
        where.append("active")
    sql = f"FROM read_parquet(?, union_by_name = true) WHERE {' AND '.join(where)}"
    con = s.points._con()
    total = int(con.execute(f"SELECT count(*) {sql}", params).fetchone()[0])
    df = con.execute(f"SELECT * {sql} ORDER BY frp_sum DESC LIMIT {int(limit)}", params).df()
    return {"total": total, "events": [_event_dict(s, e) for e in df.itertuples()]}


def event_detail(s: Store, event_id: str) -> dict:
    """One fire: its summary, detections per day and sensor, and the detections."""
    if not s.event_paths:
        raise NotFound("no such fire")
    df = s.points._con().execute("SELECT * FROM read_parquet(?, union_by_name = true) WHERE event_id = ? LIMIT 1",
                                 [s.event_paths, event_id]).df()
    if df.empty:
        raise NotFound("no such fire")
    e = next(df.itertuples())
    pad = 0.01
    box = (e.west - pad, e.south - pad, e.east + pad, e.north + pad)
    start, end = pd.Timestamp(e.first_seen).date(), pd.Timestamp(e.last_seen).date()
    where, params = _point_filter(s, start, end, None, None, box)
    pts = s.points.query(where, params, "lon, lat, sensor, frp, acq_date", range(start.year, end.year + 1), 5000)
    per_day = (pts.assign(day=pd.to_datetime(pts["acq_date"]).dt.strftime("%Y-%m-%d"))
               .groupby(["day", "sensor"]).size().unstack(fill_value=0).reindex(columns=["MODIS", "VIIRS"], fill_value=0))
    return {**_event_dict(s, e),
            "per_day": [{"date": d, "modis": int(r.MODIS), "viirs": int(r.VIIRS)} for d, r in per_day.iterrows()],
            "points": [[round(float(p.lon), 4), round(float(p.lat), 4), p.sensor[0], round(float(p.frp), 1),
                        pd.Timestamp(p.acq_date).strftime("%Y-%m-%d")] for p in pts.itertuples()]}


def risk_map(s: Store, country: str | None = None, limit: int | None = None) -> list[dict]:
    rn = s.risk_now.sort_values("probability", ascending=False)
    if country:
        ids = set(s.regions.loc[s.regions["country"] == country.lower(), "region_id"].astype(int))
        rn = rn[rn["region_id"].isin(ids)]
    if limit:
        rn = rn.head(limit)
    out = []
    for r in rn.itertuples():
        reg = s.by_id[int(r.region_id)]
        out.append({"id": int(r.region_id), "slug": reg.slug, "name_en": reg.name_en, "name_az": reg.name_az,
                    "country": reg.country, **_where(s, reg), "probability": _f(r.probability, 4), "level": r.level,
                    "expected7": _f(r.expected7, 2), "driver": r.drivers[0]["code"] if r.drivers else None})
    return sorted(out, key=lambda x: -(x["probability"] or 0))


def _leaf_ids(s: Store, r) -> list[int]:
    return [int(r.region_id)] if r.level != "country" else \
        s.regions.loc[s.regions["parent_id"] == r.region_id, "region_id"].astype(int).tolist()


def _point_filter(s: Store, start: date, end: date, sensor: str | None = None, region: str | None = None,
                  bbox: tuple[float, float, float, float] | None = None) -> tuple[str, list]:
    where, params = ["acq_date BETWEEN ? AND ?"], [pd.Timestamp(start), pd.Timestamp(end)]
    if sensor:
        where.append("sensor = ?")
        params.append(sensor.upper())
    if region:
        where.append("list_contains(?, region_id)")
        params.append(_leaf_ids(s, region_or_404(s, region)))
    if bbox:
        where.append("lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?")
        params += [bbox[0], bbox[2], bbox[1], bbox[3]]
    return " AND ".join(where), params


def hotspots(s: Store, start: date, end: date, sensor: str | None = None, region: str | None = None,
             limit: int = 20000, bbox: tuple[float, float, float, float] | None = None,
             cell: float | None = None) -> dict:
    """Detections between two dates. With ``cell`` (degrees), detections are summed
    per grid cell, sensor and week for zoomed-out maps: each row is a cell centre,
    with the detection count in place of FRP and the week's Monday as its date."""
    if (end - start).days > 92:
        raise ValueError("date range is limited to 92 days")
    where, params = _point_filter(s, start, end, sensor, region, bbox)
    years = range(start.year, end.year + 1)
    if cell:
        c = max(0.05, float(cell))
        sel = s.points.query(
            where + " GROUP BY 1, 2, 3, 5", params,
            f"(floor(lon / {c}) + 0.5) * {c} AS lon, (floor(lat / {c}) + 0.5) * {c} AS lat, sensor, "
            "any_value(satellite) AS satellite, date_trunc('week', acq_date) AS acq_date, count(*) AS frp",
            years, limit)
        return {"total": int(sel["frp"].sum()) if len(sel) else 0, "truncated": len(sel) >= limit, "cell_deg": c,
                "columns": ["lon", "lat", "sensor", "satellite", "count", "week"],
                "points": [[round(float(x.lon), 3), round(float(x.lat), 3), x.sensor[0], x.satellite, int(x.frp),
                            x.acq_date.strftime("%Y-%m-%d")] for x in sel.itertuples()]}
    total = s.points.count(where, params, years)
    cols = "lon, lat, sensor, satellite, frp, acq_date"
    # more than the map can draw: a random sample of the real detections, not the first N
    sel = s.points.sample(limit, where, params, cols, years) if total > limit else \
        s.points.query(where, params, cols, years)
    return {"total": total, "truncated": total > limit, "sampled": total > limit,
            "columns": ["lon", "lat", "sensor", "satellite", "frp", "date"],
            "points": [[round(float(x.lon), 4), round(float(x.lat), 4), x.sensor[0], x.satellite,
                        round(float(x.frp), 1), x.acq_date.strftime("%Y-%m-%d")] for x in sel.itertuples()]}


def timeline(s: Store) -> list[dict]:
    """Pilot-wide weekly totals per sensor + harmonized, for the explore scrubber."""
    w = s.rows("weekly", s.regions.loc[s.regions["level"] == "country", "region_id"])
    g = w.groupby("week")[["modis", "viirs", "viirs_n", "harmonized", "lo", "hi"]].sum().reset_index()
    return [{"week": r.week.strftime("%Y-%m-%d"), "modis": int(r.modis), "viirs": int(r.viirs),
             "harmonized": _f(r.harmonized, 1), "lo": _f(r.lo, 1), "hi": _f(r.hi, 1)} for r in g.itertuples()]


def grid(s: Store, year: int | None = None, sensor: str | None = None,
         bbox: tuple[float, float, float, float] | None = None, step: float = 0.1) -> dict:
    """Detection density on a regular grid: 0.1° cells, or coarser ``step`` cells
    (summed) for zoomed-out maps; optionally only within ``bbox``."""
    step = max(0.1, float(step))
    cols = [sensor.upper()] if sensor else ["MODIS", "VIIRS"]
    total = " + ".join(f'coalesce("{c}", 0)' for c in cols)
    where, params = ["TRUE"], []
    if year:
        where.append("year = ?")
        params.append(year)
    if bbox:
        where.append("lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?")
        params += [bbox[0], bbox[2], bbox[1], bbox[3]]
    cell = f"(floor(lon / {step}) + 0.5) * {step}", f"(floor(lat / {step}) + 0.5) * {step}"
    agg = s.points._con().execute(
        f"SELECT {cell[0]} AS lon, {cell[1]} AS lat, sum({total}) AS count "
        f"FROM read_parquet(?, union_by_name = true) WHERE {' AND '.join(where)} "
        f"GROUP BY 1, 2 HAVING sum({total}) > 0",
        [s.grid_paths, *params]).df()
    return {"cell_deg": step, "cells": [[round(float(r.lon), 3), round(float(r.lat), 3), int(r.count)]
                                        for r in agg.itertuples()]}


def aoi_summary(s: Store, geometry: dict) -> dict:
    """Calendar for an arbitrary polygon, scaled to the VIIRS record via its regions.

    Before 2012 each region's harmonized/MODIS ratio for that week is applied to the
    MODIS detections inside the polygon; from 2012 the polygon's own S-NPP
    detections are used.
    """
    poly = shape(geometry)
    if poly.is_empty or poly.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError("geometry must be a Polygon or MultiPolygon")
    area = float(gpd.GeoSeries([poly], crs=4326).to_crs(6933).area.iloc[0] / 1e6)
    if area > 60000:
        raise ValueError("area of interest is limited to 60,000 km²")
    minx, miny, maxx, maxy = poly.bounds
    cand = s.points.query("lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?", [minx, maxx, miny, maxy],
                          "lon, lat, sensor, satellite, region_id, acq_date")
    cand["week"] = cand["acq_date"] - pd.to_timedelta(cand["acq_date"].dt.day_of_week, unit="D")
    from shapely import contains_xy
    inside = cand[contains_xy(poly, cand["lon"].to_numpy(), cand["lat"].to_numpy())]
    w = s.rows("weekly", inside["region_id"].dropna().unique())
    ratio = (w["harmonized"] / w["modis"].replace(0, np.nan)).rename("ratio")
    ratio_tbl = pd.concat([w[["region_id", "week"]], ratio], axis=1).set_index(["region_id", "week"])["ratio"]
    pre = inside[(inside["sensor"] == "MODIS") & (inside["week"] < PRE)]
    pre_w = pre.groupby(["region_id", "week"]).size().rename("n").reset_index()
    r = ratio_tbl.reindex(pd.MultiIndex.from_frame(pre_w[["region_id", "week"]])).to_numpy()
    fallback = float(np.nanmedian(ratio_tbl.to_numpy())) if np.isfinite(np.nanmedian(ratio_tbl.to_numpy())) else 3.0
    pre_w["h"] = pre_w["n"] * np.where(np.isfinite(r), r, fallback)
    post = inside[(inside["satellite"] == "N") & (inside["week"] >= PRE)].groupby("week").size().rename("h")
    weeks = pd.date_range(pd.Timestamp(s.meta["data_start"]) - pd.Timedelta(days=pd.Timestamp(s.meta["data_start"]).day_of_week),
                          pd.Timestamp(s.meta["data_end"]), freq="W-MON")
    series = pd.Series(0.0, index=weeks)
    series = series.add(pre_w.groupby("week")["h"].sum(), fill_value=0).add(post.astype(float), fill_value=0)
    ser = pd.DataFrame({"week": series.index, "harmonized": series.to_numpy()})
    raw = inside.assign(naive=np.where(inside["week"] < PRE, inside["sensor"] == "MODIS", inside["sensor"] == "VIIRS"))
    raw_w = raw[raw["naive"]].groupby("week").size().reindex(weeks, fill_value=0)
    cal = build_calendar(ser, raw=pd.DataFrame({"week": weeks, "value": raw_w.to_numpy(dtype=float)}))
    yearly = inside.assign(year=inside["acq_date"].dt.year).groupby(["year", "sensor"]).size().unstack(fill_value=0)
    regions = sorted({s.by_id[int(i)].slug for i in inside["region_id"].unique()})
    return {"area_km2": round(area, 1), "detections": int(len(inside)), "regions": regions,
            "by_year": [{"year": int(y), **{k.lower(): int(v) for k, v in row.items()}} for y, row in yearly.iterrows()],
            "calendar": cal}


def harmonization_skill(s: Store, slug: str | None = None) -> dict:
    """Skill of the pilot batch, or of the batch a region was harmonized in."""
    r = region_or_404(s, slug) if slug else None
    full = s.skill_for(int(r.region_id), detail=True) if r is not None else s.skill
    sk = {k: v for k, v in full.items() if k not in ("transfer", "loyo_annual")}
    if r is not None:
        rid = int(r.region_id)
        sk["batch"] = s.batch_of.get(rid)
        sk["transfer"] = [t for t in full.get("transfer", []) if t["region_id"] == rid]
        sk["loyo_annual"] = [t for t in full.get("loyo_annual", []) if t["region_id"] == rid]
        if not sk["transfer"]:
            # country: show the pooled curve of its largest district
            kids = s.regions[s.regions["parent_id"] == rid].sort_values("area_km2", ascending=False)
            if len(kids):
                k = int(kids.iloc[0].region_id)
                sk["transfer"] = [t for t in full.get("transfer", []) if t["region_id"] == k]
            la = pd.DataFrame([t for t in full.get("loyo_annual", []) if t["region_id"] in set(kids["region_id"])])
            if len(la):
                sk["loyo_annual"] = la.groupby("year")[["obs", "pred", "modis"]].sum().reset_index().round(1) \
                    .to_dict(orient="records")
    return sk


def export(s: Store, slug: str, kind: str, fmt: str, start: date | None, end: date | None) -> tuple[bytes, str, str]:
    r = region_or_404(s, slug)
    if kind == "weekly":
        df = pd.DataFrame(weekly_series(s, slug, start, end))
    elif kind == "annual":
        df = pd.DataFrame(annual_series(s, slug)["years"])
    elif kind == "hotspots":
        st, en = start or date(2024, 1, 1), end or pd.Timestamp(s.meta["data_end"]).date()
        where, params = _point_filter(s, st, en, region=slug)
        df = s.points.query(where, params, "*", range(st.year, en.year + 1), order="acq_date, acq_time")
        df = df.assign(acq_date=lambda d: pd.to_datetime(d["acq_date"]).dt.strftime("%Y-%m-%d"))
    else:
        raise ValueError("kind must be weekly, annual or hotspots")
    name = f"odlar_{slug}_{kind}"
    if fmt == "csv":
        buf = io.StringIO()
        source = "NASA FIRMS" if s.meta.get("source") == "firms" else s.meta.get("source")
        scale = ("Raw detections, not harmonized." if kind == "hotspots" else
                 "Columns harmonized/lo/hi are on the VIIRS S-NPP scale (continued from NOAA-20 after 2 Nov 2026); modis/viirs are raw counts.")
        buf.write(f"# ODLAR {kind} export: {r.name_en}. Source: {source}, data through {s.meta.get('data_end')}. {scale} https://odlar.app\n")
        df.to_csv(buf, index=False)
        return buf.getvalue().encode(), "text/csv", f"{name}.csv"
    if fmt == "json":
        return df.to_json(orient="records").encode(), "application/json", f"{name}.json"
    if fmt == "geojson":
        if kind != "hotspots":
            raise ValueError("geojson export is only available for hotspots")
        feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [x.lon, x.lat]},
                  "properties": {k: getattr(x, k) for k in ("sensor", "satellite", "acq_date", "frp", "confidence")}}
                 for x in df.itertuples()]
        return json.dumps({"type": "FeatureCollection", "features": feats}, default=str).encode(), \
            "application/geo+json", f"{name}.geojson"
    raise ValueError("format must be csv, json or geojson")


def overview(s: Store) -> dict:
    """Headline numbers for the landing page. The record chart and skill numbers
    are the pilot batch's (South Caucasus); risk covers every batch."""
    primary = s.meta.get("primary_batch")
    countries = s.regions[(s.regions["level"] == "country")
                          & s.regions["region_id"].map(lambda i: s.batch_of.get(int(i)) == primary)]
    w = s.annual[s.annual["region_id"].isin(countries["region_id"])]
    tot = w.groupby("year")[["harmonized", "lo", "hi", "modis", "viirs", "naive"]].sum().reset_index()
    sk = s.skill
    mr = s.model_report
    risk = risk_map(s)
    return {
        "meta": s.meta,
        "pilot": tot.round(1).to_dict(orient="records"),
        "skill": {k: sk.get(k) for k in ("bias", "raw_modis_bias", "annual_spearman", "weekly_interval_coverage",
                                          "annual_interval_coverage", "annual_median_rel_error", "n_years")},
        "model": {"harmonized": mr["harmonized"]["overall"], "raw": mr["raw"]["overall"]},
        "risk_top": risk[:8],
        "risk_counts": pd.Series([r["level"] for r in risk]).value_counts().to_dict(),
        # districts and provinces (each country uses one or the other); country rows are not units
        "n_regions": int((s.regions["level"] != "country").sum()),
        "breaks": breaks_summary(s),
        "countries": sorted(s.regions.loc[s.regions["level"] == "country", "country"].unique().tolist()),
        "country_names": {c: {"en": country_names().get(c, (c.upper(),) * 2)[0],
                              "az": country_names().get(c, (c.upper(),) * 2)[1]}
                          for c in s.regions["country"].unique().tolist()},
    }


def locate(s: Store, lat: float, lon: float) -> dict:
    """Leaf region containing a point (for "use my location")."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("lat/lon out of range")
    from shapely import from_geojson
    from shapely.geometry import Point
    pt = Point(lon, lat)
    rows = s.points._con().execute(
        "SELECT region_id, geometry FROM read_parquet(?) WHERE detail = 'z2' AND NOT is_country "
        "AND ? BETWEEN minx AND maxx AND ? BETWEEN miny AND maxy", [s.shape_paths, lon, lat]).fetchall()
    for rid, geom in rows:
        if from_geojson(geom).contains(pt):
            return {"region": _region_dict(s.by_id[int(rid)], s)}
    raise NotFound("no region at this location")


STATIC_CELL_DEG = 0.01  # the cell size the static-source filter uses (odlar.ingest.firms)


def static_sources(s: Store, bbox: tuple[float, float, float, float] | None, limit: int = 5000) -> dict:
    """Cells removed as steady heat sources (gas flares, refineries, burning gas
    vents): hot in at least a fifth of all months for two years or more, so not
    vegetation fires. Their detections never enter the record."""
    cells = getattr(s, "_static", None)
    if cells is None:
        frames = [pd.read_parquet(f) for d in s.dirs if (f := d.parent / "state" / "static_cells.parquet").exists()]
        cells = pd.concat(frames, ignore_index=True).drop_duplicates() if frames else pd.DataFrame(columns=["cx", "cy"])
        cells = pd.DataFrame({"lon": (cells["cx"].to_numpy() + 0.5) * STATIC_CELL_DEG,
                              "lat": (cells["cy"].to_numpy() + 0.5) * STATIC_CELL_DEG})
        s._static = cells
    total = int(len(cells))
    if bbox:
        w, so, e, n = bbox
        cells = cells[cells["lon"].between(w, e) & cells["lat"].between(so, n)]
    pts = cells.head(limit).round(3)
    return {"total": total, "in_view": int(len(cells)), "cell_km": 1,
            "cells": pts[["lon", "lat"]].to_numpy().tolist()}
