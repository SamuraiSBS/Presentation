import { expect, test } from "@playwright/test";

test.describe("personal account", () => {
  test("dashboard renders usage, statistics and compact project data", async ({ page }) => {
    const response = await page.goto("/dashboard");
    expect(response?.status()).toBe(200);

    await expect(page.locator(".dashboard-page")).toBeVisible();
    await expect(page.locator(".usage-panel")).toContainText(/из \d+ презентаций/);
    await expect(page.locator(".stats-strip .stat-item")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Создать презентацию" }).first()).toBeVisible();

    const listResponse = await page.request.get("/api/projects?limit=1");
    expect(listResponse.ok()).toBeTruthy();
    const list = await listResponse.json() as { items: Array<Record<string, unknown>> };
    if (list.items[0]) {
      expect(list.items[0]).not.toHaveProperty("presentation");
      expect(list.items[0]).not.toHaveProperty("sources");
      expect(list.items[0]).toHaveProperty("accessRole");
    }
  });

  test("projects, folders, profile and tariff routes open", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Презентации" })).toBeVisible();
    await expect(page.locator(".projects-toolbar")).toBeVisible();

    await page.goto("/folders");
    await expect(page.getByRole("heading", { name: "Папки" })).toBeVisible();

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
    await expect(page.locator(".profile-plan")).toContainText("10 презентаций");

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: /Всё нужное для учёбы/ })).toBeVisible();
    await expect(page.locator(".free-plan-card")).toContainText("PDF и PPTX");
  });

  test("mobile navigation has five unclipped destinations at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/dashboard");

    const nav = page.locator(".mobile-bottom-nav");
    await expect(nav).toBeVisible();
    await expect(nav.locator(".mobile-nav-item")).toHaveCount(5);
    await expect(nav).toContainText("Презентации");

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);
  });
});
