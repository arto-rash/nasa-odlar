"use client";

import { useEffect } from "react";
import { useMap } from "./base-map";

/** Cloud-free Sentinel-2 mosaic (EOX, free for non-commercial use): sharp to close zoom. */
const S2 = {
  tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"],
  maxzoom: 14,
  attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
};

/** NASA GIBS true colour for one day. Suomi NPP's imagery stops in Nov 2026, so
 *  VIIRS comes from NOAA-20 (from April 2018); earlier days use MODIS Terra. */
export function nasaDayLayer(date: string): string {
  return date >= "2018-04-01" ? "VIIRS_NOAA20_CorrectedReflectance_TrueColor" : "MODIS_Terra_CorrectedReflectance_TrueColor";
}

const gibsTiles = (date: string) => [
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${nasaDayLayer(date)}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
];

// under the borders and labels, over the plain land and water fills
const BEFORE = "roads";

/** Satellite imagery under the map's borders and labels: the cloud-free mosaic,
 *  and optionally NASA's picture of one day on top (smoke and burn scars show). */
export function ImageryLayers({ day }: { day: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const before = map.getLayer(BEFORE) ? BEFORE : undefined;
    map.addSource("sat-s2", { type: "raster", tiles: S2.tiles, tileSize: 256, maxzoom: S2.maxzoom, attribution: S2.attribution });
    map.addLayer({ id: "sat-s2", type: "raster", source: "sat-s2", paint: { "raster-fade-duration": 200 } }, before);
    return () => {
      try {
        if (map.getStyle() && map.getLayer("sat-s2")) map.removeLayer("sat-s2");
        if (map.getStyle() && map.getSource("sat-s2")) map.removeSource("sat-s2");
      } catch {}
    };
  }, [map]);
  useEffect(() => {
    if (!map || !day) return;
    const before = map.getLayer(BEFORE) ? BEFORE : undefined;
    map.addSource("sat-day", {
      type: "raster",
      tiles: gibsTiles(day),
      tileSize: 256,
      maxzoom: 9,
      attribution: `NASA EOSDIS GIBS (${nasaDayLayer(day).startsWith("VIIRS") ? "VIIRS NOAA-20" : "MODIS Terra"}, ${day})`,
    });
    map.addLayer({ id: "sat-day", type: "raster", source: "sat-day", // a 375 m picture: fade it out as the zoom passes its sharpness, the mosaic shows through
      paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.92, 11, 0.3], "raster-fade-duration": 200 } }, before);
    return () => {
      try {
        if (map.getStyle() && map.getLayer("sat-day")) map.removeLayer("sat-day");
        if (map.getStyle() && map.getSource("sat-day")) map.removeSource("sat-day");
      } catch {}
    };
  }, [map, day]);
  return null;
}
