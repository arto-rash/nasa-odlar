import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

test("simple mode works on a phone", async ({ page }) => {
  await page.goto("/az/simple");
  await page.getByPlaceholder("Rayonunuzu seçin").fill("sabir");
  await page.getByRole("button", { name: /Sabirabad rayonu/ }).click();
  await expect(page.getByText("Bu həftə")).toBeVisible();
  await expect(page.getByRole("link", { name: /Təcili hal: 112/ })).toHaveAttribute("href", "tel:112");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expectAccessible(page);
});

test("mobile menu opens and navigates", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Open menu" }).click();
  const dialogLink = page.locator("div.fixed.inset-0 ul").getByRole("link", { name: "Regions" });
  await expect(dialogLink).toBeVisible();
  await page.waitForTimeout(600); // let the staggered entrance settle
  await dialogLink.click();
  await expect(page).toHaveURL(/\/en\/regions$/);
});

test("simple mode remembers the district and server-renders it on return", async ({ page, request }) => {
  await page.goto("/az/simple");
  await page.getByPlaceholder("Rayonunuzu seçin").fill("sabir");
  await page.getByRole("button", { name: /Sabirabad rayonu/ }).click();
  await expect(page.getByText("Bu həftə")).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === "odlar-home");
  expect(cookie?.value).toBe("az-sabirabad");
  // the raw HTML (before any JS) already shows the card, not the picker
  const html = await (await request.get("/az/simple", { headers: { cookie: `odlar-home=${cookie?.value}` } })).text();
  expect(html).toContain("Sabirabad");
  expect(html).toContain("Bu həftə");
  expect(html).not.toContain('placeholder="Rayonunuzu seçin"');
  await page.reload();
  await expect(page.getByText("Bu həftə")).toBeVisible();
  await page.getByRole("button", { name: "Dəyiş" }).click();
  await expect(page.getByPlaceholder("Rayonunuzu seçin")).toBeVisible();
  expect((await page.context().cookies()).find((c) => c.name === "odlar-home")).toBeUndefined();
});
