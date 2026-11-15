"""Deterministic synthetic fire world for offline demos and tests.

The generator simulates *true* fires and then *observes* them through each
sensor, the same way the real record is produced:

* true fire occurrence depends on region land profile, season (spring field
  burning, summer stubble burning after the wheat harvest, autumn clean-up),
  inter-annual variability, injected anomaly years, and real or synthetic weather
  (dry, hot, windy days burn more; rainy days almost never);
* each fire has a size; MODIS (1 km) only sees larger fires, VIIRS (375 m) sees
  many small ones and splits large fires into more pixels;
* clouds hide fires on wet days; satellites appear on their real launch dates.

Because the generator also records the *counterfactual* VIIRS S-NPP detections
that would have existed before 2012, it provides ground truth that the real
world cannot: tests can check that harmonized MODIS recovers the VIIRS scale.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

from odlar.ingest.firms import COLUMNS

SATELLITES = {
    # code: (sensor, source name, first date, UTC overpass hhmm, size scale ha, pixel area ha)
    "T": ("MODIS", "MODIS_SP", date(2000, 11, 1), 715, 32.0, 140.0),
    "A": ("MODIS", "MODIS_SP", date(2002, 7, 4), 1000, 32.0, 140.0),
    "N": ("VIIRS", "VIIRS_SNPP_SP", date(2012, 1, 20), 1000, 2.2, 13.0),
    "J1": ("VIIRS", "VIIRS_NOAA20_SP", date(2018, 4, 1), 1050, 2.2, 13.0),
    "J2": ("VIIRS", "VIIRS_NOAA21_NRT", date(2024, 1, 17), 1020, 2.2, 13.0),
}

# Injected anomalies: (region slug prefix or exact slug set, year, multiplier, doy window)
KARABAKH = {"az-agdam", "az-fuzuli", "az-jabrayil", "az-zangilan", "az-qubadli", "az-lachin",
            "az-kalbajar", "az-khojavend", "az-khojaly", "az-shusha", "az-tartar"}
ANOMALIES = [
    (KARABAKH, 2006, 3.5, (170, 250)),           # 2006 Karabakh steppe fires
    ({"ge-samtskhe-javakheti"}, 2017, 6.0, (220, 245)),  # Borjomi forest fire
    (None, 2010, 1.6, (150, 260)),               # 2010 heat wave, whole region
    (None, 2021, 1.5, (180, 260)),               # 2021 hot dry summer
    (None, 2014, 0.55, (60, 140)),               # wet spring, suppressed burning
]

GAS_FLARES = [(40.42, 49.93), (40.18, 49.47), (40.33, 50.36), (39.40, 49.25)]


@dataclass(frozen=True)
class SyntheticWorld:
    hotspots: pd.DataFrame          # observed detections, FIRMS schema
    true_daily: pd.DataFrame        # region_id, date, true_fires
    counterfactual: pd.DataFrame    # region_id, date, viirs_cf (S-NPP-equivalent counts)
    profiles: pd.DataFrame          # region land profiles used by the generator


def synthetic_weather(regions: pd.DataFrame, start: date, end: date, seed: int = 7) -> pd.DataFrame:
    """Plausible daily weather when NASA POWER data is unavailable (tests, offline)."""
    rng = np.random.default_rng(seed)
    days = pd.date_range(start, end, freq="D")
    doy = days.day_of_year.to_numpy()
    frames = []
    for r in regions.itertuples():
        n = len(days)
        season = np.cos(2 * np.pi * (doy - 200) / 365.25)
        noise = np.zeros(n)
        eps = rng.normal(0, 2.2, n)
        for i in range(1, n):
            noise[i] = 0.8 * noise[i - 1] + eps[i]
        tmean = 13.5 - 0.6 * (r.lat - 40) + 13 * season + noise
        rh = np.clip(68 - 14 * season - 1.2 * noise + rng.normal(0, 6, n), 15, 100)
        wet = rng.random(n) < (0.22 - 0.12 * season)
        precip = np.where(wet, rng.gamma(0.9, 6.0, n), 0.0)
        frames.append(pd.DataFrame({
            "date": days, "region_id": r.region_id, "tmean": tmean, "tmax": tmean + 6 + rng.normal(0, 1.5, n),
            "rh": rh, "wind": np.clip(rng.gamma(3.0, 1.2, n), 0.2, 20), "precip": precip,
        }))
    return pd.concat(frames, ignore_index=True)


def add_dryness(weather: pd.DataFrame) -> pd.DataFrame:
    """Derived fire-weather variables: VPD, days since rain, 30-day precipitation."""
    w = weather.sort_values(["region_id", "date"]).copy()
    w[["tmax", "tmean", "rh", "wind", "precip"]] = (
        w.groupby("region_id")[["tmax", "tmean", "rh", "wind", "precip"]]
        .transform(lambda s: s.interpolate(limit_direction="both"))
    )
    es = 0.6108 * np.exp(17.27 * w["tmax"] / (w["tmax"] + 237.3))
    w["vpd"] = (es * (1 - w["rh"].clip(0, 100) / 100)).clip(lower=0)
    rain = (w["precip"] >= 1.0).to_numpy()
    dsr = np.zeros(len(w))
    reg = w["region_id"].to_numpy()
    run = 0
    for i in range(len(w)):
        if i and reg[i] != reg[i - 1]:
            run = 0
        run = 0 if rain[i] else run + 1
        dsr[i] = run
    w["days_since_rain"] = np.minimum(dsr, 90)
    w["precip_30d"] = w.groupby("region_id")["precip"].transform(lambda s: s.rolling(30, min_periods=1).sum())
    return w.reset_index(drop=True)


def region_profiles(regions: gpd.GeoDataFrame, elevation: pd.Series | None = None) -> pd.DataFrame:
    """Fire-regime profile per leaf region from elevation and known land use."""
    leaves = regions[regions.level != "country"]
    rows = []
    for r in leaves.itertuples():
        elev = float(elevation.get(r.region_id, np.nan)) if elevation is not None else np.nan
        if np.isnan(elev):
            elev = 150 + 900 * abs(r.lat - 40.2) + (600 if r.country != "az" else 0)
        if elev < 350:
            regime, density, w = "lowland_agri", 0.16, (0.22, 0.62, 0.16)
        elif elev < 1100:
            regime, density, w = "foothill_mixed", 0.07, (0.32, 0.45, 0.23)
        else:
            regime, density, w = "mountain", 0.025, (0.25, 0.50, 0.25)
        if r.slug in KARABAKH:
            regime, density = "steppe_grass", max(density, 0.11)
        if r.slug in {"ge-kakheti", "ge-shida-kartli", "ge-kvemo-kartli", "am-ararat", "am-armavir"}:
            regime, density, w = "lowland_agri", 0.10, (0.25, 0.60, 0.15)
        if r.kind == "city":
            density *= 0.15
        rows.append({"region_id": r.region_id, "slug": r.slug, "regime": regime, "elevation": elev,
                     "rate": density * r.area_km2, "w_spring": w[0], "w_summer": w[1], "w_autumn": w[2],
                     "trend": 0.012 if regime == "lowland_agri" else 0.004})
    return pd.DataFrame(rows)


def season_shape(doy: np.ndarray, w: tuple[float, float, float], regime: str) -> np.ndarray:
    """Tri-modal annual burning curve normalised to mean 1 over the year."""
    summer_mu = 228 if regime in ("mountain", "steppe_grass") else 205
    curve = (w[0] * _wrapped_gauss(doy, 88, 16) + w[1] * _wrapped_gauss(doy, summer_mu, 22)
             + w[2] * _wrapped_gauss(doy, 292, 15) + 0.015)
    return curve / curve.mean()


def _wrapped_gauss(doy: np.ndarray, mu: float, sd: float) -> np.ndarray:
    d = np.abs(doy - mu)
    d = np.minimum(d, 365.25 - d)
    return np.exp(-0.5 * (d / sd) ** 2)


def _sample_points(geom, n: int, centers: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Field-clustered points inside ``geom``: pick a cluster centre, jitter ~1.5 km."""
    out = np.empty((n, 2))
    idx = rng.integers(0, len(centers), n)
    pts = centers[idx] + rng.normal(0, 0.014, (n, 2))
    from shapely import contains_xy
    inside = contains_xy(geom, pts[:, 0], pts[:, 1])
    out[inside] = pts[inside]
    out[~inside] = centers[idx[~inside]]
    return out


def _cluster_centers(geom, rng: np.random.Generator, k: int = 160) -> np.ndarray:
    minx, miny, maxx, maxy = geom.bounds
    pts: list[tuple[float, float]] = []
    tries = 0
    while len(pts) < k and tries < k * 60:
        x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
        if geom.contains(Point(x, y)):
            pts.append((x, y))
        tries += 1
    if not pts:
        c = geom.representative_point()
        pts = [(c.x, c.y)]
    return np.array(pts)


def generate(regions: gpd.GeoDataFrame, weather: pd.DataFrame, start: date, end: date,
             elevation: pd.Series | None = None, seed: int = 42, scale: float = 1.0) -> SyntheticWorld:
    rng = np.random.default_rng(seed)
    profiles = region_profiles(regions, elevation)
    w = add_dryness(weather)
    w = w[(w["date"] >= pd.Timestamp(start)) & (w["date"] <= pd.Timestamp(end))]
    leaves = regions.set_index("region_id")
    years = np.arange(start.year, end.year + 1)
    year_mult = dict(zip(years, rng.lognormal(0, 0.22, len(years)), strict=True))

    detections, truth, cf = [], [], []
    for prof in profiles.itertuples():
        rw = w[w["region_id"] == prof.region_id]
        if rw.empty:
            continue
        dates = pd.DatetimeIndex(rw["date"])
        doy = dates.day_of_year.to_numpy()
        yr = dates.year.to_numpy()
        # Standardised fire-weather index from real (or synthetic) weather.
        dry = (np.minimum(rw["days_since_rain"].to_numpy(), 40) / 12
               + rw["vpd"].to_numpy() / 1.2 + rw["wind"].to_numpy() / 6
               - rw["precip_30d"].to_numpy() / 60)
        dry_z = (dry - dry.mean()) / (dry.std() + 1e-9)
        lam = (prof.rate * scale / 365.25
               * season_shape(doy, (prof.w_spring, prof.w_summer, prof.w_autumn), prof.regime)
               * np.array([year_mult[y] for y in yr])
               * (1 + prof.trend) ** (yr - start.year)
               * np.exp(0.45 * np.clip(dry_z, -3, 3)))
        lam = np.where(rw["precip"].to_numpy() > 4, lam * 0.15, lam)
        for slugs, ayear, mult, (d0, d1) in ANOMALIES:
            if slugs is None or prof.slug in slugs:
                lam = np.where((yr == ayear) & (doy >= d0) & (doy <= d1), lam * mult, lam)
        n_true = rng.poisson(lam)
        truth.append(pd.DataFrame({"region_id": prof.region_id, "date": dates, "true_fires": n_true}))

        geom = leaves.loc[prof.region_id, "geometry"]
        centers = _cluster_centers(geom, rng)
        fire_day = np.repeat(np.arange(len(dates)), n_true)
        if fire_day.size == 0:
            cf.append(pd.DataFrame({"region_id": prof.region_id, "date": dates, "viirs_cf": 0}))
            continue
        big_bias = 0.5 if prof.regime in ("mountain", "steppe_grass") else 0.0
        size = rng.lognormal(0.9 + big_bias, 1.25, fire_day.size)  # hectares
        # Large fires burn for several days.
        duration = 1 + np.where(size > 40, rng.geometric(0.45, size.size) - 1, 0)
        fire_idx = np.repeat(np.arange(size.size), duration)
        offset = np.concatenate([np.arange(d) for d in duration])
        day_idx = np.minimum(fire_day[fire_idx] + offset, len(dates) - 1)
        burn_size = size[fire_idx] * np.where(offset == 0, 1.0, 0.6 ** offset)
        loc = _sample_points(geom, size.size, centers, rng)[fire_idx]
        wet = rw["precip"].to_numpy()[day_idx] > 2
        clear_p = np.where(wet, 0.3, 0.88)

        cf_counts = np.zeros(len(dates), dtype=int)
        for sat, (sensor, source, first, hhmm, s_scale, pix) in SATELLITES.items():
            p_det = (1 - np.exp(-((burn_size / s_scale) ** 0.85))) * clear_p
            seen = rng.random(day_idx.size) < p_det
            n_pix = 1 + rng.poisson(burn_size / pix)
            n_pix = np.where(seen, n_pix, 0)
            if sat == "N":
                np.add.at(cf_counts, day_idx, n_pix)  # counterfactual: S-NPP on every day
            active = dates[day_idx] >= pd.Timestamp(first)
            n_pix = np.where(active, n_pix, 0)
            if n_pix.sum() == 0:
                continue
            rep = np.repeat(np.arange(day_idx.size), n_pix)
            spread = 0.004 if sensor == "VIIRS" else 0.01
            lat = loc[rep, 1] + rng.normal(0, spread, rep.size)
            lon = loc[rep, 0] + rng.normal(0, spread, rep.size)
            frp = rng.lognormal(np.log(4 + burn_size[rep] * (0.6 if sensor == "VIIRS" else 2.2)), 0.6)
            if sensor == "MODIS":
                conf = np.clip(rng.normal(55 + 8 * np.log1p(burn_size[rep]), 15), 0, 100).astype(int)
            else:
                conf = rng.choice([30, 60, 90], rep.size, p=[0.08, 0.82, 0.10])
            detections.append(pd.DataFrame({
                "sensor": sensor, "satellite": sat, "source": source,
                "acq_date": dates[day_idx[rep]].date, "acq_time": hhmm + rng.integers(-40, 40, rep.size),
                "lat": lat.round(5), "lon": lon.round(5), "frp": frp.round(2), "confidence": conf,
                "daynight": "D", "type": 0,
            }))
        cf.append(pd.DataFrame({"region_id": prof.region_id, "date": dates, "viirs_cf": cf_counts}))

    detections.append(_gas_flares(start, end, rng))
    hotspots = pd.concat(detections, ignore_index=True)[COLUMNS]
    hotspots = hotspots.sort_values(["acq_date", "acq_time"]).reset_index(drop=True)
    return SyntheticWorld(hotspots=hotspots, true_daily=pd.concat(truth, ignore_index=True),
                          counterfactual=pd.concat(cf, ignore_index=True), profiles=profiles)


def _gas_flares(start: date, end: date, rng: np.random.Generator) -> pd.DataFrame:
    days = pd.date_range(start, end, freq="D")
    rows = []
    for lat, lon in GAS_FLARES:
        for sat, (sensor, source, first, hhmm, *_rest) in SATELLITES.items():
            d = days[(days >= pd.Timestamp(first)) & (rng.random(len(days)) < 0.55)]
            rows.append(pd.DataFrame({
                "sensor": sensor, "satellite": sat, "source": source, "acq_date": d.date,
                "acq_time": hhmm, "lat": lat + rng.normal(0, 0.001, len(d)),
                "lon": lon + rng.normal(0, 0.001, len(d)), "frp": rng.lognormal(3, 0.4, len(d)),
                "confidence": 90 if sensor == "MODIS" else 60, "daynight": "D", "type": 2,
            }))
    return pd.concat(rows, ignore_index=True)
