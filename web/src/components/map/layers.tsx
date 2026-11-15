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
    density: [0, "rgba(0,0,0,0)", 0.12, "#3d1218", 0.3, "#7a1526", 0.5, "#c22b2a", 0.7, "#f0592a", 0.85, "#ff9a3d", 1, "#fff3d6"],
    sensor: SENSOR_HEX,
    // ember halo behind each detection, by age (glows on the dark basemap)
    hotspotGlow: ["interpolate", ["linear"], ["get", "a"], 0, "#ff7a2a", 1, "#c22b2a", 3, "#5a1220"] as ExpressionSpecification | null,
    hotspotGlowOpacity: 0.38,
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
    density: [0, "rgba(0,0,0,0)", 0.12, "#f6c9a0", 0.35, "#f08a4a", 0.6, "#d2452a", 0.85, "#a8262a", 1, "#6e1420"],
    sensor: SENSOR_HEX_LIGHT,
    // on the light basemap a faint halo in the dot's own colour: an orange halo
    // under blue dots mixes into green
    hotspotGlow: null as ExpressionSpecification | null,
    hotspotGlowOpacity: 0.14,
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
  // live paint, layout and filter updates
  const paint = JSON.stringify("paint" in spec ? spec.paint : {});
  const layout = JSON.stringify("layout" in spec ? spec.layout : {});
  const filter = JSON.stringify("filter" in spec ? (spec.filter ?? null) : null);
  useEffect(() => {
    if (!map?.getLayer(spec.id)) return;
    for (const [k, v] of Object.entries(JSON.parse(paint) as Record<string, unknown>)) map.setPaintProperty(spec.id, k, v);
    for (const [k, v] of Object.entries(JSON.parse(layout) as Record<string, unknown>)) map.setLayoutProperty(spec.id, k, v);
    map.setFilter(spec.id, JSON.parse(filter));
  }, [map, spec.id, paint, layout, filter]);
}

export interface HotspotPoint {
  lon: number;
  lat: number;
  sensor: "M" | "V";
  frp: number;
  age: number; // 0 = current week, 1..n = older (afterglow)
}

/** Fire detections: soft glow underneath, crisp core on top, older weeks fade like embers. */
/** On satellite imagery the map's usual dot colours vanish (cyan in clouds and sea,
 *  glow over bright ground): bolder colours, a dark rim and no haze instead. */
export const SATELLITE_SENSOR_HEX = { modis: "#ffd23f", viirs: "#ff4d2e" };

export function HotspotLayer({ points, visible = true, sensors = { M: true, V: true }, onImagery = false }: {
  points: HotspotPoint[];
  visible?: boolean;
  sensors?: { M: boolean; V: boolean };
  /** drawn over satellite imagery */
  onImagery?: boolean;
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
  const sensorHex = onImagery ? SATELLITE_SENSOR_HEX : lc.sensor;
  const color: ExpressionSpecification = ["match", ["get", "s"], "M", sensorHex.modis, sensorHex.viirs];
  const fade: ExpressionSpecification = onImagery
    ? ["interpolate", ["linear"], ["get", "a"], 0, 1, 1, 0.7, 3, 0.35]
    : ["interpolate", ["linear"], ["get", "a"], 0, 1, 1, 0.45, 3, 0.12];
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
      "circle-color": onImagery ? color : lc.hotspotGlow ?? color,
      "circle-blur": 1,
      "circle-opacity": ["*", onImagery ? 0.25 : lc.hotspotGlowOpacity, fade],
    },
  });
  useLayer({
    id: "hotspots-core",
    type: "circle",
    source: "hotspots",
    layout: { visibility: vis },
    paint: {
      "circle-radius": onImagery
        ? ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "s"], "M", 3.2, 2.4], 10, ["match", ["get", "s"], "M", 8, 6]]
        : ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "s"], "M", 1.8, 1.1], 10, ["match", ["get", "s"], "M", 5, 3]],
      "circle-color": color,
      "circle-opacity": fade,
      "circle-stroke-width": onImagery ? ["interpolate", ["linear"], ["zoom"], 5, 0.9, 10, 1.6] : ["match", ["get", "s"], "M", 0.8, 0],
      "circle-stroke-color": onImagery ? "#1a0d06" : lc.hotspotStroke,
      "circle-stroke-opacity": onImagery ? ["*", 0.9, fade] : ["*", 0.5, fade],
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

export type RegionMode = "outline" | "risk" | "density" | "forecast";

/** Expected detections per 1,000 km² in a week ahead (feature-state "fd", see ForecastStates). */
export const FORECAST_STOPS: [number, string][] = [
  [0.02, "#f6c9a0"], [0.1, "#f39a5a"], [0.5, "#e2562a"], [2, "#b8321c"], [8, "#7a1616"],
];

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
        "fill-color": mode === "risk" ? riskColor : mode === "forecast"
          ? ["interpolate", ["linear"], ["coalesce", ["feature-state", "fd"], 0], ...FORECAST_STOPS.flat()] as ExpressionSpecification
          : "#ff7a2a",
        "fill-opacity":
          mode === "forecast"
            ? ["case", ["<", ["coalesce", ["feature-state", "fd"], 0], 0.01], 0,
              ["boolean", ["feature-state", "hover"], false], 0.85, 0.66] as ExpressionSpecification
            : mode === "risk"
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
