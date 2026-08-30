import { expect, test, type Page } from "@playwright/test";

function recordUnsafeRequests(page: Page) {
  const unsafeRequests: string[] = [];

  page.on("request", (request) => {
    if (request.method() === "GET" || request.method() === "HEAD") return;
    unsafeRequests.push(`${request.method()} ${request.url()}`);
  });

  return unsafeRequests;
}

async function waitForLandingHydration(page: Page) {
  await expect(page.getByTestId("hero-generation-demo")).not.toHaveAttribute(
    "data-demo-status",
    "waiting",
    { timeout: 20_000 },
  );
}

test("public wow landing is a read-only walkthrough", async ({ page }) => {
  const unsafeRequests = recordUnsafeRequests(page);

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator(".landing-page")).toBeVisible();
  await expect(page.locator(".public-header")).toBeVisible();
  await expect(page.getByTestId("hero-generation-demo")).toBeVisible();
  await expect(page.locator(".landing-showcase-section")).toBeVisible();
  await expect(page.locator(".landing-showcase")).toHaveCount(3);
  await waitForLandingHydration(page);

  await page.locator(".landing-showcase-open").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".landing-showcase-dialog-deck .landing-demo-slide").first()).toBeVisible();

  expect(unsafeRequests).toEqual([]);
});

test("hero demo becomes static when reduced motion is requested", async ({ page }) => {
  const unsafeRequests = recordUnsafeRequests(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await waitForLandingHydration(page);

  const demo = page.getByTestId("hero-generation-demo");
  await expect(demo).toHaveAttribute("data-demo-status", "reduced-motion");
  await expect(page.getByTestId("hero-demo-ready")).toBeVisible();
  await expect(page.getByTestId("hero-demo-replay")).toHaveCount(0);

  expect(unsafeRequests).toEqual([]);
});

test("final landing CTA wizard stays inside compact phone viewports", async ({ page }) => {
  test.slow();

  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 412, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForLandingHydration(page);

    const cta = page.locator(".landing-final-cta");
    await cta.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("landing-cta-topic")).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox!.x).toBeGreaterThanOrEqual(0);
    expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(viewport.width);

    await page.getByTestId("landing-cta-topic").fill("Компактная проверка CTA");
    await page.getByRole("button", { name: /Продолжить/ }).click();
    await expect(page.getByRole("radiogroup", { name: "Количество слайдов" })).toBeVisible();
    const wizardBox = await page.locator(".landing-cta-wizard").boundingBox();
    expect(wizardBox).not.toBeNull();
    expect(wizardBox!.x).toBeGreaterThanOrEqual(0);
    expect(wizardBox!.x + wizardBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
