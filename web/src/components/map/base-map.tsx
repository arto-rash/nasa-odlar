"use client";

import maplibregl, { type Map as MlMap, type MapOptions } from "maplibre-gl";
import { useLocale } from "next-intl";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/cn";
import { buildStyle, CAUCASUS_BOUNDS } from "./style";

const MapCtx = createContext<MlMap | null>(null);
export const useMap = () => useContext(MapCtx);
const ThemeCtx = createContext<"dark" | "light">("dark");
/** The theme the map style was built for, so layers can match their colors to it. */
export const useMapTheme = () => useContext(ThemeCtx);

/** Read straight from <html>: the inline theme script sets it before paint, while useTheme() starts at "dark". */
const docTheme = (): "dark" | "light" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** MapLibre map in the Ember Night style. Children render once the style is ready
 *  and are re-mounted after a theme/locale style swap so their layers come back. */
export function BaseMap({
  className, children, globe = false, terrain = true, options, onReady, controls = true, controlsPosition = "bottom-right",
}: {
  controlsPosition?: "top-right" | "bottom-right" | "top-left" | "bottom-left";
  className?: string;
  children?: React.ReactNode;
  globe?: boolean;
  terrain?: boolean;
  options?: Partial<MapOptions>;
  onReady?: (map: MlMap) => void;
  controls?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [styleKey, setStyleKey] = useState(0);
  const [hookTheme] = useTheme();
  const locale = useLocale() as "az" | "en";
  // the map itself is only ever created in the browser, so nothing rendered depends on this during SSR
  const [theme, setTheme] = useState<"dark" | "light">(() => (typeof document === "undefined" ? "dark" : docTheme()));
  const built = useRef<{ theme: "dark" | "light"; locale: string } | null>(null);

  useEffect(() => {
    if (!el.current) return;
    built.current = { theme, locale };
    const m = new maplibregl.Map({
      container: el.current,
      style: buildStyle({ theme, locale, terrain, globe }),
      bounds: CAUCASUS_BOUNDS,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      maxPitch: 70,
      ...options,
    });
    if (controls) m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), controlsPosition);
    m.once("load", () => {
      setMap(m);
      onReady?.(m);
    });
    return () => {
      setMap(null);
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;
    const next = docTheme();
    if (built.current?.theme === next && built.current.locale === locale) return;
    built.current = { theme: next, locale };
    // diff: false, because a diffed swap silently drops runtime sources/layers and never fires
    // "style.load", so the children would not get the chance to add theirs back
    map.setStyle(buildStyle({ theme: next, locale, terrain, globe }), { diff: false });
    map.once("style.load", () => {
      setTheme(next);
      setStyleKey((k) => k + 1);
    });
  }, [hookTheme, locale, map, terrain, globe]);

  return (
    <div className={cn("relative", className)} data-map-ready={map ? "true" : undefined}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <MapCtx.Provider value={map}>
        <ThemeCtx.Provider value={theme}>{map && <MapChildren key={styleKey}>{children}</MapChildren>}</ThemeCtx.Provider>
      </MapCtx.Provider>
    </div>
  );
}

function MapChildren({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
