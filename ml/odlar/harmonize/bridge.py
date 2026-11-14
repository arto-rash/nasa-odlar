"""Keep the record on the Suomi NPP scale after Suomi NPP stopped.

The harmonized record is on the VIIRS S-NPP scale: MODIS years are mapped onto
it, and from 2012 S-NPP itself is the record. S-NPP's fire data stopped in
November 2026 (2 Nov was its last, partial day; nothing from 3 Nov on), while
NOAA-20 (J1) and NOAA-21 (J2) carry on. For the days S-NPP is missing, the
record continues as ``ratio × J1``, where the ratio is learnt per region and
season from the weeks S-NPP and NOAA-20 flew together, shrunk toward the
country's and then the batch's ratio where a region has few fires (the same
borrowing the MODIS correction uses).

Uncertainty per week: the S-NPP-equivalent count scatters around ``ratio × J``
like an overdispersed Poisson count (the extra spread is measured per batch), plus the error of the ratio itself, which is shared by every day
of the week (so its part adds up before squaring).

Why NOAA-20 alone: it is complete in our record since 2018 and its ratio to
S-NPP has stayed between 0.90 and 1.04 every quarter. NOAA-21 is only partly
in the archive before 2026 (FIRMS' yearly country files leave it out), so a
ratio learnt on J1 + J2 doubled the count once 2026 had NOAA-21 in full.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from odlar.config import ARTIFACTS_DIR, SEASONS

# S-NPP's last, partial day: from here on the record is bridged.
SNPP_OUT_FROM = date(2026, 11, 2)
# The ratio is learnt on the two years before the outage (recent behaviour of
# both instruments); NOAA-20 is the predictor (see above).
FIT_START = pd.Timestamp("2024-11-04")
PREDICTOR = "viirs_j1"
PRIOR = 50.0  # strength of the borrowed ratio, in NOAA-20 detections
Z80 = 1.2816  # half-width of an 80 % range in standard deviations
FALLBACK_RATIO = 1.0  # S-NPP / NOAA-20 when a whole batch never saw a fire
# The ratio also drifts slowly (0.90-1.04 by quarter worldwide, more per region):
# this relative spread is added to its error. Tuned on the 2025-26 back-test.
RATIO_DRIFT = 0.15
STATUS_FILE = ARTIFACTS_DIR / "satellites.json"
METHOD = "viirs_bridge"


def season_of_day(d: pd.Series) -> pd.Series:
    return pd.to_datetime(d).dt.month.map(SEASONS)


def season_of_week(w: pd.Series) -> pd.Series:
    return (pd.to_datetime(w) + pd.Timedelta(days=3)).dt.month.map(SEASONS)


# --- when S-NPP is missing ----------------------------------------------------------

def window(status_file: Path = STATUS_FILE) -> tuple[pd.Timestamp, pd.Timestamp | None]:
    """``[start, stop)`` of the days to bridge; ``stop`` is None while S-NPP is still out."""
    st = read_status(status_file)
    start = pd.Timestamp(st.get("out_from") or SNPP_OUT_FROM)
    stop = pd.Timestamp(st["back_from"]) if st.get("back_from") else None
    return start, stop


def read_status(path: Path = STATUS_FILE) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def update_status(snpp_dates: list[date], today: date, path: Path = STATUS_FILE, min_gap: int = 3) -> dict:
    """Record S-NPP's state from the dates in FIRMS' global S-NPP 7-day file.

    Out: no data for ``min_gap`` days or more; the last day it did send counts as
    bridged too (it is usually cut short). Back: it sends again after an outage.
    """
    st = read_status(path)
    st.setdefault("out_from", SNPP_OUT_FROM.isoformat())
    last = max(snpp_dates) if snpp_dates else None
    out_from = date.fromisoformat(st["out_from"]) if st.get("out_from") else None
    if last is None or (today - last).days >= min_gap:
        if out_from is None or st.get("back_from"):
            # a new outage after a return
            st["out_from"] = (last or today - timedelta(days=min_gap)).isoformat()
            st.pop("back_from", None)
    elif out_from is not None and not st.get("back_from"):
        back = min((d for d in snpp_dates if d > out_from), default=None)
        if back is not None:
            st["back_from"] = back.isoformat()
    st["snpp_last_seen"] = last.isoformat() if last else st.get("snpp_last_seen")
    st["checked"] = today.isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.part")
    tmp.write_text(json.dumps(st, indent=1))
    tmp.replace(path)
    return st


# --- the ratio ----------------------------------------------------------------------

def leaf_ids(regions: pd.DataFrame) -> pd.Index:
    return pd.Index(regions.loc[~regions["region_id"].isin(regions["parent_id"].dropna()), "region_id"])


def fit_ratios(weekly: pd.DataFrame, regions: pd.DataFrame, until: pd.Timestamp,
               start: pd.Timestamp = FIT_START, prior: float = PRIOR) -> pd.DataFrame:
    """S-NPP per NOAA-20 detection for every region and season, from weeks in
    ``[start, until)``. Columns: region_id, season, ratio, ratio_var."""
    w = weekly[(weekly["week"] >= start) & (weekly["week"] < until)]
    w = w.assign(season=season_of_week(w["week"]), n=w["viirs_n"].astype(float),
                 j=w[PREDICTOR].astype(float))
    by_region = w.groupby(["region_id", "season"])[["n", "j"]].sum().reset_index()
    country = regions.set_index("region_id")["country"]
    by_region["country"] = by_region["region_id"].map(country)
    leaves = by_region[by_region["region_id"].isin(leaf_ids(regions))]

    tot = leaves[["n", "j"]].sum()
    overall = tot["n"] / tot["j"] if tot["j"] > 0 else FALLBACK_RATIO
    batch = leaves.groupby("season")[["n", "j"]].sum()
    r_batch = ((batch["n"] + prior * overall) / (batch["j"] + prior)).rename("r_batch")
    ctry = leaves.groupby(["country", "season"])[["n", "j"]].sum().reset_index()
    ctry = ctry.join(r_batch, on="season")
    ctry["r_country"] = (ctry["n"] + prior * ctry["r_batch"]) / (ctry["j"] + prior)

    # every region and season, including those with no fires in the overlap
    regions_ids = pd.Index(regions["region_id"])
    seasons = sorted(set(SEASONS.values()))
    grid = pd.MultiIndex.from_product([regions_ids, seasons], names=["region_id", "season"]).to_frame(index=False)
    out = grid.merge(by_region[["region_id", "season", "n", "j"]], on=["region_id", "season"], how="left").fillna(
        {"n": 0.0, "j": 0.0})
    out["country"] = out["region_id"].map(country)
    out = out.merge(ctry[["country", "season", "r_country"]], on=["country", "season"], how="left")
    out = out.join(r_batch, on="season")
    prior_r = out["r_country"].fillna(out["r_batch"]).fillna(overall)
    out["ratio"] = (out["n"] + prior * prior_r) / (out["j"] + prior)
    # Poisson error of both counts, with the prior counted as data
    out["ratio_var"] = out["ratio"] ** 2 * (1 / (out["n"] + prior * prior_r) + 1 / (out["j"] + prior) + RATIO_DRIFT ** 2)
    out["phi"] = overdispersion(w[w["region_id"].isin(leaf_ids(regions))], out)
    return out[["region_id", "season", "ratio", "ratio_var", "phi"]]


def overdispersion(w: pd.DataFrame, ratios: pd.DataFrame) -> float:
    """How much more weekly S-NPP counts scatter around ``ratio × NOAA-20`` than
    Poisson counts would (fires come in clusters, and the two satellites pass at
    different times). At least 1; measured on the overlap weeks of this batch."""
    m = w.merge(ratios[["region_id", "season", "ratio"]], on=["region_id", "season"])
    pred = m["ratio"] * m["j"]
    seen = pred > 0
    if seen.sum() < 20:
        return 1.0
    phi = float(((m.loc[seen, "n"] - pred[seen]) ** 2).sum() / pred[seen].sum())
    return max(1.0, phi)


# --- applying it ----------------------------------------------------------------------

BRIDGE_COLS = ["snpp_eq", "b_pois", "b_allow", "b_rsd", "bridged"]


def apply_daily(daily: pd.DataFrame, ratios: pd.DataFrame, start: pd.Timestamp,
                stop: pd.Timestamp | None = None) -> pd.DataFrame:
    """Adds ``snpp_eq`` (the S-NPP-scale count: S-NPP itself, or the bridge on the
    days it is missing) and the pieces of the bridge's uncertainty: count scatter
    (``b_pois``), an allowance for a fire NOAA-20 missed (``b_allow``) and the
    ratio's own error (``b_rsd``, a standard deviation shared by the week)."""
    d = daily.drop(columns=[c for c in BRIDGE_COLS if c in daily.columns])
    dates = pd.to_datetime(d["date"])
    on = (dates >= start) & ((dates < stop) if stop is not None else True)
    on = np.asarray(on, dtype=bool)
    d["snpp_eq"] = d["viirs_n"].astype(float)
    for c in ("b_pois", "b_allow", "b_rsd"):
        d[c] = 0.0
    d["bridged"] = on.astype(np.int8)
    if on.any():
        r = d.loc[on, ["region_id"]].assign(season=season_of_day(d.loc[on, "date"]).to_numpy())
        r = r.merge(ratios, on=["region_id", "season"], how="left")
        ratio = r["ratio"].fillna(FALLBACK_RATIO).to_numpy()
        rsd = np.sqrt(r["ratio_var"].fillna(0.0).to_numpy())
        phi = r["phi"].fillna(1.0).to_numpy()
        j = d.loc[on, PREDICTOR].to_numpy(dtype=float)
        d.loc[on, "snpp_eq"] = ratio * j
        d.loc[on, "b_pois"] = phi * ratio * j
        # 1/7 a day (one fire a week): a week NOAA-20 saw nothing in can still hold
        # a fire S-NPP would have seen
        d.loc[on, "b_allow"] = phi * ratio / 7
        d.loc[on, "b_rsd"] = rsd * j
    return d


def weekly_sums(daily: pd.DataFrame) -> pd.DataFrame:
    """Per region-week: the S-NPP-scale count and its bridge uncertainty parts."""
    d = daily[["region_id", "date", *BRIDGE_COLS]].copy()
    dt = pd.to_datetime(d["date"])
    d["week"] = (dt - pd.to_timedelta(dt.dt.day_of_week, unit="D")).dt.normalize()
    return d.groupby(["region_id", "week"], as_index=False)[BRIDGE_COLS].sum()


def apply_weekly(hw: pd.DataFrame, sums: pd.DataFrame, regions: pd.DataFrame | None = None) -> pd.DataFrame:
    """Replaces harmonized, lo, hi and method on the weeks that contain bridged days.
    With ``regions``, rows of regions that have children (country totals) are
    rebuilt as the sum of their leaf regions for those weeks."""
    s = sums[sums["bridged"] > 0]
    if regions is not None:
        s = s[s["region_id"].isin(leaf_ids(regions))]  # parents are rebuilt from these
    if s.empty:
        return hw
    parts = s[["region_id", "week", "snpp_eq", "b_pois", "b_allow", "b_rsd"]]
    if regions is not None:
        parts = pd.concat([parts, _parent_parts(parts, regions)], ignore_index=True)
    sd = np.sqrt(parts["b_pois"] + parts["b_allow"] + parts["b_rsd"] ** 2)
    rep = pd.DataFrame({"region_id": parts["region_id"].to_numpy(), "week": parts["week"].to_numpy(),
                        "harmonized": parts["snpp_eq"].to_numpy(),
                        "lo": np.maximum(0.0, parts["snpp_eq"] - Z80 * sd).to_numpy(),
                        "hi": (parts["snpp_eq"] + Z80 * sd).to_numpy()})
    out = hw.copy()
    key = pd.MultiIndex.from_frame(out[["region_id", "week"]])
    rk = pd.MultiIndex.from_frame(rep[["region_id", "week"]])
    pos = key.get_indexer(rk)
    hit = pos >= 0
    idx = pos[hit]
    for col in ("harmonized", "lo", "hi"):
        out.loc[out.index[idx], col] = rep.loc[hit, col].to_numpy()
    out.loc[out.index[idx], "method"] = METHOD
    return out


_AGG = {"snpp_eq": "sum", "b_pois": "sum", "b_rsd": "sum", "b_allow": "max"}


def _parent_parts(parts: pd.DataFrame, regions: pd.DataFrame) -> pd.DataFrame:
    """Leaf parts summed up every parent: counts and scatter add up; the ratio
    error is added linearly (its regions share a country ratio); and a parent
    keeps one missed-fire allowance, not one per region."""
    parent = regions.set_index("region_id")["parent_id"]
    rows, cur = [], parts
    for _ in range(4):  # country > province > district at most
        cur = cur.assign(region_id=cur["region_id"].map(parent)).dropna(subset=["region_id"])
        if cur.empty:
            break
        cur = cur.astype({"region_id": int}).groupby(["region_id", "week"], as_index=False).agg(_AGG)
        rows.append(cur)
    if not rows:
        return parts.iloc[:0]
    # a parent reached by leaves at different depths: add the parts up
    return pd.concat(rows, ignore_index=True).groupby(["region_id", "week"], as_index=False).agg(_AGG)


def week_of(day: pd.Timestamp) -> pd.Timestamp:
    """The Monday of ``day``'s week."""
    day = pd.Timestamp(day)
    return (day - pd.Timedelta(days=day.dayofweek)).normalize()
