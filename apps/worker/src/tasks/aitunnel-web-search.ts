import crypto from "node:crypto";
import { createAitunnelSearchClient } from "../openai-client.js";
import { currentUsageContext, normalizeOpenAIUsage, recordAiUsage, recordCostEvent } from "../usage-ledger.js";

export type AitunnelWebSearchRequest = {
  prompt: string;
  title?: string | null;
  researchAngle?: string;
  costEnvelopeRub?: string;
};

export type AitunnelWebSearchResult = {
  title?: string;
  url?: string;
  content?: string;
  excerpt?: string;
  snippet?: string;
  description?: string;
};

type AitunnelResponse = {
  id?: unknown;
  output?: unknown;
  output_text?: unknown;
  usage?: unknown;
  [key: string]: unknown;
};

type ResponsesClient = {
  responses: {
    create: (request: Record<string, unknown>) => Promise<unknown>;
  };
};

export type AitunnelWebSearchRun = {
  model: string;
  toolUsed: boolean;
  results: AitunnelWebSearchResult[];
  responseId?: string;
};

export type AitunnelWebSearchDependencies = {
  client?: ResponsesClient;
  now?: () => Date;
};

const DEFAULT_ENGINE = "auto";
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_USES = 1;

/**
 * Execute exactly one AITUNNEL Responses request. The custom tool is kept in
 * the raw request shape because the OpenAI SDK does not know this provider's
 * namespaced tool type, but it still serializes the request to /v1/responses.
 */
export async function searchAitunnelWebSearch(
  request: AitunnelWebSearchRequest,
  dependencies: AitunnelWebSearchDependencies = {},
): Promise<AitunnelWebSearchRun> {
  const model = (process.env.AITUNNEL_SEARCH_MODEL || "gpt-5.6-luna").trim();
  const engine = cleanText(process.env.AITUNNEL_WEB_SEARCH_ENGINE || DEFAULT_ENGINE) || DEFAULT_ENGINE;
  const maxResults = clampNumber(Number(process.env.AITUNNEL_WEB_SEARCH_MAX_RESULTS || DEFAULT_MAX_RESULTS), 1, 20);
  const maxUses = clampNumber(Number(process.env.AITUNNEL_WEB_SEARCH_MAX_USES || DEFAULT_MAX_USES), 1, 1);
  const query = buildAitunnelSearchInput(request);
  const startedAt = dependencies.now?.() || new Date();
  const client = dependencies.client || (createAitunnelSearchClient() as unknown as ResponsesClient);
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: "Research the requested topic with the provided web-search tool. Use only tool-returned sources; do not invent URLs or citations.",
      },
      { role: "user", content: query },
    ],
    tools: [{
      type: "aitunnel:web_search",
      parameters: { engine, max_results: maxResults, max_uses: maxUses },
    }],
    // AITUNNEL currently supports required tool selection. There is no
    // automatic required->auto retry because that would spend a second call.
    tool_choice: "required",
  });
  const finishedAt = dependencies.now?.() || new Date();
  const parsed = parseAitunnelWebSearchResponse(response);
  if (!parsed.toolUsed) throw new Error("AITUNNEL web search response was malformed");

  await recordAiUsage({
    provider: "aitunnel",
    model,
    operation: "web_search",
    stage: "researching",
    providerRequestId: stringValue(asRecord(response)?.id),
    usage: normalizeOpenAIUsage(asRecord(response)?.usage),
    startedAt,
    finishedAt,
  });
  const usage = currentUsageContext();
  await recordCostEvent({
    idempotencyKey: crypto.createHash("sha256").update(`${usage?.generationJobId || usage?.queueJobId || "unknown"}:aitunnel:web:${model}:${query}`).digest("hex"),
    category: "web_search",
    provider: "aitunnel",
    quantity: "1",
    unit: "request",
    currency: "RUB",
    measurement: "provider_reported",
  });

  return {
    model,
    toolUsed: parsed.toolUsed,
    results: parsed.results,
    responseId: stringValue(asRecord(response)?.id),
  };
}

export function buildAitunnelSearchInput(request: AitunnelWebSearchRequest) {
  return shortenAtWord([
    request.title,
    request.prompt,
    request.researchAngle,
    "Return at least three distinct authoritative sources with substantive excerpts.",
  ].filter(Boolean).map((value) => cleanText(String(value))).filter(Boolean).join("\n"), 4_000);
}

export function parseAitunnelWebSearchResponse(value: unknown): { toolUsed: boolean; results: AitunnelWebSearchResult[] } {
  const response = asRecord(value);
  if (!response) return { toolUsed: false, results: [] };

  const results: AitunnelWebSearchResult[] = [];
  let toolUsed = false;
  const addCandidates = (valueToRead: unknown, fallbackExcerpt = "") => {
    if (!Array.isArray(valueToRead)) return;
    toolUsed = true;
    for (const item of valueToRead) {
      const candidate = asRecord(item);
      if (!candidate) continue;
      const url = firstString(candidate.url, candidate.source_url, candidate.sourceUrl, candidate.link);
      if (!url) continue;
      const excerpt = firstString(candidate.excerpt, candidate.content, candidate.snippet, candidate.description, fallbackExcerpt);
      results.push({
        title: firstString(candidate.title, candidate.name, candidate.label),
        url,
        excerpt,
        content: firstString(candidate.content),
        snippet: firstString(candidate.snippet),
        description: firstString(candidate.description),
      });
    }
  };

  addCandidates(response.results);
  addCandidates(response.sources);
  addCandidates(response.citations);
  addCandidates(response.annotations);
  addCandidates(response.web_search_results);

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    const outputItem = asRecord(item);
    if (!outputItem) continue;
    const outputType = firstString(outputItem.type).toLowerCase();
    if (outputType.includes("web_search") || outputType.includes("search_result") || outputType === "source") toolUsed = true;
    addCandidates(outputItem.results);
    addCandidates(outputItem.sources);
    addCandidates(outputItem.citations);
    addCandidates(outputItem.annotations);

    const content = Array.isArray(outputItem.content) ? outputItem.content : [];
    const messageText = content
      .map((part) => asRecord(part))
      .map((part) => firstString(part?.text))
      .filter(Boolean)
      .join(" ");
    for (const part of content) {
      const contentItem = asRecord(part);
      if (!contentItem) continue;
      const contentType = firstString(contentItem.type).toLowerCase();
      if (contentType.includes("web_search") || contentType.includes("citation")) toolUsed = true;
      addCandidates(contentItem.annotations, messageText);
      addCandidates(contentItem.citations, messageText);
      addCandidates(contentItem.results, messageText);
    }
  }

  return { toolUsed, results: uniqueResults(results) };
}

function uniqueResults(results: AitunnelWebSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const url = cleanText(result.url || "");
    if (!isHttpUrl(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstString(...values: unknown[]) {
  return values.map((value) => cleanText(typeof value === "string" ? value : "")).find(Boolean) || "";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanText(value: string) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function shortenAtWord(value: string, maxLength: number) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(" ");
  return (lastSpace > 80 ? shortened.slice(0, lastSpace) : shortened).trim();
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
