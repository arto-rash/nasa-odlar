import { describe, expect, it } from "vitest";
import { fold, matchScore } from "@/lib/search";
import { pctPerDecade, theilSen } from "@/lib/stats";
import { heatScale } from "@/lib/colors";

describe("diacritic-insensitive search", () => {
  it("folds Azerbaijani letters", () => {
    expect(fold("Şəki")).toBe("seki");
    expect(fold("Qəbələ")).toBe("qebele");
    expect(fold("İsmayıllı")).toBe("ismayilli");
    expect(fold("Göygöl")).toBe("goygol");
  });
  it("ranks prefix above substring", () => {
    expect(matchScore("sab", "Sabirabad rayonu")).toBeGreaterThan(matchScore("bad", "Sabirabad rayonu"));
    expect(matchScore("xyz", "Sabirabad")).toBe(0);
    expect(matchScore("", "anything")).toBe(1);
    expect(matchScore("rayonu", "Sabirabad rayonu")).toBeGreaterThan(0.5);
  });
});

describe("Theil–Sen", () => {
  it("recovers an exact line and ignores outliers", () => {
    const xs = [2001, 2002, 2003, 2004, 2005, 2006, 2007];
    const ys = xs.map((x) => 3 * (x - 2000) + 10);
    ys[3] = 500;
    const { slope, intercept } = theilSen(xs, ys);
    expect(slope).toBeCloseTo(3);
    expect(intercept + slope * 2001).toBeCloseTo(13);
  });
  it("percent per decade of a flat series is zero", () => {
    expect(pctPerDecade([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
  });
});

describe("heat scale", () => {
  it("is 0 at zero, monotone, capped at 1", () => {
    const s = heatScale([0, 1, 2, 4, 8, 100]);
    expect(s(0)).toBe(0);
    expect(s(1)).toBeLessThan(s(4));
    expect(s(1e6)).toBe(1);
  });
});
