import { afterEach, describe, expect, it } from "vitest";
import { generatePresentation, selectAiProviders } from "./presentation.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("selectAiProviders", () => {
  it("falls back to configured Yandex when OpenAI is selected but missing a key", () => {
    expect(
      selectAiProviders({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "",
        YANDEX_API_KEY: "yandex-key",
        YANDEX_FOLDER_ID: "folder-id",
      }),
    ).toEqual(["yandex"]);
  });

  it("orders the requested configured provider first", () => {
    expect(
      selectAiProviders({
        AI_PROVIDER: "yandex",
        OPENAI_API_KEY: "openai-key",
        YANDEX_API_KEY: "yandex-key",
        YANDEX_FOLDER_ID: "folder-id",
      }),
    ).toEqual(["yandex", "openai"]);
  });
});

describe("generatePresentation fallback behavior", () => {
  it("reads Yandex completion text from result alternatives", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            alternatives: [
              {
                message: {
                  text: JSON.stringify({
                    title: "Russian cinema",
                    slides: [{ title: "Intro", blocks: [{ type: "bullets", items: ["A real generated point"] }] }],
                    speechScript: [{ slideOrder: 1, slideTitle: "Intro", text: "This is a longer narration for the slide." }],
                  }),
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Russian cinema",
          prompt: "Create a presentation about Russian cinema",
          scenario: "school_report",
          level: "8-11",
          mode: "with_sources",
          slideCount: 1,
        },
        [
          {
            id: "web-1",
            label: "Source",
            type: "WEB",
            size: 0,
            excerpt: "A source excerpt about Russian cinema.",
          },
        ],
      );

      expect(presentation.generationMode).toBe("yandex");
      expect(presentation.slides[0].blocks[0]).toEqual({ type: "callout", content: "A real generated point" });
      expect(presentation.speechScript[0].text).toBe("This is a longer narration for the slide.");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses slide speaker notes as the narration fallback for each concrete slide", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            alternatives: [
              {
                message: {
                  text: JSON.stringify({
                    title: "Русское кино после 2010 года",
                    slides: [
                      {
                        title: "Новая волна российского кино",
                        blocks: [
                          {
                            type: "callout",
                            content:
                              "Русское кино после 2010 года стало более разнообразным: рядом с авторскими драмами появились кассовые франшизы и онлайн-премьеры.",
                          },
                        ],
                        speakerNotes:
                          "Русское кино после 2010 года - это современное кино, которое отличается от старого кино новыми темами, технологиями и способом просмотра.",
                      },
                    ],
                  }),
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино после 2010 года",
          prompt: "Сделай презентацию про русское кино после 2010 года",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );

      expect(presentation.speechScript[0].text).toBe(
        "Русское кино после 2010 года - это современное кино, которое отличается от старого кино новыми темами, технологиями и способом просмотра.",
      );
      expect(presentation.speechScript[0].text).not.toContain("Добавлю несколько деталей");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs repeated generic slide titles from the generated outline", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            alternatives: [
              {
                message: {
                  text: JSON.stringify({
                    title: "Русское кино после 2010 года",
                    outline: ["Русское кино после 2010 года", "Онлайн-платформы", "Новые жанры"],
                    slides: [
                      { title: "Введение", blocks: [{ type: "callout", content: "Короткое вступление." }] },
                      { title: "Введение", blocks: [{ type: "callout", content: "Появились онлайн-премьеры." }] },
                      { title: "Введение", blocks: [{ type: "callout", content: "Жанры стали разнообразнее." }] },
                    ],
                    speechScript: [
                      { slideOrder: 1, slideTitle: "Введение", text: "Первый рассказ." },
                      { slideOrder: 2, slideTitle: "Введение", text: "Второй рассказ." },
                      { slideOrder: 3, slideTitle: "Введение", text: "Третий рассказ." },
                    ],
                  }),
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино после 2010 года",
          prompt: "Сделай презентацию про русское кино после 2010 года",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [],
      );

      expect(presentation.slides.map((slide) => slide.title)).toEqual([
        "Русское кино после 2010 года",
        "Онлайн-платформы",
        "Новые жанры",
      ]);
      expect(presentation.speechScript.map((item) => item.slideTitle)).toEqual([
        "Русское кино после 2010 года",
        "Онлайн-платформы",
        "Новые жанры",
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws instead of creating demo slides when no AI provider is configured", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    await expect(
      generatePresentation(
        {
          id: "project-1",
          title: "Русское кино после 2010 года",
          prompt: "Сделай презентацию про русское кино начиная с 2010 года",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 4,
        },
        [],
      ),
    ).rejects.toThrow("No configured AI provider");
  });

  it("does not put placeholder instructions into dev demo slides", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-1",
        title: "Русское кино после 2010 года",
        prompt: "Сделай презентацию про русское кино начиная с 2010 года",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 4,
      },
      [
        {
          id: "web-1",
          label: "Источник о российском кино",
          type: "WEB",
          size: 0,
          excerpt: "После 2010 года российское кино развивалось через фестивальные драмы, успешные франшизы и новые онлайн-платформы.",
          url: "https://example.com/cinema",
        },
      ],
    );

    const visibleText = visiblePresentationText(presentation);
    expect(visibleText).not.toContain("Тезис нужно объяснить");
    expect(visibleText).not.toContain("Проверьте");
    expect(visibleText).not.toContain("Добавьте источник");
    expect(visibleText.toLowerCase()).not.toContain("источник");
    expect(presentation.slides.every((slide) => slide.blocks.length === 1 && slide.blocks[0].type === "callout")).toBe(true);
    expect(presentation.slides[0].blocks[0].type === "callout" ? presentation.slides[0].blocks[0].content.length : 999).toBeLessThan(240);
    expect(presentation.speechScript[0].text.length).toBeGreaterThan(
      presentation.slides[0].blocks[0].type === "callout" ? presentation.slides[0].blocks[0].content.length : 0,
    );
  });
});

function visiblePresentationText(presentation: Awaited<ReturnType<typeof generatePresentation>>) {
  return [
    presentation.title,
    ...presentation.slides.flatMap((slide) => [
      slide.title,
      slide.speakerNotes,
      ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
    ]),
    ...presentation.speechScript.flatMap((item) => [item.slideTitle, item.text]),
  ].join("\n");
}
