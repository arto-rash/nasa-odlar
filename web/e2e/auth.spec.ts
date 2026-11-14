import { expect, test } from "@playwright/test";

test.describe("accounts and alerts (needs the Laravel gateway)", () => {
  test.skip(!!process.env.E2E_NO_GATEWAY, "gateway not available");

  test("register → subscribe → evaluate → alert feed", async ({ page }) => {
    const email = `e2e-${Date.now()}@odlar.test`;
    await page.goto("/en/login?next=/alerts?add=az-sabirabad");
    await page.getByRole("radio", { name: "Create account" }).click();
    await page.getByLabel("Name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).last().click();
    await expect(page).toHaveURL(/\/en\/alerts/);
    // prefilled from ?add=
    await page.getByRole("button", { name: "≥ Moderate" }).click();
    await page.locator("form").getByRole("button", { name: "Add a region" }).click();
    await expect(page.getByRole("link", { name: "Sabirabad District" })).toBeVisible();
    await page.getByRole("button", { name: "Check risk now" }).click();
    await expect(page.getByText(/new alert|No new alerts/)).toBeVisible();
    // SMS is a design prototype
    await expect(page.getByRole("button", { name: /SMS/ }).first()).toBeDisabled();
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/en/login");
    await page.getByLabel("Email").fill("demo@odlar.az");
    await page.getByLabel("Password").fill("nope-nope");
    await page.getByRole("button", { name: "Sign in" }).last().click();
    await expect(page.locator("[aria-invalid=true]").first()).toBeVisible();
  });

  test("alerts page sends guests to login", async ({ page }) => {
    await page.goto("/en/alerts");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
  });
});
