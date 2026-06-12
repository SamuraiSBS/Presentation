import { describe, expect, it } from "vitest";
import { tavilyResultsToSources } from "./web-search.js";

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
