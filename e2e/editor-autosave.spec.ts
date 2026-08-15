import { expect, test, type Page } from "@playwright/test";

const editorRoute = "/projects/demo/editor";

async function updateTitle(page: Page, title: string) {
  const titleEditor = page.getByTestId("slide-title-editor").locator(".ProseMirror");
  await titleEditor.click();
  await titleEditor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await titleEditor.fill(title);
  await titleEditor.blur();
}

test("editor warns before navigation while save is pending", async ({ page }) => {
  let releasePatch: (() => void) | undefined;
  let patchStarted = false;
  await page.route("**/api/projects/demo/slides/**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    patchStarted = true;
    await new Promise<void>((resolve) => { releasePatch = resolve; });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ presentationRevision: 2 }),
    });
  });

  await page.goto(editorRoute);
  await updateTitle(page, "Проверка защиты перед уходом");
  await expect.poll(() => patchStarted).toBe(true);
  await expect(page.getByText("Сохраняем…", { exact: true })).toBeVisible();

  let dialogType = "";
  page.once("dialog", async (dialog) => {
    dialogType = dialog.type();
    await dialog.dismiss();
  });
  await page.goto("/dashboard").catch(() => undefined);
  await expect.poll(() => dialogType).toBe("beforeunload");

  releasePatch?.();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
});

test("editor preserves input through the TipTap handoff", async ({ page }) => {
  await page.goto(editorRoute);
  const field = page.getByTestId("slide-title-editor").locator(".rich-text-content");
  await expect(field).toBeVisible();
  await field.fill("P2-3 fallback handoff check");
  await expect(page.getByTestId("slide-title-editor").locator(".ProseMirror")).toHaveText("P2-3 fallback handoff check");
});

test("editor keeps failed edits and retries the latest save", async ({ page }) => {
  let patches = 0;
  await page.route("**/api/projects/demo/slides/**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    patches += 1;
    if (patches === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Сохранение временно недоступно" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ presentationRevision: 2 }),
    });
  });

  await page.goto(editorRoute);
  await updateTitle(page, "Проверка повторного сохранения");
  await expect(page.getByText("Не удалось сохранить", { exact: true })).toBeVisible();
  await expect(page.locator(".save-retry")).toBeVisible();

  await page.locator(".save-retry").click();
  await expect.poll(() => patches).toBe(2);
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
});
