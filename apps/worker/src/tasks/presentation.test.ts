import { afterEach, describe, expect, it } from "vitest";
import { buildGenerationPrompt, generatePresentation, selectAiProviders } from "./presentation.js";

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

function mockYandexTwoStep(narrationText: string, json: unknown, bodies?: unknown[]) {
  let callCount = 0;
  global.fetch = async (_input, init) => {
    bodies?.push(JSON.parse(String(init?.body || "{}")));
    callCount += 1;
    return yandexTextResponse(callCount === 1 ? narrationText : JSON.stringify(json));
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
  return titles
    .map((title, index) => {
      const [first, second, third] = details[index % details.length];
      return [
        `Слайд ${index + 1}: ${title}`,
        `${title} раскрывает ${first}, который задает направление всему объяснению. Затем появляется ${second}, потому что без него слушателю трудно увидеть развитие мысли. Конкретный ${third} показывает, чем эта часть отличается от соседних фрагментов. Дополнительная деталь связывает название "${title}" с реальной задачей выступления. Финальная фраза кратко собирает этот смысл и готовит переход дальше.`,
      ].join("\n");
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
    expect(prompt).toContain("question-answer");
    expect(prompt).toContain("myth-fact");
    expect(prompt).toContain("do not use the same content layout more than twice in a row");
    expect(prompt).toContain("one clear thesis plus 2-3 short meaningful points");
    expect(prompt).toContain("semantic and memorable");
    expect(prompt).toContain("keyConcepts: return an empty array");
    expect(prompt).toContain("highlights: return an empty array");
    expect(prompt).toContain("5-6 sentence");
    expect(prompt).toContain("generatedText");
    expect(prompt).toContain("Do not generate a separate second story");
    expect(prompt).toContain("Do not write long text blocks");
    expect(prompt).toContain("every slide, including title, section, and summary slides, must include visual.description");
    expect(prompt).toContain("set visual.type to image or illustration");
    expect(prompt).toContain("never fill visual.title, visual.items, or visual.rows with generic placeholder text");
    expect(prompt).toContain("process_diagram");
    expect(prompt).toContain("comparison_diagram");
    expect(prompt).toContain("mind_map");
    expect(prompt).toContain("visual.description must describe a concrete, searchable image");
    expect(prompt).toContain("do not put URLs");
    expect(prompt).toContain("Do not invent precise facts");
  });
});

describe("generatePresentation fallback behavior", () => {
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
      expect(presentation.slides.map((slide) => slide.title)).toEqual([
        "За фасадом успеха",
        "Stratton Oakmont и падение",
        "Главные уроки книги",
      ]);
      expect(presentation.speechScript[2].text).toContain("не пример для повторения");
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects the repeated template text from the bad neural output", async () => {
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
      await expect(
        generatePresentation(
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
        ),
      ).rejects.toThrow("template phrase detected");
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

      expect(bodies).toHaveLength(2);
      expect(bodies[0].jsonObject).toBe(false);
      expect(bodies[0].messages[1].text).toContain("exactly 5-6 complete sentences");
      expect(bodies[1].jsonObject).toBe(true);
      expect(bodies[1].messages[1].text).toContain(presentationText);
      expect(bodies[1].messages[1].text).toContain("only source of truth");
      expect(presentation.generatedText).toBe(presentationText);
      expect(presentation.slides[0].thesis).toContain("Внешний успех");
      expect(presentation.slides[1].bullets).toContain("Нужны принципы");
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("pads short Yandex narration sections before building JSON", async () => {
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
    const normalizedText = [
      "Слайд 1: За фасадом успеха",
      "История начинается с внешнего успеха. Но за ним быстро появляется потеря контроля. Поэтому тема звучит как предупреждение. Так становится понятнее, почему тема «За фасадом успеха» важна именно в этой части рассказа. Связь с разделом «За фасадом успеха» помогает слушателю увидеть не только событие, но и его значение.",
      "",
      "Слайд 2: Главный вывод",
      "Финал показывает цену безответственности. Успех без принципов становится проблемой. Так становится понятнее, почему тема «За фасадом успеха» важна именно в этой части рассказа. Связь с разделом «Главный вывод» помогает слушателю увидеть не только событие, но и его значение. Без этого уточнения дальнейший вывод звучал бы слишком резко и неполно.",
    ].join("\n");
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      callCount += 1;
      if (callCount === 1) return yandexTextResponse(shortText);
      return yandexTextResponse(
        JSON.stringify({
          title: "За фасадом успеха",
          generatedText: normalizedText,
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

      expect(bodies).toHaveLength(2);
      expect(bodies[0].jsonObject).toBe(false);
      expect(bodies[1].jsonObject).toBe(true);
      expect(bodies[1].messages[1].text).toContain(normalizedText);
      expect(presentation.generatedText).toBe(normalizedText);
      expect(sentenceCount(presentation.speechScript[0].text)).toBe(5);
      expect(sentenceCount(presentation.speechScript[1].text)).toBe(5);
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
          visual: { type: "schema", title: "Schema" },
        },
        {
          title: "Неполное сравнение",
          thesis: "Сравнение работает только тогда, когда у него есть две стороны.",
          visual: { type: "comparison_diagram", rows: [{ label: "Only one side", left: "First value", right: "" }] },
        },
        {
          title: "Полезный процесс",
          thesis: "Процесс помогает, когда у него есть понятные шаги.",
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
    expect(presentation.speechScript.every((item) => sentenceCount(item.text) >= 5 && sentenceCount(item.text) <= 6)).toBe(true);
    expect(presentation.slides.every((slide) => sentenceCount(slide.speakerNotes) >= 5 && sentenceCount(slide.speakerNotes) <= 6)).toBe(true);
    expect(presentation.slides.every((slide) => slide.speakerNotes.length > slide.thesis.length)).toBe(true);
    expectNoForbiddenNarration(visiblePresentationText(presentation));
    expectNoForbiddenSlideText(visiblePresentationText(presentation));
  });

  it("rejects generic filler and unsupported visual references in production output", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides(["Экология города", "Воздух и транспорт", "Вывод"]);
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Экология города",
      generatedText: presentationText,
      slides: [
        {
          title: "Экология города",
          thesis: "Городская среда зависит от транспорта, воздуха и поведения жителей.",
        },
        {
          title: "Воздух и транспорт",
          thesis: "Главная идея связана с темой: экология города.",
          bullets: [
            "Материал стоит разбирать по смысловым частям",
            "Ключевые понятия помогают удержать структуру",
            "Как показано на картинке, воздух становится чище",
          ],
          blocks: [
            {
              type: "callout",
              content: "На слайде показано, что несуществующая тема раскрывается через картинку.",
            },
          ],
          visual: {
            type: "image",
            description: "Как показано на изображении, на картинке есть транспорт.",
          },
        },
        {
          title: "Вывод",
          thesis: "Городская экология требует понятных решений и ответственного поведения.",
        },
      ],
    });

    try {
      await expect(
        generatePresentation(
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
        ),
      ).rejects.toThrow("template phrase detected");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects template-like AI narration instead of replacing it with fallback text", async () => {
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
      await expect(
        generatePresentation(
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
        ),
      ).rejects.toThrow("template phrase detected");
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
    expect(visibleText).not.toContain("Тезис нужно объяснить");
    expect(visibleText).not.toContain("Проверьте");
    expect(visibleText).not.toContain("Добавьте источник");
    expect(visibleText.toLowerCase()).not.toContain("источник");
    expect(presentation.slides[0].slideKind).toBe("title");
    expect(presentation.slides[presentation.slides.length - 1].slideKind).toBe("summary");
    expect(presentation.slides[presentation.slides.length - 1].bullets.length).toBeGreaterThanOrEqual(3);
    expect(presentation.slides.every((slide) => slide.thesis.length < 240)).toBe(true);
    expect(presentation.speechScript[0].text.length).toBeGreaterThan(
      presentation.slides[0].thesis.length,
    );
  });
});

function visiblePresentationText(presentation: Awaited<ReturnType<typeof generatePresentation>>) {
  return [
    presentation.title,
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
  for (const fragment of forbiddenNarrationFragments) {
    expect(text).not.toContain(fragment);
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
