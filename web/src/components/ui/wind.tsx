"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

const POINTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type Compass = (typeof POINTS)[number];

/** The 8-point compass name for a bearing in degrees. */
export function compass(deg: number): Compass {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** An arrow pointing where the wind blows to (from + 180°): the way a fire is pushed. */
export function WindArrow({ from, className, title }: { from: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g transform={`rotate(${(from + 180) % 360} 8 8)`}>
        <path d="M8 1.5 12.5 9H9.4v5.5H6.6V9H3.5z" fill="currentColor" />
      </g>
    </svg>
  );
}

/** "from the north-west, pushing fires south-east" */
export function useWindText() {
  const t = useTranslations("wind");
  return (from: number) => t("fromTo", { from: t(`from.${compass(from)}`), to: t(`to.${compass(from + 180)}`) });
}
