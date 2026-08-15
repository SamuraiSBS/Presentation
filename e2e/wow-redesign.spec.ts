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
  await page.getByTestId("landing-demo-gallery-placeholder").scrollIntoViewIfNeeded();
  await expect(page.locator(".landing-showcase-trigger")).toHaveCount(3);
  await waitForLandingHydration(page);

  await page.locator(".landing-showcase-trigger").first().click();
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

test("final landing artifact stays inside compact phone viewports", async ({ page }) => {
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

    await page.getByTestId("landing-final-cta-artifact-placeholder").scrollIntoViewIfNeeded();
    await expect(page.locator(".landing-final-cta-artifact")).toBeVisible();
    const artifact = page.locator(".landing-final-cta-artifact");
    await artifact.scrollIntoViewIfNeeded();
    const bounds = await page.locator(".landing-final-cta-card-stack, .landing-final-cta-card, .landing-final-cta-card-hint").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    );

    for (const rect of bounds) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width);
    }
    const action = page.locator(".landing-final-cta-action");
    await action.scrollIntoViewIfNeeded();
    const actionBox = await action.boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.x).toBeGreaterThanOrEqual(0);
    expect(actionBox!.y).toBeGreaterThanOrEqual(0);
    expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
