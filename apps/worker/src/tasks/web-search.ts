import { type Source } from "@studydeck/shared";

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
};

type TavilySearchResponse = {
  results?: TavilySearchResult[];
};

const TAVILY_QUERY_MAX_LENGTH = 400;
const TAVILY_QUERY_SAFE_LENGTH = 380;

export async function searchWebSources(prompt: string): Promise<Source[]> {
  const provider = (process.env.WEB_SEARCH_PROVIDER || "tavily").toLowerCase();
  if (provider !== "tavily") {
    throw new Error(`Unsupported WEB_SEARCH_PROVIDER: ${provider}`);
  }

  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is required for web search generation");
  }

  const maxResults = clampNumber(Number(process.env.WEB_SEARCH_MAX_RESULTS || 6), 1, 20);
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: buildTavilyWebSearchQuery(prompt),
      search_depth: "basic",
      max_results: maxResults,
      country: "russia",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status} ${await response.text()}`);
  }

  return tavilyResultsToSources((await response.json()) as TavilySearchResponse);
}

export function buildTavilyWebSearchQuery(prompt: string) {
  const cleaned = cleanText(prompt);
  if (cleaned.length <= TAVILY_QUERY_MAX_LENGTH) {
    return cleaned;
  }

  const shortened = cleaned.slice(0, TAVILY_QUERY_SAFE_LENGTH);
  const lastSpace = shortened.lastIndexOf(" ");
  return (lastSpace > 80 ? shortened.slice(0, lastSpace) : shortened).trim();
}

export function tavilyResultsToSources(payload: TavilySearchResponse): Source[] {
  return (payload.results || []).flatMap((result, index) => {
      const url = cleanText(result.url || "");
      const excerpt = cleanText(result.content || result.raw_content || "");
      if (!url || !excerpt) {
        return [];
      }

      const source: Source = {
        id: `web-${index + 1}`,
        label: cleanText(result.title || url).slice(0, 180),
        type: "WEB",
        size: 0,
        excerpt: excerpt.slice(0, 1400),
        url,
      };

      return [source];
    });
}

function cleanText(value: string) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}
