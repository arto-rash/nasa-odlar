"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { regionsViewQuery, warmYears, weekPackQuery } from "@/lib/map-data";

type Connection = { saveData?: boolean; effectiveType?: string };

/**
 * Starts loading the map's data as soon as the site is idle, on any page, one
 * file at a time so it never competes with the page. The browser keeps the files
 * between visits. Phones get only the recent years; data-saver gets nothing.
 */
export function DataWarmup() {
  const qc = useQueryClient();
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: Connection }).connection;
    if (conn?.saveData || /2g/.test(conn?.effectiveType ?? "")) return;
    let stopped = false;
    const run = async () => {
      void import("maplibre-gl");
      await qc.prefetchQuery(regionsViewQuery(2, null));
      const years = warmYears(!window.matchMedia("(max-width: 639px)").matches);
      // the home files first: they are small and Explore opens on them
      for (const area of ["home", "world"] as const) {
        for (const year of years) {
          if (stopped) return;
          await qc.prefetchQuery(weekPackQuery(year, area));
        }
      }
    };
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => void run());
    return () => {
      stopped = true;
      cancel(id);
    };
  }, [qc]);
  return null;
}
