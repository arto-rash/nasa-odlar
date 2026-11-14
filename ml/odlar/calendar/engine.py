"""Burning-activity calendar: climatology, fire seasons, critical periods, anomalies.

Every function works on a region's harmonized weekly series (VIIRS S-NPP scale),
so the 25-year record is consistent and pre-2012 years are not artificially quiet.

Fire seasons in the South Caucasus can straddle the new year in some places, so
season timing is computed on a *circular* year that starts at the climatologically
quietest week.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from scipy.signal import find_peaks

N_WEEKS = 52
START_SHARE = 0.10
END_SHARE = 0.90
CRITICAL_PCTL = 75
ANOMALY_Z = 2.0
# An anomaly must also be material, not just statistically unusual.
MIN_RATIO = 1.5      # totals / peaks at least 1.5× (or at most 1/1.5×) the median year
MIN_SHIFT_WEEKS = 2  # season start/end moved by at least two weeks


def year_matrix(series: pd.DataFrame, value: str = "harmonized") -> pd.DataFrame:
    """Years × 52 calendar-week matrix (sum of weekly values in each bin)."""
    s = series.assign(year=pd.to_datetime(series["week"]).dt.year,
                      woy=np.minimum((pd.to_datetime(series["week"]).dt.day_of_year - 1) // 7, 51))
    m = s.pivot_table(index="year", columns="woy", values=value, aggfunc="sum", fill_value=0.0)
    return m.reindex(columns=range(N_WEEKS), fill_value=0.0)


def complete_years(series: pd.DataFrame) -> list[int]:
    s = pd.to_datetime(series["week"])
    counts = s.dt.year.value_counts()
    return sorted(int(y) for y, n in counts.items() if n >= 51)


def circular_smooth(v: np.ndarray, width: int = 3) -> np.ndarray:
    k = np.ones(width) / width
    pad = width // 2
    ext = np.concatenate([v[-pad:], v, v[:pad]]) if pad else v
    return np.convolve(ext, k, mode="valid")


@dataclass
class Climatology:
    mean: list[float]
    median: list[float]
    p10: list[float]
    p25: list[float]
    p75: list[float]
    p90: list[float]
    smooth: list[float]


def climatology(matrix: pd.DataFrame, years: list[int]) -> Climatology:
    m = matrix.loc[matrix.index.isin(years)].to_numpy(dtype=float)
    if m.size == 0:
        m = np.zeros((1, N_WEEKS))
    q = np.percentile(m, [10, 25, 50, 75, 90], axis=0)
    mean = m.mean(axis=0)
    r = lambda a: np.round(a, 3).tolist()  # noqa: E731
    return Climatology(mean=r(mean), median=r(q[2]), p10=r(q[0]), p25=r(q[1]), p75=r(q[3]),
                       p90=r(q[4]), smooth=r(circular_smooth(mean)))


def season_offset(smooth: np.ndarray) -> int:
    """Week where the circular fire year begins: the quietest 4-week stretch."""
    if smooth.sum() <= 0:
        return 0
    quiet = circular_smooth(smooth, 5)
    return int(np.argmin(quiet))


def _cum_week(values: np.ndarray, offset: int, share: float) -> int | None:
    total = values.sum()
    if total <= 0:
        return None
    rolled = np.roll(values, -offset)
    idx = int(np.searchsorted(np.cumsum(rolled) / total, share))
    return (min(idx, N_WEEKS - 1) + offset) % N_WEEKS


@dataclass
class Peak:
    week: int
    value: float
    prominence: float
    share: float  # share of annual activity within ±3 weeks


@dataclass
class Window:
    start: int
    end: int
    weeks: int
    share: float


@dataclass
class SeasonProfile:
    offset: int
    start: int | None
    end: int | None
    length: int | None
    peak_week: int | None
    peaks: list[Peak]
    critical: list[Window]
    bimodal: bool
    annual_mean: float


def _circ_dist(a: int, b: int) -> int:
    d = abs(a - b) % N_WEEKS
    return min(d, N_WEEKS - d)


def season_profile(clim: Climatology) -> SeasonProfile:
    smooth = np.asarray(clim.smooth)
    mean = np.asarray(clim.mean)
    total = float(mean.sum())
    off = season_offset(smooth)
    start = _cum_week(mean, off, START_SHARE)
    end = _cum_week(mean, off, END_SHARE)
    length = ((end - start) % N_WEEKS + 1) if start is not None and end is not None else None

    peaks: list[Peak] = []
    if total > 0:
        ext = np.concatenate([smooth, smooth, smooth])
        idx, props = find_peaks(ext, prominence=0.12 * smooth.max(), distance=4)
        seen = set()
        for i, prom in zip(idx, props["prominences"], strict=True):
            w = int(i % N_WEEKS)
            if N_WEEKS <= i < 2 * N_WEEKS and w not in seen:
                seen.add(w)
                near = [(w + d) % N_WEEKS for d in range(-3, 4)]
                peaks.append(Peak(week=w, value=round(float(smooth[w]), 3), prominence=round(float(prom), 3),
                                  share=round(float(mean[near].sum() / total), 3)))
        peaks.sort(key=lambda p: -p.value)

    critical: list[Window] = []
    if total > 0:
        thr = np.percentile(smooth, CRITICAL_PCTL)
        hot = smooth >= thr
        rolled = np.roll(hot, -off)
        i = 0
        while i < N_WEEKS:
            if rolled[i]:
                j = i
                while j + 1 < N_WEEKS and rolled[j + 1]:
                    j += 1
                weeks = [(k + off) % N_WEEKS for k in range(i, j + 1)]
                critical.append(Window(start=weeks[0], end=weeks[-1], weeks=len(weeks),
                                       share=round(float(mean[weeks].sum() / total), 3)))
                i = j + 1
            else:
                i += 1
        critical = [c for c in critical if c.weeks >= 2 or c.share >= 0.05]
        critical.sort(key=lambda c: -c.share)

    major = [p for p in peaks if p.value >= 0.35 * (peaks[0].value if peaks else 1)]
    bimodal = len(major) >= 2 and any(_circ_dist(a.week, b.week) >= 8 for a in major for b in major)
    return SeasonProfile(offset=off, start=start, end=end, length=length,
                         peak_week=peaks[0].week if peaks else None, peaks=peaks, critical=critical,
                         bimodal=bimodal, annual_mean=round(total, 2))


def year_metrics(matrix: pd.DataFrame, offset: int) -> pd.DataFrame:
    rows = []
    for year, row in matrix.iterrows():
        v = row.to_numpy(dtype=float)
        sm = circular_smooth(v)
        rows.append({
            "year": int(year), "total": float(v.sum()), "peak_value": float(sm.max()),
            "peak_week": int(np.argmax(sm)) if v.sum() > 0 else None,
            "start": _cum_week(v, offset, START_SHARE), "end": _cum_week(v, offset, END_SHARE),
        })
    return pd.DataFrame(rows)


def _shift(weeks: pd.Series, offset: int) -> pd.Series:
    """Position within the circular fire year, so shifts are comparable."""
    return (weeks - offset) % N_WEEKS


def anomalies(metrics: pd.DataFrame, offset: int, years: list[int]) -> pd.DataFrame:
    """Robust (median/MAD) anomaly scores and human-readable reason codes per year."""
    m = metrics.copy()
    base = m[m["year"].isin(years)]
    if base.empty:
        return m.assign(z_total=0.0, z_peak=0.0, z_start=0.0, z_end=0.0, anomalous=False, reasons=[[]] * len(m))
    med_total = base["total"].median()
    med_peak = base["peak_value"].median()
    st = _shift(m["start"].astype(float), offset)
    en = _shift(m["end"].astype(float), offset)
    bst, ben = st[m["year"].isin(years)], en[m["year"].isin(years)]

    def z_against(values: pd.Series, ref: pd.Series) -> pd.Series:
        med = ref.median()
        mad = (ref - med).abs().median() * 1.4826
        if not np.isfinite(mad) or mad == 0:
            mad = max(ref.std(ddof=0), 1e-6)
        return (values - med) / mad

    m["z_total"] = z_against(np.log1p(m["total"]), np.log1p(base["total"]))
    m["z_peak"] = z_against(np.log1p(m["peak_value"]), np.log1p(base["peak_value"]))
    m["z_start"] = z_against(st, bst)
    m["z_end"] = z_against(en, ben)
    m["ratio_total"] = m["total"] / med_total if med_total > 0 else np.nan
    m["ratio_peak"] = m["peak_value"] / med_peak if med_peak > 0 else np.nan
    m["start_shift"] = st - bst.median()
    m["end_shift"] = en - ben.median()

    reasons = []
    for r in m.itertuples():
        codes = []
        rt, rp = float(r.ratio_total), float(r.ratio_peak)
        if r.z_total >= ANOMALY_Z and rt >= MIN_RATIO:
            codes.append({"code": "high_total", "value": round(rt, 2)})
        elif r.z_total <= -ANOMALY_Z and rt <= 1 / MIN_RATIO:
            codes.append({"code": "low_total", "value": round(rt, 2)})
        if r.z_peak >= ANOMALY_Z and rp >= MIN_RATIO:
            codes.append({"code": "intense_peak", "value": round(rp, 2)})
        if pd.notna(r.z_start) and abs(r.start_shift) >= MIN_SHIFT_WEEKS:
            if r.z_start <= -ANOMALY_Z:
                codes.append({"code": "early_start", "value": int(r.start_shift)})
            elif r.z_start >= ANOMALY_Z:
                codes.append({"code": "late_start", "value": int(r.start_shift)})
        if pd.notna(r.z_end) and abs(r.end_shift) >= MIN_SHIFT_WEEKS:
            if r.z_end >= ANOMALY_Z:
                codes.append({"code": "late_end", "value": int(r.end_shift)})
            elif r.z_end <= -ANOMALY_Z:
                codes.append({"code": "early_end", "value": int(r.end_shift)})
        reasons.append(codes)
    m["reasons"] = reasons
    # Timing alone in a near-empty year is noise; require some activity.
    m["anomalous"] = [bool(c) and (t >= 0.15 * med_total) for c, t in zip(reasons, m["total"], strict=True)]
    return m


def current_status(series: pd.DataFrame, matrix: pd.DataFrame, years: list[int],
                   as_of: pd.Timestamp | None = None) -> dict:
    """Where the latest week and year-to-date sit against the full record."""
    s = series.assign(week=pd.to_datetime(series["week"])).sort_values("week")
    if s.empty:
        return {}
    as_of = as_of or s["week"].max()
    cur_year = as_of.year
    woy = int(min((as_of.day_of_year - 1) // 7, 51))
    week_val = float(s.loc[s["week"] == as_of, "harmonized"].sum())
    hist = matrix.loc[matrix.index.isin([y for y in years if y != cur_year])]
    week_hist = hist[woy].to_numpy(dtype=float) if woy in hist else np.array([])
    ytd_hist = hist.loc[:, :woy].sum(axis=1).to_numpy(dtype=float)
    ytd = float(matrix.loc[cur_year, :woy].sum()) if cur_year in matrix.index else 0.0
    pct = lambda v, ref: float((ref < v).mean() * 100 + (ref == v).mean() * 50) if ref.size else None  # noqa: E731
    rank = int((ytd_hist > ytd).sum() + 1) if ytd_hist.size else None
    return {
        "as_of": as_of.date().isoformat(), "year": cur_year, "woy": woy,
        "week_value": round(week_val, 2), "week_percentile": pct(week_val, week_hist),
        "week_median": float(np.median(week_hist)) if week_hist.size else None,
        "ytd": round(ytd, 2), "ytd_percentile": pct(ytd, ytd_hist),
        "ytd_median": float(np.median(ytd_hist)) if ytd_hist.size else None,
        "ytd_rank": rank, "n_years": int(ytd_hist.size),
    }


def build_calendar(series: pd.DataFrame, raw: pd.DataFrame | None = None) -> dict:
    """Full calendar payload for one region (harmonized + optional raw matrices)."""
    matrix = year_matrix(series)
    years = complete_years(series)
    clim = climatology(matrix, years)
    profile = season_profile(clim)
    metrics = year_metrics(matrix, profile.offset)
    anom = anomalies(metrics, profile.offset, years)
    out = {
        "years": [int(y) for y in matrix.index],
        "matrix": np.round(matrix.to_numpy(dtype=float), 2).tolist(),
        "climatology": asdict(clim),
        "season": asdict(profile),
        "year_metrics": _records(anom.drop(columns=["reasons"])),
        "anomalies": [
            {"year": int(r.year), "total": round(float(r.total), 1), "z_total": round(float(r.z_total), 2),
             "reasons": r.reasons}
            for r in anom.itertuples() if r.anomalous
        ],
        "current": current_status(series, matrix, years),
    }
    if raw is not None:
        out["raw_matrix"] = np.round(year_matrix(raw, "value").reindex(matrix.index, fill_value=0)
                                     .to_numpy(dtype=float), 2).tolist()
    return out


def _records(df: pd.DataFrame) -> list[dict]:
    clean = df.replace([np.inf, -np.inf], np.nan).astype(object).where(df.notna(), None)
    recs = clean.to_dict(orient="records")
    for r in recs:
        for k, v in r.items():
            if isinstance(v, float):
                r[k] = round(v, 3)
            elif isinstance(v, np.generic):
                r[k] = v.item()
    return recs
