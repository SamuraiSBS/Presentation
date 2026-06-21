import { afterEach, describe, expect, it } from "vitest";
import type { PresentationDocument } from "@studydeck/shared";
import {
  buildSlideImageQuery,
  chooseImageCandidate,
  enrichPresentationImages,
  tavilyResponseToImageCandidates,
} from "./image-search.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("image search helpers", () => {
  it("builds different queries for different slides", () => {
    const presentation = fixturePresentation();
    const project = { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" };

    const first = buildSlideImageQuery(project, presentation.slides[0]);
    const second = buildSlideImageQuery(project, presentation.slides[1]);

    expect(first).toContain("AI in education");
    expect(first).toContain("Classroom context");
    expect(second).toContain("Teacher workflow");
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

  it("keeps slides valid when one slide image lookup fails", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const warnings: string[] = [];

    const enriched = await enrichPresentationImages(
      { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" },
      presentation,
      {
        searchImages: async (query) => {
          if (query.includes("Teacher workflow")) throw new Error("search failed");
          return [{ url: "https://cdn.example.com/classroom.jpg", description: "Classroom", sourceTitle: "Image source" }];
        },
        downloadImage: async () => ({ buffer: Buffer.from("image"), contentType: "image/jpeg", extension: "jpg" }),
        putObject: async () => undefined,
        warn: (message) => warnings.push(message),
      },
    );

    expect(enriched.slides[0].visual.image?.objectKey).toContain("projects/project-1/images/slide-1-");
    expect(enriched.slides[1].visual.image).toBeUndefined();
    expect(warnings).toEqual(["Slide image lookup failed for slide 2"]);
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
          { url: "https://bad.example.com/page", description: "Bad result", sourceTitle: "" },
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
        sourceRefs: [],
      },
    ],
  };
}
