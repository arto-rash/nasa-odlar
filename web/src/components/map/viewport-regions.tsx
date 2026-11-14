"use client";

import type { ComponentProps } from "react";
import { RegionsLayer } from "@/components/map/layers";
import { useViewportRegions } from "@/components/map/use-regions";

/** RegionsLayer fed with the regions in view (see useViewportRegions). Use inside <BaseMap>. */
export function ViewportRegionsLayer(props: Omit<ComponentProps<typeof RegionsLayer>, "geojson">) {
  const geojson = useViewportRegions();
  return <RegionsLayer geojson={geojson} {...props} />;
}
