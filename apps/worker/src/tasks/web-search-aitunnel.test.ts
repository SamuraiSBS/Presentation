import { afterEach, describe, expect, it, vi } from "vitest";

const searchAitunnelWebSearch = vi.fn();
vi.mock("./aitunnel-web-search.js", () => ({ searchAitunnelWebSearch }));

const { searchWebSources } = await import("./web-search.js");

afterEach(() => {
  vi.unstubAllEnvs();
  searchAitunnelWebSearch.mockReset();
});

describe("AITUNNEL web-search provider selection", () => {
  it("normalizes AITUNNEL results through the existing relevance filters", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "aitunnel");
    searchAitunnelWebSearch.mockResolvedValue({
      model: "gpt-5.6-luna",
      toolUsed: true,
      results: [
        { title: "NASA Saturn", url: "https://science.nasa.gov/saturn", excerpt: "Saturn is a planet with rings." },
        { title: "NASA duplicate", url: "https://science.nasa.gov/saturn", excerpt: "Duplicate source." },
        { title: "University Saturn", url: "https://physics.example.edu/saturn", excerpt: "University observations describe Saturn." },
        { title: "Saturn overview", url: "https://example.org/saturn", excerpt: "Saturn is studied in planetary science." },
      ],
    });

    const sources = await searchWebSources({ title: "Saturn", prompt: "Topic: Saturn planetary science" });

    expect(searchAitunnelWebSearch).toHaveBeenCalledTimes(1);
    expect(sources.map((source) => source.url)).toEqual(expect.arrayContaining([
      "https://science.nasa.gov/saturn",
      "https://physics.example.edu/saturn",
      "https://example.org/saturn",
    ]));
    expect(sources.every((source) => source.type === "WEB" && source.excerpt)).toBe(true);
  });

  it("returns the mandatory insufficient-source semantic without a hidden second search", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "aitunnel");
    searchAitunnelWebSearch.mockResolvedValue({
      model: "gpt-5.6-luna",
      toolUsed: true,
      results: [{ title: "Saturn", url: "https://science.nasa.gov/saturn", excerpt: "Saturn is a planet." }],
    });

    await expect(searchWebSources({ title: "Saturn", prompt: "Topic: Saturn" })).rejects.toThrow("mandatory_source_search_insufficient");
    expect(searchAitunnelWebSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown provider errors explicit", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "unknown-provider");
    await expect(searchWebSources("Saturn")).rejects.toThrow("Unsupported WEB_SEARCH_PROVIDER: unknown-provider");
    expect(searchAitunnelWebSearch).not.toHaveBeenCalled();
  });
});
