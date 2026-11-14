import { describe, expect, it } from "vitest";
import { nasaDayLayer } from "@/components/map/imagery";

describe("nasaDayLayer", () => {
  it("uses NOAA-20 VIIRS from 2018 and MODIS Terra before (Suomi NPP has stopped)", () => {
    expect(nasaDayLayer("2026-11-10")).toBe("VIIRS_NOAA20_CorrectedReflectance_TrueColor");
    expect(nasaDayLayer("2015-07-01")).toBe("MODIS_Terra_CorrectedReflectance_TrueColor");
  });
});
