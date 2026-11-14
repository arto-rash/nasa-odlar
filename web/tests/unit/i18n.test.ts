import { describe, expect, it } from "vitest";
import az from "../../messages/az.json";
import en from "../../messages/en.json";

function keys(o: unknown, p = ""): string[] {
  if (Array.isArray(o)) return [p];
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k));
  return [p];
}
function get(o: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);
}
const placeholders = (s: string) => [...s.matchAll(/\{([a-z]\w*)[,}]/g)].map((m) => m[1]).sort();

describe("message catalogues", () => {
  it("have identical key sets", () => {
    expect(keys(az).sort()).toEqual(keys(en).sort());
  });
  it("use the same placeholders in both languages", () => {
    for (const k of keys(en)) {
      const a = get(az, k);
      const e = get(en, k);
      if (typeof a === "string" && typeof e === "string") expect(placeholders(a), k).toEqual(placeholders(e));
    }
  });
  it("have no empty strings", () => {
    for (const k of keys(az)) expect(String(get(az, k)).trim().length, k).toBeGreaterThan(0);
  });
  it("Azerbaijani text actually uses Azerbaijani letters", () => {
    expect(JSON.stringify(az)).toMatch(/ə/);
  });
});
