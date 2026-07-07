import { expect, test } from "@playwright/test";

test("new project wizard accepts a short Russian topic", async ({ page }) => {
  await page.goto("/new");

  const topic = page.getByTestId("new-project-topic");
  await expect(topic).toBeVisible();
  await topic.fill("Искусственный интеллект в высшем образовании");

  await page.locator(".wizard-pane .button").click();

  await expect(page.locator(".slide-count-options")).toBeVisible();
  await expect(page.locator(".wizard-summary")).toContainText("Искусственный интеллект");
});

test("demo editor renders slides and saves edited slide text locally", async ({ page }) => {
  await page.goto("/projects/demo/editor");

  await expect(page.getByTestId("project-editor")).toBeVisible();
  await expect(page.locator(".slide-thumb")).toHaveCount(5);

  const titleEditor = page.getByTestId("slide-title-editor").locator(".ProseMirror");
  await titleEditor.click();
  await titleEditor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await titleEditor.fill("Проверенный заголовок слайда");
  await titleEditor.blur();

  await expect(page.locator(".slide-thumb-active")).toContainText("Проверенный заголовок слайда");
});

test("demo export page reaches an export-ready state without real AI", async ({ page }) => {
  await page.goto("/projects/demo/export");

  await expect(page.locator(".export-workspace")).toBeVisible();
  await expect(page.getByTestId("export-pptx-action")).toBeVisible();
  await expect(page.locator(".export-summary")).toContainText("5");
});
