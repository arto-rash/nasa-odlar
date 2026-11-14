from datetime import date

import pandas as pd

from odlar.ingest.synthetic import SATELLITES, generate, season_shape


def test_deterministic(regions, weather):
    a = generate(regions, weather, date(2014, 1, 1), date(2014, 12, 31), seed=9)
    b = generate(regions, weather, date(2014, 1, 1), date(2014, 12, 31), seed=9)
    pd.testing.assert_frame_equal(a.hotspots, b.hotspots)


def test_satellites_respect_launch_dates(world):
    h = world.hotspots
    for sat, (_s, _src, first, *_r) in SATELLITES.items():
        d = h.loc[h.satellite == sat, "acq_date"]
        if len(d):
            assert min(d) >= first


def test_viirs_sees_several_times_more_than_modis(world):
    h = world.hotspots[(world.hotspots.type == 0)]
    h = h[pd.to_datetime(h.acq_date).dt.year.between(2013, 2016)]
    n = (h.satellite == "N").sum()
    m = h.satellite.isin(["T", "A"]).sum()
    assert 2.0 < n / m < 4.5


def test_static_sources_are_typed(world):
    flares = world.hotspots[world.hotspots.type == 2]
    assert len(flares) > 0


def test_season_shape_normalised():
    import numpy as np
    doy = np.arange(1, 366)
    s = season_shape(doy, (0.2, 0.6, 0.2), "lowland_agri")
    assert abs(s.mean() - 1) < 1e-9
    assert 190 < doy[np.argmax(s)] < 220  # summer stubble-burning peak
