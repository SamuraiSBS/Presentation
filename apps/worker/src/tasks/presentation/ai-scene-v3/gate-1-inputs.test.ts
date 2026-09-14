import { describe, expect, it } from "vitest";
import { parseAiSceneV3DocxSections, prepareAiSceneV3Gate1Input } from "./gate-1-inputs.js";

describe("AI Scene v3 Gate 1 DOCX input", () => {
  it("parses slide headings and preserves each real section separately", () => {
    const sections = parseAiSceneV3DocxSections("Документ\n\nСлайд 1. Обложка\n\nТекст обложки.\n\nСлайд 2. Сложный объект\n\nПервый факт остаётся во втором разделе. Второй факт тоже остаётся здесь.");
    expect(sections).toEqual([
      { order: 1, title: "Обложка", text: "Текст обложки." },
      { order: 2, title: "Сложный объект", text: "Первый факт остаётся во втором разделе. Второй факт тоже остаётся здесь." },
    ]);
  });

  it("keeps the Solar System/A inner editable text boxes inside the 48px native margin", () => {
    const notes = "Солнце — звезда среднего размера. В его центре происходят термоядерные реакции. Эта энергия распространяется наружу в виде излучения. Солнце также испускает поток заряженных частиц.";
    const prepared = prepareAiSceneV3Gate1Input({
      id: "solar_system",
      profileId: "solar_scientific_dark",
      slide: { id: "solar-2", order: 2, title: "Солнце — источник энергии и главный центр движения", speakerNotes: notes },
      speechScript: [{ slideOrder: 2, slideTitle: "Солнце — источник энергии и главный центр движения", text: notes }],
      speechSectionHash: "a".repeat(64),
      referencePaths: ["reference-1.png"],
    });
    const solarA = prepared.plans[0];
    expect(solarA.variant).toBe("A");
    expect(solarA.textZones.every((entry) => entry.zone.x * 1280 >= 48)).toBe(true);
    expect(solarA.textZones.map((entry) => entry.zone.x)).toEqual([.05, .05, .05, .05, .05]);
  });
});
