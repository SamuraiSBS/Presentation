import { type Source } from "@studydeck/shared";
import crypto from "node:crypto";
import { currentUsageContext, recordCostEvent } from "../usage-ledger.js";

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
};

type TavilySearchResponse = {
  results?: TavilySearchResult[];
};

export type SourceResearchBrief = {
  keyFacts: Array<{ text: string; sourceId: string }>;
  concepts: string[];
  defenseAngle: string;
  warnings: string[];
  sourceIds: string[];
};

export type WebSearchRequest = {
  prompt: string;
  title?: string | null;
};

const TAVILY_QUERY_SAFE_LENGTH = 380;
const SEARCH_TERM_MAX_COUNT = 10;

export async function searchWebSources(request: string | WebSearchRequest): Promise<Source[]> {
  const provider = (process.env.WEB_SEARCH_PROVIDER || "tavily").toLowerCase();
  if (provider !== "tavily") {
    throw new Error(`Unsupported WEB_SEARCH_PROVIDER: ${provider}`);
  }

  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is required for web search generation");
  }

  const maxResults = clampNumber(Number(process.env.WEB_SEARCH_MAX_RESULTS || 6), 1, 20);
  const query = buildTavilyWebSearchQuery(request);
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
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

  const usage = currentUsageContext();
  await recordCostEvent({
    idempotencyKey: crypto.createHash("sha256").update(`${usage?.generationJobId || usage?.queueJobId || "unknown"}:tavily:web:${query}`).digest("hex"),
    category: "web_search",
    provider: "tavily",
    quantity: "1",
    unit: "api_credit",
    unitPrice: process.env.TAVILY_CREDIT_PRICE_USD,
    currency: "USD",
    measurement: "calculated",
  });

  return tavilyResultsToSources((await response.json()) as TavilySearchResponse, request);
}

export function buildTavilyWebSearchQuery(request: string | WebSearchRequest) {
  const { prompt } = normalizeWebSearchRequest(request);
  const topic = extractSearchTopic(request);
  const terms = extractSearchTerms(topic);
  const academicContext = hasLikelyRussianText(topic)
    ? ["факты", "определение", "причины", "последствия", "университетский доклад"]
    : ["facts", "definition", "causes", "consequences", "university report"];
  const query = cleanText([...terms, ...academicContext].join(" "));
  return shortenAtWord(query || cleanText(prompt), TAVILY_QUERY_SAFE_LENGTH);
}

export function tavilyResultsToSources(payload: TavilySearchResponse, request?: string | WebSearchRequest): Source[] {
  const topic = request ? extractSearchTopic(request) : "";
  return (payload.results || []).flatMap((result, index) => {
      const url = cleanText(result.url || "");
      const excerpt = cleanText(result.content || result.raw_content || "");
      if (!url || !excerpt) {
        return [];
      }

      const assessment = assessWebResult({ title: result.title, url, excerpt }, topic);
      if (!assessment.accepted) {
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

      return [{ source, score: assessment.score }];
    })
    .sort((left, right) => right.score - left.score)
    .map(({ source }) => source);
}

export function buildSourceResearchBrief(project: { title: string; prompt: string }, sources: Source[]): SourceResearchBrief {
  const keyFacts = sources
    .map((source) => ({
      text: shortenAtWord(cleanText(source.excerpt || source.label), 260),
      sourceId: source.id,
    }))
    .filter((item) => item.text);
  const sourceIds = [...new Set(keyFacts.map((item) => item.sourceId))];
  const concepts = extractSearchTerms([project.title, project.prompt, ...keyFacts.map((item) => item.text)].join(" "))
    .filter((term) => term.length >= 5)
    .slice(0, 8);

  return {
    keyFacts,
    concepts,
    defenseAngle: buildDefenseAngle(project, keyFacts),
    warnings: keyFacts.length
      ? []
      : ["No reliable web snippets were collected; avoid precise unsupported facts."],
    sourceIds,
  };
}

export function extractSearchTopic(request: string | WebSearchRequest) {
  const { prompt, title } = normalizeWebSearchRequest(request);
  const withoutBrief = cleanText(prompt)
    .replace(/Creation brief:[\s\S]*$/i, " ")
    .replace(/Product focus:[\s\S]*$/i, " ");
  const explicitTopic = extractExplicitTopic(withoutBrief);
  if (explicitTopic) return explicitTopic;
  const cleanTitle = removeInstructionWords(cleanText(title || ""));
  if (cleanTitle && cleanTitle.length >= 3 && !isGenericSearchTitle(cleanTitle)) return cleanTitle;
  const sentences = withoutBrief
    .split(/[.!?\n]+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const ranked = sentences
    .map((sentence, index) => ({
      sentence: removeInstructionWords(sentence),
      score: scoreSearchSentence(sentence, index),
    }))
    .filter((item) => item.sentence)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.sentence || removeInstructionWords(withoutBrief);
}

function normalizeWebSearchRequest(request: string | WebSearchRequest): Required<WebSearchRequest> {
  return typeof request === "string"
    ? { prompt: request, title: "" }
    : { prompt: request.prompt || "", title: request.title || "" };
}

function extractExplicitTopic(value: string) {
  const match = value.match(/(?:\b(?:topic|subject)\b|тема|по\s+теме)\s*:\s*([^\n.!?;]{3,180})/iu);
  if (match) return removeInstructionWords(match[1]);

  // API-created requests commonly describe the subject as "presentation about
  // <topic>, with ...". Exclude delivery requirements from the search topic:
  // they make the relevance filter reject otherwise useful sources.
  const aboutMatch = value.match(/\babout\s+(.+?)(?:(?:,?\s+with\b)|[.!?;]|$)/iu);
  if (!aboutMatch) return "";
  return removeInstructionWords(aboutMatch[1])
    .replace(/^(?:the\s+)?practical\s+use\s+of\s+/i, "")
    .trim();
}

function assessWebResult(result: { title?: string; url: string; excerpt: string }, topic: string) {
  const domain = domainQualityScore(result.url);
  if (domain.reject) return { accepted: false, score: 0 };
  if (!topic) return { accepted: true, score: domain.score };

  const title = normalizeComparableText(result.title || "");
  const url = normalizeComparableText(result.url);
  const excerpt = normalizeComparableText(result.excerpt);
  const topicPhrase = normalizeComparableText(topic);
  const terms = extractSearchTerms(topic)
    .map(normalizeComparableText)
    .filter((term) => term.length >= 4 && !GENERIC_TOPIC_TERMS.has(term));
  const searchableText = `${title} ${url} ${excerpt}`;
  const matchedTerms = terms.flatMap((term) => {
    const variant = [term, transliterateRussian(term)].find((candidate) => searchableText.includes(candidate));
    return variant ? [{ term, variant }] : [];
  });
  const phraseMatch = topicPhrase.length >= 6 && `${title} ${url} ${excerpt}`.includes(topicPhrase);
  const relevance = (phraseMatch ? 5 : 0)
    + matchedTerms.reduce((score, { variant }) => score
      + (title.includes(variant) ? 3 : 0)
      + (url.includes(variant) ? 2 : 0)
      + (excerpt.includes(variant) ? 1 : 0), 0);
  // A lone named entity must be corroborated in the result content as well as
  // its title or URL. This rejects accidental label matches without blocking
  // a focused primary-source page such as NASA's Saturn reference.
  const accepted = phraseMatch || matchedTerms.length >= 2 || (matchedTerms.length === 1 && relevance >= 6);
  return { accepted, score: domain.score + relevance };
}

function domainQualityScore(rawUrl: string) {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { reject: true, score: 0 };
  }
  if (/(?:google\.|yandex\.|bing\.|maps\.|map\.|dictionary|wiktionary|catalog|directory|yellowpages|tripadvisor|pinterest)/.test(host)) {
    return { reject: true, score: 0 };
  }
  if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return { reject: false, score: 1 };
  if (/(?:^|\.)(nasa\.gov|esa\.int|noaa\.gov|nih\.gov|who\.int)$/.test(host)) return { reject: false, score: 5 };
  if (host.endsWith(".edu") || host.endsWith(".ac.uk") || host.endsWith(".edu.au")) return { reject: false, score: 4 };
  if (/(?:nature\.com|science\.org|springer\.com|sciencedirect\.com|thelancet\.com|arxiv\.org|pubmed\.ncbi\.nlm\.nih\.gov)$/.test(host)) return { reject: false, score: 4 };
  if (host.endsWith(".gov") || host.endsWith(".int") || host.endsWith(".org")) return { reject: false, score: 3 };
  return { reject: false, score: 2 };
}

function normalizeComparableText(value: string) {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transliterateRussian(value: string) {
  const alphabet: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return [...value].map((character) => alphabet[character] ?? character).join("");
}

function extractSearchTerms(text: string) {
  const words = cleanText(text)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !SEARCH_STOP_WORDS.has(word.toLowerCase()));

  const result: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (result.some((item) => item.toLowerCase() === key)) continue;
    result.push(word);
    if (result.length >= SEARCH_TERM_MAX_COUNT) break;
  }
  return result;
}

function isGenericSearchTitle(value: string) {
  const meaningfulTerms = extractSearchTerms(value)
    .map((term) => term.toLowerCase())
    .filter((term) => !GENERIC_SEARCH_TITLE_TERMS.has(term));
  return meaningfulTerms.length === 0;
}

function removeInstructionWords(value: string) {
  return cleanText(value)
    .replace(/\b(make|create|prepare|write|explain|show|add|use|generate)\b/gi, " ")
    .replace(/\b(presentation|slides?|deck|report|speech|speaker notes)\b/gi, " ")
    .replace(/(сделай|создай|подготовь|напиши|объясни|покажи|добавь|используй|сгенерируй)/giu, " ")
    .replace(/(презентац\p{L}*|слайд\p{L}*|доклад\p{L}*|выступлени\p{L}*|текст|спикерские заметки)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreSearchSentence(sentence: string, index: number) {
  const text = sentence.toLowerCase();
  let score = Math.max(0, 8 - index);
  if (/тема|topic|about|про|о\s+/i.test(sentence)) score += 3;
  if (/презентац|слайд|доклад|выступлен|presentation|slide|report/.test(text)) score -= 2;
  if (/факт|причин|последств|истори|теори|концепц|definition|cause|history|theory/.test(text)) score += 2;
  score += Math.min(5, sentence.split(/\s+/).length / 3);
  return score;
}

function buildDefenseAngle(project: { title: string; prompt: string }, facts: Array<{ text: string }>) {
  const topic = shortenAtWord(extractSearchTopic(project.title || project.prompt), 120);
  if (!facts.length) {
    return `Frame ${topic || "the topic"} as a cautious university explanation with clear definitions and no unsupported claims.`;
  }
  return `Frame ${topic || "the topic"} through definitions, causes, evidence, and consequences that can support an oral university defense.`;
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

function hasLikelyRussianText(value: string) {
  return /[А-Яа-яЁё]/.test(value);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

const SEARCH_STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "about", "into", "this", "that", "these", "those",
  "как", "что", "это", "для", "при", "про", "или", "без", "над", "под", "его", "её", "ее", "их",
  "нужно", "надо", "можно", "важно", "кратко", "подробно", "понятно", "простым", "языком",
]);

const GENERIC_SEARCH_TITLE_TERMS = new Set([
  "live", "generation", "smoke", "test", "testing", "demo", "project", "new", "studydeck",
]);

const GENERIC_TOPIC_TERMS = new Set([
  "topic", "subject", "presentation", "report", "university", "student",
  "тема", "презентация", "доклад", "университет", "студент",
]);
