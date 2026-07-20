import crypto from "node:crypto";
import OpenAI from "openai";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { captureGenerationError, errorLogFields, logger } from "../../../observability.js";
import { normalizeOpenAIUsage, recordAiUsage } from "../../../usage-ledger.js";
import {
  type DesignBrief,
  type DeckStory,
  type GenerationPipelineArtifacts,
  type Highlight,
  type KeyConcept,
  type PresentationDocument,
  type QualityCritique,
  type QualityIssue,
  type ResearchBrief,
  type Slide,
  type SlideBlock,
  type SlideBlueprint,
  type SlideDefinition,
  type SlideKind,
  type SlideLayout,
  type SlideNarrative,
  type SlideTextPlan,
  type SlideVisual,
  type MermaidDiagramSpec,
  type Source,
  PREMIUM_PRESENTATION_THEMES,
  PREMIUM_PRESENTATION_THEME_IDS,
  SLIDE_LAYOUT_DEFINITIONS,
  deckStorySchema,
  designBriefSchema,
  generationPipelineArtifactsSchema,
  hasMeasurableValue,
  presentationSchema,
  qualityCritiqueSchema,
  researchBriefSchema,
  resolvePresentationTheme,
  mermaidDiagramSpecSchema,
  slideBlueprintSchema,
  slideNarrativeSchema,
  slideTextPlanSchema,
} from "@studydeck/shared";
import {
  improvePresentationQuality,
  type QualityRepairResponse,
} from "../../presentation-quality.js";

type ProjectInput = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
};

type AiGenerationMode = "openai" | "yandex";
type FallbackGenerationMode = "demo" | "demo-fallback";
type EnvLike = Record<string, string | undefined>;

type NarrationSection = {
  order: number;
  title: string;
  text: string;
};

type SlideTextIssue = {
  slideOrder: number;
  fields: string[];
  reasons: string[];
};

type SlideTextRepair = {
  slideOrder: number;
  title?: unknown;
  thesis?: unknown;
  bullets?: unknown;
  blocks?: unknown;
  definition?: unknown;
  visual?: unknown;
};

type SlideTextRepairResponse = {
  slides?: SlideTextRepair[];
};

type QualityModelCallbacks = {
  critique?: (presentation: PresentationDocument, deterministic: QualityCritique) => Promise<unknown>;
  repair?: (presentation: PresentationDocument, issues: QualityIssue[], attempt: number) => Promise<unknown>;
};

type GenerateStructuredOptions<T> = {
  provider: AiGenerationMode;
  system: string;
  prompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
  parse?: (value: unknown) => T;
  openAIClient?: OpenAI;
  openAIGenerateText?: typeof generateText;
  yandexApiKey?: string;
  jsonSchema?: Record<string, unknown>;
  strict?: boolean;
  maxAttempts?: number;
  temperature?: number;
  yandexModelTier?: YandexModelTier;
};

type GenerateAndValidateOptions<T> = {
  call: (attempt: number, repairPrompt?: string) => Promise<unknown>;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
  provider?: AiGenerationMode;
  parse?: (value: unknown) => T;
  repair?: (error: unknown, previousValue: unknown, attempt: number) => string;
  maxAttempts?: number;
};

export class StructuredGenerationError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly validationError: unknown,
  ) {
    const detail = validationError instanceof Error ? validationError.message : String(validationError);
    super(`Structured generation for ${schemaName} failed validation: ${detail}`);
    this.name = "StructuredGenerationError";
  }
}

type YandexTextOptions = {
  jsonObject?: boolean;
  jsonSchema?: unknown;
  temperature?: number;
  maxTokens?: number;
};

type PromptArtifacts = Partial<Pick<GenerationPipelineArtifacts, "researchBrief" | "deckStory" | "designBrief" | "slideBlueprints" | "slideTextPlans">>;

import type { YandexCompletionResponse } from "../constants.js";
import { STUDENT_CREATION_BRIEF_LINES, NARRATION_SYSTEM_PROMPT, SYSTEM_PROMPT, QUALITY_CRITIC_SYSTEM_PROMPT, QUALITY_REPAIR_SYSTEM_PROMPT, GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES, TEMPLATE_TEXT_PATTERNS, GENERIC_TITLES, STOP_WORDS, REMOVED_SLIDE_LAYOUTS, SLIDE_LAYOUTS, CONTENT_LAYOUT_CYCLE } from "../constants.js";
import { buildResearchBrief, buildDesignBrief, logStructuredGenerationValidationFailure, buildDeckStory, buildSlideBlueprints, buildSlideTextPlans, normalizeNarrativePlan } from "../planning/builders.js";
import { shouldRetryNarration, requestYandexText, normalizeNarrationText } from "../narration/processing.js";
import { buildNarrativePlanPrompt, buildDesignBriefPrompt, buildNarrationPrompt, buildNarrationRepairPrompt, buildGenerationPrompt } from "../prompts/builders.js";
import type { YandexModelTier } from "../prompts/builders.js";
import { ensureDesignBriefDirections } from "../normalization/presentation.js";
import { finalizeGeneratedPresentation, repairSlideTextWithOpenAI, repairSlideTextWithYandex, critiquePresentationQualityWithOpenAI, critiquePresentationQualityWithYandex, repairPresentationQualityWithOpenAI, repairPresentationQualityWithYandex } from "../quality/orchestration.js";
import { parseJsonText } from "../utilities.js";
import { jsonSchema, narrativePlanJsonSchema, designBriefJsonSchema } from "../schemas.js";

export async function generateWithOpenAI(project: ProjectInput, sources: Source[]) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("openai", project, sources, researchBrief, { openAIClient: client });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan);
  const narrationText = await generateOpenAINarration(client, project, sources, narrativePlan, researchBrief);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "openai",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { openAIClient: client },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  const parsed = await generatePresentationDocumentWithProvider("openai", project, sources, narrationText, narrativePlan, {
    researchBrief,
    deckStory,
    designBrief,
    slideBlueprints,
    slideTextPlans,
    openAIClient: client,
  });

  return finalizeGeneratedPresentation(parsed, project, sources, "openai", narrationText, narrativePlan, (presentation, issues) =>
    repairSlideTextWithOpenAI(client, presentation, issues),
  {
    critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic),
    repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt),
  },
  designBrief);
}

export async function generateOpenAIPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("openai", project, sources, researchBrief, { openAIClient: client });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "openai",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { openAIClient: client },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  const parsed = await generatePresentationDocumentWithProvider("openai", project, sources, narrationText, narrativePlan, {
    researchBrief,
    deckStory,
    designBrief,
    slideBlueprints,
    slideTextPlans,
    openAIClient: client,
  });

  return finalizeGeneratedPresentation(parsed, project, sources, "openai", narrationText, narrativePlan, (presentation, issues) =>
    repairSlideTextWithOpenAI(client, presentation, issues),
  {
    critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic),
    repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt),
  },
  designBrief);
}

export async function generateOpenAINarration(client: OpenAI, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
  let prompt = buildNarrationPrompt(project, sources, narrativePlan, researchBrief);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let outputText = "";
    try {
      const startedAt = new Date();
      const narrationResponse = await client.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: NARRATION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });
      await recordOpenAIResponse(narrationResponse, "narration", "studydeck_narration", startedAt);
      outputText = narrationResponse.output_text || "";
      return normalizeNarrationText(outputText, project);
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !shouldRetryNarration(error)) {
        break;
      }

      prompt = buildNarrationRepairPrompt(project, sources, narrativePlan, outputText, error, researchBrief);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateWithYandex(project: ProjectInput, sources: Source[]) {
  const apiKey = process.env.YANDEX_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required");
  }

  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("yandex", project, sources, researchBrief, { yandexApiKey: apiKey });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan);
  const narrationText = await generateYandexNarration(apiKey, project, sources, narrativePlan, researchBrief);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "yandex",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { yandexApiKey: apiKey },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  let parsed: unknown;
  try {
    parsed = await generatePresentationDocumentWithProvider("yandex", project, sources, narrationText, narrativePlan, {
      researchBrief,
      deckStory,
      designBrief,
      slideBlueprints,
      slideTextPlans,
      yandexApiKey: apiKey,
    });
  } catch (error) {
    logger.warn({ projectId: project.id, stage: "building_slides", provider: "yandex", ...errorLogFields(error) }, "structured presentation generation failed; using narration fallback document");
    parsed = {};
  }
  return finalizeGeneratedPresentation(
    parsed,
    project,
    sources,
    "yandex",
    narrationText,
    narrativePlan,
    (presentation, issues) => repairSlideTextWithYandex(apiKey, presentation, issues),
    {
      critique: (presentation, deterministic) => critiquePresentationQualityWithYandex(apiKey, presentation, deterministic),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithYandex(apiKey, presentation, issues, attempt),
    },
    designBrief,
  );
}

export async function generateYandexPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
  const apiKey = process.env.YANDEX_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required");
  }

  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("yandex", project, sources, researchBrief, { yandexApiKey: apiKey });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "yandex",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { yandexApiKey: apiKey },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  let parsed: unknown;
  try {
    parsed = await generatePresentationDocumentWithProvider("yandex", project, sources, narrationText, narrativePlan, {
      researchBrief,
      deckStory,
      designBrief,
      slideBlueprints,
      slideTextPlans,
      yandexApiKey: apiKey,
    });
  } catch (error) {
    logger.warn({ projectId: project.id, stage: "building_slides", provider: "yandex", ...errorLogFields(error) }, "structured presentation generation failed; using narration fallback document");
    parsed = {};
  }
  return finalizeGeneratedPresentation(
    parsed,
    project,
    sources,
    "yandex",
    narrationText,
    narrativePlan,
    (presentation, issues) => repairSlideTextWithYandex(apiKey, presentation, issues),
    {
      critique: (presentation, deterministic) => critiquePresentationQualityWithYandex(apiKey, presentation, deterministic),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithYandex(apiKey, presentation, issues, attempt),
    },
    designBrief,
  );
}

export async function generateYandexNarration(apiKey: string, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
  let prompt = buildNarrationPrompt(project, sources, narrativePlan, researchBrief);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let outputText = "";
    try {
      outputText = await requestYandexText(apiKey, NARRATION_SYSTEM_PROMPT, prompt, { jsonObject: false });
      return normalizeNarrationText(outputText, project);
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !shouldRetryNarration(error)) {
        break;
      }

      prompt = buildNarrationRepairPrompt(project, sources, narrativePlan, outputText, error, researchBrief);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateNarrativePlanWithProvider(
  provider: AiGenerationMode,
  project: ProjectInput,
  sources: Source[],
  researchBrief: ResearchBrief,
  options: Pick<GenerateStructuredOptions<SlideNarrative[]>, "openAIClient" | "yandexApiKey">,
): Promise<SlideNarrative[]> {
  return generateStructuredWithProvider<SlideNarrative[]>({
    provider,
    system: "You are the story planner for StudyDeck. Create only a concise Russian slide-by-slide narrative plan. Return JSON only.",
    prompt: buildNarrativePlanPrompt(project, sources, researchBrief),
    schema: z.array(slideNarrativeSchema),
    schemaName: "studydeck_narrative_plan",
    parse: (value) => normalizeNarrativePlan(value, project),
    jsonSchema: narrativePlanJsonSchema,
    yandexModelTier: "economy",
    ...options,
  });
}

export async function generateDesignBriefWithProvider(
  provider: AiGenerationMode,
  project: ProjectInput,
  sources: Source[],
  researchBrief: ResearchBrief,
  narrativePlan: SlideNarrative[],
  deckStory: DeckStory,
  slideTextPlans: SlideTextPlan[],
  options: Pick<GenerateStructuredOptions<DesignBrief>, "openAIClient" | "yandexApiKey">,
): Promise<DesignBrief> {
  try {
    return await generateStructuredWithProvider<DesignBrief>({
      provider,
      system: "You are an art director for StudyDeck. Create a design brief only; never output CSS, HTML, or exact coordinates.",
      prompt: buildDesignBriefPrompt(project, sources, researchBrief, narrativePlan, deckStory, slideTextPlans),
      schema: designBriefSchema as z.ZodType<DesignBrief>,
      schemaName: "studydeck_design_brief",
      parse: (value): DesignBrief => ensureDesignBriefDirections(designBriefSchema.parse(parseJsonOutput(value)), project, narrativePlan),
      jsonSchema: designBriefJsonSchema,
      maxAttempts: 1,
      yandexModelTier: "economy",
      ...options,
    });
  } catch (error) {
    logger.warn({ projectId: project.id, stage: "design_brief", provider, ...errorLogFields(error) }, "design brief generation failed; using deterministic art direction");
    return buildDesignBrief(project, researchBrief, narrativePlan);
  }
}

export async function generatePresentationDocumentWithProvider(
  provider: AiGenerationMode,
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
  narrativePlan: SlideNarrative[],
  options: PromptArtifacts & Pick<GenerateStructuredOptions<unknown>, "openAIClient" | "yandexApiKey">,
) {
  return generateStructuredWithProvider({
    provider,
    system: SYSTEM_PROMPT,
    prompt: buildGenerationPrompt(project, sources, narrationText, narrativePlan, options),
    schema: z.unknown(),
    schemaName: "studydeck_presentation",
    parse: parseJsonOutput,
    jsonSchema,
    strict: false,
    openAIClient: options.openAIClient,
    yandexApiKey: options.yandexApiKey,
  });
}

export async function generateStructuredWithProvider<T>({
  provider,
  system,
  prompt,
  schema,
  schemaName,
  parse,
  openAIClient,
  openAIGenerateText,
  yandexApiKey,
  jsonSchema: schemaJson,
  strict = true,
  maxAttempts = 2,
  temperature = 0.25,
  yandexModelTier = "primary",
}: GenerateStructuredOptions<T>): Promise<T> {
  if (provider === "openai") {
    const sdkGenerateText = openAIGenerateText || generateText;
    const legacyClient = openAIClient;
    return generateAndValidate({
      schema,
      schemaName,
      parse,
      maxAttempts,
      provider,
      call: async (attempt, repairPrompt) => {
        logStructuredGenerationAttempt(provider, schemaName, attempt);
        if (legacyClient && !openAIGenerateText) {
          return requestOpenAIStructuredLegacy({
            client: legacyClient,
            system,
            prompt,
            repairPrompt,
            schemaName,
            schemaJson,
            strict,
          });
        }
        return requestOpenAIStructuredWithSdk({
          generate: sdkGenerateText,
          system,
          prompt,
          repairPrompt,
          schema,
          schemaName,
          temperature,
        });
      },
      repair: (error, previousValue) => buildStructuredRepairPrompt(prompt, schemaName, error, previousValue),
    });
  }

  const apiKey = yandexApiKey?.trim();
  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required");
  }

  return generateAndValidate({
    schema,
    schemaName,
    parse,
    maxAttempts,
    provider,
    call: (attempt, repairPrompt) => {
      logStructuredGenerationAttempt(provider, schemaName, attempt);
      return requestYandexText(apiKey, system, repairPrompt || withJsonPromptRules(prompt), {
        ...(schemaJson ? { jsonSchema: schemaJson } : { jsonObject: true }),
        modelTier: yandexModelTier,
      });
    },
    repair: (error, previousValue) => buildStructuredRepairPrompt(prompt, schemaName, error, previousValue),
  });
}

export async function requestOpenAIStructuredWithSdk<T>({
  generate,
  system,
  prompt,
  repairPrompt,
  schema,
  schemaName,
  temperature,
}: {
  generate: typeof generateText;
  system: string;
  prompt: string;
  repairPrompt?: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
  temperature: number;
}) {
  const startedAt = new Date();
  const apiKey = process.env.OPENAI_API_KEY;
  const provider = createOpenAI(apiKey ? { apiKey } : undefined);
  const model = provider(process.env.OPENAI_MODEL || "gpt-4.1-mini");
  const output = isUnknownSchema(schema)
    ? Output.json({ name: schemaName })
    : Output.object({
        schema,
        name: schemaName,
        description: "StudyDeck structured generation output. User-facing educational text should be in Russian.",
      });
  try {
    const result = await generate({
      model,
      system,
      prompt: repairPrompt || withJsonPromptRules(prompt),
      output,
      temperature,
    });
    const metadata = result as unknown as Record<string, unknown>;
    const response = metadata.response as Record<string, unknown> | undefined;
    await recordAiUsage({ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", operation: "structured_generation", schemaName, providerRequestId: typeof response?.id === "string" ? response.id : undefined, usage: normalizeOpenAIUsage(metadata.usage), startedAt });
    return result.output;
  } catch (error) {
    await recordAiUsage({ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", operation: "structured_generation", schemaName, startedAt, error });
    throw error;
  }
}

export async function requestOpenAIStructuredLegacy({
  client,
  system,
  prompt,
  repairPrompt,
  schemaName,
  schemaJson,
  strict,
}: {
  client: OpenAI;
  system: string;
  prompt: string;
  repairPrompt?: string;
  schemaName: string;
  schemaJson?: Record<string, unknown>;
  strict: boolean;
}) {
  const startedAt = new Date();
  try {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: repairPrompt || withJsonPromptRules(prompt) },
    ],
    text: schemaJson
      ? {
          format: {
            type: "json_schema",
            name: schemaName,
            strict,
            schema: schemaJson,
          },
        }
      : undefined,
  });
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  await recordOpenAIResponse(response, "structured_generation_legacy", schemaName, startedAt);
  return typedResponse.output_parsed || response.output_text || "";
  } catch (error) {
    await recordAiUsage({ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", operation: "structured_generation_legacy", schemaName, startedAt, error });
    throw error;
  }
}

export function isUnknownSchema(schema: z.ZodType<unknown, z.ZodTypeDef, unknown>) {
  return (schema as z.ZodTypeAny)._def.typeName === z.ZodFirstPartyTypeKind.ZodUnknown;
}

export async function recordOpenAIResponse(response: unknown, operation: string, schemaName: string | undefined, startedAt: Date) {
  const item = response as Record<string, unknown>;
  await recordAiUsage({
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    operation,
    schemaName,
    providerRequestId: typeof item._request_id === "string" ? item._request_id : typeof item.id === "string" ? item.id : undefined,
    usage: normalizeOpenAIUsage(item.usage),
    startedAt,
  });
}

export function logStructuredGenerationAttempt(provider: AiGenerationMode, schemaName: string, attempt: number) {
  logger.info({
    stage: "ai_provider_call",
    provider,
    schemaName,
    retry: attempt,
  }, "ai structured generation");
}

export async function generateAndValidate<T>({
  call,
  schema,
  schemaName,
  provider,
  parse,
  repair,
  maxAttempts = 2,
}: GenerateAndValidateOptions<T>): Promise<T> {
  let previousValue: unknown;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const repairPrompt = attempt > 0 && repair ? repair(lastError, previousValue, attempt) : undefined;
    previousValue = await call(attempt, repairPrompt);
    try {
      return schema.parse(parse ? parse(previousValue) : previousValue);
    } catch (error) {
      lastError = error;
      logStructuredGenerationValidationFailure(provider, schemaName, attempt, error);
      if (attempt === maxAttempts - 1) {
        throw new StructuredGenerationError(schemaName, error);
      }
    }
  }

  throw new StructuredGenerationError(schemaName, lastError);
}

export function withJsonPromptRules(prompt: string) {
  return [
    prompt,
    "",
    "JSON output rules:",
    "- Return only JSON.",
    "- Do not use Markdown.",
    "- Do not add comments.",
    "- Use schema keys exactly.",
    "- Put all user-facing educational text in Russian.",
  ].join("\n");
}

export function buildStructuredRepairPrompt(prompt: string, schemaName: string, error: unknown, previousValue: unknown) {
  const previousText = typeof previousValue === "string" ? previousValue : JSON.stringify(previousValue);
  return [
    withJsonPromptRules(prompt),
    "",
    "The previous response was not valid JSON for the required schema.",
    `Schema name: ${schemaName}`,
    `Validation error: ${error instanceof Error ? error.message : String(error)}`,
    previousText ? `Previous invalid response:\n${previousText.slice(0, 12000)}` : "",
    "Return only corrected JSON. Do not add markdown.",
  ].filter(Boolean).join("\n");
}

export function parseJsonOutput(value: unknown) {
  return typeof value === "string" ? parseJsonText(value) : value;
}
