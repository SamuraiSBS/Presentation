import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { PresentationDocument } from "@studydeck/shared";
import {
  buildSlideImageQuery,
  chooseImageCandidate,
  enrichPresentationImages,
  processPresentationImage,
  shouldSearchForSlideImage,
  tavilyResponseToImageCandidates,
} from "./image-search.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("image search helpers", () => {
  it("prefers the design brief visual prompt in a short concrete query", () => {
    const presentation = fixturePresentation();
    const project = { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" };

    const first = buildSlideImageQuery(project, presentation.slides[0], presentation.designBrief?.slideDirections[0]);
    const second = buildSlideImageQuery(project, presentation.slides[1], presentation.designBrief?.slideDirections[1]);

    expect(first).toContain("University students using an AI tutor in a real lecture hall");
    expect(first).toContain("AI in education");
    expect(first).toContain("Classroom context");
    expect(second).toContain("Teacher workflow");
    expect(first).not.toContain("educational presentation image");
    expect(first).not.toEqual(second);
  });

  it("keeps Tavily image queries below the provider limit", () => {
    const presentation = fixturePresentation();
    const slide = {
      ...presentation.slides[0],
      title: "Очень длинный заголовок ".repeat(20),
      thesis: "Подробное объяснение темы ".repeat(30),
      bullets: ["Первый длинный пункт ".repeat(20), "Второй длинный пункт ".repeat(20)],
      visual: {
        ...presentation.slides[0].visual,
        description: "Конкретная сцена для поиска изображения ".repeat(20),
      },
    };

    const query = buildSlideImageQuery(
      {
        id: "project-1",
        title: "История международной компании ".repeat(20),
        prompt: "Подготовь подробную учебную презентацию ".repeat(30),
      },
      slide,
    );

    expect(query.length).toBeLessThanOrEqual(400);
    expect(query).toContain("Очень длинный заголовок");
  });

  it("maps Tavily image responses into candidates", () => {
    expect(
      tavilyResponseToImageCandidates({
        images: [{ url: "https://cdn.example.com/general.jpg", description: "General classroom" }],
        results: [
          {
            title: "Article",
            url: "https://example.com/article",
            images: [{ url: "https://cdn.example.com/result.png", description: "Teacher dashboard" }],
          },
        ],
      }),
    ).toEqual([
      {
        url: "https://cdn.example.com/general.jpg",
        description: "General classroom",
        sourceTitle: "",
      },
      {
        url: "https://cdn.example.com/result.png",
        description: "Teacher dashboard",
        sourceUrl: "https://example.com/article",
        sourceTitle: "Article",
      },
    ]);
  });

  it("skips repeated urls and domains before falling back to another domain", () => {
    const usedUrls = new Set(["https://cdn.example.com/used.jpg"]);
    const usedDomains = new Set(["cdn.example.com"]);

    const selected = chooseImageCandidate(
      [
        { url: "https://cdn.example.com/used.jpg", description: "", sourceTitle: "" },
        { url: "https://cdn.example.com/new.jpg", description: "", sourceTitle: "" },
        { url: "https://images.example.org/new.jpg", description: "", sourceTitle: "" },
      ],
      usedUrls,
      usedDomains,
    );

    expect(selected?.url).toBe("https://images.example.org/new.jpg");
  });

  it("rejects unrelated image candidates when a concrete brand is requested", () => {
    const selected = chooseImageCandidate(
      [
        { url: "https://cdn.example.com/lions.jpg", description: "Two lions walking in grass", sourceTitle: "Wildlife" },
        { url: "https://cdn.example.com/bmw-m3.jpg", description: "BMW M3 on a race circuit", sourceTitle: "BMW motorsport" },
      ],
      new Set(),
      new Set(),
      {
        query: "BMW M3 official documentary photograph",
        slideTitle: "Популярные модели BMW M",
        projectTitle: "BMW M: история и модели",
      },
    );

    expect(selected?.url).toBe("https://cdn.example.com/bmw-m3.jpg");
  });

  it("searches concrete real-photo slides and skips diagram slides", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const warnings: string[] = [];
    const queries: string[] = [];

    const enriched = await enrichPresentationImages(
      { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" },
      presentation,
      {
        searchImages: async (query) => {
          queries.push(query);
          return [{ url: "https://cdn.example.com/classroom.jpg", description: "Classroom", sourceTitle: "Image source" }];
        },
        downloadImage: async () => ({ buffer: Buffer.from("image"), contentType: "image/jpeg", extension: "jpg" }),
        putObject: async () => undefined,
        warn: (message) => warnings.push(message),
      },
    );

    expect(enriched.slides[0].visual.image?.objectKey).toContain("projects/project-1/images/slide-1-");
    expect(enriched.slides[1].visual.image).toBeUndefined();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("University students using an AI tutor in a real lecture hall");
    expect(warnings).toEqual([]);
  });

  it("skips image lookup when an image direction has no concrete prompt", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    presentation.designBrief!.slideDirections[0].visualPrompt = "presentation image";
    let searchCalls = 0;

    const enriched = await enrichPresentationImages(
      { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slides: [presentation.slides[0]] },
      {
        searchImages: async () => {
          searchCalls += 1;
          return [];
        },
      },
    );

    expect(searchCalls).toBe(0);
    expect(enriched.slides[0].visual.image).toBeUndefined();
  });

  it("gates Tavily lookup to real concrete visual evidence", () => {
    const presentation = fixturePresentation();
    const slide = presentation.slides[0];

    expect(shouldSearchForSlideImage(slide, {
      slideOrder: 1,
      visualRole: "evidence",
      layoutIntent: "split_image_text",
      imageStrategy: "real_photo",
      visualPrompt: "Map of missile sites in Cuba during the 1962 Cuban Missile Crisis",
    })).toBe(true);

    expect(shouldSearchForSlideImage(slide, {
      slideOrder: 1,
      visualRole: "explain",
      layoutIntent: "diagram",
      imageStrategy: "real_photo",
      visualPrompt: "Cause and effect process diagram for political tension",
    })).toBe(false);

    expect(shouldSearchForSlideImage(slide, {
      slideOrder: 1,
      visualRole: "context",
      layoutIntent: "split_image_text",
      imageStrategy: "generated_illustration",
      visualPrompt: "University students discussing an abstract theory",
    })).toBe(false);

    expect(shouldSearchForSlideImage({
      ...slide,
      visual: {
        ...slide.visual,
        image: {
          url: "https://assets.studydeck.local/screenshot",
          objectKey: "projects/project-1/screens/dashboard.png",
          provider: "user",
          alt: "Панель проекта",
          query: "",
          sourceTitle: "Панель проекта",
          contentType: "image/png",
          warnings: [],
        },
      },
    }, {
      slideOrder: 1,
      visualRole: "evidence",
      layoutIntent: "split_image_text",
      imageStrategy: "real_photo",
      visualPrompt: "Product dashboard screenshot",
    })).toBe(false);
  });

  it("tries another Tavily candidate when the first image cannot be downloaded", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const attemptedUrls: string[] = [];

    const enriched = await enrichPresentationImages(
      { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slides: [presentation.slides[0]] },
      {
        searchImages: async () => [
          { url: "https://bad.example.com/page", description: "AI classroom result", sourceTitle: "" },
          { url: "https://cdn.example.com/classroom.webp", description: "Classroom", sourceTitle: "Image source" },
        ],
        downloadImage: async (url) => {
          attemptedUrls.push(url);
          if (url.includes("bad.example.com")) throw new Error("Unsupported image content type: text/html");
          return { buffer: Buffer.from("image"), contentType: "image/webp", extension: "webp" };
        },
        putObject: async () => undefined,
      },
    );

    expect(attemptedUrls).toEqual([
      "https://bad.example.com/page",
      "https://cdn.example.com/classroom.webp",
    ]);
    expect(enriched.slides[0].visual.image?.objectKey).toMatch(/\.webp$/);
    expect(enriched.slides[0].visual.image?.sourceUrl).toBe("https://cdn.example.com/classroom.webp");
  });

  it("resizes and normalizes oversized presentation images before upload", async () => {
    const source = await sharp({
      create: {
        width: 1800,
        height: 1200,
        channels: 3,
        background: "#db7d35",
      },
    }).png().toBuffer();

    const processed = await processPresentationImage(source, {
      contentType: "image/png",
      maxBytes: 350_000,
      maxWidth: 960,
      maxHeight: 540,
    });

    expect(processed.contentType).toBe("image/jpeg");
    expect(processed.extension).toBe("jpg");
    expect(processed.width).toBeLessThanOrEqual(960);
    expect(processed.height).toBeLessThanOrEqual(540);
    expect(processed.byteSize).toBe(processed.buffer.length);
    expect(processed.buffer.length).toBeLessThanOrEqual(350_000);
    expect(processed.warnings.some((warning) => warning.includes("resized from 1800x1200"))).toBe(true);
  });

  it("stores processed image metadata on enriched slides", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const uploaded: Array<{ key: string; size: number; contentType: string }> = [];
    const source = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: "#4d8fba",
      },
    }).jpeg({ quality: 95 }).toBuffer();

    const enriched = await enrichPresentationImages(
      { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slides: [presentation.slides[0]] },
      {
        searchImages: async () => [{ url: "https://cdn.example.com/classroom.png", description: "Classroom", sourceTitle: "Image source" }],
        downloadImage: async () => processPresentationImage(source, {
          contentType: "image/jpeg",
          maxBytes: 200_000,
          maxWidth: 800,
          maxHeight: 600,
        }),
        putObject: async (key, buffer, contentType) => {
          uploaded.push({ key, size: buffer.length, contentType });
        },
      },
    );

    const image = enriched.slides[0].visual.image;
    expect(image?.contentType).toBe("image/jpeg");
    expect(image?.width).toBeLessThanOrEqual(800);
    expect(image?.height).toBeLessThanOrEqual(600);
    expect(image?.byteSize).toBe(uploaded[0].size);
    expect(uploaded[0].key).toMatch(/\.jpg$/);
    expect(uploaded[0].contentType).toBe("image/jpeg");
  });

  it("keeps a small original image when processing fails safely", async () => {
    const processed = await processPresentationImage(Buffer.from("not actually an image"), {
      contentType: "image/webp",
      maxBytes: 100_000,
    });

    expect(processed.contentType).toBe("image/webp");
    expect(processed.extension).toBe("webp");
    expect(processed.byteSize).toBe("not actually an image".length);
    expect(processed.warnings[0]).toContain("processing failed; kept original");
  });
});

function fixturePresentation(): PresentationDocument {
  return {
    id: "presentation-1",
    title: "AI in education",
    scenario: "lesson",
    level: "beginner",
    slideCount: 2,
    generationMode: "demo",
    generatedText: "Слайд 1: Classroom context\nAI changes classroom routines.\n\nСлайд 2: Teacher workflow\nTeachers use AI to prepare and review tasks.",
    sources: [],
    outline: ["Classroom context", "Teacher workflow"],
    narrativePlan: [],
    speechScript: [
      { slideOrder: 1, slideTitle: "Classroom context", text: "Narration one." },
      { slideOrder: 2, slideTitle: "Teacher workflow", text: "Narration two." },
    ],
    designBrief: {
      themeId: "academicClean",
      mood: "serious",
      audienceFit: "University students",
      visualMetaphor: "A practical learning environment",
      colorIntent: "Clear academic contrast",
      typographyIntent: "Readable academic type",
      rhythm: { titleStyle: "academic", density: "medium", imageFrequency: "balanced", sectionBreaks: false },
      layoutPrinciples: ["Use images only for concrete scenes"],
      imageStrategy: "Balance real photos, diagrams, and text-led slides",
      slideDirections: [
        {
          slideOrder: 1,
          visualRole: "context",
          layoutIntent: "split_image_text",
          imageStrategy: "real_photo",
          visualPrompt: "University students using an AI tutor in a real lecture hall",
        },
        {
          slideOrder: 2,
          visualRole: "sequence",
          layoutIntent: "diagram",
          imageStrategy: "diagram",
          visualPrompt: "Three-step teacher planning and review workflow",
        },
      ],
    },
    slides: [
      {
        id: "slide-1",
        order: 1,
        title: "Classroom context",
        slideKind: "title",
        layout: "hero",
        thesis: "AI changes classroom routines.",
        bullets: ["Students use hints"],
        definition: null,
        keyConcepts: [],
        visual: { type: "none", title: "", description: "students in a modern classroom", leftLabel: "", rightLabel: "", items: [], rows: [] },
        highlights: [],
        blocks: [{ type: "callout", content: "AI changes classroom routines." }],
        speakerNotes: "A teacher introduces AI tools in a classroom.",
        timingSeconds: 45,
        placeholders: [],
        sourceRefs: [],
      },
      {
        id: "slide-2",
        order: 2,
        title: "Teacher workflow",
        slideKind: "summary",
        layout: "summary",
        thesis: "Teachers use AI to prepare and review tasks.",
        bullets: ["Prepare examples", "Review drafts", "Explain mistakes"],
        definition: null,
        keyConcepts: [],
        visual: { type: "mind_map", title: "Workflow", description: "teacher planning lesson with dashboard", leftLabel: "", rightLabel: "", items: [], rows: [] },
        highlights: [],
        blocks: [{ type: "bullets", items: ["Prepare examples", "Review drafts", "Explain mistakes"] }],
        speakerNotes: "The workflow shows how a teacher prepares, checks and explains tasks.",
        timingSeconds: 45,
        placeholders: [],
        sourceRefs: [],
      },
    ],
  };
}
