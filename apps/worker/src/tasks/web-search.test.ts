import { afterEach, describe, expect, it, vi } from "vitest";

const recordCostEvent = vi.fn();
const currentUsageContext = vi.fn();

vi.mock("../usage-ledger.js", () => ({
  recordCostEvent,
  currentUsageContext,
}));

const { buildSourceResearchBrief, buildTavilyWebSearchQuery, searchWebSources, tavilyResultsToSources } = await import("./web-search.js");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  recordCostEvent.mockReset();
  currentUsageContext.mockReset();
});

describe("searchWebSources telemetry", () => {
  it("records one valid Tavily cost event with the current project and generation job context", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    currentUsageContext.mockReturnValue({ userId: "user-1", projectId: "project-1", generationJobId: "generation-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 })));

    await searchWebSources({ title: "Saturn", prompt: "Topic: Saturn" });

    expect(recordCostEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: "web_search",
      provider: "tavily",
      quantity: "1",
      unit: "api_credit",
      currency: "USD",
      measurement: "calculated",
    }));
    expect(recordCostEvent.mock.calls[0]?.[0]?.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps successful Tavily results usable after recording telemetry", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    currentUsageContext.mockReturnValue({ userId: "user-1", projectId: "project-1", generationJobId: "generation-1" });
    recordCostEvent.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [
      { title: "Saturn facts", url: "https://nasa.gov/saturn", content: "Saturn is a planet with rings." },
    ] }), { status: 200 })));

    await expect(searchWebSources("Topic: Saturn")).resolves.toEqual([
      expect.objectContaining({ type: "WEB", url: "https://nasa.gov/saturn" }),
    ]);
  });
});

describe("buildTavilyWebSearchQuery", () => {
  it("keeps Tavily web queries below the provider limit", () => {
    const prompt = [
      "Рассказ про авто бренд Alfa Romeo",
      "Сделай подробную презентацию с историей бренда, важными моделями, дизайном, спортивным наследием, текущим рынком и выводами.",
      "Добавь университетский стиль объяснения, короткие слайды, примеры и факты для устного выступления.",
      "Покажи эволюцию компании, гоночные достижения, особенности дизайна, современное позиционирование и культурное влияние.",
      "Объясни материал простым языком и не используй слишком сложные формулировки.",
    ].join(" ");

    const query = buildTavilyWebSearchQuery(prompt);

    expect(query.length).toBeLessThanOrEqual(400);
    expect(query).toContain("Alfa Romeo");
    expect(query).not.toMatch(/\s$/);
  });

  it("normalizes whitespace before searching", () => {
    expect(buildTavilyWebSearchQuery("  Alfa Romeo\n\nhistory\tmodels  ")).toContain("Alfa Romeo history models");
  });

  it("turns short Russian topics into academic research queries", () => {
    const query = buildTavilyWebSearchQuery("Карибский кризис");

    expect(query).toContain("Карибский кризис");
    expect(query).toContain("университетский доклад");
    expect(query).toContain("причины");
  });

  it("does not echo long user instructions as Tavily search terms", () => {
    const query = buildTavilyWebSearchQuery(
      "Сделай подробную презентацию про Карибский кризис. Добавь красивые слайды, речь, выводы и не используй сложные формулировки.",
    );

    expect(query.length).toBeLessThanOrEqual(400);
    expect(query).toContain("Карибский кризис");
    expect(query.toLowerCase()).not.toContain("сделай");
    expect(query.toLowerCase()).not.toContain("презентацию");
    expect(query.toLowerCase()).not.toContain("красивые слайды");
  });

  it("prefers an explicit Russian topic over adjectives from a long creation brief", () => {
    const query = buildTavilyWebSearchQuery({
      title: "Academic student presentation",
      prompt: "\u0421\u0434\u0435\u043b\u0430\u0439 \u0430\u043a\u0430\u0434\u0435\u043c\u0438\u0447\u0435\u0441\u043a\u0443\u044e \u043f\u0440\u0435\u0437\u0435\u043d\u0442\u0430\u0446\u0438\u044e \u043f\u043e \u0442\u0435\u043c\u0435: \u041a\u043e\u0441\u043c\u043e\u0441 \u2014 \u043f\u043b\u0430\u043d\u0435\u0442\u0430 \u0421\u0430\u0442\u0443\u0440\u043d. \u0414\u043e\u0431\u0430\u0432\u044c \u0441\u043b\u0430\u0439\u0434\u044b \u0438 \u0432\u044b\u0432\u043e\u0434\u044b.",
    });

    expect(query).toContain("\u0421\u0430\u0442\u0443\u0440\u043d");
    expect(query.toLowerCase()).not.toContain("\u0430\u043a\u0430\u0434\u0435\u043c\u0438\u0447\u0435\u0441\u043a");
  });
  it("uses the prompt topic when a live smoke project has a generic title", () => {
    const query = buildTavilyWebSearchQuery({
      title: "Live generation smoke",
      prompt: "Create a grounded ten-slide university presentation about the practical use of artificial intelligence in higher education, with a complete narration and sources.",
    });

    expect(query).toContain("artificial intelligence higher education");
    expect(query.toLowerCase()).not.toContain("live generation smoke");
    expect(query.toLowerCase()).not.toContain("grounded");
    expect(query.toLowerCase()).not.toContain("narration");
  });
});

describe("tavilyResultsToSources", () => {
  it("maps Tavily results to presentation sources", () => {
    const sources = tavilyResultsToSources({
      results: [
        {
          title: "Российское кино после 2010 года",
          url: "https://example.com/russian-cinema",
          content: "После 2010 года российский кинематограф активно развивал авторское и массовое кино.",
        },
      ],
    });

    expect(sources).toEqual([
      {
        id: "web-1",
        label: "Российское кино после 2010 года",
        type: "WEB",
        size: 0,
        excerpt: "После 2010 года российский кинематограф активно развивал авторское и массовое кино.",
        url: "https://example.com/russian-cinema",
      },
    ]);
  });

  it("drops unusable results without url or content", () => {
    expect(
      tavilyResultsToSources({
        results: [
          { title: "No URL", content: "content" },
          { title: "No content", url: "https://example.com" },
        ],
      }),
    ).toEqual([]);
  });

  it("keeps relevant primary and university sources above secondary sources", () => {
    const topic = "\u041a\u043e\u0441\u043c\u043e\u0441 \u043f\u043b\u0430\u043d\u0435\u0442\u0430 \u0421\u0430\u0442\u0443\u0440\u043d";
    const sources = tavilyResultsToSources({
      results: [
        { title: "\u0421\u0430\u0442\u0443\u0440\u043d: \u0444\u0430\u043a\u0442\u044b", url: "https://example.com/saturn", content: "\u0421\u0430\u0442\u0443\u0440\u043d \u2014 \u043f\u043b\u0430\u043d\u0435\u0442\u0430 \u0421\u043e\u043b\u043d\u0435\u0447\u043d\u043e\u0439 \u0441\u0438\u0441\u0442\u0435\u043c\u044b." },
        { title: "Saturn", url: "https://astronomy.nasa.gov/saturn", content: "NASA explains the planet Saturn, its rings and atmosphere." },
        { title: "\u041a\u043e\u0441\u043c\u043e\u0441: \u043f\u043b\u0430\u043d\u0435\u0442\u0430 \u0421\u0430\u0442\u0443\u0440\u043d", url: "https://physics.example.edu/saturn", content: "\u0423\u043d\u0438\u0432\u0435\u0440\u0441\u0438\u0442\u0435\u0442\u0441\u043a\u0438\u0435 \u043d\u0430\u0431\u043b\u044e\u0434\u0435\u043d\u0438\u044f \u043f\u043b\u0430\u043d\u0435\u0442\u044b \u0421\u0430\u0442\u0443\u0440\u043d." },
      ],
    }, { title: topic, prompt: `\u043f\u043e \u0442\u0435\u043c\u0435: ${topic}` });

    expect(sources.slice(0, 2).map((source) => source.url)).toEqual(expect.arrayContaining([
      "https://astronomy.nasa.gov/saturn",
      "https://physics.example.edu/saturn",
    ]));
    expect(sources[2]?.url).toBe("https://example.com/saturn");
  });

  it("rejects unrelated, map, catalogue and dictionary results", () => {
    const sources = tavilyResultsToSources({
      results: [
        { title: "\u0410\u043a\u0430\u0434\u0435\u043c\u0438\u0447\u0435\u0441\u043a\u0430\u044f metro station", url: "https://maps.example.com/akademicheskaya", content: "Metro station reference." },
        { title: "Saturn dictionary", url: "https://dictionary.example.com/saturn", content: "A dictionary entry for Saturn." },
        { title: "Unrelated trivia", url: "https://example.com/trivia", content: "A partial mention of Saturn without related context." },
      ],
    }, "Topic: Saturn planetary science");

    expect(sources).toEqual([]);
  });
});

describe("buildSourceResearchBrief", () => {
  it("keeps facts grounded to source ids", () => {
    const brief = buildSourceResearchBrief(
      { title: "Карибский кризис", prompt: "Карибский кризис" },
      [
        {
          id: "web-1",
          label: "История кризиса",
          type: "WEB",
          size: 0,
          excerpt: "Карибский кризис был острым противостоянием СССР и США в октябре 1962 года.",
          url: "https://example.com/one",
        },
        {
          id: "web-2",
          label: "Итоги",
          type: "WEB",
          size: 0,
          excerpt: "Переговоры помогли снизить риск прямого ядерного столкновения.",
          url: "https://example.com/two",
        },
      ],
    );

    expect(brief.keyFacts).toEqual([
      expect.objectContaining({ sourceId: "web-1", text: expect.stringContaining("1962") }),
      expect.objectContaining({ sourceId: "web-2", text: expect.stringContaining("Переговоры") }),
    ]);
    expect(brief.sourceIds).toEqual(["web-1", "web-2"]);
    expect(brief.warnings).toEqual([]);
  });

  it("warns when web search did not return usable source summaries", () => {
    const brief = buildSourceResearchBrief({ title: "Topic", prompt: "Topic" }, []);

    expect(brief.keyFacts).toEqual([]);
    expect(brief.warnings[0]).toContain("No reliable web snippets");
  });
});
