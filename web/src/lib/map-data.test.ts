import { describe, expect, it } from "vitest";
import { packPoints, parsePack, yearsFor } from "./map-data";

function pack() {
  // rate 250, one week (Monday 2023-07-03, day 19541), two detections
  const buf = new ArrayBuffer(12 + 8 + 2 * 5);
  const d = new DataView(buf);
  [250, 1, 2].forEach((v, i) => d.setUint32(i * 4, v, true));
  d.setUint32(12, 19541, true);
  d.setUint32(16, 2, true);
  d.setInt16(20, 4950, true);
  d.setInt16(22, -7312, true);
  d.setInt16(24, 4040, true);
  d.setInt16(26, -3301, true);
  d.setUint8(28, 128 | 32);
  d.setUint8(29, 0);
  return parsePack(buf);
}

describe("week packs", () => {
  it("reads a week's detections with their age", () => {
    const p = pack();
    expect(p.rate).toBe(250);
    const now = packPoints([p], "2023-07-03");
    expect(now).toHaveLength(2);
    expect(now[0]).toMatchObject({ lon: 49.5, lat: 40.4, sensor: "V", age: 0 });
    expect(now[0].frp).toBeCloseTo(Math.expm1(2));
    expect(now[1]).toMatchObject({ lon: -73.12, lat: -33.01, sensor: "M" });
    expect(packPoints([p], "2023-07-17")[0].age).toBe(2);
    expect(packPoints([p], "2023-08-14")).toHaveLength(0);
  });

  it("needs both files around New Year", () => {
    expect(yearsFor("2023-07-03")).toEqual([2023]);
    expect(yearsFor("2024-01-08")).toEqual([2023, 2024]);
    expect(yearsFor("2024-12-30")).toEqual([2024, 2025]);
  });
});
