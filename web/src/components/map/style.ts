import type { StyleSpecification } from "maplibre-gl";

const PALETTE = {
  dark: {
    land: "#14110e", water: "#07090b", waterLine: "#1a2226", forest: "#171611", grass: "#16130f",
    border: "#5d5148", borderSub: "#2c2621", road: "#221d19", label: "#9c8f84", labelHalo: "#0b0907",
    shadow: "#000000", highlight: "#3a2f27", accent: "#2b211b",
  },
  light: {
    land: "#ece2d3", water: "#b9d0d8", waterLine: "#93b2bd", forest: "#dcdcc0", grass: "#e6dcc4",
    border: "#6f5f52", borderSub: "#b9a996", road: "#ddd0bd", label: "#4d4239", labelHalo: "#f6f1e9",
    shadow: "#6b5340", highlight: "#fffaf2", accent: "#d6c4ab",
  },
};

export function buildStyle({
  theme, locale, terrain = true, globe = false,
}: {
  theme: "dark" | "light";
  locale: "az" | "en";
  terrain?: boolean;
  globe?: boolean;
}): StyleSpecification {
  const c = PALETTE[theme];
  const name = ["coalesce", ["get", `name:${locale}`], ["get", "name:latin"], ["get", "name"]];
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    projection: globe ? { type: "globe" } : { type: "mercator" },
    sky: globe
      ? {
          "sky-color": theme === "dark" ? "#0b0907" : "#f6f5f2",
          "horizon-color": theme === "dark" ? "#3a1a12" : "#f2c4a0",
          "fog-color": theme === "dark" ? "#0b0907" : "#f6f5f2",
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 0.6, 7, 0],
        }
      : undefined,
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenFreeMap © OpenStreetMap" },
      ...(terrain
        ? {
            dem: {
              type: "raster-dem",
              tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
              tileSize: 256,
              encoding: "terrarium",
              maxzoom: 12,
              attribution: "Terrain: Mapzen / AWS",
            },
          }
        : {}),
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.land } },
      {
        id: "landcover",
        type: "fill",
        source: "omt",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "farmland"]]],
        paint: {
          "fill-color": ["match", ["get", "class"], "wood", c.forest, c.grass],
          "fill-opacity": 0.8,
        },
      },
      ...(terrain
        ? [
            {
              id: "hillshade",
              type: "hillshade" as const,
              source: "dem",
              paint: {
                "hillshade-shadow-color": c.shadow,
                "hillshade-highlight-color": c.highlight,
                "hillshade-accent-color": c.accent,
                "hillshade-exaggeration": theme === "dark" ? 0.55 : 0.45,
                "hillshade-illumination-direction": 315,
              },
            },
          ]
        : []),
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.water } },
      {
        id: "water-line",
        type: "line",
        source: "omt",
        "source-layer": "water",
        paint: { "line-color": c.waterLine, "line-width": 0.6 },
      },
      {
        id: "rivers",
        type: "line",
        source: "omt",
        "source-layer": "waterway",
        filter: ["==", ["get", "class"], "river"],
        minzoom: 5,
        paint: { "line-color": c.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1.4] },
      },
      {
        id: "roads",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        minzoom: 6,
        paint: { "line-color": c.road, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 12, 2] },
      },
      {
        id: "border-sub",
        type: "line",
        source: "omt",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        minzoom: 3,
        paint: {
          "line-color": c.borderSub,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.3, 8, 0.7],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.35, 6, 1],
          "line-dasharray": [2, 2],
        },
      },
      {
        id: "border",
        type: "line",
        source: "omt",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": c.border, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.4, 8, 1.2] },
      },
      {
        id: "places",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        minzoom: 5,
        layout: {
          "text-field": name as never,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "class"], "city", 11, 9], 10, 13],
          "text-letter-spacing": 0.04,
          "text-max-width": 8,
        },
        paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "countries",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "country"],
        maxzoom: 7,
        layout: {
          "text-field": name as never,
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 4, 11],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.25,
        },
        paint: { "text-color": c.label, "text-opacity": theme === "dark" ? 0.7 : 0.8, "text-halo-color": c.labelHalo, "text-halo-width": 1 },
      },
    ],
  } as StyleSpecification;
}

export const CAUCASUS_BOUNDS: [[number, number], [number, number]] = [
  [39.6, 38.3],
  [50.9, 43.7],
];
