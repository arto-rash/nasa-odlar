"use client";

import { useLocale } from "next-intl";
import { cn } from "@/lib/cn";
import { placeLabel, type AppLocale, type Placed } from "@/lib/format";

/** The small line under a region's name: its country (and state, for the local
 *  units of a big country). Renders nothing for a country itself. */
export function RegionPlace({
  r, className,
}: {
  r: Placed | undefined | null;
  className?: string;
}) {
  const label = placeLabel(r, useLocale() as AppLocale);
  if (!label) return null;
  return <span className={cn("block truncate text-[12px] font-normal leading-snug text-faint", className)}>{label}</span>;
}
