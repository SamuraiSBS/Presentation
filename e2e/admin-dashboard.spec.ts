import { expect, test, type Locator, type Page } from "@playwright/test";

const mobileViewports = [{ width: 320, height: 700 }, { width: 390, height: 844 }];
const adminDataRoutes = ["users", "revenue", "costs", "generations", "errors", "logs", "audit"] as const;

async function expectTouchTarget(control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  return box!;
}

async function expectNoDocumentOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

function recordResponse(section: string) {
  if (section === "costs") return { summary: { totalRubCurrent: "125", unknownCount: 0 }, ai: [record], other: [], envelopes: [] };
  if (section === "revenue") return { totals: { grossRub: "300", feesRub: "30", netRub: "270" }, items: [record] };
  return { items: [record] };
}

const record = { id: "record-1", projectTitle: "Длинный идентификатор записи для мобильной карточки", status: "ready", model: "model", rubCostAtEvent: "120", updatedAt: "2026-07-10T12:00:00.000Z" };

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
    await page.route("**/api/admin/users?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "user-1", name: "Пользователь с длинным именем для проверки карточки", telegramUsername: "student", telegramId: "123", effectivePlanCode: "pro", subscriptionStatus: "active", lastSeenAt: "2026-07-10T12:00:00.000Z", createdAt: "2026-07-01T12:00:00.000Z", projects: 3, generations: 5, totalCostRub: "120", revenueRub: "299", errors: 0, blockedAt: null }], total: 1, page: 1, pageSize: 20 }) }));
    await page.route("**/api/admin/users", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "user-1", name: "Пользователь с длинным именем для проверки карточки", telegramUsername: "student", telegramId: "123", effectivePlanCode: "pro", subscriptionStatus: "active", lastSeenAt: "2026-07-10T12:00:00.000Z", createdAt: "2026-07-01T12:00:00.000Z", projects: 3, generations: 5, totalCostRub: "120", revenueRub: "299", errors: 0, blockedAt: null }], total: 1, page: 1, pageSize: 20 }) }));
    await page.route(/\/api\/admin\/(revenue|costs|generations|errors|logs|audit)(?:\?.*)?$/, (route) => {
      const section = route.request().url().match(/api\/admin\/(revenue|costs|generations|errors|logs|audit)/)?.[1] || "errors";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(recordResponse(section)) });
    });
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

  test("mobile user records use labelled cards without document overflow", async ({ page }) => {
    await page.route("**/api/admin/users**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "user-1", name: "Очень длинное имя пользователя для проверки мобильной карточки", telegramUsername: "student", telegramId: "123", effectivePlanCode: "pro", subscriptionStatus: "active", lastSeenAt: "2026-07-10T12:00:00.000Z", createdAt: "2026-07-01T12:00:00.000Z", projects: 3, generations: 5, totalCostRub: "120", revenueRub: "299", errors: 0, blockedAt: null }], total: 1, page: 1, pageSize: 20 }) }));
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/admin/users");
    await expect(page.locator(".admin-table td[data-label='Пользователь']")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("user search trims whitespace and returns to the first page", async ({ page }) => {
    await page.goto("/admin/users?search=previous&page=7");
    const input = page.locator(".admin-filter-row input");
    await input.fill("  Ada Lovelace  ");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return { page: params.get("page"), search: params.get("search") };
    }).toEqual({ page: "1", search: "Ada Lovelace" });
  });

  test("coarse-pointer drawer contains keyboard focus and closes by every supported interaction", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Touch geometry is verified in the coarse-pointer project.");
    await page.setViewportSize(mobileViewports[0]);
    await page.goto("/admin");
    const trigger = page.locator(".admin-mobile-menu");
    const drawer = page.locator(".admin-sidebar-open");
    const close = drawer.locator(".admin-sidebar-heading button");
    await trigger.click();
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator(".admin-nav-backdrop").click({ position: { x: 310, y: 600 } });
    await expect(trigger).toBeFocused();

    await trigger.click();
    await drawer.locator('a[href="/admin/users"]').click();
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(trigger).toBeFocused();
  });

  test("coarse-pointer drawer prevents background wheel and touchmove and restores the prior scroll position", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Touch scrolling is verified in the coarse-pointer project.");
    await page.setViewportSize(mobileViewports[0]);
    await page.goto("/admin");
    const initialScrollY = await page.evaluate(async () => {
      const spacer = document.createElement("div");
      spacer.style.cssText = "display:block;height:1400px;width:1px";
      document.querySelector(".admin-main")?.append(spacer);
      document.documentElement.style.scrollBehavior = "auto";
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.scrollTo({ top: 240, behavior: "instant" });
      return window.scrollY;
    });
    expect(initialScrollY).toBe(240);
    const trigger = page.locator(".admin-mobile-menu");
    // A normal locator click scrolls its target into view before dispatching the
    // click. Trigger the real handler without changing the pre-lock position.
    await trigger.evaluate((element: HTMLButtonElement) => element.click());
    await expect(page.locator(".admin-sidebar-open")).toBeVisible();
    const prevented = await page.evaluate(() => {
      const target = document.querySelector(".admin-main")!;
      const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 500 });
      const touch = new Event("touchmove", { bubbles: true, cancelable: true });
      target.dispatchEvent(wheel);
      target.dispatchEvent(touch);
      return { touch: touch.defaultPrevented, wheel: wheel.defaultPrevented, scrollY: window.scrollY };
    });
    expect(prevented.wheel).toBe(true);
    expect(prevented.touch).toBe(true);
    expect(prevented.scrollY).toBe(0);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => window.scrollY)).toBe(initialScrollY);
  });

  test("coarse-pointer admin controls meet the 44px contract", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The 44px contract applies to coarse pointers.");
    await page.setViewportSize(mobileViewports[0]);
    await page.goto("/admin");
    await expectTouchTarget(page.locator(".admin-mobile-menu"));
    await expectTouchTarget(page.locator(".admin-period-select"));
    await page.locator(".admin-mobile-menu").click();
    await expectTouchTarget(page.locator(".admin-sidebar-heading button"));
    await expectTouchTarget(page.locator(".admin-nav-link").first());

    await page.route("**/api/admin/users/user-1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-1", name: "Пользователь", telegramUsername: "student", telegramId: "123", effectivePlanCode: "pro", subscriptionStatus: "active", createdAt: "2026-07-01T12:00:00.000Z", lastSeenAt: "2026-07-10T12:00:00.000Z", projects: 3, generations: 5, totalCostRub: "120", revenueRub: "299", blockedAt: null }, totals: { slides: 8 }, projects: [], generations: [], costs: [], payments: [], errors: [], activity: [], audit: [] }) }));
    await page.goto("/admin/users/user-1");
    await expectTouchTarget(page.locator(".admin-profile-identity a"));
    await expectTouchTarget(page.locator(".admin-tabs [role=tab]").first());
    await expectNoDocumentOverflow(page);
  });

  test("mobile card pattern covers all seven admin data routes at 320 and 390", async ({ page }) => {
    test.slow();
    for (const viewport of mobileViewports) {
      await page.setViewportSize(viewport);
      for (const section of adminDataRoutes) {
        await page.goto(`/admin/${section}`);
        const firstCell = page.locator(".admin-table tbody td").first();
        await expect(firstCell).toBeVisible();
        expect(await firstCell.getAttribute("data-label")).toBe(section === "users" ? "Пользователь" : "Объект");
        expect(await firstCell.evaluate((cell) => getComputedStyle(cell, "::before").content)).not.toBe("none");
        await expectNoDocumentOverflow(page);
      }
    }
  });

  test("desktop keeps semantic tables and admin navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin/users");
    const table = page.locator(".admin-table");
    await expect(table).toBeVisible();
    expect(await table.evaluate((element) => getComputedStyle(element).display)).toBe("table");
    expect(await table.locator("thead").evaluate((element) => getComputedStyle(element).position)).not.toBe("absolute");
    await page.locator('.admin-nav-link[href="/admin/revenue"]').click();
    await expect(page).toHaveURL(/\/admin\/revenue/);
    await expect(page.locator(".admin-table")).toBeVisible();
  });
});
