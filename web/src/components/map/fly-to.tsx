"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { http } from "@/lib/client";
import { useMap } from "./base-map";

/** Zoom at which a region of this area (km²) spans about a fifth of a ~1400 px
 *  map at mid latitudes: a 2,000 km² district → ~8.4, a country of 86,000 km² → ~5.7. */
export function zoomForArea(areaKm2: number | null | undefined): number {
  const span = Math.sqrt(Math.max(areaKm2 ?? 1000, 1));
  return Math.max(3.5, Math.min(10, 13.9 - Math.log2(span)));
}

// Fly to a region: its centre, zoomed by its size (shapes are loaded by view).
export function FlyTo({ slug, duration = 1400 }: { slug: string | null; duration?: number }) {
  const map = useMap();
  const { data } = useQuery({
    queryKey: ["region", slug],
    enabled: !!slug,
    queryFn: () => http<{ lat?: number; lon?: number; area_km2?: number }>(`/regions/${slug}`),
    staleTime: 30 * 60_000,
  });
  useEffect(() => {
    if (!map || !slug || data?.lat == null || data?.lon == null) return;
    map.flyTo({ center: [data.lon, data.lat], zoom: zoomForArea(data.area_km2), duration });
  }, [map, slug, data, duration]);
  return null;
}
