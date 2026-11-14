"use client";

import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import type { Map as MlMap } from "maplibre-gl";
import { useReducedMotion } from "motion/react";
import { BaseMap } from "@/components/map/base-map";
import { SignatureLayer, SparkLayer } from "@/components/map/layers";
import { http } from "@/lib/client";

/** The landing globe. Split out so MapLibre and the fire grid load after the hero text,
 *  instead of riding in the page's HTML. */
export default function HeroMap() {
  const reduce = useReducedMotion();
  const { data } = useQuery({
    queryKey: ["grid"],
    queryFn: () => http<{ cells: [number, number, number][] }>("/grid"),
    staleTime: 30 * 60_000,
  });
  const { data: regions } = useQuery({
    queryKey: ["regions-geojson"],
    queryFn: () => http<FeatureCollection>("/regions/geojson"),
    staleTime: 30 * 60_000,
  });

  const onReady = (map: MlMap) => {
    if (reduce) {
      map.jumpTo({ center: [44.2, 40.6], zoom: 5.1, pitch: 30 });
      return;
    }
    setTimeout(() => {
      const w = map.getContainer().clientWidth;
      map.flyTo({
        center: [46.2, 40.9], zoom: w < 768 ? 4.6 : 5.15, pitch: 44, bearing: -10, duration: 7000, curve: 1.6, essential: true,
        offset: w >= 1024 ? [w * 0.17, -40] : [0, -80],
      });
    }, 600);
    let raf = 0;
    let last = performance.now();
    const drift = (now: number) => {
      if (!map.isMoving()) map.setBearing(map.getBearing() + (now - last) * 0.0012);
      last = now;
      raf = requestAnimationFrame(drift);
    };
    map.once("moveend", () => (raf = requestAnimationFrame(drift)));
    map.once("remove", () => cancelAnimationFrame(raf));
  };

  return (
    // fades in on mount rather than on "load", which waits for every globe tile
    <BaseMap
      className="anim-fade h-full w-full"
      globe
      controls={false}
      terrain={false}
      options={{ center: [30, 25], zoom: 1.15, interactive: false, attributionControl: false }}
      onReady={onReady}
    >
      <SignatureLayer geojson={regions} />
      {data && <SparkLayer cells={data.cells} />}
    </BaseMap>
  );
}
