"use client";
import type { FeatureCollection } from "geojson";

import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { RISK_HEX, SENSOR_HEX, SENSOR_HEX_LIGHT } from "@/lib/colors";
import { useMap, useMapTheme } from "./base-map";

type FC = FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };

/** Overlay colors per basemap theme. Dark mode glows toward white-hot; on paper that
 *  vanishes, so light mode stays in saturated, darker embers. */
export const LAYER_COLORS = {
  dark: {
    sparkGlow: [0, "#7a1526", 0.4, "#e2462a", 0.8, "#ff9a3d", 1, "#ffe0a8"],
    sparkCore: [0, "#ff7a2a", 0.6, "#ffc46b", 1, "#fff4dc"],
    sparkGlowOpacity: [0.25, 0.75],
    sparkBlur: 1,
    density: [0, "rgba(0,0,0,0)", 0.12, "#3d1218", 0.3, "#7a1526", 0.5, "#c22b2a", 0.7, "#f0592a", 0.85, "#ff9a3d", 1, "#fff3d6"],
    sensor: SENSOR_HEX,
    hotspotStroke: "#fff4dc",
    regionLine: "#ffb37a",
    riskLine: "#0b0907",
    selected: "#fff4dc",
    signature: "#ff7a2a",
    signatureGlow: "#ff5a1f",
    aoiLine: "#ffc46b",
    aoiPoint: "#0b0907",
  },
  light: {
    sparkGlow: [0, "#f3b48a", 0.4, "#f08a4a", 0.8, "#e2562a", 1, "#c93a25"],
    sparkCore: [0, "#e2562a", 0.6, "#c93a25", 1, "#8f1d22"],
    sparkGlowOpacity: [0.08, 0.35],
    sparkBlur: 1,
    density: [0, "rgba(0,0,0,0)", 0.12, "#f6c9a0", 0.35, "#f08a4a", 0.6, "#d2452a", 0.85, "#a8262a", 1, "#6e1420"],
    sensor: SENSOR_HEX_LIGHT,
    hotspotStroke: "#2a1a12",
    regionLine: "#b5532a",
    riskLine: "#3a2a20",
    selected: "#1a1410",
    signature: "#c2410c",
    signatureGlow: "#f07a2a",
    aoiLine: "#c2410c",
    aoiPoint: "#fffaf2",
  },
} as const;

export const useLayerColors = () => LAYER_COLORS[useMapTheme()];

/** Keep a GeoJSON source in sync with `data`. */
export function useGeoJson(id: string, data: FC | null | undefined, opts: { promoteId?: string } = {}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: data ?? EMPTY, promoteId: opts.promoteId });
    return () => {
      try {
        if (map.getStyle() && map.getSource(id)) {
          for (const l of map.getStyle().layers) if ("source" in l && l.source === id) map.removeLayer(l.id);
          map.removeSource(id);
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id]);
  useEffect(() => {
    (map?.getSource(id) as GeoJSONSource | undefined)?.setData(data ?? EMPTY);
  }, [map, id, data]);
}

export function useLayer(spec: LayerSpecification, before?: string) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(spec.id)) map.addLayer(spec, before && map.getLayer(before) ? before : undefined);
    return () => {
      try {
        if (map.getStyle() && map.getLayer(spec.id)) map.removeLayer(spec.id);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, spec.id]);
  // live paint updates
  const paint = JSON.stringify("paint" in spec ? spec.paint : {});
  const layout = JSON.stringify("layout" in spec ? spec.layout : {});
  useEffect(() => {
    if (!map?.getLayer(spec.id)) return;
    for (const [k, v] of Object.entries(JSON.parse(paint) as Record<string, unknown>)) map.setPaintProperty(spec.id, k, v);
    for (const [k, v] of Object.entries(JSON.parse(layout) as Record<string, unknown>)) map.setLayoutProperty(spec.id, k, v);
  }, [map, spec.id, paint, layout]);
}

export interface HotspotPoint {
  lon: number;
  lat: number;
  sensor: "M" | "V";
  frp: number;
  age: number; // 0 = current week, 1..n = older (afterglow)
}

/** Fire detections: soft glow underneath, crisp core on top, older weeks fade like embers. */
export function HotspotLayer({ points, visible = true, sensors = { M: true, V: true } }: {
  points: HotspotPoint[];
  visible?: boolean;
  sensors?: { M: boolean; V: boolean };
}) {
  const lc = useLayerColors();
  const fc: FC = {
    type: "FeatureCollection",
    features: points
      .filter((p) => sensors[p.sensor])
      .map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { s: p.sensor, f: p.frp, a: p.age } })),
  };
  useGeoJson("hotspots", fc);
  const vis = visible ? "visible" : "none";
  const color: ExpressionSpecification = ["match", ["get", "s"], "M", lc.sensor.modis, lc.sensor.viirs];
  const fade: ExpressionSpecification = ["interpolate", ["linear"], ["get", "a"], 0, 1, 1, 0.45, 3, 0.12];
  useLayer({
    id: "hotspots-glow",
    type: "circle",
    source: "hotspots",
    layout: { visibility: vis },
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        5, ["*", ["case", ["==", ["get", "a"], 0], 1, 0.6], ["+", 2.5, ["*", 0.6, ["ln", ["+", 1, ["get", "f"]]]]]],
        10, ["*", ["case", ["==", ["get", "a"], 0], 1, 0.6], ["+", 10, ["*", 2.5, ["ln", ["+", 1, ["get", "f"]]]]]],
      ],
      "circle-color": ["interpolate", ["linear"], ["get", "a"], 0, "#ff7a2a", 1, "#c22b2a", 3, "#5a1220"],
      "circle-blur": 1,
      "circle-opacity": ["*", 0.38, fade],
    },
  });
  useLayer({
    id: "hotspots-core",
    type: "circle",
    source: "hotspots",
    layout: { visibility: vis },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "s"], "M", 1.8, 1.1], 10, ["match", ["get", "s"], "M", 5, 3]],
      "circle-color": color,
      "circle-opacity": fade,
      "circle-stroke-width": ["match", ["get", "s"], "M", 0.8, 0],
      "circle-stroke-color": lc.hotspotStroke,
      "circle-stroke-opacity": ["*", 0.5, fade],
    },
  });
  return null;
}

/** All-years density heat from the 0.1° grid. */
export function DensityLayer({ cells, visible }: { cells: [number, number, number][]; visible: boolean }) {
  const lc = useLayerColors();
  const fc: FC = {
    type: "FeatureCollection",
    features: cells.map(([lon, lat, n]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { n } })),
  };
  useGeoJson("density", fc);
  useLayer({
    id: "density-heat",
    type: "heatmap",
    source: "density",
    layout: { visibility: visible ? "visible" : "none" },
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["sqrt", ["get", "n"]], 0, 0, 40, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 5, 0.75, 9, 1.8],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 2, 2, 5, 7, 7, 14, 10, 34],
      "heatmap-opacity": 0.9,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], ...lc.density] as ExpressionSpecification,
    },
  });
  return null;
}

export type RegionMode = "outline" | "risk" | "density";

export function RegionsLayer({
  geojson, mode, selected, onHover, onClick, visible = true, leafOnly = true,
}: {
  geojson: FC | null;
  mode: RegionMode;
  selected?: string | null;
  onHover?: (p: { slug: string; name_az: string; name_en: string; risk_level?: string; probability?: number } | null, e?: MapLayerMouseEvent) => void;
  onClick?: (slug: string) => void;
  visible?: boolean;
  leafOnly?: boolean;
}) {
  const map = useMap();
  const lc = useLayerColors();
  useGeoJson("regions", geojson, { promoteId: "id" });
  const filter: ExpressionSpecification = leafOnly ? ["!=", ["get", "level"], "country"] : ["==", ["get", "level"], "country"];
  const vis = visible ? "visible" : "none";
  const riskColor: ExpressionSpecification = [
    "match", ["get", "risk_level"],
    "low", RISK_HEX.low, "moderate", RISK_HEX.moderate, "high", RISK_HEX.high, "very_high", RISK_HEX.very_high, "extreme", RISK_HEX.extreme,
    "rgba(0,0,0,0)",
  ];
  useLayer(
    {
      id: "regions-fill",
      type: "fill",
      source: "regions",
      filter,
      layout: { visibility: vis },
      paint: {
        "fill-color": mode === "risk" ? riskColor : "#ff7a2a",
        "fill-opacity":
          mode === "risk"
            ? ["case", ["boolean", ["feature-state", "hover"], false], 0.62, 0.42]
            : mode === "density"
              ? ["interpolate", ["linear"], ["get", "density"], 0, 0.02, 2, 0.12, 10, 0.4]
              : ["case", ["boolean", ["feature-state", "hover"], false], 0.1, 0.0],
      },
    },
    "places",
  );
  useLayer(
    {
      id: "regions-line",
      type: "line",
      source: "regions",
      filter,
      layout: { visibility: vis },
      paint: {
        "line-color": mode === "risk" ? lc.riskLine : lc.regionLine,
        "line-opacity": mode === "risk" ? 0.55 : 0.28,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1.2],
      },
    },
    "places",
  );
  useLayer(
    {
      id: "regions-selected",
      type: "line",
      source: "regions",
      filter: ["==", ["get", "slug"], selected ?? "__none__"],
      layout: { visibility: vis },
      paint: { "line-color": lc.selected, "line-width": 2.2 },
    },
    "places",
  );

  useEffect(() => {
    if (!map || !visible) return;
    let hovered: number | string | null = null;
    const move = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      if (hovered !== null && hovered !== f.id) map.setFeatureState({ source: "regions", id: hovered }, { hover: false });
      hovered = f.id ?? null;
      if (hovered !== null) map.setFeatureState({ source: "regions", id: hovered }, { hover: true });
      map.getCanvas().style.cursor = onClick ? "pointer" : "";
      onHover?.(f.properties as never, e);
    };
    const leave = () => {
      if (hovered !== null) map.setFeatureState({ source: "regions", id: hovered }, { hover: false });
      hovered = null;
      map.getCanvas().style.cursor = "";
      onHover?.(null);
    };
    const click = (e: MapLayerMouseEvent) => {
      const slug = e.features?.[0]?.properties?.slug;
      if (slug && onClick) onClick(slug);
    };
    map.on("mousemove", "regions-fill", move);
    map.on("mouseleave", "regions-fill", leave);
    map.on("click", "regions-fill", click);
    return () => {
      map.off("mousemove", "regions-fill", move);
      map.off("mouseleave", "regions-fill", leave);
      map.off("click", "regions-fill", click);
    };
  }, [map, onHover, onClick, visible]);
  return null;
}

/** Deterministic PRNG so the spark field is identical on every render. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sparkField(cells: [number, number, number][], deg = 0.1, maxPerCell = 7): FC {
  const rand = mulberry32(2026);
  const max = Math.max(...cells.map((c) => c[2]), 1);
  const features: FC["features"] = [];
  for (const [lon, lat, n] of cells) {
    const k = Math.max(1, Math.round(Math.sqrt(n / max) * maxPerCell));
    for (let i = 0; i < k; i++) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon + (rand() - 0.5) * deg, lat + (rand() - 0.5) * deg] },
        properties: { w: Math.sqrt(n / max) * (0.4 + rand() * 0.6) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Glowing ember sparks — 25 years of detections as a night-lights field. */
export function SparkLayer({ cells, id = "sparks" }: { cells: [number, number, number][]; id?: string }) {
  const lc = useLayerColors();
  const fc = useMemo(() => sparkField(cells), [cells]);
  useGeoJson(id, fc);
  useLayer({
    id: `${id}-glow`,
    type: "circle",
    source: id,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.5, 5, ["+", 2, ["*", 6, ["get", "w"]]], 8, ["+", 6, ["*", 14, ["get", "w"]]]],
      "circle-color": ["interpolate", ["linear"], ["get", "w"], ...lc.sparkGlow] as ExpressionSpecification,
      "circle-blur": lc.sparkBlur,
      "circle-opacity": ["interpolate", ["linear"], ["get", "w"], 0, lc.sparkGlowOpacity[0], 1, lc.sparkGlowOpacity[1]],
    },
  });
  useLayer({
    id: `${id}-core`,
    type: "circle",
    source: id,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 0.4, 5, ["+", 0.5, ["*", 1.4, ["get", "w"]]], 8, ["+", 1, ["*", 3, ["get", "w"]]]],
      "circle-color": ["interpolate", ["linear"], ["get", "w"], ...lc.sparkCore] as ExpressionSpecification,
      "circle-opacity": ["interpolate", ["linear"], ["get", "w"], 0, 0.35, 1, 1],
    },
  });
  return null;
}

/** Azerbaijan, ODLAR's home: a warm tint, a crisp ember border and a soft glow, so it reads
 *  as the signature on a world map without competing with the fire layers. */
export function SignatureLayer({ geojson, country = "az" }: { geojson: FC | null | undefined; country?: string }) {
  const lc = useLayerColors();
  const fc = useMemo<FC | null>(
    () =>
      geojson
        ? {
            type: "FeatureCollection",
            features: geojson.features.filter((f) => f.properties?.level === "country" && f.properties?.country === country),
          }
        : null,
    [geojson, country],
  );
  useGeoJson("signature", fc);
  useLayer(
    { id: "signature-fill", type: "fill", source: "signature", paint: { "fill-color": lc.signature, "fill-opacity": 0.07 } },
    "places",
  );
  useLayer(
    {
      id: "signature-glow",
      type: "line",
      source: "signature",
      paint: {
        "line-color": lc.signatureGlow,
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 4, 6, 10, 10, 16],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 2, 4, 6, 8, 10, 12],
        "line-opacity": 0.35,
      },
    },
    "places",
  );
  useLayer(
    {
      id: "signature-line",
      type: "line",
      source: "signature",
      paint: { "line-color": lc.signature, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 6, 1.6, 10, 2.2], "line-opacity": 0.9 },
    },
    "places",
  );
  return null;
}
