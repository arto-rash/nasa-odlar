"""Feature panel for the fire-risk models.

Rows are (leaf region, issue date t). Everything is computed from data at or
before ``t``, except the ``fc_*`` columns, which describe weather in the next 7
days. In training those come from observed weather (a "perfect forecast" setup);
at inference they come from the Open-Meteo forecast. The ``target_*`` columns
describe the future and are only used as labels.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from odlar.calendar.engine import year_matrix
from odlar.config import OVERLAP_START

HORIZON = 7
OUTLOOK_WEEKS = 13

FEATURES = [
    "lag7", "lag14", "lag30", "lag90", "days_since_fire", "anom7", "anom30", "ytd_ratio",
    "clim_next7", "clim_p75_next7", "clim_next30",
    "tmax_7d", "rh_7d", "wind_7d", "precip_7d", "precip_30d", "days_since_rain", "vpd_7d",
    "fc_tmax", "fc_rh_min", "fc_wind_max", "fc_precip", "fc_vpd_max", "fc_dry_days",
    "ndvi", "doy_sin", "doy_cos", "elevation", "log_area", "lat", "lon",
]

OUTLOOK_FEATURES = [
    "clim_next13w", "clim_p10_13w", "clim_p90_13w", "lag30", "lag90", "anom30", "ytd_ratio",
    "precip_30d", "precip_90d_anom", "tmax_30d_anom", "days_since_rain", "ndvi",
    "doy_sin", "doy_cos", "elevation", "log_area",
]


def daily_series(daily: pd.DataFrame, harm_weekly: pd.DataFrame, mode: str = "harmonized") -> pd.DataFrame:
    """Daily activity per leaf region on a chosen scale.

    ``harmonized``: VIIRS S-NPP scale. Pre-2012 weekly harmonized totals are
    spread over the days of the week in proportion to that week's MODIS detections.
    ``raw``: the naive merged record, MODIS before 2012, every VIIRS satellite after.
    """
    d = daily[["region_id", "date", "modis_t", "modis_a", "viirs_n", "viirs_j1", "viirs_j2"]].copy()
    # S-NPP scale: S-NPP itself, or the NOAA-20/21 bridge on days it is missing
    snpp = daily["snpp_eq"].to_numpy(dtype=float) if "snpp_eq" in daily else d["viirs_n"].to_numpy(dtype=float)
    d["date"] = pd.to_datetime(d["date"])
    d["week"] = d["date"] - pd.to_timedelta(d["date"].dt.day_of_week, unit="D")
    modis = (d["modis_t"] + d["modis_a"]).astype(float)
    pre = d["date"] < pd.Timestamp(OVERLAP_START)
    if mode == "raw":
        d["value"] = np.where(pre, modis, d["viirs_n"] + d["viirs_j1"] + d["viirs_j2"]).astype(float)
        return d[["region_id", "date", "value"]]
    wk_modis = modis.groupby([d["region_id"], d["week"]]).transform("sum")
    share = np.where(wk_modis > 0, modis / wk_modis.replace(0, np.nan), 1 / 7)
    hw = harm_weekly.set_index(["region_id", "week"])["harmonized"]
    weekly_val = hw.reindex(pd.MultiIndex.from_arrays([d["region_id"], d["week"]])).to_numpy()
    d["value"] = np.where(pre, np.nan_to_num(weekly_val) * share, snpp).astype(float)
    return d[["region_id", "date", "value"]]


def _grp_roll(s: pd.Series, by: pd.Series, window: int, func: str = "sum") -> pd.Series:
    return getattr(s.groupby(by).rolling(window, min_periods=1), func)().reset_index(level=0, drop=True)


def _fwd(s: pd.Series, by: pd.Series, window: int, func: str) -> pd.Series:
    """Statistic over the *next* ``window`` days (t+1 .. t+window)."""
    rev = s.iloc[::-1]
    r = getattr(rev.groupby(by.iloc[::-1]).rolling(window, min_periods=1), func)().reset_index(level=0, drop=True)
    return r.iloc[::-1].groupby(by).shift(-1)


def weekly_clim(series: pd.DataFrame, years: list[int]) -> pd.DataFrame:
    """Per region × calendar week: mean, p10, p75, p90 of weekly totals over ``years``."""
    s = series.assign(week=series["date"] - pd.to_timedelta(series["date"].dt.day_of_week, unit="D"))
    wk = s.groupby(["region_id", "week"], as_index=False)["value"].sum().rename(columns={"value": "harmonized"})
    rows = []
    for rid, g in wk.groupby("region_id"):
        m = year_matrix(g)
        m = m.loc[m.index.isin(years)]
        if m.empty:
            continue
        v = m.to_numpy(dtype=float)
        q = np.percentile(v, [10, 75, 90], axis=0)
        rows.append(pd.DataFrame({"region_id": rid, "woy": np.arange(52), "clim_mean": v.mean(axis=0),
                                  "clim_p10": q[0], "clim_p75": q[1], "clim_p90": q[2]}))
    return pd.concat(rows, ignore_index=True)


def build_panel(series: pd.DataFrame, weather: pd.DataFrame, regions: pd.DataFrame,
                clim_years: list[int] | None = None, ndvi: pd.DataFrame | None = None,
                elevation: pd.Series | None = None, clim: pd.DataFrame | None = None,
                norms: pd.DataFrame | None = None) -> pd.DataFrame:
    """Daily feature panel + labels for every leaf region.

    ``clim`` (from :func:`weekly_clim`) and ``norms`` (from :func:`weather_norms`)
    let a short recent ``series`` reuse baselines computed on the full record, so
    the daily refresh builds the same features as the full pipeline.
    """
    s = series.sort_values(["region_id", "date"]).reset_index(drop=True)
    if clim_years is None:
        days_per_year = s.drop_duplicates("date")["date"].dt.year.value_counts()
        clim_years = sorted(int(y) for y, n in days_per_year.items() if n >= 360)
    years = clim_years
    if clim is None:
        clim = weekly_clim(s, years)
    rid = s["region_id"]
    v = s["value"]
    p = s[["region_id", "date"]].copy()
    p["value"] = v
    p["lag7"] = _grp_roll(v, rid, 7)
    p["lag14"] = _grp_roll(v, rid, 14)
    p["lag30"] = _grp_roll(v, rid, 30)
    p["lag90"] = _grp_roll(v, rid, 90)
    fired = s["date"].where(v > 0)
    last_fire = fired.groupby(rid).ffill()
    p["days_since_fire"] = (s["date"] - last_fire).dt.days.fillna(365).clip(upper=365)

    doy = s["date"].dt.day_of_year
    p["woy"] = np.minimum((doy - 1) // 7, 51)
    nxt = np.minimum((doy + 3) // 7, 51)  # calendar week of the middle of the next 7 days
    cl = clim.set_index(["region_id", "woy"])
    look = lambda col, w: cl[col].reindex(pd.MultiIndex.from_arrays([rid, w])).to_numpy()  # noqa: E731
    p["clim_next7"] = look("clim_mean", nxt)
    p["clim_p75_next7"] = look("clim_p75", nxt)
    p["clim_this7"] = look("clim_mean", p["woy"])
    p["clim_next30"] = sum(look("clim_mean", np.minimum(nxt + k, 51)) for k in range(4)) / 4 * 30 / 7
    p["clim_30_back"] = sum(look("clim_mean", np.maximum(p["woy"] - k, 0)) for k in range(4)) / 4 * 30 / 7
    p["anom7"] = (p["lag7"] + 1) / (p["clim_this7"] + 1)
    p["anom30"] = (p["lag30"] + 1) / (p["clim_30_back"] + 1)

    year = s["date"].dt.year
    ytd = v.groupby([rid, year]).cumsum()
    clim_cum = clim.sort_values(["region_id", "woy"]).assign(
        cum=lambda c: c.groupby("region_id")["clim_mean"].cumsum()).set_index(["region_id", "woy"])["cum"]
    clim_ytd = clim_cum.reindex(pd.MultiIndex.from_arrays([rid, p["woy"]])).to_numpy()
    p["ytd_ratio"] = (ytd + 1) / (clim_ytd + 1)

    # Outlook climatology: next 13 calendar weeks.
    wk13 = [np.minimum(nxt + k, 51) for k in range(OUTLOOK_WEEKS)]
    p["clim_next13w"] = sum(look("clim_mean", w) for w in wk13)
    p["clim_p10_13w"] = sum(look("clim_p10", w) for w in wk13)
    p["clim_p90_13w"] = sum(look("clim_p90", w) for w in wk13)

    w = weather.copy()
    w["date"] = pd.to_datetime(w["date"])
    w = w.sort_values(["region_id", "date"])
    p = p.merge(w[["region_id", "date", "tmax", "rh", "wind", "precip", "vpd", "days_since_rain", "precip_30d"]],
                on=["region_id", "date"], how="left")
    p = p.sort_values(["region_id", "date"]).reset_index(drop=True)
    g = p["region_id"]
    for col, n, name in (("tmax", 7, "tmax_7d"), ("rh", 7, "rh_7d"), ("wind", 7, "wind_7d"), ("vpd", 7, "vpd_7d")):
        p[name] = _grp_roll(p[col], g, n, "mean")
    p["precip_7d"] = _grp_roll(p["precip"], g, 7)
    rolled = _weather_rolls(p)
    if norms is None:
        norms = weather_norms(p)
    nm = norms.set_index(["region_id", "doy"]).reindex(
        pd.MultiIndex.from_arrays([g, p["date"].dt.day_of_year]))
    p["precip_90d_anom"] = rolled["precip_90"].to_numpy() - nm["precip_90"].to_numpy()
    p["tmax_30d_anom"] = rolled["tmax_30"].to_numpy() - nm["tmax_30"].to_numpy()
    p["fc_tmax"] = _fwd(p["tmax"], g, HORIZON, "mean")
    p["fc_rh_min"] = _fwd(p["rh"], g, HORIZON, "min")
    p["fc_wind_max"] = _fwd(p["wind"], g, HORIZON, "max")
    p["fc_precip"] = _fwd(p["precip"], g, HORIZON, "sum")
    p["fc_vpd_max"] = _fwd(p["vpd"], g, HORIZON, "max")
    p["fc_dry_days"] = _fwd((p["precip"] < 1).astype(float), g, HORIZON, "sum")

    if ndvi is not None:
        nd = ndvi[["region_id", "date", "ndvi"]].assign(date=lambda d: pd.to_datetime(d["date"]))
        p = p.merge(nd, on=["region_id", "date"], how="left")
        p["ndvi"] = p.groupby("region_id")["ndvi"].transform(lambda x: x.interpolate(limit_direction="both"))
    else:
        p["ndvi"] = np.nan
    ang = 2 * np.pi * p["date"].dt.day_of_year / 365.25
    p["doy_sin"], p["doy_cos"] = np.sin(ang), np.cos(ang)
    reg = regions.set_index("region_id")
    p["log_area"] = np.log1p(p["region_id"].map(reg["area_km2"]))
    p["lat"] = p["region_id"].map(reg["lat"])
    p["lon"] = p["region_id"].map(reg["lon"])
    p["elevation"] = p["region_id"].map(elevation) if elevation is not None else np.nan

    # Labels
    cs = p.groupby("region_id")["value"].cumsum()
    # differences of running sums: rounding can leave a zero week at -1e-12
    p["target_sum7"] = (cs.groupby(p["region_id"]).shift(-HORIZON) - cs).clip(lower=0)
    p["threshold7"] = np.maximum(p["clim_p75_next7"], 1.0)
    p["target_event"] = (p["target_sum7"] > p["threshold7"]).astype(float).where(p["target_sum7"].notna())
    cs_wk = cs.groupby(p["region_id"]).shift(-OUTLOOK_WEEKS * 7)
    p["target_sum13w"] = (cs_wk - cs).clip(lower=0)
    return p


def _weather_rolls(w: pd.DataFrame) -> pd.DataFrame:
    """90-day precipitation sum and 30-day mean tmax; ``w`` sorted by region and date."""
    g = w["region_id"]
    return pd.DataFrame({"precip_90": _grp_roll(w["precip"], g, 90),
                         "tmax_30": _grp_roll(w["tmax"], g, 30, "mean")}, index=w.index)


def weather_norms(w: pd.DataFrame, chunk: int = 60, fill: bool = False) -> pd.DataFrame:
    """Per region × day of year: mean 90-day precipitation and 30-day tmax, the
    baselines of the ``precip_90d_anom`` and ``tmax_30d_anom`` features.

    Worked out ``chunk`` regions at a time: on 25 years of daily weather for a
    big batch the whole-table version needed ~1 GB of temporary arrays, which
    pushed the daily refresh past its memory cap. ``fill`` interpolates missing
    days within each region first, as the full build's dryness step does."""
    rid = w["region_id"].to_numpy()
    day = pd.to_datetime(w["date"]).to_numpy().astype("datetime64[D]").astype(np.int64)
    if len(w) > 1 and not np.all((np.diff(rid) > 0) | ((np.diff(rid) == 0) & (np.diff(day) > 0))):
        w = w.sort_values(["region_id", "date"])
        rid = w["region_id"].to_numpy()
    starts = np.r_[0, np.flatnonzero(rid[1:] != rid[:-1]) + 1, len(rid)]
    out = []
    for k in range(0, len(starts) - 1, chunk):
        part = w.iloc[starts[k]: starts[min(k + chunk, len(starts) - 1)]]
        if fill and part[["precip", "tmax"]].isna().any().any():
            part = part.assign(**{c: part.groupby("region_id")[c].transform(
                lambda x: x.interpolate(limit_direction="both")) for c in ("precip", "tmax")})
        pid = part["region_id"].to_numpy()
        p_sum, p_n = _block_roll(part["precip"].to_numpy(float), pid, 90)
        t_sum, t_n = _block_roll(part["tmax"].to_numpy(float), pid, 30)
        with np.errstate(invalid="ignore", divide="ignore"):
            r = pd.DataFrame({"region_id": pid, "doy": pd.to_datetime(part["date"]).dt.day_of_year.to_numpy(),
                              "precip_90": np.where(p_n > 0, p_sum, np.nan),
                              "tmax_30": np.where(t_n > 0, t_sum / t_n, np.nan)})
        out.append(r.groupby(["region_id", "doy"], as_index=False)[["precip_90", "tmax_30"]].mean())
    if not out:
        return pd.DataFrame(columns=["region_id", "doy", "precip_90", "tmax_30"])
    return pd.concat(out, ignore_index=True)


def _block_roll(x: np.ndarray, keys: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    """Trailing ``window`` sum and count of non-NaN values within runs of equal
    ``keys``, a grouped ``rolling(window, min_periods=1)`` without its memory cost."""
    start = np.r_[0, np.flatnonzero(keys[1:] != keys[:-1]) + 1]
    pos = np.arange(keys.size) - np.repeat(start, np.diff(np.r_[start, keys.size]))
    ok = ~np.isnan(x)
    cs = np.r_[0.0, np.cumsum(np.where(ok, x, 0.0))]
    cn = np.r_[0, np.cumsum(ok)]
    i = np.arange(x.size) + 1
    j = i - np.minimum(pos + 1, window)
    return cs[i] - cs[j], cn[i] - cn[j]
