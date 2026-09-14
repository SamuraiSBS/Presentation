import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { renderAiSceneV3Candidate } from "./candidate-renderer.js";
import { selectAiSceneV3Candidate } from "./candidate-selector.js";
import { validateAiSceneV3CompositionPair } from "./composition-planner.js";
import { aiSceneV3TextFitDiagnostics, aiSceneV3TextLayoutGeometryDiagnostics, aiSceneV3TextLayoutPrompt, validateAiSceneV3TextLayout } from "./text-layout-analyzer.js";
import { aiSceneV3NativeBackplateBounds } from "./native-backplate.js";
import { brief, direction, layout, plan, report } from "./test-fixtures.js";
import { renderPdfCanvasElement } from "../../export/pdf-canvas.js";
import { renderPptxCanvasSlide } from "../../export/pptx-canvas.js";

describe("AI Scene v3 candidate pipeline", () => {
  it("requires two genuinely distinct plans and matching high-detail layout", () => {
    const [a, b] = validateAiSceneV3CompositionPair(plan("A", "layered_explanation"), plan("B", "comparison"), brief);
    expect([a.variant, b.variant]).toEqual(["A", "B"]);
    expect(validateAiSceneV3TextLayout({ value: layout(), brief, plan: a, artDirection: direction }).entries).toHaveLength(6);
  });

  it("requires compact entries-only TextLayoutV3 output and reports a missing entries contract precisely", () => {
    const a = plan("A", "layered_explanation");
    const prompt = aiSceneV3TextLayoutPrompt({ brief, plan: a, artDirection: direction, backgroundWidth: 1536, backgroundHeight: 864 });
    expect(prompt).toContain("compact minified JSON object");
    expect(prompt).toContain("entries MUST be an array");
    expect(() => validateAiSceneV3TextLayout({ value: { version: 3, slideId: brief.slideId }, brief, plan: a, artDirection: direction }))
      .toThrow("ai_scene_v3_text_layout_contract_invalid:entries:required");
  });

  it("rejects same-type A/B plans even when their descriptions differ", () => {
    const duplicated = { ...plan("B", "layered_explanation"), variantDifference: "Different colors and the opposite text side." };
    expect(() => validateAiSceneV3CompositionPair(plan("A", "layered_explanation"), duplicated, brief)).toThrow("ai_scene_v3_composition_pair_not_distinct");
  });

  it("rejects a composition zone that cannot hold a compact Russian anchor at 24px", () => {
    const longBrief = { ...brief, anchors: [{ ...brief.anchors[0]!, text: "Ядра водорода объединяются в ядра гелия и выделяют энергию." }, ...brief.anchors.slice(1)] };
    const unreadable = { ...plan("A", "layered_explanation"), textZones: plan("A", "layered_explanation").textZones.map((entry) => entry.semanticId === "anchor:1" ? { ...entry, zone: { x: .04, y: .2, w: .16, h: .08 } } : entry) };
    expect(() => validateAiSceneV3CompositionPair(unreadable, plan("B", "comparison"), longBrief)).toThrow("ai_scene_v3_composition_text_zone_unreadable:anchor:1");
  });

  it("rejects a one-line layout when the exact 24px anchor requires two lines", () => {
    const longBrief = { ...brief, anchors: [{ ...brief.anchors[0]!, text: "Ядра водорода объединяются в ядра гелия и выделяют энергию." }, ...brief.anchors.slice(1)] };
    const oneLine = { ...layout(), entries: layout().entries.map((entry) => entry.semanticId === "anchor:1" ? { ...entry, maxLines: 1 } : entry) };
    expect(aiSceneV3TextFitDiagnostics(oneLine, longBrief)).toContainEqual(expect.stringContaining("anchor:1:text_does_not_fit"));
  });

  it("rejects an oversized actual title even when its 40px readable floor would fit", () => {
    const solarTitle = "Солнце — источник энергии и главный центр движения";
    const safe = {
      ...layout(),
      entries: layout().entries.map((entry) => entry.semanticId === "title"
        ? { ...entry, w: 589, h: 112, fontSize: 40, minimumFontSize: 40, maxLines: 2 }
        : entry),
    };
    const oversized = {
      ...safe,
      entries: safe.entries.map((entry) => entry.semanticId === "title" ? { ...entry, fontSize: 72 } : entry),
    };
    const solarBrief = { ...brief, title: { text: solarTitle } };
    expect(aiSceneV3TextFitDiagnostics(safe, solarBrief)).toEqual([]);
    expect(aiSceneV3TextFitDiagnostics(oversized, solarBrief)).toContainEqual(expect.stringContaining("title:font_size_must_equal_40px,text_does_not_fit"));
  });

  it("rejects the manifest's title/anchor collision and a renderer-incompatible line contract before vision review", () => {
    const collided = {
      ...layout(),
      entries: layout().entries.map((entry) => entry.semanticId === "anchor:1"
        ? { ...entry, y: layout().entries.find((candidate) => candidate.semanticId === "title")!.y, maxLines: 1, lineHeight: 1.2 }
        : entry),
    };
    expect(aiSceneV3TextLayoutGeometryDiagnostics(collided, plan("A", "layered_explanation")))
      .toContainEqual(expect.stringContaining("anchor:1:outside_text_zone"));
    expect(() => validateAiSceneV3TextLayout({ value: collided, brief, plan: plan("A", "layered_explanation"), artDirection: direction }))
      .toThrow("ai_scene_v3_text_layout_outside_quiet_zone:anchor:1");
    const rendererIncompatible = {
      ...layout(),
      entries: layout().entries.map((entry) => entry.semanticId === "title" ? { ...entry, maxLines: 1, lineHeight: 1.2 } : entry),
    };
    expect(() => validateAiSceneV3TextLayout({ value: rendererIncompatible, brief, plan: plan("A", "layered_explanation"), artDirection: direction }))
      .toThrow("ai_scene_v3_text_layout_unsafe_geometry:title:max_lines_mismatch;title:line_height_mismatch");
  });

  it("keeps a long Russian title and four compact source-grounded anchors inside protected two-line geometry", () => {
    const solarBrief = {
      ...brief,
      conclusion: undefined,
      title: { text: "Солнце — источник энергии и главный центр движения" },
      anchors: [
        "Солнце — звезда среднего размера",
        "В его центре происходят термоядерные реакции",
        "Эта энергия распространяется наружу в виде излучения",
        "Солнце также испускает поток заряженных частиц",
      ].map((text, index) => ({ ...brief.anchors[index]!, text, sourceTrace: `Полное исходное предложение ${index + 1}: ${text}.` })),
    };
    const solarPlan = {
      ...plan("A", "layered_explanation"),
      textZones: [
        { semanticId: "title" as const, zone: { x: .05, y: .045, w: .443, h: .137 }, maxLines: 2 },
        ...solarBrief.anchors.map((anchor, index) => ({ semanticId: anchor.id, zone: { x: .05, y: [.235, .4, .565, .732][index]!, w: .43, h: .095 }, maxLines: 2 })),
      ],
      quietZones: [{ x: .015, y: .04, w: .48, h: .80 }],
      protectedObjectZones: [{ x: .58, y: .08, w: .38, h: .84 }],
    };
    const solarLayout = {
      version: 3 as const,
      slideId: solarBrief.slideId,
      entries: solarPlan.textZones.map((entry) => ({
        semanticId: entry.semanticId, x: entry.zone.x * 1280, y: entry.zone.y * 720, w: entry.zone.w * 1280, h: entry.zone.h * 720,
        fontFamily: "Nunito", fallbackFontFamily: "Nunito", fontSize: entry.semanticId === "title" ? 40 : 24, minimumFontSize: entry.semanticId === "title" ? 40 : 24,
        fontWeight: entry.semanticId === "title" ? 700 : 500, lineHeight: entry.semanticId === "title" ? 1.12 : 1.14, letterSpacing: 0, color: "#FFFFFF",
        align: "left" as const, verticalAlign: "top" as const, maxLines: 2, editable: true, zoneReason: "protected quiet native text field", contrastScore: 90, placementConfidence: .95,
      })),
    };
    expect(validateAiSceneV3TextLayout({ value: solarLayout, brief: solarBrief, plan: solarPlan, artDirection: direction }).entries).toHaveLength(5);
    expect(aiSceneV3TextFitDiagnostics(solarLayout, solarBrief)).toEqual([]);
    expect(aiSceneV3TextLayoutGeometryDiagnostics(solarLayout, solarPlan)).toEqual([]);
    const title = solarLayout.entries.find((entry) => entry.semanticId === "title")!;
    expect(title.x).toBe(64);
    // The contrast plate intentionally extends into the quiet field. Only the
    // inner editable text box is required to satisfy the native safe margin.
    expect(aiSceneV3NativeBackplateBounds(title).x).toBe(46);
    expect(solarPlan.textZones.map((entry) => entry.zone.y)).toEqual([.045, .235, .4, .565, .732]);
  });

  it("renders a locked background plus independently editable native text", async () => {
    const background = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const rendered = await renderAiSceneV3Candidate({ background: { buffer: background, objectKey: "background.png", url: "https://assets.example.test/background.png", alt: "Solar System", contentType: "image/png" }, layout: layout(), textValues: [{ semanticId: "title", value: { text: "Планеты" } }, ...brief.anchors.map((anchor) => ({ semanticId: anchor.id, value: { text: anchor.text } })), { semanticId: "conclusion", value: { text: "Система связана орбитами" } }], backgroundColor: "#071827" });
    expect(rendered.canvas.origin).toBe("ai_scene_v3");
    expect(rendered.canvas.elements[0]).toMatchObject({ locked: true, type: "image" });
    const titleBackplate = rendered.canvas.elements.find((element) => element.id === "ai-scene-v3-title-backplate");
    const title = rendered.canvas.elements.find((element) => element.id === "ai-scene-v3-title");
    expect(titleBackplate).toMatchObject({ type: "shape", shape: "roundRect", locked: true, fill: "#071827", x: title!.x - 18, y: title!.y + 3, w: title!.w + 32, h: title!.h - 4 });
    expect(title).toMatchObject({ type: "text", locked: false, fontSize: 40 });
    expect(titleBackplate!.zIndex).toBe(title!.zIndex - 1);
    const firstAnchorBackplate = rendered.canvas.elements.find((element) => element.id === "ai-scene-v3-anchor-1-backplate");
    const firstAnchor = rendered.canvas.elements.find((element) => element.id === "ai-scene-v3-anchor-1");
    expect(firstAnchorBackplate).toMatchObject({ type: "shape", x: firstAnchor!.x - 18, y: firstAnchor!.y - 16, w: firstAnchor!.w + 48, h: firstAnchor!.h + 28 });
    expect(rendered.canvas.elements.filter((element) => element.type === "shape")).toHaveLength(layout().entries.length);
    expect((await sharp(rendered.preview).metadata()).width).toBe(1280);
  });

  it("uses the same native overlay canvas for PDF and PPTX", async () => {
    const background = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const rendered = await renderAiSceneV3Candidate({ background: { buffer: background, objectKey: "background.png", url: "https://assets.example.test/background.png", alt: "Solar System", contentType: "image/png" }, layout: layout(), textValues: [{ semanticId: "title", value: { text: "Планеты" } }, ...brief.anchors.map((anchor) => ({ semanticId: anchor.id, value: { text: anchor.text } })), { semanticId: "conclusion", value: { text: "Система связана орбитами" } }], backgroundColor: "#071827" });
    const title = rendered.canvas.elements.find((element) => element.type === "text" && element.text === "Планеты")!;
    const pdf = await renderPdfCanvasElement(title, { readObjectBuffer: async () => background, contentTypeFromObjectKey: () => "image/png", warn: () => undefined });
    expect(pdf).toContain("Планеты");
    const addText = vi.fn(); const addImage = vi.fn();
    await renderPptxCanvasSlide(
      { ShapeType: { ellipse: "ellipse", line: "line", rect: "rect", roundRect: "roundRect" } },
      { addShape: vi.fn(), addText, addImage }, rendered.canvas,
      { colors: { background: "#071827", surface: "#16385C", text: "#FFFFFF", muted: "#DDEEFF", accent: "#FFC857", accentAlt: "#55D6E8", line: "#55D6E8" }, fonts: { heading: "Arial", body: "Arial" }, themeId: "test", name: "test", mood: "dark", pptx: { background: "071827", surface: "16385C", surfaceAlt: "16385C", text: "FFFFFF", muted: "DDEEFF", accent: "FFC857", accentAlt: "55D6E8", line: "55D6E8" } } as any,
      { readObjectBuffer: async () => background, contentTypeFromObjectKey: () => "image/png", warn: () => undefined },
    );
    expect(addText).toHaveBeenCalledWith("Планеты", expect.objectContaining({ fontFace: "Nunito", fit: "none" }));
    expect(addImage).toHaveBeenCalled();
  });

  it("never auto-selects a failed candidate", () => {
    expect(selectAiSceneV3Candidate([{ id: "a", variant: "A" as const, qualityReport: report(false, 92) }, { id: "b", variant: "B" as const, qualityReport: report(false, 88) }]).status).toBe("generate_c");
    expect(selectAiSceneV3Candidate([{ id: "a", variant: "A" as const, qualityReport: report(true, 82) }, { id: "b", variant: "B" as const, qualityReport: report(true, 91) }]).selectedCandidateId).toBe("b");
  });
});
