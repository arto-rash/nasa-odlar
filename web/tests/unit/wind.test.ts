import { describe, expect, it } from "vitest";
import { compass } from "@/components/ui/wind";

describe("compass", () => {
  it("names the 8 points, wrapping round north", () => {
    expect(compass(0)).toBe("n");
    expect(compass(359)).toBe("n");
    expect(compass(44)).toBe("ne");
    expect(compass(315)).toBe("nw");
    expect(compass(180 + 315)).toBe("se"); // downwind of a north-westerly
    expect(compass(-90)).toBe("w");
  });
});
