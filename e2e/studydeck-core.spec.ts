import { expect, test, type Locator } from "@playwright/test";

async function expectControlInsideViewport(
  control: Locator,
  width: number,
  height: number,
) {
  await control.focus();
  await expect(control).toBeFocused();
  const metrics = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      bottom: rect.bottom,
      focusVisible: element.matches(":focus-visible"),
      left: rect.left,
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
      right: rect.right,
      top: rect.top,
    };
  });

  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(width);
  expect(metrics.bottom).toBeLessThanOrEqual(height);
  expect(metrics.focusVisible || (metrics.outlineStyle !== "none" && metrics.outlineWidth !== "0px")).toBe(true);
}

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

test("new project starts with its topic field visible and clears the mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/new");

  const topic = page.getByTestId("new-project-topic");
  const mobileNavigation = page.locator(".mobile-bottom-nav");
  await expect(topic).toBeVisible();

  const initialLayout = await topic.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const mobileNavigation = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    return {
      bottom: rect.bottom,
      navigationTop: mobileNavigation?.top ?? viewportHeight,
      top: rect.top,
      viewportHeight,
    };
  });
  expect(initialLayout.top).toBeGreaterThanOrEqual(0);
  expect(initialLayout.top).toBeLessThan(initialLayout.viewportHeight);
  expect(initialLayout.bottom).toBeLessThanOrEqual(initialLayout.viewportHeight);
  expect(initialLayout.bottom).toBeLessThanOrEqual(initialLayout.navigationTop);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const next = page.getByTestId("new-project-next");
  await next.scrollIntoViewIfNeeded();
  const [nextBox, navigationBox] = await Promise.all([next.boundingBox(), mobileNavigation.boundingBox()]);
  expect(nextBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(nextBox!.y + nextBox!.height).toBeLessThanOrEqual(navigationBox!.y);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/new");
  const desktopNext = page.getByTestId("new-project-next");
  await desktopNext.scrollIntoViewIfNeeded();
  const desktopAction = await desktopNext.boundingBox();
  expect(desktopAction).not.toBeNull();
  expect(desktopAction!.x).toBeGreaterThanOrEqual(0);
  expect(desktopAction!.y).toBeGreaterThanOrEqual(0);
  expect(desktopAction!.x + desktopAction!.width).toBeLessThanOrEqual(1280);
  expect(desktopAction!.y + desktopAction!.height).toBeLessThanOrEqual(800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("workflow keeps the active stage visible without moving document scroll or focus", async ({ page }) => {
  test.slow();
  for (const route of ["/projects/demo/editor", "/projects/demo/script", "/projects/demo/export"]) {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const beforeAutoScroll = await page.evaluate(() => ({ focusedTag: document.activeElement?.tagName, scrollY: window.scrollY }));

    const workflow = page.locator(".journey-progress");
    const active = workflow.locator('[aria-current="step"]');
    await expect(workflow).toBeVisible();
    await expect(active).toBeVisible();

    await expect.poll(() => workflow.evaluate((container) => {
      const activeStep = container.querySelector('[aria-current="step"]') as HTMLElement | null;
      const containerBox = container.getBoundingClientRect();
      const activeBox = activeStep?.getBoundingClientRect();
      return Boolean(activeBox && activeBox.left >= containerBox.left && activeBox.right <= containerBox.right);
    })).toBe(true);

    const state = await workflow.evaluate((container) => {
      const activeStep = container.querySelector('[aria-current="step"]') as HTMLElement | null;
      const containerBox = container.getBoundingClientRect();
      const activeBox = activeStep?.getBoundingClientRect();
      return {
        activeVisible: Boolean(activeBox && activeBox.left >= containerBox.left && activeBox.right <= containerBox.right),
        hasEndCue: container.dataset.overflowEnd === "true",
        hasStartCue: container.dataset.overflowStart === "true",
        hidesEnd: container.scrollLeft < container.scrollWidth - container.clientWidth - 1,
        hidesStart: container.scrollLeft > 1,
        scrollY: window.scrollY,
        focusedTag: document.activeElement?.tagName,
      };
    });
    expect(state.activeVisible).toBe(true);
    expect(state.hidesStart).toBe(state.hasStartCue);
    expect(state.hidesEnd).toBe(state.hasEndCue);
    expect(state.scrollY).toBe(beforeAutoScroll.scrollY);
    expect(state.focusedTag).toBe(beforeAutoScroll.focusedTag);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(route);
    const desktopWorkflow = page.locator(".journey-progress");
    const desktopActive = desktopWorkflow.locator('[aria-current="step"]');
    await expect(desktopWorkflow).toBeVisible();
    await expect(desktopActive).toBeVisible();
    const desktopAction = await desktopActive.boundingBox();
    expect(desktopAction).not.toBeNull();
    expect(desktopAction!.x).toBeGreaterThanOrEqual(0);
    expect(desktopAction!.y).toBeGreaterThanOrEqual(0);
    expect(desktopAction!.x + desktopAction!.width).toBeLessThanOrEqual(1280);
    expect(desktopAction!.y + desktopAction!.height).toBeLessThanOrEqual(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
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

test("editor shell reflows without document overflow on phone, tablet, and landscape", async ({ page }) => {
  await page.goto("/projects/demo/editor");

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 760, height: 1024 },
    { width: 768, height: 1024 },
    { width: 800, height: 1024 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("project-editor")).toBeVisible();

    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  }

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const headingBox = await page.getByRole("heading", { level: 1 }).boundingBox();
    expect(headingBox?.x).toBeGreaterThanOrEqual(0);
    expect(headingBox?.y).toBeGreaterThanOrEqual(0);
    expect(headingBox && headingBox.x + headingBox.width).toBeLessThanOrEqual(viewport.width);
    expect(headingBox && headingBox.y + headingBox.height).toBeLessThanOrEqual(viewport.height);
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  const headerBoxes = await page.locator(".topbar-main > *").evaluateAll((elements) =>
    elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    }),
  );
  for (let index = 0; index < headerBoxes.length; index += 1) {
    for (let next = index + 1; next < headerBoxes.length; next += 1) {
      const a = headerBoxes[index];
      const b = headerBoxes[next];
      const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      expect(overlaps).toBe(false);
    }
  }

  await page.setViewportSize({ width: 844, height: 390 });
  const canvas = await page.locator(".canvas-frame").boundingBox();
  expect(canvas?.width).toBeGreaterThanOrEqual(280);
  expect(canvas?.height).toBeGreaterThanOrEqual(158);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.locator(".slide-rail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Просмотр слайда", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Точная правка", exact: true })).toBeVisible();

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/projects/demo/editor");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByTestId("project-editor")).toBeVisible();
    await expect(page.locator(".canvas-frame")).toBeVisible();
    await page.getByRole("button", { name: "Точная правка", exact: true }).click();
    expect(await page.locator('[data-canvas-element-type="text"]').count()).toBeGreaterThan(0);
  }
});

test("editor keyboard focus stays visible inside mobile and desktop viewports", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/projects/demo/editor");
    await expectControlInsideViewport(
      page.getByRole("button", { name: "Просмотр слайда", exact: true }),
      viewport.width,
      viewport.height,
    );
  }
});

test("demo export page reaches an export-ready state without real AI", async ({ page }) => {
  await page.goto("/projects/demo/export");

  await expect(page.locator(".export-workspace")).toBeVisible();
  await expect(page.getByTestId("export-pptx-action")).toBeVisible();
  await expect(page.locator(".export-summary")).toContainText("5");
});

test("mobile export tabs retain 44px touch targets without overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The touch contract is verified in the coarse-pointer project.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects/demo/export");
  const tabs = page.locator(".export-tabs [role=tab]");
  await expect(tabs.first()).toBeVisible();
  const boxes = await tabs.evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  }));
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
