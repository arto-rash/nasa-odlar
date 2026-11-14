import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // third-party tile/glyph hiccups are not app errors
    if (/tiles\.openfreemap|elevation-tiles|Failed to load resource/.test(t)) return;
    errors.push(t);
  });
  return errors;
}

export async function expectAccessible(page: Page, exclude: string[] = []) {
  // reveal scroll-triggered content the way a reader would, then let entrances finish
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1800);
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude(".maplibregl-canvas");
  for (const e of exclude) b = b.exclude(e);
  const res = await b.analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}
