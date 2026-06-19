import { describe, expect, it } from "vitest";
import {
  buildSlideCanvas,
  createProjectInputSchema,
  ensureEditableCanvas,
  generatePresentationInputSchema,
  generationJobKindSchema,
  hasCustomSlideCanvas,
  planLimits,
  presentationSchema,
  projectStatusSchema,
  resolvePresentationTheme,
  slideCanvasSchema,
  updateNarrationInputSchema,
} from "./index";

describe("shared contracts", () => {
  it("validates project input limits", () => {
    expect(() =>
      createProjectInputSchema.parse({
        title: "AI in education",
        prompt: "Сделай понятную презентацию по теме искусственного интеллекта в образовании",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 10,
      }),
    ).not.toThrow();
  });

  it("keeps free plan export limited to pdf", () => {
    expect(planLimits.free.exports).toEqual(["pdf"]);
  });

  it("accepts two-step generation statuses and job kinds", () => {
    expect(projectStatusSchema.parse("script_queued")).toBe("script_queued");
    expect(projectStatusSchema.parse("script_generating")).toBe("script_generating");
    expect(projectStatusSchema.parse("script_ready")).toBe("script_ready");
    expect(generationJobKindSchema.parse("narration")).toBe("narration");
    expect(generationJobKindSchema.parse("presentation")).toBe("presentation");
  });

  it("validates editable speech drafts for final generation", () => {
    const speechDraft = "Слайд 1: Введение\nЭто достаточно длинный текст выступления для проверки сохранения.";
    expect(updateNarrationInputSchema.parse({ speechDraft }).speechDraft).toBe(speechDraft);
    expect(generatePresentationInputSchema.parse({ speechDraft }).speechDraft).toBe(speechDraft);
    expect(generatePresentationInputSchema.parse({})).toEqual({});
  });

  it("requires a structured presentation document", () => {
    expect(() => presentationSchema.parse({ id: "x" })).toThrow();
  });

  it("parses structured slide fields", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Structured deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      generatedText: "Слайд 1: Core idea\nA slide should teach one clear idea.",
      sources: [],
      outline: ["Core idea"],
      narrativePlan: [
        {
          slideOrder: 1,
          slideTitle: "Core idea",
          slidePurpose: "Introduce the main role of this slide in the talk.",
          keyMessage: "A slide should teach one clear idea.",
          audienceQuestion: "What should one slide explain?",
          transitionToNext: "",
        },
      ],
      speechScript: [{ slideOrder: 1, slideTitle: "Core idea", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Core idea",
          slideKind: "content",
          layout: "bullets",
          thesis: "A slide should teach one clear idea.",
          bullets: ["Use one thesis", "Keep bullets short", "Add a visual cue"],
          definition: { term: "Thesis", text: "The main claim of a slide." },
          keyConcepts: [{ label: "Structure", icon: "layers" }],
          visual: {
            type: "process_diagram",
            title: "How it works",
            items: [
              { label: "Read", text: "Find the idea" },
              { label: "Group", text: "Pick points" },
            ],
          },
          highlights: [{ text: "one idea", tone: "accent" }],
          blocks: [{ type: "callout", content: "Fallback body." }],
          speakerNotes: "Explain the structure.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].thesis).toBe("A slide should teach one clear idea.");
    expect(parsed.narrativePlan).toHaveLength(1);
    expect(parsed.narrativePlan[0].transitionToNext).toBe("");
    expect(parsed.generatedText).toContain("Слайд 1:");
    expect(parsed.slides[0].visual.type).toBe("process_diagram");
    expect(parsed.slides[0].highlights[0].tone).toBe("accent");
  });

  it("accepts cached slide image metadata", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Image deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Core idea"],
      speechScript: [{ slideOrder: 1, slideTitle: "Core idea", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Core idea",
          layout: "hero",
          visual: {
            type: "none",
            image: {
              url: "https://cdn.example.com/image.jpg",
              objectKey: "projects/project-1/images/slide-1.jpg",
              alt: "Classroom image",
              query: "classroom",
              sourceUrl: "https://example.com/article",
              sourceTitle: "Article",
              provider: "tavily",
              contentType: "image/jpeg",
            },
          },
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].visual.image?.objectKey).toBe("projects/project-1/images/slide-1.jpg");
  });

  it("accepts varied slide layouts", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Varied deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Question"],
      speechScript: [{ slideOrder: 1, slideTitle: "Question", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "What changed?",
          layout: "question-answer",
          thesis: "The answer is short and concrete.",
          blocks: [{ type: "callout", content: "The answer is short and concrete." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].layout).toBe("question-answer");
  });

  it("keeps old slide documents valid with structured defaults", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Legacy deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Legacy slide"],
      speechScript: [{ slideOrder: 1, slideTitle: "Legacy slide", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Legacy slide",
          layout: "bullets",
          blocks: [{ type: "callout", content: "Legacy body." }],
          speakerNotes: "Legacy notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].slideKind).toBe("content");
    expect(parsed.slides[0].thesis).toBe("");
    expect(parsed.slides[0].bullets).toEqual([]);
    expect(parsed.slides[0].visual.type).toBe("none");
    expect(parsed.generatedText).toBe("");
    expect(parsed.narrativePlan).toEqual([]);
  });

  it("builds editable canvas for legacy slides", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Editable deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Editable slide"],
      speechScript: [{ slideOrder: 1, slideTitle: "Editable slide", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Editable slide",
          layout: "bullets",
          thesis: "Canvas text body.",
          bullets: ["First", "Second"],
          blocks: [{ type: "callout", content: "Fallback body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    const editable = ensureEditableCanvas(parsed);
    expect(editable.slides[0].canvas?.width).toBe(1280);
    expect(editable.slides[0].canvas?.elements.some((element) => element.type === "text" && element.role === "title")).toBe(true);
  });

  it("keeps title image slides in the old hero composition while editable", () => {
    const theme = resolvePresentationTheme({ title: "MacBook notebooks" });
    const slide = presentationSchema.parse({
      id: "presentation-1",
      title: "MacBook deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["MacBook notebooks"],
      speechScript: [{ slideOrder: 1, slideTitle: "MacBook notebooks", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "MacBook notebooks",
          slideKind: "title",
          layout: "hero",
          thesis: "MacBook notebooks are known for design and performance.",
          bullets: ["Stylish design", "High performance", "Broad features"],
          visual: {
            type: "none",
            image: {
              url: "https://cdn.example.com/macbook.jpg",
              objectKey: "projects/project-1/images/slide-1.jpg",
              alt: "MacBook",
              query: "macbook",
              provider: "tavily",
              contentType: "image/jpeg",
            },
          },
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    }).slides[0];

    const canvas = buildSlideCanvas(slide, theme);
    const panel = canvas.elements.find((element) => element.id === "slide-1-panel");
    const image = canvas.elements.find((element) => element.id === "slide-1-image-bg");
    const chips = canvas.elements.filter((element) => element.id.startsWith("slide-1-mini-") && element.type === "text");

    expect(panel).toMatchObject({ type: "shape", x: 66, y: 54, w: 1148, h: 612 });
    expect(image).toMatchObject({ type: "image", fit: "contain", x: 66, y: 54, w: 1148, h: 612 });
    expect(chips).toHaveLength(3);
  });

  it("keeps generated canvas title and chip text boxes tall enough for web scaling", () => {
    const theme = resolvePresentationTheme({ title: "Readable canvas" });
    const titleSlide = presentationSchema.parse({
      id: "presentation-1",
      title: "Readable canvas",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Readable canvas"],
      speechScript: [{ slideOrder: 1, slideTitle: "Readable canvas", text: "Narration." }],
      slides: [
        {
          id: "slide-title",
          order: 1,
          title: "Readable generated title that can wrap onto two lines",
          slideKind: "title",
          layout: "hero",
          thesis: "Generated title slides should not clip text.",
          bullets: ["First mini point can wrap", "Second mini point", "Third mini point"],
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    }).slides[0];
    const contentSlide = presentationSchema.parse({
      id: "presentation-2",
      title: "Readable content",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Readable content"],
      speechScript: [{ slideOrder: 1, slideTitle: "Readable content", text: "Narration." }],
      slides: [
        {
          id: "slide-content",
          order: 1,
          title: "Readable generated content title that can wrap",
          slideKind: "content",
          layout: "bullets",
          thesis: "Generated content slides should not clip titles.",
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    }).slides[0];

    const titleCanvas = buildSlideCanvas(titleSlide, theme);
    const heroTitle = titleCanvas.elements.find((element) => element.id === "slide-title-title");
    const miniChip = titleCanvas.elements.find((element) => element.id === "slide-title-mini-0");
    const contentCanvas = buildSlideCanvas(contentSlide, theme);
    const contentTitle = contentCanvas.elements.find((element) => element.id === "slide-content-title");

    expect(heroTitle).toMatchObject({ type: "text", fontSize: 58, h: 148 });
    expect(miniChip).toMatchObject({ type: "text", fontSize: 15, h: 36 });
    expect(contentTitle).toMatchObject({ type: "text", fontSize: 46, h: 112 });
    expect(miniChip?.type === "text" ? miniChip.text.length : 0).toBeLessThanOrEqual(28);
  });

  it("distinguishes generated canvases from user-edited canvases", () => {
    const theme = resolvePresentationTheme({ title: "Canvas detection" });
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Canvas detection",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Canvas detection"],
      speechScript: [{ slideOrder: 1, slideTitle: "Canvas detection", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Canvas detection",
          slideKind: "content",
          layout: "bullets",
          thesis: "Generated canvas should not override the template renderer.",
          bullets: ["First", "Second"],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    });
    const generatedCanvas = buildSlideCanvas(parsed.slides[0], theme);
    const generatedSlide = { ...parsed.slides[0], canvas: generatedCanvas };
    const editedSlide = {
      ...generatedSlide,
      canvas: {
        ...generatedCanvas,
        elements: generatedCanvas.elements.map((element) => element.id === "slide-1-title" ? { ...element, x: element.x + 24 } : element),
      },
    };

    expect(hasCustomSlideCanvas(generatedSlide, theme)).toBe(false);
    expect(hasCustomSlideCanvas(editedSlide, theme)).toBe(true);
    expect(ensureEditableCanvas({ ...parsed, slides: [editedSlide] }).slides[0].canvas?.elements.find((element) => element.id === "slide-1-title")).toMatchObject({ x: 125 });
  });

  it("treats old lean title auto-canvas as generated output", () => {
    const theme = resolvePresentationTheme({ title: "Legacy title canvas" });
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Legacy title canvas",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Legacy title canvas"],
      speechScript: [{ slideOrder: 1, slideTitle: "Legacy title canvas", text: "Narration." }],
      slides: [
        {
          id: "slide-legacy",
          order: 1,
          title: "Legacy title canvas",
          slideKind: "title",
          layout: "hero",
          thesis: "Old generated title canvas should not force object rendering.",
          bullets: ["First", "Second", "Third"],
          visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    });
    const legacyCanvas = {
      width: 1280,
      height: 720,
      background: theme.colors.background,
      elements: [
        { id: "slide-legacy-bg", type: "shape" as const, shape: "rect" as const, x: 0, y: 0, w: 1280, h: 720, rotation: 0, zIndex: 0, opacity: 1, locked: true, fill: theme.colors.background, stroke: theme.colors.background, strokeWidth: 0 },
        { id: "slide-legacy-bg-title-accent", type: "shape" as const, shape: "rect" as const, x: 0, y: 0, w: 394, h: 720, rotation: 0, zIndex: 1, opacity: 0.42, locked: false, fill: theme.colors.accent, stroke: theme.colors.accent, strokeWidth: 0 },
        { id: "slide-legacy-bg-title-alt", type: "shape" as const, shape: "rect" as const, x: 1037, y: 0, w: 243, h: 230, rotation: 0, zIndex: 1, opacity: 0.3, locked: false, fill: theme.colors.accentAlt, stroke: theme.colors.accentAlt, strokeWidth: 0 },
        { id: "slide-legacy-title", type: "text" as const, role: "title" as const, text: "Legacy title canvas", runs: [{ text: "Legacy title canvas" }], x: 112, y: 206, w: 1056, h: 116, rotation: 0, zIndex: 5, opacity: 1, locked: false, fontFamily: "Georgia", fontSize: 58, bold: true, italic: false, underline: false, color: theme.colors.text, align: "center" as const },
        { id: "slide-legacy-body", type: "text" as const, role: "body" as const, text: "Old generated title canvas should not force object rendering.", runs: [{ text: "Old generated title canvas should not force object rendering." }], x: 158, y: 346, w: 964, h: 120, rotation: 0, zIndex: 5, opacity: 1, locked: false, fontFamily: "Arial", fontSize: 28, bold: false, italic: false, underline: false, color: theme.colors.mutedText, align: "center" as const },
      ],
    };
    const legacySlide = { ...parsed.slides[0], canvas: legacyCanvas };

    expect(hasCustomSlideCanvas(legacySlide, theme)).toBe(false);
    expect(ensureEditableCanvas({ ...parsed, slides: [legacySlide] }).slides[0].canvas?.elements.some((element) => element.id === "slide-legacy-panel")).toBe(true);
  });

  it("rebuilds old fullscreen title image canvases as generated content", () => {
    const theme = resolvePresentationTheme({ title: "MacBook notebooks" });
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "MacBook deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["MacBook notebooks"],
      speechScript: [{ slideOrder: 1, slideTitle: "MacBook notebooks", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "MacBook notebooks",
          slideKind: "title",
          layout: "hero",
          thesis: "MacBook notebooks are known for design and performance.",
          bullets: ["Stylish design"],
          visual: {
            type: "none",
            image: {
              url: "https://cdn.example.com/macbook.jpg",
              objectKey: "projects/project-1/images/slide-1.jpg",
              alt: "MacBook",
              query: "macbook",
              provider: "tavily",
              contentType: "image/jpeg",
            },
          },
          canvas: {
            width: 1280,
            height: 720,
            background: theme.colors.background,
            elements: [
              {
                id: "slide-1-image",
                type: "image",
                x: 0,
                y: 0,
                w: 1280,
                h: 720,
                zIndex: 1,
                opacity: 0.26,
                url: "https://cdn.example.com/macbook.jpg",
                objectKey: "projects/project-1/images/slide-1.jpg",
                alt: "MacBook",
                contentType: "image/jpeg",
                fit: "cover",
              },
            ],
          },
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    });

    const editable = ensureEditableCanvas(parsed);

    expect(editable.slides[0].canvas?.elements.find((element) => element.id === "slide-1-image-bg")).toMatchObject({ type: "image", fit: "contain" });
    expect(editable.slides[0].canvas?.elements.find((element) => element.id === "slide-1-image")).toBeUndefined();
  });

  it("accepts rich text, image and shape canvas elements", () => {
    const canvas = slideCanvasSchema.parse({
      width: 1280,
      height: 720,
      background: "#FFFFFF",
      elements: [
        {
          id: "text-1",
          type: "text",
          x: 10,
          y: 20,
          w: 320,
          h: 80,
          zIndex: 2,
          text: "Hello",
          runs: [{ text: "He", bold: true }, { text: "llo", italic: true, underline: true }],
          fontSize: 34,
          color: "#111111",
          align: "center",
        },
        {
          id: "image-1",
          type: "image",
          x: 40,
          y: 120,
          w: 300,
          h: 180,
          zIndex: 3,
          objectKey: "projects/p/slides/s/assets/image.jpg",
          url: "/api/projects/p/slides/s/assets/image-1",
          contentType: "image/jpeg",
        },
        {
          id: "shape-1",
          type: "shape",
          shape: "ellipse",
          x: 80,
          y: 320,
          w: 160,
          h: 120,
          zIndex: 1,
          fill: "#EFEFEF",
          stroke: "#222222",
          strokeWidth: 3,
        },
      ],
    });

    expect(canvas.elements).toHaveLength(3);
    expect(canvas.elements[0].type).toBe("text");
  });

  it("accepts presentation theme while keeping legacy documents valid", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-1",
      title: "Dark deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Dark deck"],
      presentationTheme: resolvePresentationTheme({ title: "Трагедия и кризис" }),
      speechScript: [{ slideOrder: 1, slideTitle: "Dark deck", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Dark deck",
          layout: "hero",
          blocks: [{ type: "callout", content: "Body." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.presentationTheme?.preset).toBe("moody");
    expect(parsed.presentationTheme?.colors.background).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("resolves topic-sensitive and stable fallback themes", () => {
    expect(resolvePresentationTheme({ title: "Война и катастрофа" }).mood).toBe("dark");
    expect(resolvePresentationTheme({ title: "Веселый детский праздник" }).preset).toBe("bright");
    expect(resolvePresentationTheme({ title: "Программирование и данные" }).preset).toBe("tech");

    const first = resolvePresentationTheme({ title: "Neutral topic alpha" });
    const second = resolvePresentationTheme({ title: "Neutral topic beta" });
    expect(first.preset).not.toBe(second.preset);
  });
});
