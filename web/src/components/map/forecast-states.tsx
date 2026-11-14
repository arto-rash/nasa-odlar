"use client";

import { useEffect } from "react";
import type { ForecastMap } from "@/lib/types";
import { useMap } from "./base-map";

/** Puts one forecast week on the "regions" source as feature state: expected
 *  detections per 1,000 km² ("fd"), read by RegionsLayer's forecast mode. */
export function ForecastStates({ data, sourceKey }: { data: ForecastMap | undefined; sourceKey?: unknown }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !map.getSource("regions")) return;
    map.removeFeatureState({ source: "regions" });
    for (const [id, expected, , area] of data?.values ?? []) {
      map.setFeatureState({ source: "regions", id }, { fd: area > 0 ? (expected / area) * 1000 : 0 });
    }
    return () => {
      if (map.getSource("regions")) map.removeFeatureState({ source: "regions" });
    };
  }, [map, data, sourceKey]);
  return null;
}
