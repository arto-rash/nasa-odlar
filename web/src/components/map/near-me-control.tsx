"use client";

import maplibregl from "maplibre-gl";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { http } from "@/lib/client";
import type { RegionRef } from "@/lib/types";
import { useMap } from "./base-map";

/** MapLibre's locate button: flies to the device and hands back the region there.
 *  The position goes only to our /regions/locate (rounded to ~1 km). */
export function NearMeControl({ onFound, position = "top-right" }: { onFound: (r: RegionRef) => void; position?: "top-right" | "bottom-right" | "bottom-left" }) {
  const map = useMap();
  const t = useTranslations("common");
  const found = useRef(onFound);
  useEffect(() => {
    found.current = onFound;
  }, [onFound]);
  useEffect(() => {
    if (!map) return;
    const ctl = new maplibregl.GeolocateControl({ positionOptions: { timeout: 10000 }, fitBoundsOptions: { maxZoom: 8 }, showAccuracyCircle: false });
    const onPos = async (pos: GeolocationPosition) => {
      try {
        const res = await http<{ region: RegionRef }>(`/regions/locate?lat=${pos.coords.latitude.toFixed(2)}&lon=${pos.coords.longitude.toFixed(2)}`);
        found.current(res.region);
      } catch {
        toast.error(t("locateFail"));
      }
    };
    const onErr = () => toast.error(t("locateFail"));
    ctl.on("geolocate", onPos);
    ctl.on("error", onErr);
    map.addControl(ctl, position);
    return () => {
      ctl.off("geolocate", onPos);
      ctl.off("error", onErr);
      // Leaving the page can destroy the map first, which already removes its
      // controls; removing this one again threw inside MapLibre and took the
      // whole page down ("This page couldn't load").
      if (!map.hasControl(ctl)) return;
      try {
        map.removeControl(ctl);
      } catch {}
    };
  }, [map, position, t]);
  return null;
}
