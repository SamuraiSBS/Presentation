import { expect, test } from "@playwright/test";

const editorProjectId = process.env.PLAYWRIGHT_EDITOR_PROJECT_ID || "demo";

test("client-side переход к созданию оставляет единственную активную страницу", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hero-generation-demo")).not.toHaveAttribute(
    "data-demo-status",
    "waiting",
  );
  await page.evaluate(() => window.scrollTo(0, 1600));

  const create = page.getByRole("link", {
    name: "Создать презентацию за 5 минут",
    exact: true,
  });
  await expect(create).toHaveCount(1);
  await Promise.all([
    // App Router uses a client-side transition here, so there is no second
    // document `load` event to wait for.
    page.waitForURL("**/new", { waitUntil: "commit" }),
    create.click(),
  ]);
  await expect(page.locator(".motion-page")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(24);

  const topic = page.getByTestId("new-project-topic");
  const next = page.getByTestId("new-project-next");
  await topic.click();
  await topic.fill("Как искусственный интеллект помогает учиться");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByRole("radiogroup", { name: "Количество слайдов" })).toBeVisible();
});

test("нижнее действие /new доступно в коротком desktop viewport без вложенной прокрутки", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/new");

  const next = page.getByTestId("new-project-next");
  await expect(next).toBeVisible();
  await next.scrollIntoViewIfNeeded();

  const layout = await next.evaluate((element) => {
    const wizard = document.querySelector(".wizard-main");
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const wizardStyle = wizard ? getComputedStyle(wizard) : null;
    return {
      bottomActionVisible: rect.top >= 0 && rect.bottom <= viewportHeight,
      documentCanScroll: document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight,
      wizardHasOwnScroller: Boolean(
        wizard &&
          wizard.scrollHeight > wizard.clientHeight &&
          wizardStyle &&
          ["auto", "scroll"].includes(wizardStyle.overflowY),
      ),
    };
  });

  expect(layout.bottomActionVisible).toBe(true);
  expect(layout.documentCanScroll).toBe(true);
  expect(layout.wizardHasOwnScroller).toBe(false);
});

test("точная правка не вкладывает main и остаётся доступной с клавиатуры", async ({ page }) => {
  await page.goto(`/projects/${editorProjectId}/editor`);
  await expect(page.locator("main")).toHaveCount(1);

  const exactEdit = page.getByRole("button", { name: "Точная правка", exact: true });
  await expect(exactEdit).toBeVisible();
  await exactEdit.click();

  const textElements = page.locator('[data-canvas-element-type="text"]');
  const textElementCount = await textElements.count();
  expect(textElementCount).toBeGreaterThan(0);
  const accessibleNames = await textElements.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label")),
  );
  expect(new Set(accessibleNames).size).toBe(accessibleNames.length);

  const textElement = textElements.first();
  await expect(textElement).toBeVisible();
  await textElement.focus();
  await textElement.press("Enter");
  await expect(textElement).toHaveAttribute("aria-pressed", "true");
  await expect(textElement.locator("button")).toHaveCount(0);

  const resizeHandle = page.locator(".resize-handle");
  await expect(resizeHandle).toHaveCount(1);
  await expect(resizeHandle).toHaveAttribute("aria-label", /Изменить размер: Текстовый элемент \d+:/);
  const resizeBox = await resizeHandle.boundingBox();
  const coarsePointer = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const minimumHitArea = coarsePointer ? 43 : 27;
  expect(resizeBox?.width).toBeGreaterThanOrEqual(minimumHitArea);
  expect(resizeBox?.height).toBeGreaterThanOrEqual(minimumHitArea);

  if (editorProjectId === "demo") {
    const widthBefore = await textElement.evaluate((element) =>
      element.getBoundingClientRect().width,
    );
    await resizeHandle.focus();
    await resizeHandle.press("ArrowRight");
    await expect.poll(() => textElement.evaluate((element) =>
      element.getBoundingClientRect().width,
    )).toBeGreaterThan(widthBefore);
    await resizeHandle.press("ArrowLeft");
  }

  await textElement.focus();
  await textElement.press("Enter");
  const inlineEditor = textElement.locator('[contenteditable="true"]');
  await expect(inlineEditor).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(textElement).toBeFocused();
});
