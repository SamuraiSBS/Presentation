import { expect, test } from "@playwright/test";

test("new project wizard stays usable from 320px to 412px without horizontal overflow", async ({ page }) => {
  for (const width of [320, 360, 390, 412]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/new");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByTestId("new-project-next")).toBeVisible();
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/new");

  const topic = page.getByTestId("new-project-topic");
  const next = page.getByTestId("new-project-next");
  await expect(topic).toBeVisible();
  await topic.fill("Искусственный интеллект в высшем образовании");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.getByRole("radiogroup", { name: "Количество слайдов" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("keyboard navigation reaches the creation action with a visible focus indicator", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto("/new");

  const topic = page.getByTestId("new-project-topic");
  const next = page.getByTestId("new-project-next");
  await topic.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  await expect(next).toBeFocused();
  expect(await next.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return styles.outlineStyle !== "none" && styles.outlineWidth !== "0px";
  })).toBe(true);
});

test("demo editor renders slides and saves edited slide text locally", async ({ page }) => {
  await page.goto("/projects/demo/editor");

  await expect(page.getByTestId("project-editor")).toBeVisible();
  await expect(page.locator(".slide-thumb")).toHaveCount(5);

  const editSection = page.getByRole("button", { name: "Правка", exact: true });
  if (await editSection.isVisible()) await editSection.click();

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
