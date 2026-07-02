import { describe, expect, it } from "vitest";
import { buildTavilyWebSearchQuery, tavilyResultsToSources } from "./web-search.js";

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
    expect(buildTavilyWebSearchQuery("  Alfa Romeo\n\nhistory\tmodels  ")).toBe("Alfa Romeo history models");
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
