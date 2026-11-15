import { describe, expect, it } from "vitest";
import { fmtCompact, fmtDate, fmtNum, fmtPct, regionName, shortName, weekLabel, weekRange } from "@/lib/format";

describe("formatting is deterministic for both locales", () => {
  it("numbers", () => {
    expect(fmtNum(1234567.891, "en", 2)).toBe("1,234,567.89");
    expect(fmtNum(1234567.891, "az", 2)).toBe("1 234 567,89");
    expect(fmtNum(-3.5, "en", 1)).toBe("−3.5");
    expect(fmtNum(-0.01, "en", 0)).toBe("0");
    expect(fmtNum(null, "en")).toBe("–");
    expect(fmtNum(Number.NaN, "az")).toBe("–");
  });
  it("percentages with sign", () => {
    expect(fmtPct(0.123, "en", 1, true)).toBe("+12.3%");
    expect(fmtPct(-0.62, "az", 0, true)).toBe("−62%");
    expect(fmtPct(0, "en", 0, true)).toBe("0%");
  });
  it("compact", () => {
    expect(fmtCompact(414948, "en")).toBe("415k");
    expect(fmtCompact(414948, "az")).toBe("415 min");
    expect(fmtCompact(2_500_000, "en")).toBe("2.5M");
    expect(fmtCompact(7, "en")).toBe("7");
  });
  it("dates", () => {
    expect(fmtDate("2026-10-24", "az", { day: "numeric", month: "long", year: "numeric" })).toBe("24 oktyabr 2026");
    expect(fmtDate("2026-10-24", "en", { day: "numeric", month: "short", year: "numeric" })).toBe("24 Oct 2026");
  });
  it("week labels", () => {
    expect(weekLabel(29, "en")).toBe("late July");
    expect(weekLabel(29, "az")).toBe("iyul sonu");
    expect(weekLabel(null, "en")).toBe("–");
    expect(weekRange(22, 34, "en")).toBe("early June – late August");
  });
  it("region names", () => {
    const r = { name_en: "Shaki District", name_az: "Şəki rayonu" };
    expect(regionName(r, "az")).toBe("Şəki rayonu");
    expect(shortName(r, "az")).toBe("Şəki");
    expect(shortName(r, "en")).toBe("Shaki");
  });
});
