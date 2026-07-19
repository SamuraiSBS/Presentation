import crypto from "node:crypto";
import { generateText } from "ai";
import { z } from "zod";
import { requestYandexText } from "../presentation/narration/processing.js";
import { requestOpenAIStructuredWithSdk } from "../presentation/providers/generation.js";
import { selectAiProviders } from "../presentation/providers/provider-selection.js";

export type DefenseAnalysisChunk = {
  id: string;
  sourceId: string;
  sourceRole: string;
  locator: string;
  excerpt: string;
  text: string;
};

const candidateFactSchema = z.object({
  key: z.string().trim().min(1).max(120),
  statement: z.string().trim().min(3).max(1200),
  evidenceChunkIds: z.array(z.string().min(1)).min(1).max(4),
});

const candidateRequirementSchema = z.object({
  key: z.string().trim().min(1).max(120),
  text: z.string().trim().min(3).max(1200),
  priority: z.enum(["required", "recommended", "preference"]),
  evidenceChunkId: z.string().min(1),
  rule: z.object({
    kind: z.enum(["slide_position", "slide_count", "timing", "required_field", "asset_count", "palette", "freeform"]).default("freeform"),
    slideOrder: z.number().int().min(1).max(20).optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    field: z.string().trim().max(120).optional(),
    assetRole: z.string().trim().max(80).optional(),
    value: z.string().trim().max(300).optional(),
  }).default({ kind: "freeform" }),
});

const candidateAnalysisSchema = z.object({
  facts: z.array(candidateFactSchema).max(80).default([]),
  requirements: z.array(candidateRequirementSchema).max(100).default([]),
});

export type DefenseCandidateAnalysis = z.infer<typeof candidateAnalysisSchema> & {
  conflicts: Array<{
    key: string;
    kind: "fact" | "requirement";
    summary: string;
    options: Array<{ statement: string; evidenceChunkIds: string[] }>;
  }>;
  provider: "openai" | "yandex" | "deterministic";
};

export async function analyzeDefenseCandidates(
  chunks: DefenseAnalysisChunk[],
  dependencies: {
    generate?: (prompt: string) => Promise<unknown>;
    providers?: Array<"openai" | "yandex">;
  } = {},
): Promise<DefenseCandidateAnalysis> {
  const allowedChunks = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const prompt = buildDefenseAnalysisPrompt(chunks);
  let raw: unknown;
  let provider: DefenseCandidateAnalysis["provider"] = "deterministic";

  if (dependencies.generate) {
    raw = await dependencies.generate(prompt);
    provider = "openai";
  } else {
    const providers = dependencies.providers || selectAiProviders();
    for (const candidate of providers) {
      try {
        if (candidate === "openai") {
          raw = await requestOpenAIStructuredWithSdk({
            generate: generateText,
            system: DEFENSE_ANALYSIS_SYSTEM,
            prompt,
            schema: candidateAnalysisSchema,
            schemaName: "studydeck_defense_analysis",
            temperature: 0.1,
          });
        } else {
          const apiKey = process.env.YANDEX_API_KEY?.trim();
          if (!apiKey) continue;
          const text = await requestYandexText(apiKey, DEFENSE_ANALYSIS_SYSTEM, prompt, { jsonObject: true, temperature: 0.1, maxTokens: 7000 });
          raw = parseJsonObject(text);
        }
        provider = candidate;
        break;
      } catch {
        // The dispatcher records the final job error if every strategy fails.
        // Falling back here remains safe because deterministic extraction only
        // promotes literal source statements with evidence.
      }
    }
  }

  // A provider may return syntactically valid JSON that still does not match
  // the evidence contract (for example, facts as strings instead of objects).
  // Do not let that malformed optional enrichment block the evidence-first
  // workflow: fall back to literal, source-backed extraction instead.
  const candidate = raw === undefined ? null : candidateAnalysisSchema.safeParse(raw);
  const parsed = candidate?.success
    ? candidate.data
    : deterministicCandidateAnalysis(chunks);
  if (candidate && !candidate.success) provider = "deterministic";
  const facts = parsed.facts
    .map((fact) => ({
      ...fact,
      evidenceChunkIds: unique(fact.evidenceChunkIds).filter((id) => {
        const chunk = allowedChunks.get(id);
        return chunk ? evidenceSupportsClaim(fact.statement, chunk.text) : false;
      }),
    }))
    .filter((fact) => fact.evidenceChunkIds.length > 0);
  const requirements = parsed.requirements.filter((requirement) => {
    const chunk = allowedChunks.get(requirement.evidenceChunkId);
    return chunk ? evidenceSupportsClaim(requirement.text, chunk.text) : false;
  });
  const normalized = {
    facts: dedupeByKey(facts),
    requirements: dedupeByKey(requirements),
  };

  return {
    ...normalized,
    conflicts: findCandidateConflicts(facts, requirements),
    provider,
  };
}

export function buildDefenseAnalysisPrompt(chunks: DefenseAnalysisChunk[]) {
  const serialized = chunks.slice(0, 120).map((chunk) => ({
    id: chunk.id,
    sourceRole: chunk.sourceRole,
    locator: chunk.locator,
    text: chunk.text.slice(0, 1800),
  }));
  return [
    "Извлеки подтверждённые факты о проекте и формальные требования к защите.",
    "Верни только JSON вида {facts:[], requirements:[]}.",
    "Правила достоверности:",
    "- каждый факт обязан дословно опираться хотя бы на один evidenceChunkIds из входа;",
    "- не делай выводов по имени файла, интерфейсу или общим знаниям;",
    "- не используй интернет и не дополняй отсутствующие сведения;",
    "- технические свойства проекта не смешивай с правилами выступления;",
    "- дизайн-пожелание не является фактом о продукте;",
    "- priority required только для явных слов 'обязательно', 'должен', 'необходимо' или точного ограничения;",
    "- rule.kind используй только когда правило можно проверить детерминированно, иначе freeform.",
    `Фрагменты с неизменяемыми ID:\n${JSON.stringify(serialized)}`,
  ].join("\n");
}

const DEFENSE_ANALYSIS_SYSTEM = [
  "Ты аккуратный аналитик студенческого проектного ТЗ.",
  "Запрещено придумывать факты или подтверждать догадки.",
  "Любой факт без существующего evidence chunk должен быть отброшен.",
  "Пиши пользовательский текст по-русски.",
].join(" ");

function deterministicCandidateAnalysis(chunks: DefenseAnalysisChunk[]): z.infer<typeof candidateAnalysisSchema> {
  const facts: z.infer<typeof candidateFactSchema>[] = [];
  const requirements: z.infer<typeof candidateRequirementSchema>[] = [];
  for (const chunk of chunks) {
    const sentences = chunk.text.split(/(?<=[.!?])\s+|\n+/).map(cleanText).filter(Boolean);
    for (const sentence of sentences) {
      if (sentence.length < 24 || sentence.length > 700 || sentence.endsWith("?")) continue;
      if (isRequirementSentence(sentence) || ["technical_spec", "defense_spec"].includes(chunk.sourceRole)) {
        if (isRequirementSentence(sentence)) {
          requirements.push({
            key: stableKey(sentence),
            text: sentence,
            priority: /\b(?:обязательно|должен|должна|должны|необходимо|требуется)\b/iu.test(sentence) ? "required" : "recommended",
            evidenceChunkId: chunk.id,
            rule: { kind: "freeform" },
          });
        }
        continue;
      }
      if (["project_document", "repository_document", "archive_document"].includes(chunk.sourceRole)) {
        facts.push({ key: stableKey(sentence), statement: sentence, evidenceChunkIds: [chunk.id] });
      }
    }
  }
  return candidateAnalysisSchema.parse({ facts: facts.slice(0, 50), requirements: requirements.slice(0, 70) });
}

function findCandidateConflicts(
  facts: Array<z.infer<typeof candidateFactSchema>>,
  requirements: Array<z.infer<typeof candidateRequirementSchema>>,
): DefenseCandidateAnalysis["conflicts"] {
  const conflicts: DefenseCandidateAnalysis["conflicts"] = [];
  const groups = new Map<string, Array<z.infer<typeof candidateFactSchema>>>();
  for (const fact of facts) groups.set(fact.key, [...(groups.get(fact.key) || []), fact]);
  for (const [key, group] of groups) {
    const statements = unique(group.map((item) => normalizeComparison(item.statement)));
    if (statements.length <= 1) continue;
    conflicts.push({
      key: `fact:${key}`,
      kind: "fact",
      summary: "Источники содержат разные формулировки одного факта",
      options: group.map((item) => ({ statement: item.statement, evidenceChunkIds: item.evidenceChunkIds })),
    });
  }
  const requirementGroups = new Map<string, Array<z.infer<typeof candidateRequirementSchema>>>();
  for (const requirement of requirements) requirementGroups.set(requirement.key, [...(requirementGroups.get(requirement.key) || []), requirement]);
  for (const [key, group] of requirementGroups) {
    if (unique(group.map((item) => normalizeComparison(item.text))).length <= 1) continue;
    conflicts.push({
      key: `requirement:${key}`,
      kind: "requirement",
      summary: "Документы задают разные варианты одного требования",
      options: group.map((item) => ({ statement: item.text, evidenceChunkIds: [item.evidenceChunkId] })),
    });
  }
  return conflicts;
}

function dedupeByKey<T extends { key: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.key)) map.set(item.key, item);
  return [...map.values()];
}

function stableKey(value: string) {
  return crypto.createHash("sha1").update(normalizeComparison(value)).digest("hex").slice(0, 20);
}

function isRequirementSentence(value: string) {
  return /\b(?:обязательно|должен|должна|должны|необходимо|требуется|следует|не более|не менее|слайд(?:е|ов|а)?|минут)\b/iu.test(value);
}

function normalizeComparison(value: string) {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
}

export function evidenceSupportsClaim(claim: string, sourceText: string) {
  const normalizedClaim = normalizeComparison(claim);
  const normalizedSource = normalizeComparison(sourceText);
  if (!normalizedClaim || !normalizedSource) return false;
  if (normalizedSource.includes(normalizedClaim)) return true;

  const claimNumbers = normalizedClaim.match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
  if (claimNumbers.some((number) => !normalizedSource.includes(number))) return false;

  const claimTokens = meaningfulEvidenceTokens(normalizedClaim);
  if (claimTokens.length < 3) return false;
  const sourceTokens = new Set(meaningfulEvidenceTokens(normalizedSource));
  const supported = claimTokens.filter((token) => sourceTokens.has(token)).length;
  return supported / claimTokens.length >= 0.85;
}

function meaningfulEvidenceTokens(value: string) {
  return value
    .split(/\s+/)
    .map((token) => token.replace(/^(?:и|в|во|на|по|для|из|с|со|к|ко|о|об|от|до|а|но|или)$/u, ""))
    .filter((token) => token.length >= 4)
    .map((token) => token.slice(0, 8));
}

function cleanText(value: string) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function parseJsonObject(value: string) {
  const cleaned = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}
