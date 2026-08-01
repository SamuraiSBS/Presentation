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
    test.slow();
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

  test("bottom navigation keeps readable, non-overlapping 44px controls at 320 and 360", async ({ page }) => {
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto("/dashboard");
      const nav = page.locator(".mobile-bottom-nav");
      const controls = nav.locator(".mobile-nav-item");
      await expect(nav).toBeVisible();
      await expect(controls).toHaveCount(5);
      const metrics = await controls.evaluateAll((items) => items.map((item) => {
        const rect = item.getBoundingClientRect();
        const styles = getComputedStyle(item);
        return { bottom: rect.bottom, fontSize: Number.parseFloat(styles.fontSize), height: rect.height, left: rect.left, letterSpacing: Number.parseFloat(styles.letterSpacing) || 0, right: rect.right, top: rect.top, width: rect.width };
      }));
      for (const metric of metrics) {
        expect(metric.fontSize).toBeGreaterThanOrEqual(11);
        expect(metric.letterSpacing).toBeGreaterThanOrEqual(0);
        expect(metric.width).toBeGreaterThanOrEqual(44);
        expect(metric.height).toBeGreaterThanOrEqual(44);
      }
      for (let index = 0; index < metrics.length - 1; index += 1) {
        expect(metrics[index].right).toBeLessThanOrEqual(metrics[index + 1].left + 0.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });

  test("mobile project dialog close has a 44px hit area", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The touch contract is verified in the coarse-pointer project.");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projects");
    const menu = page.locator(".row-menu-trigger").first();
    await expect(menu).toBeVisible();
    await menu.click();
    await page.locator('[role="menuitem"]').nth(1).click();
    const close = page.locator(".ui-dialog-close");
    await expect(close).toBeVisible();
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
