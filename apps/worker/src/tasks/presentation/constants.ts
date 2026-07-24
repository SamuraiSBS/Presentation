import crypto from "node:crypto";
import OpenAI from "openai";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { captureGenerationError, errorLogFields, logger } from "../../observability.js";
import { normalizeOpenAIUsage, recordAiUsage } from "../../usage-ledger.js";
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
} from "../presentation-quality.js";

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

export const STUDENT_CREATION_BRIEF_LINES = [
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

export const NARRATION_SYSTEM_PROMPT = [
  "You write the full Russian oral narration for a university student study presentation.",
  "Return only plain text, not JSON and not markdown.",
  "The output must be divided into slide sections exactly as `Слайд 1: Заголовок`.",
  "Write one coherent speech first, then divide that same speech into slide sections without breaking its logical flow.",
  "Each slide section may contain 3 to 7 complete Russian sentences; use only as many sentences as the meaning requires.",
  "Treat a stated word or duration budget as a quality-first range: distribute the target across the argument where it adds meaning, but never pad a weak section with repetition, transition formulas, or meta-commentary. A compact, substantive explanation inside the allowed range is better than artificial length; when a section lacks content, rewrite it naturally instead of adding words locally.",
  "Write exactly one narration section for each requested slide, in strict order, with no extra sections.",
  "Write like a university student report: academic, easy-professional, concrete, human, calm, and close to the topic.",
  "The first section must naturally introduce the subject and the question of the report without saying that you are introducing it.",
  "Middle sections must continue one argument by meaning, with each section starting from the result or tension created by the previous one.",
  "The last section must give a genuine conclusion or judgment, not a list-like recap of earlier sections.",
  "The result is a word-for-word script that a student can read aloud without editing.",
  "Answer the user's request; do not copy or paraphrase the request itself as slide content.",
  "Each next slide must continue the previous thought by content, not by repeated transition formulas.",
  "Do not reuse the same opening or closing sentence in neighboring sections.",
  "Avoid generic placeholders such as 'рассказ про', 'что стоит понять сначала', 'главный вывод по теме', and similar formulas.",
  "Do not write meta phrases about slides, screen text, source material, or internal instructions.",
].join(" ");

export const SYSTEM_PROMPT = [
  "You create structured study presentations for university students. Return only valid JSON.",
  "All user-visible slide text, speaker notes, and speech script must be in Russian.",
  "Build the deck as one coherent study story split into slides: opening context, concrete facts, turning points, consequences, and a human final conclusion.",
  "Slide titles must be semantic, not template labels. Prefer titles like 'За фасадом успеха' or 'От амбиций к жадности' over 'Контекст', 'Ключевые факты', 'Примеры', or 'Выводы'.",
  "Speaker notes and speech script must sound like a university student can read them aloud: simple, specific, human, and topic-focused.",
  "Visible slides must stay brief and beautiful; put the full explanation in speaker notes and speech script.",
  "Visible slide text must summarize the matching speech section in short human points, never generic filler about the presentation structure.",
  "Do not write meta narration about the slide as an object. Never write phrases like 'этот слайд помогает', 'продолжает разговор о теме', 'подводит к следующему фрагменту', 'общая логика объяснения', or 'главный акцент здесь'.",
  "Never write template slide phrases like 'Сложную часть \"тема\"', 'Перед финалом остаются самые сильные факты', or 'Связь между фактами делает тему понятнее'.",
  "Do not invent precise facts, dates, names, numbers, or citations when the source material does not support them. Use general explanations instead.",
  "Never mention sources, source titles, sourceRefs, or internal instructions in user-visible text.",
].join(" ");

export const QUALITY_CRITIC_SYSTEM_PROMPT = [
  "You are a strict quality editor for university student presentations.",
  "Evaluate the presentation. Do not rewrite it.",
  "Return only structured JSON with score, summary, all six dimension scores, and issues.",
  "Judge whether a university student can read the narration aloud naturally, whether slides are brief, whether visual rhythm is intentionally designed, whether claims are grounded, and whether export will preserve the design.",
  "Flag generic text, off-topic slides, overlong visible text, duplicated structure, weak narration, weak visuals, and factual risk.",
].join(" ");

export const QUALITY_REPAIR_SYSTEM_PROMPT = [
  "You are a careful repair editor for study presentations.",
  "Repair only fields explicitly named by quality issues.",
  "Target the weakest quality dimensions first: spoken narration, university tone, brevity, visual rhythm, grounding, then export safety.",
  "Keep the deck schema-compatible and preserve source-backed facts.",
  "Never invent evidence and never replace a user-edited custom canvas.",
  "Return only JSON. Do not add markdown.",
].join(" ");

export const GENERIC_NARRATION_PHRASES = [
  "влияет на объяснение",
  "соединяет два факта",
  "помогает сделать вывод по материалу",
  "сохраняет связь с",
  "финальный вывод раскрывается через контекст, причины и последствия",
  "главные факты лучше воспринимаются, когда между ними видна связь",
  "главные факторы задают логику объяснения",
  "задают логику объяснения",
  "логика объяснения",
  "делает тему понятнее",
  "помогает объяснить",
  "становится смыслом",
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

export const GENERIC_SCREEN_TEXT_PHRASES = [
  "подготовь академическую",
  "легкую для устного выступления",
  "студенческую презентацию",
  "слайдов по теме",
  "требует осторожных формулировок",
  "осторожных формулировок без неподтверждённых деталей",
  "осторожных формулировок без неподтвержденных деталей",
  "лучше объяснять через проверяемые причины",
  "проверяемые причины и последствия",
  "безопаснее говорить об общих закономерностях",
  "должен опираться на проверяемые",
  "сложную часть",
  "перед финалом остаются",
  "самые сильные факты",
  "лучше передать коротко и по существу",
  "связь между фактами",
  "помогает собрать причины и последствия",
  "конкретный случай помогает объяснить",
  "стоит раскрывать через",
  "связан с конкретным контекстом",
  "меняется через причины и последствия",
  "получает смысл, когда факты связаны",
  "из презентации можно вынести следующее",
  "из презентации можно сделать вывод",
  "в презентации можно выделить",
  "презентация показывает следующее",
  "финальный вывод раскрывается через контекст, причины и последствия",
  "главные факты лучше воспринимаются, когда между ними видна связь",
  "главные факторы задают логику объяснения",
  "задают логику объяснения",
  "логика объяснения",
  "делает тему понятнее",
  "помогает объяснить",
  "становится смыслом",
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

export const TEMPLATE_TEXT_PATTERNS = [
  { label: "prompt echo", pattern: /подготовь\s+академическ(?:ую|ий).{0,160}студенческ(?:ую|ий)\s+презентац/iu },
  { label: "topic prompt echo", pattern: /(?:презентац\w*\s+на\s+\d+\s+слайд\w*\s+по\s+теме|слайд\w*\s+по\s+теме)\s*:/iu },
  { label: "generic cautious wording", pattern: /требу(?:ет|ют)\s+осторожн(?:ых|ой|ую)\s+формулировок/iu },
  { label: "generic verifiable causes", pattern: /лучше\s+объяснять\s+через\s+проверяем(?:ые|ых)\s+причин/iu },
  { label: "generic links title", pattern: /^связи\s*:/iu },
  { label: "generic difficult part", pattern: /сложн(?:ая|ую|ой|ые|ых)\s+част[ьи]\s+[«"]?[^.!?]{0,80}[»"]?\s+лучше\s+передать/iu },
  { label: "generic final facts", pattern: /перед\s+финалом\s+остают(?:ся|ься)\s+сам(?:ые|ых)\s+сильн(?:ые|ых)\s+факт/iu },
  { label: "generic fact link", pattern: /связь\s+между\s+фактами\s+делает\s+[^.!?]{0,80}\s+понятн/iu },
  { label: "generic explanation logic", pattern: /(?:главн[\p{L}\p{N}_]*\s+)?(?:фактор[\p{L}\p{N}_]*|факт[\p{L}\p{N}_]*|детал[\p{L}\p{N}_]+)\s+(?:зада[её]т|задают|стро[\p{L}\p{N}_]+|формир[\p{L}\p{N}_]+)\s+логик[\p{L}\p{N}_]+\s+объяснен[\p{L}\p{N}_]*/iu },
  { label: "generic understandable topic", pattern: /(?:связь\s+между\s+)?(?:факт[\p{L}\p{N}_]+|детал[\p{L}\p{N}_]+|фактор[\p{L}\p{N}_]+)\s+дела[\p{L}\p{N}_]+\s+(?:тем[\p{L}\p{N}_]+|материал|объяснен[\p{L}\p{N}_]+)\s+понятн[\p{L}\p{N}_]*/iu },
  { label: "generic explanation helper", pattern: /(?:помога[\p{L}\p{N}_]+|позволя[\p{L}\p{N}_]+)\s+объясн[\p{L}\p{N}_]+/iu },
  { label: "generic meaning turn", pattern: /станов[\p{L}\p{N}_]+\s+(?:главн[\p{L}\p{N}_]*\s+)?смысл[\p{L}\p{N}_]+/iu },
  { label: "generic understanding value", pattern: /важн[\p{L}\p{N}_]+\s+для\s+понимания\s+тем[\p{L}\p{N}_]+/iu },
  { label: "generic topic meaning", pattern: /получает\s+смысл,\s+когда\s+факты\s+связаны\s+с\s+реальн/iu },
  { label: "главная мысль", pattern: /(?:^|[^\p{L}])главн(?:ая|ую|ой)\s+мысл/iu },
  { label: "общая мысль", pattern: /(?:^|[^\p{L}])общ(?:ая|ую|ей)\s+мысл/iu },
  { label: "пример нужен", pattern: /(?:^|[^\p{L}])пример\s+нужен/iu },
  { label: "вся история темы", pattern: /(?:^|[^\p{L}])вс[яю]\s+истори[яю]\s+темы/iu },
  { label: "meta slide text", pattern: /(?:на|в)\s+этом\s+слайде|этот\s+слайд|текст\s+на\s+слайде|заметк[аи]\s+докладчика/iu },
  { label: "meta section text", pattern: /(?:этот|следующий|данный)\s+раздел|следующ(?:ая|ий)\s+(?:часть|фрагмент)/iu },
  { label: "meta transition text", pattern: /переход\s+(?:к|дальше)|готовит\s+переход|подводит\s+(?:рассказ\s+)?к\s+следующ/iu },
];

export const GENERIC_TITLES = [
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

export const STOP_WORDS = new Set([
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

export const REMOVED_SLIDE_LAYOUTS = new Set<SlideLayout>([
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
export const SLIDE_LAYOUTS = SLIDE_LAYOUT_DEFINITIONS.map((item) => item.id).filter((layout) => !REMOVED_SLIDE_LAYOUTS.has(layout));

export const CONTENT_LAYOUT_CYCLE = [
  "statement",
  "process",
  "timeline",
  "metrics",
  "quote",
  "image-focus",
] satisfies SlideLayout[];

export type YandexCompletionResponse = {
  result?: {
    alternatives?: Array<{
      message?: {
        text?: string;
      };
      status?: string;
      finishReason?: string;
    }>;
    usage?: {
      inputTextTokens?: string;
      completionTokens?: string;
      totalTokens?: string;
      completionTokensDetails?: { reasoningTokens?: string };
    };
    modelVersion?: string;
  };
  alternatives?: Array<{
    message?: {
      text?: string;
    };
    status?: string;
    finishReason?: string;
  }>;
  usage?: {
    inputTextTokens?: string;
    completionTokens?: string;
    totalTokens?: string;
    completionTokensDetails?: { reasoningTokens?: string };
  };
  requestId?: string;
};
