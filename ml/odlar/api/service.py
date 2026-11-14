"""Query logic behind the analytics API, kept separate from FastAPI for testing."""

from __future__ import annotations

import io
import json
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.stats import kendalltau, theilslopes
from shapely.geometry import shape

from odlar.calendar.engine import build_calendar
from odlar.config import OVERLAP_START, risk_level
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


def _region_dict(r) -> dict:
    return {"id": int(r.region_id), "slug": r.slug, "name_en": r.name_en, "name_az": r.name_az,
            "country": r.country, "level": r.level, "kind": r.kind,
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


def list_regions(s: Store) -> list[dict]:
    end_year = int(pd.Timestamp(s.meta["data_end"]).year)
    ann = s.annual[(s.annual["year"] >= 2001) & (s.annual["year"] < end_year)]
    spark = {int(k): g.sort_values("year")["harmonized"].round(1).tolist() for k, g in ann.groupby("region_id")}
    out = []
    for r in s.regions.itertuples():
        d = _region_dict(r)
        rid = int(r.region_id)
        d["risk"] = _risk_for(s, rid)
        vals = spark.get(rid, [])
        d["annual"] = vals
        d["annual_mean"] = _f(np.mean(vals), 1) if vals else None
        d["density"] = _f(np.mean(vals) / max(float(r.area_km2), 1) * 100, 3) if vals else None
        if vals:
            yrs = np.arange(2001, 2001 + len(vals), dtype=float)
            d["trend_pct"] = trend(yrs, np.asarray(vals, dtype=float))["pct_per_decade"]
        out.append(d)
    return out


def regions_geojson(s: Store) -> str:
    """Every region at full map detail (the shapes are read from disk)."""
    return region_shapes(s, None, 8.0)


def region_shapes(s: Store, bbox: tuple[float, float, float, float] | None = None, zoom: float = 8.0,
                  country: str | None = None) -> str:
    """The regions in view as GeoJSON text: country outlines only when zoomed out
    (zoom < 4), provinces simplified to ~500 m up to zoom 7, full map detail after.
    Risk and density properties are current; geometry comes pre-serialized."""
    detail = "z0" if zoom < 4 else "z1" if zoom < 7 else "z2"
    where, params = ["detail = ?"], [detail]
    if zoom >= 4 and not country:
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
    rows = s.points._con().execute(
        f"SELECT region_id, geometry FROM read_parquet(?) WHERE {' AND '.join(where)} "
        "ORDER BY is_country DESC, region_id",  # countries first (provinces reference them)
        [s.shape_paths, *params]).fetchall()
    recent_year = int(pd.Timestamp(s.meta["data_end"]).year)
    ann = s.annual[(s.annual["year"] >= 2003) & (s.annual["year"] < recent_year)]
    ids = [int(r[0]) for r in rows]
    clim = ann[ann["region_id"].isin(ids)].groupby("region_id")["harmonized"].mean()
    parts = []
    for rid, geom in rows:
        reg = s.by_id[int(rid)]
        rk = _risk_for(s, int(rid)) or {}
        props = {"id": int(rid), "slug": reg.slug, "name_en": reg.name_en, "name_az": reg.name_az,
                 "country": reg.country, "level": reg.level, "probability": rk.get("probability"),
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


def region_detail(s: Store, slug: str) -> dict:
    r = region_or_404(s, slug)
    rid = int(r.region_id)
    d = _region_dict(r)
    ann = s.annual[s.annual["region_id"] == rid]
    end_year = int(pd.Timestamp(s.meta["data_end"]).year)
    full = ann[(ann["year"] >= 2001) & (ann["year"] < end_year)]
    cal = s.calendar(rid) or {}
    d["risk"] = _risk_for(s, rid)
    d["children"] = [_region_dict(c) for c in s.regions[s.regions["parent_id"] == rid].itertuples()]
    if not pd.isna(r.parent_id):
        d["parent"] = _region_dict(s.by_id[int(r.parent_id)])
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
    return {"region": _region_dict(r), **cal}


def risk_detail(s: Store, slug: str) -> dict:
    r = region_or_404(s, slug)
    rid = int(r.region_id)
    leaf_ids = [rid] if r.level != "country" else s.regions.loc[s.regions["parent_id"] == rid, "region_id"].tolist()
    rn = s.risk_now[s.risk_now["region_id"].isin(leaf_ids)]
    fw = s.fire_weather[s.fire_weather["region_id"].isin(leaf_ids)]
    ol = s.outlook_now[s.outlook_now["region_id"].isin(leaf_ids)]
    hist = s.rows("risk_history", leaf_ids)
    out: dict = {"region": _region_dict(r), "as_of": s.meta["data_end"], "forecast_source": s.meta.get("forecast_source")}
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
    days = fw.groupby("date").agg(danger=("danger", "mean"), tmax=("tmax", "mean"), rh=("rh", "mean"),
                                  wind=("wind", "mean"), precip=("precip", "mean")).reset_index()
    out["daily"] = [{"date": d.date.strftime("%Y-%m-%d"), "danger": _f(d.danger, 1), "tmax": _f(d.tmax, 1),
                     "rh": _f(d.rh, 0), "wind": _f(d.wind, 1), "precip": _f(d.precip, 1)} for d in days.itertuples()]
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


def risk_map(s: Store) -> list[dict]:
    rn = s.risk_now
    out = []
    for r in rn.itertuples():
        reg = s.by_id[int(r.region_id)]
        out.append({"id": int(r.region_id), "slug": reg.slug, "name_en": reg.name_en, "name_az": reg.name_az,
                    "country": reg.country, "probability": _f(r.probability, 4), "level": r.level,
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
    full = s.skill_for(int(r.region_id)) if r is not None else s.skill
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
        buf.write(f"# ODLAR {kind} export — {r.name_en} — source: {s.meta['source']} — harmonized to VIIRS S-NPP scale\n")
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
        "synthetic_truth": {k: v for k, v in (sk.get("synthetic_truth") or {}).items() if k != "by_year"} or None,
        "model": {"harmonized": mr["harmonized"]["overall"], "raw": mr["raw"]["overall"]},
        "risk_top": risk[:8],
        "risk_counts": pd.Series([r["level"] for r in risk]).value_counts().to_dict(),
        "n_regions": int(len(s.regions)),
        "countries": sorted(s.regions.loc[s.regions["level"] == "country", "country"].unique().tolist()),
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
            return {"region": _region_dict(s.by_id[int(rid)])}
    raise NotFound("no region at this location")
