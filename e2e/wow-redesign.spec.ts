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
