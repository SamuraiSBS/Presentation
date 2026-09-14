import { describe, expect, it } from "vitest";
import { slideCanvasSchema } from "../presentation/schemas.js";
import {
  compositionPlanV3Schema,
  slideSemanticBriefV3Schema,
  textLayoutV3Schema,
} from "./ai-scene-v3.js";

const hash = "a".repeat(64);

describe("AI Scene v3 shared contracts", () => {
  it("accepts a grounded content brief with four semantic anchors", () => {
    const brief = slideSemanticBriefV3Schema.parse({
      version: 3,
      slideId: "slide-2",
      slideOrder: 2,
      kind: "content",
      speechSectionHash: hash,
      title: { text: "Как устроена Солнечная система" },
      anchors: ["Солнце удерживает планеты гравитацией", "Планеты движутся по орбитам", "Внутренние планеты каменистые", "Внешние планеты значительно крупнее"].map((text, index) => ({
        id: `anchor:${index + 1}`,
        text,
        role: index === 1 ? "process" : "fact",
        priority: index + 1,
        visualCue: `Отдельный визуальный регион ${index + 1}`,
        sourceTrace: `Раздел речи, предложение ${index + 1}`,
      })),
      visualNarrative: "Солнце находится в центре, а группы планет различаются масштабом и расстоянием.",
      allowedCompositionTypes: ["layered_explanation", "hero_with_annotations"],
      contentHash: hash,
    });

    expect(brief.anchors).toHaveLength(4);
    expect(brief.kind).toBe("content");
  });

  it("rejects anchors on a cover and duplicate text-layout IDs", () => {
    const cover = {
      version: 3,
      slideId: "slide-1",
      slideOrder: 1,
      kind: "cover",
      speechSectionHash: hash,
      title: { text: "Солнечная система" },
      anchors: [{ id: "anchor:1", text: "Лишняя опора", role: "fact", priority: 1, visualCue: "Нельзя", sourceTrace: "Нельзя" }],
      visualNarrative: "Минимальная обложка с сильным тематическим визуалом.",
      allowedCompositionTypes: ["hero_with_annotations"],
      contentHash: hash,
    };
    expect(slideSemanticBriefV3Schema.safeParse(cover).success).toBe(false);

    expect(textLayoutV3Schema.safeParse({
      version: 3,
      slideId: "slide-2",
      entries: ["title", "title"].map((semanticId) => ({
        semanticId,
        x: 64, y: 48, w: 560, h: 120,
        fontFamily: "Arial", fallbackFontFamily: "Arial", fontSize: 48, minimumFontSize: 40,
        fontWeight: 700, lineHeight: 1.1, letterSpacing: 0, color: "#FFFFFF", align: "left", verticalAlign: "top",
        maxLines: 2, editable: true, zoneReason: "Свободная контрастная зона", contrastScore: 97, placementConfidence: 0.9,
      })),
    }).success).toBe(false);
  });

  it("rejects undersized or rasterized native overlay entries", () => {
    const entry = (semanticId: "title" | "anchor:1", fontSize: number, editable = true) => ({
      semanticId, x: 64, y: 48, w: 560, h: 120,
      fontFamily: "Arial", fallbackFontFamily: "Arial", fontSize, minimumFontSize: fontSize,
      fontWeight: 700, lineHeight: 1.1, letterSpacing: 0, color: "#FFFFFF", align: "left" as const, verticalAlign: "top" as const,
      maxLines: 2, editable, zoneReason: "Свободная контрастная зона", contrastScore: 97, placementConfidence: 0.9,
    });
    expect(textLayoutV3Schema.safeParse({ version: 3, slideId: "slide-2", entries: [entry("title", 39)] }).success).toBe(false);
    expect(textLayoutV3Schema.safeParse({ version: 3, slideId: "slide-2", entries: [entry("anchor:1", 23)] }).success).toBe(false);
    expect(textLayoutV3Schema.safeParse({ version: 3, slideId: "slide-2", entries: [entry("anchor:1", 24, false)] }).success).toBe(false);
  });

  it("keeps plans normalized and admits the v3 canvas origin without rebuilding it as a template", () => {
    expect(compositionPlanV3Schema.safeParse({
      version: 3,
      slideId: "slide-2",
      slideOrder: 2,
      variant: "A",
      compositionType: "comparison",
      mainVisualSubject: "Каменистые и газовые планеты",
      anchorVisualRegions: [],
      textZones: [{ semanticId: "title", zone: { x: 0.05, y: 0.08, w: 0.4, h: 0.16 }, maxLines: 2 }],
      quietZones: [{ x: 0.05, y: 0.08, w: 0.4, h: 0.16 }],
      cropRules: ["Не обрезать главные объекты по границе кадра"],
      variantDifference: "Вариант A сопоставляет две группы по сторонам кадра.",
    }).success).toBe(true);
    expect(slideCanvasSchema.parse({ origin: "ai_scene_v3", width: 1280, height: 720, background: "#101820", elements: [] }).origin).toBe("ai_scene_v3");
  });

  it("rejects overlapping text boxes and text placed over protected imagery", () => {
    const baseline = {
      version: 3,
      slideId: "slide-2",
      slideOrder: 2,
      variant: "A",
      compositionType: "comparison",
      mainVisualSubject: "Каменистые и газовые планеты",
      anchorVisualRegions: [],
      quietZones: [{ x: .04, y: .04, w: .44, h: .5 }],
      cropRules: ["Не обрезать главные объекты по границе кадра"],
      variantDifference: "Вариант A сопоставляет две группы по сторонам кадра.",
    };
    expect(compositionPlanV3Schema.safeParse({
      ...baseline,
      textZones: [
        { semanticId: "title", zone: { x: .05, y: .08, w: .4, h: .16 }, maxLines: 2 },
        { semanticId: "anchor:1", zone: { x: .05, y: .16, w: .4, h: .16 }, maxLines: 2 },
      ],
      protectedObjectZones: [],
    }).success).toBe(false);
    expect(compositionPlanV3Schema.safeParse({
      ...baseline,
      textZones: [{ semanticId: "title", zone: { x: .05, y: .08, w: .4, h: .16 }, maxLines: 2 }],
      protectedObjectZones: [{ x: .25, y: .08, w: .3, h: .3 }],
    }).success).toBe(false);
  });
});
