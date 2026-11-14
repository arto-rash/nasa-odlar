import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from odlar.harmonize.quantile_map import QuantileMap

counts = st.lists(st.integers(min_value=0, max_value=200), min_size=5, max_size=300)


@given(counts, counts)
@settings(max_examples=80, deadline=None)
def test_transform_is_monotone(xs, ys):
    n = min(len(xs), len(ys))
    qm = QuantileMap().fit(np.array(xs[:n]), np.array(ys[:n]))
    grid = np.linspace(0, max(xs) * 2 + 5, 200)
    out = qm.transform(grid)
    assert np.all(np.diff(out) >= -1e-9)
    assert np.all(out >= 0)


@given(counts)
@settings(max_examples=50, deadline=None)
def test_identity_when_distributions_match(xs):
    x = np.array(xs, dtype=float)
    qm = QuantileMap().fit(x, x.copy())
    np.testing.assert_allclose(qm.transform(np.unique(x)), np.unique(x), atol=1e-6)


def test_recovers_constant_scale():
    rng = np.random.default_rng(0)
    x = rng.poisson(rng.gamma(1.5, 4.0, 3000)).astype(float)
    y = 3.0 * rng.permutation(x)  # same distribution, scaled — pairing is irrelevant to QM
    qm = QuantileMap().fit(x, y)
    pos = x[x > 0]
    ratio = qm.transform(pos).mean() / pos.mean()
    assert ratio == pytest.approx(3.0, rel=0.05)


def test_tail_extrapolation_continues_upward():
    x = np.arange(0, 50, dtype=float)
    qm = QuantileMap().fit(x, 4 * x)
    assert qm.transform(np.array([200.0]))[0] > qm.transform(np.array([49.0]))[0]
    assert qm.tail_ratio == pytest.approx(4.0, rel=0.01)


def test_table_shape_and_bounds():
    qm = QuantileMap().fit(np.arange(100.0), np.arange(100.0) * 2)
    t = qm.table(24)
    assert len(t["q"]) == len(t["modis"]) == len(t["viirs"]) == 24
    assert all(0 < q < 1 for q in t["q"])


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        QuantileMap().fit(np.array([]), np.array([]))
    with pytest.raises(ValueError):
        QuantileMap().fit(np.array([1.0, 2.0]), np.array([1.0]))
