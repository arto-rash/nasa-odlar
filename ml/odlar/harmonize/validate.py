"""Leave-one-year-out skill of the harmonization inside the 2012+ overlap.

For each overlap year the maps are refitted on every *other* year, the held-out
year's MODIS weeks are harmonized, and the result is scored against what VIIRS
S-NPP actually observed that year. This is the honest out-of-sample check that
backs every number shown in the app.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from odlar.harmonize.engine import fit_predict, overlap_context


def loyo(weekly: pd.DataFrame, regions: pd.DataFrame, n_boot: int = 50, seed: int = 1,
         years: list[int] | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (per region-week predictions, per year/region summary metrics)."""
    rng = np.random.default_rng(seed)
    ctx = overlap_context(weekly, regions)
    ctx["year"] = ctx["week"].dt.year
    counts = ctx.groupby("year")["week"].nunique()
    all_years = [int(y) for y in counts[counts >= 50].index]
    preds = []
    for y in years or all_years:
        train = ctx[ctx["year"] != y].reset_index(drop=True)
        test = ctx[ctx["year"] == y].reset_index(drop=True)
        est, reps, _ = fit_predict(train, test, n_boot, rng)
        out = test[["region_id", "country_id", "week", "year", "x", "y"]].copy()
        out["pred"] = est
        out["lo"] = np.percentile(reps, 5, axis=1)
        out["hi"] = np.percentile(reps, 95, axis=1)
        # annual-total interval per region from summed draws
        for _rid, pos in out.groupby("region_id").indices.items():
            sums = reps[pos].sum(axis=0)
            out.loc[out.index[pos], "year_lo"] = np.percentile(sums, 5)
            out.loc[out.index[pos], "year_hi"] = np.percentile(sums, 95)
        preds.append(out)
    pred = pd.concat(preds, ignore_index=True)
    return pred, summarize(pred)


def summarize(pred: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (rid, year), g in pred.groupby(["region_id", "year"]):
        rows.append({"region_id": rid, "year": year, "obs_total": g["y"].sum(),
                     "pred_total": g["pred"].sum(), "modis_total": g["x"].sum(),
                     "year_lo": g["year_lo"].iloc[0], "year_hi": g["year_hi"].iloc[0]})
    return pd.DataFrame(rows)


def skill_report(pred: pd.DataFrame) -> dict:
    """Headline metrics across all held-out years."""
    weekly_cov = float(((pred["y"] >= pred["lo"]) & (pred["y"] <= pred["hi"])).mean())
    annual = summarize(pred)
    annual_cov = float(((annual["obs_total"] >= annual["year_lo"]) & (annual["obs_total"] <= annual["year_hi"])).mean())
    tot = annual.groupby("year")[["obs_total", "pred_total", "modis_total"]].sum()
    bias = float(tot["pred_total"].sum() / tot["obs_total"].sum() - 1)
    raw_bias = float(tot["modis_total"].sum() / tot["obs_total"].sum() - 1)
    big = annual[annual["obs_total"] >= 20]
    rel_err = (big["pred_total"] - big["obs_total"]).abs() / big["obs_total"]
    rho_weekly = spearmanr(pred["pred"], pred["y"]).statistic
    rho_annual = spearmanr(annual["pred_total"], annual["obs_total"]).statistic
    by_year = tot.assign(bias=tot["pred_total"] / tot["obs_total"] - 1).reset_index()
    return {
        "n_years": int(pred["year"].nunique()),
        "n_region_weeks": len(pred),
        "bias": bias,
        "raw_modis_bias": raw_bias,
        "weekly_mae": float((pred["pred"] - pred["y"]).abs().mean()),
        "weekly_spearman": float(rho_weekly),
        "annual_spearman": float(rho_annual),
        "annual_median_rel_error": float(rel_err.median()) if len(rel_err) else float("nan"),
        "weekly_interval_coverage": weekly_cov,
        "annual_interval_coverage": annual_cov,
        "by_year": by_year.round(3).to_dict(orient="records"),
    }
