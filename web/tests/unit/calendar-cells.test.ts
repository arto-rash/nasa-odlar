import { describe, expect, it } from "vitest";
import { spreadOpacity } from "@/components/charts/cell-style";
import { cellState, seasonStatus, weekStart } from "@/lib/calendar-cells";
import type { Coverage, CurrentStatus, SeasonProfile } from "@/lib/types";

// the API bins a Monday into week (day_of_year - 1) // 7, capped at 51
const binOf = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  const doy = Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  return Math.min(Math.floor((doy - 1) / 7), 51);
};

describe("weekStart", () => {
  it("returns a Monday that the API files under the same bin", () => {
    for (const year of [2001, 2012, 2020, 2026]) {
      for (let w = 0; w < 52; w++) {
        const m = weekStart(year, w);
        expect(new Date(m + "T00:00:00Z").getUTCDay()).toBe(1);
        expect(binOf(m)).toBe(w);
        expect(m.startsWith(String(year))).toBe(true);
      }
    }
  });
});

const cov: Coverage = { start: "2000-10-30", end: "2026-11-05", viirs_start: "2012-01-16", gaps: [{ week: "2001-06-18", level: "none" }, { week: "2002-03-18", level: "reduced" }] };

describe("cellState", () => {
  it("marks weeks before the record, outages, the filling week and the future", () => {
    expect(cellState(2000, 0, cov)).toBe("nodata");
    expect(cellState(2000, 43, cov)).toBe("ok"); // 2000-10-30
    expect(cellState(2001, binOf("2001-06-18"), cov)).toBe("nodata");
    expect(cellState(2002, binOf("2002-03-18"), cov)).toBe("reduced");
    expect(cellState(2026, binOf("2026-11-02"), cov)).toBe("partial");
    expect(cellState(2026, binOf("2026-11-09"), cov)).toBe("future");
    expect(cellState(2015, 10, null)).toBe("ok");
  });
});

const season = { start: 10, end: 30, peak_week: 20, critical: [{ start: 18, end: 22, weeks: 5, share: 0.4 }], annual_mean: 50 } as unknown as SeasonProfile;
const now = (woy: number, value = 10, median = 5) => ({ woy, week_value: value, week_median: median }) as CurrentStatus;

describe("seasonStatus", () => {
  it("reads peak, in season, soon and later", () => {
    expect(seasonStatus(season, now(20))).toEqual({ kind: "peak", ratio: 2 });
    expect(seasonStatus(season, now(25))).toEqual({ kind: "in", weeksLeft: 5, ratio: 2 });
    expect(seasonStatus(season, now(5))).toEqual({ kind: "soon", weeks: 5 });
    expect(seasonStatus(season, now(40))).toEqual({ kind: "later", startWeek: 10 });
  });
  it("handles seasons over the new year and quiet places", () => {
    const winter = { ...season, start: 48, end: 6, critical: [{ start: 50, end: 2, weeks: 5, share: 0.5 }] } as SeasonProfile;
    expect(seasonStatus(winter, now(1)).kind).toBe("peak");
    expect(seasonStatus(winter, now(4))).toEqual({ kind: "in", weeksLeft: 2, ratio: 2 });
    expect(seasonStatus(winter, now(44))).toEqual({ kind: "soon", weeks: 4 });
    expect(seasonStatus({ ...season, annual_mean: 0.2 }, now(20))).toEqual({ kind: "none" });
    expect(seasonStatus(season, now(20, 1, 0.1))).toEqual({ kind: "peak", ratio: null });
  });
});


describe("spreadOpacity", () => {
  it("is full where exact and fades with a wider range, never below half", () => {
    expect(spreadOpacity(0)).toBe(1);
    expect(spreadOpacity(undefined)).toBe(1);
    expect(spreadOpacity(1)).toBeCloseTo(0.75);
    expect(spreadOpacity(1.8)).toBeLessThan(0.65);
    expect(spreadOpacity(50)).toBe(0.5);
  });
});
