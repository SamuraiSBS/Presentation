import { expect, test } from "@playwright/test";

test("design review regenerates one version and approves every slide", async ({ page }) => {
  await page.goto("/projects/demo/design-review", { waitUntil: "domcontentloaded" });

  const reviewResponse = await page.request.get("/api/projects/demo/design-review");
  expect(reviewResponse.ok()).toBe(true);
  let review = await reviewResponse.json() as ReviewState;
  const reviewPath = "**/api/projects/demo/**";

  await page.route(reviewPath, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const suffix = url.pathname.replace("/api/projects/demo/design-review", "");

    if (request.method() === "GET" && !suffix) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(review) });
      return;
    }

    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }

    const body = JSON.parse(request.postData() || "{}") as { expectedRevision: number; version?: number; comment?: string };
    expect(body.expectedRevision).toBe(review.revision);

    if (suffix.endsWith("/regenerate")) {
      const slideId = suffix.split("/").at(-2)!;
      const current = review.candidates.filter((candidate) => candidate.slideId === slideId).sort((left, right) => right.version - left.version)[0];
      if (!current) throw new Error(`Missing candidate for ${slideId}`);
      const next = { ...current, id: `${current.id}-v${current.version + 1}`, version: current.version + 1, status: "pending" as const, comment: body.comment || null };
      review = { ...review, revision: review.revision + 1, candidates: [...review.candidates, next] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(next) });
      return;
    }

    if (suffix.endsWith("/approve")) {
      const slideId = suffix.split("/").at(-2)!;
      review = {
        ...review,
        revision: review.revision + 1,
        candidates: review.candidates.map((candidate) => candidate.slideId === slideId ? { ...candidate, status: candidate.version === body.version ? "approved" as const : "pending" as const } : candidate),
      };
      const approvedSlides = new Set(review.candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.slideId));
      if (approvedSlides.size === review.document.slides.length) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "ready" }) });
      } else {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(review) });
      }
      return;
    }

    await route.fallback();
  });

  const firstSlide = page.locator(".design-review-thumb").first();
  await firstSlide.click();
  await page.getByPlaceholder("Например: сделайте схему спокойнее и добавьте больше воздуха").fill("Сделайте композицию спокойнее");
  await page.getByRole("button", { name: "Переделать дизайн", exact: true }).click();
  await expect(page.locator(".design-review-actions")).toContainText("Версия 2");

  for (let index = 0; index < review.document.slides.length; index += 1) {
    await page.locator(".design-review-thumb").nth(index).click();
    await page.getByRole("button", { name: "Утвердить дизайн", exact: true }).click();
  }

  await page.waitForURL(/\/projects\/demo\/editor$/, { timeout: 30_000 });
  await expect(page.getByTestId("project-editor")).toBeVisible();
  expect(new Set(review.candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.slideId)).size).toBe(review.document.slides.length);
});

type ReviewState = {
  revision: number;
  document: { slides: Array<{ id: string }> };
  candidates: Array<{ id: string; slideId: string; version: number; status: "pending" | "approved" | "regenerating" | "failed"; canvas: unknown; comment: string | null }>;
};
