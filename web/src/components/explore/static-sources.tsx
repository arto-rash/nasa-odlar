"use client";

import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import { useMemo } from "react";
import { useGeoJson, useLayer } from "@/components/map/layers";
import { useMapTheme } from "@/components/map/base-map";
import { http } from "@/lib/client";

export interface StaticSources {
  total: number;
  in_view: number;
  cell_km: number;
  cells: [number, number][];
}

/** Every cell removed as a steady heat source, worldwide (a few thousand points). */
export const useStaticSources = (enabled: boolean) =>
  useQuery({
    queryKey: ["static-sources"],
    queryFn: () => http<StaticSources>("/static-sources?limit=20000"),
    enabled,
    staleTime: 24 * 3600_000,
  });

/** Grey rings where gas flares, refineries and burning gas vents sit: their
 *  detections never enter the record, so they are shown apart from fires. */
export function StaticSourcesLayer({ data }: { data: StaticSources | undefined }) {
  const theme = useMapTheme();
  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: (data?.cells ?? []).map(([lon, lat]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} })),
    }),
    [data],
  );
  useGeoJson("static-sources", fc);
  useLayer({
    id: "static-sources",
    type: "circle",
    source: "static-sources",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.6, 6, 3.2, 10, 6],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": theme === "light" ? "#3f4a52" : "#b9c4cc",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 8, 1.6],
      "circle-stroke-opacity": 0.85,
    },
  });
  return null;
}
