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

export type SourceResearchBrief = {
  keyFacts: Array<{ text: string; sourceId: string }>;
  concepts: string[];
  defenseAngle: string;
  warnings: string[];
  sourceIds: string[];
};

const TAVILY_QUERY_MAX_LENGTH = 400;
const TAVILY_QUERY_SAFE_LENGTH = 380;
const SEARCH_TERM_MAX_COUNT = 10;

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
  const topic = extractSearchTopic(prompt);
  const terms = extractSearchTerms(topic);
  const academicContext = hasLikelyRussianText(topic)
    ? ["факты", "определение", "причины", "последствия", "университетский доклад"]
    : ["facts", "definition", "causes", "consequences", "university report"];
  const query = cleanText([...terms, ...academicContext].join(" "));
  return shortenAtWord(query || cleanText(prompt), TAVILY_QUERY_SAFE_LENGTH);
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

function extractSearchTopic(prompt: string) {
  const withoutBrief = cleanText(prompt)
    .replace(/Creation brief:[\s\S]*$/i, " ")
    .replace(/Product focus:[\s\S]*$/i, " ");
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
