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

  it("keeps optional placement literal in strict mode and only adapts an unreserved template slot", () => {
    const input = {
      config: { defenseType: "hackathon" as const, complianceMode: "strict" as const, targetSlideCount: 4, targetDurationSeconds: 420, authorProfile: {}, standardPresetVersion: "hackathon-v1" as const },
      presetSlides,
      requirements: [
        { id: "required-architecture", text: "Показать архитектуру решения", priority: "required" as const, state: "active" as const, origin: "source" as const, rule: { kind: "slide_position", position: "exact", order: 3 } },
        { id: "recommended-risks", text: "Технические риски и план снижения", priority: "recommended" as const, state: "active" as const, origin: "source" as const, rule: { kind: "slide_position", position: "exact", order: 4 } },
      ],
      facts: [],
      assets: [],
      conflicts: [],
    };

    const strict = buildDefensePlan(input);
    const adaptive = buildDefensePlan({ ...input, config: { ...input.config, complianceMode: "adaptive" } });

    expect(strict.slides[3].requirementIds).toContain("recommended-risks");
    expect(strict.slides[1].title).toBe(presetSlides[1].title);

    expect(adaptive.slides[1].requirementIds).toContain("recommended-risks");
    expect(adaptive.slides[1].title).toContain("Технические риски");
    expect(adaptive.slides[1].adaptiveChangeReason).toContain("Необязательное требование");
    expect(adaptive.slides[2].requirementIds).toContain("required-architecture");
    expect(adaptive.slides[3].requirementIds).not.toContain("recommended-risks");
  });

  it("spreads unmatched confirmed facts across factual slides instead of piling them onto slide two", () => {
    const plan = buildDefensePlan({
      config: { defenseType: "diploma", complianceMode: "strict", targetSlideCount: 12, targetDurationSeconds: 600, authorProfile: {}, standardPresetVersion: "diploma-v1" },
      presetSlides: Array.from({ length: 12 }, (_, index) => ({
        key: `section-${index + 1}`,
        title: index === 0 ? "Титульный слайд" : index === 11 ? "Завершение" : `Раздел защиты ${index + 1}`,
        purpose: `Раскрыть тему раздела ${index + 1}`,
      })),
      requirements: [],
      facts: Array.from({ length: 29 }, (_, index) => ({
        id: `fact-${index + 1}`,
        statement: `Подтверждённый факт без совпадения ${index + 1}`,
        evidenceCount: 1,
      })),
      assets: [],
      conflicts: [],
    });

    const factualLoads = plan.slides.slice(1, -1).map((slide) => slide.factIds.length);
    expect(plan.slides[1].factIds.length).toBeLessThan(10);
    expect(Math.max(...factualLoads) - Math.min(...factualLoads)).toBeLessThanOrEqual(1);
    expect(plan.slides.filter((slide) => slide.factIds.length > 0)).toHaveLength(10);
  });
});
