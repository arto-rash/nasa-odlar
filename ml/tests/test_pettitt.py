"""Pettitt's change-point test: finds a step, not noise."""

import numpy as np

from odlar.api.service import pettitt


def test_finds_the_step_year():
    y = np.arange(2001, 2026)
    x = np.r_[np.full(11, 100.0), np.full(14, 600.0)] + np.random.default_rng(0).normal(0, 30, 25)
    b = pettitt(y, x)
    assert b["year"] == 2012 and b["significant"] and b["shift"] > 4


def test_quiet_on_noise_and_flat():
    y = np.arange(2001, 2026)
    assert not pettitt(y, np.random.default_rng(1).normal(500, 80, 25))["significant"]
    assert pettitt(y, np.zeros(25))["year"] is None
