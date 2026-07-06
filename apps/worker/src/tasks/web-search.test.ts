import { describe, expect, it } from "vitest";
import { buildSourceResearchBrief, buildTavilyWebSearchQuery, tavilyResultsToSources } from "./web-search.js";

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
