import { expect, test, type Page } from "@playwright/test";

const editorBaseUrl = process.env.P2_7_EDITOR_BASE_URL || "http://localhost:3020";
const exportBaseUrl = process.env.P2_7_EXPORT_BASE_URL;
const exportProjectId = process.env.P2_7_EXPORT_PROJECT_ID;

async function updateTitle(page: Page, title: string) {
  const titleEditor = page.getByTestId("slide-title-editor").locator(".ProseMirror");
  await titleEditor.click();
  await titleEditor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await titleEditor.fill(title);
  await titleEditor.blur();
}

test("editor retains an offline edit, warns before close, and retries after reconnect", async ({ page }, testInfo) => {
  await page.goto(`${editorBaseUrl}/projects/demo/editor`);
  await expect(page.getByTestId("slide-title-editor").locator(".ProseMirror")).toBeVisible();
  const context = page.context();
  await context.setOffline(true);
  await expect(page.getByText("Нет подключения. Новые правки остаются в этой вкладке — не закрывайте её, пока не увидите «Сохранено».", { exact: true })).toBeVisible();

  await updateTitle(page, "P2-7 offline reconnect acceptance");
  await expect(page.getByText("Не удалось сохранить", { exact: false })).toBeVisible();

  let dialogType = "";
  page.once("dialog", async (dialog) => {
    dialogType = dialog.type();
    await dialog.dismiss();
  });
  await page.goto(`${editorBaseUrl}/dashboard`).catch(() => undefined);
  await expect.poll(() => dialogType).toBe("beforeunload");

  await context.setOffline(false);
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await testInfo.attach("editor-offline-reconnect", { body: await page.screenshot(), contentType: "image/png" });
});

test("an active export survives offline route close and becomes ready after reconnect", async ({ browser }, testInfo) => {
  test.skip(!exportBaseUrl || !exportProjectId, "Set P2_7_EXPORT_BASE_URL and P2_7_EXPORT_PROJECT_ID for the live export acceptance run.");
  const context = await browser.newContext();
  const page = await context.newPage();
  const route = `${exportBaseUrl}/projects/${exportProjectId}/export`;

  await page.goto(route);
  const startPdf = page.getByTestId("export-pdf-action");
  await expect(startPdf).toBeVisible();
  const [request] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/projects/${exportProjectId}/exports`) && response.request().method() === "POST"),
    startPdf.click(),
  ]);
  const created = await request.json() as { id: string; status: string };
  expect(created.id).toBeTruthy();
  await expect(startPdf).toHaveText("Готовим PDF");

  await context.setOffline(true);
  await expect(page.getByText("Нет подключения. Нельзя начать экспорт или скачать файл. Уже запущенная сборка продолжится на сервере.", { exact: true })).toBeVisible();
  await page.close();

  await context.setOffline(false);
  const resumed = await context.newPage();
  await resumed.goto(route);
  await expect.poll(async () => {
    const response = await resumed.evaluate(async ({ projectId, exportId }) => {
      const result = await fetch(`/api/projects/${projectId}/exports/${exportId}`);
      return result.json() as Promise<{ id: string; status: string }>;
    }, { projectId: exportProjectId, exportId: created.id });
    return response.status === "ready" && response.id === created.id;
  }, { timeout: 60_000 }).toBe(true);
  await expect(resumed.getByTestId("export-pdf-action")).toHaveText("Скачать PDF");
  await testInfo.attach("export-offline-reconnect", { body: await resumed.screenshot(), contentType: "image/png" });
  await context.close();
});
