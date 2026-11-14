// How a calendar cell is painted in both calendars (ring clock and grid), so a
// week with no observation never looks like a week with no fire.
import { heat, isActiveWeek } from "@/lib/colors";
import type { CellState } from "@/lib/calendar-cells";

const empty = (theme: string) => (theme === "dark" ? "rgb(255 240 225 / 0.035)" : "rgb(40 25 10 / 0.05)");

/** A week not observed yet but forecast: the same colour scale, fainter (fainter
 *  still for the usual year beyond the outlook). */
export function aheadOpacity(kind: "outlook" | "typical" | undefined): number {
  return kind === "outlook" ? 0.5 : kind === "typical" ? 0.22 : 1;
}

export function cellFill(state: CellState, v: number, scale: (v: number) => number, theme: string, hatchId: string): string {
  if (state === "nodata") return `url(#${hatchId})`;
  if (state === "future") return v > 0 && isActiveWeek(v) ? heat(scale(v), theme as "dark" | "light") : "transparent";
  return isActiveWeek(v) ? heat(scale(v), theme as "dark" | "light") : empty(theme);
}

/** Diagonal hatching for weeks without an observation. */
export function HatchDefs({ id }: { id: string }) {
  return (
    <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="4" height="4" fill="var(--line)" opacity={0.25} />
      <line x1="0" y1="0" x2="0" y2="4" stroke="var(--text-faint)" strokeWidth="1.2" opacity={0.55} />
    </pattern>
  );
}

export function CellLegend({ labels, reduced }: { labels: { noData: string; reduced: string }; reduced: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-faint">
      <span className="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden>
          <defs>
            <HatchDefs id="legend-hatch" />
          </defs>
          <rect width="12" height="12" rx="2" fill="url(#legend-hatch)" />
        </svg>
        {labels.noData}
      </span>
      {reduced && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-faint" aria-hidden />
          {labels.reduced}
        </span>
      )}
    </div>
  );
}
