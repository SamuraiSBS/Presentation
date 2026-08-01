import { expect, test, type Page } from "@playwright/test";

const scriptRoute = "/projects/script-review-demo/script";

async function expectNoDocumentOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function tabTo(page: Page, selector: string, maximumTabs = 80) {
  for (let attempt = 0; attempt < maximumTabs; attempt += 1) {
    const matched = await page.evaluate((target) => document.activeElement?.matches(target) ?? false, selector);
    if (matched) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard focus did not reach ${selector}`);
}

async function installVisualViewportMock(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const state = { height: window.innerHeight, offsetTop: 0 };
    const emit = (type: string) => {
      const event = new Event(type);
      listeners.get(type)?.forEach((listener) => {
        if (typeof listener === "function") listener.call(mock, event);
        else listener.handleEvent(event);
      });
    };
    const mock = {
      get height() { return state.height; },
      get offsetTop() { return state.offsetTop; },
      get width() { return window.innerWidth; },
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const typeListeners = listeners.get(type) || new Set<EventListenerOrEventListenerObject>();
        typeListeners.add(listener);
        listeners.set(type, typeListeners);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.get(type)?.delete(listener);
      },
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: mock });
    Object.defineProperty(window, "__setTestVisualViewport", {
      configurable: true,
      value: (next: { height: number; offsetTop?: number }) => {
        state.height = next.height;
        state.offsetTop = next.offsetTop || 0;
        emit("resize");
        emit("scroll");
      },
    });
  });
}

async function setVisualViewport(page: Page, height: number, offsetTop = 0) {
  await page.evaluate(({ height: nextHeight, offsetTop: nextOffsetTop }) => {
    const setter = (window as Window & {
      __setTestVisualViewport?: (next: { height: number; offsetTop?: number }) => void;
    }).__setTestVisualViewport;
    if (!setter) throw new Error("visualViewport test mock is unavailable");
    setter({ height: nextHeight, offsetTop: nextOffsetTop });
  }, { height, offsetTop });
}

test("keyboard path discloses sources, changes section, and reaches save", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(scriptRoute);

  await expect(page.locator(".journey-progress [aria-current=step]")).toBeVisible();
  await expect(page.getByTestId("source-review-summary")).toBeVisible();
  await expect(page.locator(".source-review-item")).toHaveCount(6);
  await expect(page.locator("[data-testid^=source-review-detail-]")).toHaveCount(0);
  await expect(page.locator(".speech-section-card")).toHaveCount(1);
  await expect(page.locator(".speech-section-card textarea")).toHaveCount(1);
  await expectNoDocumentOverflow(page);

  await tabTo(page, ".source-review-item:first-child .source-detail-toggle");
  const sourceToggle = page.locator(".source-review-item").first().locator(".source-detail-toggle");
  await expect(sourceToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sourceToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("source-review-detail-src-script-review-1")).toBeVisible();

  await tabTo(page, '[data-testid="script-jump-14"]');
  const lastJump = page.getByTestId("script-jump-14");
  await expect(lastJump).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(lastJump).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("speech-section-14")).toBeVisible();
  await expectNoDocumentOverflow(page);

  await tabTo(page, '[data-testid="script-save-toolbar"] button');
  const save = page.getByRole("button", { name: "Сохранить текст" });
  await expect(save).toBeFocused();

  for (const viewport of [{ width: 412, height: 915 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("speech-section-14")).toBeVisible();
    await expect(save).toBeVisible();
    await expectNoDocumentOverflow(page);
  }
});

test("focused editor keeps sticky save clear of keyboard inset and bottom navigation", async ({ page }) => {
  await installVisualViewportMock(page);

  for (const viewport of [{ width: 320, height: 568, keyboardHeight: 278 }, { width: 390, height: 844, keyboardHeight: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(scriptRoute);

    const editor = page.getByRole("textbox", { name: "Текст выступления для слайда 1" });
    await editor.focus();
    await setVisualViewport(page, viewport.keyboardHeight);

    const layout = await page.getByTestId("script-save-toolbar").evaluate((toolbar, keyboardTop) => {
      const editor = document.querySelector<HTMLTextAreaElement>(".speech-section-card textarea");
      const toolbarBox = toolbar.getBoundingClientRect();
      const editorBox = editor?.getBoundingClientRect();
      const navigationBox = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
      const keyboardInset = toolbar.closest<HTMLElement>(".script-shell")?.style.getPropertyValue("--script-keyboard-inset");
      return {
        editorBottom: editorBox?.bottom ?? 0,
        editorTop: editorBox?.top ?? 0,
        keyboardInset,
        navigationTop: navigationBox?.top ?? window.innerHeight,
        toolbarBottom: toolbarBox.bottom,
        toolbarTop: toolbarBox.top,
        visibleKeyboardTop: keyboardTop,
      };
    }, viewport.keyboardHeight);

    expect(layout.keyboardInset).toBe(`${viewport.height - viewport.keyboardHeight}px`);
    expect(layout.toolbarBottom).toBeLessThanOrEqual(Math.min(layout.visibleKeyboardTop, layout.navigationTop));
    expect(layout.editorBottom <= layout.toolbarTop || layout.editorTop >= layout.toolbarBottom).toBe(true);
    await expectNoDocumentOverflow(page);
  }
});

test("script draft survives section switches and delayed save feedback stays available above mobile navigation", async ({ page }) => {
  let releasePatch: (() => void) | undefined;
  await page.route("**/api/projects/script-review-demo/narration", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const payload = route.request().postDataJSON() as { speechDraft: string };
    await new Promise<void>((resolve) => { releasePatch = resolve; });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        accessRole: "owner",
        exports: [],
        id: "script-review-demo",
        narrationState: "editable_draft",
        presentation: null,
        presentationRevision: 1,
        slideCount: 14,
        sources: [],
        speechDraft: payload.speechDraft,
        status: "script_ready",
        title: "Проверка длинного текста выступления",
      }),
    });
  });

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(scriptRoute);

    const editor = page.getByRole("textbox", { name: "Текст выступления для слайда 1" });
    await editor.fill("Черновик остаётся на месте после перехода между разделами. Здесь достаточно текста для сохранения.");
    await page.getByTestId("script-jump-2").click();
    await page.getByTestId("script-jump-1").click();
    await expect(editor).toHaveValue(/Черновик остаётся на месте/);

    const save = page.getByTestId("script-save-toolbar").getByRole("button").first();
    await save.click();
    await expect.poll(() => Boolean(releasePatch)).toBe(true);
    await expect(save).toHaveText("Сохраняем…");
    await expect(save).toBeDisabled();
    releasePatch?.();
    await expect(page.getByText("Все правки сохранены", { exact: true })).toBeVisible();

    const layout = await page.getByTestId("script-save-toolbar").evaluate((toolbar) => {
      const toolbarBox = toolbar.getBoundingClientRect();
      const navBox = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
      return { toolbarBottom: toolbarBox.bottom, navTop: navBox?.top ?? window.innerHeight };
    });
    expect(layout.toolbarBottom).toBeLessThanOrEqual(layout.navTop);
    await expectNoDocumentOverflow(page);
  }
});

test("script save error is announced without discarding the edited draft", async ({ page }) => {
  await page.route("**/api/projects/script-review-demo/narration", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Сохранение временно недоступно" }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(scriptRoute);

  const editor = page.getByRole("textbox", { name: "Текст выступления для слайда 1" });
  await editor.fill("Текст не должен исчезнуть, даже если сервер вернул ошибку сохранения. Он остаётся доступным для повторной попытки.");
  await page.getByRole("button", { name: "Сохранить текст" }).click();
  await expect(page.getByTestId("script-action-error")).toBeVisible();
  await expect(editor).toHaveValue(/Текст не должен исчезнуть/);
});
