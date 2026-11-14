// What a calendar cell (year × week-of-year bin) stands for: its dates, whether the
// satellites were observing, and where the region is in its fire season.
import type { Coverage, CurrentStatus, ForecastPayload, SeasonProfile } from "./types";

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The Monday the record files under this cell. Bins are 7-day blocks counted from
 *  1 January (week 51 takes the last 8–9 days), and every record week is a Monday,
 *  so each bin holds exactly one Monday that starts it (two for the last bin). */
export function weekStart(year: number, woy: number): string {
  const first = Date.UTC(year, 0, 1) + woy * 7 * DAY;
  const dow = new Date(first).getUTCDay(); // 0 Sunday … 6 Saturday
  return iso(first + ((8 - dow) % 7) * DAY);
}

export type CellState = "ok" | "nodata" | "reduced" | "partial" | "future";

export function cellState(year: number, woy: number, cov: Coverage | null | undefined): CellState {
  if (!cov) return "ok";
  const start = weekStart(year, woy);
  if (start < cov.start) return "nodata";
  if (start > cov.end) return "future";
  if (iso(new Date(start + "T00:00:00Z").getTime() + 6 * DAY) > cov.end) return "partial";
  const gap = cov.gaps.find((g) => g.week === start);
  return gap ? (gap.level === "none" ? "nodata" : "reduced") : "ok";
}

export type SeasonStatus =
  | { kind: "peak"; ratio: number | null }
  | { kind: "in"; weeksLeft: number; ratio: number | null }
  | { kind: "soon"; weeks: number }
  | { kind: "later"; startWeek: number }
  | { kind: "none" };

const within = (w: number, a: number, b: number) => (a <= b ? w >= a && w <= b : w >= a || w <= b);
const ahead = (from: number, to: number) => (to - from + 52) % 52;

/** Where this week sits in the region's usual fire season. */
export function seasonStatus(season: SeasonProfile | null | undefined, current: CurrentStatus | null | undefined): SeasonStatus {
  if (!season || !current || season.start == null || season.end == null || season.annual_mean < 1) return { kind: "none" };
  const w = current.woy;
  const ratio = current.week_median && current.week_median > 0.5 ? current.week_value / current.week_median : null;
  if (within(w, season.start, season.end)) {
    const crit = season.critical[0];
    if (crit && within(w, crit.start, crit.end)) return { kind: "peak", ratio };
    return { kind: "in", weeksLeft: ahead(w, season.end), ratio };
  }
  const weeks = ahead(w, season.start);
  return weeks <= 8 ? { kind: "soon", weeks } : { kind: "later", startWeek: season.start };
}

/** The weeks ahead by Monday: the outlook's expected value, or the usual one after it. */
export type AheadCells = Map<string, { value: number; usual: number; kind: "outlook" | "typical" }>;

export function aheadCells(f: ForecastPayload | null | undefined): AheadCells {
  const m: AheadCells = new Map();
  for (const w of f?.weeks ?? []) m.set(w.week, { value: w.kind === "outlook" ? (w.q50 ?? 0) : w.normal, usual: w.normal, kind: w.kind });
  return m;
}
