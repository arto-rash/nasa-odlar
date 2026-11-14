"""MODIS → VIIRS S-NPP harmonization with a predictive bootstrap.

For every leaf region and season the 2012+ overlap provides paired weekly counts
``(x = MODIS, y = VIIRS S-NPP)``. The calibrated value for a pre-2012 week is

* ``x > 0``: the quantile-mapped value ``T(x)`` (region × season, falling back to
  the pooled country × season map when a region has too few fire weeks);
* ``x = 0``: ``P(y > 0 | x = 0, context) · E[y | y > 0, x = 0]`` from a logistic
  zero-inflation model. MODIS often misses every small fire in a quiet week; the
  model estimates how much VIIRS-scale activity such a week typically holds,
  using the season and how active neighbouring weeks and the country were.

Uncertainty is a *predictive* block bootstrap: overlap years are resampled with
replacement, all maps are refitted, and each replicate draws observation noise
(multiplicative residuals for ``x > 0``, a Bernoulli × empirical-magnitude draw
for ``x = 0``). Sums of replicate draws give honest intervals for any aggregate
(annual totals, seasons, countries), not just single weeks.

The output is a statistical estimate of activity on the VIIRS scale. It does not
recover individual fires that MODIS never detected.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression

from odlar.config import OVERLAP_START, SEASONS
from odlar.harmonize.quantile_map import QuantileMap

MIN_FIRE_WEEKS = 12
MIN_ZERO_POSITIVES = 8
RESID_BINS = np.array([0.5, 1.5, 2.5, 4.5, 8.5, 16.5, 32.5, np.inf])
# Finer bins for the conditional bias correction: E[y | x] is what transfers across
# eras (detection physics is stable), while the quantile map alone depends on how
# active the overlap years happened to be.
CORR_BINS = np.array([0.5, 1.5, 2.5, 3.5, 4.5, 6.5, 9.5, 14.5, 22.5, 32.5, 50.5, 80.5, np.inf])
AQUA_START = pd.Timestamp("2002-07-08")


def season_of(weeks: pd.Series) -> pd.Series:
    mid = pd.to_datetime(weeks) + pd.Timedelta(days=3)
    return mid.dt.month.map(SEASONS)


def add_context(weekly: pd.DataFrame, regions: pd.DataFrame, x_col: str) -> pd.DataFrame:
    """Neighbour-week and country activity used by the zero-inflation model."""
    w = weekly.sort_values(["region_id", "week"]).copy()
    w["x"] = w[x_col].astype(float)
    g = w.groupby("region_id")["x"]
    w["x_prev"] = g.shift(1).fillna(0)
    w["x_next"] = g.shift(-1).fillna(0)
    w["x_4wk"] = g.transform(lambda s: s.rolling(9, center=True, min_periods=1).sum()) - w["x"]
    parent = regions.set_index("region_id")["parent_id"]
    w["country_id"] = w["region_id"].map(parent)
    country_x = w.groupby(["country_id", "week"])["x"].sum().rename("x_country")
    w = w.join(country_x, on=["country_id", "week"])
    w["season"] = season_of(w["week"])
    return w


def zero_features(df: pd.DataFrame) -> np.ndarray:
    ang = 2 * np.pi * df["woy"].to_numpy() / 52.0
    return np.column_stack([
        np.sin(ang), np.cos(ang), np.sin(2 * ang), np.cos(2 * ang),
        np.log1p(df["x_prev"]), np.log1p(df["x_next"]), np.log1p(df["x_4wk"]),
        np.log1p(df["x_country"] - df["x"]),
    ])


@dataclass
class ZeroModel:
    clf: LogisticRegression | None = None
    base_rate: float = 0.0
    magnitudes: np.ndarray = field(default_factory=lambda: np.array([1.0]))

    def fit(self, rows: pd.DataFrame) -> ZeroModel:
        target = (rows["y"].to_numpy() > 0).astype(int)
        self.base_rate = float(target.mean()) if target.size else 0.0
        pos = rows.loc[target == 1, "y"].to_numpy(dtype=float)
        self.magnitudes = pos if pos.size else np.array([1.0])
        if 0 < target.sum() < target.size:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", ConvergenceWarning)
                self.clf = LogisticRegression(C=1.0, max_iter=300).fit(zero_features(rows), target)
        else:
            self.clf = None
        return self

    def prob(self, rows: pd.DataFrame) -> np.ndarray:
        if self.clf is None:
            return np.full(len(rows), self.base_rate)
        return self.clf.predict_proba(zero_features(rows))[:, 1]

    def expected(self, rows: pd.DataFrame) -> np.ndarray:
        return self.prob(rows) * float(self.magnitudes.mean())


@dataclass
class FittedMaps:
    qmaps: dict[tuple[int, str], QuantileMap]
    zero: dict[int, ZeroModel]
    resid: dict[tuple[int, str], list[np.ndarray]]  # (country, season) -> residual log-ratios per x-bin
    source: dict[tuple[int, str], str]  # (region, season) -> "region" | "country"
    year_sigma: dict[int, float] = field(default_factory=dict)  # country -> sd of annual log-ratio
    bin_corr: dict[tuple[int, str], np.ndarray] = field(default_factory=dict)  # (country, season) -> factor per x-bin


def _fit_maps(train: pd.DataFrame) -> FittedMaps:
    qmaps: dict[tuple[int, str], QuantileMap] = {}
    source: dict[tuple[int, str], str] = {}
    country_q: dict[tuple[int, str], QuantileMap] = {}
    # Two-part model: the quantile map is fitted on MODIS fire weeks only (x > 0);
    # weeks MODIS saw as empty are handled by the zero model. Fitting the map on all
    # weeks would hand fire weeks the upper tail of *all* VIIRS weeks and then count
    # the activity hidden in x = 0 weeks a second time.
    fire = train[train["x"] > 0]
    for (cid, season), grp in fire.groupby(["country_id", "season"]):
        country_q[(cid, season)] = QuantileMap().fit(grp["x"].to_numpy(), grp["y"].to_numpy())
    for (rid, season), grp in fire.groupby(["region_id", "season"]):
        cid = int(grp["country_id"].iloc[0])
        if (cid, season) not in country_q:
            continue
        if len(grp) >= MIN_FIRE_WEEKS:
            qmaps[(rid, season)] = QuantileMap().fit(grp["x"].to_numpy(), grp["y"].to_numpy())
            source[(rid, season)] = "region"
        else:
            qmaps[(rid, season)] = country_q[(cid, season)]
            source[(rid, season)] = "country"

    zeros = train[train["x"] == 0]
    country_zero = {cid: ZeroModel().fit(g) for cid, g in zeros.groupby("country_id")}
    zero: dict[int, ZeroModel] = {}
    for rid, grp in zeros.groupby("region_id"):
        if (grp["y"] > 0).sum() >= MIN_ZERO_POSITIVES:
            zero[rid] = ZeroModel().fit(grp)
        else:
            zero[rid] = country_zero[int(grp["country_id"].iloc[0])]

    # Conditional bias correction. Quantile mapping preserves the *distribution* of
    # weekly values, but with noisy pairs it under-maps small MODIS weeks (their
    # quantiles land on the low tail of VIIRS) and over-maps large ones. A factor per
    # MODIS-size bin, E[y | bin] / E[T(x) | bin], makes sums of weeks unbiased.
    pos = train[train["x"] > 0].copy()
    pos["t"] = _apply_qmaps(pos, qmaps)
    pos["cbin"] = np.digitize(pos["x"], CORR_BINS)
    pos["bin"] = np.digitize(pos["x"], RESID_BINS)
    pooled = {}
    for cid, grp in pos.groupby("country_id"):
        corr = np.ones(len(CORR_BINS) + 1)
        for b, g in grp.groupby("cbin"):
            if g["t"].sum() > 0:
                corr[b] = float(np.clip(g["y"].sum() / g["t"].sum(), 0.4, 2.5))
        pooled[cid] = corr
    bin_corr: dict[tuple[int, str], np.ndarray] = {}
    for (cid, season), grp in pos.groupby(["country_id", "season"]):
        corr = pooled[cid].copy()
        for b, g in grp.groupby("cbin"):
            if len(g) >= 8 and g["t"].sum() > 0:
                corr[b] = float(np.clip(g["y"].sum() / g["t"].sum(), 0.4, 2.5))
        bin_corr[(cid, season)] = corr
    pos["t"] = pos["t"] * _bin_factor(pos, bin_corr)

    resid: dict[tuple[int, str], list[np.ndarray]] = {}
    pos["lr"] = np.log((pos["y"] + 0.5) / (pos["t"] + 0.5))
    for (cid, season), grp in pos.groupby(["country_id", "season"]):
        # centre each bin so the draws are unbiased around the corrected point
        resid[(cid, season)] = [grp.loc[grp["bin"] == b, "lr"].to_numpy() for b in range(len(RESID_BINS) + 1)]
    maps = FittedMaps(qmaps=qmaps, zero=zero, resid=resid, source=source, bin_corr=bin_corr)
    maps.year_sigma = _year_sigma(train, maps)
    return maps


def _year_sigma(train: pd.DataFrame, maps: FittedMaps) -> dict[int, float]:
    """Spread of region-year totals around the mapping — the part of the error
    that is shared by all weeks of a year (season mix, fire-size regime) and so
    does not average out when weeks are summed."""
    t = train.reset_index(drop=True)
    est, _ = _point(t, maps)
    t = t.assign(est=est, yr=t["week"].dt.year)
    yr = t.groupby(["country_id", "region_id", "yr"])[["y", "est"]].sum()
    yr = yr[(yr["y"] >= 30) & (yr["est"] >= 10)]
    lr = np.log(yr["y"] / yr["est"])
    out: dict[int, float] = {}
    for cid, g in lr.groupby(level="country_id"):
        # within-year Poisson-like noise is already drawn week by week; remove it
        # from the observed spread so it is not double counted
        noise = (1.0 / yr.loc[g.index, "y"]).mean()
        out[int(cid)] = float(np.sqrt(max(g.var(ddof=1) - 0.5 * noise, 0.0))) if len(g) > 2 else 0.0
    return out


def _apply_qmaps(rows: pd.DataFrame, qmaps: dict[tuple[int, str], QuantileMap]) -> np.ndarray:
    out = np.zeros(len(rows))
    x = rows["x"].to_numpy()
    for key, pos in rows.groupby(["region_id", "season"]).indices.items():
        qm = qmaps.get(key)
        if qm is not None:
            out[pos] = qm.transform(x[pos])
    return out


def _bin_factor(rows: pd.DataFrame, bin_corr: dict[tuple[int, str], np.ndarray]) -> np.ndarray:
    out = np.ones(len(rows))
    bins = np.digitize(rows["x"].to_numpy(), CORR_BINS)
    for key, pos in rows.groupby(["country_id", "season"]).indices.items():
        corr = bin_corr.get(key)
        if corr is not None:
            out[pos] = corr[bins[pos]]
    return out


def _point(rows: pd.DataFrame, maps: FittedMaps) -> tuple[np.ndarray, np.ndarray]:
    """Point estimate and P(y>0) for zero weeks. ``rows`` must have a RangeIndex."""
    est = _apply_qmaps(rows, maps.qmaps) * _bin_factor(rows, maps.bin_corr)
    p0 = np.zeros(len(rows))
    zero_pos = np.flatnonzero(rows["x"].to_numpy() == 0)
    zrows = rows.iloc[zero_pos]
    for rid, sub in zrows.groupby("region_id").indices.items():
        zm = maps.zero.get(rid)
        if zm is None:
            continue
        pos = zero_pos[sub]
        part = rows.iloc[pos]
        p0[pos] = zm.prob(part)
        est[pos] = p0[pos] * float(zm.magnitudes.mean())
    return est, p0


def _draw(rows: pd.DataFrame, maps: FittedMaps, est: np.ndarray, p0: np.ndarray,
          rng: np.random.Generator) -> np.ndarray:
    out = np.zeros(len(rows))
    x = rows["x"].to_numpy()
    zero_pos = np.flatnonzero(x == 0)
    # zero weeks: Bernoulli(p) × empirical positive magnitude
    for rid, sub in rows.iloc[zero_pos].groupby("region_id").indices.items():
        pos = zero_pos[sub]
        zm = maps.zero.get(rid) or ZeroModel()
        hit = rng.random(pos.size) < p0[pos]
        out[pos] = np.where(hit, rng.choice(zm.magnitudes, pos.size), 0.0)
    # fire weeks: T(x) × residual drawn from the same x-size bin
    fire_pos = np.flatnonzero(x > 0)
    frows = rows.iloc[fire_pos].assign(bin=np.digitize(x[fire_pos], RESID_BINS))
    for (cid, season, b), sub in frows.groupby(["country_id", "season", "bin"]).indices.items():
        pos = fire_pos[sub]
        res = maps.resid.get((cid, season))
        if res is None:
            out[pos] = est[pos]
            continue
        pool = res[b] if res[b].size >= 5 else np.concatenate(res)
        noise = pool[rng.integers(pool.size, size=pos.size)] if pool.size else np.zeros(pos.size)
        out[pos] = np.maximum((est[pos] + 0.5) * np.exp(noise) - 0.5, 0.0)
    # shared year effect per region-year
    years = rows["week"].dt.year.to_numpy()
    for (cid, _rid, _y), pos in rows.groupby(["country_id", "region_id", years]).indices.items():
        sigma = maps.year_sigma.get(int(cid), 0.0)
        if sigma > 0:
            out[pos] *= np.exp(rng.normal(0, sigma) - sigma**2 / 2)
    return out


@dataclass
class HarmonizationResult:
    weekly: pd.DataFrame            # region_id, week, harmonized, lo, hi, method
    draws: dict[int, np.ndarray]    # region_id -> (n_weeks, B) predictive draws (pre-overlap weeks)
    draw_weeks: dict[int, np.ndarray]
    maps: FittedMaps | None
    transfer: pd.DataFrame          # region_id, season, source, q, modis, viirs (for plots)


def fit_predict(train: pd.DataFrame, target: pd.DataFrame, n_boot: int,
                rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, FittedMaps]:
    """Point estimates and (n_target, n_boot) predictive draws for ``target`` weeks."""
    target = target.reset_index(drop=True)
    maps = _fit_maps(train)
    est, _ = _point(target, maps)
    years = train["week"].dt.year.to_numpy()
    uniq = np.unique(years)
    by_year = {y: np.flatnonzero(years == y) for y in uniq}
    reps = np.empty((len(target), n_boot), dtype=np.float32)
    for b in range(n_boot):
        pick = rng.choice(uniq, uniq.size, replace=True)
        boot = train.iloc[np.concatenate([by_year[y] for y in pick])].reset_index(drop=True)
        maps_b = _fit_maps(boot)
        est_b, p0_b = _point(target, maps_b)
        reps[:, b] = _draw(target, maps_b, est_b, p0_b, rng)
    return est, reps, maps


def overlap_context(weekly: pd.DataFrame, regions: pd.DataFrame, x_col: str = "modis",
                    overlap_start: pd.Timestamp = pd.Timestamp(OVERLAP_START)) -> pd.DataFrame:
    leaf = weekly[weekly["region_id"].isin(regions.loc[regions.level != "country", "region_id"])]
    ctx = add_context(leaf, regions, x_col)
    ctx["y"] = ctx["viirs_n"].astype(float)
    return ctx[(ctx["week"] >= overlap_start) & _modis_alive(ctx)].reset_index(drop=True)


def harmonize(weekly: pd.DataFrame, regions: pd.DataFrame, n_boot: int = 200, seed: int = 0,
              overlap_start: pd.Timestamp = pd.Timestamp(OVERLAP_START)) -> HarmonizationResult:
    """Build the unified VIIRS-scale weekly record for every region."""
    rng = np.random.default_rng(seed)
    leaf_ids = regions.loc[regions.level != "country", "region_id"]
    leaf = weekly[weekly["region_id"].isin(leaf_ids)]

    parts, draws, draw_weeks = [], {}, {}
    final_maps: FittedMaps | None = None
    transfer_rows = []
    for era, x_col, era_mask in (
        ("terra", "modis_t", leaf["week"] < AQUA_START),
        ("terra_aqua", "modis", (leaf["week"] >= AQUA_START) & (leaf["week"] < overlap_start)),
    ):
        ctx = add_context(leaf, regions, x_col)
        ctx["y"] = ctx["viirs_n"].astype(float)
        train = ctx[(ctx["week"] >= overlap_start) & _modis_alive(ctx)].reset_index(drop=True)
        target = ctx[ctx["week"].isin(leaf.loc[era_mask, "week"].unique())].reset_index(drop=True)
        if target.empty or train.empty:
            continue
        est, reps, maps = fit_predict(train, target, n_boot, rng)

        out = target[["region_id", "week"]].copy()
        out["harmonized"] = est
        out["lo"] = np.percentile(reps, 5, axis=1)
        out["hi"] = np.percentile(reps, 95, axis=1)
        out["method"] = era
        parts.append(out)
        for rid, idx in target.groupby("region_id").groups.items():
            pos = target.index.get_indexer(idx)
            draws[rid] = np.vstack([draws[rid], reps[pos]]) if rid in draws else reps[pos]
            wk = target.loc[idx, "week"].to_numpy()
            draw_weeks[rid] = np.concatenate([draw_weeks[rid], wk]) if rid in draw_weeks else wk
        if era == "terra_aqua":
            final_maps = maps
            for (rid, season), qm in maps.qmaps.items():
                tbl = qm.table(24)
                for q, m, v in zip(tbl["q"], tbl["modis"], tbl["viirs"], strict=True):
                    transfer_rows.append({"region_id": rid, "season": season,
                                          "source": maps.source[(rid, season)], "q": q, "modis": m, "viirs": v})

    # Overlap and later: the reference sensor itself.
    ref = leaf[leaf["week"] >= overlap_start][["region_id", "week", "viirs_n"]].rename(
        columns={"viirs_n": "harmonized"})
    ref["lo"] = ref["harmonized"]
    ref["hi"] = ref["harmonized"]
    ref["method"] = "viirs_snpp"
    parts.append(ref)

    result = pd.concat(parts, ignore_index=True)
    result = _add_country_harmonized(result, regions, draws, draw_weeks)
    result = result.sort_values(["region_id", "week"]).reset_index(drop=True)
    return HarmonizationResult(weekly=result, draws=draws, draw_weeks=draw_weeks, maps=final_maps,
                               transfer=pd.DataFrame(transfer_rows))


def _modis_alive(ctx: pd.DataFrame) -> pd.Series:
    """Weeks where MODIS was still producing data anywhere in the pilot area."""
    alive = ctx.groupby("week")["x"].sum()
    last = alive[alive > 0].index.max()
    return ctx["week"] <= last


def _add_country_harmonized(result: pd.DataFrame, regions: pd.DataFrame,
                            draws: dict[int, np.ndarray], draw_weeks: dict[int, np.ndarray]) -> pd.DataFrame:
    parent = regions.set_index("region_id")["parent_id"].dropna().astype(int)
    rows = []
    for cid, children in parent.groupby(parent).groups.items():
        sub = result[result["region_id"].isin(children)]
        agg = sub.groupby("week", as_index=False).agg(harmonized=("harmonized", "sum"),
                                                     method=("method", "first"))
        agg["lo"] = agg["harmonized"]
        agg["hi"] = agg["harmonized"]
        # Interval for the country = percentiles of the summed child draws.
        child_draws = [(draws[c], draw_weeks[c]) for c in children if c in draws]
        if child_draws:
            weeks = np.unique(np.concatenate([w for _, w in child_draws]))
            total = np.zeros((weeks.size, child_draws[0][0].shape[1]), dtype=np.float64)
            for d, w in child_draws:
                total[np.searchsorted(weeks, w)] += d
            draws[int(cid)] = total.astype(np.float32)
            draw_weeks[int(cid)] = weeks
            lo = pd.Series(np.percentile(total, 5, axis=1), index=weeks)
            hi = pd.Series(np.percentile(total, 95, axis=1), index=weeks)
            m = agg["week"].isin(weeks)
            agg.loc[m, "lo"] = agg.loc[m, "week"].map(lo).to_numpy()
            agg.loc[m, "hi"] = agg.loc[m, "week"].map(hi).to_numpy()
        agg["region_id"] = int(cid)
        rows.append(agg)
    return pd.concat([result, *rows], ignore_index=True)


def aggregate_intervals(result: HarmonizationResult, region_id: int, groups: pd.Series,
                        level: float = 0.9) -> pd.DataFrame:
    """Interval for sums of weeks (e.g. annual totals) using the replicate draws."""
    a = (1 - level) / 2 * 100
    w = result.weekly[result.weekly["region_id"] == region_id].set_index("week")
    point = w["harmonized"].groupby(groups.reindex(w.index)).sum()
    lo = point.copy()
    hi = point.copy()
    if region_id in result.draws:
        d, wk = result.draws[region_id], result.draw_weeks[region_id]
        g = groups.reindex(pd.DatetimeIndex(wk)).to_numpy()
        fixed = w.loc[~w.index.isin(wk), "harmonized"].groupby(groups.reindex(w.index[~w.index.isin(wk)])).sum()
        for key in np.unique(g[pd.notna(g)]):
            sums = d[g == key].sum(axis=0) + float(fixed.get(key, 0.0))
            lo[key], hi[key] = np.percentile(sums, a), np.percentile(sums, 100 - a)
    return pd.DataFrame({"harmonized": point, "lo": lo, "hi": hi})
