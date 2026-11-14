"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { http } from "./client";
import type { RegionRef } from "./types";

/** Find the region the device is in. The position goes only to our own
 *  /regions/locate (rounded to ~1 km) and is not kept anywhere. */
export function useNearMe(onFound: (region: RegionRef) => void) {
  const t = useTranslations("common");
  const [locating, setLocating] = useState(false);
  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return void toast.error(t("locateFail"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude.toFixed(2);
          const lon = pos.coords.longitude.toFixed(2);
          const res = await http<{ region: RegionRef }>(`/regions/locate?lat=${lat}&lon=${lon}`);
          onFound(res.region);
        } catch {
          toast.error(t("locateFail"));
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        toast.error(t("locateFail"));
      },
      { timeout: 10000, maximumAge: 10 * 60_000 },
    );
  }, [onFound, t]);
  return { locate, locating };
}
