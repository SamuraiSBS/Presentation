import crypto from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
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
  type Source,
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
  slideBlueprintSchema,
  slideNarrativeSchema,
  slideTextPlanSchema,
} from "@studydeck/shared";
import {
  improvePresentationQuality,
  type QualityRepairResponse,
} from "./presentation-quality.js";

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
  yandexApiKey?: string;
  jsonSchema?: Record<string, unknown>;
  strict?: boolean;
  maxAttempts?: number;
};

type GenerateAndValidateOptions<T> = {
  call: (attempt: number, repairPrompt?: string) => Promise<unknown>;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
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

const STUDENT_CREATION_BRIEF_LINES = [
  "Product focus: university_student audience only.",
  "Creation brief:",
  "- audience: university_student",
  "- speechStyle: easy_professional",
  "- slideDensity: brief_slides_full_speech",
  "- visualStrategy: images_and_diagrams",
  "- exportTarget: web_and_pptx_pdf",
  "- create short beautiful slides; keep the full explanation in speakerNotes and speechScript;",
  "- use a mix of real images, schemes, diagrams, and text-led slides when it helps the topic;",
  "- treat the request as a university student assignment, seminar, report, or project defense, not a school class, teacher lesson, or child-oriented deck.",
].join("\n");

const NARRATION_SYSTEM_PROMPT = [
  "You write the full Russian oral narration for a university student study presentation.",
  "Return only plain text, not JSON and not markdown.",
  "The output must be divided into slide sections exactly as `Слайд 1: Заголовок`.",
  "Every slide section must contain exactly 5 or 6 complete Russian sentences after the title line.",
  "Write exactly one narration section for each requested slide, in strict order, with no extra sections.",
  "Write like a university student report: academic, easy-professional, concrete, human, calm, and close to the topic.",
  "Answer the user's request; do not copy or paraphrase the request itself as slide content.",
  "Each next slide must continue the previous thought by content, not by repeated transition formulas.",
  "Do not reuse the same opening or closing sentence in neighboring sections.",
  "Avoid generic placeholders such as 'рассказ про', 'что стоит понять сначала', 'главный вывод по теме', and similar formulas.",
  "Do not write meta phrases about slides, screen text, source material, or internal instructions.",
].join(" ");

const SYSTEM_PROMPT = [
  "You create structured study presentations for university students. Return only valid JSON.",
  "All user-visible slide text, speaker notes, and speech script must be in Russian.",
  "Build the deck as one coherent study story split into slides: opening context, concrete facts, turning points, consequences, and a human final conclusion.",
  "Slide titles must be semantic, not template labels. Prefer titles like 'За фасадом успеха' or 'От амбиций к жадности' over 'Контекст', 'Ключевые факты', 'Примеры', or 'Выводы'.",
  "Speaker notes and speech script must sound like a university student can read them aloud: simple, specific, human, and topic-focused.",
  "Visible slides must stay brief and beautiful; put the full explanation in speaker notes and speech script.",
  "Do not write meta narration about the slide as an object. Never write phrases like 'этот слайд помогает', 'продолжает разговор о теме', 'подводит к следующему фрагменту', 'общая логика объяснения', or 'главный акцент здесь'.",
  "Do not invent precise facts, dates, names, numbers, or citations when the source material does not support them. Use general explanations instead.",
  "Never mention sources, source titles, sourceRefs, or internal instructions in user-visible text.",
].join(" ");

const QUALITY_CRITIC_SYSTEM_PROMPT = [
  "You are a strict quality editor for university student presentations.",
  "Evaluate the presentation. Do not rewrite it.",
  "Return only structured JSON with score, summary, all six dimension scores, and issues.",
  "Judge whether a university student can read the narration aloud naturally, whether slides are brief, whether visual rhythm is intentionally designed, whether claims are grounded, and whether export will preserve the design.",
  "Flag generic text, off-topic slides, overlong visible text, duplicated structure, weak narration, weak visuals, and factual risk.",
].join(" ");

const QUALITY_REPAIR_SYSTEM_PROMPT = [
  "You are a careful repair editor for study presentations.",
  "Repair only fields explicitly named by quality issues.",
  "Target the weakest quality dimensions first: spoken narration, university tone, brevity, visual rhythm, grounding, then export safety.",
  "Keep the deck schema-compatible and preserve source-backed facts.",
  "Never invent evidence and never replace a user-edited custom canvas.",
  "Return only JSON. Do not add markdown.",
].join(" ");

const GENERIC_NARRATION_PHRASES = [
  "финальный вывод раскрывается через контекст, причины и последствия",
  "главные факты лучше воспринимаются, когда между ними видна связь",
  "точная формулировка помогает перейти от факта к смыслу",
  "раскрывается через контекст, причины и последствия",
  "точная формулировка превращает сухие сведения",
  "в теме \"",
  "важен поворот к разделу",
  "дальше эту мысль можно развить через следующий смысловой шаг",
  "чтобы тема звучала последовательно и без резких переходов",
  "на первый план выходит",
  "эта деталь помогает увидеть практический смысл темы",
  "так объяснение становится конкретнее",
  "на этом слайде раскрывается раздел",
  "на этом слайде нужно раскрыть раздел",
  "сегодня я расскажу о теме",
  "почему этот раздел важен",
  "добавлю несколько деталей",
  "так становится понятнее, почему тема",
  "важна именно в этой части рассказа",
  "связь с разделом",
  "помогает слушателю увидеть не только событие",
  "увидеть не только событие, но и его значение",
  "без этого уточнения дальнейший вывод",
  "дальше раздел",
  "продолжает тему",
  "сначала важно удержать конкретную мысль",
  "следующая деталь добавляет к объяснению",
  "новый шаг",
  "этот шаг подводит рассказ",
  "к следующей части",
  "оставляет место для следующей мысли",
  "готовит переход дальше",
  "следующий фрагмент",
  "следующая часть",
  "переход дальше",
  "переход к деталям",
  "переход к следующему",
  "соседних фрагментов",
  "связать название",
  "это проявляется в том, что",
  "причина такого вывода в том",
  "последствия заметны там, где",
  "поэтому итог звучит так",
  "становится главным итогом выступления",
  "слайд \"",
  "слайд «",
  "объясняет часть темы",
  "раскрывает главную мысль",
  "опорный пункт",
  "опорные пункты",
  "затем стоит показать связь",
  "после этого можно закрепить",
  "текст на слайде",
  "основной смысл раскрывается",
  "основной рассказ раскрывает",
  "рассказе про тему",
  "рассказе про материал",
  "рассказ про эту тему",
  "рассказ про тему",
  "рассказ про материал",
  "примеры. поэтому",
  "открывает тему",
  "продолжает разговор о теме",
  "уточняет главное",
  "главный акцент здесь",
  "с этой мыслью связана",
  "другая важная деталь",
  "становится не дополнением",
  "частью общей логики объяснения",
  "эта часть подводит",
  "без резкого перехода",
  "складывается в понятный вывод",
  "важны не отдельные формулировки",
  "общий смысл",
  "главная мысль",
  "общая мысль",
  "пример нужен",
  "вся история темы",
  "следующий раздел",
  "следующая часть",
  "переход к следующему",
];

const GENERIC_SCREEN_TEXT_PHRASES = [
  "из презентации можно вынести следующее",
  "из презентации можно сделать вывод",
  "в презентации можно выделить",
  "презентация показывает следующее",
  "финальный вывод раскрывается через контекст, причины и последствия",
  "главные факты лучше воспринимаются, когда между ними видна связь",
  "точная формулировка помогает перейти от факта к смыслу",
  "раскрывается через контекст, причины и последствия",
  "точная формулировка превращает сухие сведения",
  "главная идея связана с темой",
  "материал стоит разбирать",
  "смысловым частым",
  "смысловым частям",
  "ключевые понятия помогают удержать структуру",
  "пример или визуальная схема",
  "визуальная схема делает объяснение",
  "на слайде показано",
  "этот слайд помогает",
  "этот раздел объясняет",
  "здесь собраны основные факты",
  "несуществующая тема",
  "несуществующие темы",
  "на картинке",
  "на изображении",
  "на схеме видно",
  "как видно на схеме",
  "как показано на картинке",
  "как показано на изображении",
  "что важно понять по теме",
  "главный вопрос",
  "практический смысл для аудитории",
  "итог этой части связан с запросом",
  "нужно раскрыть через конкретные факты",
  "раскрыть через конкретные факты",
  "понятнее через факты, примеры и последствия",
  "смысл темы понятнее, когда видны причины и последствия",
  "главная мысль",
  "общая мысль",
  "пример нужен",
  "вся история темы",
  "текст на слайде",
];

const TEMPLATE_TEXT_PATTERNS = [
  { label: "главная мысль", pattern: /(?:^|[^\p{L}])главн(?:ая|ую|ой)\s+мысл/iu },
  { label: "общая мысль", pattern: /(?:^|[^\p{L}])общ(?:ая|ую|ей)\s+мысл/iu },
  { label: "пример нужен", pattern: /(?:^|[^\p{L}])пример\s+нужен/iu },
  { label: "вся история темы", pattern: /(?:^|[^\p{L}])вс[яю]\s+истори[яю]\s+темы/iu },
  { label: "meta slide text", pattern: /(?:на|в)\s+этом\s+слайде|этот\s+слайд|текст\s+на\s+слайде|заметк[аи]\s+докладчика/iu },
  { label: "meta section text", pattern: /(?:этот|следующий|данный)\s+раздел|следующ(?:ая|ий)\s+(?:часть|фрагмент)/iu },
  { label: "meta transition text", pattern: /переход\s+(?:к|дальше)|готовит\s+переход|подводит\s+(?:рассказ\s+)?к\s+следующ/iu },
];

const GENERIC_TITLES = [
  "контекст",
  "контекст и актуальность",
  "актуальность",
  "ключевые факты",
  "главные изменения",
  "примеры",
  "как это объяснить проще",
  "объяснение простыми словами",
  "что важно запомнить",
  "вывод",
  "выводы",
  "итоги",
  "заключение",
  "главный вывод",
  "основные мысли",
];

const STOP_WORDS = new Set([
  "а",
  "без",
  "более",
  "бы",
  "был",
  "была",
  "были",
  "было",
  "в",
  "во",
  "все",
  "всё",
  "где",
  "для",
  "до",
  "его",
  "ее",
  "её",
  "если",
  "есть",
  "еще",
  "ещё",
  "же",
  "за",
  "здесь",
  "и",
  "из",
  "или",
  "как",
  "когда",
  "который",
  "которые",
  "между",
  "на",
  "над",
  "не",
  "но",
  "о",
  "об",
  "он",
  "она",
  "они",
  "от",
  "по",
  "под",
  "после",
  "при",
  "про",
  "с",
  "со",
  "так",
  "такой",
  "там",
  "то",
  "только",
  "у",
  "уже",
  "это",
  "эта",
  "этот",
  "эти",
  "that",
  "the",
  "and",
  "with",
]);

const REMOVED_SLIDE_LAYOUTS = new Set<SlideLayout>([
  "bullets",
  "case-study",
  "comparison",
  "definition",
  "evidence",
  "explain-example",
  "myth-fact",
  "problem-solution",
  "question-answer",
]);
const SLIDE_LAYOUTS = SLIDE_LAYOUT_DEFINITIONS.map((item) => item.id).filter((layout) => !REMOVED_SLIDE_LAYOUTS.has(layout));

const CONTENT_LAYOUT_CYCLE = [
  "statement",
  "process",
  "timeline",
  "metrics",
  "quote",
  "image-focus",
] satisfies SlideLayout[];

type YandexCompletionResponse = {
  result?: {
    alternatives?: Array<{
      message?: {
        text?: string;
      };
    }>;
  };
  alternatives?: Array<{
    message?: {
      text?: string;
    };
  }>;
};

export async function generatePresentation(project: ProjectInput, sources: Source[]): Promise<PresentationDocument> {
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return provider === "openai"
        ? await generateWithOpenAI(project, sources)
        : await generateWithYandex(project, sources);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      console.warn(`${provider} generation failed:`, error);
    }
  }

  if (isDemoGenerationAllowed()) {
    return demoPresentation(project, sources, providers.length ? "demo-fallback" : "demo");
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Set OPENAI_API_KEY or YANDEX_API_KEY with YANDEX_FOLDER_ID/YANDEX_MODEL_URI.");
  }

  throw new Error(`AI generation failed. ${errors.join(" | ")}`);
}

export async function generateNarrationDraft(project: ProjectInput, sources: Source[]) {
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      if (provider === "openai") {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const researchBrief = buildResearchBrief(project, sources);
        const narrativePlan = await generateNarrativePlanWithProvider(provider, project, sources, researchBrief, { openAIClient: client });
        const deckStory = buildDeckStory(project, researchBrief, narrativePlan);
        const designBrief = buildDesignBrief(project, researchBrief, narrativePlan);
        const text = await generateOpenAINarration(client, project, sources, narrativePlan, researchBrief);
        const slideTextPlans = buildSlideTextPlans(project, text, narrativePlan, deckStory, sources);
        generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints: [], slideTextPlans });
        return { text, narrativePlan, generationMode: provider };
      }

      const apiKey = process.env.YANDEX_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("YANDEX_API_KEY is required");
      }

      const researchBrief = buildResearchBrief(project, sources);
      const narrativePlan = await generateNarrativePlanWithProvider(provider, project, sources, researchBrief, { yandexApiKey: apiKey });
      const deckStory = buildDeckStory(project, researchBrief, narrativePlan);
      const designBrief = buildDesignBrief(project, researchBrief, narrativePlan);
      const text = await generateYandexNarration(apiKey, project, sources, narrativePlan, researchBrief);
      const slideTextPlans = buildSlideTextPlans(project, text, narrativePlan, deckStory, sources);
      generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints: [], slideTextPlans });
      return { text, narrativePlan, generationMode: provider };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      console.warn(`${provider} narration generation failed:`, error);
    }
  }

  if (isDemoGenerationAllowed()) {
    return {
      text: buildFallbackGeneratedText(project),
      narrativePlan: normalizeNarrativePlan([], project),
      generationMode: providers.length ? "demo-fallback" : "demo",
    };
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Set OPENAI_API_KEY or YANDEX_API_KEY with YANDEX_FOLDER_ID/YANDEX_MODEL_URI.");
  }

  throw new Error(`AI narration generation failed. ${errors.join(" | ")}`);
}

export async function generatePresentationFromNarration(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
): Promise<PresentationDocument> {
  const fixedNarration = normalizeNarrationText(narrationText, project);
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return provider === "openai"
        ? await generateOpenAIPresentationFromNarration(project, sources, fixedNarration)
        : await generateYandexPresentationFromNarration(project, sources, fixedNarration);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      console.warn(`${provider} presentation generation failed:`, error);
    }
  }

  if (isDemoGenerationAllowed()) {
    return normalizePresentation(
      {},
      project,
      sources,
      providers.length ? "demo-fallback" : "demo",
      fixedNarration,
      normalizeNarrativePlan([], project),
    );
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Set OPENAI_API_KEY or YANDEX_API_KEY with YANDEX_FOLDER_ID/YANDEX_MODEL_URI.");
  }

  throw new Error(`AI presentation generation failed. ${errors.join(" | ")}`);
}

export function selectAiProviders(env: EnvLike = process.env): AiGenerationMode[] {
  const requested = normalizeProvider(env.AI_PROVIDER);
  const available: AiGenerationMode[] = [];
  const hasOpenAI = Boolean(env.OPENAI_API_KEY?.trim());
  const hasYandex = Boolean(env.YANDEX_API_KEY?.trim() && (env.YANDEX_MODEL_URI?.trim() || env.YANDEX_FOLDER_ID?.trim()));

  if (hasOpenAI) available.push("openai");
  if (hasYandex) available.push("yandex");

  if (!requested) {
    return available;
  }

  return [
    ...(available.includes(requested) ? [requested] : []),
    ...available.filter((provider) => provider !== requested),
  ];
}

async function generateWithOpenAI(project: ProjectInput, sources: Source[]) {
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

async function generateOpenAIPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
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

async function generateOpenAINarrativePlan(client: OpenAI, project: ProjectInput, sources: Source[]) {
  const researchBrief = buildResearchBrief(project, sources);
  return generateNarrativePlanWithProvider("openai", project, sources, researchBrief, { openAIClient: client });
}

async function generateOpenAINarration(client: OpenAI, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
  let prompt = buildNarrationPrompt(project, sources, narrativePlan, researchBrief);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let outputText = "";
    try {
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

async function generateWithYandex(project: ProjectInput, sources: Source[]) {
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
    console.warn("yandex structured presentation generation failed; using narration fallback document:", error);
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

async function generateYandexPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
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
    console.warn("yandex structured presentation generation failed; using narration fallback document:", error);
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

async function generateYandexNarrativePlan(apiKey: string, project: ProjectInput, sources: Source[]) {
  const researchBrief = buildResearchBrief(project, sources);
  return generateNarrativePlanWithProvider("yandex", project, sources, researchBrief, { yandexApiKey: apiKey });
}

async function generateYandexNarration(apiKey: string, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
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

async function generateNarrativePlanWithProvider(
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
    ...options,
  });
}

async function generateDesignBriefWithProvider(
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
      ...options,
    });
  } catch (error) {
    console.warn(`${provider} design brief generation failed, using deterministic art direction:`, error);
    return buildDesignBrief(project, researchBrief, narrativePlan);
  }
}

async function generatePresentationDocumentWithProvider(
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
  yandexApiKey,
  jsonSchema: schemaJson,
  strict = true,
  maxAttempts = 2,
}: GenerateStructuredOptions<T>): Promise<T> {
  if (provider === "openai") {
    const client = openAIClient || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return generateAndValidate({
      schema,
      schemaName,
      parse,
      maxAttempts,
      call: async (_attempt, repairPrompt) => {
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
        return typedResponse.output_parsed || response.output_text || "";
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
    call: (_attempt, repairPrompt) =>
      requestYandexText(apiKey, system, repairPrompt || withJsonPromptRules(prompt), schemaJson ? { jsonSchema: schemaJson } : { jsonObject: true }),
    repair: (error, previousValue) => buildStructuredRepairPrompt(prompt, schemaName, error, previousValue),
  });
}

async function generateAndValidate<T>({
  call,
  schema,
  schemaName,
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
      if (attempt === maxAttempts - 1) {
        throw new StructuredGenerationError(schemaName, error);
      }
    }
  }

  throw new StructuredGenerationError(schemaName, lastError);
}

function withJsonPromptRules(prompt: string) {
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

function buildStructuredRepairPrompt(prompt: string, schemaName: string, error: unknown, previousValue: unknown) {
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

function parseJsonOutput(value: unknown) {
  return typeof value === "string" ? parseJsonText(value) : value;
}

function buildResearchBrief(project: ProjectInput, sources: Source[]): ResearchBrief {
  const facts = sources
    .map((source) => ({
      text: shortenSentence(cleanText(source.excerpt || source.label || project.prompt), 260),
      sourceId: source.id,
      confidence: source.type === "WEB" || source.type === "PROMPT" ? "medium" as const : "high" as const,
    }))
    .filter((fact) => fact.text);
  const topic = cleanText(project.title || project.prompt);
  return researchBriefSchema.parse({
    topic,
    angle: `Explain ${topic} as a clear university student study story for ${project.level}.`,
    facts,
    warnings: facts.length ? [] : ["No source excerpts were available; avoid precise unsupported facts."],
    vocabulary: buildResearchVocabulary(project, sources),
  });
}

function buildResearchVocabulary(project: ProjectInput, sources: Source[]) {
  const text = [project.title, project.prompt, ...sources.map((source) => source.excerpt || source.label)].join(" ");
  const terms = [...new Set(text.match(/[\p{L}\p{N}][\p{L}\p{N}-]{5,}/gu) || [])]
    .filter((term) => !/^\d+$/.test(term))
    .slice(0, 6);
  return terms.map((term) => ({
    term,
    explanation: `Key term for the topic: ${term}.`,
  }));
}

function buildDesignBrief(project: ProjectInput, researchBrief: ResearchBrief, narrativePlan: SlideNarrative[]): DesignBrief {
  const theme = resolvePresentationTheme(project);
  const themeId = theme.themeId || "academicClean";
  const hasGroundedVisualContext = researchBrief.facts.some((fact) => fact.confidence !== "low");
  let directions: DesignBrief["slideDirections"] = Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, order);
    const sceneText = `${plan.slideTitle} ${plan.keyMessage} ${project.title}`;
    const visualRole: DesignBrief["slideDirections"][number]["visualRole"] =
      order === 1 ? "hero" :
      order === project.slideCount ? "summary" :
      /сравн|compare|versus|\bvs\b/i.test(sceneText) ? "compare" :
      /этап|шаг|chron|хрон|дата|год|period|timeline/i.test(sceneText) ? "sequence" :
      /доказ|fact|source|источник|пример|evidence/i.test(sceneText) ? "evidence" :
      /проблем|риск|challenge|problem|barrier/i.test(sceneText) ? "problem" :
      /цитат|quote/i.test(sceneText) ? "quote" :
      order === 2 ? "context" :
      order % 5 === 0 ? "visual_statement" :
      researchBrief.facts.length > 0 && order % 4 === 0 ? "evidence" :
      "explain";
    const concreteScene = isConcreteVisualScene(sceneText);
    const layoutIntent: DesignBrief["slideDirections"][number]["layoutIntent"] =
      visualRole === "hero" && concreteScene && hasGroundedVisualContext ? "full_bleed_image" :
      visualRole === "hero" ? "statement" :
      visualRole === "summary" ? "summary" :
      visualRole === "compare" ? "comparison" :
      visualRole === "sequence" ? "timeline" :
      visualRole === "evidence" ? "evidence_board" :
      visualRole === "quote" ? "quote_spread" :
      visualRole === "problem" || visualRole === "visual_statement" ? "statement" :
      visualRole === "context" && concreteScene && hasGroundedVisualContext ? "split_image_text" :
      visualRole === "explain" && (isExplanationHeavyScene(sceneText) || order % 3 === 0) ? "diagram" :
      "cards";
    const imageStrategy: DesignBrief["slideDirections"][number]["imageStrategy"] =
      layoutIntent === "timeline" || layoutIntent === "diagram" || layoutIntent === "comparison" ? "diagram" :
      (layoutIntent === "full_bleed_image" || layoutIntent === "split_image_text") ? "real_photo" :
      "none";
    return {
      slideOrder: order,
      visualRole,
      layoutIntent,
      imageStrategy,
      visualPrompt: buildDeterministicVisualPrompt(project, plan, imageStrategy, layoutIntent),
    };
  });
  for (let index = 2; index < directions.length; index += 1) {
    const current = directions[index];
    const previous = directions[index - 1];
    const beforePrevious = directions[index - 2];
    if (current.layoutIntent !== previous.layoutIntent || current.layoutIntent !== beforePrevious.layoutIntent) continue;

    const replacement = (["statement", "diagram", "cards"] as const).find((intent) => intent !== previous.layoutIntent) || "statement";
    directions[index] = {
      ...current,
      layoutIntent: replacement,
      imageStrategy: replacement === "diagram" ? "diagram" : "none",
      visualPrompt: buildDeterministicVisualPrompt(
        project,
        narrativePlan[index] || buildFallbackNarrativeItem(project, current.slideOrder),
        replacement === "diagram" ? "diagram" : "none",
        replacement,
      ),
    };
  }
  directions = balanceDeterministicVisualDirections(directions, project, narrativePlan, hasGroundedVisualContext);
  return designBriefSchema.parse({
    themePreset: theme.preset,
    themeId,
    mood: theme.mood,
    audienceFit: `Designed for university_student academic work: ${project.level} in a ${project.scenario} scenario.`,
    visualMetaphor: `${researchBrief.topic}: ${researchBrief.angle}`,
    colorIntent: `Use ${themeId} colors with strong readability and one clear accent.`,
    typographyIntent: `Use ${theme.fonts.tone} typography: ${theme.fonts.heading} for headings and ${theme.fonts.body} for body text.`,
    rhythm: {
      titleStyle: theme.fonts.tone === "bookish" ? "editorial" : theme.fonts.tone === "strict" ? "academic" : "bold",
      density: project.slideCount >= 10 ? "medium" : "low",
      imageFrequency: project.mode === "with_sources" ? "balanced" : "rare",
      sectionBreaks: project.slideCount >= 6,
    },
    visualDirection: `${researchBrief.topic}: ${researchBrief.angle}`,
    layoutPrinciples: [
      "Use a title opener, varied content layouts, and a clear summary slide.",
      "Keep visible text short and reserve full explanation for speaker notes.",
      "Mix images, schemes, diagrams, and text-led slides for a polished university presentation.",
      `Support ${Math.max(1, narrativePlan.length)} planned story beats with distinct visual rhythm.`,
    ],
    imageStrategy: "Use concrete visual descriptions only when they are grounded in the topic or source excerpts.",
    slideDirections: directions,
  });
}

const CONCRETE_VISUAL_SCENE_PATTERN = /(?:\b(?:person|people|students?|campus|universit\w*|classroom|laboratory|museum|city|country|company|factory|building|device|robot|car|vehicle|book|painting|sculpture|artifact|product|machine|computer|phone|conference|protest|battle|war|expedition|landscape|environment)\b|(?:человек|люди|студент|университет|кампус|аудитори|лаборатори|музей|город|стран|компани|завод|здани|устройств|робот|автомобил|машин|книг|картин|скульптур|артефакт|продукт|компьютер|телефон|конференц|протест|битв|войн|экспедиц|ландшафт|окружающ))/iu;
const ABSTRACT_VISUAL_SCENE_PATTERN = /(?:\b(?:principle|idea|ethic|meaning|value|theory|concept|conclusion|takeaway)\b|(?:принцип|иде[яи]|этик|смысл|ценност|теори|концепц|вывод|итог))/iu;
const EXPLANATION_VISUAL_SCENE_PATTERN = /(?:\b(?:process|workflow|system|structure|cause|effect|cycle|stage|step|mechanism|relationship|hierarchy|timeline|compare|versus)\b|(?:процесс|систем|структур|причин|следств|цикл|этап|шаг|механизм|связ|иерарх|хронолог|сравнен))/iu;

function isConcreteVisualScene(value: string) {
  const text = cleanText(value);
  return CONCRETE_VISUAL_SCENE_PATTERN.test(text) && !ABSTRACT_VISUAL_SCENE_PATTERN.test(text);
}

function isExplanationHeavyScene(value: string) {
  return EXPLANATION_VISUAL_SCENE_PATTERN.test(cleanText(value));
}

function buildDeterministicVisualPrompt(
  project: ProjectInput,
  plan: SlideNarrative,
  imageStrategy: DesignBrief["slideDirections"][number]["imageStrategy"],
  layoutIntent: DesignBrief["slideDirections"][number]["layoutIntent"],
) {
  const subject = shortenWords(cleanText(plan.keyMessage || plan.slideTitle || project.title), 12);
  if (imageStrategy === "real_photo") {
    return `Documentary scene of ${subject}; real people, place, object, or event from ${cleanText(project.title)}`;
  }
  if (imageStrategy === "diagram") {
    const diagramType = layoutIntent === "timeline" ? "Timeline" : layoutIntent === "comparison" ? "Comparison" : "Concept";
    return `${diagramType} diagram showing ${subject}`;
  }
  return `Text-led emphasis on ${subject}`;
}

function balanceDeterministicVisualDirections(
  directions: DesignBrief["slideDirections"],
  project: ProjectInput,
  narrativePlan: SlideNarrative[],
  hasGroundedVisualContext: boolean,
) {
  if (!hasGroundedVisualContext || directions.length < 3) return directions;

  const minimumImages = Math.ceil(directions.length * 0.2);
  const maximumImages = Math.max(minimumImages, Math.floor(directions.length * 0.4));
  const imageStrategies = new Set(["real_photo", "generated_illustration"]);
  let imageCount = directions.filter((direction) => imageStrategies.has(direction.imageStrategy)).length;
  const balanced = [...directions];

  for (let index = 0; index < balanced.length && imageCount < minimumImages; index += 1) {
    const direction = balanced[index];
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, direction.slideOrder);
    const sceneText = `${plan.slideTitle} ${plan.keyMessage} ${project.title}`;
    if (
      direction.visualRole === "summary" ||
      direction.visualRole === "evidence" ||
      direction.visualRole === "quote" ||
      direction.imageStrategy === "diagram" ||
      !isConcreteVisualScene(sceneText) &&
      !isConcreteVisualScene(project.title)
    ) continue;

    balanced[index] = {
      ...direction,
      layoutIntent: direction.visualRole === "hero" ? "full_bleed_image" : "split_image_text",
      imageStrategy: "real_photo",
      visualPrompt: buildDeterministicVisualPrompt(project, plan, "real_photo", direction.layoutIntent),
    };
    imageCount += 1;
  }

  for (let index = balanced.length - 1; index >= 0 && imageCount > maximumImages; index -= 1) {
    const direction = balanced[index];
    if (!imageStrategies.has(direction.imageStrategy)) continue;
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, direction.slideOrder);
    balanced[index] = {
      ...direction,
      layoutIntent: direction.visualRole === "hero" ? "statement" : "cards",
      imageStrategy: "none",
      visualPrompt: buildDeterministicVisualPrompt(project, plan, "none", direction.layoutIntent),
    };
    imageCount -= 1;
  }

  return balanced;
}

function buildDeckStory(project: ProjectInput, researchBrief: ResearchBrief, narrativePlan: SlideNarrative[]): DeckStory {
  const topic = cleanText(project.title || project.prompt);
  const plans = narrativePlan.length
    ? narrativePlan
    : Array.from({ length: project.slideCount }, (_, index) => buildFallbackNarrativeItem(project, index + 1));
  const chapterSize = Math.max(1, Math.ceil(plans.length / 3));
  const chapters = Array.from({ length: Math.ceil(plans.length / chapterSize) }, (_, index) => {
    const items = plans.slice(index * chapterSize, (index + 1) * chapterSize);
    const first = items[0] || plans[0];
    return {
      title: first?.slideTitle || `${topic} chapter ${index + 1}`,
      purpose: first?.slidePurpose || `Explain part ${index + 1} of ${topic}.`,
      slideOrders: items.map((item) => item.slideOrder),
    };
  });
  const finalPlan = plans[plans.length - 1];

  return deckStorySchema.parse({
    mainIdea: finalPlan?.keyMessage || researchBrief.angle || topic,
    audienceQuestion: plans[0]?.audienceQuestion || `What should the audience understand about ${topic}?`,
    tone: deckStoryTone(project),
    chapters,
    conclusion: finalPlan?.keyMessage || `The conclusion should stay focused on ${topic}.`,
  });
}

function deckStoryTone(project: ProjectInput): DeckStory["tone"] {
  const text = `${project.scenario} ${project.level} ${project.prompt}`.toLowerCase();
  if (text.includes("university_report") || text.includes("university_student")) return "college_report";
  if (text.includes("exam") || text.includes("экзам") || text.includes("егэ") || text.includes("огэ")) return "exam_explanation";
  if (text.includes("teacher") || text.includes("lesson") || text.includes("учител") || text.includes("урок")) return "teacher_explainer";
  if (text.includes("college") || text.includes("универс") || text.includes("студент")) return "college_report";
  return "college_report";
}

function buildSlideBlueprints(
  project: ProjectInput,
  narrationText: string,
  narrativePlan: SlideNarrative[],
  designBrief: DesignBrief,
): SlideBlueprint[] {
  const sections = parseNarrationSections(normalizeNarrationText(narrationText, project));
  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, order);
    const section = sections[index];
    const layoutCandidate = order === 1 ? "hero" : order === project.slideCount ? "summary" : CONTENT_LAYOUT_CYCLE[(order - 2) % CONTENT_LAYOUT_CYCLE.length];
    const sentenceTotal = sentenceCount(section?.text || "");
    return slideBlueprintSchema.parse({
      slideOrder: order,
      purpose: plan.slidePurpose,
      title: section?.title || plan.slideTitle,
      visualStrategy: `${designBrief.mood} ${layoutCandidate} slide focused on ${plan.keyMessage}`,
      layoutCandidate,
      textDensity: sentenceTotal >= 6 ? "high" : sentenceTotal <= 3 ? "low" : "medium",
    });
  });
}

function buildSlideTextPlans(
  project: ProjectInput,
  narrationText: string,
  narrativePlan: SlideNarrative[],
  deckStory: DeckStory,
  sources: Source[],
): SlideTextPlan[] {
  const sections = parseNarrationSections(normalizeNarrationText(narrationText, project));
  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, order);
    const section = sections[index];
    const notes = completeNarrationSentences(section?.text || plan.keyMessage || deckStory.mainIdea).slice(0, 6).join(" ");
    const sourceHint = sourceEvidenceForSlide(sources, order);
    const coreClaim = shortenSentence(firstSentence(notes) || plan.keyMessage || deckStory.mainIdea, 180);
    const evidenceOrExample = sourceHint || shortenSentence(secondSentence(notes), 160);
    const listenerTakeaway = shortenSentence(lastSentence(notes) || plan.keyMessage || deckStory.conclusion, 180);
    const title = shortenVisibleTitle(section?.title || plan.slideTitle || fallbackTitle(project, order));
    const thesis = ensureSentence(shortenSentence(coreClaim, 170));
    const bullets = compressVisibleSlideText([evidenceOrExample, listenerTakeaway, plan.audienceQuestion])
      .filter((item) => item && normalizeTitleKey(item) !== normalizeTitleKey(title))
      .slice(0, order === project.slideCount ? 3 : 2);

    return slideTextPlanSchema.parse({
      slideOrder: order,
      slideQuestion: plan.audienceQuestion,
      coreClaim,
      evidenceOrExample,
      listenerTakeaway,
      title,
      thesis,
      bullets,
      speakerNotes: notes,
    });
  });
}

function compressVisibleSlideText(values: string[]) {
  return values
    .map((value) => shortenSentence(cleanText(value), 92))
    .map((value) => value.replace(/[.!?]+$/g, ""))
    .filter((value) => wordCount(value) >= 2 && wordCount(value) <= 14);
}

function sourceEvidenceForSlide(sources: Source[], order: number) {
  if (!sources.length) return "";
  const source = sources[(order - 1) % sources.length];
  return shortenSentence(cleanText(source.excerpt || source.label), 160);
}

function shortenVisibleTitle(value: string) {
  const title = cleanText(value).replace(/[.!?]+$/g, "");
  const words = title.split(/\s+/).filter(Boolean);
  return words.length > 8 ? words.slice(0, 8).join(" ") : title;
}

function ensureSentence(value: string) {
  const text = cleanText(value);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function secondSentence(value: string) {
  return value.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)[1] || "";
}

function buildQualityCritique(presentation: PresentationDocument, issues: SlideTextIssue[]): QualityCritique {
  return qualityCritiqueSchema.parse({
    score: issues.length ? Math.max(0, 100 - issues.length * 20) : 100,
    summary: issues.length ? `${issues.length} slide text issue(s) found.` : "No slide text issues found.",
    issues: issues.flatMap((issue) =>
      issue.reasons.map((reason) => ({
        slideId: presentation.slides.find((slide) => slide.order === issue.slideOrder)?.id,
        severity: "major",
        category: reason.includes("duplicated") ? "duplicate" : "generic_text",
        message: reason,
        field: issue.fields.join(", "),
        repairInstruction: `Repair fields: ${issue.fields.join(", ")}`,
      })),
    ),
  });
}

function shouldRetryNarration(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("must have 5-6 narration sentences") ||
    message.includes("expected") && message.includes("narration sections") ||
    message.includes("missing narration section") ||
    message.includes("adjacent narration sections repeat") ||
    message.includes("narration sections repeat") ||
    message.includes("template phrase detected") ||
    message.includes("response is not plain slide narration") ||
    message.includes("Yandex generation response did not include text")
  );
}

async function requestYandexText(apiKey: string, systemText: string, userText: string, options: YandexTextOptions = {}) {
  const useJsonSchema = options.jsonSchema && isYandexJsonSchemaCompatible(options.jsonSchema);
  const responseFormat = useJsonSchema
    ? { json_schema: { schema: options.jsonSchema } }
    : options.jsonSchema || options.jsonObject
      ? { json_object: true }
      : {};
  const response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      modelUri: getYandexModelUri(),
      completionOptions: {
        stream: false,
        temperature: options.temperature ?? 0.25,
        maxTokens: String(options.maxTokens ?? 8000),
      },
      ...responseFormat,
      messages: [
        {
          role: "system",
          /* legacyText:
            "Ты создаешь учебные презентации на русском языке. На каждом слайде нужен короткий текст для экрана: заголовок и 1-2 содержательные фразы без маркеров. Подробный связный текст для чтения пиши только в speakerNotes и speechScript. Не упоминай источники в тексте для пользователя, не пиши инструкции, заглушки или просьбы что-то проверить. Верни только валидный JSON.",
          */ text: systemText,
        },
        {
          role: "user",
          text: userText,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Yandex generation request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as YandexCompletionResponse;
  const outputText = payload.result?.alternatives?.[0]?.message?.text || payload.alternatives?.[0]?.message?.text;

  if (!outputText) {
    throw new Error("Yandex generation response did not include text");
  }

  return outputText;
}

function isYandexJsonSchemaCompatible(schema: unknown): boolean {
  if (Array.isArray(schema)) {
    return schema.every(isYandexJsonSchemaCompatible);
  }

  if (!schema || typeof schema !== "object") {
    return true;
  }

  const node = schema as Record<string, unknown>;
  if (node.type === "object" && node.additionalProperties !== false) {
    return false;
  }

  return Object.values(node).every(isYandexJsonSchemaCompatible);
}

function normalizeNarrationText(value: unknown, project: ProjectInput) {
  const text = cleanMultilineText(value);
  if (!text || text.startsWith("{")) {
    throw new Error("AI narration quality check failed: response is not plain slide narration");
  }

  let sections = repairNarrationSentenceCounts(parseNarrationSections(text), project);
  const issues = validateNarrationSections(sections, project);
  if (issues.length) {
    const blockingIssues = issues.filter((issue) => !isRepairableNarrationQualityIssue(issue));
    if (blockingIssues.length) {
      throw new Error(`AI narration quality check failed: ${blockingIssues.join("; ")}`);
    }
    console.warn("AI narration quality check found repairable issues; using local narration repair", {
      projectId: project.id,
      issues,
    });
    sections = repairNarrationQualitySections(sections, project);
  }

  let normalizedText = sections.map((section) => `Слайд ${section.order}: ${section.title}\n${section.text}`).join("\n\n");
  const textIssues = qualityIssuesForText(normalizedText, project);
  if (textIssues.length) {
    console.warn("AI narration quality check found template text; using local narration repair", {
      projectId: project.id,
      issues: textIssues,
    });
    sections = repairNarrationQualitySections(sections, project);
    normalizedText = sections.map((section) => `Слайд ${section.order}: ${section.title}\n${section.text}`).join("\n\n");
    const repairedIssues = qualityIssuesForText(normalizedText, project);
    if (repairedIssues.length) {
      throw new Error(`AI narration quality check failed: ${repairedIssues.join("; ")}`);
    }
  }

  return normalizedText;
}

function parseNarrationSections(value: unknown): NarrationSection[] {
  const lines = cleanMultilineText(value).split("\n");
  const sections: NarrationSection[] = [];
  let current: NarrationSection | null = null;

  for (const line of lines) {
    const header = parseNarrationHeader(line);
    if (header) {
      if (current) {
        current.text = cleanText(current.text);
        sections.push(current);
      }
      current = {
        order: header.order,
        title: header.title,
        text: "",
      };
      continue;
    }

    if (current && line.trim()) {
      current.text = cleanText([current.text, line].filter(Boolean).join(" "));
    }
  }

  if (current) {
    current.text = cleanText(current.text);
    sections.push(current);
  }

  return sections;
}

function parseNarrationHeader(line: string) {
  const boldNumberedHeader = line.trim().match(/^\*\*(\d{1,3})\s*(?:\)|\.|\]|:|-|–|—)\s*(.+?)\*\*$/);
  if (boldNumberedHeader) {
    const title = cleanText(boldNumberedHeader[2]);
    return title && title.length <= 160 ? { order: Number(boldNumberedHeader[1]), title } : null;
  }

  const text = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "")
    .trim();
  if (!text) return null;

  const slideHeader = text.match(/^Слайд\s*(?:№|N|No\.?)?\s*(\d{1,3})\s*[:.\-–—]\s*(.+)$/i);
  const numberedHeader = text.match(/^(\d{1,3})\s*(?:\)|\.|\]|:|-|–|—)\s*(.+)$/);
  const header = slideHeader || numberedHeader;
  if (!header) return null;

  const title = cleanText(header[2].replace(/^\*\*(.+)\*\*$/, "$1").replace(/\*\*$/g, ""));
  if (!title || title.length > 160) return null;

  return { order: Number(header[1]), title };
}

function validateNarrationSections(sections: NarrationSection[], project: ProjectInput) {
  const issues: string[] = [];
  if (sections.length !== project.slideCount) {
    issues.push(`expected ${project.slideCount} narration sections, got ${sections.length}`);
  }

  for (let index = 0; index < project.slideCount; index += 1) {
    const section = sections[index];
    const expectedOrder = index + 1;
    if (!section) {
      issues.push(`missing narration section for slide ${expectedOrder}`);
      continue;
    }
    if (section.order !== expectedOrder) {
      issues.push(`expected slide ${expectedOrder}, got slide ${section.order}`);
    }
    if (!section.title) {
      issues.push(`slide ${expectedOrder} has no title`);
    }
    const count = sentenceCount(section.text);
    if (count < 5 || count > 6) {
      issues.push(`slide ${expectedOrder} must have 5-6 narration sentences, got ${count}`);
    }

    const previous = sections[index - 1];
    if (previous) {
      const previousSentences = speechSentences(previous.text);
      const currentSentences = speechSentences(section.text);
      const previousFirst = normalizeForQuality(previousSentences[0] || "");
      const currentFirst = normalizeForQuality(currentSentences[0] || "");
      const previousLast = normalizeForQuality(previousSentences[previousSentences.length - 1] || "");
      const currentLast = normalizeForQuality(currentSentences[currentSentences.length - 1] || "");
      if (previousFirst && previousFirst === currentFirst) {
        issues.push(`adjacent narration sections repeat opening sentence at slides ${expectedOrder - 1}-${expectedOrder}`);
      }
      if (previousLast && previousLast === currentLast) {
        issues.push(`adjacent narration sections repeat closing sentence at slides ${expectedOrder - 1}-${expectedOrder}`);
      }
    }
  }

  const repeatedOpening = repeatedSentenceEdge(sections, "first");
  if (repeatedOpening) {
    issues.push(`narration sections repeat opening phrase: ${repeatedOpening}`);
  }

  const repeatedClosing = repeatedSentenceEdge(sections, "last");
  if (repeatedClosing) {
    issues.push(`narration sections repeat closing phrase: ${repeatedClosing}`);
  }

  return issues;
}

function isRepairableNarrationQualityIssue(issue: string) {
  return issue.includes("repeat opening sentence")
    || issue.includes("repeat closing sentence")
    || issue.includes("repeat opening phrase")
    || issue.includes("repeat closing phrase");
}

function repairNarrationQualitySections(sections: NarrationSection[], project: ProjectInput): NarrationSection[] {
  return sections.map((section, index) => {
    const order = index + 1;
    const title = cleanText(section.title) || fallbackTitle(project, order);
    const sentences = speechSentences(sanitizeSpeechText(section.text))
      .filter((sentence) => !isGenericNarrationSentence(sentence) && !isPromptEchoSentence(sentence, project));
    const thesis = sentences[0] || fallbackSlideText(project, order);
    return {
      ...section,
      order,
      title,
      text: buildNarrationFromContent(title, thesis, sentences.slice(1), project, order),
    };
  });
}

function repairNarrationSentenceCounts(sections: NarrationSection[], project: ProjectInput) {
  return repairShortNarrationSections(compressOverlongNarrationSections(sections, project), project).map((section, index) => {
    const expectedOrder = index + 1;
    if (section.order !== expectedOrder || !section.title) {
      return section;
    }

    const count = sentenceCount(section.text);
    if (count >= 5 && count <= 6) {
      return section;
    }
    if (count > 6) {
      return section;
    }

    return {
      ...section,
      text: buildFallbackSpeakerNotes(project, expectedOrder),
    };
  });
}

function compressOverlongNarrationSections(sections: NarrationSection[], project: ProjectInput) {
  const repaired: NarrationSection[] = [];
  for (const section of sections) {
    const compressed = compressOverlongNarrationSection(section, project, repaired[repaired.length - 1]);
    repaired.push(compressed);
  }
  return repaired;
}

function compressOverlongNarrationSection(section: NarrationSection, project: ProjectInput, previous?: NarrationSection): NarrationSection {
  const sentences = speechSentences(sanitizeSpeechText(section.text));
  if (sentences.length <= 6) {
    return section;
  }

  const selected: string[] = [];
  const seen = new Set<string>();
  const previousFirst = firstNarrationEdge(previous?.text || "");
  const previousLast = lastNarrationEdge(previous?.text || "");
  const useful = sentences.filter((sentence) => isUsableNarrationSentence(sentence, section, project));
  if (useful.length < 5) {
    return section;
  }

  for (const sentence of useful) {
    const key = normalizeForQuality(sentence);
    if (!key || seen.has(key)) continue;
    if (!selected.length && previousFirst && sentenceEdgeKey(sentence) === previousFirst) continue;
    selected.push(sentence);
    seen.add(key);
    if (selected.length >= 6) break;
  }

  if (selected.length > 5 && previousLast && sentenceEdgeKey(selected[selected.length - 1]) === previousLast) {
    const replacement = useful.find((sentence) => {
      const key = normalizeForQuality(sentence);
      return key && !seen.has(key) && sentenceEdgeKey(sentence) !== previousLast;
    });
    if (replacement) {
      selected[selected.length - 1] = replacement;
    }
  }

  if (selected.length < 5) {
    return section;
  }

  return { ...section, text: selected.slice(0, 6).join(" ") };
}

function isUsableNarrationSentence(sentence: string, section: NarrationSection, project: ProjectInput) {
  const text = cleanText(sentence);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  if (looksLikeSentenceFragment(text)) return false;
  if (isGenericNarrationSentence(text)) return false;
  if (isPromptEchoSentence(text, project)) return false;

  const sectionTokens = new Set(significantTokens(`${section.title} ${project.title}`));
  const sentenceTokens = significantTokens(text);
  if (sectionTokens.size && sentenceTokens.length >= 6) {
    return sentenceTokens.some((token) => sectionTokens.has(token)) || textSimilarity(text, `${section.title} ${project.title} ${project.prompt}`) >= 0.12;
  }

  return true;
}

function isGenericNarrationSentence(sentence: string) {
  const normalized = normalizeExactForQuality(sentence);
  const genericFragments = [
    "\u0440\u0430\u0441\u0441\u043a\u0430\u0437 \u043f\u0440\u043e",
    "\u0447\u0442\u043e \u0441\u0442\u043e\u0438\u0442 \u043f\u043e\u043d\u044f\u0442\u044c \u0441\u043d\u0430\u0447\u0430\u043b\u0430",
    "\u0433\u043b\u0430\u0432\u043d\u044b\u0439 \u0432\u044b\u0432\u043e\u0434 \u043f\u043e \u0442\u0435\u043c\u0435",
    "\u043d\u0430 \u044d\u0442\u043e\u043c \u0441\u043b\u0430\u0439\u0434\u0435",
    "\u044d\u0442\u043e\u0442 \u0441\u043b\u0430\u0439\u0434",
    "\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0430\u044f \u0447\u0430\u0441\u0442\u044c",
    "\u043f\u0435\u0440\u0435\u0445\u043e\u0434 \u043a",
    "\u043d\u043e\u0432\u044b\u0439 \u0448\u0430\u0433",
    "this slide",
    "next section",
    "main takeaway of the topic",
  ];
  return hasForbiddenTemplateText(sentence)
    || genericFragments.some((phrase) => normalized.includes(normalizeExactForQuality(phrase)));
}

function isPromptEchoSentence(sentence: string, project: ProjectInput) {
  const prompt = cleanText(project.prompt);
  if (!prompt) return false;
  const normalizedSentence = normalizeForQuality(sentence);
  const normalizedPrompt = normalizeForQuality(prompt);
  if (normalizedPrompt && normalizedSentence.includes(normalizedPrompt)) return true;
  return textSimilarity(sentence, prompt) >= 0.7;
}

function firstNarrationEdge(text: string) {
  return sentenceEdgeKey(speechSentences(text)[0] || "");
}

function lastNarrationEdge(text: string) {
  const sentences = speechSentences(text);
  return sentenceEdgeKey(sentences[sentences.length - 1] || "");
}

function formatNarrationSection(section: NarrationSection, slideWord = "\u0421\u043b\u0430\u0439\u0434") {
  return `${slideWord} ${section.order}: ${section.title}\n${section.text}`;
}

function narrationSectionsChanged(before: NarrationSection[], after: NarrationSection[]) {
  if (before.length !== after.length) return true;
  return after.some((section, index) => {
    const previous = before[index];
    return !previous || previous.order !== section.order || previous.title !== section.title || previous.text !== section.text;
  });
}

function narrationHeaderWord(value: string) {
  const firstHeader = cleanMultilineText(value)
    .split("\n")
    .map((line) => line.match(/^(\S+)\s+\d+\s*:/i)?.[1])
    .find(Boolean);
  return firstHeader || "\u0421\u043b\u0430\u0439\u0434";
}

function repeatedSentenceEdge(sections: NarrationSection[], edge: "first" | "last") {
  const counts = new Map<string, number>();
  for (const section of sections) {
    const sentences = speechSentences(section.text);
    const sentence = edge === "first" ? sentences[0] : sentences[sentences.length - 1];
    const key = sentenceEdgeKey(sentence || "");
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()].find(([, count]) => count >= 3)?.[0] || "";
}

function repairShortNarrationSections(sections: NarrationSection[], project: ProjectInput) {
  return sections.map((section, index) => {
    const expectedOrder = index + 1;
    if (section.order !== expectedOrder || !section.title) {
      return section;
    }

    const sentences = speechSentences(section.text);
    if (sentences.length >= 5 || sentences.length === 0) {
      return section;
    }

    const additions = speechSentences(
      buildSlideNarration(
        {
          title: section.title,
          thesis: sentences[0] || fallbackSlideText(project, expectedOrder),
          bullets: sentences.slice(1),
          definition: null,
          visual: emptyVisual(),
        },
        project,
        expectedOrder,
      ),
    );
    const repaired = [...sentences];
    const seen = new Set(repaired.map(normalizeForQuality).filter(Boolean));

    for (const addition of additions) {
      const key = normalizeForQuality(addition);
      if (!key || seen.has(key)) {
        continue;
      }
      repaired.push(addition);
      seen.add(key);
      if (repaired.length >= 5) {
        break;
      }
    }

    return { ...section, text: repaired.slice(0, 6).join(" ") };
  });
}

export function buildNarrativePlanPrompt(project: ProjectInput, sources: Source[], researchBrief?: ResearchBrief) {
  return [
    "Верни JSON-массив narrativePlan для StudyDeck презентации.",
    `Тема и запрос пользователя: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень аудитории: ${project.level}`,
    `Ровно слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
    `Верни ровно ${project.slideCount} элементов, без markdown и без пояснений.`,
    "Каждый элемент должен иметь строго такой вид:",
    JSON.stringify(
      {
        slideOrder: 1,
        slideTitle: "...",
        slidePurpose: "...",
        keyMessage: "...",
        audienceQuestion: "...",
        transitionToNext: "...",
      },
      null,
      2,
    ),
    "Правила:",
    "- весь текст должен быть на русском;",
    `- slideOrder строго от 1 до ${project.slideCount};`,
    "- slideTitle должен быть смысловым, не шаблонным;",
    "- slidePurpose объясняет роль слайда в выступлении;",
    "- keyMessage содержит главный тезис слайда;",
    "- audienceQuestion формулирует вопрос, на который отвечает слайд;",
    "- transitionToNext объясняет, почему после этого слайда логично перейти к следующему;",
    "- transitionToNext для последнего слайда должен быть пустой строкой;",
    "- не писать мета-фразы для пользователя вроде \"этот слайд показывает\";",
    "- не выдумывать точные факты, если их нет в источниках.",
    `Материалы только для внутренней фактологии; не показывать названия источников пользователю:\n${formatSourceText(sources)}`,
  ].join("\n\n");
}

function buildDesignBriefPrompt(
  project: ProjectInput,
  sources: Source[],
  researchBrief: ResearchBrief,
  narrativePlan: SlideNarrative[],
  deckStory: DeckStory,
  slideTextPlans: SlideTextPlan[],
) {
  const themeIds = [
    "editorialMagazine",
    "academicClean",
    "darkLecture",
    "timelineDocumentary",
    "scienceBoard",
    "startupPitch",
    "softClassroom",
  ].join(", ");
  return [
    "Create a StudyDeck DesignBrief JSON. You are choosing art direction, not drawing the slides.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Allowed themeId values: ${themeIds}.`,
    STUDENT_CREATION_BRIEF_LINES,
    "Choose one stable themeId. Do not invent custom theme IDs.",
    "Theme selection guide:",
    "- history/date-heavy topic -> timelineDocumentary;",
    "- biology/chemistry/physics/medicine/ecology -> scienceBoard;",
    "- business/product/economics/project defense -> startupPitch;",
    "- serious tech/analysis/dark topics -> darkLecture;",
    "- university report with no special domain -> academicClean;",
    "- creative/culture/literature/biography -> editorialMagazine;",
    "- younger or friendly explanation -> softClassroom.",
    "Return exactly one slideDirections item for every slide order.",
    "Do not output raw CSS, HTML, coordinates, pixel sizes, or layout code.",
    "Choose visualRole as a scene role: hero, problem, context, explain, compare, sequence, evidence, quote, visual_statement, or summary.",
    "Choose layoutIntent as an art-direction intent: full_bleed_image, split_image_text, statement, cards, timeline, diagram, comparison, evidence_board, quote_spread, or summary.",
    "Build Gamma-like visual rhythm while preserving university clarity: strong cover, short text-led moments, image-led scenes only when grounded, diagrams for explanation, evidence support, and a strong final takeaway.",
    "Do not repeat the same layoutIntent three times in a row. Do not make every slide a card grid.",
    "Choose imageStrategy independently for every slide: real_photo, generated_illustration, diagram, or none.",
    "Use real_photo only for a concrete, searchable person, place, object, company, event, artwork, historical scene, laboratory object, product, or environment that makes the idea more memorable.",
    "Use diagram for processes, comparisons, causes and effects, concept maps, timelines, structures, and systems. Diagram slides must be understandable from deterministic shapes and labels without an external image.",
    "Use none for strong theses, abstract claims, thinly sourced topics, reflective moments, and the final takeaway. Never request a random stock image merely to fill space.",
    "Across most decks, keep real_photo and generated_illustration together near 20-40 percent of slides; explanation-heavy slides should prefer diagrams, and images must not appear on every slide.",
    "Keep density low or medium: brief visible slides, richer speaker notes, and a balanced images_and_diagrams rhythm.",
    "For real_photo or generated_illustration, visualPrompt must be a short, concrete, searchable subject describing visible people, place, object, action, or event. Do not write generic phrases such as 'educational presentation image'.",
    "For diagram, visualPrompt must name the specific process, comparison, causal chain, timeline, or structure to draw. For none, describe the text-led emphasis briefly.",
    "Required JSON shape:",
    JSON.stringify({
      themeId: "academicClean",
      mood: "serious",
      audienceFit: "...",
      visualMetaphor: "...",
      colorIntent: "...",
      typographyIntent: "...",
      rhythm: {
        titleStyle: "academic",
        density: "medium",
        imageFrequency: "balanced",
        sectionBreaks: true,
      },
      slideDirections: [
        {
          slideOrder: 1,
          visualRole: "hero",
          layoutIntent: "full_bleed_image",
          imageStrategy: "real_photo",
          visualPrompt: "...",
        },
      ],
    }, null, 2),
    `Narrative plan:\n${formatNarrativePlanForPrompt(narrativePlan)}`,
    `Deck story:\n${JSON.stringify(deckStory, null, 2)}`,
    `Slide text plans:\n${JSON.stringify(slideTextPlans, null, 2)}`,
    `Research brief:\n${JSON.stringify(researchBrief, null, 2)}`,
    `Source excerpts for grounding:\n${formatSourceText(sources)}`,
  ].join("\n\n");
}

export function buildNarrationPrompt(project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[] = [], researchBrief?: ResearchBrief) {
  const planText = formatNarrativePlanForPrompt(narrativePlan);
  return [
    "Write the complete speech text for a StudyDeck presentation.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Mode: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
    researchBrief ? `Research brief to use for factual grounding:\n${JSON.stringify(researchBrief, null, 2)}` : "",
    planText ? `Narrative plan to follow exactly:\n${planText}` : "",
    "Output format:",
    "- plain text only;",
    "- exactly one section per slide;",
    "- every section starts with `Слайд N: semantic title`;",
    "- N must run from 1 through the exact slide count without gaps;",
    "- after each title line, write exactly 5-6 complete sentences for that slide;",
    "- do not use bullet lists, markdown, JSON, citations, source names, or comments.",
    "University speech rules:",
    "- write as a prepared university student: natural, confident, easy to read aloud, and professional without bureaucratic wording;",
    "- every section must explain the real topic, not the slide object;",
    "- every section must include at least one concrete detail, example, reason, consequence, contrast, or definition;",
    "- keep the full explanation in narration; visible slide text will be compressed later;",
    "- make neighboring openings and endings different in wording and rhythm;",
    "- make the final section a human university-level conclusion tied to the topic.",
    "Narrative plan rules:",
    "- every generatedText section must correspond to one narrativePlan element;",
    "- the section title must match or closely follow slideTitle;",
    "- each section must answer audienceQuestion;",
    "- each section must develop keyMessage;",
    "- follow transitionToNext by meaning, but never write mechanical phrases like `перейдем к следующему слайду`.",
    "Style model:",
    "- close to a university student report: direct, academic without stiffness, and easy to read aloud;",
    "- build one continuous report by meaning only: never explain that one slide, section, or paragraph connects to another;",
    "- each paragraph should explain the real topic, not the slide as an object;",
    "- start and finish neighboring paragraphs differently; do not reuse the same sentence pattern across slides;",
    "- use concrete facts from the material when available: names, events, organizations, causes, consequences, comparisons, examples;",
    "- if a slide needs extra sentences, add real content: cause, consequence, conflict, example, change, or conclusion from the topic;",
    "- make the final slide a human conclusion, for example `Для меня эта книга - не пример для повторения, а предупреждение`, only when that fits the topic;",
    "- keep the language natural and readable aloud.",
    "Hard bans:",
    "- do not write phrases like `нужно раскрыть через конкретные факты`, `этот слайд помогает`, `текст на слайде`, `опорные пункты`, or `основной смысл раскрывается`;",
    "- do not write phrases like `Дальше раздел`, `Сначала важно удержать конкретную мысль`, `Следующая деталь добавляет к объяснению новый шаг`, or `Этот шаг подводит рассказ к следующей части`;",
    "- do not mention transitions, neighboring slides, next sections, or how parts of the presentation connect; make the content itself connected;",
    "- write directly: instead of `Дальше раздел показывает...`, write `После первых успехов проблема становится заметнее...`;",
    "- never write universal endings like `Так становится понятнее, почему тема ... важна именно в этой части рассказа`, `Связь с разделом ... помогает слушателю увидеть не только событие, но и его значение`, or `Без этого уточнения дальнейший вывод...`;",
    "- do not write about `почему раздел важен`, `связь с разделом`, or `значение события` unless those exact ideas are real facts of the topic;",
    "- do not invent precise facts, dates, names, numbers, images, or examples when the source material does not support them;",
    "- do not repeat the user request as the speech text.",
    `Source material for internal factual grounding only; do not show source labels to the user:\n${formatSourceText(sources)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildNarrationRepairPrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  previousText: string,
  error: unknown,
  researchBrief?: ResearchBrief,
) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    buildNarrationPrompt(project, sources, narrativePlan, researchBrief),
    "The previous narration answer failed validation.",
    `Validation error: ${message}`,
    "Rewrite the full narration from scratch as one coherent university student report and fix every listed issue.",
    "Do not patch short sections with generic endings or transition phrases. Replace weak paragraphs with real topic content.",
    "Never explain how slides, sections, neighboring paragraphs, or next parts connect; write the connected content itself.",
    "Every slide section must contain 5 or 6 complete sentences after its title line, and sections must not share the same opening or closing phrase.",
    previousText ? `Previous invalid answer, for diagnosis only:\n${cleanMultilineText(previousText).slice(0, 12000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatNarrativePlanForPrompt(narrativePlan: SlideNarrative[]) {
  if (!narrativePlan.length) {
    return "";
  }

  return JSON.stringify(narrativePlan, null, 2);
}

export function normalizeNarrativePlan(raw: unknown, project: ProjectInput): SlideNarrative[] {
  const value = parseNarrativePlanRaw(raw);
  const inputItems = Array.isArray(value) ? value : [];
  const normalized: SlideNarrative[] = [];

  for (let index = 0; index < project.slideCount; index += 1) {
    const order = index + 1;
    const rawItem = inputItems[index] && typeof inputItems[index] === "object" ? (inputItems[index] as Partial<SlideNarrative>) : {};
    const fallback = buildFallbackNarrativeItem(project, order);
    const slideTitle = cleanNarrativeField(rawItem.slideTitle, "title") || fallback.slideTitle;
    normalized.push({
      slideOrder: order,
      slideTitle,
      slidePurpose: cleanNarrativeField(rawItem.slidePurpose, "purpose") || fallback.slidePurpose,
      keyMessage: cleanNarrativeField(rawItem.keyMessage, "message") || fallback.keyMessage,
      audienceQuestion: cleanNarrativeField(rawItem.audienceQuestion, "question") || fallback.audienceQuestion,
      transitionToNext:
        order === project.slideCount
          ? ""
          : cleanNarrativeField(rawItem.transitionToNext, "transition") || fallback.transitionToNext,
    });
  }

  return normalized;
}

function parseNarrativePlanRaw(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === "object") {
    const candidate = raw as { narrativePlan?: unknown };
    return Array.isArray(candidate.narrativePlan) ? candidate.narrativePlan : raw;
  }

  const text = cleanMultilineText(raw);
  if (!text) {
    return [];
  }

  try {
    const parsed = parseJsonText(text);
    return parseNarrativePlanRaw(parsed);
  } catch {
    return [];
  }
}

function cleanNarrativeField(value: unknown, kind: "title" | "purpose" | "message" | "question" | "transition") {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  const lower = text.toLowerCase();
  const genericFragments = [
    "этот слайд",
    "данный слайд",
    "слайд показывает",
    "слайд рассказывает",
    "слайд объясняет",
    "переходим к следующему",
    "перейдем к следующему",
    "следующий слайд",
    "ключевые факты",
    "основные мысли",
  ];
  if (genericFragments.some((fragment) => lower.includes(fragment))) {
    return "";
  }

  if (kind === "title" && isGenericSlideTitle(normalizeTitleKey(text))) {
    return "";
  }

  if (kind !== "title" && text.split(/\s+/).filter(Boolean).length < 3) {
    return "";
  }

  return shortenSentence(text, kind === "title" ? 90 : 220);
}

function buildFallbackNarrativeItem(project: ProjectInput, order: number, titleOverride = ""): SlideNarrative {
  const title = cleanText(titleOverride) || fallbackTitle(project, order);
  const topic = cleanText(project.title || project.prompt);
  return {
    slideOrder: order,
    slideTitle: title,
    slidePurpose:
      order === 1
        ? `Задать понятный контекст темы «${topic}» и показать, с какого вопроса начинается выступление.`
        : order === project.slideCount
          ? `Собрать главный вывод по теме «${topic}» и оставить аудитории ясную итоговую мысль.`
          : `Раскрыть важную часть темы «${topic}» через отдельный смысловой шаг выступления.`,
    keyMessage:
      order === project.slideCount
        ? `Главный вывод должен быть связан с темой «${topic}» и объяснен простыми словами.`
        : `Тема «${topic}» становится понятнее через конкретный аспект: ${title}.`,
    audienceQuestion:
      order === 1
        ? `Почему тема «${topic}» важна для этого выступления?`
        : order === project.slideCount
          ? `Какой вывод нужно запомнить после выступления?`
          : `Что важно понять про «${title}»?`,
    transitionToNext:
      order === project.slideCount
        ? ""
        : `После «${title}» логично раскрыть следующий аспект темы «${topic}», чтобы сохранить последовательность объяснения.`,
  };
}

export function buildGenerationPrompt(
  project: ProjectInput,
  sources: Source[],
  narrationText = "",
  narrativePlan: SlideNarrative[] = [],
  artifacts: PromptArtifacts = {},
) {
  const fixedNarration = cleanMultilineText(narrationText);
  const planText = formatNarrativePlanForPrompt(narrativePlan);
  const theme = resolvePresentationTheme(project);
  const supportedThemeIds = PREMIUM_PRESENTATION_THEME_IDS.join(", ");
  const researchText = artifacts.researchBrief ? JSON.stringify(artifacts.researchBrief, null, 2) : "";
  const storyText = artifacts.deckStory ? JSON.stringify(artifacts.deckStory, null, 2) : "";
  const designText = artifacts.designBrief ? JSON.stringify(artifacts.designBrief, null, 2) : "";
  const blueprintText = artifacts.slideBlueprints?.length ? JSON.stringify(artifacts.slideBlueprints, null, 2) : "";
  const textPlanText = artifacts.slideTextPlans?.length ? JSON.stringify(artifacts.slideTextPlans, null, 2) : "";
  return [
    "Create a complete StudyDeck PresentationDocument as JSON.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Mode: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
    "All slide-facing text must be in Russian.",
    researchText ? `Use this researchBrief as factual guardrails. Do not invent facts outside it or the source excerpts:\n${researchText}` : "",
    planText ? `Use this fixed narrativePlan and copy it into the final PresentationDocument:\n${planText}` : "",
    storyText ? `Use this deckStory as the deck-level content spine. Do not show it as a separate UI field:\n${storyText}` : "",
    designText ? `Use this designBrief for deck-level visual direction:\n${designText}` : "",
    blueprintText ? `Use these slideBlueprints as per-slide intent. Match slide order, purpose, layout candidate, visual strategy, and text density where possible:\n${blueprintText}` : "",
    textPlanText ? `Use these slideTextPlans as per-slide text structure. Build each slide from slideQuestion, coreClaim, evidenceOrExample, listenerTakeaway, title, thesis, bullets, and speakerNotes:\n${textPlanText}` : "",
    fixedNarration
      ? `Use this fixed speech narration as the only source of truth. Copy it exactly into generatedText and do not rewrite its meaning:\n${fixedNarration}`
      : "Use generatedText as the single source of truth for the deck, divided exactly as `Слайд 1: ...` through the requested slide count.",
    "Build title, thesis, bullets, blocks, visual.description, speakerNotes, and speechScript from the matching generatedText section and the matching narrativePlan item.",
    "Treat the slideTextPlans as the compression layer: visible text comes from title, thesis, and bullets; speakerNotes remain the richer 5-6 sentence report text.",
    "Do not generate a separate second story outside generatedText or narrativePlan.",
    "Do not put slidePurpose or transitionToNext on the slide as visible text.",
    "Visual theme rules:",
    `- use this fixed visual theme for the deck: themeId=${theme.themeId || "legacy"}, preset=${theme.preset}, mood=${theme.mood}, font tone=${theme.fonts.tone};`,
    `- supported premium theme IDs are: ${supportedThemeIds}; if presentationTheme.themeId is present, it must be exactly one of these values;`,
    "- do not invent arbitrary theme IDs; keep the fixed themeId from the designBrief or omit themeId for legacy themes;",
    "- do not invent CSS, HTML, font files, or color tokens in the JSON;",
    "- match image descriptions and visual choices to the theme mood: darker and stricter for serious material, lighter and softer for cheerful material;",
    "- vary block presentation from slide to slide through layout and visual.type; do not make every content slide feel like the same card/list template.",
    "Voice model:",
    "- use the style of a university student academic study report: clear, concrete, calm, human, and professional enough to present aloud;",
    "- give the audience a path through the subject: what it is, why it matters, what changes, where the conflict or key tension is, and what conclusion follows;",
    "- use concrete details from the material: names, products, organizations, events, causes, consequences, comparisons, or examples;",
    "- when a personal or evaluative conclusion fits the scenario, write it plainly, for example 'Для меня эта история - предупреждение', but only if it suits the topic;",
    "- vary sentence length. Do not make every paragraph the same rhythm.",
    "Required deck structure:",
    "- slide 1 must have slideKind title;",
    "- the final slide must have slideKind summary and contain a human conclusion plus 3-5 key takeaways in bullets;",
    "- include slideKind section divider slides between major chapters when the deck has enough slides;",
    "- all other study slides must have slideKind content.",
    "Required JSON fields: id, title, scenario, level, slideCount, generatedText, sources, outline, narrativePlan, designBrief, speechScript, slides.",
    "Copy the provided designBrief into the final document exactly unless schema repair requires filling a missing slideDirections item.",
    "Each slide must include: id, order, title, slideKind, layout, thesis, bullets, definition, keyConcepts, visual, highlights, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "Layout rules:",
    "- layout must be one of: hero, summary, statement, quote, timeline, process, image-focus, metrics;",
    "- do not use the same content layout more than twice in a row;",
    "- choose the layout from the slide's idea, not from a fixed template;",
    "- use statement for one strong claim with one short callout and no list;",
    "- use quote when a concise quote or author-like formulation is central;",
    "- use timeline only for chronology with 3-5 dated or named periods; each visual.items entry must have a period in label and the event plus its significance in text;",
    "- use process only for 3-5 ordered actions; each visual.items entry must have a short action in label and an explanation or result in text;",
    "- use image-focus for a concrete image and process for a sequence of actions or stages;",
    "- use metrics only for 2-4 explicit numbers, percentages, dates, durations, or measured quantities already supported by the material; never turn list order into a metric;",
    "Content slide rules:",
    "- title: short, ideally 6-8 words or fewer;",
    "- title: semantic and memorable. Avoid generic titles such as 'Контекст', 'Ключевые факты', 'Примеры', 'Выводы', and 'Итоги' unless there is only one such title in the whole deck;",
    "- thesis: one concise sentence about the real subject matter, not a meta sentence about the slide;",
    "- every slide must contain one clear thesis plus 2-3 short meaningful points when the layout supports points;",
    "- bullets: 0-3 short meaningful points; use bullets only when the slide is genuinely a list or a summary; every bullet must be a compressed phrase from the matching narration section;",
    "- definition: { term, text } only when an important term needs a simple definition; otherwise null;",
    "- keyConcepts: return an empty array; do not create small keyword chips on slides;",
    "- highlights: return an empty array; do not create small highlighted word badges on slides;",
    "- blocks: keep a backward-compatible fallback using callout, quote, or bullets; mirror the chosen layout instead of always returning bullets.",
    "Slide-facing text style:",
    "- every visible title, thesis, bullet, block, definition, and visual item must be a complete thought; never end visible text with an unfinished phrase such as 'the first thing to note is rich';",
    "- use the same clear study-report style as the narration, but much shorter;",
    "- do not write 'Главная идея связана с темой', 'Материал стоит разбирать по смысловым частям', or similar filler;",
    "- do not repeat the user's request as content. Answer the request instead.",
    "- do not mention nonexistent topics, pictures, diagrams, images, examples, sources, or visual objects unless they are explicitly present in the provided material;",
    "- do not refer to the slide itself with phrases like 'на слайде показано', 'этот слайд помогает', or 'текст на слайде';",
    "- if the source material is thin, write a cautious general explanation instead of inventing facts or visuals.",
    "- never write generic filler such as 'Финальный вывод раскрывается через контекст, причины и последствия', 'Главные факты лучше воспринимаются, когда между ними видна связь', 'Точная формулировка помогает перейти от факта к смыслу', or similar universal placeholder phrases.",
    "Narration rules:",
    "- speakerNotes must be the matching generatedText section body or a very close 5-6 sentence restatement, guided by the matching narrativePlan item;",
    "- speechScript must contain one matching 5-6 sentence item for every slide and must duplicate or closely restate the matching speakerNotes;",
    "- slide thesis, bullets, definition, blocks, and visual content must be a short outline based on generatedText and narrativePlan, not on a separate story;",
    "- write narration in a concise study-report style: concrete, human, explanatory, and understandable to listeners;",
    "- speakerNotes and speechScript must continue the report from slide to slide; do not make every slide begin or end with the same pattern;",
    "- keep the report connected by meaning, but never write that a slide, section, step, or detail connects to another slide or section;",
    "- write about the topic, event, phenomenon, causes, consequences, and conclusion, not about the presentation structure;",
    "- do not start narration with 'Слайд ...', 'На этом слайде ...', or similar meta phrases;",
    "- do not use phrases about 'текст на слайде', 'опорные пункты', 'основной смысл раскрывается', 'рассказ про', 'главный акцент здесь', 'часть подводит', or 'Примеры. Поэтому';",
    "- do not use phrases like 'Дальше раздел', 'продолжает тему', 'Сначала важно удержать конкретную мысль', 'Следующая деталь добавляет к объяснению новый шаг', 'новый шаг', 'к следующей части', or 'оставляет место для следующей мысли';",
    "- do not use repeated formula starts like 'Это проявляется в том, что', 'Причина такого вывода в том', or 'Последствия заметны там, где';",
    "- avoid the words 'раздел', 'следующий', 'переход', and 'слайд' in narration unless they are part of the real subject matter;",
    "- never use endings like 'Так становится понятнее, почему тема ... важна именно в этой части рассказа', 'Связь с разделом ... помогает слушателю увидеть не только событие, но и его значение', or 'Без этого уточнения дальнейший вывод...';",
    "- do not write generic phrases like 'this slide explains the section'; explain the actual topic of the slide.",
    "Visual field rules:",
    "- visual.type must be one of: process_diagram, comparison_diagram, cause_effect_diagram, before_after_table, pros_cons_table, timeline, mind_map, illustration, schema, image, none;",
    "- every slide, including title, section, and summary slides, must include visual.description as a concrete image search concept;",
    "- set visual.type to image or illustration when a photo or illustration is the main visual anchor; use none only for structured visual type, not as a reason to omit visual.description;",
    "- never fill visual.title, visual.items, or visual.rows with generic placeholder text just to create a visual block;",
    "- use process_diagram for ordered actions or steps;",
    "- use comparison_diagram for comparing concepts;",
    "- use cause_effect_diagram for causes and consequences;",
    "- use before_after_table for changes over time or transformation;",
    "- use pros_cons_table for evaluating options;",
    "- use timeline for historical or chronological topics;",
    "- use mind_map for relationships between concepts;",
    "- use illustration, schema, or image when a concrete image will explain this exact slide better than text;",
    "- visual.items contains concrete steps/nodes; visual.rows with left/right columns is for tables and comparisons.",
    "- comparison/table visuals must include meaningful left and right values for each row;",
    "- process, timeline, mind_map, and schema visuals must include at least two concrete items;",
    "- visual.description must describe a concrete, searchable image for the real subject of the matching narration section in Russian or English;",
    "- every slide must have a different visual.description concept so later image search can choose different pictures;",
    "- do not put URLs or image provider names into visual.description; describe the desired scene, object, person, place, chart, or illustration only.",
    "Hard limits:",
    "- Do not write long text blocks on slides.",
    "- Do not put markdown headings, source names, citations, sourceRefs, TODOs, or instructions into title, thesis, bullets, blocks, or speaker notes. sourceRefs remain structured metadata only.",
    "- Do not invent precise facts when the material does not support them; give a general explanation instead.",
    "- Keep detailed narration only in speakerNotes and speechScript.",
    `Source material for factual grounding. Keep source labels only in structured sourceRefs, primarily for evidence layouts:\n${formatSourceText(sources)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function legacyBuildGenerationPrompt(project: ProjectInput, sources: Source[]) {
  return [
    "Собери готовую презентацию StudyDeck PresentationDocument.",
    `Тема и запрос пользователя: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень аудитории: ${project.level}`,
    `Количество слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
    "Требования к слайдам:",
    "- каждый слайд выглядит как 16:9 учебный кадр: короткий заголовок и один блок текста на 1-2 фразы;",
    "- текст на слайде должен быть кратким, без маркированных списков, markdown-заголовков и длинных абзацев;",
    "- источники используй только как внутренний материал для фактов; не упоминай слово 'источник' и названия источников в slides, speakerNotes и speechScript;",
    "- speakerNotes и speechScript должны быть подробным связным текстом, который можно читать во время выступления;",
    "- не используй фразы: 'тезис нужно объяснить', 'проверьте тезис', 'добавьте источник', 'ключевой вывод нужно связать', 'основная мысль слайда'.",
    "Обязательный JSON: id, title, scenario, level, slideCount, outline, speechScript, slides.",
    "Для каждого slide: id, order, title, layout, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "layout: hero, statement или summary. blocks лучше возвращать как один callout; bullets допустимы только если это 1-2 короткие фразы.",
    `Материалы для внутренней фактологии, не показывать пользователю:\n${formatSourceText(sources)}`,
  ].join("\n\n");
}

function formatSourceText(sources: Source[]) {
  return sources
    .map((source) => {
      const location = source.url ? `\nURL: ${source.url}` : "";
      return `[${source.id}] ${source.label}${location}\n${source.excerpt}`;
    })
    .join("\n\n")
    .slice(0, 18000);
}

function getYandexModelUri() {
  if (process.env.YANDEX_MODEL_URI?.trim()) {
    return process.env.YANDEX_MODEL_URI.trim();
  }

  if (!process.env.YANDEX_FOLDER_ID?.trim()) {
    throw new Error("YANDEX_FOLDER_ID or YANDEX_MODEL_URI is required for Yandex generation");
  }

  const modelName = process.env.YANDEX_MODEL_NAME || "yandexgpt";
  return `gpt://${process.env.YANDEX_FOLDER_ID}/${modelName}/latest`;
}

function normalizePresentation(
  raw: unknown,
  project: ProjectInput,
  sources: Source[],
  generationMode: AiGenerationMode | FallbackGenerationMode,
  generatedText = "",
  narrativePlan: SlideNarrative[] = [],
  validate = true,
  designBrief?: DesignBrief,
): PresentationDocument {
  const input = raw && typeof raw === "object" ? (raw as Partial<PresentationDocument>) : {};
  assertRawGenerationQuality({ ...input, generatedText: input.generatedText || generatedText }, project, generationMode);
  const publicSources = normalizeSources(sources, project);
  const normalizedGeneratedText = normalizeGeneratedText(
    generatedText || cleanMultilineText(input.generatedText) || buildFallbackGeneratedText(project),
    project,
  );
  const narrationSections = parseNarrationSections(normalizedGeneratedText);
  const narrationOutline = narrationSections.map((section) => section.title);
  const outline = narrationOutline.length === project.slideCount ? narrationOutline : normalizeOutline(input.outline);
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  const normalizedDesignBrief = normalizeDesignBrief(input.designBrief || designBrief, project, publicSources, narrativePlan);
  const slides = rawSlides
    .slice(0, project.slideCount)
    .map((slide, index) => normalizeSlide(slide, index + 1, publicSources, project, narrationSections[index]));

  while (slides.length < project.slideCount) {
    slides.push(buildFallbackSlide(slides.length + 1, project, publicSources, narrationSections[slides.length]));
  }

  repairRepeatedSlideTitles(slides, outline, project);
  diversifySlideLayouts(slides, normalizedDesignBrief);
  const normalizedNarrativePlan = normalizePresentationNarrativePlan(input.narrativePlan, narrativePlan, project, narrationSections, slides);

  const rawSpeechScript = Array.isArray(input.speechScript) ? input.speechScript : [];
  const speechTitleCounts = countTitles(rawSpeechScript.map((item) => cleanText(item?.slideTitle)));
  const speechScript = slides.map((slide, index) => {
    const source = rawSpeechScript.find((item) => Number(item?.slideOrder) === slide.order) || rawSpeechScript[index];
    const sourceTitle = cleanText(source?.slideTitle);
    const narrationSection = narrationSections[index];

    return {
      slideOrder: slide.order,
      slideTitle: shouldReplaceTitle(sourceTitle, speechTitleCounts) ? slide.title : sourceTitle || narrationSection?.title || slide.title,
      text: normalizeSpeechScriptText(source?.text, slide, project, index, narrationSection?.text),
    };
  });

  const presentation = presentationSchema.parse({
    id: cleanText(input.id) || crypto.randomUUID(),
    title: cleanText(input.title) || project.title,
    scenario: cleanText(input.scenario) || project.scenario,
    level: cleanText(input.level) || project.level,
    slideCount: slides.length,
    generationMode,
    generatedText: normalizedGeneratedText,
    sources: publicSources,
    outline: slides.map((slide) => slide.title),
    narrativePlan: normalizedNarrativePlan,
    presentationTheme: resolvePresentationTheme({
      title: cleanText(input.title) || project.title,
      prompt: project.prompt,
      scenario: cleanText(input.scenario) || project.scenario,
      level: cleanText(input.level) || project.level,
      presentationTheme: input.presentationTheme,
      designBrief: normalizedDesignBrief,
    }),
    designBrief: normalizedDesignBrief,
    speechScript,
    slides,
  });

  if (validate) {
    assertPresentationQuality(presentation, project, generationMode);
  }
  return presentation;
}

async function finalizeGeneratedPresentation(
  raw: unknown,
  project: ProjectInput,
  sources: Source[],
  generationMode: AiGenerationMode,
  generatedText: string,
  narrativePlan: SlideNarrative[],
  repair: (presentation: PresentationDocument, issues: SlideTextIssue[]) => Promise<unknown>,
  qualityCallbacks: QualityModelCallbacks = {},
  designBrief?: DesignBrief,
) {
  let presentation = normalizePresentation(raw, project, sources, generationMode, generatedText, narrativePlan, false, designBrief);
  let issues = findSlideTextIssues(presentation);
  let qualityCritique = buildQualityCritique(presentation, issues);

  if (issues.length) {
    try {
      const repaired = await repair(presentation, issues);
      presentation = applySlideTextRepairs(presentation, repaired, project);
    } catch (error) {
      console.warn(`${generationMode} slide text review failed, using narration fallback:`, error);
    }

    issues = findSlideTextIssues(presentation);
    qualityCritique = buildQualityCritique(presentation, issues);
    if (issues.length) {
      presentation = applyNarrationFallbacks(presentation, issues, project);
      issues = findSlideTextIssues(presentation);
      qualityCritique = buildQualityCritique(presentation, issues);
    }
  }

  if (issues.length) {
    console.warn("AI generation quality check found unresolved slide text issues; continuing with quality repair", {
      projectId: project.id,
      generationMode,
      issues: issues.map((issue) => ({
        slideOrder: issue.slideOrder,
        fields: issue.fields,
        reasons: issue.reasons,
      })),
    });
  }

  try {
    assertPresentationQuality(presentation, project, generationMode);
  } catch (error) {
    const locallyRepaired = repairPresentationNarrationLocally(presentation, project, generationMode);
    if (locallyRepaired) {
      presentation = locallyRepaired;
    } else if (!isRepairablePresentationQualityError(error)) {
      throw error;
    } else {
      console.warn("AI generation quality check found repairable presentation issues; continuing with quality repair", {
        projectId: project.id,
        generationMode,
        error,
      });
    }
  }

  const improved = await improvePresentationQuality(presentation, project, sources, generationMode, qualityCallbacks);
  assertNoForbiddenTemplateText(improved);
  const finalIssues = findSlideTextIssues(improved);
  return finalIssues.length
    ? presentationSchema.parse({ ...improved, qualityCritique: buildQualityCritique(improved, finalIssues) })
    : improved;
}

function repairPresentationNarrationLocally(
  presentation: PresentationDocument,
  project: ProjectInput,
  generationMode: AiGenerationMode | FallbackGenerationMode,
) {
  const sections = parseNarrationSections(presentation.generatedText);
  if (!canLocallyRepairNarrationSections(sections, project)) {
    return null;
  }

  let repairedSections = repairNarrationSentenceCounts(sections, project);
  const repairedText = repairedSections.map((section) => formatNarrationSection(section)).join("\n\n");
  if (qualityIssuesForText(repairedText, project, false).length) {
    repairedSections = repairNarrationQualitySections(repairedSections, project);
  }
  if (validateNarrationSections(repairedSections, project).length) {
    return null;
  }

  const generatedText = repairedSections.map((section) => formatNarrationSection(section)).join("\n\n");
  const raw: PresentationDocument = {
    ...presentation,
    generatedText,
    slides: presentation.slides.map((slide, index) => ({
      ...slide,
      speakerNotes: repairedSections[index]?.text || slide.speakerNotes,
    })),
    speechScript: presentation.speechScript.map((item, index) => ({
      ...item,
      slideTitle: repairedSections[index]?.title || item.slideTitle,
      text: repairedSections[index]?.text || item.text,
    })),
  };

  const repaired = normalizePresentation(
    raw,
    project,
    presentation.sources,
    generationMode,
    generatedText,
    presentation.narrativePlan,
    false,
    presentation.designBrief,
  );

  try {
    assertPresentationQuality(repaired, project, generationMode);
    return repaired;
  } catch {
    return null;
  }
}

function canLocallyRepairNarrationSections(sections: NarrationSection[], project: ProjectInput) {
  if (sections.length !== project.slideCount) return false;
  return sections.every((section, index) => {
    if (!section || section.order !== index + 1 || !section.title) return false;
    const sentences = speechSentences(section.text);
    if (sentences.length < 5) return false;
    if (sentences.length <= 6) return true;
    return sentences.filter((sentence) => isUsableNarrationSentence(sentence, section, project)).length >= 5;
  });
}

async function repairSlideTextWithOpenAI(client: OpenAI, presentation: PresentationDocument, issues: SlideTextIssue[]) {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "Ты редактор текста учебных слайдов. Исправляй только видимый текст слайдов. Не изменяй заметки докладчика, не добавляй факты и возвращай только JSON.",
      },
      {
        role: "user",
        content: buildSlideTextRepairPrompt(presentation, issues),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_slide_text_repair",
        strict: false,
        schema: slideTextRepairSchema,
      },
    },
  });
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  return typedResponse.output_parsed || parseJsonText(response.output_text || "");
}

async function repairSlideTextWithYandex(apiKey: string, presentation: PresentationDocument, issues: SlideTextIssue[]) {
  const outputText = await requestYandexText(
    apiKey,
    "Ты редактор текста учебных слайдов. Исправляй только видимый текст слайдов. Не изменяй заметки докладчика, не добавляй факты и возвращай только JSON.",
    buildSlideTextRepairPrompt(presentation, issues),
    { jsonSchema: slideTextRepairSchema },
  );
  return parseJsonText(outputText);
}

async function critiquePresentationQualityWithOpenAI(
  client: OpenAI,
  presentation: PresentationDocument,
  deterministic: QualityCritique,
) {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: QUALITY_CRITIC_SYSTEM_PROMPT },
      { role: "user", content: buildQualityCriticPrompt(presentation, deterministic) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_quality_critique",
        strict: true,
        schema: qualityCritiqueJsonSchema,
      },
    },
  });
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  return typedResponse.output_parsed || parseJsonText(response.output_text || "");
}

async function critiquePresentationQualityWithYandex(
  apiKey: string,
  presentation: PresentationDocument,
  deterministic: QualityCritique,
) {
  const outputText = await requestYandexText(
    apiKey,
    QUALITY_CRITIC_SYSTEM_PROMPT,
    buildQualityCriticPrompt(presentation, deterministic),
    { jsonSchema: qualityCritiqueJsonSchema },
  );
  return qualityCritiqueSchema.parse(parseJsonText(outputText));
}

async function repairPresentationQualityWithOpenAI(
  client: OpenAI,
  presentation: PresentationDocument,
  issues: QualityIssue[],
  attempt: number,
): Promise<QualityRepairResponse> {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: QUALITY_REPAIR_SYSTEM_PROMPT },
      { role: "user", content: buildQualityRepairPrompt(presentation, issues, attempt) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_quality_repair",
        strict: false,
        schema: qualityRepairJsonSchema,
      },
    },
  });
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  return (typedResponse.output_parsed || parseJsonText(response.output_text || "")) as QualityRepairResponse;
}

async function repairPresentationQualityWithYandex(
  apiKey: string,
  presentation: PresentationDocument,
  issues: QualityIssue[],
  attempt: number,
): Promise<QualityRepairResponse> {
  const outputText = await requestYandexText(
    apiKey,
    QUALITY_REPAIR_SYSTEM_PROMPT,
    buildQualityRepairPrompt(presentation, issues, attempt),
    { jsonSchema: qualityRepairJsonSchema },
  );
  return parseJsonText(outputText) as QualityRepairResponse;
}

function buildSlideTextRepairPrompt(presentation: PresentationDocument, issues: SlideTextIssue[]) {
  const slides = issues.map((issue) => {
    const slide = presentation.slides.find((candidate) => candidate.order === issue.slideOrder);
    return {
      slideOrder: issue.slideOrder,
      title: slide?.title,
      speakerNotes: slide?.speakerNotes,
      problems: issue.reasons,
      fields: issue.fields,
      current: slide
        ? {
            thesis: slide.thesis,
            bullets: slide.bullets,
            blocks: slide.blocks,
            definition: slide.definition,
            visual: {
              title: slide.visual.title,
              items: slide.visual.items,
              rows: slide.visual.rows,
              leftLabel: slide.visual.leftLabel,
              rightLabel: slide.visual.rightLabel,
            },
          }
        : null,
    };
  });

  return [
    "Перепиши только перечисленные проблемные слайды одним ответом.",
    "Текст должен быть понятным без заметок докладчика: законченные формулировки, конкретный смысл, без обрывков и метатекста о презентации.",
    "Сохрани факты и смысл speakerNotes. Не придумывай имена, даты, числа, причины или выводы, которых там нет.",
    "Не меняй title, speakerNotes или speechScript.",
    "Верни объект { slides: [...] }. Для каждого slideOrder верни полный набор thesis, bullets, blocks, definition и visual с исправленным видимым текстом.",
    JSON.stringify({ slides }),
  ].join("\n\n");
}

function buildQualityCriticPrompt(presentation: PresentationDocument, deterministic: QualityCritique) {
  const slides = presentation.slides.map((slide) => ({
    id: slide.id,
    order: slide.order,
    title: slide.title,
    slideKind: slide.slideKind,
    layout: slide.layout,
    thesis: slide.thesis,
    bullets: slide.bullets,
    visual: {
      type: slide.visual.type,
      description: slide.visual.description,
    },
    speakerNotes: slide.speakerNotes,
    sourceRefs: slide.sourceRefs.map((ref) => ({ sourceId: ref.sourceId, label: ref.label })),
  }));

  return [
    "Evaluate the presentation. Do not rewrite it. Return only JSON with score, summary, dimensions and issues.",
    "Dimensions are speechNaturalness, universityTone, slideBrevity, visualRhythm, sourceGrounding and exportReadiness. Score each from 0 to 100 and give a short reason.",
    "Ask: can a university student read this aloud naturally; are slides brief; is visual rhythm intentional; are claims grounded; will export preserve the design?",
    "Use severity blocker, major or minor. Use category generic_text, off_topic, too_long, duplicate, bad_narration, bad_visual, factual_risk or schema_risk.",
    "Prefer field-level issues with slideId when a single slide can be repaired.",
    "Do not quote or repeat full source text.",
    JSON.stringify({
      deterministic,
      deck: {
        title: presentation.title,
        scenario: presentation.scenario,
        level: presentation.level,
        slideCount: presentation.slideCount,
        outline: presentation.outline,
        slides,
      },
    }),
  ].join("\n\n");
}

function buildQualityRepairPrompt(presentation: PresentationDocument, issues: QualityIssue[], attempt: number) {
  const affectedSlideIds = new Set(issues.map((issue) => issue.slideId).filter(Boolean));
  const acceptedNarration = new Map(parseNarrationSections(presentation.generatedText).map((section) => [section.order, section.text]));
  const slides = presentation.slides
    .filter((slide) => !affectedSlideIds.size || affectedSlideIds.has(slide.id))
    .map((slide) => ({
      slideId: slide.id,
      slideOrder: slide.order,
      title: slide.title,
      slideKind: slide.slideKind,
      layout: slide.layout,
      thesis: slide.thesis,
      bullets: slide.bullets,
      blocks: slide.blocks,
      visual: {
        type: slide.visual.type,
        title: slide.visual.title,
        description: slide.visual.description,
        leftLabel: slide.visual.leftLabel,
        rightLabel: slide.visual.rightLabel,
        items: slide.visual.items,
        rows: slide.visual.rows,
      },
      speakerNotes: slide.speakerNotes,
      acceptedNarration: acceptedNarration.get(slide.order) || slide.speakerNotes,
      sourceRefs: slide.sourceRefs.map((ref) => ({ sourceId: ref.sourceId, label: ref.label })),
    }));

  return [
    `Repair attempt ${attempt}. Repair only the listed broken fields and slides.`,
    "Return JSON { slides: [...] }. Each slide item must include slideId or slideOrder plus changed fields only.",
    "You may change title, thesis, bullets, blocks, visual.description and speakerNotes when the issue explicitly requires it.",
    "For visual rhythm issues you may also choose a schema-valid layout and make the visual description concrete; the worker will rebuild generated canvases.",
    "For weak speech, rewrite speakerNotes from the accepted narration and keep the matching speechScript aligned.",
    "Replace template transitions, filler, and watery phrases with topic-specific causes, examples, consequences, concrete mechanisms, and a clear conclusion.",
    "Do not write about slide structure, transitions, next sections, or what the presentation will explain; write the actual subject matter.",
    "Do not invent precise facts, dates, names, numbers, or citations. Preserve existing sourceRefs.",
    "Keep slide text compact: title <= 12 words, thesis one sentence, bullets <= 18 words.",
    JSON.stringify({ issues, slides }),
  ].join("\n\n");
}

function applySlideTextRepairs(
  presentation: PresentationDocument,
  rawRepairs: unknown,
  project: ProjectInput,
): PresentationDocument {
  const response = rawRepairs && typeof rawRepairs === "object" ? (rawRepairs as SlideTextRepairResponse) : {};
  const repairs = Array.isArray(response.slides) ? response.slides : [];
  if (!repairs.length) return presentation;

  const narrationSections = parseNarrationSections(presentation.generatedText);
  const slides = presentation.slides.map((slide, index) => {
    const repair = repairs.find((candidate) => Number(candidate?.slideOrder) === slide.order);
    if (!repair) return slide;
    return normalizeSlide(
      {
        ...slide,
        thesis: repair.thesis ?? slide.thesis,
        bullets: repair.bullets ?? slide.bullets,
        blocks: repair.blocks ?? slide.blocks,
        definition: repair.definition ?? slide.definition,
        visual: repair.visual ? { ...slide.visual, ...(repair.visual as Partial<SlideVisual>) } : slide.visual,
        speakerNotes: slide.speakerNotes,
      },
      slide.order,
      presentation.sources,
      project,
      narrationSections[index],
    );
  });

  return presentationSchema.parse({ ...presentation, slides });
}

function applyNarrationFallbacks(
  presentation: PresentationDocument,
  issues: SlideTextIssue[],
  project: ProjectInput,
): PresentationDocument {
  const issueMap = new Map(issues.map((issue) => [issue.slideOrder, issue]));
  const narrationSections = parseNarrationSections(presentation.generatedText);
  const slides = presentation.slides.map((slide, index) => {
    const issue = issueMap.get(slide.order);
    if (!issue) return slide;

    const sentences = completeNarrationSentences(slide.speakerNotes);
    const existingBullet = slide.bullets.find(
      (item, itemIndex) =>
        !issue.fields.includes(`bullets.${itemIndex}`) &&
        !hasGenericOrMetaScreenText(item) &&
        !looksLikeSentenceFragment(item),
    );
    const fallbackThesis = existingBullet
      ? shortenCompleteSentence(`${slide.title}: ${sentenceFragment(existingBullet)}`, 18)
      : sentences[0] || slide.thesis || fallbackSlideText(project, slide.order);
    const thesis = issue.fields.includes("thesis") ? fallbackThesis : slide.thesis;
    const bullets = uniqueShortItems(sentences.slice(1, 5)).filter((item) => !isDuplicateDisplayText(item, thesis));
    const safeBullets = ensureRange(
      bullets,
      buildFallbackBulletItems(project, slide.order, slide.speakerNotes),
      slide.slideKind === "summary" ? 3 : 2,
      slide.slideKind === "summary" ? 5 : 3,
    );
    const repairedBullets = issue.fields.some((field) => field.startsWith("bullets.")) ? safeBullets : slide.bullets;
    const repairedBlocks = issue.fields.some((field) => field.startsWith("blocks."))
      ? [{ type: "bullets" as const, items: safeBullets }]
      : slide.blocks;
    const repairedDefinition = slide.definition
      ? {
          term: issue.fields.includes("definition.term") ? safeLabelFromSentence(fallbackThesis) : slide.definition.term,
          text: issue.fields.includes("definition.text") ? fallbackThesis : slide.definition.text,
        }
      : null;

    const repairedVisual = {
      ...slide.visual,
      title: issue.fields.includes("visual.title") ? "" : slide.visual.title,
      items: slide.visual.items.map((item, itemIndex) => ({
        label: issue.fields.includes(`visual.items.${itemIndex}.label`) ? safeLabelFromSentence(sentences[itemIndex + 1] || thesis) : item.label,
        text: issue.fields.includes(`visual.items.${itemIndex}.text`) ? sentences[itemIndex + 1] || thesis : item.text,
      })),
      rows: slide.visual.rows.map((row, rowIndex) => ({
        label: issue.fields.includes(`visual.rows.${rowIndex}.label`) ? safeLabelFromSentence(sentences[rowIndex + 1] || thesis) : row.label,
        left: issue.fields.includes(`visual.rows.${rowIndex}.left`) ? sentences[rowIndex + 1] || thesis : row.left,
        right: issue.fields.includes(`visual.rows.${rowIndex}.right`) ? sentences[rowIndex + 2] || sentences[0] || thesis : row.right,
      })),
    };

    return normalizeSlide(
      {
        ...slide,
        thesis,
        bullets: repairedBullets,
        blocks: repairedBlocks,
        definition: repairedDefinition,
        visual: repairedVisual,
        speakerNotes: slide.speakerNotes,
      },
      slide.order,
      presentation.sources,
      project,
      narrationSections[index],
    );
  });

  return presentationSchema.parse({ ...presentation, slides });
}

export function findSlideTextIssues(presentation: PresentationDocument): SlideTextIssue[] {
  return presentation.slides
    .map((slide) => inspectSlideText(slide))
    .filter((issue): issue is SlideTextIssue => Boolean(issue));
}

function inspectSlideText(slide: Slide): SlideTextIssue | null {
  const entries = visibleSlideTextEntries(slide);
  const fields = new Set<string>();
  const reasons = new Set<string>();
  const seen = new Map<string, string>();

  for (const entry of entries) {
    const text = cleanText(entry.text);
    if (!text) continue;

    if (hasGenericOrMetaScreenText(text)) {
      fields.add(entry.field);
      reasons.add("generic or meta text");
    }

    if (!entry.label && looksLikeSentenceFragment(text)) {
      fields.add(entry.field);
      reasons.add("sentence fragment");
    }

    if (!entry.label && isNarrativeScreenField(entry.field) && isWeaklyRelatedToNarration(text, slide)) {
      fields.add(entry.field);
      reasons.add("text is weakly related to speaker notes");
    }

    const normalizedText = normalizeForQuality(text);
    const key = `${entry.group}:${normalizedText}`;
    if (normalizedText && normalizedText === normalizeForQuality(slide.title) && entry.field !== "definition.term") {
      fields.add(entry.field);
      reasons.add("text duplicates the slide title");
    } else if (key && seen.has(key)) {
      fields.add(entry.field);
      fields.add(seen.get(key)!);
      reasons.add("visible text is duplicated");
    } else if (key) {
      seen.set(key, entry.field);
    }
  }

  return fields.size
    ? {
        slideOrder: slide.order,
        fields: [...fields],
        reasons: [...reasons],
      }
    : null;
}

function isNarrativeScreenField(field: string) {
  return field === "thesis" || field.startsWith("bullets.") || field.startsWith("blocks.") || field === "definition.text";
}

function visibleSlideTextEntries(slide: Slide) {
  return [
    { field: "thesis", text: slide.thesis, label: false, group: "thesis" },
    ...slide.bullets.map((text, index) => ({ field: `bullets.${index}`, text, label: false, group: "bullets" })),
    ...slide.blocks.flatMap((block, index) =>
      block.type === "bullets"
        ? block.items.map((text, itemIndex) => ({ field: `blocks.${index}.items.${itemIndex}`, text, label: false, group: `block-${index}` }))
        : [{ field: `blocks.${index}.content`, text: block.content, label: false, group: `block-${index}` }],
    ),
    ...(slide.definition
      ? [
          { field: "definition.term", text: slide.definition.term, label: true, group: "definition" },
          { field: "definition.text", text: slide.definition.text, label: false, group: "definition" },
        ]
      : []),
    { field: "visual.title", text: slide.visual.title, label: true, group: "visual-title" },
    ...slide.visual.items.flatMap((item, index) => [
      { field: `visual.items.${index}.label`, text: item.label, label: true, group: "visual-item-labels" },
      { field: `visual.items.${index}.text`, text: item.text, label: false, group: "visual-item-texts" },
    ]),
    ...slide.visual.rows.flatMap((row, index) => [
      { field: `visual.rows.${index}.label`, text: row.label, label: true, group: "visual-row-labels" },
      { field: `visual.rows.${index}.left`, text: row.left, label: false, group: "visual-row-left" },
      { field: `visual.rows.${index}.right`, text: row.right, label: false, group: "visual-row-right" },
    ]),
    { field: "visual.leftLabel", text: slide.visual.leftLabel, label: true, group: "visual-columns" },
    { field: "visual.rightLabel", text: slide.visual.rightLabel, label: true, group: "visual-columns" },
  ];
}

function hasGenericOrMetaScreenText(value: string) {
  const normalized = normalizeExactForQuality(value);
  if (hasForbiddenTemplateText(value)) {
    return true;
  }
  if (GENERIC_SCREEN_TEXT_PHRASES.some((phrase) => normalized.includes(normalizeExactForQuality(phrase)))) {
    return true;
  }
  return /\b(презентаци|слайд|заметк|докладчик|текст на экран|можно вынести следующее)\w*/iu.test(value);
}

function looksLikeSentenceFragment(value: string) {
  const text = cleanText(value);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return true;
  if (/[,;:\-–—]$/.test(text)) return true;
  if (hasDanglingPredicateModifier(text)) return true;
  return /^(\u043a\u043e\u0442\u043e\u0440\u044b\u0439|\u043a\u043e\u0442\u043e\u0440\u0430\u044f|\u043a\u043e\u0442\u043e\u0440\u043e\u0435|\u043a\u043e\u0442\u043e\u0440\u044b\u0435|\u043f\u043e\u0442\u043e\u043c\u0443 \u0447\u0442\u043e)\b/iu.test(text);
}

function hasDanglingPredicateModifier(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const last = words.at(-1) || "";
  if (words.length < 4) return false;
  const hasPredicateSetup = /(?:^|[^\p{L}])(\u044d\u0442\u043e|\u044d\u0442\u0430|\u044d\u0442\u043e\u0442|\u044d\u0442\u0438|\u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f|\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0435\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f|\u0431\u044b\u043b\u0430|\u0431\u044b\u043b|\u0431\u044b\u043b\u043e|\u0431\u0443\u0434\u0435\u0442|\u0441\u0442\u0430\u043b\u0430|\u0441\u0442\u0430\u043b|\u0441\u0442\u0430\u043b\u043e)(?=$|[^\p{L}])/iu.test(text);
  return hasPredicateSetup && /(\u0430\u044f|\u044f\u044f|\u044b\u0439|\u0438\u0439|\u043e\u0439|\u043e\u0435|\u0435\u0435|\u044b\u0435|\u0438\u0435|\u0443\u044e|\u044e\u044e|\u043e\u0433\u043e|\u0435\u0433\u043e|\u043e\u043c\u0443|\u0435\u043c\u0443|\u044b\u043c|\u0438\u043c|\u044b\u0445|\u0438\u0445)$/.test(last);
}

function isWeaklyRelatedToNarration(value: string, slide: Slide) {
  const valueTokens = new Set(significantTokens(value));
  if (valueTokens.size < 6) return false;
  const narrationTokens = new Set(significantTokens(`${slide.title} ${slide.speakerNotes}`));
  if (!narrationTokens.size) return false;
  const overlap = [...valueTokens].filter((token) => narrationTokens.has(token)).length;
  return overlap === 0;
}

function completeNarrationSentences(value: string) {
  return speechSentences(sanitizeSpeechText(value))
    .filter(isCompleteScreenSentence)
    .map((sentence) => shortenCompleteSentence(sentence, 18));
}

function isCompleteScreenSentence(value: string) {
  const text = cleanText(value);
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 4 && !/[,;:\-–—]$/.test(text) && !looksLikeSentenceFragment(text);
}

function shortenCompleteSentence(value: string, maxWords: number) {
  const text = cleanText(value);
  const words = text.replace(/[.!?]+$/g, "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return /[.!?]$/.test(text) ? text : `${text}.`;
  return `${words.slice(0, maxWords).join(" ")}.`;
}

function safeLabelFromSentence(value: string) {
  return shortenWords(cleanText(value).replace(/[.!?]+$/g, ""), 5);
}

function normalizePresentationNarrativePlan(
  rawPlan: unknown,
  generatedPlan: SlideNarrative[],
  project: ProjectInput,
  narrationSections: NarrationSection[],
  slides: Slide[],
) {
  const fromInput = normalizeNarrativePlan(rawPlan, project);
  const parsedRawPlan = parseNarrativePlanRaw(rawPlan);
  const inputHasPlan = Array.isArray(parsedRawPlan) && parsedRawPlan.length > 0;
  if (inputHasPlan) {
    return fromInput;
  }

  if (generatedPlan.length) {
    return normalizeNarrativePlan(generatedPlan, project);
  }

  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const section = narrationSections[index];
    const slide = slides[index];
    const fallback = buildFallbackNarrativeItem(project, order, section?.title || slide?.title);
    return {
      ...fallback,
      slideTitle: cleanNarrativeField(section?.title || slide?.title, "title") || fallback.slideTitle,
      keyMessage: cleanNarrativeField(slide?.thesis || firstSentence(section?.text), "message") || fallback.keyMessage,
      transitionToNext: order === project.slideCount ? "" : fallback.transitionToNext,
    };
  });
}

function normalizeDesignBrief(raw: unknown, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[]) {
  const parsed = designBriefSchema.safeParse(raw);
  if (parsed.success) {
    return ensureDesignBriefDirections(parsed.data, project, narrativePlan);
  }
  return buildDesignBrief(project, buildResearchBrief(project, sources), narrativePlan);
}

function ensureDesignBriefDirections(brief: DesignBrief, project: ProjectInput, narrativePlan: SlideNarrative[]) {
  let normalized = brief;
  if (brief.slideDirections.length !== project.slideCount) {
    const fallback = buildDesignBrief(project, {
      topic: cleanText(project.title || project.prompt),
      angle: cleanText(project.prompt),
      facts: [],
      warnings: [],
      vocabulary: [],
    }, narrativePlan);
    const byOrder = new Map(brief.slideDirections.map((direction) => [direction.slideOrder, direction]));
    normalized = designBriefSchema.parse({
      ...brief,
      slideDirections: fallback.slideDirections.map((direction) => byOrder.get(direction.slideOrder) || direction),
    });
  }

  const maximumImages = Math.max(1, Math.floor(project.slideCount * 0.4));
  let imageCount = 0;
  const slideDirections = normalized.slideDirections.map((direction) => {
    const plan = narrativePlan[direction.slideOrder - 1] || buildFallbackNarrativeItem(project, direction.slideOrder);
    if (direction.slideOrder === project.slideCount || direction.visualRole === "summary") {
      return {
        ...direction,
        layoutIntent: "summary" as const,
        imageStrategy: "none" as const,
        visualPrompt: buildDeterministicVisualPrompt(project, plan, "none", "summary"),
      };
    }
    if (direction.imageStrategy !== "real_photo" && direction.imageStrategy !== "generated_illustration") {
      return direction;
    }
    imageCount += 1;
    if (imageCount <= maximumImages) return direction;
    return {
      ...direction,
      layoutIntent: direction.visualRole === "hero" ? "statement" as const : "cards" as const,
      imageStrategy: "none" as const,
      visualPrompt: buildDeterministicVisualPrompt(project, plan, "none", direction.layoutIntent),
    };
  });

  return designBriefSchema.parse({ ...normalized, slideDirections });
}

function normalizeSlide(rawSlide: unknown, order: number, sources: Source[], project: ProjectInput, narrationSection?: NarrationSection): Slide {
  const slide = rawSlide && typeof rawSlide === "object" ? (rawSlide as Partial<Slide>) : {};
  const sourceRefs = Array.isArray(slide.sourceRefs) && slide.sourceRefs.length
    ? slide.sourceRefs
    : [sourceRefFromSource(sources[(order - 1) % sources.length])];
  const rawBlocks = Array.isArray(slide.blocks) ? slide.blocks.map(normalizeBlock).filter((block): block is SlideBlock => Boolean(block)) : [];
  const slideKind = normalizeSlideKind(slide.slideKind, order, project.slideCount);
  const title = shortenWords(cleanText(slide.title) || narrationSection?.title || fallbackTitle(project, order), slideKind === "title" ? 12 : 8);
  const thesis = normalizeThesis(slide.thesis, rawBlocks, project, order, slideKind, title);
  const fallbackSource = [narrationSection?.text, thesis, slideText(rawBlocks)].filter(Boolean).join(" ");
  const bullets = ensureSlideSentenceDensity(normalizeBullets(slide.bullets, rawBlocks, project, order, slideKind, title, fallbackSource), thesis, project, order, slideKind, fallbackSource);
  const definition = normalizeDefinition(slide.definition);
  const keyConcepts = normalizeKeyConcepts(slide.keyConcepts, title, bullets, slideKind);
  const highlights = normalizeHighlights(slide.highlights, thesis, bullets, slideKind);
  const visual = normalizeVisual(slide.visual, title, thesis, bullets, slideKind, project, order);
  const blocks = normalizeSlideBlocks(rawBlocks, project, order, thesis, bullets, slideKind);

  return {
    id: cleanText(slide.id) || `slide-${order}`,
    order,
    title,
    slideKind,
    layout: normalizeLayout(slide.layout, order, project.slideCount, slideKind, {
      title,
      thesis,
      bullets,
      definition,
      visual,
      blocks,
      sourceRefs,
    }),
    thesis,
    bullets,
    definition,
    keyConcepts,
    visual,
    highlights,
    blocks,
    speakerNotes: normalizeSpeakerNotes(slide.speakerNotes, { title, thesis, bullets, definition, visual }, project, order, narrationSection?.text),
    timingSeconds: clampNumber(Number(slide.timingSeconds || 55), 20, 240),
    sourceRefs: sourceRefs.slice(0, 3).map((ref) => ({
      sourceId: cleanText(ref.sourceId) || sources[0]?.id || "src-prompt",
      label: cleanText(ref.label) || sources.find((source) => source.id === ref.sourceId)?.label || "Материал",
      excerpt: cleanText(ref.excerpt) || sources.find((source) => source.id === ref.sourceId)?.excerpt || "",
      page: ref.page || null,
    })),
  };
}

function normalizeBlock(block: unknown): SlideBlock | null {
  if (!block || typeof block !== "object") {
    return null;
  }

  const candidate = block as Partial<SlideBlock>;
  if (candidate.type === "bullets") {
    const items = Array.isArray(candidate.items) ? candidate.items.map(sanitizeScreenText).filter(Boolean).slice(0, 5) : [];
    return items.length ? { type: "bullets", items } : null;
  }

  if (candidate.type === "quote" || candidate.type === "callout") {
    const content = sanitizeScreenText(candidate.content);
    return content ? { type: candidate.type, content } : null;
  }

  return null;
}

function normalizeSlideKind(value: unknown, order: number, slideCount: number): SlideKind {
  if (order === 1) return "title";
  if (order === slideCount) return "summary";
  if (value === "section" || value === "content") return value;
  if (slideCount >= 6 && (order === 2 || order === Math.ceil(slideCount / 2))) return "section";
  return "content";
}

function normalizeThesis(value: unknown, blocks: SlideBlock[], project: ProjectInput, order: number, slideKind: SlideKind, title = "") {
  if (slideKind === "section") return "";
  const fromValue = firstSentence(sanitizeScreenText(value));
  if (fromValue && !isDuplicateDisplayText(fromValue, title)) return shortenSentence(fromValue, slideKind === "title" ? 150 : 180);
  const fromBlocks = firstSentence(slideText(blocks));
  const fallback = isDuplicateDisplayText(fromBlocks, title) ? "" : fromBlocks;
  return shortenSentence(fallback || fallbackSlideText(project, order), slideKind === "title" ? 150 : 180);
}

function normalizeBullets(value: unknown, blocks: SlideBlock[], project: ProjectInput, order: number, slideKind: SlideKind, title = "", fallbackSource = "") {
  const fromValue = Array.isArray(value) ? value.map(sanitizeScreenText).filter(Boolean) : [];
  const fromBlocks = blocks.flatMap((block) => (block.type === "bullets" ? block.items : splitIntoSentences("content" in block ? block.content : "")));
  const items = uniqueShortItems([...fromValue, ...fromBlocks])
    .filter((item) => !looksLikeSentenceFragment(item))
    .filter((item) => !isDuplicateDisplayText(item, title))
    .slice(0, 5);

  if (slideKind === "title" || slideKind === "section") {
    return items.slice(0, 3);
  }

  if (slideKind !== "summary" && items.length) {
    return items.slice(0, 5);
  }

  const minimum = slideKind === "summary" ? 3 : 2;
  const fallback = buildFallbackBulletItems(project, order, fallbackSource);
  return ensureRange(items, fallback, minimum, 5);
}

function ensureSlideSentenceDensity(items: string[], thesis: string, project: ProjectInput, order: number, slideKind: SlideKind, fallbackSource = "") {
  const existing = uniqueShortItems(items).filter((item) => !looksLikeSentenceFragment(item)).slice(0, slideKind === "summary" ? 5 : 3);
  const visibleSentenceCount = splitIntoSentences([thesis, ...existing].join(" ")).length;
  const minimum = slideKind === "summary" ? 3 : 2;

  if (visibleSentenceCount >= minimum) {
    return existing;
  }

  const fallback = buildFallbackBulletItems(project, order, fallbackSource).filter((item) => item.toLowerCase() !== thesis.toLowerCase());
  return uniqueShortItems([...existing, ...fallback]).slice(0, slideKind === "summary" ? 5 : 3);
}

function normalizeDefinition(value: unknown): SlideDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SlideDefinition>;
  const term = sanitizeScreenText(candidate.term);
  const text = sanitizeScreenText(candidate.text);
  return term && text ? { term: shortenSentence(term, 60), text: shortenSentence(text, 180) } : null;
}

function normalizeKeyConcepts(_value: unknown, _title: string, _bullets: string[], _slideKind: SlideKind): KeyConcept[] {
  return [];
}

function normalizeHighlights(_value: unknown, _thesis: string, _bullets: string[], _slideKind: SlideKind): Highlight[] {
  return [];
}

function normalizeVisual(
  value: unknown,
  title: string,
  thesis: string,
  bullets: string[],
  slideKind: SlideKind,
  project: ProjectInput,
  order: number,
): SlideVisual {
  const candidate = value && typeof value === "object" ? (value as Partial<SlideVisual>) : {};
  const requestedType = normalizeVisualType(candidate.type);
  const description = sanitizeScreenText(candidate.description) || imageConcept(project, order, title, thesis, bullets, slideKind);
  const rows = Array.isArray(candidate.rows)
    ? candidate.rows
        .map((row) => ({
          label: sanitizeScreenText(row?.label),
          left: sanitizeScreenText(row?.left),
          right: sanitizeScreenText(row?.right),
        }))
        .filter((row) => row.label || row.left || row.right)
        .slice(0, 8)
    : [];
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .map((item) => ({
          label: sanitizeScreenText(item?.label),
          text: sanitizeScreenText(item?.text),
        }))
        .filter((item) => item.label || item.text)
        .slice(0, 8)
    : [];
  const completeRows = rows.filter((row) => row.left && row.right);
  const type = usefulVisualType(requestedType, items, completeRows);

  if (type === "none") {
    return { ...emptyVisual(), description };
  }

  return {
    type,
    title: normalizeVisualTitle(candidate.title, title),
    description,
    leftLabel: sanitizeScreenText(candidate.leftLabel) || defaultLeftLabel(type),
    rightLabel: sanitizeScreenText(candidate.rightLabel) || defaultRightLabel(type),
    items: type === "image" || type === "illustration" ? [] : items,
    rows: isRowVisual(type) ? completeRows : [],
  };
}

function normalizeVisualType(value: unknown): SlideVisual["type"] {
  const allowed: SlideVisual["type"][] = [
    "process_diagram",
    "comparison_diagram",
    "cause_effect_diagram",
    "before_after_table",
    "pros_cons_table",
    "timeline",
    "mind_map",
    "illustration",
    "schema",
    "image",
    "none",
  ];
  if (allowed.includes(value as SlideVisual["type"])) return value as SlideVisual["type"];
  return "none";
}

function emptyVisual(): SlideVisual {
  return { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
}

function normalizeVisualTitle(value: unknown, slideTitle: string) {
  const title = sanitizeScreenText(value);
  if (!title || isGenericVisualTitle(title) || isDuplicateDisplayText(title, slideTitle)) return "";
  return title;
}

function isGenericVisualTitle(title: string) {
  const key = normalizeTitleKey(title);
  return ["visual example", "визуальный пример", "иллюстрация", "image"].includes(key);
}

function usefulVisualType(type: SlideVisual["type"], items: SlideVisual["items"], rows: SlideVisual["rows"]): SlideVisual["type"] {
  if (isRowVisual(type)) {
    return rows.length >= 1 ? type : "none";
  }

  if (["process_diagram", "timeline", "mind_map", "schema"].includes(type)) {
    return items.filter((item) => item.label || item.text).length >= 2 ? type : "none";
  }

  if (type === "illustration" || type === "image") return type;

  return type === "none" ? "none" : type;
}

function isRowVisual(type: SlideVisual["type"]) {
  return ["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(type);
}

function normalizeSources(sources: Source[], project: ProjectInput): Source[] {
  const normalized = sources
    .map((source) => ({
      id: cleanText(source.id),
      label: cleanText(source.label) || "Материал",
      type: cleanText(source.type) || "SOURCE",
      size: source.size || 0,
      excerpt: cleanText(source.excerpt),
      objectKey: source.objectKey || undefined,
      url: source.url || undefined,
    }))
    .filter((source) => source.id && source.excerpt);

  return normalized.length
    ? normalized
    : [{ id: "src-prompt", label: "Запрос пользователя", type: "PROMPT", size: 0, excerpt: project.prompt }];
}

function sourceRefFromSource(source: Source | undefined) {
  return {
    sourceId: source?.id || "src-prompt",
    label: source?.label || "Запрос пользователя",
    excerpt: source?.excerpt || "",
    page: null,
  };
}

function buildFallbackSlide(order: number, project: ProjectInput, sources: Source[], narrationSection?: NarrationSection): Slide {
  const source = sources[(order - 1) % sources.length];
  const slideKind = normalizeSlideKind(undefined, order, project.slideCount);
  const title = narrationSection?.title || fallbackTitle(project, order);
  const thesis = normalizeThesis("", [], project, order, slideKind);
  const bullets = ensureSlideSentenceDensity(normalizeBullets([], [], project, order, slideKind), thesis, project, order, slideKind);
  const definition = null;
  const visual = fallbackVisual(order, title, thesis, bullets, slideKind, project);
  const blocks = buildFallbackBlocks(project, order, thesis, bullets, slideKind);
  return {
    id: `slide-${order}`,
    order,
    title,
    slideKind,
    layout: normalizeLayout(undefined, order, project.slideCount, slideKind, { title, thesis, bullets, definition, visual, blocks }),
    thesis,
    bullets,
    definition,
    keyConcepts: normalizeKeyConcepts([], title, bullets, slideKind),
    visual,
    highlights: normalizeHighlights([], thesis, bullets, slideKind),
    blocks,
    speakerNotes: narrationSection?.text || buildFallbackSpeakerNotes(project, order),
    timingSeconds: order === 1 || order === project.slideCount ? 45 : 55,
    sourceRefs: [sourceRefFromSource(source)],
  };
}

function buildFallbackBlocks(project: ProjectInput, order = 1, thesis = "", bullets: string[] = [], slideKind: SlideKind = "content"): SlideBlock[] {
  if (slideKind === "title" || slideKind === "section") {
    return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
  }

  const layout = CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
  if (layout === "quote") {
    return [{ type: "quote", content: thesis || fallbackSlideText(project, order) }];
  }

  if (["statement", "question-answer", "image-focus"].includes(layout)) {
    return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
  }

  if (slideKind === "summary" || bullets.length >= 2) {
    return [{ type: "bullets", items: bullets.length ? bullets : buildFallbackBulletItems(project, order) }];
  }

  return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
}

function fallbackVisual(order: number, title: string, thesis: string, bullets: string[], slideKind: SlideKind, project: ProjectInput): SlideVisual {
  const layout = CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
  const items = bullets.slice(0, 4).map((label) => ({ label, text: "" }));
  const description = imageConcept(project, order, title, thesis, bullets, slideKind);

  if (slideKind === "title" || slideKind === "section") {
    return { ...emptyVisual(), type: "image", title: "", description };
  }

  if (layout === "process" && items.length >= 2) {
    return { ...emptyVisual(), type: "process_diagram", title: "", description, items };
  }

  if (layout === "timeline" && items.length >= 2) {
    return { ...emptyVisual(), type: "timeline", title: "", description, items };
  }

  return { ...emptyVisual(), type: "image", title: "", description };
}

function imageConcept(project: ProjectInput, order: number, title: string, thesis: string, bullets: string[], slideKind: SlideKind) {
  const topic = cleanText(project.title || project.prompt);
  const focus = cleanText(title || fallbackTitle(project, order));
  const detail = cleanText(thesis || bullets[0] || project.prompt);
  const role = slideKind === "summary" ? "summary educational image" : slideKind === "title" ? "opening educational image" : "educational image";
  return shortenSentence(`${role}: ${topic}; ${focus}; ${detail}`, 220);
}

function fallbackTitle(project: ProjectInput, order: number) {
  const topic = cleanText(project.title || project.prompt) || "Материал";
  const titles = [
    topic,
    `Контекст: ${topic}`,
    `Причины: ${topic}`,
    `Изменения: ${topic}`,
    `Конкретный случай: ${topic}`,
    `Последствия: ${topic}`,
    `Связи: ${topic}`,
    `Практический вывод: ${topic}`,
    `Итог: ${topic}`,
    `Значение: ${topic}`,
  ];
  return shortenWords(titles[order - 1] || `${order}. ${topic}`, 12);
}

function normalizeSlideBlocks(
  blocks: SlideBlock[],
  project: ProjectInput,
  order: number,
  thesis: string,
  bullets: string[],
  slideKind: SlideKind,
): SlideBlock[] {
  if (blocks.length) {
    const normalized = blocks.slice(0, 3);
    const text = slideText(normalized);
    if (splitIntoSentences([thesis, text].filter(Boolean).join(" ")).length >= 2) {
      return normalized;
    }
    const fallbackItems = ensureSlideSentenceDensity([], thesis, project, order, slideKind).slice(0, 2);
    return [...normalized, { type: "bullets" as const, items: fallbackItems }].slice(0, 3);
  }
  return buildFallbackBlocks(project, order, thesis, bullets, slideKind);
}

function normalizeSpeakerNotes(
  value: unknown,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual">,
  project: ProjectInput,
  order: number,
  narrationText = "",
) {
  const narration = sanitizeSpeechText(narrationText);
  if (isCompleteNarration(narration)) {
    return limitSentences(narration, 6);
  }

  const text = sanitizeSpeechText(value);
  if (isCompleteNarration(text)) {
    return limitSentences(text, 6);
  }

  return buildSlideNarration(slide, project, order);
}

function normalizeSpeechScriptText(value: unknown, slide: Slide, project: ProjectInput, index: number, narrationText = "") {
  const narration = sanitizeSpeechText(narrationText);
  if (isCompleteNarration(narration)) {
    return limitSentences(narration, 6);
  }

  const text = sanitizeSpeechText(value);
  if (isCompleteNarration(text)) {
    return limitSentences(text, 6);
  }

  return normalizeSpeakerNotes(slide.speakerNotes, slide, project, index + 1);
}

function buildSlideNarration(slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual">, project: ProjectInput, order: number) {
  return buildNarrationFromContent(
    cleanText(slide.title) || fallbackTitle(project, order),
    cleanText(slide.thesis) || fallbackSlideText(project, order),
    [
      ...slide.bullets.map(cleanText).filter(Boolean),
      slide.definition?.text || "",
      visualNarrationText(slide.visual),
    ],
    project,
    order,
  );
}

function buildNarrationFromContent(titleInput: string, thesisInput: string, pointInputs: string[], project: ProjectInput, order: number) {
  const topic = cleanText(project.title || project.prompt) || "Материал";
  const title = cleanText(titleInput) || fallbackTitle(project, order);
  const thesis = cleanText(thesisInput) || fallbackSlideText(project, order);
  const points = uniqueShortItems([
    ...pointInputs,
    thesis,
    fallbackSlideText(project, order + 1),
    fallbackSlideText(project, order + 2),
  ])
    .filter((item) => !isDuplicateDisplayText(item, title))
    .filter((item) => !hasForbiddenTemplateText(item));
  const firstPoint = points[0] || thesis;
  const secondPoint = points[1] || firstPoint;
  const thirdPoint = points[2] || secondPoint;
  const fourthPoint = points[3] || thirdPoint;
  const candidates = [
    `${title}: ${sentenceFragment(thesis)}.`,
    completeNarrationSentence(firstPoint),
    `${topic} связан с тем, что ${sentenceFragment(secondPoint)}.`,
    `${completeNarrationFragment(thirdPoint)} влияет на объяснение "${topic}".`,
    `"${title}" соединяет два факта: ${sentenceFragment(firstPoint)} и ${sentenceFragment(secondPoint)}.`,
    `${completeNarrationFragment(fourthPoint)} помогает сделать вывод по материалу.`,
    `${title} сохраняет связь с "${topic}" через конкретные детали.`,
  ];
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const sentence of candidates.flatMap((candidate) => speechSentences(sanitizeSpeechText(candidate)))) {
    const clean = cleanText(sentence);
    const key = normalizeForQuality(clean);
    if (!key || seen.has(key)) continue;
    if (clean.split(/\s+/).filter(Boolean).length < 4) continue;
    if (looksLikeSentenceFragment(clean) || hasForbiddenTemplateText(clean)) continue;
    selected.push(clean);
    seen.add(key);
    if (selected.length >= 5) break;
  }

  return selected.slice(0, 5).join(" ");
}

function completeNarrationSentence(value: string) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function completeNarrationFragment(value: string) {
  const fragment = sentenceFragment(value);
  return fragment ? `${fragment.charAt(0).toUpperCase()}${fragment.slice(1)}` : "";
}

function visualNarrationText(visual: SlideVisual) {
  if (!visual || visual.type === "none") return "";
  const item = visual.items.find((entry) => entry.label || entry.text);
  const row = visual.rows.find((entry) => entry.label || entry.left || entry.right);
  return cleanText(item?.text || item?.label || row?.left || row?.right || visual.description || visual.title);
}

function isCompleteNarration(text: string) {
  const count = sentenceCount(text);
  if (count < 5 || count > 6) return false;
  if (text.length < 80) return false;
  return !hasForbiddenTemplateText(text);
}

function sentenceCount(text: string) {
  return speechSentences(text).length;
}

function limitSentences(text: string, max: number) {
  const sentences = speechSentences(text);
  return sentences.slice(0, max).join(" ");
}

function speechSentences(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function sentenceFragment(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : "";
}

function sentenceEdgeKey(value: string) {
  return normalizeForQuality(value).split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
}

function buildFallbackBulletItems(project: ProjectInput, order: number, sourceText = "") {
  const topic = cleanText(project.title || project.prompt);
  const focus = order > 1 ? fallbackTitle(project, order) : topic;
  const sourceItems = uniqueShortItems(
    splitIntoSentences(sourceText)
      .filter(isCompleteScreenSentence)
      .map((item) => shortenCompleteSentence(item, 18)),
  );
  if (sourceItems.length >= 3) {
    return sourceItems.slice(0, 5);
  }
  const base = [
    ...sourceItems,
    shortenCompleteSentence(cleanText(project.prompt || topic), 16),
    shortenCompleteSentence(`${focus}: ${topic}`, 16),
    shortenCompleteSentence(`${topic} связан с конкретным контекстом`, 16),
    shortenCompleteSentence(`${topic} меняется через причины и последствия`, 16),
  ];
  return uniqueShortItems(base).slice(0, 5);
}

function ensureRange(items: string[], fallback: string[], min: number, max: number) {
  const next = uniqueShortItems([...items, ...fallback]).slice(0, max);
  return next.length >= min ? next : fallback.slice(0, max);
}

function uniqueShortItems(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const clean = shortenSentence(sanitizeScreenText(item).replace(/^[-*]\s*/, ""), 130);
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

function splitIntoSentences(value: unknown) {
  return cleanText(value)
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map(sanitizeScreenText)
    .filter(Boolean);
}

function firstSentence(value: unknown) {
  return splitIntoSentences(value)[0] || "";
}

function lastSentence(value: unknown) {
  const sentences = splitIntoSentences(value);
  return sentences[sentences.length - 1] || "";
}

function wordCount(value: unknown) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function defaultLeftLabel(type: SlideVisual["type"]) {
  if (type === "before_after_table") return "До";
  if (type === "pros_cons_table") return "Плюсы";
  if (type === "comparison_diagram") return "Первое";
  if (type === "cause_effect_diagram") return "Причина";
  return "";
}

function defaultRightLabel(type: SlideVisual["type"]) {
  if (type === "before_after_table") return "После";
  if (type === "pros_cons_table") return "Минусы";
  if (type === "comparison_diagram") return "Второе";
  if (type === "cause_effect_diagram") return "Следствие";
  return "";
}

function fallbackRows(type: SlideVisual["type"], bullets: string[]) {
  if (!["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(type)) return [];
  return bullets.slice(0, 4).map((item, index) => ({
    label: index === 0 ? "Главное" : `Пункт ${index + 1}`,
    left: item,
    right: "",
  }));
}

function slideText(blocks: SlideBlock[]) {
  return sanitizeScreenText(
    blocks
      .flatMap((block) => (block.type === "bullets" ? block.items : [block.content]))
      .filter(Boolean)
      .slice(0, 5)
      .join(" "),
  );
}

function normalizeOutline(value: unknown) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
}

function repairRepeatedSlideTitles(slides: Slide[], outline: string[], project: ProjectInput) {
  const titleCounts = countTitles(slides.map((slide) => slide.title));
  const outlineCounts = countTitles(outline);

  slides.forEach((slide, index) => {
    if (!shouldReplaceTitle(slide.title, titleCounts)) {
      return;
    }

    const outlineTitle = cleanText(outline[index]);
    slide.title = shouldReplaceTitle(outlineTitle, outlineCounts) ? fallbackTitle(project, slide.order) : outlineTitle;
  });
}

function countTitles(titles: string[]) {
  return titles.reduce<Map<string, number>>((counts, title) => {
    const key = normalizeTitleKey(title);
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, new Map());
}

function shouldReplaceTitle(title: string, titleCounts: Map<string, number>) {
  const key = normalizeTitleKey(title);
  return !key || isGenericSlideTitle(key) || (titleCounts.get(key) || 0) > 1;
}

function normalizeTitleKey(title: string) {
  return cleanText(title).toLowerCase();
}

function isDuplicateDisplayText(value: string, reference: string) {
  const left = normalizeComparableText(value);
  const right = normalizeComparableText(reference);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 18 && longer.includes(shorter);
}

function normalizeComparableText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericSlideTitle(titleKey: string) {
  return [
    "введение",
    "intro",
    "introduction",
    "слайд",
    "slide",
    "титульный слайд",
  ].includes(titleKey);
}

function fallbackSlideText(project: ProjectInput, order: number) {
  const topic = cleanText(project.title || project.prompt) || "Материал";
  const focus = fallbackTitle(project, order);
  const texts = [
    `${topic}: ${sentenceFragment(focus)}.`,
    `${focus} связан с конкретным контекстом "${topic}".`,
    `${topic} стоит раскрывать через причины, изменения и последствия.`,
    `${focus} показывает, что в "${topic}" меняется и почему это важно.`,
    `Конкретный случай помогает объяснить "${topic}" через понятный опыт.`,
    `Сложную часть "${topic}" лучше передать коротко и по существу.`,
    `Связь между фактами делает "${topic}" понятнее для слушателя.`,
    `Перед финалом остаются самые сильные факты про "${topic}".`,
    `${focus} помогает собрать причины и последствия в понятный вывод.`,
    `${topic} получает смысл, когда факты связаны с реальной ситуацией.`,
  ];
  return shortenSentence(texts[order - 1] || `${topic}: суть лучше объяснить коротко и по существу.`, 230);
}

function buildFallbackSpeakerNotes(project: ProjectInput, order: number) {
  return buildSlideNarration(
    {
      title: fallbackTitle(project, order),
      thesis: fallbackSlideText(project, order),
      bullets: buildFallbackBulletItems(project, order).slice(0, 3),
      definition: null,
      visual: emptyVisual(),
    },
    project,
    order,
  );
}

export function normalizeLayout(
  layout: unknown,
  order: number,
  slideCount: number,
  slideKind: SlideKind,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
): Slide["layout"] {
  if (order === 1 || slideKind === "title" || slideKind === "section") return "hero";
  if (order === slideCount || slideKind === "summary") return "summary";

  const requestedLayout = layout === "two-column" ? "comparison" : layout === "case-study" ? "process" : layout;
  const requested = SLIDE_LAYOUTS.includes(requestedLayout as SlideLayout) ? (requestedLayout as SlideLayout) : undefined;
  if (requested && requested !== "hero" && requested !== "summary") {
    if (layoutHasEnoughContent(requested, slide)) return requested;
    const inferred = inferContentLayout(slide, order);
    return inferred !== requested && layoutHasEnoughContent(inferred, slide) ? inferred : fallbackForSparseLayout(requested, slide);
  }

  return inferContentLayout(slide, order);
}

export function inferContentLayout(
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
  order: number,
): Slide["layout"] {
  if (slide.visual.image?.url || slide.visual.type === "image" || slide.visual.type === "illustration") return "image-focus";
  if (slide.blocks.some((block) => block.type === "quote")) return "quote";
  if (slide.visual.type === "timeline" && layoutHasEnoughContent("timeline", slide)) return "timeline";
  if (slide.visual.type === "process_diagram" && layoutHasEnoughContent("process", slide)) return "process";
  if (slide.visual.type === "cause_effect_diagram" && layoutHasEnoughContent("process", slide)) return "process";
  if (hasMeasurableText(slide)) return "metrics";

  return CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
}

function diversifySlideLayouts(slides: Slide[], designBrief?: DesignBrief) {
  const contentSlides = slides.filter((slide) => slide.slideKind === "content");
  const contentCount = contentSlides.length;
  if (!contentCount) return;
  const directions = new Map((designBrief?.slideDirections || []).map((direction) => [direction.slideOrder, direction]));

  let previous: SlideLayout[] = [];
  contentSlides.forEach((slide, index) => {
    const directed = layoutFromDesignDirection(directions.get(slide.order), slide);
    const semantic = inferContentLayout(slide, slide.order);
    let next = directed || semantic;

    if (previous.length >= 2 && previous.at(-1) === next && previous.at(-2) === next) {
      next = nextDiverseLayout(index, previous, slide);
    }

    slide.layout = next;
    previous = [...previous.slice(-1), next];
  });
}

function layoutFromDesignDirection(
  direction: DesignBrief["slideDirections"][number] | undefined,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
): SlideLayout | null {
  if (!direction) return null;
  const candidates: SlideLayout[] =
    direction.layoutIntent === "full_bleed_image" || direction.layoutIntent === "split_image_text" ? ["image-focus", "statement"] :
    direction.layoutIntent === "statement" ? ["statement", "quote"] :
    direction.layoutIntent === "cards" ? ["statement", "quote"] :
    direction.layoutIntent === "timeline" ? ["timeline", "process"] :
    direction.layoutIntent === "diagram" ? ["process", "statement"] :
    direction.layoutIntent === "comparison" ? ["comparison", "statement"] :
    direction.layoutIntent === "evidence_board" ? ["metrics", "statement"] :
    direction.layoutIntent === "quote_spread" ? ["quote", "statement"] :
    direction.layoutIntent === "metric" ? ["metrics", "statement"] :
    direction.layoutIntent === "summary" ? ["summary"] :
    [];

  return candidates.find((candidate) => candidate !== "summary" && layoutHasEnoughContent(candidate, slide)) || null;
}

function nextDiverseLayout(index: number, previous: SlideLayout[], slide: Slide): SlideLayout {
  for (let offset = 0; offset < CONTENT_LAYOUT_CYCLE.length; offset += 1) {
    const candidate = CONTENT_LAYOUT_CYCLE[(index + offset) % CONTENT_LAYOUT_CYCLE.length];
    if (candidate !== previous.at(-1) && candidate !== previous.at(-2) && layoutHasEnoughContent(candidate, slide)) {
      return candidate;
    }
  }

  return previous.at(-1) === "statement" ? "quote" : "statement";
}

function layoutHasEnoughContent(layout: SlideLayout, slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>) {
  if (layout === "definition") return Boolean(slide.definition || slide.thesis);
  if (layout === "quote") return slide.blocks.some((block) => block.type === "quote") || Boolean(slide.thesis);
  if (layout === "two-column") return false;
  if (layout === "comparison") {
    return slide.visual.rows.filter((row) => cleanText(row.left) && cleanText(row.right)).length >= 2
      && Boolean(cleanText(slide.visual.leftLabel) && cleanText(slide.visual.rightLabel));
  }
  if (layout === "process") {
    return slide.visual.items.filter((item) => cleanText(item.label) && cleanText(item.text)).length >= 3;
  }
  if (layout === "timeline") {
    return slide.visual.items.filter((item) => cleanText(item.label) && cleanText(item.text)).length >= 3;
  }
  if (layout === "question-answer") return Boolean(cleanText(slide.thesis) && slide.bullets.filter(cleanText).length >= 2);
  if (layout === "myth-fact") {
    return slide.visual.items.filter((item) => cleanText(item.label) || cleanText(item.text)).length >= 2
      && slide.bullets.filter(cleanText).length >= 1;
  }
  if (layout === "metrics") return hasMeasurableText(slide);
  if (layout === "evidence") return Boolean(slide.thesis && slide.bullets.length >= 2);
  if (layout === "problem-solution") return slide.visual.items.length >= 3 || slide.bullets.length >= 3;
  if (layout === "explain-example") return Boolean(slide.definition || slide.thesis) && slide.bullets.length >= 1;
  if (layout === "image-focus") return Boolean(slide.visual.image?.url || slide.thesis);
  return true;
}

function fallbackForSparseLayout(
  layout: SlideLayout,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
): SlideLayout {
  if (layout === "question-answer" || layout === "myth-fact" || layout === "comparison" || layout === "problem-solution") {
    return "statement";
  }
  return "statement";
}

function hasMeasurableText(slide: Pick<Slide, "title" | "thesis" | "bullets" | "blocks">) {
  const text = [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ].join(" ");

  return hasMeasurableValue(text);
}

function hasProblemSolutionLanguage(slide: Pick<Slide, "title" | "thesis" | "bullets" | "blocks">) {
  const text = [slide.title, slide.thesis, ...slide.bullets].join(" ").toLowerCase();
  const hasProblem = /(проблем|трудност|риск|причин|последств|мешает|вызывает)/u.test(text);
  const hasSolution = /(решени|исправ|помога|нужно|можно|способ|предлага)/u.test(text);
  return hasProblem && hasSolution;
}

function hasExampleLanguage(slide: Pick<Slide, "title" | "thesis" | "bullets" | "blocks">) {
  return /(пример|например|ошибк|важно помнить|оговорк)/iu.test([slide.title, slide.thesis, ...slide.bullets].join(" "));
}

function normalizeProvider(value: string | undefined): AiGenerationMode | undefined {
  const normalized = value?.toLowerCase().trim();
  return normalized === "openai" || normalized === "yandex" ? normalized : undefined;
}

function isDemoGenerationAllowed() {
  return process.env.ALLOW_DEMO_GENERATION === "true";
}

function isDemoMode(mode: AiGenerationMode | FallbackGenerationMode) {
  return mode === "demo" || mode === "demo-fallback";
}

function assertRawGenerationQuality(input: Partial<PresentationDocument>, project: ProjectInput, mode: AiGenerationMode | FallbackGenerationMode) {
  if (isDemoMode(mode)) return;

  const allText = collectRawPresentationText(input);
  if (!allText) {
    throw new Error("AI generation quality check failed: response has no usable presentation text");
  }

  const rawSlideCount = Array.isArray(input.slides) ? input.slides.length : 0;
  const generatedTextSlideCount = countGeneratedTextSlides(input.generatedText);
  if (Math.max(rawSlideCount, generatedTextSlideCount) < project.slideCount) {
    throw new Error("AI generation quality check failed: response does not contain all requested slides");
  }

  const narrationText = collectRawNarrationText(input);
  const issues = qualityIssuesForText(narrationText || allText, project);
  if (issues.length) {
    throw new Error(`AI generation quality check failed: ${issues.join("; ")}`);
  }
}

function assertPresentationQuality(presentation: PresentationDocument, project: ProjectInput, mode: AiGenerationMode | FallbackGenerationMode) {
  if (isDemoMode(mode)) return;

  const issues = qualityIssuesForText(visiblePresentationText(presentation), project, false);

  if (!/Слайд\s+1\s*:/i.test(presentation.generatedText)) {
    issues.push("generatedText is not divided into slide narration");
  }

  const narrationIssues = validateNarrationSections(parseNarrationSections(presentation.generatedText), project);
  if (narrationIssues.length) {
    issues.push(...narrationIssues);
  }

  for (const slide of presentation.slides) {
    const count = sentenceCount(slide.speakerNotes);
    if (count < 5 || count > 6) {
      issues.push(`slide ${slide.order} speakerNotes must have 5-6 sentences`);
    }
  }

  for (const item of presentation.speechScript) {
    const count = sentenceCount(item.text);
    if (count < 5 || count > 6) {
      issues.push(`slide ${item.slideOrder} speechScript must have 5-6 sentences`);
    }
  }

  const genericTitleCount = presentation.slides.filter((slide) => isGenericDeckTitle(slide.title)).length;
  if (genericTitleCount >= 3) {
    issues.push("too many generic slide titles");
  }

  if (countHighlySimilarAdjacentSlides(presentation.slides) >= 2) {
    issues.push("neighboring slides are too similar");
  }

  const thinSlides = presentation.slides.filter((slide) => slide.slideKind !== "section" && lacksConcreteDetail(slide, project)).length;
  if (presentation.slides.length >= 4 && thinSlides > Math.max(1, Math.floor(presentation.slides.length * 0.35))) {
    issues.push("too many slides lack concrete subject details");
  }

  if (issues.length) {
    throw new Error(`AI generation quality check failed: ${uniqueIssues(issues).join("; ")}`);
  }
}

function assertNoForbiddenTemplateText(presentation: PresentationDocument) {
  const bannedPhrase = findForbiddenTemplatePhrase(visiblePresentationText(presentation));
  if (bannedPhrase) {
    throw new Error(`AI generation quality check failed: template phrase detected: ${bannedPhrase}`);
  }
}

function isRepairablePresentationQualityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!message.startsWith("AI generation quality check failed:")) return false;
  const blockingFragments = [
    "generatedText is not divided into slide narration",
    "expected ",
    "missing narration section",
    "has no title",
    "must have 5-6 narration sentences",
    "speakerNotes must have 5-6 sentences",
    "speechScript must have 5-6 sentences",
  ];
  return !blockingFragments.some((fragment) => message.includes(fragment));
}

function collectRawNarrationText(input: Partial<PresentationDocument>) {
  const slides = Array.isArray(input.slides) ? input.slides : [];
  const speechScript = Array.isArray(input.speechScript) ? input.speechScript : [];
  return cleanMultilineText(
    [
      input.generatedText,
      ...slides.map((slide) => (slide as Partial<Slide>).speakerNotes),
      ...speechScript.map((item) => item?.text),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function collectRawPresentationText(input: Partial<PresentationDocument>) {
  const slides = Array.isArray(input.slides) ? input.slides : [];
  const speechScript = Array.isArray(input.speechScript) ? input.speechScript : [];
  return cleanMultilineText(
    [
      input.title,
      input.generatedText,
      ...slides.flatMap((slide) => {
        const candidate = slide as Partial<Slide>;
        return [
          candidate.title,
          candidate.thesis,
          candidate.speakerNotes,
          ...(Array.isArray(candidate.bullets) ? candidate.bullets : []),
          ...(Array.isArray(candidate.blocks)
            ? candidate.blocks.flatMap((block) => (block?.type === "bullets" ? block.items : "content" in block ? [block.content] : []))
            : []),
        ];
      }),
      ...speechScript.flatMap((item) => [item?.slideTitle, item?.text]),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function countGeneratedTextSlides(value: unknown) {
  const matches = cleanMultilineText(value).match(/(?:^|\n)Слайд\s+\d+\s*:/gi);
  return matches?.length || 0;
}

function visiblePresentationText(presentation: PresentationDocument) {
  return cleanMultilineText(
    [
      presentation.title,
      presentation.generatedText,
      ...presentation.slides.flatMap((slide) => [
        slide.title,
        slide.thesis,
        slide.speakerNotes,
        ...slide.bullets,
        ...(slide.definition ? [slide.definition.term, slide.definition.text] : []),
        slide.visual.title,
        slide.visual.description,
        ...slide.visual.items.flatMap((item) => [item.label, item.text]),
        ...slide.visual.rows.flatMap((row) => [row.label, row.left, row.right]),
        ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
      ]),
      ...presentation.speechScript.flatMap((item) => [item.slideTitle, item.text]),
    ].join("\n"),
  );
}

function qualityIssuesForText(value: string, project: ProjectInput, checkPromptRepeat = true) {
  const issues: string[] = [];
  const text = normalizeForQuality(value);
  const lowerText = cleanText(value).toLowerCase().replace(/ё/g, "е");

  if (!text) return ["empty presentation text"];
  if (text.startsWith("{")) issues.push("model returned JSON text instead of presentation prose");

  const bannedPhrase = findForbiddenTemplatePhrase(value);
  if (bannedPhrase) {
    issues.push(`template phrase detected: ${bannedPhrase}`);
  }

  const prompt = normalizeExactForQuality(project.prompt);
  if (checkPromptRepeat && prompt.length >= 18 && countOccurrences(lowerText, prompt) > 1) {
    issues.push("user request is repeated instead of answered");
  }

  return issues;
}

function isGenericDeckTitle(title: string) {
  return GENERIC_TITLES.includes(normalizeTitleKey(title));
}

function countHighlySimilarAdjacentSlides(slides: Slide[]) {
  let count = 0;
  for (let index = 1; index < slides.length; index += 1) {
    const previous = slideSemanticText(slides[index - 1]);
    const current = slideSemanticText(slides[index]);
    if (textSimilarity(previous, current) >= 0.72) {
      count += 1;
    }
  }
  return count;
}

function lacksConcreteDetail(slide: Slide, project: ProjectInput) {
  const promptTokens = significantTokens(project.prompt);
  const slideTokens = significantTokens(slideSemanticText(slide)).filter((token) => !promptTokens.includes(token));
  const hasNumber = /\d/.test(slideSemanticText(slide));
  const hasCapitalizedDetail = /[A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+)?/.test(slideSemanticText(slide).replace(/^Слайд\s+\d+/i, ""));
  return !hasNumber && !hasCapitalizedDetail && new Set(slideTokens).size < 4;
}

function slideSemanticText(slide: Slide) {
  return [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ].join(" ");
}

function textSimilarity(left: string, right: string) {
  const leftTokens = new Set(significantTokens(left));
  const rightTokens = new Set(significantTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function significantTokens(value: string) {
  return normalizeForQuality(value)
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi, ""))
    .filter((word) => word.length >= 5 && !STOP_WORDS.has(word));
}

function normalizeForQuality(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”'`]/g, "")
    .replace(/[.,!?;:()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExactForQuality(value: string) {
  return cleanText(value).toLowerCase().replace(/ё/g, "е");
}

function findForbiddenTemplatePhrase(value: string) {
  const lowerText = normalizeExactForQuality(value);
  const bannedPhrase = [...GENERIC_NARRATION_PHRASES, ...GENERIC_SCREEN_TEXT_PHRASES].find((phrase) => {
    const candidate = normalizeExactForQuality(phrase);
    return candidate.length >= 8 && lowerText.includes(candidate);
  });
  if (bannedPhrase) return bannedPhrase;

  return TEMPLATE_TEXT_PATTERNS.find(({ pattern }) => pattern.test(lowerText))?.label || "";
}

function hasForbiddenTemplateText(value: string) {
  return Boolean(findForbiddenTemplatePhrase(value));
}

function countOccurrences(text: string, needle: string) {
  if (!text || !needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function uniqueIssues(issues: string[]) {
  return [...new Set(issues)];
}

function parseJsonText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AI response has no JSON text");
  }

  return JSON.parse(trimmed);
}

function normalizeGeneratedText(value: string, project: ProjectInput) {
  const text = cleanMultilineText(value);
  if (!text || text.startsWith("{") || !/Слайд\s+1\s*:/i.test(text)) {
    return buildFallbackGeneratedText(project);
  }

  const sanitized = sanitizeGeneratedText(text);
  const originalSections = parseNarrationSections(sanitized);
  const sections = repairNarrationSentenceCounts(originalSections, project);
  const issues = validateNarrationSections(sections, project);
  if (!issues.length) {
    if (!narrationSectionsChanged(originalSections, sections)) {
      return sanitized;
    }
    const slideWord = narrationHeaderWord(sanitized);
    return sections.map((section) => formatNarrationSection(section, slideWord)).join("\n\n");
  }

  if (sections.length === project.slideCount) {
    const blockingIssues = issues.filter((issue) => !isRepairableNarrationQualityIssue(issue));
    if (!blockingIssues.length) {
      const slideWord = narrationHeaderWord(sanitized);
      return repairNarrationQualitySections(sections, project).map((section) => formatNarrationSection(section, slideWord)).join("\n\n");
    }
  }

  return sanitized;
}

function sanitizeGeneratedText(value: string) {
  return cleanMultilineText(value)
    .split("\n")
    .map((line) => {
      const text = line.trim();
      if (!text) return "";
      return /^Слайд\s+\d+\s*:/i.test(text) ? text : sanitizeSpeechText(text);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildFallbackGeneratedText(project: ProjectInput) {
  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const title = fallbackTitle(project, order);
    const body = buildFallbackSpeakerNotes(project, order);
    return `Слайд ${order}: ${title}\n${body}`;
  }).join("\n\n");
}

function buildGeneratedTextFromSlides(slides: Slide[]) {
  return slides
    .map((slide) => {
      const body = cleanMultilineText(slide.speakerNotes || [slide.thesis, ...slide.bullets].filter(Boolean).join(" "));
      return `Слайд ${slide.order}: ${slide.title}\n${body}`;
    })
    .join("\n\n");
}

function cleanMultilineText(value: unknown) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function sanitizeScreenText(value: unknown) {
  return removeBannedSentences(cleanText(value).replace(/^#+\s*/g, ""));
}

function sanitizeSpeechText(value: unknown) {
  return removeBannedSentences(cleanText(value));
}

function removeBannedSentences(value: string) {
  const banned = [
    "источник",
    "источники",
    "source",
    "sourceRefs",
    "проверьте",
    "проверить",
    "добавьте",
    "добавить источник",
    "добавлю несколько деталей",
    "ключевой вывод нужно связать",
    "тезис нужно объяснить",
    "основная мысль слайда",
    "сделай презентацию",
    "сделайте презентацию",
    "создай презентацию",
    "создайте презентацию",
    "нужно раскрыть через конкретные факты",
    "раскрыть через конкретные факты",
    ...GENERIC_NARRATION_PHRASES,
    ...GENERIC_SCREEN_TEXT_PHRASES,
  ];
  const parts = value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const filtered = parts.filter((part) => {
    const lower = part.toLowerCase();
    return !banned.some((phrase) => lower.includes(phrase.toLowerCase()))
      && !hasForbiddenTemplateText(part);
  });

  return filtered.join(" ").trim();
}

function shortenSentence(value: string, maxLength: number) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function shortenWords(value: string, maxWords: number) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}...` : words.join(" ");
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function demoPresentation(project: ProjectInput, sources: Source[], generationMode: FallbackGenerationMode): PresentationDocument {
  return normalizePresentation({}, project, sources, generationMode);
}

const jsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {},
};

const narrativePlanJsonSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      slideOrder: { type: "number" },
      slideTitle: { type: "string" },
      slidePurpose: { type: "string" },
      keyMessage: { type: "string" },
      audienceQuestion: { type: "string" },
      transitionToNext: { type: "string" },
    },
    required: ["slideOrder", "slideTitle", "slidePurpose", "keyMessage", "audienceQuestion", "transitionToNext"],
  },
};

const designBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    themeId: {
      type: "string",
      enum: [
        "editorialMagazine",
        "academicClean",
        "darkLecture",
        "timelineDocumentary",
        "scienceBoard",
        "startupPitch",
        "softClassroom",
      ],
    },
    mood: { type: "string", enum: ["dark", "light", "playful", "serious", "neutral"] },
    audienceFit: { type: "string" },
    visualMetaphor: { type: "string" },
    colorIntent: { type: "string" },
    typographyIntent: { type: "string" },
    rhythm: {
      type: "object",
      additionalProperties: false,
      properties: {
        titleStyle: { type: "string", enum: ["bold", "quiet", "editorial", "academic"] },
        density: { type: "string", enum: ["low", "medium", "high"] },
        imageFrequency: { type: "string", enum: ["rare", "balanced", "frequent"] },
        sectionBreaks: { type: "boolean" },
      },
      required: ["titleStyle", "density", "imageFrequency", "sectionBreaks"],
    },
    slideDirections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slideOrder: { type: "number" },
          visualRole: { type: "string", enum: ["hero", "problem", "context", "explain", "compare", "sequence", "evidence", "quote", "visual_statement", "reflect", "summary"] },
          layoutIntent: { type: "string", enum: ["full_bleed_image", "split_image_text", "statement", "cards", "timeline", "diagram", "comparison", "evidence_board", "quote_spread", "metric", "summary"] },
          imageStrategy: { type: "string", enum: ["real_photo", "generated_illustration", "diagram", "none"] },
          visualPrompt: { type: "string" },
        },
        required: ["slideOrder", "visualRole", "layoutIntent", "imageStrategy", "visualPrompt"],
      },
    },
  },
  required: ["themeId", "mood", "audienceFit", "visualMetaphor", "colorIntent", "typographyIntent", "rhythm", "slideDirections"],
};

const slideTextRepairSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          slideOrder: { type: "number" },
        },
        required: ["slideOrder"],
      },
    },
  },
  required: ["slides"],
};

const qualityDimensionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    reason: { type: "string" },
  },
  required: ["score", "reason"],
};

const qualityCritiqueJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    summary: { type: "string" },
    dimensions: {
      type: "object",
      additionalProperties: false,
      properties: {
        speechNaturalness: qualityDimensionJsonSchema,
        universityTone: qualityDimensionJsonSchema,
        slideBrevity: qualityDimensionJsonSchema,
        visualRhythm: qualityDimensionJsonSchema,
        sourceGrounding: qualityDimensionJsonSchema,
        exportReadiness: qualityDimensionJsonSchema,
      },
      required: ["speechNaturalness", "universityTone", "slideBrevity", "visualRhythm", "sourceGrounding", "exportReadiness"],
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slideId: { type: "string" },
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
          category: {
            type: "string",
            enum: [
              "generic_text",
              "off_topic",
              "too_long",
              "duplicate",
              "bad_narration",
              "bad_visual",
              "factual_risk",
              "schema_risk",
            ],
          },
          field: { type: "string" },
          message: { type: "string" },
          repairInstruction: { type: "string" },
        },
        required: ["severity", "category", "message"],
      },
    },
  },
  required: ["score", "summary", "dimensions", "issues"],
};

const qualityRepairJsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    generatedText: { type: "string" },
    outline: { type: "array", items: { type: "string" } },
    speechScript: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          slideOrder: { type: "number" },
          slideTitle: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          slideId: { type: "string" },
          slideOrder: { type: "number" },
          title: { type: "string" },
          layout: { type: "string", enum: [
            "hero", "bullets", "two-column", "summary", "statement", "quote", "definition", "timeline",
            "comparison", "process", "image-focus", "case-study", "question-answer", "myth-fact", "metrics",
            "evidence", "problem-solution", "explain-example",
          ] },
          thesis: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          speakerNotes: { type: "string" },
        },
      },
    },
  },
  required: ["slides"],
};
