import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import { http } from "@/lib/client";

/**
 * Region polygons, loaded by the browser and shared by every map. They are not
 * fetched during server rendering: the file is several MB, too big for the page
 * HTML and over Next's 2 MB data-cache limit, so it would never refresh there.
 */
export function useRegionsGeoJson(): FeatureCollection | null {
  const { data } = useQuery({
    queryKey: ["regions-geojson"],
    queryFn: () => http<FeatureCollection>("/regions/geojson"),
    staleTime: 30 * 60_000,
  });
  return data ?? null;
}
