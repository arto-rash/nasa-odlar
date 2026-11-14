"use client";

import type { ComponentProps } from "react";
import { RegionsLayer } from "@/components/map/layers";
import { useViewportRegions } from "@/components/map/use-regions";
import type { ForecastMap } from "@/lib/types";
import { ForecastStates } from "./forecast-states";

/** RegionsLayer fed with the regions in view (see useViewportRegions). Use inside <BaseMap>.
 *  With ``forecast`` (mode "forecast") the shapes are coloured by that week ahead. */
export function ViewportRegionsLayer({ forecast, ...props }: Omit<ComponentProps<typeof RegionsLayer>, "geojson" | "leafOnly"> & { forecast?: ForecastMap }) {
  const { geojson, countries } = useViewportRegions();
  // zoomed out the API sends country outlines (risk = area-weighted over provinces)
  return (
    <>
      <RegionsLayer geojson={geojson} leafOnly={!countries} {...props} />
      {props.mode === "forecast" && <ForecastStates data={forecast} sourceKey={geojson} />}
    </>
  );
}
