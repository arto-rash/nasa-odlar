import { describe, expect, it } from "vitest";
import { monthVerdict } from "@/components/region/month-panel";

const m = (ratio: number | null, rank = 10, value = 5) => ({ value, median: 10, ratio, rank, n_years: 26 });

describe("monthVerdict", () => {
  it("reads the ratio and the rank", () => {
    expect(monthVerdict(m(2.8, 3))).toBe("record");
    expect(monthVerdict(m(1.6, 8))).toBe("above");
    expect(monthVerdict(m(1.0))).toBe("normal");
    expect(monthVerdict(m(0.4))).toBe("below");
  });
  it("handles weeks that usually have no fires", () => {
    expect(monthVerdict(m(null, 1, 3))).toBe("unusual");
    expect(monthVerdict(m(null, 1, 0))).toBe("quiet");
  });
});
