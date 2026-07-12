import { expect, test } from "@playwright/test";

const overview = {
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-11T12:00:00.000Z", timeZone: "Europe/Moscow" },
  localAccess: true,
  users: { total: 12, new: 3, active: 7 },
  revenue: { grossRub: "14000", refundsRub: "0", feesRub: "420", netRub: "13580", activeSubscriptions: 5 },
  costs: { totalRubAtEvent: "1250.50", totalRubCurrent: "1298.20", unknownCount: 2, trackedSince: "2026-07-10T10:00:00.000Z" },
  errors: { total: 4, critical: 1, generationFailureRate: "3.20" },
  trend: [], incidents: [], failedGenerations: [],
};

test.describe("admin dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/admin/overview**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) }));
  });

  test("renders local shell and updates the period query", async ({ page }) => {
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Операционный обзор" })).toBeVisible();
    await expect(page.getByText("Локальный открытый доступ")).toBeVisible();
    await page.getByLabel("Период данных").click();
    await page.getByRole("menuitemradio", { name: "7 дней" }).click();
    await expect(page).toHaveURL(/period=7d/);
    await expect(page.getByText("12").first()).toBeVisible();
  });

  test("does not expose sensitive presentation content in admin responses", async ({ page }) => {
    const response = await page.request.get("/api/admin/overview?period=30d");
    const text = await response.text();
    expect(text).not.toContain("speechDraft");
    expect(text).not.toContain("presentationJson");
    expect(text).not.toContain("sourceText");
    expect(text).not.toContain("prompt");
  });

  test("mobile sidebar opens without horizontal page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/admin");
    await page.getByRole("button", { name: "Разделы" }).click();
    await expect(page.getByRole("navigation", { name: "Навигация админки" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
