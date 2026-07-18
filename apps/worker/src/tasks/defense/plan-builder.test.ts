import { describe, expect, it } from "vitest";
import { allocateTiming, buildDefensePlan } from "./plan-builder.js";

const presetSlides = [
  { key: "title", title: "Название проекта и команда", purpose: "Представить проект" },
  { key: "problem", title: "Проблема", purpose: "Объяснить проблему" },
  { key: "demo", title: "Демонстрация интерфейса", purpose: "Показать работу продукта" },
  { key: "finish", title: "Завершение", purpose: "Подвести итог" },
];

describe("defense plan builder", () => {
  it("allocates the exact requested total timing", () => {
    expect(allocateTiming(421, 7).reduce((sum, value) => sum + value, 0)).toBe(421);
  });

  it("keeps evidence references and creates honest placeholders", () => {
    const plan = buildDefensePlan({
      config: { defenseType: "hackathon", complianceMode: "strict", targetSlideCount: 4, targetDurationSeconds: 420, authorProfile: {}, standardPresetVersion: "hackathon-v1" },
      presetSlides,
      requirements: [{ id: "req-screen", text: "Обязательно показать интерфейс", priority: "required", state: "active", origin: "source", rule: { assetRole: "screenshot" } }],
      facts: [{ id: "fact-1", statement: "Сервис собирает презентацию", evidenceCount: 1 }],
      assets: [],
      conflicts: [{ id: "conflict-1", summary: "Разные данные о пользователях", kind: "fact", state: "unresolved" }],
    });

    expect(plan.totalTimingSeconds).toBe(420);
    expect(plan.slides.flatMap((slide) => slide.factIds)).toContain("fact-1");
    expect(plan.slides.flatMap((slide) => slide.placeholders)).toEqual(expect.arrayContaining([
      expect.objectContaining({ requirementId: "req-screen", kind: "screenshot", severity: "error" }),
      expect.objectContaining({ kind: "conflict" }),
    ]));
  });
});
