"""Training, rolling-origin evaluation and persistence of the risk models."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from odlar.model.features import FEATURES, OUTLOOK_FEATURES

CLF_PARAMS = dict(n_estimators=350, learning_rate=0.04, num_leaves=31, min_child_samples=200,
                  subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1)
REG_PARAMS = dict(objective="tweedie", tweedie_variance_power=1.3, n_estimators=300, learning_rate=0.04,
                  num_leaves=31, min_child_samples=200, subsample=0.8, subsample_freq=1,
                  colsample_bytree=0.8, verbose=-1)
QUANTILES = (0.1, 0.5, 0.9)


@dataclass
class ShortModel:
    clf: lgb.LGBMClassifier
    reg: lgb.LGBMRegressor
    iso_x: np.ndarray
    iso_y: np.ndarray
    features: list[str] = field(default_factory=lambda: list(FEATURES))

    def raw_proba(self, X: pd.DataFrame) -> np.ndarray:
        return self.clf.predict_proba(X[self.features])[:, 1]

    def proba(self, X: pd.DataFrame) -> np.ndarray:
        return np.clip(np.interp(self.raw_proba(X), self.iso_x, self.iso_y), 0.0, 1.0)

    def expected(self, X: pd.DataFrame) -> np.ndarray:
        return np.maximum(self.reg.predict(X[self.features]), 0.0)

    def contributions(self, X: pd.DataFrame) -> np.ndarray:
        """TreeSHAP values (log-odds), one column per feature plus the bias term."""
        return self.clf.booster_.predict(X[self.features], pred_contrib=True)


@dataclass
class OutlookModel:
    models: dict[float, lgb.LGBMRegressor]
    features: list[str] = field(default_factory=lambda: list(OUTLOOK_FEATURES))

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        out = pd.DataFrame({f"q{int(q * 100)}": np.maximum(m.predict(X[self.features]), 0.0)
                            for q, m in self.models.items()}, index=X.index)
        # enforce non-crossing quantiles
        vals = np.sort(out.to_numpy(), axis=1)
        return pd.DataFrame(vals, columns=out.columns, index=X.index)


def _labelled(panel: pd.DataFrame, target: str) -> pd.DataFrame:
    return panel[panel[target].notna()]


def fit_short(train: pd.DataFrame, calib: pd.DataFrame | None = None, seed: int = 0,
              n_folds: int = 3) -> ShortModel:
    """Fit the 7-day event classifier + count regressor.

    Calibration uses cross-fitted out-of-fold probabilities (folds = groups of
    whole years), so the isotonic map sees every regime in the training record
    instead of a single, possibly unusual, year. Passing ``calib`` additionally
    includes those rows (scored by the full model) in the calibration set.
    """
    train = _labelled(train, "target_event")
    y = train["target_event"].to_numpy()
    clf = lgb.LGBMClassifier(random_state=seed, **CLF_PARAMS).fit(train[FEATURES], y)
    reg = lgb.LGBMRegressor(random_state=seed, **REG_PARAMS).fit(train[FEATURES], train["target_sum7"])
    model = ShortModel(clf=clf, reg=reg, iso_x=np.array([0.0, 1.0]), iso_y=np.array([0.0, 1.0]))

    years = train["date"].dt.year.to_numpy()
    uniq = np.unique(years)
    oof_p, oof_y = [], []
    if uniq.size >= n_folds:
        for k, fold_years in enumerate(np.array_split(np.random.default_rng(seed).permutation(uniq), n_folds)):
            hold = np.isin(years, fold_years)
            if len(np.unique(y[~hold])) < 2:
                continue
            m = lgb.LGBMClassifier(random_state=seed + k + 1, **CLF_PARAMS).fit(train.loc[~hold, FEATURES], y[~hold])
            oof_p.append(m.predict_proba(train.loc[hold, FEATURES])[:, 1])
            oof_y.append(y[hold])
    if calib is not None and len(_labelled(calib, "target_event")):
        c = _labelled(calib, "target_event")
        oof_p.append(model.raw_proba(c))
        oof_y.append(c["target_event"].to_numpy())
    if oof_p:
        cp, cy = np.concatenate(oof_p), np.concatenate(oof_y)
        if len(np.unique(cy)) == 2:
            iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(cp, cy)
            model.iso_x, model.iso_y = iso.X_thresholds_, iso.y_thresholds_
    return model


def fit_outlook(train: pd.DataFrame, seed: int = 0) -> OutlookModel:
    t = _labelled(train, "target_sum13w")
    t = t[t["date"].dt.day_of_week == 0]
    models = {}
    for q in QUANTILES:
        models[q] = lgb.LGBMRegressor(objective="quantile", alpha=q, n_estimators=250, learning_rate=0.05,
                                      num_leaves=15, min_child_samples=50, random_state=seed,
                                      verbose=-1).fit(t[OUTLOOK_FEATURES], t["target_sum13w"])
    return OutlookModel(models=models)


def climatology_baseline(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Event frequency for the same region and calendar week in the training years."""
    t = _labelled(train, "target_event")
    rate = t.groupby(["region_id", "woy"])["target_event"].mean()
    overall = t["target_event"].mean()
    idx = pd.MultiIndex.from_arrays([test["region_id"], test["woy"]])
    return rate.reindex(idx).fillna(overall).to_numpy()


def reliability(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if m.sum():
            out.append({"bin": round(float((lo + hi) / 2), 2), "predicted": round(float(p[m].mean()), 4),
                        "observed": round(float(y[m].mean()), 4), "n": int(m.sum())})
    return out


def score(y: np.ndarray, p: np.ndarray, base: np.ndarray) -> dict:
    brier = brier_score_loss(y, p)
    brier_base = brier_score_loss(y, base)
    return {
        "roc_auc": round(float(roc_auc_score(y, p)), 4),
        "pr_auc": round(float(average_precision_score(y, p)), 4),
        "brier": round(float(brier), 5),
        "brier_skill": round(float(1 - brier / brier_base), 4),
        "base_roc_auc": round(float(roc_auc_score(y, base)), 4),
        "base_pr_auc": round(float(average_precision_score(y, base)), 4),
        "base_brier": round(float(brier_base), 5),
        "event_rate": round(float(y.mean()), 4),
        "n": int(len(y)),
    }


def pinball(y: np.ndarray, q: np.ndarray, alpha: float) -> float:
    d = y - q
    return float(np.mean(np.maximum(alpha * d, (alpha - 1) * d)))


def evaluate(panel: pd.DataFrame, test_years: list[int], truth_panel: pd.DataFrame | None = None,
             sample_every: int = 2) -> dict:
    """Rolling-origin CV: for year Y, train (and cross-fit calibrate) on years < Y, test on Y.

    ``truth_panel`` (default: ``panel``) supplies the labels the predictions are
    scored against, so a model trained on the raw record can be judged against
    the harmonized truth.
    """
    truth_panel = panel if truth_panel is None else truth_panel
    truth = truth_panel.set_index(["region_id", "date"])
    panel = panel[panel["date"].dt.day_of_year % sample_every == 0]
    yr = panel["date"].dt.year
    ys, ps, bs = [], [], []
    by_year, out_rows = [], []
    for y in test_years:
        train, test = panel[yr < y], panel[yr == y]
        test = _labelled(test, "target_event")
        tl = truth["target_event"].reindex(pd.MultiIndex.from_arrays([test["region_id"], test["date"]]))
        test = test[tl.notna().to_numpy()]
        labels = tl.dropna().to_numpy()
        if test.empty or len(np.unique(labels)) < 2:
            continue
        model = fit_short(train)
        p = model.proba(test)
        truth_train = truth_panel[truth_panel["date"].dt.year < y]
        base = climatology_baseline(truth_train, test)
        ys.append(labels), ps.append(p), bs.append(base)
        by_year.append({"year": y, **score(labels, p, base)})

        # outlook
        ol = fit_outlook(panel[yr < y])
        t13 = _labelled(test, "target_sum13w")
        t13 = t13[t13["date"].dt.day_of_week == 0]
        if len(t13):
            q = ol.predict(t13)
            obs = t13["target_sum13w"].to_numpy()
            tr = _labelled(panel[yr < y], "target_sum13w")
            clim_q = tr.groupby(["region_id", "woy"])["target_sum13w"].quantile([0.1, 0.5, 0.9]).unstack()
            cq = clim_q.reindex(pd.MultiIndex.from_arrays([t13["region_id"], t13["woy"]])).fillna(0).to_numpy()
            out_rows.append({
                "year": y,
                "pinball_model": np.mean([pinball(obs, q.iloc[:, i].to_numpy(), a) for i, a in enumerate((0.1, 0.5, 0.9))]),
                "pinball_clim": np.mean([pinball(obs, cq[:, i], a) for i, a in enumerate((0.1, 0.5, 0.9))]),
                "coverage80": float(((obs >= q.iloc[:, 0]) & (obs <= q.iloc[:, 2])).mean()),
                "coverage80_clim": float(((obs >= cq[:, 0]) & (obs <= cq[:, 2])).mean()),
            })
    y_all, p_all, b_all = np.concatenate(ys), np.concatenate(ps), np.concatenate(bs)
    outlook = pd.DataFrame(out_rows)
    return {
        "overall": score(y_all, p_all, b_all),
        "by_year": by_year,
        "reliability": reliability(y_all, p_all),
        "reliability_base": reliability(y_all, b_all),
        "outlook": {
            "pinball_skill": round(float(1 - outlook["pinball_model"].sum() / outlook["pinball_clim"].sum()), 4)
            if len(outlook) else None,
            "coverage80": round(float(outlook["coverage80"].mean()), 4) if len(outlook) else None,
            "coverage80_clim": round(float(outlook["coverage80_clim"].mean()), 4) if len(outlook) else None,
            "by_year": outlook.round(4).to_dict(orient="records"),
        },
    }


def importance(model: ShortModel) -> list[dict]:
    gain = model.clf.booster_.feature_importance(importance_type="gain")
    total = gain.sum() or 1.0
    order = np.argsort(-gain)
    return [{"feature": model.features[i], "gain": round(float(gain[i] / total), 4)} for i in order]


# ---------------------------------------------------------------- persistence

def save(short: ShortModel, outlook: OutlookModel, meta: dict, model_dir: Path) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    short.clf.booster_.save_model(str(model_dir / "short_clf.txt"))
    short.reg.booster_.save_model(str(model_dir / "short_reg.txt"))
    for q, m in outlook.models.items():
        m.booster_.save_model(str(model_dir / f"outlook_q{int(q * 100)}.txt"))
    (model_dir / "calibration.json").write_text(json.dumps({"x": short.iso_x.tolist(), "y": short.iso_y.tolist()}))
    (model_dir / "meta.json").write_text(json.dumps(meta, indent=1, default=str))


@dataclass
class LoadedModels:
    clf: lgb.Booster
    reg: lgb.Booster
    outlook: dict[int, lgb.Booster]
    iso_x: np.ndarray
    iso_y: np.ndarray
    meta: dict

    def proba(self, X: pd.DataFrame) -> np.ndarray:
        raw = self.clf.predict(X[FEATURES])
        return np.clip(np.interp(raw, self.iso_x, self.iso_y), 0, 1)

    def expected(self, X: pd.DataFrame) -> np.ndarray:
        return np.maximum(self.reg.predict(X[FEATURES]), 0)

    def contributions(self, X: pd.DataFrame) -> np.ndarray:
        return self.clf.predict(X[FEATURES], pred_contrib=True)

    def outlook_q(self, X: pd.DataFrame) -> np.ndarray:
        vals = np.column_stack([np.maximum(self.outlook[q].predict(X[OUTLOOK_FEATURES]), 0) for q in (10, 50, 90)])
        return np.sort(vals, axis=1)


def load(model_dir: Path) -> LoadedModels:
    cal = json.loads((model_dir / "calibration.json").read_text())
    return LoadedModels(
        clf=lgb.Booster(model_file=str(model_dir / "short_clf.txt")),
        reg=lgb.Booster(model_file=str(model_dir / "short_reg.txt")),
        outlook={q: lgb.Booster(model_file=str(model_dir / f"outlook_q{q}.txt")) for q in (10, 50, 90)},
        iso_x=np.asarray(cal["x"]), iso_y=np.asarray(cal["y"]),
        meta=json.loads((model_dir / "meta.json").read_text()),
    )
