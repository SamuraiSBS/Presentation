import { expect, test } from "@playwright/test";

test.describe("requirements-driven defense mode", () => {
  test("keeps the standard creation flow and exposes the defense entry", async ({ page }) => {
    await page.goto("/new");

    const modePicker = page.getByRole("navigation", { name: "Режим создания презентации" });
    await expect(modePicker).toBeVisible();
    await expect(modePicker.getByRole("link", { name: "Обычная презентация" })).toHaveAttribute("aria-current", "page");

    await modePicker.getByRole("link", { name: /Защита проекта/ }).click();
    await expect(page).toHaveURL(/\/new\/defense$/);
    await expect(page.getByRole("heading", { name: "Подготовим защиту без выдуманных фактов" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Создание защиты проекта" })).toBeVisible();
  });

  test("walks through source setup without starting AI before draft confirmation", async ({ page }) => {
    await page.goto("/new/defense");

    await page.getByRole("radio", { name: /Диплом/ }).click();
    await expect(page.getByRole("radio", { name: /Диплом/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Продолжить" }).click();

    await page.getByLabel("Название проекта").fill("StudyDeck defense smoke project");
    await page.getByLabel(/Публичный GitHub \/ GitLab/).fill("https://github.com/openai/openai-node");
    await page.getByRole("button", { name: "Продолжить" }).click();

    await expect(page.getByText("Дополнительные материалы необязательны", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Продолжить" }).click();

    await expect(page.getByRole("heading", { name: "Данные для титульного слайда" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Сохранить черновик" })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI-анализ/ })).toHaveCount(0);
  });

  test("stays keyboard-visible and free of horizontal overflow on a narrow screen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/new/defense");

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const continueButton = page.getByRole("button", { name: "Продолжить" });
    await continueButton.focus();
    await expect(continueButton).toBeFocused();
    expect(await continueButton.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      const hasOutline = styles.outlineStyle !== "none" && styles.outlineWidth !== "0px";
      const hasFocusRing = styles.boxShadow !== "none";
      return hasOutline || hasFocusRing;
    })).toBe(true);
  });
});
