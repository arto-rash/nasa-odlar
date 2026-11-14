import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import { useEffect, useState } from "react";
import { useMap } from "@/components/map/base-map";
import { http } from "@/lib/client";

/*
 * Region polygons are loaded by the browser, never during server rendering, and
 * only for what is on screen: with the whole world they add up to tens of MB.
 * The API answers by zoom level, like map tiles:
 *   zoom < 4  country outlines (the whole world, one small request)
 *   zoom < 7  provinces simplified to ~500 m in the visible area
 *   zoom ≥ 7  provinces at full map detail in the visible area
 * The visible area is snapped to a grid (5° / 1°) so panning reuses cached answers.
 */

type View = { zoom: number; bbox: string | null };

function viewOf(map: NonNullable<ReturnType<typeof useMap>>): View {
  const z = map.getZoom();
  if (z < 4) return { zoom: 2, bbox: null };
  const step = z < 7 ? 5 : 1;
  const b = map.getBounds();
  const snap = (v: number, up: boolean) => (up ? Math.ceil(v / step) : Math.floor(v / step)) * step;
  const w = Math.max(-180, snap(b.getWest(), false) - step);
  const s = Math.max(-85, snap(b.getSouth(), false) - step);
  const e = Math.min(180, snap(b.getEast(), true) + step);
  const n = Math.min(85, snap(b.getNorth(), true) + step);
  return { zoom: z < 7 ? 5 : 8, bbox: `${w},${s},${e},${n}` };
}

/** Regions in view, and whether they are countries (zoomed out) or provinces. Use inside <BaseMap>. */
export function useViewportRegions(): { geojson: FeatureCollection | null; countries: boolean } {
  const map = useMap();
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const next = viewOf(map);
      setView((prev) => (prev && prev.zoom === next.zoom && prev.bbox === next.bbox ? prev : next));
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map]);
  const { data } = useQuery({
    queryKey: ["regions-view", view?.zoom, view?.bbox],
    enabled: view !== null,
    queryFn: () => http<FeatureCollection>(`/regions/geojson?zoom=${view!.zoom}${view!.bbox ? `&bbox=${view!.bbox}` : ""}`),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  // decided by what is shown (the previous answer stays up while a new zoom loads)
  const countries = !!data && data.features.length > 0 && data.features.every((f) => f.properties?.level === "country");
  return { geojson: data ?? null, countries };
}

/** One country's outline and provinces (~500 m detail), e.g. Azerbaijan's signature glow. */
export function useCountryShape(country = "az"): FeatureCollection | null {
  const { data } = useQuery({
    queryKey: ["regions-country", country],
    queryFn: () => http<FeatureCollection>(`/regions/geojson?country=${country}&zoom=5`),
    staleTime: 30 * 60_000,
  });
  return data ?? null;
}
