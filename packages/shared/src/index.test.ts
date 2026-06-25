import { describe, expect, it } from "vitest";
import {
  buildSlideCanvas,
  createProjectInputSchema,
  ensureEditableCanvas,
  generatePresentationInputSchema,
  generationPipelineArtifactsSchema,
  generationJobKindSchema,
  hasCustomSlideCanvas,
  planLimits,
  presentationSchema,
  projectStatusSchema,
  qualityCritiqueSchema,
  researchBriefSchema,
  resolvePresentationTheme,
  slideCanvasSchema,
  slideBlueprintSchema,
  slideLayoutSchema,
  slideLayoutOptions,
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

  it("keeps the legacy two-column layout readable but hides it from new selections", () => {
    expect(slideLayoutOptions("content").map((layout) => layout.id)).not.toContain("two-column");
  });

  it("hides removed layouts from new selections while keeping legacy schema support", () => {
    const layouts = slideLayoutOptions("content").map((layout) => layout.id);
    expect(layouts).not.toContain("definition");
    expect(layouts).not.toContain("evidence");
    expect(layouts).not.toContain("explain-example");
    expect(layouts).not.toContain("comparison");
    expect(layouts).not.toContain("myth-fact");
    expect(layouts).not.toContain("problem-solution");
    expect(() => slideLayoutSchema.parse("definition")).not.toThrow();
    expect(() => slideLayoutSchema.parse("comparison")).not.toThrow();
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

  it("validates generation pipeline artifacts as small composable contracts", () => {
    const researchBrief = researchBriefSchema.parse({
      topic: "AI in education",
      angle: "Explain how AI helps students prepare reports.",
      facts: [{ text: "AI can summarize source material.", confidence: "high" }],
    });
    const slideBlueprint = slideBlueprintSchema.parse({
      slideOrder: 1,
      purpose: "Open the topic.",
      title: "AI helps prepare reports",
      visualStrategy: "Simple hero slide with one clear claim.",
      layoutCandidate: "hero",
    });
    const qualityCritique = qualityCritiqueSchema.parse({ passed: true });

    expect(researchBrief.warnings).toEqual([]);
    expect(slideBlueprint.textDensity).toBe("medium");
    expect(qualityCritique.issues).toEqual([]);
    expect(() =>
      generationPipelineArtifactsSchema.parse({
        researchBrief,
        narrativePlan: [
          {
            slideOrder: 1,
            slideTitle: "AI helps prepare reports",
            slidePurpose: "Open the topic.",
            keyMessage: "AI can make preparation easier.",
            audienceQuestion: "How does AI help students?",
            transitionToNext: "",
          },
        ],
        designBrief: {
          themePreset: "minimal",
          mood: "neutral",
          visualDirection: "Clean study deck.",
        },
        slideBlueprints: [slideBlueprint],
        qualityCritique,
      }),
    ).not.toThrow();
  });

  it("rejects incomplete generation pipeline artifacts", () => {
    expect(() => researchBriefSchema.parse({ topic: "Only topic" })).toThrow();
    expect(() => slideBlueprintSchema.parse({ slideOrder: 1, title: "Missing fields" })).toThrow();
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
    const image = canvas.elements.find((element) => element.id === "slide-1-image-bg");
    const chips = canvas.elements.filter((element) => element.id.startsWith("slide-1-mini-") && element.type === "text");

    expect(canvas.elements.find((element) => element.id === "slide-1-panel")).toBeUndefined();
    expect(image).toMatchObject({ type: "image", fit: "cover", x: 0, y: 0, w: 1280, h: 720 });
    expect(chips).toHaveLength(3);
  });

  it("does not render unfinished sentence fragments in mini point chips", () => {
    const theme = resolvePresentationTheme({ title: "Readable chips" });
    const slide = presentationSchema.parse({
      id: "presentation-1",
      title: "Readable chips",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Readable chips"],
      speechScript: [{ slideOrder: 1, slideTitle: "Readable chips", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Что стоит понять сначала",
          slideKind: "title",
          layout: "hero",
          thesis: "РКСИ имеет богатую историю и традиции.",
          bullets: ["Колледж прошел долгий путь развития", "Девиз РКСИ отражает ценности обучения", "Первое что стоит отметить это богатая"],
          visual: {
            type: "none",
            image: {
              url: "https://cdn.example.com/college.jpg",
              objectKey: "projects/project-1/images/slide-1.jpg",
              alt: "College",
              query: "college",
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
    const chip = canvas.elements.find((element) => element.id === "slide-1-mini-2" && element.type === "text");

    expect(chip).toMatchObject({ text: "РКСИ имеет богатую историю и традиции." });
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
    const miniChips = titleCanvas.elements
      .filter((element) => element.type === "shape" && /-mini-\d+-shape$/.test(element.id))
      .sort((left, right) => left.y - right.y || left.x - right.x);
    const contentCanvas = buildSlideCanvas(contentSlide, theme);
    const contentTitle = contentCanvas.elements.find((element) => element.id === "slide-content-title");

    expect(heroTitle).toMatchObject({ type: "text", fontSize: 58, h: 148 });
    expect(miniChip).toMatchObject({ type: "text", fontSize: 24 });
    expect(miniChip?.h || 0).toBeGreaterThanOrEqual(74);
    expect(miniChip?.w || 0).toBeGreaterThan(184);
    expect(contentTitle).toMatchObject({ type: "text", h: 112 });
    expect(contentTitle?.type === "text" ? contentTitle.fontSize : 0).toBeLessThanOrEqual(46);
    expect(miniChip?.type === "text" ? miniChip.text.split(/\s+/).length : 0).toBeGreaterThanOrEqual(5);
    expect(miniChip?.type === "text" ? miniChip.text.split(/\s+/).length : 0).toBeLessThanOrEqual(6);
    expect(miniChip?.type === "text" ? miniChip.text : "").not.toContain("...");
    expect(miniChip).toMatchObject({ align: "center", valign: "middle" });
    expect(miniChips[0].x + miniChips[0].w).toBeLessThan(miniChips[1].x);
    expect(miniChips[2].y).toBeGreaterThan(miniChips[0].y + miniChips[0].h);
    expect(miniChips[2].x).toBe(miniChips[0].x);
    expect(miniChips[2].w).toBeGreaterThanOrEqual(538);
  });

  it("builds summary slides as one conclusion with supporting thoughts and a final takeaway", () => {
    const theme = resolvePresentationTheme({ title: "Summary story" });
    const slide = presentationSchema.parse({
      id: "presentation-summary",
      title: "Summary story",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Why the topic matters"],
      speechScript: [{ slideOrder: 1, slideTitle: "Why the topic matters", text: "Narration." }],
      slides: [
        {
          id: "slide-summary",
          order: 1,
          title: "Why the topic matters",
          slideKind: "summary",
          layout: "summary",
          thesis: "The main conclusion should finish the presentation with one clear idea.",
          bullets: [
            "The first supporting thought explains the cause.",
            "The second supporting thought shows the change.",
            "The third supporting thought names the consequence.",
            "The final thought gives the audience something to remember.",
          ],
          visual: {
            type: "none",
            image: {
              url: "https://cdn.example.com/summary.jpg",
              objectKey: "projects/project-1/images/summary.jpg",
              alt: "Decorative summary",
              query: "summary",
              provider: "tavily",
              contentType: "image/jpeg",
            },
          },
          blocks: [],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    }).slides[0];

    const canvas = buildSlideCanvas(slide, theme);
    const supportItems = canvas.elements.filter((element) => /^slide-summary-summary-support-\d+$/.test(element.id));

    expect(canvas.elements.find((element) => element.id === "slide-summary-summary-conclusion")).toMatchObject({
      type: "text",
      text: slide.thesis,
      bold: true,
    });
    expect(supportItems).toHaveLength(3);
    expect(supportItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "text",
        fontSize: 24,
      }),
    ]));
    expect(canvas.elements.find((element) => element.id === "slide-summary-summary-support-0-backplate")).toMatchObject({
      type: "shape",
      h: expect.any(Number),
    });
    expect(canvas.elements.find((element) => element.id === "slide-summary-summary-final")).toMatchObject({
      type: "text",
      text: slide.bullets[3],
      fontSize: 24,
    });
    expect(canvas.elements.find((element) => element.id === "slide-summary-summary-final-bg")).toMatchObject({
      type: "shape",
      h: 112,
    });
    expect(canvas.elements.some((element) => element.type === "image")).toBe(false);
    expect(canvas.elements.some((element) => /summary-\d+-card$/.test(element.id))).toBe(false);
  });

  it("centers title content and stretches a single lower plaque to the upper row width", () => {
    const theme = resolvePresentationTheme({ title: "Centered title" });
    const slide = presentationSchema.parse({
      id: "presentation-title-grid",
      title: "Centered title",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Centered title"],
      speechScript: [{ slideOrder: 1, slideTitle: "Centered title", text: "Narration." }],
      slides: [
        {
          id: "slide-title",
          order: 1,
          title: "Centered title",
          slideKind: "title",
          layout: "hero",
          thesis: "A centered introduction.",
          bullets: ["First point", "Second point", "Third point"],
          visual: { type: "none" },
          blocks: [],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    }).slides[0];

    const canvas = buildSlideCanvas(slide, theme);
    const first = canvas.elements.find((element) => element.id === "slide-title-mini-0-shape");
    const second = canvas.elements.find((element) => element.id === "slide-title-mini-1-shape");
    const third = canvas.elements.find((element) => element.id === "slide-title-mini-2-shape");
    const title = canvas.elements.find((element) => element.id === "slide-title-title");
    const body = canvas.elements.find((element) => element.id === "slide-title-body");

    expect(title).toMatchObject({ type: "text", align: "center", valign: "middle", y: 118 });
    expect(body).toMatchObject({ type: "text", align: "center", valign: "middle", y: 282 });
    expect(first).toMatchObject({ type: "shape", x: 351, w: 280 });
    expect(second).toMatchObject({ type: "shape", x: 649, w: 280 });
    expect(third).toMatchObject({ type: "shape", x: 351, w: 578 });
    expect((third?.y || 0)).toBeGreaterThan(first?.y || 0);
  });

  it("upgrades the previous generated title row without replacing a marked custom title canvas", () => {
    const theme = resolvePresentationTheme({ title: "Legacy title row" });
    const parsed = presentationSchema.parse({
      id: "presentation-legacy-title-row",
      title: "Legacy title row",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Legacy title row"],
      speechScript: [{ slideOrder: 1, slideTitle: "Legacy title row", text: "Narration." }],
      slides: [
        {
          id: "slide-title",
          order: 1,
          title: "Legacy title row",
          slideKind: "title",
          layout: "hero",
          thesis: "Old generated geometry.",
          bullets: ["First point", "Second point", "Third point"],
          visual: { type: "none" },
          blocks: [],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
      presentationTheme: theme,
    });
    const current = buildSlideCanvas(parsed.slides[0], theme);
    const legacyElements = current.elements.map((element) => {
      if (element.id === "slide-title-title") return { ...element, y: 188 };
      if (element.id === "slide-title-body") return { ...element, y: 356 };
      if (/-mini-\d+-shape$/.test(element.id)) {
        const index = Number(element.id.match(/-mini-(\d+)-shape$/)?.[1] || 0);
        return { ...element, x: 296 + index * (element.w + 18), y: 512, w: 204 };
      }
      if (/-mini-\d+$/.test(element.id)) {
        const index = Number(element.id.match(/-mini-(\d+)$/)?.[1] || 0);
        return { ...element, x: 306 + index * 222, y: 519, w: 184 };
      }
      return element;
    });
    const legacySlide = {
      ...parsed.slides[0],
      canvas: { ...current, elements: legacyElements },
    };

    const upgraded = ensureEditableCanvas({ ...parsed, slides: [legacySlide] }).slides[0].canvas!;
    expect(upgraded.elements.find((element) => element.id === "slide-title-title")).toMatchObject({ y: 118 });
    expect(upgraded.elements.find((element) => element.id === "slide-title-mini-2-shape")).toMatchObject({ x: 351, w: 578 });

    const marked = ensureEditableCanvas({
      ...parsed,
      slides: [{
        ...legacySlide,
        canvas: {
          ...legacySlide.canvas,
          elements: [
            ...legacySlide.canvas.elements,
            {
              id: "slide-title-custom-canvas-marker",
              type: "shape",
              shape: "rect",
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              rotation: 0,
              zIndex: 0,
              opacity: 0,
              locked: true,
              fill: "#FFFFFF",
              stroke: "#FFFFFF",
              strokeWidth: 0,
            },
          ],
        },
      }],
    }).slides[0].canvas!;
    expect(marked.elements.find((element) => element.id === "slide-title-title")).toMatchObject({ y: 188 });
  });

  it("upgrades legacy generated summary cards while preserving explicitly edited summary canvases", () => {
    const theme = resolvePresentationTheme({ title: "Legacy summary" });
    const parsed = presentationSchema.parse({
      id: "presentation-legacy-summary",
      title: "Legacy summary",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["What matters"],
      speechScript: [{ slideOrder: 1, slideTitle: "What matters", text: "Narration." }],
      slides: [
        {
          id: "slide-summary",
          order: 1,
          title: "What matters",
          slideKind: "summary",
          layout: "summary",
          thesis: "One conclusion.",
          bullets: ["First support."],
          blocks: [],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
          canvas: {
            version: 2,
            width: 1280,
            height: 720,
            background: "#FFFFFF",
            elements: [
              {
                id: "slide-summary-title",
                type: "text",
                x: 69,
                y: 56,
                w: 1142,
                h: 104,
                zIndex: 4,
                opacity: 1,
                text: "What matters",
                fontSize: 40,
                color: "#111111",
              },
              {
                id: "slide-summary-summary-0-card",
                type: "shape",
                x: 470,
                y: 176,
                w: 340,
                h: 118,
                zIndex: 2,
                opacity: 1,
                shape: "roundRect",
                fill: "#FFFFFF",
              },
              {
                id: "slide-summary-summary-0-num",
                type: "text",
                x: 486,
                y: 201,
                w: 38,
                h: 22,
                zIndex: 4,
                opacity: 1,
                text: "1",
                fontSize: 14,
                color: "#FFFFFF",
              },
              {
                id: "slide-summary-summary-0",
                type: "text",
                x: 536,
                y: 194,
                w: 254,
                h: 78,
                zIndex: 4,
                opacity: 1,
                text: "First support.",
                fontSize: 18,
                color: "#444444",
              },
            ],
          },
        },
      ],
      presentationTheme: theme,
    });

    const upgraded = ensureEditableCanvas(parsed).slides[0].canvas!;
    expect(upgraded.elements.some((element) => element.id === "slide-summary-summary-conclusion")).toBe(true);
    expect(upgraded.elements.some((element) => element.id === "slide-summary-summary-0-card")).toBe(false);

    const custom = ensureEditableCanvas({
      ...parsed,
      slides: [
        {
          ...parsed.slides[0],
          canvas: {
            ...parsed.slides[0].canvas!,
            elements: [
              ...parsed.slides[0].canvas!.elements.map((element) =>
                element.id === "slide-summary-summary-0-card" ? { ...element, x: element.x + 1 } : element,
              ),
              {
                id: "slide-summary-custom-canvas-marker",
                type: "shape",
                x: 0,
                y: 0,
                w: 1,
                h: 1,
                zIndex: 0,
                opacity: 0,
                shape: "rect",
                fill: "#FFFFFF",
              },
            ],
          },
        },
      ],
    }).slides[0].canvas!;
    expect(custom.elements.some((element) => element.id === "slide-summary-summary-0-card")).toBe(true);
  });

  it("upgrades the previous generated summary-story geometry", () => {
    const theme = resolvePresentationTheme({ title: "Previous summary story" });
    const parsed = presentationSchema.parse({
      id: "presentation-previous-summary-story",
      title: "Previous summary story",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Summary"],
      speechScript: [{ slideOrder: 1, slideTitle: "Summary", text: "Narration." }],
      slides: [{
        id: "slide-summary",
        order: 1,
        title: "Summary",
        slideKind: "summary",
        layout: "summary",
        thesis: "Main conclusion.",
        bullets: ["Support one.", "Support two.", "Support three.", "Final thought."],
        visual: { type: "none" },
        blocks: [],
        speakerNotes: "Notes.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
      presentationTheme: theme,
    });
    const current = buildSlideCanvas(parsed.slides[0], theme);
    const previous = {
      ...current,
      elements: [
        ...current.elements.map((element) => {
          if (element.id === "slide-summary-summary-support-label" && element.type === "text") return { ...element, fontSize: 17 };
          if (/slide-summary-summary-support-\d+$/.test(element.id) && element.type === "text") return { ...element, fontSize: 15, h: 62 };
          if (element.id === "slide-summary-summary-final-label" && element.type === "text") return { ...element, x: 94, y: 576, w: 222, h: 28, fontSize: 15 };
          if (element.id === "slide-summary-summary-final" && element.type === "text") return { ...element, x: 332, y: 568, w: 848, h: 48, fontSize: 14 };
          if (element.id === "slide-summary-summary-final-bg" && element.type === "shape") return { ...element, y: 550, h: 92 };
          return element;
        }),
        {
          id: "slide-summary-custom-canvas-marker",
          type: "shape" as const,
          shape: "rect" as const,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          rotation: 0,
          zIndex: 0,
          opacity: 0,
          locked: true,
          fill: "#FFFFFF",
          stroke: "#FFFFFF",
          strokeWidth: 0,
        },
      ],
    };

    const upgraded = ensureEditableCanvas({
      ...parsed,
      slides: [{ ...parsed.slides[0], canvas: previous }],
    }).slides[0].canvas!;

    expect(upgraded.elements.find((element) => element.id === "slide-summary-summary-support-0")).toMatchObject({ fontSize: 24, h: 72 });
    expect(upgraded.elements.find((element) => element.id === "slide-summary-summary-final-label")).toMatchObject({ x: 94, y: 558, w: 270, h: 68, fontSize: 24 });
    expect(upgraded.elements.find((element) => element.id === "slide-summary-summary-final-bg")).toMatchObject({ y: 536, h: 112 });

    const currentMarked = ensureEditableCanvas({
      ...parsed,
      slides: [{
        ...parsed.slides[0],
        canvas: {
          ...current,
          elements: [...current.elements, previous.elements[previous.elements.length - 1]],
        },
      }],
    }).slides[0].canvas!;
    expect(currentMarked.elements.some((element) => element.id === "slide-summary-custom-canvas-marker")).toBe(true);
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
    expect(ensureEditableCanvas({ ...parsed, slides: [legacySlide] }).slides[0].canvas?.backgroundStyle?.type).toBe("gradient");
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

    expect(editable.slides[0].canvas?.elements.find((element) => element.id === "slide-1-image-bg")).toMatchObject({ type: "image", fit: "cover" });
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
