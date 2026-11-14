import { describe, expect, it } from "vitest";
import { clockLayout, hitTest, polar, ringRadii, sectorPath, TAU, weekAngle, windowAngles } from "@/components/charts/fire-clock-geometry";

describe("fire clock geometry", () => {
  const L = clockLayout(600, 25);

  it("rings tile the annulus exactly", () => {
    expect(ringRadii(L, 0)[0]).toBeCloseTo(L.inner);
    expect(ringRadii(L, 24)[1]).toBeCloseTo(L.outer);
    for (let i = 1; i < 25; i++) expect(ringRadii(L, i)[0]).toBeCloseTo(ringRadii(L, i - 1)[1]);
  });

  it("week 0 starts at twelve o'clock and weeks go clockwise", () => {
    const [x, y] = polar(L, weekAngle(0), 100);
    expect(x).toBeCloseTo(L.cx);
    expect(y).toBeCloseTo(L.cy - 100);
    const [x13] = polar(L, weekAngle(13), 100);
    expect(x13).toBeGreaterThan(L.cx + 99);
  });

  it("hit test inverts polar for every cell centre", () => {
    for (const yi of [0, 7, 24])
      for (const w of [0, 12, 26, 51]) {
        const r = (ringRadii(L, yi)[0] + ringRadii(L, yi)[1]) / 2;
        const [x, y] = polar(L, weekAngle(w + 0.5), r);
        expect(hitTest(L, x, y)).toEqual({ yearIndex: yi, week: w });
      }
  });

  it("hit test ignores the centre and the outside", () => {
    expect(hitTest(L, L.cx, L.cy)).toBeNull();
    expect(hitTest(L, 0, 0)).toBeNull();
  });

  it("wrapping windows span the new year", () => {
    const [a0, a1] = windowAngles(50, 2);
    expect(a0).toBeCloseTo(weekAngle(50));
    expect(a1 - a0).toBeCloseTo((5 / 52) * TAU);
  });

  it("sector paths are closed and finite", () => {
    const d = sectorPath(L, 100, 110, 0, 0.1);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
