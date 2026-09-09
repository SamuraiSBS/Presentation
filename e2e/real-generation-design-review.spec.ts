import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const enabled = process.env.REAL_GENERATION_E2E === "true";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3010";
const generationTimeout = 15 * 60 * 1000;

test.describe("real generation design review", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!enabled, "Set REAL_GENERATION_E2E=true to run the paid real-generation flow.");

  let projectId: string | undefined;

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;

    const diagnostics: Record<string, unknown> = {
      baseURL,
      projectId: projectId || null,
      pageUrl: page.url(),
      reason: testInfo.errors.map((error) => error.message).join("\n\n") || "unknown browser E2E failure",
    };
    if (projectId) {
      diagnostics.project = await readRedactedProjectState(page, projectId);
    }
    diagnostics.workerLogs = readWorkerLogs();
    await testInfo.attach("real-generation-diagnostics.json", {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2), "utf8"),
      contentType: "application/json",
    });
  });

  test("creates, reviews, approves, edits, and exports a real six-slide deck", async ({ page }) => {
    test.setTimeout(generationTimeout);
    expect(baseURL).toBe("http://localhost:3010");

    await page.goto("/new", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("new-project-ready")).toBeVisible();
    const topic = `Реальный design-review E2E ${Date.now()}`;
    const topicField = page.getByTestId("new-project-topic");
    await topicField.fill(topic);
    await expect(topicField).toHaveValue(topic);
    await page.getByTestId("new-project-next").click();

    const sixSlideOption = page.locator('.slide-count-options [role="radio"]').filter({ hasText: /^6\b/ });
    await expect(sixSlideOption).toHaveCount(1);
    await sixSlideOption.click();
    await page.getByTestId("new-project-next").click();
    await expect(page.locator('.source-choices [role="radio"]').first()).toBeVisible();
    await page.locator('.source-choices [role="radio"]').first().click();
    await page.getByTestId("new-project-next").click();

    await page.waitForURL(/\/projects\/[^/]+\/script$/, { timeout: 30_000 });
    projectId = extractProjectId(page.url());
    const createPresentation = page.getByTestId("create-presentation-button");
    await expect(createPresentation).toBeVisible({ timeout: generationTimeout });
    await expect(createPresentation).toBeEnabled();
    await createPresentation.click();
    await page.waitForURL(/\/projects\/[^/]+\/design-review$/, { timeout: generationTimeout });

    const review = await readJson(page, `/api/projects/${projectId}/design-review`);
    expect(review.status).toBe("active");
    expect(review.document.slideCount).toBe(6);
    expect(review.document.slides).toHaveLength(6);
    expect(review.document.generationMode).not.toBe("demo");
    expect(review.document.generationMode).not.toBe("demo-fallback");
    expect(review.candidates).toHaveLength(6);
    expect(new Set(review.candidates.map((candidate: { slideId: string }) => candidate.slideId)).size).toBe(6);

    for (let index = 0; index < 6; index += 1) {
      await page.locator(".design-review-thumb").nth(index).click();
      const approve = page.getByRole("button", { name: "Утвердить дизайн", exact: true });
      await expect(approve).toBeEnabled();
      await approve.click();
      if (index < 5) {
        await expect(page.locator(".design-review-progress")).toContainText(`${index + 1} из 6`);
      }
    }

    await page.waitForURL(new RegExp(`/projects/${projectId}/editor$`), { timeout: 30_000 });
    await expect(page.getByTestId("project-editor")).toBeVisible();

    const finalProject = await readJson(page, `/api/projects/${projectId}`);
    expect(finalProject.status).toBe("ready");
    expect(finalProject.presentation?.document?.slides).toHaveLength(6);

    const finalReview = await readJson(page, `/api/projects/${projectId}/design-review`);
    expect(new Set(finalReview.candidates.filter((candidate: { status: string }) => candidate.status === "approved").map((candidate: { slideId: string }) => candidate.slideId)).size).toBe(6);

    await page.goto(`/projects/${projectId}/export`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Подготовьте файлы для выступления", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Скачайте презентацию", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Подготовить PPTX", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Подготовить PDF", exact: true })).toBeVisible();
  });
});

function extractProjectId(url: string) {
  const match = url.match(/\/projects\/([^/]+)\/script$/);
  if (!match?.[1]) throw new Error(`Could not extract project ID from ${url}`);
  return match[1];
}

async function readJson(page: import("@playwright/test").Page, path: string) {
  const response = await page.request.get(path, { failOnStatusCode: false });
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${path} returned HTTP ${response.status()}: ${JSON.stringify(body)}`).toBe(true);
  return body as any;
}

async function readRedactedProjectState(page: import("@playwright/test").Page, id: string) {
  try {
    const project = await readJson(page, `/api/projects/${id}`);
    return {
      status: project.status,
      jobs: (project.jobs || []).map((job: Record<string, unknown>) => ({
        id: job.id,
        kind: job.kind,
        status: job.status,
        progressStage: job.progressStage,
        error: job.error,
      })),
      designReview: project.designReview
        ? {
            revision: project.designReview.revision,
            status: project.designReview.status,
            candidateStatuses: (project.designReview.candidates || []).map((candidate: Record<string, unknown>) => ({ id: candidate.id, slideId: candidate.slideId, version: candidate.version, status: candidate.status, error: candidate.error })),
            error: project.designReview.error,
          }
        : null,
    };
  } catch (error) {
    return { readError: error instanceof Error ? error.message : String(error) };
  }
}

function readWorkerLogs() {
  try {
    return execFileSync("docker", ["compose", "logs", "--no-color", "--tail", "200", "worker"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
