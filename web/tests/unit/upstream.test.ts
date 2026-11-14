import { afterEach, describe, expect, it, vi } from "vitest";

describe("gateway → analytics path mapping", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps region sub-resources to FastAPI paths", async () => {
    const { mlPath } = await import("@/lib/upstream");
    expect(mlPath("/regions/az-sabirabad/calendar")).toBe("/calendar/az-sabirabad");
    expect(mlPath("/regions/az-sabirabad/risk")).toBe("/risk/az-sabirabad");
    expect(mlPath("/regions/az/series/weekly")).toBe("/series/az/weekly");
    expect(mlPath("/regions/az/series/annual")).toBe("/series/az/annual");
    expect(mlPath("/regions/geojson")).toBe("/regions/geojson");
    expect(mlPath("/hotspots")).toBe("/hotspots");
    expect(mlPath("/status")).toBe("/health");
  });

  it("refuses gateway-only resources in direct mode", async () => {
    const { mlPath } = await import("@/lib/upstream");
    expect(mlPath("/auth/login")).toBeNull();
    expect(mlPath("/subscriptions/3")).toBeNull();
    expect(mlPath("/alerts")).toBeNull();
  });
});
