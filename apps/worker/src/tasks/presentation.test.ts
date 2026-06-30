import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { presentationSchema } from "@studydeck/shared";
import {
  buildGenerationPrompt,
  findSlideTextIssues,
  generateNarrationDraft,
  generatePresentation,
  generatePresentationFromNarration,
  generateStructuredWithProvider,
  inferContentLayout,
  normalizeLayout,
  normalizeNarrativePlan,
  selectAiProviders,
} from "./presentation.js";

const originalEnv = { ...process.env };
const forbiddenNarrationFragments = [
  'Слайд "',
  "объясняет часть темы",
  "опорные пункты",
  "Затем стоит показать связь",
  "После этого можно закрепить",
  "основной смысл раскрывается",
  "рассказе про",
  "Примеры. Поэтому",
  "Так становится понятнее, почему тема",
  "важна именно в этой части рассказа",
  "Связь с разделом",
  "помогает слушателю увидеть не только событие",
  "увидеть не только событие, но и его значение",
  "Без этого уточнения дальнейший вывод",
  "Дальше раздел",
  "продолжает тему",
  "Сначала важно удержать конкретную мысль",
  "Следующая деталь добавляет к объяснению",
  "новый шаг",
  "Этот шаг подводит рассказ",
  "к следующей части",
  "оставляет место для следующей мысли",
  "готовит переход дальше",
  "Это проявляется в том, что",
  "Причина такого вывода в том",
  "Последствия заметны там, где",
  "поэтому итог звучит так",
  "становится главным итогом выступления",
  "Главная мысль",
  "общая мысль",
  "Пример нужен",
  "вся история темы",
  "текст на слайде",
  "следующий раздел",
  "следующая часть",
  "переход к следующему",
];
const forbiddenSlideTextFragments = [
  "Главная идея связана с темой",
  "Материал стоит разбирать",
  "смысловым частым",
  "смысловым частям",
  "Ключевые понятия помогают удержать структуру",
  "Пример или визуальная схема",
  "На слайде показано",
  "Этот слайд помогает",
  "Этот раздел объясняет",
  "Здесь собраны основные факты",
  "на картинке",
  "на изображении",
  "как показано на картинке",
];

afterEach(() => {
  process.env = { ...originalEnv };
});

function yandexTextResponse(text: string) {
  return new Response(
    JSON.stringify({
      result: {
        alternatives: [{ message: { text } }],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function narrativePlanForTitles(titles: string[]) {
  return titles.map((title, index) => ({
    slideOrder: index + 1,
    slideTitle: title,
    slidePurpose: index === 0 ? "Открыть тему выступления через понятный контекст." : "Раскрыть следующий смысловой шаг выступления.",
    keyMessage: `${title} помогает понять главную логику темы.`,
    audienceQuestion: `Что важно понять про ${title}?`,
    transitionToNext: index === titles.length - 1 ? "" : "После этой мысли логично уточнить следующий аспект темы.",
  }));
}

function designBriefForTitles(titles: string[]) {
  return {
    themeId: "editorialMagazine",
    mood: "serious",
    audienceFit: "A clear editorial study deck for the requested audience.",
    visualMetaphor: "A guided sequence of evidence and conclusions.",
    colorIntent: "High contrast with one restrained accent.",
    typographyIntent: "Editorial headings with readable supporting text.",
    rhythm: {
      titleStyle: "editorial",
      density: "medium",
      imageFrequency: "balanced",
      sectionBreaks: true,
    },
    slideDirections: titles.map((title, index) => ({
      slideOrder: index + 1,
      visualRole: index === 0 ? "hero" : index === titles.length - 1 ? "summary" : "explain",
      layoutIntent: index === 0 ? "full_bleed_image" : index === titles.length - 1 ? "summary" : "cards",
      imageStrategy: index === 0 ? "real_photo" : "diagram",
      visualPrompt: `Editorial visual for ${title}`,
    })),
  };
}

function mockYandexTwoStep(narrationText: string, json: unknown, bodies?: unknown[], repairJson?: unknown) {
  let callCount = 0;
  const titles = narrationText
    .split("\n")
    .map((line) => line.match(/^РЎР»Р°Р№Рґ\s+\d+\s*:\s*(.+)$/i)?.[1])
    .filter((title): title is string => Boolean(title));
  const narrativePlan = narrativePlanForTitles(titles.length ? titles : ["Intro"]);
  global.fetch = async (_input, init) => {
    bodies?.push(JSON.parse(String(init?.body || "{}")));
    callCount += 1;
    if (callCount === 1) return yandexTextResponse(JSON.stringify(narrativePlan));
    if (callCount === 2) return yandexTextResponse(narrationText);
    if (callCount === 3) return yandexTextResponse(JSON.stringify(designBriefForTitles(narrativePlan.map((item) => item.slideTitle))));
    return yandexTextResponse(JSON.stringify(callCount === 4 || repairJson === undefined ? json : repairJson));
  };
}

function narrationForSlides(titles: string[]) {
  const details = [
    ["контекст", "пример", "вывод"],
    ["причина", "изменение", "последствие"],
    ["сравнение", "граница", "результат"],
    ["этап", "действие", "проверка"],
    ["качество", "связь", "решение"],
    ["история", "поворот", "оценка"],
  ];
  const endings = [
    "В конце этой мысли становится ясно, почему тема звучит убедительно.",
    "Такой вывод показывает реальное значение этой части истории.",
    "Именно поэтому этот материал остается важным для общего понимания.",
    "В результате слушатель видит не набор фактов, а понятную картину.",
    "Так раскрывается практический смысл этой темы для выступления.",
    "Эта мысль завершает объяснение спокойно и без лишних общих слов.",
  ];
  return titles
    .map((title, index) => {
      const [first, second, third] = details[index % details.length];
      return [
        `Слайд ${index + 1}: ${title}`,
        `${title} раскрывает ${first}, который задает направление всему объяснению. Затем появляется ${second}, потому что без него слушателю трудно увидеть развитие мысли. Конкретный ${third} показывает, чем эта часть отличается по смыслу. Важная деталь делает название "${title}" частью реального содержания. ${endings[index % endings.length]}`,
      ].join("\n");
    })
    .join("\n\n");
}

function overlongNarrationForSlides(titles: string[]) {
  return titles
    .map((title, index) => {
      const order = index + 1;
      const body = [
        "This slide repeats the same weak opening formula before the real content starts.",
        `${title} has a concrete first point for the study report number ${order}.`,
        `${title} gives the listener a useful example that belongs to this exact topic.`,
        `${title} explains one cause without copying the original user request.`,
        `${title} adds a consequence that makes the section more specific.`,
        `${title} names a practical detail that can become short screen text.`,
        `${title} keeps the narration focused on the subject instead of the deck structure.`,
        `${title} includes another useful fact so the repair has enough material.`,
        `${title} shows why the topic matters for the final explanation.`,
        "The main takeaway of the topic is repeated as a generic ending.",
        "This slide repeats the same weak opening formula before the real content starts.",
        "The main takeaway of the topic is repeated as a generic ending.",
      ];
      return `\u0421\u043b\u0430\u0439\u0434 ${order}: ${title}\n${body.join(" ")}`;
    })
    .join("\n\n");
}

function weakOverlongNarrationForSlides(titles: string[]) {
  return titles
    .map((title, index) => {
      const order = index + 1;
      const body = [
        "This slide repeats the same weak opening formula before the real content starts.",
        `${title} has one concrete point for the study report number ${order}.`,
        `${title} gives one useful example that belongs to this exact topic.`,
        `${title} explains one cause without copying the original user request.`,
        `${title} adds one consequence that makes the section more specific.`,
        "Create a presentation about narration repair.",
        "The main takeaway of the topic is repeated as a generic ending.",
        "This slide repeats the same weak opening formula before the real content starts.",
        "The main takeaway of the topic is repeated as a generic ending.",
      ];
      return `\u0421\u043b\u0430\u0439\u0434 ${order}: ${title}\n${body.join(" ")}`;
    })
    .join("\n\n");
}

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

describe("buildGenerationPrompt", () => {
  it("describes structured slides and visual selection rules", () => {
    const prompt = buildGenerationPrompt(
      {
        id: "project-1",
        title: "Learning topic",
        prompt: "Explain a process and compare two concepts",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 6,
      },
      [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Grounding material." }],
    );

    expect(prompt).toContain("slideKind title");
    expect(prompt).toContain("slideKind summary");
    expect(prompt).toContain("layout must be one of");
    expect(prompt).not.toContain("question-answer");
    expect(prompt).not.toContain("case-study");
    expect(prompt).not.toContain("myth-fact");
    expect(prompt).not.toContain("two-column");
    expect(prompt).toContain("3-5 dated or named periods");
    expect(prompt).not.toContain("criterion in visual.rows[].label");
    expect(prompt).not.toContain("bullets contain 2-3 supporting parts");
    expect(prompt).not.toContain("problem-solution");
    expect(prompt).not.toContain("layout must be one of: hero, bullets, summary, statement, quote, definition");
    expect(prompt).not.toContain("layout must be one of: hero, bullets");
    expect(prompt).not.toContain("use evidence for");
    expect(prompt).not.toContain("use explain-example for");
    expect(prompt).toContain("never turn list order into a metric");
    expect(prompt).toContain("do not use the same content layout more than twice in a row");
    expect(prompt).toContain("one clear thesis plus 2-3 short meaningful points");
    expect(prompt).toContain("semantic and memorable");
    expect(prompt).toContain("keyConcepts: return an empty array");
    expect(prompt).toContain("highlights: return an empty array");
    expect(prompt).toContain("5-6 sentence");
    expect(prompt).toContain("generatedText");
    expect(prompt).toContain("Do not generate a separate second story");
    expect(prompt).toContain("Do not write long text blocks");
    expect(prompt).toContain("must be a complete thought");
    expect(prompt).toContain("every slide, including title, section, and summary slides, must include visual.description");
    expect(prompt).toContain("set visual.type to image or illustration");
    expect(prompt).toContain("never fill visual.title, visual.items, or visual.rows with generic placeholder text");
    expect(prompt).toContain("process_diagram");
    expect(prompt).toContain("comparison_diagram");
    expect(prompt).toContain("mind_map");
    expect(prompt).toContain("visual.description must describe a concrete, searchable image");
    expect(prompt).toContain("do not put URLs");
    expect(prompt).toContain("Do not invent precise facts");
    expect(prompt).toContain("Visual theme rules");
    expect(prompt).toContain("preset=");
    expect(prompt).toContain("do not invent CSS");
  });

  it("carries the student-only creation brief into the generation prompt", () => {
    const project = {
      id: "project-student",
      title: "AI in higher education",
      prompt: "Create a university seminar presentation about AI in higher education.",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 8,
    };
    const prompt = buildGenerationPrompt(project, []);

    expect(prompt).toContain("university_student");
    expect(prompt).toContain("easy_professional");
    expect(prompt).toContain("brief_slides_full_speech");
    expect(prompt).toContain("images_and_diagrams");
    expect(prompt).toContain("web_and_pptx_pdf");
    expect(prompt).toContain("short beautiful slides");
    expect(prompt).toContain("full explanation in speakerNotes and speechScript");
  });
});

describe("structured generation helper", () => {
  it("uses strict OpenAI json schema for small structured artifacts", async () => {
    const calls: any[] = [];
    const client = {
      responses: {
        create: async (body: any) => {
          calls.push(body);
          return { output_parsed: { title: "РџР»Р°РЅ", summary: "РљРѕСЂРѕС‚РєРёР№ СЂСѓСЃСЃРєРёР№ РІС‹РІРѕРґ." } };
        },
      },
    };

    const result = await generateStructuredWithProvider({
      provider: "openai",
      system: "Return JSON only.",
      prompt: "Create a short brief.",
      schemaName: "studydeck_test_brief",
      schema: z.object({ title: z.string(), summary: z.string() }),
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
      openAIClient: client as any,
    });

    expect(result.title).toBe("РџР»Р°РЅ");
    expect(calls[0].text.format).toMatchObject({
      type: "json_schema",
      name: "studydeck_test_brief",
      strict: true,
    });
    expect(calls[0].input[1].content).toContain("Return only JSON");
  });

  it("repairs invalid JSON once and keeps Zod as the final validation gate", async () => {
    const calls: any[] = [];
    const client = {
      responses: {
        create: async (body: any) => {
          calls.push(body);
          return calls.length === 1
            ? { output_text: "{ bad json" }
            : { output_text: JSON.stringify({ title: "РџР»Р°РЅ", summary: "РСЃРїСЂР°РІР»РµРЅРЅС‹Р№ РІС‹РІРѕРґ." }) };
        },
      },
    };

    const result = await generateStructuredWithProvider({
      provider: "openai",
      system: "Return JSON only.",
      prompt: "Create a short brief.",
      schemaName: "studydeck_test_brief",
      schema: z.object({ title: z.string(), summary: z.string() }),
      parse: (value) => (typeof value === "string" ? JSON.parse(value) : value),
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
      openAIClient: client as any,
    });

    expect(result.summary).toContain("РСЃРїСЂР°РІ");
    expect(calls).toHaveLength(2);
    expect(calls[1].input[1].content).toContain("previous response was not valid JSON");
  });

  it("uses generic Yandex json_object when no JSON schema is provided", async () => {
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return yandexTextResponse(JSON.stringify({ title: "РџР»Р°РЅ" }));
    };

    try {
      await generateStructuredWithProvider({
        provider: "yandex",
        system: "Return JSON only.",
        prompt: "Create a short object.",
        schemaName: "studydeck_generic_json",
        schema: z.object({ title: z.string() }),
        parse: (value) => (typeof value === "string" ? JSON.parse(value) : value),
        yandexApiKey: "yandex-key",
      });

      expect(bodies[0].json_object).toBe(true);
      expect(bodies[0].json_schema).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("falls back to Yandex json_object when a schema allows additional properties", async () => {
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return yandexTextResponse(JSON.stringify({ title: "Plan", extra: "allowed" }));
    };

    try {
      await generateStructuredWithProvider({
        provider: "yandex",
        system: "Return JSON only.",
        prompt: "Create a short object.",
        schemaName: "studydeck_open_json",
        schema: z.object({ title: z.string() }).passthrough(),
        parse: (value) => (typeof value === "string" ? JSON.parse(value) : value),
        jsonSchema: {
          type: "object",
          additionalProperties: true,
          properties: { title: { type: "string" } },
        },
        yandexApiKey: "yandex-key",
      });

      expect(bodies[0].json_object).toBe(true);
      expect(bodies[0].json_schema).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("slide-facing text quality", () => {
  it("flags visible bullets that end as unfinished predicate phrases", () => {
    const issues = findSlideTextIssues({
      slides: [
        {
          order: 2,
          title: "Что стоит понять сначала",
          thesis: "РКСИ имеет богатую историю и традиции.",
          bullets: ["Первое что стоит отметить это богатая"],
          blocks: [],
          definition: null,
          visual: { title: "", items: [], rows: [], leftLabel: "", rightLabel: "" },
          speakerNotes: "РКСИ имеет богатую историю и традиции. Колледж прошел долгий путь развития. Его девиз помогает понять отношение к образованию. Эта мысль важна для вступления. Так слушатель видит основу темы.",
        },
      ],
    } as any);

    expect(issues).toEqual([
      {
        slideOrder: 2,
        fields: ["bullets.0"],
        reasons: ["sentence fragment"],
      },
    ]);
  });
});

describe("layout normalization", () => {
  const base = {
    title: "Почему меняется результат",
    thesis: "Проблема возникает из-за неверного способа, а решение требует проверки.",
    bullets: ["Проблема мешает получить результат", "Причина связана с исходными данными", "Решение начинается с проверки"],
    definition: null,
    visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
    blocks: [],
    sourceRefs: [],
  } as any;

  it("selects supported layouts without returning removed templates", () => {
    expect(inferContentLayout(base, 2)).not.toBe("problem-solution");
    expect(Array.from({ length: 12 }, (_, index) => inferContentLayout(base, index + 2))).not.toContain("case-study");
    expect(inferContentLayout({ ...base, thesis: "Тезис подтверждают несколько фактов.", bullets: ["Факт один", "Факт два"], sourceRefs: [{ sourceId: "s", label: "Источник", excerpt: "Факт", page: null }] }, 3)).not.toBe("evidence");
    expect(inferContentLayout({ ...base, title: "Что такое фотосинтез", thesis: "Это процесс преобразования света.", bullets: ["Например, растение использует солнечный свет"], definition: { term: "Фотосинтез", text: "Преобразование энергии света." } }, 4)).not.toBe("explain-example");
  });

  it("does not keep metrics when the slide has no measurable values", () => {
    expect(normalizeLayout("metrics", 2, 5, "content", { ...base, thesis: "Качественное изменение без чисел." })).not.toBe("metrics");
  });

  it("does not normalize removed comparison templates for new generation", () => {
    const comparison = {
      ...base,
      visual: {
        ...base.visual,
        type: "comparison_diagram",
        leftLabel: "Первый подход",
        rightLabel: "Второй подход",
        rows: [
          { label: "Скорость", left: "Быстро", right: "Медленно" },
          { label: "Точность", left: "Средняя", right: "Высокая" },
        ],
      },
    };

    expect(normalizeLayout("two-column", 2, 5, "content", comparison)).not.toBe("comparison");
    expect(normalizeLayout("comparison", 2, 5, "content", base)).not.toBe("comparison");
    expect(normalizeLayout("case-study", 2, 5, "content", base)).not.toBe("case-study");
  });

  it("rejects sparse sequence, question-answer, and myth-fact layouts", () => {
    expect(normalizeLayout("process", 2, 6, "content", base)).not.toBe("process");
    expect(normalizeLayout("timeline", 2, 6, "content", base)).not.toBe("timeline");
    expect(normalizeLayout("question-answer", 2, 6, "content", { ...base, title: "Почему это важно?", bullets: [] })).not.toBe("question-answer");
    expect(normalizeLayout("myth-fact", 2, 6, "content", base)).not.toBe("myth-fact");
  });
});

describe("normalizeNarrativePlan", () => {
  it("repairs plan length, order, generic fields, and final transition", () => {
    const plan = normalizeNarrativePlan(
      [
        {
          slideOrder: 99,
          slideTitle: "Ключевые факты",
          slidePurpose: "",
          keyMessage: "AI changes how lessons are prepared.",
          audienceQuestion: "How does AI change lesson prep?",
          transitionToNext: "Перейдем к следующему слайду.",
        },
      ],
      {
        id: "project-1",
        title: "AI in education",
        prompt: "Explain how AI changes education",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 3,
      },
    );

    expect(plan).toHaveLength(3);
    expect(plan.map((item) => item.slideOrder)).toEqual([1, 2, 3]);
    expect(plan[0].slideTitle).not.toBe("Ключевые факты");
    expect(plan[0].transitionToNext).toBeTruthy();
    expect(plan[2].transitionToNext).toBe("");
  });
});

describe("generatePresentation fallback behavior", () => {
  it("creates an editable narration draft before deck generation", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const draft = await generateNarrationDraft(
      {
        id: "project-script",
        title: "Экология города",
        prompt: "Сделай презентацию про экологию города",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 4,
      },
      [{ id: "src-1", label: "Prompt", type: "PROMPT", excerpt: "Городская экология зависит от воздуха, транспорта и поведения жителей." }],
    );

    expect(draft.generationMode).toBe("demo");
    expect(draft.text.match(/Слайд\s+\d+\s*:/g)).toHaveLength(4);
    expect(draft.narrativePlan).toHaveLength(4);
  });

  it("builds the final presentation from the accepted narration text", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const acceptedNarration = [
      "Слайд 1: Городской воздух",
      "Городской воздух меняется из-за транспорта и плотной застройки. Машины создают выхлопы, которые особенно заметны рядом с крупными дорогами. Зеленые зоны помогают удерживать пыль и делают улицы комфортнее. Жителям важно понимать, что качество воздуха зависит не только от заводов. Поэтому экологичный транспорт становится частью повседневной заботы о городе.",
      "",
      "Слайд 2: Практичный вывод",
      "Экология города складывается из решений власти, бизнеса и самих жителей. Если люди чаще выбирают общественный транспорт, нагрузка на воздух становится меньше. Раздельный сбор помогает не превращать полезные материалы в лишний мусор. Небольшие привычки работают сильнее, когда их поддерживает много людей. Главный вывод в том, что чистый город начинается с понятных ежедневных действий.",
    ].join("\n");

    const presentation = await generatePresentationFromNarration(
      {
        id: "project-script",
        title: "Экология города",
        prompt: "Сделай презентацию про экологию города",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 2,
      },
      [{ id: "src-1", label: "Prompt", type: "PROMPT", excerpt: "Городская экология зависит от воздуха, транспорта и поведения жителей." }],
      acceptedNarration,
    );

    expect(presentation.generatedText).toContain("Городской воздух меняется из-за транспорта");
    expect(presentation.slides[0].speakerNotes).toContain("Городской воздух меняется из-за транспорта");
    expect(presentation.speechScript[0].text).toContain("Городской воздух меняется из-за транспорта");
    expect(presentation.slides).toHaveLength(2);
  });

  it("stores a deterministic dark theme for heavy topics in demo generation", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-theme",
        title: "Война и катастрофа",
        prompt: "Сделай презентацию про войну, трагедию и кризис",
        scenario: "school_report",
        level: "8 класс",
        mode: "fast_draft",
        slideCount: 4,
      },
      [{ id: "src-1", label: "Prompt", type: "PROMPT", excerpt: "Материал о тяжелой теме." }],
    );

    expect(presentation.presentationTheme?.preset).toBe("moody");
    expect(presentation.presentationTheme?.mood).toBe("dark");
  });

  it("builds one directed scene per slide without triple layout repetition", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-visual-rhythm",
        title: "Artificial intelligence in universities",
        prompt: "Explain the context, evidence, risks, comparison, and practical conclusion for university students.",
        scenario: "university_report",
        level: "university_student",
        mode: "with_sources",
        slideCount: 7,
      },
      [{ id: "source-1", label: "Research", type: "WEB", excerpt: "Evidence about adoption, risks, and outcomes." }],
    );

    const directions = presentation.designBrief?.slideDirections || [];
    expect(directions).toHaveLength(7);
    expect(directions[0]?.visualRole).toBe("hero");
    expect(directions.at(-1)?.visualRole).toBe("summary");
    for (let index = 2; index < directions.length; index += 1) {
      expect(new Set(directions.slice(index - 2, index + 1).map((item) => item.layoutIntent)).size).toBeGreaterThan(1);
    }
  });

  it("accepts a human study-story deck with semantic titles and concrete details", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: За фасадом успеха",
      "Я расскажу о книге «Волк с Уолл-стрит» Джордана Белфорта. На первый взгляд это история большого успеха, где есть деньги, карьера и громкое имя. Но за роскошью постепенно раскрываются обман, зависимость и потеря контроля. Поэтому книга воспринимается не как простая история богатства, а как рассказ о цене быстрых амбиций. Такой заход помогает сразу увидеть конфликт между внешним успехом и внутренним разрушением.",
      "",
      "Слайд 2: Stratton Oakmont и падение",
      "Stratton Oakmont становится символом агрессивных продаж и давления на клиентов. Компания быстро растет, а Белфорт зарабатывает огромные деньги. Но вместе с ростом усиливается ощущение безнаказанности и желание идти дальше. Чем выше он поднимается, тем чаще нарушает закон и рискует чужими деньгами. В итоге успех компании превращается в причину расследования и личного падения.",
      "",
      "Слайд 3: Главные уроки книги",
      "Для меня эта книга - не пример для повторения, а предупреждение. Она показывает, что успех без честности и ответственности быстро превращается в проблему. Белфорт умел говорить, убеждать и вести за собой людей, но использовал эти качества неправильно. Харизма и амбиции полезны только тогда, когда у человека есть принципы. Главный вывод в том, что контролировать нужно не других, а прежде всего самого себя.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "За фасадом успеха",
      generatedText: presentationText,
      outline: ["За фасадом успеха", "Stratton Oakmont и падение", "Главные уроки книги"],
      slides: [
        {
          title: "За фасадом успеха",
          thesis: "История Белфорта показывает цену успеха без контроля.",
          blocks: [{ type: "callout", content: "За деньгами и роскошью скрывались обман, зависимость и потеря контроля." }],
        },
        {
          title: "Stratton Oakmont и падение",
          thesis: "Stratton Oakmont стала символом агрессивных продаж и давления на клиентов.",
          bullets: ["Компания быстро росла", "Белфорт нарушал закон", "Расследование привело к ответственности"],
        },
        {
          title: "Главные уроки книги",
          thesis: "Успех без честности быстро превращается в проблему.",
          bullets: ["Нужны принципы", "Важна ответственность", "Харизма требует самоконтроля"],
        },
      ],
      speechScript: [],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "За фасадом успеха",
          prompt: "Сделай презентацию о книге Волк с Уолл-стрит",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [{ id: "src-1", label: "Книга", type: "WEB", size: 0, excerpt: "Белфорт, Stratton Oakmont, агрессивные продажи, расследование и ответственность." }],
      );

      expect(presentation.generatedText).toBe(presentationText);
      expect(presentation.narrativePlan).toHaveLength(3);
      expect(presentation.narrativePlan[2].transitionToNext).toBe("");
      expect(presentation.slides).toHaveLength(3);
      expect(presentation.designBrief?.slideDirections).toHaveLength(3);
      expect(presentation.slides[1].layout).toBe("statement");
      expect(presentation.slides.every((slide) => slide.speakerNotes)).toBe(true);
      expect(presentation.speechScript).toHaveLength(3);
      expect(presentation.slides.map((slide) => slide.title)).toEqual([
        "За фасадом успеха",
        "Stratton Oakmont и падение",
        "Главные уроки книги",
      ]);
      expect(presentation.speechScript[2].text).toContain("не пример для повторения");
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs the repeated template text from the bad neural output", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badText = [
      "Слайд 1: Телефоны Samsung",
      "Телефоны Samsung открывает тему Телефоны Samsung через общий разговор без настоящего содержания. Главный акцент здесь в том, что телефоны Samsung нужно раскрыть через конкретные факты. Эта часть подводит к следующему фрагменту без резкого перехода. Пользовательский запрос повторяется вместо нормального объяснения. Поэтому рассказ не отвечает на тему, а только имитирует структуру.",
      "",
      "Слайд 2: Контекст и актуальность",
      "Контекст и актуальность продолжает разговор о теме и уточняет главное без фактов. В этой части нужно выделить конкретные факты по теме, но они не названы. Главный акцент здесь снова связан только с формулировкой запроса. Такая речь не дает слушателю новой информации о телефонах. В итоге текст остается шаблоном вместо выступления.",
      "",
      "Слайд 3: Ключевые факты",
      "Ключевые факты продолжает разговор о теме и снова не называет факты. Основной смысл раскрывается через обещание рассказать о Samsung позже. Текст на слайде оставляет только опорные пункты без реального объяснения. Главный акцент здесь повторяет название темы и не развивает мысль. Поэтому такой ответ должен быть отклонен как шаблонный.",
    ].join("\n");
    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse(badText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Телефоны Samsung",
          prompt: "Сделай презентацию про телефоны Samsung",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [{ id: "src-1", label: "Samsung", type: "WEB", size: 0, excerpt: "Материал о линейке Samsung Galaxy." }],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects empty AI output instead of creating production fallback slides", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse("");

    try {
      await expect(
        generatePresentation(
          {
            id: "project-1",
            title: "Пустой ответ",
            prompt: "Сделай презентацию про пустой ответ модели",
            scenario: "lesson",
            level: "beginner",
            mode: "with_sources",
            slideCount: 4,
          },
          [{ id: "src-1", label: "Материал", type: "WEB", size: 0, excerpt: "Нужен полноценный текст." }],
        ),
      ).rejects.toThrow("did not include text");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("runs Yandex speech-first generation and builds slides from generatedText", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: За фасадом успеха",
      "Я расскажу о том, как внешний успех может скрывать потерю контроля. В начале важно увидеть не только деньги и статус, но и цену, которую человек платит за быстрый рост. Такой заход задает тему всей презентации. Он помогает перейти к причинам и последствиям без резкого скачка. Поэтому первый фрагмент сразу показывает личную цену быстрого роста.",
      "",
      "Слайд 2: Главный вывод",
      "В финале эта история становится предупреждением. Успех без честности быстро превращается в проблему. Харизма и амбиции полезны только тогда, когда у человека есть принципы. Поэтому главный вывод связан с ответственностью за собственные решения. Такой итог помогает не повторять чужие ошибки.",
    ].join("\n");
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    mockYandexTwoStep(
      presentationText,
      {
        title: "За фасадом успеха",
        generatedText: presentationText,
        outline: ["За фасадом успеха", "Главный вывод"],
        slides: [
          {
            title: "За фасадом успеха",
            thesis: "Внешний успех может скрывать потерю контроля.",
            blocks: [{ type: "callout", content: "За деньгами и статусом может стоять высокая личная цена." }],
          },
          {
            title: "Главный вывод",
            thesis: "Успех без честности быстро превращается в проблему.",
            bullets: ["Нужны принципы", "Важна ответственность", "Амбиции требуют контроля"],
          },
        ],
        speechScript: [],
      },
      bodies,
    );

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "За фасадом успеха",
          prompt: "Сделай презентацию о цене быстрого успеха",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "A story about success and responsibility." }],
      );

      expect(bodies).toHaveLength(4);
      expect(bodies[0].json_schema?.schema).toBeTruthy();
      expect(bodies[0].messages[1].text).toContain("narrativePlan");
      expect(bodies[1].json_object).toBeUndefined();
      expect(bodies[1].messages[1].text).toContain("Narrative plan to follow exactly");
      expect(bodies[1].messages[1].text).toContain("exactly 5-6 complete sentences");
      expect(bodies[2].json_schema?.schema).toBeTruthy();
      expect(bodies[2].messages[1].text).toContain("Deck story");
      expect(bodies[2].messages[1].text).toContain("Slide text plans");
      expect(bodies[2].messages[1].text).toContain("Do not output raw CSS");
      expect(bodies[3].json_object).toBe(true);
      expect(bodies[3].json_schema).toBeUndefined();
      expect(bodies[3].messages[1].text).toContain(presentationText);
      expect(bodies[3].messages[1].text).toContain("only source of truth");
      expect(bodies[3].messages[1].text).toContain("narrativePlan");
      expect(bodies[3].messages[1].text).toContain("researchBrief");
      expect(bodies[3].messages[1].text).toContain("designBrief");
      expect(bodies[3].messages[1].text).toContain("slideBlueprints");
      expect(presentation.generatedText).toBe(presentationText);
      expect(presentation.designBrief?.slideDirections).toHaveLength(2);
      expect(presentation.designBrief?.slideDirections[0].imageStrategy).toBe("real_photo");
      expect(presentation.presentationTheme?.themeId).toBe("editorialMagazine");
      expect(presentation.slides[0].thesis).toContain("Внешний успех");
      expect(presentation.slides[1].bullets).toContain("Нужны принципы");
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("accepts numbered Yandex narration sections and normalizes them for review", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const numberedNarration = [
      "### 1. Главная волна девяностых",
      "Русские песни девяностых часто звучали как дневник времени, в котором смешивались свобода, тревога и надежда. После распада СССР музыкальный рынок быстро менялся, и новые группы получили возможность говорить с аудиторией напрямую. Популярная музыка стала ближе к повседневной жизни, потому что в ней слышались дворы, кассеты, телепередачи и первые коммерческие радиостанции. Для слушателей эти песни были не только развлечением, но и способом узнать собственные переживания. Поэтому разговор о девяностых начинается с ощущения резкой перемены, которая вошла в музыку.",
      "",
      "**2) Память и вывод**",
      "Сегодня песни девяностых воспринимаются как культурная память о сложном десятилетии. Одни композиции напоминают о романтике свободы, другие сохраняют чувство неустойчивости и поиска. Важным стало то, что разные жанры существовали рядом: рок, поп, танцевальная музыка и авторская интонация спорили за внимание слушателя. Такое разнообразие показывает, что эпоха не сводилась к одному настроению или одному стилю. В итоге музыка девяностых осталась узнаваемой, потому что передала голос людей на переломе истории.",
    ].join("\n");
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return yandexTextResponse(
          JSON.stringify(narrativePlanForTitles(["Главная волна девяностых", "Память и вывод"])),
        );
      }
      return yandexTextResponse(numberedNarration);
    };

    try {
      const draft = await generateNarrationDraft(
        {
          id: "project-1",
          title: "Русские песни 90 х",
          prompt: "Сделай презентацию про русские песни 90 х",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Prompt", type: "PROMPT", size: 0, excerpt: "Русская музыка девяностых отражала перемены общества." }],
      );

      expect(draft.text.match(/Слайд\s+\d+\s*:/g)).toHaveLength(2);
      expect(draft.text).toContain("Слайд 1: Главная волна девяностых");
      expect(draft.text).toContain("Слайд 2: Память и вывод");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs short Yandex narration sections before building JSON", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const shortText = [
      "Слайд 1: За фасадом успеха",
      "История начинается с внешнего успеха. Но за ним быстро появляется потеря контроля. Поэтому тема звучит как предупреждение.",
      "",
      "Слайд 2: Главный вывод",
      "Финал показывает цену безответственности. Успех без принципов становится проблемой.",
    ].join("\n");
    const repairedText = [
      "Слайд 1: За фасадом успеха",
      "История начинается с внешнего успеха, который выглядит ярко и убедительно. Но за этим успехом быстро появляется потеря контроля. Деньги и статус начинают менять поведение героя сильнее, чем он сам замечает. Поэтому тема звучит как предупреждение о цене быстрых побед. Эта часть открывает рассказ через контраст между блеском и внутренним разрушением.",
      "",
      "Слайд 2: Главный вывод",
      "Финал показывает, что безответственность постепенно разрушает даже сильный внешний успех. Успех без принципов становится проблемой для самого человека и для тех, кто рядом. Важен не только результат, но и способ, которым человек к нему приходит. Если путь построен на обмане, победа быстро превращается в долг и наказание. Поэтому главный вывод связан с самоконтролем, честностью и ответственностью.",
    ].join("\n");
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      callCount += 1;
      if (callCount === 1) {
        return yandexTextResponse(
          JSON.stringify(narrativePlanForTitles(["Р—Р° С„Р°СЃР°РґРѕРј СѓСЃРїРµС…Р°", "Р“Р»Р°РІРЅС‹Р№ РІС‹РІРѕРґ"])),
        );
      }
      if (callCount === 2) return yandexTextResponse(shortText);
      return yandexTextResponse(
        JSON.stringify({
          title: "За фасадом успеха",
          generatedText: repairedText,
          outline: ["За фасадом успеха", "Главный вывод"],
          slides: [
            {
              title: "За фасадом успеха",
              thesis: "Внешний успех может скрывать потерю контроля.",
              blocks: [{ type: "callout", content: "За быстрым ростом появляется личная цена." }],
            },
            {
              title: "Главный вывод",
              thesis: "Быстрый успех без принципов легко превращается в проблему.",
              bullets: ["Нужны принципы", "Важен самоконтроль", "Ответственность важнее статуса"],
            },
          ],
          speechScript: [],
        }),
      );
    };

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "За фасадом успеха",
          prompt: "Сделай презентацию о цене быстрого успеха",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "A story about success and responsibility." }],
      );

      expect(bodies).toHaveLength(4);
      expect(bodies[0].json_schema?.schema).toBeTruthy();
      expect(bodies[1].json_object).toBeUndefined();
      expect(bodies[2].json_schema?.schema).toBeTruthy();
      expect(bodies[3].json_object).toBe(true);
      expect(bodies[3].json_schema).toBeUndefined();
      expect(bodies[3].messages[1].text).toContain("only source of truth");
      expect(presentation.generatedText).not.toBe(shortText);
      expect(sentenceCount(presentation.speechScript[0].text)).toBe(5);
      expect(sentenceCount(presentation.speechScript[1].text)).toBe(5);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs narration when neighboring slides repeat the same closing sentence", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const repeatedText = [
      "Слайд 1: Начало истории",
      "История начинается с первого заметного события. Оно задает конфликт и показывает главного участника. Затем появляется причина, которая меняет ход рассказа. Поэтому слушатель видит основу дальнейших событий. Финальная мысль кратко собирает смысл этих событий.",
      "",
      "Слайд 2: Развитие конфликта",
      "Конфликт становится сильнее после нового решения героя. Это решение влияет на других участников истории. Последствия уже нельзя объяснить одной случайностью. Так рассказ переходит от завязки к более серьезной проблеме. Финальная мысль кратко собирает смысл этих событий.",
    ].join("\n");
    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse(repeatedText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "История",
          prompt: "Сделай презентацию про развитие конфликта",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Conflict story excerpt." }],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs narration when many slides repeat the same opening phrase", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const repeatedText = [
      "Слайд 1: Первые изменения",
      "Главная мысль здесь связана с тем, что кино стало разнообразнее. Онлайн-платформы изменили путь фильма к зрителю. Авторские драмы стали заметнее рядом с коммерческими проектами. Зрители начали чаще смотреть премьеры дома. Поэтому рынок стал более подвижным.",
      "",
      "Слайд 2: Новые привычки",
      "Главная мысль здесь связана с тем, что зрители стали выбирать формат просмотра свободнее. Домашние премьеры перестали быть редким исключением. Платформы начали конкурировать с кинотеатрами за внимание аудитории. Жанры стали быстрее находить своих зрителей. Поэтому привычки просмотра заметно изменились.",
      "",
      "Слайд 3: Итог",
      "Главная мысль здесь связана с тем, что индустрия стала зависеть от разных способов показа. Фестивальное кино получило новые возможности. Коммерческие проекты тоже начали активнее работать с онлайн-аудиторией. Это сделало рынок сложнее и разнообразнее. Поэтому современное кино нельзя объяснить только кинотеатрами.",
    ].join("\n");

    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse(repeatedText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("compresses overlong complete Yandex narration before final assembly", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const titles = Array.from({ length: 14 }, (_, index) => `Repair topic ${index + 1}`);
    const overlongText = overlongNarrationForSlides(titles);
    const originalFetch = global.fetch;
    mockYandexTwoStep(overlongText, {
      title: "Narration repair",
      generatedText: overlongText,
      outline: titles,
      slides: titles.map((title) => ({
        title,
        thesis: `${title} has a concrete first point for the study report.`,
        bullets: [`${title} useful example`, `${title} specific consequence`],
        speakerNotes: overlongText,
      })),
      speechScript: titles.map((title, index) => ({
        slideOrder: index + 1,
        slideTitle: title,
        text: overlongText,
      })),
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Narration repair",
          prompt: "Create a presentation about narration repair",
          scenario: "school_report",
          level: "8 class",
          mode: "with_sources",
          slideCount: 14,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Narration repair keeps each section concise and specific." }],
      );

      const generatedSections = presentation.generatedText
        .split(/\n\n+/)
        .filter((section) => section.trim());
      expect(generatedSections).toHaveLength(14);
      for (const section of generatedSections) {
        const body = section.split("\n").slice(1).join(" ");
        expect(sentenceCount(body)).toBeGreaterThanOrEqual(5);
        expect(sentenceCount(body)).toBeLessThanOrEqual(6);
        expect(body).not.toContain("main takeaway of the topic");
      }

      expect(presentation.slides).toHaveLength(14);
      expect(presentation.speechScript).toHaveLength(14);
      expect(presentation.slides.every((slide) => sentenceCount(slide.speakerNotes) >= 5 && sentenceCount(slide.speakerNotes) <= 6)).toBe(true);
      expect(presentation.speechScript.every((item) => sentenceCount(item.text) >= 5 && sentenceCount(item.text) <= 6)).toBe(true);

      const noteStarts = presentation.slides.map((slide) => sentenceStartKey(firstSentence(slide.speakerNotes)));
      const noteEndings = presentation.slides.map((slide) => sentenceStartKey(lastSentence(slide.speakerNotes)));
      for (let index = 1; index < noteStarts.length; index += 1) {
        expect(noteStarts[index]).not.toBe(noteStarts[index - 1]);
        expect(noteEndings[index]).not.toBe(noteEndings[index - 1]);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("refuses overlong narration when fewer than five usable sentences remain", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const titles = ["Repair topic 1", "Repair topic 2"];
    const weakText = weakOverlongNarrationForSlides(titles);
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      return callCount === 1
        ? yandexTextResponse(JSON.stringify(narrativePlanForTitles(titles)))
        : yandexTextResponse(weakText);
    };

    try {
      await expect(
        generatePresentation(
          {
            id: "project-1",
            title: "Narration repair",
            prompt: "Create a presentation about narration repair",
            scenario: "school_report",
            level: "8 class",
            mode: "with_sources",
            slideCount: 2,
          },
          [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Narration repair keeps each section concise and specific." }],
        ),
      ).rejects.toThrow("must have 5-6 narration sentences");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects incomplete AI output instead of filling production slides with fallback", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      yandexTextResponse(
        [
          "Слайд 1: Process overview",
          "A process is easier to understand when it is split into steps. The first point gives the listener a simple starting place. The second point shows why order matters. The third point connects the steps with the final result. This narration intentionally omits the other requested slides.",
        ].join("\n"),
      );

    try {
      await expect(
        generatePresentation(
          {
            id: "project-1",
            title: "Structured topic",
            prompt: "Explain a process",
            scenario: "lesson",
            level: "beginner",
            mode: "with_sources",
            slideCount: 3,
          },
          [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "A process has ordered steps." }],
        ),
      ).rejects.toThrow("expected 3 narration sections");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("hides weak visual blocks and keeps useful structured visuals", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides([
      "Визуальная логика",
      "Пустая схема",
      "Неполное сравнение",
      "Полезный процесс",
      "Что считать качеством",
    ]);
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Visual quality",
      generatedText: presentationText,
      slides: [
        {
          title: "Визуальная логика",
          thesis: "Визуальный блок нужен только там, где он помогает понять мысль.",
        },
        {
          title: "Пустая схема",
          thesis: "Схема без узлов не объясняет тему.",
          bullets: ["Узлы обозначают ключевые понятия", "Связи показывают отношения между ними"],
          visual: { type: "schema", title: "Schema" },
        },
        {
          title: "Неполное сравнение",
          thesis: "Сравнение работает только тогда, когда у него есть две стороны.",
          bullets: ["Критерии должны быть одинаковыми", "Обе стороны требуют содержательных значений"],
          visual: { type: "comparison_diagram", rows: [{ label: "Only one side", left: "First value", right: "" }] },
        },
        {
          title: "Полезный процесс",
          thesis: "Процесс помогает, когда у него есть понятные шаги.",
          bullets: ["Шаги располагаются в правильном порядке", "Каждое действие получает краткое объяснение"],
          visual: {
            type: "process_diagram",
            items: [
              { label: "Collect material", text: "Gather the key facts." },
              { label: "Explain result", text: "Turn facts into a short explanation." },
            ],
          },
        },
        {
          title: "Что считать качеством",
          thesis: "Визуальный блок должен быть связан с мыслью слайда.",
          bullets: ["Блок не должен быть пустым", "Сравнение требует двух сторон", "Процесс требует шагов"],
        },
      ],
    }, undefined, {
      slides: [
        {
          slideOrder: 5,
          thesis: "Визуальный блок должен быть связан с основной мыслью материала.",
          bullets: ["Блок не должен быть пустым", "Сравнение требует двух сторон", "Процесс требует шагов"],
          blocks: [
            {
              type: "bullets",
              items: ["Блок не должен быть пустым", "Сравнение требует двух сторон", "Процесс требует шагов"],
            },
          ],
          definition: null,
          visual: {
            title: "",
            items: [],
            rows: [],
            leftLabel: "",
            rightLabel: "",
          },
        },
      ],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Visual quality",
          prompt: "Explain when visual blocks are useful",
          scenario: "lesson",
          level: "beginner",
          mode: "with_sources",
          slideCount: 5,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Useful visuals need real structure." }],
      );

      expect(presentation.slides[1].visual.type).toBe("none");
      expect(presentation.slides[2].visual.type).toBe("none");
      expect(presentation.slides[3].visual.type).toBe("process_diagram");
      expect(presentation.slides[3].visual.items).toHaveLength(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("adds section dividers and summary takeaways in structured demo fallback", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-1",
        title: "Structured fallback",
        prompt: "Create a structured fallback deck",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 6,
      },
      [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Fallback material." }],
    );

    expect(presentation.slides[0].slideKind).toBe("title");
    expect(presentation.slides.some((slide) => slide.slideKind === "section")).toBe(true);
    expect(presentation.slides[5].slideKind).toBe("summary");
    expect(presentation.slides[5].bullets.length).toBeGreaterThanOrEqual(3);
    expect(presentation.slides[5].bullets.length).toBeLessThanOrEqual(5);
    expect(presentation.slides.every((slide) => slide.keyConcepts.length === 0)).toBe(true);
    expect(presentation.slides.every((slide) => slide.highlights.length === 0)).toBe(true);
    expect(new Set(presentation.slides.map((slide) => slide.layout)).size).toBeGreaterThan(2);
    expect(presentation.slides.map((slide) => slide.layout)).not.toContain("case-study");
    expect(presentation.speechScript.every((item) => sentenceCount(item.text) >= 5 && sentenceCount(item.text) <= 6)).toBe(true);
    expect(presentation.slides.every((slide) => sentenceCount(slide.speakerNotes) >= 5 && sentenceCount(slide.speakerNotes) <= 6)).toBe(true);
    expect(presentation.slides.every((slide) => slide.speakerNotes.length > slide.thesis.length)).toBe(true);
    expectNoForbiddenNarration(visiblePresentationText(presentation));
    expectNoForbiddenSlideText(visiblePresentationText(presentation));
  });

  it("repairs generic filler and fragments before saving production output", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides(["Экология города", "Воздух и транспорт", "Вывод"]);
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Экология города",
      generatedText: presentationText,
      slides: [
        {
          title: "Экология города",
          thesis: "Экология города зависит от транспорта, воздуха и поведения жителей.",
        },
        {
          title: "Воздух и транспорт",
          thesis: "Космические аппараты исследуют далёкие планеты за пределами Солнечной системы.",
          bullets: [
            "Из презентации можно вынести следующее",
            "Орбитальные станции работают за пределами атмосферы.",
            "Телескопы помогают изучать далёкие галактики.",
            "Ракеты доставляют аппараты на заданную орбиту.",
          ],
          blocks: [
            {
              type: "callout",
              content: "Космические аппараты передают данные о других планетах.",
            },
          ],
          visual: {
            type: "image",
            description: "Как показано на изображении, на картинке есть транспорт.",
          },
        },
        {
          title: "Вывод",
          thesis: "Морские течения определяют температуру глубоких океанов в разных климатических поясах.",
        },
      ],
    }, bodies, {
      slides: [
        {
          slideOrder: 2,
          thesis: "Транспорт загрязняет городской воздух выхлопными газами.",
          bullets: [
            "Общественный транспорт снижает число машин на дорогах.",
            "Зелёные зоны помогают удерживать пыль.",
          ],
          blocks: [
            {
              type: "callout",
              content: "Качество воздуха зависит от транспорта и городского озеленения.",
            },
          ],
          definition: null,
          visual: {
            title: "",
            items: [],
            rows: [],
            leftLabel: "",
            rightLabel: "",
          },
        },
        {
          slideOrder: 3,
          thesis: "Чистый город требует совместных решений жителей и властей.",
          bullets: [
            "Экологичный транспорт уменьшает загрязнение воздуха.",
            "Ответственное поведение жителей поддерживает чистоту города.",
            "Озеленение делает городскую среду комфортнее.",
          ],
          blocks: [
            {
              type: "bullets",
              items: [
                "Экологичный транспорт уменьшает загрязнение воздуха.",
                "Ответственное поведение жителей поддерживает чистоту города.",
                "Озеленение делает городскую среду комфортнее.",
              ],
            },
          ],
          definition: null,
          visual: {
            title: "",
            items: [],
            rows: [],
            leftLabel: "",
            rightLabel: "",
          },
        },
      ],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Экология города",
          prompt: "Сделай презентацию про экологию города",
          scenario: "lesson",
          level: "beginner",
          mode: "with_sources",
          slideCount: 3,
        },
        [],
      );

      expect(bodies).toHaveLength(5);
      expect(bodies[4].messages[1].text).toContain('"slideOrder":2');
      expect(bodies[4].messages[1].text).toContain('"slideOrder":3');
      expectNoForbiddenSlideText(visiblePresentationText(presentation));
      expect(visiblePresentationText(presentation)).not.toContain("Из презентации можно вынести следующее");
      expect(presentation.slides[2].thesis).not.toContain("Морские течения");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses complete narration text when the editorial repair request fails", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides(["Городской транспорт", "Практический вывод"]);
    const narrativePlan = narrativePlanForTitles(["Городской транспорт", "Практический вывод"]);
    let callCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      callCount += 1;
      if (callCount === 1) return yandexTextResponse(JSON.stringify(narrativePlan));
      if (callCount === 2) return yandexTextResponse(presentationText);
      if (callCount === 3) {
        return yandexTextResponse(JSON.stringify(designBriefForTitles(narrativePlan.map((item) => item.slideTitle))));
      }
      if (callCount === 4) {
        return yandexTextResponse(
          JSON.stringify({
            title: "Городской транспорт",
            generatedText: presentationText,
            slides: [
              {
                title: "Городской транспорт",
                thesis: "Городской транспорт влияет на повседневную жизнь жителей.",
              },
              {
                title: "Практический вывод",
                thesis: "Космические телескопы исследуют далёкие галактики за пределами Солнечной системы.",
                bullets: [
                  "Ответственный выбор транспорта уменьшает нагрузку на город",
                  "Общественные маршруты помогают сократить число машин",
                  "Пешеходная инфраструктура делает улицы удобнее",
                ],
              },
            ],
            speechScript: [],
          }),
        );
      }
      return new Response("editor unavailable", { status: 503 });
    };

    try {
      const presentation = await generatePresentation(
        {
          id: "project-editor-fallback",
          title: "Городской транспорт",
          prompt: "Объясни влияние городского транспорта",
          scenario: "lesson",
          level: "beginner",
          mode: "with_sources",
          slideCount: 2,
        },
        [],
      );

      expect(callCount).toBe(5);
      expect(presentation.slides[1].thesis).not.toContain("Космические телескопы");
      expect(presentation.slides[1].thesis).toMatch(/[.!?]$/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs template-like AI narration with fallback text", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    const templateNarration =
      'Слайд 1: Новая волна\nСлайд "Новая волна" объясняет часть темы "Русское кино" через одну главную мысль: кино стало разнообразнее. Сначала важно разобрать опорный пункт: появились онлайн-платформы. Затем стоит показать связь с другим элементом темы: зрители стали смотреть фильмы иначе. После этого можно закрепить объяснение через деталь: фестивальное кино стало заметнее. Поэтому текст на слайде оставляет только опорные пункты. Основной смысл раскрывается в рассказе про "Новая волна".';

    global.fetch = async () => yandexTextResponse(templateNarration);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs complaint-style universal narration endings", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badNarration = [
      "Слайд 1: Новая волна",
      "Новая волна российского кино связана с изменением жанров и способов просмотра. Онлайн-платформы сделали путь фильма к зрителю более гибким. Авторские драмы стали заметнее рядом с коммерческими проектами. Так становится понятнее, почему тема «Новая волна» важна именно в этой части рассказа. Связь с разделом «Новая волна» помогает слушателю увидеть не только событие, но и его значение.",
    ].join("\n");

    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse(badNarration);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs direct slide-structure narration phrases", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badNarration = [
      "Слайд 1: Развитие темы",
      "Дальше раздел «Развитие темы» продолжает тему «Русское кино» и показывает, что кино стало разнообразнее. Сначала важно удержать конкретную мысль: онлайн-платформы изменили путь фильма к зрителю. Следующая деталь добавляет к объяснению новый шаг: авторские драмы стали заметнее рядом с коммерческими проектами. Еще один содержательный момент связан с тем, что зрители стали чаще смотреть фильмы дома. Этот шаг подводит рассказ к следующей части через конкретную мысль о новых жанрах.",
    ].join("\n");

    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse(badNarration);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs repeated fallback-like sentence formulas in narration", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badNarration = [
      "Слайд 1: Онлайн-платформы",
      "Онлайн-платформы изменили то, как зрители смотрят российское кино. Это проявляется в том, что премьеры стали чаще выходить не только в кинотеатрах. Причина такого вывода в том, что зрительские привычки стали гибче. Последствия заметны там, где авторские фильмы находят аудиторию быстрее. Поэтому онлайн-платформы стали важной частью современной киноиндустрии.",
    ].join("\n");

    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse(badNarration);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reads Yandex completion text from result alternatives", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: Intro",
      "A real generated point starts the narration for this slide. It gives the listener a concrete idea before the short slide text appears. The next sentence explains why this idea matters for Russian cinema. Another sentence connects the point with the rest of the presentation. The final sentence keeps the speech readable and complete.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Russian cinema",
      generatedText: presentationText,
      slides: [{ title: "Intro", blocks: [{ type: "bullets", items: ["A real generated point"] }] }],
      speechScript: [],
    });

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
      expect(presentation.slides[0].blocks[0]).toEqual({ type: "bullets", items: ["A real generated point"] });
      expect(presentation.slides[0].bullets.length).toBeGreaterThanOrEqual(2);
      expect(presentation.slides[0].bullets[0]).toBe("A real generated point");
      expect(presentation.slides[0].visual.description).toBeTruthy();
      expect(sentenceCount(presentation.speechScript[0].text)).toBeGreaterThanOrEqual(5);
      expect(sentenceCount(presentation.speechScript[0].text)).toBeLessThanOrEqual(6);
      expect(presentation.speechScript[0].text.toLowerCase()).toContain("a real generated point");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("allows user-provided topical titles that contain рассказ про", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: Рассказ про машины Audi quattro",
      "Audi quattro появился как инженерный ответ на задачу уверенного сцепления в сложных дорожных условиях. Полный привод помог автомобилю лучше распределять тягу между осями и сохранять устойчивость на мокрой или скользкой поверхности. В автоспорте эта технология быстро стала заметным преимуществом, потому что позволяла раньше разгоняться после поворотов. Для серийных автомобилей quattro стал способом объединить безопасность, управляемость и спортивный характер. Поэтому история Audi quattro показывает, как техническое решение из гонок изменило ожидания водителей от повседневных машин.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Рассказ про машины Audi quattro",
      generatedText: presentationText,
      slides: [
        {
          title: "Рассказ про машины Audi quattro",
          blocks: [
            {
              type: "callout",
              content:
                "Audi quattro сделал полный привод частью спортивного и повседневного образа марки.",
            },
          ],
        },
      ],
      speechScript: [],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-audi",
          title: "Рассказ про машины Audi quattro",
          prompt: "Рассказ про машины Audi quattro",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [
          {
            id: "web-audi",
            label: "Audi quattro",
            type: "WEB",
            size: 0,
            excerpt: "Audi quattro известен системой полного привода и спортивной историей.",
          },
        ],
      );

      expect(presentation.title).toContain("Audi quattro");
      expect(presentation.generationMode).toBe("yandex");
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

    const presentationText = [
      "Слайд 1: Новая волна российского кино",
      "Новая волна российского кино после 2010 года связана с тем, что фильмы стали разнообразнее по жанрам и способам показа. Рядом с авторскими драмами появились кассовые франшизы и онлайн-премьеры. Зрители начали чаще смотреть кино не только в зале, но и на платформах. Это изменило путь фильма к аудитории и сделало рынок более подвижным. Поэтому современное русское кино стоит рассматривать через связь жанров, технологий и зрительских привычек.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Русское кино после 2010 года",
      generatedText: presentationText,
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
        },
      ],
    });

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

      expect(sentenceCount(presentation.speechScript[0].text)).toBeGreaterThanOrEqual(5);
      expect(sentenceCount(presentation.speechScript[0].text)).toBeLessThanOrEqual(6);
      expect(presentation.speechScript[0].text).toContain("Новая волна российского кино");
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

    const presentationText = narrationForSlides(["Русское кино после 2010 года", "Онлайн-платформы", "Новые жанры"]);
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
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
    });

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
    expect(presentation.generationMode).toBe("demo");
    expect(visibleText).not.toContain("Тезис нужно объяснить");
    expect(visibleText).not.toContain("Проверьте");
    expect(visibleText).not.toContain("Добавьте источник");
    expect(visibleText.toLowerCase()).not.toContain("источник");
    expect(visibleText).not.toContain("Смысл темы понятнее, когда видны причины и последствия.");
    expect(visibleText).not.toContain("понятнее через факты, примеры и последствия.");
    expect(presentation.slides[0].slideKind).toBe("title");
    expect(presentation.slides[presentation.slides.length - 1].slideKind).toBe("summary");
    expect(presentation.slides[presentation.slides.length - 1].bullets.length).toBeGreaterThanOrEqual(3);
    expect(presentation.slides.every((slide) => slide.thesis.length < 240)).toBe(true);
    expect(presentation.slides.every((slide) => sentenceCount(slide.speakerNotes) === 5)).toBe(true);
    expect(presentation.speechScript.every((item) => sentenceCount(item.text) === 5)).toBe(true);
    const noteStarts = presentation.slides.map((slide) => sentenceStartKey(firstSentence(slide.speakerNotes)));
    const noteEndings = presentation.slides.map((slide) => sentenceStartKey(lastSentence(slide.speakerNotes)));
    expect(new Set(noteStarts).size).toBe(noteStarts.length);
    expect(new Set(noteEndings).size).toBe(noteEndings.length);
    const speechText = [
      ...presentation.slides.map((slide) => slide.speakerNotes),
      ...presentation.speechScript.map((item) => item.text),
    ].join("\n").toLowerCase();
    for (const fragment of ["раздел", "следующ", "переход", "слайд"]) {
      expect(speechText).not.toContain(fragment);
    }
    expectNoForbiddenNarration(speechText);
    expect(presentation.speechScript[0].text.length).toBeGreaterThan(
      presentation.slides[0].thesis.length,
    );
  });
});

function visiblePresentationText(presentation: Awaited<ReturnType<typeof generatePresentation>>) {
  return [
    presentation.title,
    presentation.generatedText,
    ...presentation.slides.flatMap((slide) => [
      slide.title,
      slide.thesis,
      slide.speakerNotes,
      ...slide.bullets,
      ...(slide.definition ? [slide.definition.term, slide.definition.text] : []),
      ...slide.keyConcepts.map((item) => item.label),
      slide.visual.title,
      slide.visual.description,
      ...slide.visual.items.flatMap((item) => [item.label, item.text]),
      ...slide.visual.rows.flatMap((row) => [row.label, row.left, row.right]),
      ...slide.highlights.map((item) => item.text),
      ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
    ]),
    ...presentation.speechScript.flatMap((item) => [item.slideTitle, item.text]),
  ].join("\n");
}

function expectNoForbiddenNarration(text: string) {
  const lower = text.toLowerCase();
  for (const fragment of forbiddenNarrationFragments) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
}

function expectNoForbiddenSlideText(text: string) {
  const lower = text.toLowerCase();
  for (const fragment of forbiddenSlideTextFragments) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
}

function sentenceCount(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).length;
}

function firstSentence(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)[0] || "";
}

function lastSentence(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences[sentences.length - 1] || "";
}

function sentenceStartKey(text: string) {
  return text.toLowerCase().replace(/[«»"“”'`.,!?;:()[\]{}<>]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
}
