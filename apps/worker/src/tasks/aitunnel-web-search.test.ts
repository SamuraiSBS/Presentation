import { afterEach, describe, expect, it, vi } from "vitest";

const createAitunnelSearchClient = vi.fn();
const recordAiUsage = vi.fn();
const recordCostEvent = vi.fn();
const currentUsageContext = vi.fn();
const normalizeOpenAIUsage = vi.fn((value: unknown) => value);

vi.mock("../openai-client.js", () => ({ createAitunnelSearchClient }));
vi.mock("../usage-ledger.js", () => ({
  currentUsageContext,
  normalizeOpenAIUsage,
  recordAiUsage,
  recordCostEvent,
}));

const { buildAitunnelSearchInput, parseAitunnelWebSearchResponse, searchAitunnelWebSearch } = await import("./aitunnel-web-search.js");

afterEach(() => {
  vi.unstubAllEnvs();
  createAitunnelSearchClient.mockReset();
  recordAiUsage.mockReset();
  recordCostEvent.mockReset();
  currentUsageContext.mockReset();
  normalizeOpenAIUsage.mockClear();
});

describe("AITUNNEL web search adapter", () => {
  it("sends one required custom web-search tool call with bounded parameters", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp-1",
      output: [{
        type: "web_search_call",
        results: [
          { title: "One", url: "https://one.example/article", excerpt: "First source excerpt." },
          { title: "Two", url: "https://two.example/article", excerpt: "Second source excerpt." },
          { title: "Three", url: "https://three.example/article", excerpt: "Third source excerpt." },
        ],
      }],
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
    createAitunnelSearchClient.mockReturnValue({ responses: { create } });
    currentUsageContext.mockReturnValue({ userId: "user-1", projectId: "project-1", generationJobId: "job-1" });
    vi.stubEnv("AITUNNEL_SEARCH_MODEL", "gpt-5.6-luna");
    vi.stubEnv("AITUNNEL_WEB_SEARCH_ENGINE", "auto");
    vi.stubEnv("AITUNNEL_WEB_SEARCH_MAX_RESULTS", "5");
    vi.stubEnv("AITUNNEL_WEB_SEARCH_MAX_USES", "1");

    const result = await searchAitunnelWebSearch({ title: "Saturn", prompt: "Explain Saturn planetary science" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      tool_choice: "required",
      tools: [{ type: "aitunnel:web_search", parameters: { engine: "auto", max_results: 5, max_uses: 1 } }],
    }));
    expect(result).toMatchObject({ model: "gpt-5.6-luna", toolUsed: true, responseId: "resp-1" });
    expect(result.results).toHaveLength(3);
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "aitunnel", model: "gpt-5.6-luna", operation: "web_search" }));
    expect(recordCostEvent).toHaveBeenCalledWith(expect.objectContaining({ category: "web_search", provider: "aitunnel", unit: "request" }));
  });

  it("extracts only provider annotations and preserves nested citation excerpts", () => {
    const parsed = parseAitunnelWebSearchResponse({
      output_text: "Ignore this invented https://not-provider.example URL.",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "Saturn has a ring system.",
          annotations: [{
            type: "url_citation",
            url_citation: {
              title: "NASA Saturn",
              url: "https://science.nasa.gov/saturn/",
              content: "Saturn is a gas giant with a prominent ring system.",
            },
          }],
        }],
      }],
    });

    expect(parsed.toolUsed).toBe(true);
    expect(parsed.results).toEqual([
      expect.objectContaining({
        url: "https://science.nasa.gov/saturn/",
        title: "NASA Saturn",
        excerpt: "Saturn is a gas giant with a prominent ring system.",
      }),
    ]);
    expect(parsed.results.some((result) => result.url?.includes("not-provider"))).toBe(false);
  });

  it("deduplicates URLs and rejects malformed or provider-error responses without CostEvent", async () => {
    expect(parseAitunnelWebSearchResponse({ output_text: "no tool" })).toEqual({ toolUsed: false, results: [] });

    const parsed = parseAitunnelWebSearchResponse({
      output: [{
        type: "web_search_call",
        results: [
          { title: "Duplicate", url: "https://example.com/a", excerpt: "A" },
          { title: "Duplicate again", url: "https://example.com/a", excerpt: "A again" },
          { title: "No URL", excerpt: "Not a source" },
        ],
      }],
    });
    expect(parsed.results).toHaveLength(1);

    const failingCreate = vi.fn().mockRejectedValue(new Error("503 unavailable"));
    createAitunnelSearchClient.mockReturnValue({ responses: { create: failingCreate } });
    await expect(searchAitunnelWebSearch({ prompt: "Saturn" })).rejects.toThrow("503 unavailable");
    expect(recordCostEvent).not.toHaveBeenCalled();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("keeps the search input bounded and includes the research angle", () => {
    const input = buildAitunnelSearchInput({ title: "Saturn", prompt: "Explain planetary science", researchAngle: "official research data" });
    expect(input).toContain("Saturn");
    expect(input).toContain("official research data");
    expect(input.length).toBeLessThanOrEqual(4_000);
  });
});
