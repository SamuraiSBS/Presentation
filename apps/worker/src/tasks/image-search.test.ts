import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { PresentationDocument } from "@studydeck/shared";
import {
  buildSlideImageQuery,
  buildAitunnelImagePrompt,
  buildRefinedImageQueries,
  chooseImageCandidate,
  economicPhotoLimit,
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
  it("builds a BMW M3 documentary query with its model anchor and period context", () => {
    const presentation = fixturePresentation();
    const direction = {
      slideOrder: 1,
      visualRole: "context" as const,
      layoutIntent: "split_image_text" as const,
      imageStrategy: "real_photo" as const,
      visualPrompt: "BMW M3 E30 1986 track debut, side three-quarter documentary composition",
    };
    const query = buildSlideImageQuery(
      { id: "bmw", title: "BMW M3 history", prompt: "Explain the E30 generation" },
      { ...presentation.slides[0], title: "BMW M3 E30" },
      direction,
    );

    expect(query).toContain("BMW M3 E30 1986");
    expect(query).toContain("historical photograph");
  });

  it("uses one query per permitted slide, preserves attribution, and falls back after the deck cap", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const deck = {
      ...presentation,
      slides: [
        { ...presentation.slides[0], title: "BMW M3 E30", slideKind: "content" as const },
        { ...presentation.slides[0], id: "slide-2", order: 2, title: "BMW M3 E36", slideKind: "content" as const },
      ],
      designBrief: {
        ...presentation.designBrief!,
        slideDirections: [
          { slideOrder: 1, visualRole: "context" as const, layoutIntent: "split_image_text" as const, imageStrategy: "real_photo" as const, visualPrompt: "BMW M3 E30 1986 documentary track photograph" },
          { slideOrder: 2, visualRole: "context" as const, layoutIntent: "split_image_text" as const, imageStrategy: "real_photo" as const, visualPrompt: "BMW M3 E36 1992 documentary track photograph" },
        ],
      },
    };
    const queries: string[] = [];
    const enriched = await enrichPresentationImages(
      { id: "bmw", title: "BMW M3 history", prompt: "Explain M3 generations" },
      deck,
      {
        searchImages: async (query) => {
          queries.push(query);
          return [{ url: "https://cdn.example.com/bmw-m3-e30.jpg", description: "BMW M3 E30 1986 documentary track photograph", sourceTitle: "BMW Group archive", sourceUrl: "https://www.bmwgroup.com/archive" }];
        },
        downloadImage: async () => ({ buffer: Buffer.from("image"), contentType: "image/jpeg", extension: "jpg" }),
        putObject: async () => undefined,
      },
    );

    expect(queries).toHaveLength(1);
    expect(enriched.slides[0].visual.image).toMatchObject({ sourceTitle: "BMW Group archive", sourceUrl: "https://www.bmwgroup.com/archive" });
    expect(enriched.slides[1].visual.image).toBeUndefined();
    expect(enriched.designBrief?.slideDirections[1]).toMatchObject({ imageStrategy: "diagram", layoutIntent: "diagram" });
  });

  it("keeps an abstract claim text-led and does not create a generic car-photo query", () => {
    const presentation = fixturePresentation();
    const slide = { ...presentation.slides[0], title: "Why a model becomes iconic" };
    const direction = { slideOrder: 1, visualRole: "visual_statement" as const, layoutIntent: "statement" as const, imageStrategy: "real_photo" as const, visualPrompt: "Abstract claim about brand meaning and cultural value" };
    expect(shouldSearchForSlideImage(slide, direction)).toBe(false);
    expect(buildRefinedImageQueries({ id: "bmw", title: "BMW M3 history", prompt: "Explain the model" }, slide, direction)).toHaveLength(1);
  });

  it("uses the managed visual-policy photo quota and keeps the legacy fallback for other sizes", () => {
    expect(economicPhotoLimit(6)).toBe(3);
    expect(economicPhotoLimit(8)).toBe(4);
    expect(economicPhotoLimit(10)).toBe(5);
    expect(economicPhotoLimit(12)).toBe(6);
    expect(economicPhotoLimit(14)).toBe(7);
    expect(economicPhotoLimit(1)).toBe(1);
    expect(economicPhotoLimit(5)).toBe(1);
    expect(economicPhotoLimit(25)).toBe(2);
  });

  it("keeps a ten-slide concrete deck to five searches and five stored web images", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const slides = Array.from({ length: 10 }, (_, index) => ({
      ...presentation.slides[0],
      id: `slide-${index + 1}`,
      order: index + 1,
      slideKind: "content" as const,
      title: `BMW M3 generation ${index + 1}`,
      visual: { ...presentation.slides[0].visual, image: undefined },
    }));
    const directions = slides.map((slide) => ({
      slideOrder: slide.order,
      visualRole: "context" as const,
      layoutIntent: "split_image_text" as const,
      imageStrategy: "real_photo" as const,
      visualPrompt: `${slide.title} documentary automobile photograph`,
    }));
    const queries: string[] = [];
    const enriched = await enrichPresentationImages(
      { id: "bmw-10", title: "BMW M3 history", prompt: "Explain the model generations" },
      { ...presentation, slideCount: 10, slides, designBrief: { ...presentation.designBrief!, slideDirections: directions } },
      {
        searchImages: async (query) => {
          queries.push(query);
          return [{ url: `https://cdn.example.com/${queries.length}.jpg`, description: query, sourceTitle: "BMW archive" }];
        },
        downloadImage: async () => ({ buffer: Buffer.from("image"), contentType: "image/jpeg", extension: "jpg" }),
        putObject: async () => undefined,
      },
    );

    expect(queries).toHaveLength(5);
    expect(enriched.slides.filter((slide) => slide.visual.image?.provider === "tavily")).toHaveLength(5);
    expect(enriched.designBrief?.slideDirections.filter((direction) => direction.imageStrategy === "real_photo")).toHaveLength(5);
  });

  it("uses a local fallback when the image bucket cannot be reserved", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    let searchCalls = 0;
    const enriched = await enrichPresentationImages(
      { id: "budget-refusal", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slides: [presentation.slides[0]] },
      {
        reserveImageBucket: async () => "blocked",
        searchImages: async () => {
          searchCalls += 1;
          return [];
        },
      },
    );

    expect(searchCalls).toBe(0);
    expect(enriched.slides[0].visual.image).toBeUndefined();
    expect(enriched.designBrief?.slideDirections[0]).toMatchObject({ imageStrategy: "diagram", layoutIntent: "diagram" });
  });

  it("skips attempted recovery slides and leaves failed photo directions for the final diagram materialization", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const slides = [1, 2].map((order) => ({
      ...presentation.slides[0],
      id: `slide-${order}`,
      order,
      title: `BMW M3 generation ${order}`,
      slideKind: "content" as const,
      visual: { ...presentation.slides[0].visual, image: undefined },
    }));
    const directions = slides.map((slide) => ({
      slideOrder: slide.order,
      visualRole: "context" as const,
      layoutIntent: "split_image_text" as const,
      imageStrategy: "real_photo" as const,
      visualPrompt: `${slide.title} documentary automobile photograph`,
    }));
    const attemptedSlideOrders = new Set([1]);
    const queries: string[] = [];
    const enriched = await enrichPresentationImages(
      { id: "recovery", title: "BMW M3 history", prompt: "Explain the model generations" },
      { ...presentation, slideCount: 10, slides, designBrief: { ...presentation.designBrief!, slideDirections: directions } },
      {
        recovery: true,
        skipSlideOrders: attemptedSlideOrders,
        attemptedSlideOrders,
        searchImages: async (query) => {
          queries.push(query);
          return [];
        },
        reserveImageBucket: async () => ({ envelopeId: "recovery-envelope", idempotencyKey: "image", amountRub: "1" }),
      },
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("BMW M3 generation 2");
    expect(enriched.slides.map((slide) => slide.visual.type)).toEqual(slides.map((slide) => slide.visual.type));
    expect(enriched.slides.every((slide) => !slide.visual.image)).toBe(true);
    expect([...attemptedSlideOrders]).toEqual([1, 2]);
  });

  it("uses one AITunnel image generation, stores the result, and settles provider cost", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    process.env.AI_PROVIDER = "aitunnel";
    const presentation = fixturePresentation();
    const generatedBuffer = await sharp({
      create: { width: 640, height: 420, channels: 3, background: { r: 70, g: 40, b: 130 } },
    }).png().toBuffer();
    let generatedPrompt = "";
    let settledCost: string | undefined;
    const enriched = await enrichPresentationImages(
      { id: "aitunnel-recovery", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slideCount: 6, slides: [presentation.slides[0]] },
      {
        generateImage: async (prompt) => {
          generatedPrompt = prompt;
          return { buffer: generatedBuffer, contentType: "image/png", model: "gpt-image-1-mini", costRub: "0.40800000" };
        },
        reserveImageBucket: async () => ({ envelopeId: "aitunnel-envelope", idempotencyKey: "aitunnel-image", amountRub: "0.50000000" }),
        settleImageBucket: async (_reservation, actualRub) => {
          settledCost = actualRub;
        },
        putObject: async () => undefined,
      },
    );

    expect(generatedPrompt).toContain("Create a realistic horizontal editorial image");
    expect(buildAitunnelImagePrompt({ id: "p", title: "AI", prompt: "AI" }, presentation.slides[0], presentation.designBrief?.slideDirections[0])).toContain("Do not include text");
    expect(enriched.slides[0].visual.image).toMatchObject({
      provider: "aitunnel",
      sourceTitle: "AITunnel",
      url: "/api/projects/aitunnel-recovery/slides/slide-1/assets/visual-image",
    });
    expect(enriched.slides[0].visual.image?.objectKey).toMatch(/slide-1-aitunnel-[a-f0-9]{12}\.jpg$/);
    expect(settledCost).toBe("0.40800000");
  });

  it("uses the full managed photo quota for several AITunnel raster images", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const slides = Array.from({ length: 6 }, (_, index) => ({
      ...presentation.slides[0],
      id: `aitunnel-slide-${index + 1}`,
      order: index + 1,
      title: `AI in education example ${index + 1}`,
      visual: { ...presentation.slides[0].visual, image: undefined },
    }));
    const directions = slides.map((slide) => ({
      slideOrder: slide.order,
      visualRole: "context" as const,
      layoutIntent: "split_image_text" as const,
      imageStrategy: "real_photo" as const,
      visualPrompt: `${slide.title} documentary classroom photograph`,
    }));
    const generatedBuffer = await sharp({
      create: { width: 640, height: 420, channels: 3, background: { r: 70, g: 40, b: 130 } },
    }).png().toBuffer();
    let generated = 0;
    let reservations = 0;
    const enriched = await enrichPresentationImages(
      { id: "aitunnel-quota", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slideCount: 6, slides, designBrief: { ...presentation.designBrief!, slideDirections: directions } },
      {
        generateImage: async () => {
          generated += 1;
          return { buffer: generatedBuffer, contentType: "image/png", model: "gpt-image-1-mini", costRub: "0.60000000" };
        },
        reserveImageBucket: async () => {
          reservations += 1;
          return { envelopeId: "aitunnel-quota-envelope", idempotencyKey: `image-${reservations}`, amountRub: "0.66666666" };
        },
        putObject: async () => undefined,
      },
    );

    expect(generated).toBe(3);
    expect(reservations).toBe(3);
    expect(enriched.slides.filter((slide) => slide.visual.image?.provider === "aitunnel")).toHaveLength(3);
  });

  it("releases an image reservation after an aborted provider call and keeps the slide usable", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const released: string[] = [];
    const warnings: Array<Record<string, unknown> | undefined> = [];
    const enriched = await enrichPresentationImages(
      { id: "aitunnel-abort", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slideCount: 6, slides: [presentation.slides[0]] },
      {
        generateImage: async () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          throw error;
        },
        reserveImageBucket: async () => ({ envelopeId: "abort-envelope", idempotencyKey: "abort-image", amountRub: "0.5" }),
        releaseImageBucket: async (_reservation, reason) => { released.push(reason || ""); },
        warn: (_message, _error, context) => { warnings.push(context); },
      },
    );

    expect(enriched.slides[0].visual.image).toBeUndefined();
    expect(released).toEqual(["provider_aborted"]);
    expect(warnings[0]).toMatchObject({ provider: "aitunnel", slideOrder: 1, aborted: true });
  });

  it("does not search in recovery without an active cost-envelope context", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const deck = { ...presentation, slides: [presentation.slides[0]] };
    let searchCalls = 0;

    const recovered = await enrichPresentationImages(
      { id: "recovery-no-envelope", title: "AI in education", prompt: "Explain practical AI in school" },
      deck,
      {
        recovery: true,
        searchImages: async () => {
          searchCalls += 1;
          return [];
        },
      },
    );

    expect(searchCalls).toBe(0);
    expect(recovered).toBe(deck);
    expect(recovered.slides[0].visual.image).toBeUndefined();
  });
  it("prefers the design brief visual prompt in a short concrete query", () => {
    const presentation = fixturePresentation();
    const project = { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" };

    const first = buildSlideImageQuery(project, presentation.slides[0], presentation.designBrief?.slideDirections[0]);
    const second = buildSlideImageQuery(project, presentation.slides[1], presentation.designBrief?.slideDirections[1]);

    expect(first).toContain("University students using an AI tutor in a real lecture hall");
    expect(first).toContain("AI");
    expect(first).toContain("education");
    expect(first).toContain("Classroom context");
    expect(second).toContain("teacher");
    expect(second).toContain("workflow");
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

  it("keeps model and era anchors in a first-generation automotive query", () => {
    const presentation = fixturePresentation();
    const query = buildSlideImageQuery(
      { id: "porsche", title: "Porsche 911 history", prompt: "Explain the model line" },
      { ...presentation.slides[0], title: "Porsche 911 first generation" },
      {
        slideOrder: 1,
        visualRole: "context",
        layoutIntent: "split_image_text",
        imageStrategy: "real_photo",
        visualPrompt: "Porsche 911 first generation historical photograph",
      },
    );

    expect(query).toContain("Porsche");
    expect(query).toContain("911");
    expect(query).toContain("first generation");
    expect(query).toContain("historical photograph");
    expect(query).not.toContain("presentation image");
  });

  it("ranks a historical model candidate above a modern conflicting result", () => {
    const selected = chooseImageCandidate([
      { url: "https://cdn.example.com/porsche-911-2024.jpg", description: "Modern 2024 Porsche 911", sourceTitle: "New model" },
      { url: "https://cdn.example.com/porsche-911-1964.jpg", description: "Porsche 911 first generation historical photograph 1964", sourceTitle: "Archive" },
    ], new Set(), new Set(), {
      query: "Porsche 911 first generation historical photograph",
      slideTitle: "Porsche 911 first generation",
      projectTitle: "Porsche 911 history",
    });

    expect(selected?.url).toBe("https://cdn.example.com/porsche-911-1964.jpg");
  });

  it("falls back to a diagram rather than keeping an irrelevant stock result", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const deck = {
      ...presentation,
      slides: [{ ...presentation.slides[0], title: "Porsche 911 first generation", slideKind: "content" as const }],
      designBrief: {
        ...presentation.designBrief!,
        slideDirections: [{
          slideOrder: 1,
          visualRole: "context" as const,
          layoutIntent: "split_image_text" as const,
          imageStrategy: "real_photo" as const,
          visualPrompt: "Porsche 911 first generation historical photograph",
        }],
      },
    };
    const enriched = await enrichPresentationImages(
      { id: "porsche", title: "Porsche 911 history", prompt: "Explain the model line" },
      deck,
      {
        searchImages: async () => [{ url: "https://cdn.example.com/porsche-911-2024.jpg", description: "Modern 2024 Porsche 911", sourceTitle: "New model" }],
      },
    );

    expect(enriched.slides[0].visual.image).toBeUndefined();
    expect(enriched.designBrief?.slideDirections[0]).toMatchObject({ imageStrategy: "diagram", layoutIntent: "diagram" });
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

  it("uses a data-backed process diagram when every relevant photo candidate fails to download", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const slide = {
      ...presentation.slides[0],
      layout: "image-focus" as const,
      bullets: ["Collect the source material", "Compare the key evidence", "Explain the conclusion"],
    };

    const enriched = await enrichPresentationImages(
      { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slides: [slide] },
      {
        searchImages: async () => [{ url: "https://cdn.example.com/unavailable.jpg", description: "AI classroom", sourceTitle: "Archive" }],
        downloadImage: async () => { throw new Error("download failed"); },
        putObject: async () => undefined,
      },
    );

    expect(enriched.slides[0].visual.image).toBeUndefined();
    expect(enriched.slides[0]).toMatchObject({
      layout: "process",
      visual: { type: "process_diagram", items: [{ text: "Collect the source material" }, { text: "Compare the key evidence" }, { text: "Explain the conclusion" }] },
    });
  });

  it("turns a Tavily search error into a visible local diagram", async () => {
    process.env.PRESENTATION_IMAGES_ENABLED = "true";
    const presentation = fixturePresentation();
    const slide = {
      ...presentation.slides[0],
      bullets: ["Identify the concrete subject", "Connect the evidence to the claim"],
    };

    const enriched = await enrichPresentationImages(
      { id: "project-1", title: "AI in education", prompt: "Explain practical AI in school" },
      { ...presentation, slides: [slide] },
      {
        searchImages: async () => { throw new Error("Tavily unavailable"); },
        putObject: async () => undefined,
      },
    );

    expect(enriched.slides[0]).toMatchObject({ layout: "process", visual: { type: "process_diagram" } });
    expect(enriched.slides[0].visual.items.slice(0, 2)).toEqual([
      { label: "1", text: "Identify the concrete subject" },
      { label: "2", text: "Connect the evidence to the claim" },
    ]);
    expect(enriched.slides[0].visual.diagram?.source).toContain("-->");
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

  it("always rasterizes a small SVG instead of storing it under a raster MIME type", async () => {
    const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#24104f"/><circle cx="600" cy="337" r="120" fill="#f4b942"/></svg>');
    const processed = await processPresentationImage(source, {
      contentType: "image/svg+xml",
      maxBytes: 100_000,
      maxWidth: 960,
      maxHeight: 540,
    });

    expect(processed.contentType).not.toBe("image/svg+xml");
    expect(["image/jpeg", "image/png"]).toContain(processed.contentType);
    expect(processed.extension).not.toBe("");
    expect(processed.buffer.subarray(0, 4).toString("hex")).not.toBe("3c737667");
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
