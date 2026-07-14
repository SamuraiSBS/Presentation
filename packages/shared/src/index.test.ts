import { describe, expect, it } from "vitest";
import {
  auditSlideCanvas,
  buildSlideCanvas,
  createFolderInputSchema,
  createProjectInvitationInputSchema,
  createProjectInputSchema,
  dashboardSummarySchema,
  duplicateProjectInputSchema,
  deckStorySchema,
  designBriefSchema,
  diagramGraphSpecSchema,
  diagramSpecSchema,
  ensureEditableCanvas,
  generatePresentationInputSchema,
  generationBriefSchema,
  generationPipelineArtifactsSchema,
  generationJobKindSchema,
  generationProgressStageSchema,
  hasCustomSlideCanvas,
  mermaidDiagramSpecSchema,
  planLimits,
  PREMIUM_PRESENTATION_THEMES,
  PREMIUM_PRESENTATION_THEME_IDS,
  presentationSchema,
  presentationThemeSchema,
  projectListQuerySchema,
  projectSummarySchema,
  projectStatusSchema,
  qualityCritiqueSchema,
  qualityDimensionScoreSchema,
  researchBriefSchema,
  resolvePremiumPresentationTheme,
  resolvePresentationTheme,
  resolveThemeFromDesignBrief,
  slideCanvasSchema,
  slideBlueprintSchema,
  slideLayoutSchema,
  slideLayoutOptions,
  slideTextPlanSchema,
  updateFolderInputSchema,
  visualStrategySchema,
  updateNarrationInputSchema,
  updateProjectMetadataInputSchema,
  updateProjectMemberInputSchema,
  updateSlideInputSchema,
  usageSummarySchema,
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

  it("exposes the personal-account free plan limits", () => {
    expect(planLimits.free.monthlyPresentations).toBe(10);
    expect(planLimits.free.exports).toEqual(["pdf", "pptx"]);
    expect(planLimits.free.maxSlides).toBe(10);
  });

  it("accepts both school and university audiences while keeping the university default", () => {
    expect(generationBriefSchema.parse({}).audience).toBe("university_student");
    expect(generationBriefSchema.parse({ audience: "school_student" }).audience).toBe("school_student");
  });

  it("validates personal-account mutation contracts", () => {
    expect(createFolderInputSchema.parse({ name: "  Учёба  " })).toEqual({
      name: "Учёба",
      color: "orange",
    });
    expect(() => createFolderInputSchema.parse({ name: " ".repeat(3) })).toThrow();
    expect(() => createFolderInputSchema.parse({ name: "x".repeat(81) })).toThrow();
    expect(updateFolderInputSchema.parse({ color: "purple", sortOrder: 2 })).toEqual({
      color: "purple",
      sortOrder: 2,
    });
    expect(() => updateFolderInputSchema.parse({})).toThrow();
    expect(updateProjectMetadataInputSchema.parse({ folderId: null })).toEqual({ folderId: null });
    expect(duplicateProjectInputSchema.parse({})).toEqual({});
    expect(createProjectInvitationInputSchema.parse({ role: "viewer" })).toEqual({ role: "viewer" });
    expect(updateProjectMemberInputSchema.parse({ role: "editor" })).toEqual({ role: "editor" });
  });

  it("coerces project list query values and applies safe defaults", () => {
    expect(projectListQuerySchema.parse({ limit: "12", search: "  физика  " })).toEqual({
      scope: "all",
      search: "физика",
      sort: "updated_desc",
      limit: 12,
    });
    expect(() => projectListQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("requires an optimistic revision for slide updates", () => {
    expect(updateSlideInputSchema.parse({ expectedRevision: 3, title: "Новый заголовок" })).toEqual({
      expectedRevision: 3,
      title: "Новый заголовок",
    });
    expect(() => updateSlideInputSchema.parse({ title: "Без ревизии" })).toThrow();
  });

  it("validates compact project, usage and dashboard summaries", () => {
    const project = projectSummarySchema.parse({
      id: "project-1",
      title: "Физика",
      status: "ready",
      slideCount: 8,
      updatedAt: new Date("2026-07-11T10:00:00.000Z"),
      createdAt: "2026-07-10T10:00:00.000Z",
      error: null,
      accessRole: "owner",
      owner: { id: "user-1", name: "Иван", image: null },
      folder: { id: "folder-1", name: "Учёба", color: "orange" },
      hasPresentation: true,
      latestExport: { id: "export-1", type: "pptx", status: "ready" },
      memberCount: 1,
    });
    const usage = usageSummarySchema.parse({
      planCode: "free",
      period: "2026-07",
      limit: 10,
      used: 2,
      remaining: 8,
      resetsAt: "2026-07-31T21:00:00.000Z",
      exhausted: false,
    });

    expect(project.updatedAt).toBe("2026-07-11T10:00:00.000Z");
    expect(() => dashboardSummarySchema.parse({
      user: { id: "user-1", name: "Иван", image: null, telegramUsername: "ivan", planCode: "free" },
      usage,
      stats: {
        presentationsCreated: 2,
        slidesCreated: 16,
        readyPresentations: 1,
        savedHoursMin: 1.5,
        savedHoursMax: 2,
      },
      recentProjects: [project],
      activeProjects: [],
      attentionProjects: [],
      sharedProjects: [],
    })).not.toThrow();
  });

  it("accepts safe Mermaid diagram specs and rejects unsafe markup", () => {
    const parsed = mermaidDiagramSpecSchema.parse({
      kind: "flowchart",
      title: "Процесс",
      source: "flowchart LR\n    A[Тема] --> B[Вывод]",
      fallback: "Тема ведет к выводу.",
      safety: "safe",
    });

    expect(parsed.kind).toBe("flowchart");
    expect(() =>
      mermaidDiagramSpecSchema.parse({
        kind: "flowchart",
        source: "flowchart LR\n    A[<script>alert(1)</script>] --> B[OK]",
        fallback: "Unsafe",
      }),
    ).toThrow();
  });

  it("keeps the legacy two-column layout readable but hides it from new selections", () => {
    expect(slideLayoutOptions("content").map((layout) => layout.id)).not.toContain("two-column");
  });

  it("hides removed layouts from new selections while keeping legacy schema support", () => {
    const layouts = slideLayoutOptions("content").map((layout) => layout.id);
    expect(layouts).not.toContain("bullets");
    expect(layouts).not.toContain("definition");
    expect(layouts).not.toContain("case-study");
    expect(layouts).not.toContain("evidence");
    expect(layouts).not.toContain("explain-example");
    expect(layouts).not.toContain("comparison");
    expect(layouts).not.toContain("myth-fact");
    expect(layouts).not.toContain("problem-solution");
    expect(layouts).not.toContain("question-answer");
    expect(() => slideLayoutSchema.parse("bullets")).not.toThrow();
    expect(() => slideLayoutSchema.parse("definition")).not.toThrow();
    expect(() => slideLayoutSchema.parse("case-study")).not.toThrow();
    expect(() => slideLayoutSchema.parse("comparison")).not.toThrow();
    expect(() => slideLayoutSchema.parse("question-answer")).not.toThrow();
  });

  it("accepts two-step generation statuses and job kinds", () => {
    expect(projectStatusSchema.parse("script_queued")).toBe("script_queued");
    expect(projectStatusSchema.parse("script_generating")).toBe("script_generating");
    expect(projectStatusSchema.parse("script_ready")).toBe("script_ready");
    expect(generationJobKindSchema.parse("narration")).toBe("narration");
    expect(generationJobKindSchema.parse("presentation")).toBe("presentation");
    expect(generationProgressStageSchema.parse("researching")).toBe("researching");
    expect(generationProgressStageSchema.parse("selecting_visuals")).toBe("selecting_visuals");
  });

  it("validates editable speech drafts for final generation", () => {
    const speechDraft = "Слайд 1: Введение\nЭто достаточно длинный текст выступления для проверки сохранения.";
    expect(updateNarrationInputSchema.parse({ speechDraft }).speechDraft).toBe(speechDraft);
    expect(updateNarrationInputSchema.parse({ speechDraft }).accept).toBe(false);
    expect(updateNarrationInputSchema.parse({ speechDraft, accept: true }).accept).toBe(true);
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
    const deckStory = deckStorySchema.parse({
      mainIdea: "AI can make report preparation clearer.",
      audienceQuestion: "How does AI help students prepare reports?",
      tone: "school_report",
      chapters: [{ title: "AI helps prepare reports", purpose: "Open the topic.", slideOrders: [1] }],
      conclusion: "Students should use AI as support, not as a replacement for thinking.",
    });
    const slideTextPlan = slideTextPlanSchema.parse({
      slideOrder: 1,
      slideQuestion: "How does AI help students prepare reports?",
      coreClaim: "AI can make preparation clearer when students control the final argument.",
      listenerTakeaway: "AI is useful when it helps structure real understanding.",
      title: "AI helps prepare reports",
      thesis: "AI can make preparation clearer.",
      bullets: ["Summaries need checking", "The student keeps the argument"],
      speakerNotes: "AI can make report preparation clearer. It helps collect material into a first structure. The student still needs to check sources. The strongest work comes from editing and explaining the result. This makes AI a support tool, not a replacement.",
    });
    const qualityCritique = qualityCritiqueSchema.parse({ passed: true });

    expect(researchBrief.warnings).toEqual([]);
    expect(slideBlueprint.textDensity).toBe("medium");
    expect(deckStory.chapters[0].slideOrders).toEqual([1]);
    expect(slideTextPlan.evidenceOrExample).toBe("");
    expect(qualityCritique.issues).toEqual([]);
    expect(qualityCritique.dimensions).toBeUndefined();
    expect(qualityDimensionScoreSchema.parse({ score: 87 }).reason).toBe("");
    expect(qualityCritiqueSchema.parse({
      dimensions: Object.fromEntries([
        "speechNaturalness", "universityTone", "slideBrevity", "visualRhythm", "sourceGrounding", "exportReadiness",
      ].map((name) => [name, { score: 90, reason: `${name} is strong.` }])),
    }).dimensions?.exportReadiness.score).toBe(90);
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
        deckStory,
        designBrief: {
          themePreset: "minimal",
          mood: "neutral",
          visualDirection: "Clean study deck.",
        },
        slideBlueprints: [slideBlueprint],
        slideTextPlans: [slideTextPlan],
        qualityCritique,
      }),
    ).not.toThrow();
  });

  it("accepts the university student creation brief while keeping old inputs readable", () => {
    const parsed = createProjectInputSchema.parse({
      title: "AI in higher education",
      prompt: "Create a concise university presentation about artificial intelligence in higher education.",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 10,
      generationBrief: {
        audience: "university_student",
        speechStyle: "easy_professional",
        slideDensity: "brief_slides_full_speech",
        visualStrategy: "images_and_diagrams",
        exportTarget: "web_and_pptx_pdf",
      },
    });

    expect(parsed.scenario).toBe("university_report");
    expect(parsed.level).toBe("university_student");
    expect(parsed.generationBrief).toEqual(generationBriefSchema.parse({}));
    expect(createProjectInputSchema.parse({
      title: "Legacy input",
      prompt: "Create a regular legacy presentation request with enough detail.",
      scenario: "school_report",
      level: "8-11 класс",
      mode: "with_sources",
      slideCount: 8,
    }).generationBrief).toBeUndefined();
  });

  it("rejects incomplete generation pipeline artifacts", () => {
    expect(() => researchBriefSchema.parse({ topic: "Only topic" })).toThrow();
    expect(() => slideBlueprintSchema.parse({ slideOrder: 1, title: "Missing fields" })).toThrow();
  });

  it("rejects unsafe generated slide text and export canvas geometry", () => {
    expect(() =>
      presentationSchema.parse({
        id: "presentation-unsafe",
        title: "Unsafe deck",
        scenario: "lesson",
        level: "beginner",
        slideCount: 1,
        generationMode: "demo",
        generatedText: "Draft",
        sources: [],
        outline: ["Unsafe"],
        speechScript: [{ slideOrder: 1, slideTitle: "Unsafe", text: "This is a complete spoken note for the slide." }],
        slides: [
          {
            id: "slide-1",
            order: 1,
            title: "This slide helps explain the topic",
            layout: "statement",
            blocks: [{ type: "callout", content: "This slide helps explain the topic" }],
            speakerNotes: "",
            timingSeconds: 45,
            sourceRefs: [],
            canvas: {
              width: 1280,
              height: 720,
              elements: [{ id: "shape-1", type: "shape", x: 2000, y: 100, w: 100, h: 100 }],
            },
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      presentationSchema.parse({
        id: "presentation-generic-filler",
        title: "Generic filler deck",
        scenario: "lesson",
        level: "beginner",
        slideCount: 1,
        generationMode: "demo",
        generatedText: "Draft",
        sources: [],
        outline: ["Unsafe"],
        speechScript: [{ slideOrder: 1, slideTitle: "Unsafe", text: "This is a complete spoken note for the slide." }],
        slides: [
          {
            id: "slide-1",
            order: 1,
            title: "\u0413\u043b\u0430\u0432\u043d\u044b\u0435 \u0444\u0430\u043a\u0442\u043e\u0440\u044b \u0437\u0430\u0434\u0430\u044e\u0442 \u043b\u043e\u0433\u0438\u043a\u0443 \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u044f.",
            layout: "statement",
            blocks: [{ type: "callout", content: "Concrete detail stays on the slide." }],
            speakerNotes: "This is a complete spoken note for the slide.",
            timingSeconds: 45,
            sourceRefs: [],
          },
        ],
      }),
    ).toThrow(/generic educational filler/);
  });

  it("parses visual strategy and diagram artifacts with defaults", () => {
    expect(visualStrategySchema.parse({ slideOrder: 1 }).visualType).toBe("none");
    expect(diagramSpecSchema.parse({ slideOrder: 1, nodes: ["Cause", "Effect"] }).kind).toBe("none");
    expect(
      generationPipelineArtifactsSchema.parse({
        researchBrief: {
          topic: "AI in education",
          angle: "How students can use AI responsibly.",
        },
        narrativePlan: [
          {
            slideOrder: 1,
            slideTitle: "Responsible AI",
            slidePurpose: "Open the topic.",
            keyMessage: "AI is useful when students keep control of the argument.",
            audienceQuestion: "How should students use AI?",
          },
        ],
        designBrief: {
          themePreset: "minimal",
          mood: "neutral",
          visualDirection: "Clean study deck.",
        },
      }).diagramSpecs,
    ).toEqual([]);
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
              width: 1280,
              height: 720,
              byteSize: 420000,
              warnings: ["resized from 2400x1350"],
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
    expect(parsed.slides[0].visual.image?.width).toBe(1280);
    expect(parsed.slides[0].visual.image?.byteSize).toBe(420000);
  });

  it("accepts graph diagram specs and renders a static canvas fallback", () => {
    const graph = diagramGraphSpecSchema.parse({
      layoutDirection: "LR",
      nodes: [
        { id: "research", label: "Research", detail: "Collect evidence" },
        { id: "draft", label: "Draft", detail: "Shape the argument" },
        { id: "present", label: "Present", detail: "Explain out loud" },
      ],
      edges: [
        { source: "research", target: "draft", label: "feeds" },
        { source: "draft", target: "present", label: "becomes" },
      ],
      fallback: "Research feeds drafting, then the student presents the argument.",
    });
    const presentation = presentationSchema.parse({
      id: "presentation-graph",
      title: "Graph deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Workflow"],
      speechScript: [{ slideOrder: 1, slideTitle: "Workflow", text: "Narration." }],
      slides: [
        {
          id: "slide-graph",
          order: 1,
          title: "Workflow",
          slideKind: "content",
          layout: "process",
          thesis: "A clear graph keeps the study workflow readable.",
          bullets: ["Research", "Draft", "Present"],
          visual: { type: "mind_map", graph },
          blocks: [{ type: "callout", content: "Workflow." }],
          speakerNotes: "Notes.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    const canvas = buildSlideCanvas(presentation.slides[0], resolvePresentationTheme(presentation), {
      designDirection: {
        slideOrder: 1,
        visualRole: "sequence",
        layoutIntent: "diagram",
        imageStrategy: "diagram",
        visualPrompt: "Workflow graph",
      },
    });

    expect(canvas.elements.some((element) => element.id === "slide-graph-graph-node-0")).toBe(true);
    expect(canvas.elements.some((element) => element.id === "slide-graph-graph-edge-0")).toBe(true);
    expect(canvas.elements.some((element) => element.type === "image")).toBe(false);
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
            type: "image",
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

  it("keeps title and image-focus body text at 30px without colliding with lower plaques", () => {
    const theme = resolvePresentationTheme({ title: "Safe fixed body text" });
    const longThesis = "A detailed supporting explanation stays readable at the requested size while the layout measures every wrapped line and moves optional supporting plaques below the complete paragraph without allowing either region to cover the other.";
    const base = {
      scenario: "lesson",
      level: "beginner",
      generationMode: "demo",
      sources: [],
      outline: ["Safe layout"],
      speechScript: [{ slideOrder: 1, slideTitle: "Safe layout", text: "Narration." }],
      presentationTheme: theme,
    } as const;
    const titleSlide = presentationSchema.parse({
      ...base,
      id: "presentation-safe-title",
      title: "Safe title",
      slideCount: 1,
      slides: [{
        id: "slide-safe-title",
        order: 1,
        title: "Safe title",
        slideKind: "title",
        layout: "hero",
        thesis: longThesis,
        bullets: ["First supporting point stays complete.", "Second supporting point stays complete.", "Third supporting point stays complete."],
        visual: { type: "none" },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
    }).slides[0];
    const imageSlide = presentationSchema.parse({
      ...base,
      id: "presentation-safe-image",
      title: "Safe image",
      slideCount: 1,
      slides: [{
        id: "slide-safe-image",
        order: 1,
        title: "Safe image",
        slideKind: "content",
        layout: "image-focus",
        thesis: longThesis,
        bullets: ["First image point.", "Second image point.", "Third image point."],
        visual: { type: "image", image: { url: "https://cdn.example.com/image.jpg", alt: "Example" } },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
    }).slides[0];

    for (const slide of [titleSlide, imageSlide]) {
      const canvas = buildSlideCanvas(slide, theme);
      const body = canvas.elements.find((element) => element.id === `${slide.id}-body`);
      const bodyBackplate = canvas.elements.find((element) => element.id === `${slide.id}-body-backplate`);
      const plaques = canvas.elements.filter((element) => element.type === "shape" && /-mini-\d+-shape$/.test(element.id));
      expect(body).toMatchObject({ type: "text", fontSize: 30, autoFit: false });
      expect(plaques).toHaveLength(3);
      expect(bodyBackplate?.y).toBeGreaterThanOrEqual(0);
      expect((bodyBackplate?.y || 0) + (bodyBackplate?.h || 0)).toBeLessThanOrEqual(Math.min(...plaques.map((plaque) => plaque.y)));
      expect(canvas.elements.every((element) => element.x >= 0 && element.y >= 0 && element.x + element.w <= 1280 && element.y + element.h <= 720)).toBe(true);
    }
  });

  it("drops optional title plaques instead of clipping them below the slide", () => {
    const theme = resolvePresentationTheme({ title: "Safe title plaques" });
    const slide = presentationSchema.parse({
      id: "presentation-safe-title-plaques",
      title: "Safe title plaques",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Safe title plaques"],
      speechScript: [{ slideOrder: 1, slideTitle: "Safe title plaques", text: "Narration." }],
      presentationTheme: theme,
      slides: [{
        id: "slide-safe-title-plaques",
        order: 1,
        title: "Введение в Карибский кризис",
        slideKind: "title",
        layout: "hero",
        thesis: "Карибский кризис — это напряжённое противостояние между СССР и США в 1962 году.",
        bullets: [
          "Противостояние между двумя сверхдержавами могло привести к катастрофическим последствиям.",
          "Что такое Карибский кризис и почему он важен для понимания международной политики.",
        ],
        visual: { type: "none" },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
    }).slides[0];

    const canvas = buildSlideCanvas(slide, theme);

    expect(canvas.elements.some((element) => /-mini-\d+(?:-shape)?$/.test(element.id))).toBe(false);
    expect(canvas.elements.every((element) => element.x >= 0 && element.y >= 0 && element.x + element.w <= 1280 && element.y + element.h <= 720)).toBe(true);
    expect(auditSlideCanvas(canvas)).toEqual([]);
  });

  it("flags canvas collisions and unreadably small generated body text", () => {
    const issues = auditSlideCanvas({
      version: 2,
      width: 1280,
      height: 720,
      background: "#101820",
      elements: [
        {
          id: "image",
          type: "image",
          x: 100,
          y: 100,
          w: 500,
          h: 320,
          rotation: 0,
          zIndex: 5,
          opacity: 1,
          locked: false,
          url: "https://example.com/image.jpg",
          objectKey: "image.jpg",
          alt: "Example",
          contentType: "image/jpeg",
          fit: "cover",
        },
        {
          id: "body",
          type: "text",
          role: "body",
          x: 180,
          y: 160,
          w: 360,
          h: 80,
          rotation: 0,
          zIndex: 4,
          opacity: 1,
          locked: false,
          text: "This generated paragraph is long enough that sixteen pixel body text should be rejected as unreadable in the editor preview.",
          runs: [{ text: "This generated paragraph is long enough that sixteen pixel body text should be rejected as unreadable in the editor preview." }],
          fontSize: 16,
          autoFit: false,
          fontFamily: "Arial",
          color: "#ffffff",
          bold: false,
          italic: false,
          underline: false,
          align: "left",
          valign: "top",
        },
      ],
    });

    expect(issues.some((issue) => issue.includes("body uses 16px"))).toBe(true);
    expect(issues.some((issue) => issue.includes("overlaps"))).toBe(true);
  });

  it("uses the fixed 30px body in premium image layouts and upgrades only unmarked generated canvases", () => {
    const theme = resolvePresentationTheme({ title: "Premium image layout" });
    const parsed = presentationSchema.parse({
      id: "presentation-premium-image",
      title: "Premium image layout",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Premium image"],
      speechScript: [{ slideOrder: 1, slideTitle: "Premium image", text: "Narration." }],
      slides: [{
        id: "slide-premium-image",
        order: 1,
        title: "Premium image",
        slideKind: "content",
        layout: "image-focus",
        thesis: "A premium split-image explanation remains readable at one stable body size across previews and exports.",
        bullets: ["First image point.", "Second image point.", "Third image point."],
        visual: { type: "image", image: { url: "https://cdn.example.com/premium.jpg", alt: "Premium example" } },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
      presentationTheme: theme,
    });
    const direction = {
      slideOrder: 1,
      visualRole: "explain",
      layoutIntent: "split_image_text",
      imageStrategy: "real_photo",
      visualPrompt: "Premium example",
    } as const;
    const current = buildSlideCanvas(parsed.slides[0], theme, { designDirection: direction });
    const currentBody = current.elements.find((element) => element.id === "slide-premium-image-body");
    expect(currentBody).toMatchObject({ type: "text", fontSize: 30, autoFit: false, x: 84, y: 310, w: 548 });

    const previous = {
      ...parsed.slides[0],
      canvas: {
        ...current,
        elements: current.elements.map((element) => element.id === "slide-premium-image-body"
          ? { ...element, fontSize: 18, autoFit: undefined, h: 148 }
          : element),
      },
    };
    const document = presentationSchema.parse({ ...parsed, designBrief: { themePreset: "tech", mood: "neutral", visualDirection: "Premium", slideDirections: [direction] }, slides: [previous] });
    const upgraded = ensureEditableCanvas(document).slides[0].canvas!;
    expect(upgraded.elements.find((element) => element.id === "slide-premium-image-body")).toMatchObject({ fontSize: 30, autoFit: false });

    const marked = ensureEditableCanvas({
      ...document,
      slides: [{
        ...previous,
        canvas: {
          ...previous.canvas,
          elements: [...previous.canvas.elements, {
            id: "slide-premium-image-custom-canvas-marker",
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
          }],
        },
      }],
    }).slides[0].canvas!;
    expect(marked.elements.find((element) => element.id === "slide-premium-image-body")).toMatchObject({ fontSize: 18 });
    expect(marked.elements.find((element) => element.id === "slide-premium-image-body" && element.type === "text")?.autoFit).toBeUndefined();
  });

  it("rebuilds an unmarked generated canvas when image enrichment changes the layout", () => {
    const theme = resolvePresentationTheme({ title: "Late image enrichment" });
    const direction = {
      slideOrder: 1,
      visualRole: "visual_statement",
      layoutIntent: "split_image_text",
      imageStrategy: "real_photo",
      visualPrompt: "Students in a public discussion",
    } as const;
    const document = presentationSchema.parse({
      id: "presentation-late-image",
      title: "Late image enrichment",
      scenario: "lesson",
      level: "university",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Public participation"],
      speechScript: [{ slideOrder: 1, slideTitle: "Public participation", text: "Narration." }],
      designBrief: {
        themePreset: "editorial",
        mood: "neutral",
        visualDirection: "Editorial split image",
        slideDirections: [direction],
      },
      presentationTheme: theme,
      slides: [{
        id: "slide-late-image",
        order: 1,
        title: "Public participation",
        slideKind: "content",
        layout: "image-focus",
        thesis: "Participation gives citizens a practical role in public decision making.",
        bullets: ["Public hearings", "Independent associations"],
        visual: { type: "image", description: "Students in a public discussion" },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
    });
    const beforeEnrichment = ensureEditableCanvas(document);
    const enriched = presentationSchema.parse({
      ...beforeEnrichment,
      slides: [{
        ...beforeEnrichment.slides[0],
        visual: {
          ...beforeEnrichment.slides[0].visual,
          image: {
            url: "https://cdn.example.com/discussion.jpg",
            objectKey: "projects/project-1/images/discussion.jpg",
            alt: "Students in a discussion",
          },
        },
      }],
    });

    const rebuilt = ensureEditableCanvas(enriched).slides[0].canvas!;

    expect(rebuilt.elements.some((element) => element.type === "image")).toBe(true);
    expect(rebuilt.elements.find((element) => element.id === "slide-late-image-body")).toMatchObject({ x: 84, w: 548, fontSize: 30 });
    expect(auditSlideCanvas(rebuilt)).toEqual([]);
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

  it("compacts long summary support text and keeps every summary region separate", () => {
    const theme = resolvePresentationTheme({ title: "Safe summary" });
    const slide = presentationSchema.parse({
      id: "presentation-safe-summary",
      title: "Safe summary",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["What matters"],
      speechScript: [{ slideOrder: 1, slideTitle: "What matters", text: "Narration." }],
      slides: [{
        id: "slide-safe-summary",
        order: 1,
        title: "What matters",
        slideKind: "summary",
        layout: "summary",
        thesis: "The central conclusion remains complete and readable even when it needs several wrapped lines to explain the final meaning of the presentation.",
        bullets: [
          "The first supporting thought explains the most important cause in enough detail to overflow a fixed short row.",
          "The second supporting thought describes the practical change that follows from the material and its evidence.",
          "The third supporting thought names the consequence that the audience should connect with the central conclusion.",
          "The final thought gives the audience one memorable idea that remains useful after the presentation ends.",
        ],
        visual: { type: "none" },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
      presentationTheme: theme,
    }).slides[0];

    const canvas = buildSlideCanvas(slide, theme);
    const conclusionBackplate = canvas.elements.find((element) => element.id === "slide-safe-summary-summary-conclusion-backplate");
    const accent = canvas.elements.find((element) => element.id === "slide-safe-summary-summary-accent");
    const supportText = canvas.elements.filter((element) => element.type === "text" && /^slide-safe-summary-summary-support-\d+$/.test(element.id));
    const supportBackplates = canvas.elements
      .filter((element) => element.type === "shape" && /^slide-safe-summary-summary-support-\d+-backplate$/.test(element.id))
      .sort((left, right) => left.y - right.y);
    const finalBackground = canvas.elements.find((element) => element.id === "slide-safe-summary-summary-final-bg");

    expect(supportText).toHaveLength(3);
    expect(supportText.every((element) => !element.text.includes("...") && element.text.split(/\s+/).length <= 7)).toBe(true);
    expect((conclusionBackplate?.y || 0) + (conclusionBackplate?.h || 0)).toBeLessThanOrEqual(accent?.y || 0);
    supportBackplates.slice(1).forEach((backplate, index) => {
      expect(supportBackplates[index].y + supportBackplates[index].h).toBeLessThanOrEqual(backplate.y);
    });
    expect(supportBackplates.at(-1)!.y + supportBackplates.at(-1)!.h).toBeLessThanOrEqual(finalBackground?.y || 0);
    expect(canvas.elements.every((element) => element.x >= 0 && element.y >= 0 && element.x + element.w <= 1280 && element.y + element.h <= 720)).toBe(true);
    expect(auditSlideCanvas(canvas).filter((issue) => issue.includes("outside") || issue.includes("overlaps"))).toEqual([]);
  });

  it("grows summary cards for long Russian words without clipping or overlap", () => {
    const theme = resolvePresentationTheme({ title: "Гражданское общество" });
    const thesis = "Гражданское общество и правовое государство являются взаимозависимыми и взаимодополняющими элементами демократического общества.";
    const slide = presentationSchema.parse({
      id: "presentation-russian-summary",
      title: "Гражданское общество",
      scenario: "lesson",
      level: "university",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Заключение"],
      speechScript: [{ slideOrder: 1, slideTitle: "Заключение", text: "Narration." }],
      slides: [{
        id: "slide-russian-summary",
        order: 1,
        title: "Заключение",
        slideKind: "summary",
        layout: "summary",
        thesis,
        bullets: [
          "Взаимозависимость гражданского общества и правового государства.",
          thesis,
          "Развитие гражданского общества способствует укреплению правового государства.",
          "Развитие механизмов контроля и защита прав.",
        ],
        visual: { type: "none" },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
      presentationTheme: theme,
    }).slides[0];

    const canvas = buildSlideCanvas(slide, theme);
    const supportText = canvas.elements
      .filter((element) => element.type === "text" && /^slide-russian-summary-summary-support-\d+$/.test(element.id))
      .sort((left, right) => left.y - right.y);
    const supportBackplates = canvas.elements
      .filter((element) => element.type === "shape" && /^slide-russian-summary-summary-support-\d+-backplate$/.test(element.id))
      .sort((left, right) => left.y - right.y);

    expect(supportText).toHaveLength(3);
    expect(supportText[1]).toMatchObject({ fontSize: 24 });
    expect(supportText[1].h).toBeLessThanOrEqual(110);
    supportBackplates.slice(1).forEach((backplate, index) => {
      expect(supportBackplates[index].y + supportBackplates[index].h).toBeLessThanOrEqual(backplate.y);
    });
    expect(auditSlideCanvas(canvas)).toEqual([]);
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
    expect(body).toMatchObject({ type: "text", align: "center", valign: "middle", y: 306, fontSize: 30, autoFit: false });
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
    const customMarker = {
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
    };
    const previous = {
      ...current,
      elements: current.elements.map((element) => {
          if (element.id === "slide-summary-summary-support-label" && element.type === "text") return { ...element, fontSize: 17 };
          if (/slide-summary-summary-support-\d+$/.test(element.id) && element.type === "text") return { ...element, fontSize: 15, h: 62 };
          if (element.id === "slide-summary-summary-final-label" && element.type === "text") return { ...element, x: 94, y: 576, w: 222, h: 28, fontSize: 15 };
          if (element.id === "slide-summary-summary-final" && element.type === "text") return { ...element, x: 332, y: 568, w: 848, h: 48, fontSize: 14 };
          if (element.id === "slide-summary-summary-final-bg" && element.type === "shape") return { ...element, y: 550, h: 92 };
          return element;
        }),
    };

    const upgraded = ensureEditableCanvas({
      ...parsed,
      slides: [{ ...parsed.slides[0], canvas: previous }],
    }).slides[0].canvas!;

    expect(upgraded.elements.find((element) => element.id === "slide-summary-summary-support-0")).toMatchObject({ fontSize: 24, h: 55 });
    const finalLabel = upgraded.elements.find((element) => element.id === "slide-summary-summary-final-label");
    expect(finalLabel).toMatchObject({ x: 94, w: 270, h: 68, fontSize: 24 });
    expect(finalLabel?.y).toBeGreaterThanOrEqual(558);
    expect((finalLabel?.y || 0) + (finalLabel?.h || 0)).toBeLessThanOrEqual(696);
    const finalBackground = upgraded.elements.find((element) => element.id === "slide-summary-summary-final-bg");
    expect(finalBackground).toMatchObject({ h: 112 });
    expect(finalBackground?.y).toBeGreaterThanOrEqual(536);
    expect((finalBackground?.y || 0) + (finalBackground?.h || 0)).toBeLessThanOrEqual(696);
    expect(auditSlideCanvas(upgraded)).toEqual([]);

    const currentMarked = ensureEditableCanvas({
      ...parsed,
      slides: [{
        ...parsed.slides[0],
        canvas: {
          ...current,
          elements: [...current.elements, customMarker],
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

    expect(parsed.presentationTheme?.themeId).toBe("darkLecture");
    expect(parsed.presentationTheme?.colors.background).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("accepts all premium presentation themes", () => {
    expect(PREMIUM_PRESENTATION_THEME_IDS).toHaveLength(8);

    for (const themeId of PREMIUM_PRESENTATION_THEME_IDS) {
      const theme = presentationThemeSchema.parse(PREMIUM_PRESENTATION_THEMES[themeId]);

      expect(theme.themeId).toBe(themeId);
      for (const color of Object.values(theme.colors)) {
        expect(color).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("builds StudyDeck editorial slides with large separate image columns", () => {
    const theme = PREMIUM_PRESENTATION_THEMES.studydeckEditorial;
    const slide = presentationSchema.parse({
      id: "presentation-editorial",
      title: "Editorial deck",
      scenario: "university_report",
      level: "university_student",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Engineering becomes identity"],
      presentationTheme: theme,
      speechScript: [{ slideOrder: 2, slideTitle: "Engineering becomes identity", text: "Narration." }],
      slides: [{
        id: "slide-editorial",
        order: 2,
        title: "Engineering becomes identity",
        slideKind: "content",
        layout: "image-focus",
        thesis: "A clear product idea connects engineering decisions with a recognizable identity.",
        bullets: ["The image carries context.", "The text keeps one central claim."],
        visual: {
          type: "image",
          image: {
            url: "https://cdn.example.com/editorial.jpg",
            objectKey: "projects/project-1/images/editorial.jpg",
            alt: "Engineering team reviewing a vehicle",
          },
        },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      }],
    }).slides[0];

    const canvas = buildSlideCanvas(slide, theme, {
      designDirection: {
        slideOrder: 2,
        visualRole: "context",
        layoutIntent: "split_image_text",
        imageStrategy: "real_photo",
        sceneTextMode: "visual_labels",
        visualPrompt: "Engineering team reviewing a vehicle",
      },
    });
    const image = canvas.elements.find((element) => element.id === "slide-editorial-editorial-image");

    expect(canvas.version).toBe(3);
    expect(canvas.backgroundStyle).toEqual({ type: "solid", color: theme.colors.background });
    expect(image).toMatchObject({ type: "image", w: 576, h: 720, fit: "cover" });
    expect((image?.w || 0) / canvas.width).toBeCloseTo(0.45, 2);
    expect(canvas.elements.some((element) => element.id.endsWith("-backplate"))).toBe(false);
    expect(auditSlideCanvas(canvas)).toEqual([]);
  });

  it("rebuilds unmarked StudyDeck editorial canvases instead of applying legacy text backplates", () => {
    const theme = PREMIUM_PRESENTATION_THEMES.studydeckEditorial;
    const parsed = presentationSchema.parse({
      id: "presentation-editorial-rebuild",
      title: "Editorial rebuild",
      scenario: "university_report",
      level: "university_student",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Conclusion"],
      presentationTheme: theme,
      speechScript: [{ slideOrder: 1, slideTitle: "Conclusion", text: "Narration." }],
      slides: [{
        id: "slide-editorial-rebuild",
        order: 1,
        title: "Conclusion",
        slideKind: "summary",
        layout: "summary",
        thesis: "A concise conclusion with a clear hierarchy.",
        bullets: ["First supporting idea.", "Second supporting idea."],
        visual: { type: "none" },
        blocks: [],
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
        canvas: {
          version: 3,
          width: 1280,
          height: 720,
          background: theme.colors.text,
          elements: [{
            id: "slide-editorial-rebuild-editorial-title-backplate",
            type: "shape",
            shape: "roundRect",
            x: 48,
            y: 48,
            w: 600,
            h: 96,
            rotation: 0,
            zIndex: 4,
            opacity: 1,
            locked: true,
            fill: theme.colors.surface,
            stroke: theme.colors.line,
            strokeWidth: 1,
          }],
        },
      }],
    });

    const canvas = ensureEditableCanvas(parsed).slides[0].canvas!;

    expect(canvas.version).toBe(3);
    expect(canvas.elements.some((element) => element.id.endsWith("-backplate"))).toBe(false);
    expect(canvas.elements.some((element) => element.id.endsWith("-editorial-footer-order"))).toBe(true);
    expect(auditSlideCanvas(canvas)).toEqual([]);
  });

  it("resolves premium themes from themeId and falls back for unknown IDs", () => {
    const fallback = resolvePresentationTheme({
      presentationTheme: {
        preset: "minimal",
        mood: "neutral",
        colors: {
          background: "#F7F8FA",
          surface: "#FFFFFF",
          surfaceAlt: "#ECEFF3",
          text: "#161A1F",
          muted: "#59616B",
          accent: "#5B5BD6",
          accentAlt: "#14866D",
          line: "#DDE1E7",
        },
        fonts: {
          heading: "Arial",
          body: "Arial",
          tone: "neutral",
        },
      },
    });

    expect(resolvePremiumPresentationTheme("startupPitch", fallback).themeId).toBe("startupPitch");
    expect(resolvePremiumPresentationTheme("unknownTheme", fallback)).toEqual(fallback);
  });

  it("resolves a stable premium theme from a design brief", () => {
    const brief = designBriefSchema.parse({
      themeId: "scienceBoard",
      mood: "serious",
      audienceFit: "Students studying a scientific process.",
      visualMetaphor: "A laboratory board that reveals one layer at a time.",
      colorIntent: "Cool surfaces with a precise high-contrast accent.",
      typographyIntent: "Compact academic headings and readable body text.",
      rhythm: {
        titleStyle: "academic",
        density: "medium",
        imageFrequency: "balanced",
        sectionBreaks: true,
      },
      slideDirections: [
        {
          slideOrder: 1,
          visualRole: "hero",
          layoutIntent: "diagram",
          imageStrategy: "diagram",
          visualPrompt: "A clean scientific system diagram.",
        },
      ],
    });

    const theme = resolveThemeFromDesignBrief(brief);
    expect(theme.themeId).toBe("scienceBoard");
    expect(theme.colors.accent).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("renders visual director scene variants on the shared canvas", () => {
    const presentation = presentationSchema.parse({
      id: "visual-director", title: "Visual story", scenario: "university_report", level: "university_student",
      slideCount: 1, generationMode: "demo", generatedText: "Slide 1: Visual story\nA supported comparison.",
      sources: [], outline: ["Visual story"], narrativePlan: [],
      speechScript: [{ slideOrder: 1, slideTitle: "Visual story", text: "Narration." }],
      slides: [{
        id: "slide-scene", order: 1, title: "Visual story", slideKind: "content", layout: "statement",
        thesis: "A supported comparison explains the central claim.",
        bullets: ["Evidence one", "Evidence two", "A memorable quotation"], definition: null, keyConcepts: [],
        visual: {
          type: "comparison_diagram", title: "Two approaches", description: "", leftLabel: "Before", rightLabel: "After",
          items: [{ label: "Evidence one", text: "Evidence one" }, { label: "Evidence two", text: "Evidence two" }],
          rows: [{ label: "Result", left: "Limited", right: "Improved" }, { label: "Reach", left: "Local", right: "Broad" }],
        },
        highlights: [], blocks: [{ type: "quote", content: "A memorable quotation" }], speakerNotes: "Narration.",
        timingSeconds: 45, sourceRefs: [{ sourceId: "source-1", label: "Research", excerpt: "Supporting evidence", page: null }],
      }],
      presentationTheme: PREMIUM_PRESENTATION_THEMES.academicClean,
    });

    const intents = ["comparison", "evidence_board", "quote_spread"] as const;
    const markers = ["comparison-left-label", "evidence-thesis", "quote-mark"];
    intents.forEach((layoutIntent, index) => {
      const canvas = buildSlideCanvas(presentation.slides[0], presentation.presentationTheme!, {
        designDirection: {
          slideOrder: 1,
          visualRole: layoutIntent === "comparison" ? "compare" : layoutIntent === "quote_spread" ? "quote" : "evidence",
          layoutIntent,
          imageStrategy: layoutIntent === "comparison" ? "diagram" : "none",
          visualPrompt: "Directed scene",
        },
      });
      expect(canvas.elements.some((element) => element.id.includes(markers[index]))).toBe(true);
    });

    const diagramSlide = {
      ...presentation.slides[0],
      layout: "process" as const,
      visual: {
        ...presentation.slides[0].visual,
        type: "process_diagram" as const,
        image: undefined,
        items: [
          { label: "Research", text: "Collect grounded evidence" },
          { label: "Explain", text: "Connect causes and effects" },
          { label: "Conclude", text: "State the takeaway" },
        ],
      },
    };
    const diagramCanvas = buildSlideCanvas(diagramSlide, presentation.presentationTheme!, {
      designDirection: {
        slideOrder: 1,
        visualRole: "sequence",
        layoutIntent: "diagram",
        imageStrategy: "diagram",
        sceneTextMode: "visual_labels",
        visualPrompt: "Research to explanation to conclusion process",
      },
    });
    expect(diagramCanvas.elements.some((element) => element.id.includes("-step-0-"))).toBe(true);
    expect(diagramCanvas.elements.some((element) => element.type === "shape")).toBe(true);
    expect(diagramCanvas.elements.some((element) => element.type === "image")).toBe(false);

    const posterCanvas = buildSlideCanvas(presentation.slides[0], presentation.presentationTheme!, {
      designDirection: {
        slideOrder: 1,
        visualRole: "visual_statement",
        layoutIntent: "statement",
        imageStrategy: "none",
        sceneTextMode: "hero_phrase",
        visualPrompt: "Strong thesis moment",
      },
    });
    expect(posterCanvas.elements.some((element) => element.id.includes("poster-phrase"))).toBe(true);

    const talkCanvas = buildSlideCanvas(presentation.slides[0], presentation.presentationTheme!, {
      designDirection: {
        slideOrder: 1,
        visualRole: "explain",
        layoutIntent: "cards",
        imageStrategy: "none",
        sceneTextMode: "talk_sentences",
        visualPrompt: "Three short speaking beats",
      },
    });
    expect(talkCanvas.elements.some((element) => element.id.includes("talk-beat-0"))).toBe(true);
    expect(auditSlideCanvas(talkCanvas).filter((issue) => issue.includes("overlaps"))).toEqual([]);
  });

  it("keeps old presentations without themeId valid", () => {
    const parsed = presentationThemeSchema.parse({
      preset: "academic",
      mood: "serious",
      colors: {
        background: "#F5F7FB",
        surface: "#FFFFFF",
        surfaceAlt: "#E8EEF8",
        text: "#172033",
        muted: "#536074",
        accent: "#315D9B",
        accentAlt: "#8C5D2B",
        line: "#D7DEEA",
      },
      fonts: {
        heading: "Georgia",
        body: "Arial",
        tone: "bookish",
      },
    });

    expect(parsed.themeId).toBeUndefined();
    expect(parsed.preset).toBe("academic");
  });

  it("resolves topic-sensitive and stable fallback themes", () => {
    expect(resolvePresentationTheme({ title: "Война и катастрофа" }).mood).toBe("dark");
    expect(resolvePresentationTheme({ title: "Веселый детский праздник" }).preset).toBe("bright");
    expect(resolvePresentationTheme({ title: "Программирование и данные" }).preset).toBe("tech");

    const first = resolvePresentationTheme({ title: "Neutral topic alpha" });
    const second = resolvePresentationTheme({ title: "Neutral topic beta" });
    expect(first.preset).not.toBe(second.preset);
  });

  it("creates valid editable canvases for the parity slide set", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-parity",
      title: "Parity fixture",
      scenario: "college_report",
      level: "university",
      slideCount: 4,
      generationMode: "demo",
      generatedText: "Parity fixture",
      sources: [],
      outline: ["Image hero", "Diagram board", "Evidence", "Summary"],
      narrativePlan: [],
      speechScript: [],
      slides: [
        paritySlide("hero", 1, "Image hero", "title", "hero", {
          type: "image",
          image: { url: "https://example.com/hero.png", objectKey: "projects/p/images/hero.png", alt: "Students", contentType: "image/png" },
        }),
        paritySlide("diagram", 2, "Diagram board", "content", "process", {
          type: "process_diagram",
          items: [{ label: "Research", text: "Collect evidence" }, { label: "Explain", text: "Build the argument" }],
        }),
        paritySlide("evidence", 3, "Evidence", "content", "evidence"),
        paritySlide("summary", 4, "Summary", "summary", "summary"),
      ],
    });

    const editable = ensureEditableCanvas(parsed);
    expect(editable.slides).toHaveLength(4);
    for (const slide of editable.slides) {
      expect(slideCanvasSchema.safeParse(slide.canvas).success, slide.id).toBe(true);
      expect(slide.canvas?.elements.length, slide.id).toBeGreaterThan(0);
    }
    expect(editable.slides[0].canvas?.elements.some((element) => element.type === "image")).toBe(true);
    expect(editable.slides[1].canvas?.elements.filter((element) => element.type === "shape").length).toBeGreaterThan(2);
  });

  it("preserves an explicitly edited canvas byte-for-byte", () => {
    const parsed = presentationSchema.parse({
      id: "presentation-custom",
      title: "Custom canvas",
      scenario: "college_report",
      level: "university",
      slideCount: 1,
      generationMode: "demo",
      generatedText: "Custom canvas",
      sources: [],
      outline: ["Custom canvas"],
      narrativePlan: [],
      speechScript: [],
      slides: [paritySlide("custom", 1, "Custom canvas", "content", "statement")],
    });
    const original = buildSlideCanvas(parsed.slides[0], resolvePresentationTheme(parsed));
    const custom = {
      ...original,
      background: "#123456",
      backgroundStyle: { type: "solid" as const, color: "#123456" },
      elements: [
        ...original.elements.map((element) => element.id === "custom-title" ? { ...element, x: element.x + 37 } : element),
        {
          id: "custom-custom-canvas-marker",
          type: "shape" as const,
          shape: "rect" as const,
          x: 0, y: 0, w: 1, h: 1, rotation: 0, zIndex: -1, opacity: 0, locked: true,
          fill: "#000000", stroke: "#000000", strokeWidth: 0,
        },
      ],
    };

    const editable = ensureEditableCanvas({ ...parsed, slides: [{ ...parsed.slides[0], canvas: custom }] });
    expect(editable.slides[0].canvas).toEqual(custom);
  });
});

function paritySlide(
  id: string,
  order: number,
  title: string,
  slideKind: "title" | "content" | "summary",
  layout: "hero" | "process" | "evidence" | "summary" | "statement",
  visual: Record<string, unknown> = {},
) {
  return {
    id,
    order,
    title,
    slideKind,
    layout,
    thesis: `${title} keeps one shared visual source.`,
    bullets: ["First concrete point", "Second concrete point", "Third concrete point"],
    definition: null,
    keyConcepts: [],
    visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [], ...visual },
    highlights: [],
    blocks: [{ type: "bullets", items: ["First concrete point", "Second concrete point", "Third concrete point"] }],
    speakerNotes: `${title} narration.`,
    timingSeconds: 45,
    sourceRefs: layout === "evidence" ? [{ sourceId: "source-1", label: "Research", excerpt: "Concrete evidence", page: "4" }] : [],
  };
}
