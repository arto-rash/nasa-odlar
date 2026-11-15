import { expect, test } from "@playwright/test";
import { expectAccessible, trackErrors } from "./helpers";

test.describe("landing", () => {
  test("renders the story in Azerbaijani with live numbers", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/az");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("25 illik yanğın tarixi. Vahid miqyasda.");
    await expect(page.getByText("Arxiv iki yerə bölünüb")).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await page.getByText("Hər bölgənin öz yanğın saatı var").scrollIntoViewIfNeeded();
    await expect(page.getByRole("img", { name: /dairəvi təqvimi/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("root picks the visitor's language, Azerbaijani first", async ({ browser, page }) => {
    const az = await browser.newContext({ locale: "az-AZ" });
    const p = await az.newPage();
    await p.goto("/");
    await expect(p).toHaveURL(/\/az$/);
    await az.close();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("25 years of fire. One consistent record.");
  });

  test("is accessible", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2500);
    await expectAccessible(page);
  });
});

test.describe("region page", () => {
  test("shows calendar, risk and history and switches views", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/region/az-sabirabad");
    await expect(page.getByRole("heading", { level: 1, name: "Sabirabad District" })).toBeVisible();
    await expect(page.getByText("Fire clock").first()).toBeVisible();
    await expect(page.getByText("Next 7 days").first()).toBeVisible();
    await page.getByRole("radio", { name: "Raw" }).click();
    await expect(page.getByRole("radio", { name: "Raw" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Linear" }).click();
    await expect(page.locator("svg rect").first()).toBeVisible();
    await expect(page.getByText("25-year history")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("unknown region is a 404", async ({ page }) => {
    await page.goto("/region/nowhere");
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(page.getByText("This page has burned down")).toBeVisible();
  });

  test("is accessible", async ({ page }) => {
    await page.goto("/az/region/az");
    await page.waitForTimeout(2500);
    await expectAccessible(page);
  });
});

test.describe("explore", () => {
  test("timeline scrubs with the keyboard and plays", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/explore?w=2025-08-04");
    const slider = page.getByRole("slider", { name: "Timeline of weekly detections" });
    await expect(slider).toHaveAttribute("aria-valuetext", "2025-08-04");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", "2025-08-11");
    await expect(page).toHaveURL(/w=2025-08-11/);
    await expect(page.getByText(/\d[\d,]* points/)).toBeVisible();
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.waitForTimeout(1600);
    await page.getByRole("button", { name: "Pause" }).click();
    expect(await slider.getAttribute("aria-valuetext")).not.toBe("2025-08-11");
    await page.getByRole("switch", { name: "Risk (next 7 days)" }).click();
    await expect(page.getByRole("switch", { name: "Risk (next 7 days)" })).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });

  test("draws an area of interest and gets its calendar", async ({ page }) => {
    await page.goto("/explore?w=2025-08-04");
    await page.locator('[data-map-ready="true"]').waitFor();
    await page.getByRole("button", { name: /Draw area/ }).click();
    const canvas = page.locator(".maplibregl-canvas");
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width * 0.72;
    const cy = box.y + box.height * 0.55;
    for (const [dx, dy] of [[-60, -50], [70, -40], [60, 60], [-50, 50]]) await page.mouse.click(cx + dx, cy + dy);
    await page.mouse.click(cx - 60, cy - 50); // close on the first vertex
    await expect(page.getByText("Your area").last()).toBeVisible();
    await expect(page.getByText(/km²/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: /Radial calendar/ }).last()).toBeVisible();
  });
});

test.describe("risk", () => {
  test("ranking opens a region with drivers and outlook", async ({ page }) => {
    await page.goto("/risk");
    await expect(page.getByRole("heading", { name: "Risk map" })).toBeVisible();
    await page.locator("aside ol button").first().click();
    await expect(page.getByText("Why?")).toBeVisible();
    await expect(page.getByText("Season outlook · 13 weeks")).toBeVisible();
    await expect(page).toHaveURL(/r=/);
  });
});

test.describe("compare", () => {
  test("before/after slider responds to the keyboard", async ({ page }) => {
    await page.goto("/compare");
    const s = page.getByRole("slider", { name: "Drag" });
    await expect(s).toHaveAttribute("aria-valuenow", "50");
    // the slider is server-rendered; a key pressed before hydration is lost
    await page.waitForLoadState("networkidle");
    await s.focus();
    await page.keyboard.press("ArrowRight");
    await expect(s).toHaveAttribute("aria-valuenow", "55");
    await expect(page.getByText("Leave one year out", { exact: false })).toBeVisible();
  });
});

test.describe("methodology & data", () => {
  test("methodology shows live validation numbers", async ({ page }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { name: "Harmonization", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "ROC-AUC" })).toBeVisible();
    await expectAccessible(page);
  });

  test("export downloads a valid CSV", async ({ page }) => {
    await page.goto("/data");
    await page.getByRole("radio", { name: "Annual totals" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
    const body = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(body).toString("utf8");
    expect(download.suggestedFilename()).toMatch(/odlar_az_annual\.csv/);
    expect(text).toMatch(/^# ODLAR annual export/);
    expect(text.split("\n")[1]).toContain("harmonized");
  });
});

test.describe("navigation", () => {
  test("command palette finds districts without diacritics", async ({ page }) => {
    await page.goto("/az/regions");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/Rayon, bölgə/).fill("seki");
    await page.getByRole("option", { name: /Şəki rayonu/ }).click();
    await expect(page).toHaveURL(/\/az\/region\/az-shaki$/);
  });

  test("locale switch keeps the page", async ({ page }) => {
    await page.goto("/az/region/az-qabala");
    await page.getByRole("radio", { name: "en" }).first().click();
    await expect(page).toHaveURL(/^(?!.*\/az\/).*\/region\/az-qabala$/);
    await expect(page.getByRole("heading", { level: 1, name: "Qabala District" })).toBeVisible();
  });

  test("respects reduced motion", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByText("ODLAR stitches NASA's two satellite fire archives together", { exact: false })).toBeVisible();
    await ctx.close();
  });
});
