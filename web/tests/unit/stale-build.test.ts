import { describe, expect, it } from "vitest";
import { isStaleBuildError } from "@/lib/stale-build";

describe("isStaleBuildError", () => {
  it("spots a missing chunk after a deploy", () => {
    const e = new Error("Loading chunk 123 failed.");
    e.name = "ChunkLoadError";
    expect(isStaleBuildError(e)).toBe(true);
    expect(isStaleBuildError(new TypeError("Failed to fetch dynamically imported module: /_next/x.js"))).toBe(true);
    expect(isStaleBuildError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("leaves real bugs alone", () => {
    expect(isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isStaleBuildError("boom")).toBe(false);
  });
});
