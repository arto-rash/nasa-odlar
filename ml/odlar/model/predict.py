"""Inference and plain-language explanations for the risk models."""

from __future__ import annotations

import numpy as np
import pandas as pd

from odlar.config import risk_level
from odlar.model.features import FEATURES

# feature -> (driver code, feature whose value is shown to the user)
DRIVER_OF = {
    "days_since_rain": ("dry_spell", "days_since_rain"),
    "fc_precip": ("no_rain_ahead", "fc_precip"),
    "fc_dry_days": ("no_rain_ahead", "fc_precip"),
    "precip_7d": ("dry_month", "precip_30d"),
    "precip_30d": ("dry_month", "precip_30d"),
    "fc_wind_max": ("wind", "fc_wind_max"),
    "wind_7d": ("wind", "fc_wind_max"),
    "fc_tmax": ("heat", "fc_tmax"),
    "tmax_7d": ("heat", "fc_tmax"),
    "fc_rh_min": ("low_humidity", "fc_rh_min"),
    "rh_7d": ("low_humidity", "fc_rh_min"),
    "fc_vpd_max": ("high_vpd", "fc_vpd_max"),
    "vpd_7d": ("high_vpd", "fc_vpd_max"),
    "clim_next7": ("seasonal_peak", "clim_next7"),
    "clim_p75_next7": ("seasonal_peak", "clim_next7"),
    "clim_next30": ("seasonal_peak", "clim_next7"),
    "doy_sin": ("seasonal_peak", "clim_next7"),
    "doy_cos": ("seasonal_peak", "clim_next7"),
    "lag7": ("recent_fires", "lag7"),
    "lag14": ("recent_fires", "lag7"),
    "anom7": ("recent_fires", "lag7"),
    "days_since_fire": ("recent_fires", "lag7"),
    "lag30": ("active_season", "anom30"),
    "lag90": ("active_season", "anom30"),
    "anom30": ("active_season", "anom30"),
    "ytd_ratio": ("active_season", "ytd_ratio"),
    "ndvi": ("vegetation", "ndvi"),
    "elevation": ("landscape", "elevation"),
    "log_area": ("landscape", "elevation"),
    "lat": ("landscape", "elevation"),
    "lon": ("landscape", "elevation"),
}


def drivers(contrib: np.ndarray, row: pd.Series, top: int = 3) -> list[dict]:
    """Group per-feature SHAP values into named drivers; strongest first."""
    agg: dict[str, float] = {}
    for f, c in zip(FEATURES, contrib[: len(FEATURES)], strict=True):
        code = DRIVER_OF.get(f, ("other", f))[0]
        agg[code] = agg.get(code, 0.0) + float(c)
    shown = {code: col for code, col in DRIVER_OF.values()}
    items = sorted(agg.items(), key=lambda kv: -abs(kv[1]))
    out = []
    for code, impact in items:
        if code in ("landscape", "other"):
            continue
        col = shown.get(code)
        val = row.get(col) if col else None
        out.append({"code": code, "impact": round(impact, 3), "direction": "up" if impact > 0 else "down",
                    "value": None if val is None or pd.isna(val) else round(float(val), 2)})
        if len(out) >= top + 1:
            break
    ups = [d for d in out if d["direction"] == "up"][:top]
    downs = [d for d in out if d["direction"] == "down"][:1]
    return ups + downs


def short_term(models, rows: pd.DataFrame) -> pd.DataFrame:
    """Risk for the next 7 days for each row (one per region)."""
    p = models.proba(rows)
    exp = models.expected(rows)
    contrib = models.contributions(rows)
    out = rows[["region_id", "date", "threshold7", "clim_next7", "lag7"]].copy()
    out["probability"] = p.round(4)
    out["level"] = [risk_level(v) for v in p]
    out["expected7"] = exp.round(2)
    out["drivers"] = [drivers(contrib[i], rows.iloc[i]) for i in range(len(rows))]
    return out


def week_bin(d: pd.Series | pd.DatetimeIndex) -> np.ndarray:
    """Calendar week bin (0–51) of a date, as in the calendar (odlar.calendar.engine)."""
    doy = pd.DatetimeIndex(d).day_of_year.to_numpy()
    return np.minimum((doy - 1) // 7, 51)


def outlook_mondays(end, n: int) -> pd.DatetimeIndex:
    """The ``n`` weeks after the one holding ``end``, as Mondays (the record's weeks)."""
    e = pd.Timestamp(end).normalize()
    return pd.date_range(e + pd.Timedelta(days=7 - e.weekday()), periods=n, freq="7D")


def spread_outlook(total: dict, mean: np.ndarray, p10: np.ndarray, p90: np.ndarray,
                   weeks: pd.DatetimeIndex) -> pd.DataFrame:
    """Spread a 13-week outlook total (q10/q50/q90) over its weeks in the shape of
    the usual year, next to each week's usual range. The weekly split carries the
    model's view of the total; how it falls week to week is the climatology's."""
    w = week_bin(weeks)
    shape = mean[w] + 0.01
    share = shape / shape.sum()
    return pd.DataFrame({"week": weeks, "woy": w,
                         "q10": total["q10"] * share, "q50": total["q50"] * share, "q90": total["q90"] * share,
                         "normal": mean[w], "normal_p10": p10[w], "normal_p90": p90[w]})


def outlook_weeks(outlook_now: pd.DataFrame, clim: pd.DataFrame, end) -> pd.DataFrame:
    """The outlook per leaf region and week, for maps of the weeks ahead."""
    weeks = outlook_mondays(end, 13)
    mean = clim.pivot_table(index="region_id", columns="woy", values="clim_mean").reindex(columns=range(52))
    o = outlook_now.set_index("region_id")[["q10", "q50", "q90"]]
    ids = o.index.intersection(mean.dropna().index)
    m = mean.loc[ids].to_numpy(dtype=float)[:, week_bin(weeks)]  # regions × 13
    share = (m + 0.01) / (m + 0.01).sum(axis=1, keepdims=True)
    n = len(weeks)
    out = pd.DataFrame({"region_id": np.repeat(ids.to_numpy(dtype=int), n), "week": np.tile(weeks, len(ids))})
    for col in ("q10", "q50", "q90"):
        out[col] = (o.loc[ids, col].to_numpy(dtype=float)[:, None] * share).ravel()
    out["normal"] = m.ravel()
    for col in ("q10", "q50", "q90", "normal"):
        out[col] = out[col].astype("float32").round(2)
    return out


def fire_weather_daily(forecast: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    """Day-by-day fire-weather danger (0–100) from the forecast, ranked against each
    region's own climate record for that time of year."""
    w = weather.assign(doy=pd.to_datetime(weather["date"]).dt.day_of_year)

    def index(df: pd.DataFrame) -> pd.Series:
        es = 0.6108 * np.exp(17.27 * df["tmax"] / (df["tmax"] + 237.3))
        vpd = es * (1 - df["rh"].clip(0, 100) / 100)
        return vpd / 1.5 + df["wind"] / 5 - np.minimum(df["precip"], 20) / 4

    w["fwi"] = index(w)
    f = forecast.assign(doy=pd.to_datetime(forecast["date"]).dt.day_of_year)
    f["fwi"] = index(f)
    out = []
    for rid, g in f.groupby("region_id"):
        hist = w[w["region_id"] == rid]
        for r in g.itertuples():
            near = hist[(hist["doy"] - r.doy).abs().pipe(lambda d: np.minimum(d, 366 - d)) <= 15]["fwi"].to_numpy()
            pct = float((near < r.fwi).mean() * 100) if near.size else 50.0
            row = {"region_id": rid, "date": r.date, "danger": round(pct, 1), "tmax": round(r.tmax, 1),
                   "rh": round(r.rh, 0), "wind": round(r.wind, 1), "precip": round(r.precip, 1)}
            # shown, not scored: the 25-year record the danger is ranked against has no gusts
            for col in ("gust", "wdir"):
                v = getattr(r, col, None)
                row[col] = round(float(v), 1) if v is not None and np.isfinite(v) else np.nan
            out.append(row)
    return pd.DataFrame(out)
