"""Empirical quantile mapping for zero-heavy detection counts.

Maps a MODIS weekly count ``x`` onto the VIIRS S-NPP scale by matching quantiles of
the two marginal distributions observed over the same weeks:

    T(x) = F_y^{-1}( F_x(x) )

Counts are discrete with many ties, so ``F_x`` uses mid-ranks. Values beyond the
training range are extrapolated with the ratio of the top-decile means, keeping
the mapping monotone and avoiding a flat ceiling for record years.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

N_QUANTILES = 99


@dataclass
class QuantileMap:
    x_support: np.ndarray = None  # type: ignore[assignment]
    x_cdf: np.ndarray = None  # type: ignore[assignment]
    y_sorted: np.ndarray = None  # type: ignore[assignment]
    tail_ratio: float = 1.0
    x_max: float = 0.0
    y_at_max: float = 0.0

    def fit(self, x: np.ndarray, y: np.ndarray) -> QuantileMap:
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)
        if x.size == 0 or x.size != y.size:
            raise ValueError("x and y must be non-empty and the same length")
        n = x.size
        support, counts = np.unique(x, return_counts=True)
        below = np.concatenate([[0], np.cumsum(counts)[:-1]])
        self.x_support = support
        self.x_cdf = (below + 0.5 * counts) / n  # mid-rank CDF at each support value
        self.y_sorted = np.sort(y)
        top_x = np.sort(x)[-max(1, n // 10):]
        top_y = self.y_sorted[-max(1, n // 10):]
        self.tail_ratio = float(top_y.mean() / top_x.mean()) if top_x.mean() > 0 else 1.0
        self.x_max = float(support[-1])
        self.y_at_max = float(self._y_quantile(np.array([self.x_cdf[-1]]))[0])
        return self

    def _y_quantile(self, q: np.ndarray) -> np.ndarray:
        n = self.y_sorted.size
        pos = np.clip(q * n - 0.5, 0, n - 1)
        return np.interp(pos, np.arange(n), self.y_sorted)

    def cdf(self, x: np.ndarray) -> np.ndarray:
        """Mid-rank CDF, linearly interpolated between observed support points."""
        return np.interp(np.asarray(x, dtype=float), self.x_support, self.x_cdf)

    def transform(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=float)
        out = self._y_quantile(self.cdf(x))
        beyond = x > self.x_max
        if beyond.any():
            out[beyond] = self.y_at_max + (x[beyond] - self.x_max) * max(self.tail_ratio, 0.0)
        return out

    def table(self, n: int = N_QUANTILES) -> dict[str, list[float]]:
        """Quantile-quantile pairs for plotting the transfer function."""
        q = (np.arange(1, n + 1)) / (n + 1)
        xs = np.interp(q, self.x_cdf, self.x_support)
        return {"q": q.round(4).tolist(), "modis": xs.round(3).tolist(),
                "viirs": self._y_quantile(q).round(3).tolist()}
