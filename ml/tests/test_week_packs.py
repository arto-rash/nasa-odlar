import struct

import numpy as np
import pandas as pd

from odlar.week_packs import encode


def test_pack_layout():
    rows = pd.DataFrame({"lon": [49.5, -73.12], "lat": [40.4, -33.01], "sensor": ["VIIRS", "MODIS"],
                         "frp": [np.expm1(2.0), 0.0], "acq_date": pd.to_datetime(["2023-07-05", "2023-07-09"])})
    data = encode(rows, 250)
    assert struct.unpack("<III", data[:12]) == (250, 1, 2)
    assert struct.unpack("<II", data[12:20]) == ((pd.Timestamp("2023-07-03") - pd.Timestamp(0)).days, 2)
    assert np.frombuffer(data, "<i2", 2, 20).tolist() == [4950, -7312]
    assert np.frombuffer(data, "<i2", 2, 24).tolist() == [4040, -3301]
    assert list(data[28:30]) == [128 | 32, 0]
