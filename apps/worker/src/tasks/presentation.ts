import crypto from "node:crypto";
import OpenAI from "openai";
import {
  type Highlight,
  type KeyConcept,
  type PresentationDocument,
  type Slide,
  type SlideBlock,
  type SlideDefinition,
  type SlideKind,
  type SlideLayout,
  type SlideVisual,
  type Source,
  presentationSchema,
} from "@studydeck/shared";

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

const SYSTEM_PROMPT = [
  "You create structured study presentations as clear Russian classroom narration. Return only valid JSON.",
  "All user-visible slide text, speaker notes, and speech script must be in Russian.",
  "Build the deck as one coherent study story split into slides: opening context, concrete facts, turning points, consequences, and a human final conclusion.",
  "Slide titles must be semantic, not template labels. Prefer titles like 'За фасадом успеха' or 'От амбиций к жадности' over 'Контекст', 'Ключевые факты', 'Примеры', or 'Выводы'.",
  "Speaker notes and speech script must sound like a student can read them aloud: simple, specific, human, and topic-focused.",
  "Do not write meta narration about the slide as an object. Never write phrases like 'этот слайд помогает', 'продолжает разговор о теме', 'подводит к следующему фрагменту', 'общая логика объяснения', or 'главный акцент здесь'.",
  "Do not invent precise facts, dates, names, numbers, or citations when the source material does not support them. Use general explanations instead.",
  "Never mention sources, source titles, sourceRefs, or internal instructions in user-visible text.",
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
  "рассказе про",
  "рассказ про",
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
];

const GENERIC_SCREEN_TEXT_PHRASES = [
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

const SLIDE_LAYOUTS = [
  "hero",
  "bullets",
  "two-column",
  "summary",
  "statement",
  "quote",
  "definition",
  "timeline",
  "comparison",
  "process",
  "image-focus",
  "case-study",
  "question-answer",
  "myth-fact",
  "metrics",
] satisfies SlideLayout[];

const CONTENT_LAYOUT_CYCLE = [
  "statement",
  "process",
  "comparison",
  "question-answer",
  "case-study",
  "timeline",
  "definition",
  "myth-fact",
  "metrics",
  "two-column",
  "quote",
  "image-focus",
  "bullets",
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
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        /* legacyContent:
          "Ты создаешь учебные презентации на русском языке. На каждом слайде нужен короткий текст для экрана: заголовок и 1-2 содержательные фразы без маркеров. Подробный связный текст для чтения пиши только в speakerNotes и speechScript. Не упоминай источники в тексте для пользователя, не пиши инструкции, заглушки или просьбы что-то проверить. Верни только валидный JSON.",
        */ content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildGenerationPrompt(project, sources),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_presentation",
        strict: false,
        schema: jsonSchema,
      },
    },
  });

  const typedResponse = response as typeof response & { output_parsed?: unknown };
  const parsed = typedResponse.output_parsed || parseJsonText(response.output_text || "");
  return normalizePresentation(parsed, project, sources, "openai");
}

async function generateWithYandex(project: ProjectInput, sources: Source[]) {
  const apiKey = process.env.YANDEX_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required");
  }

  const outputText = await requestYandexText(apiKey, SYSTEM_PROMPT, buildGenerationPrompt(project, sources), true);

  return normalizePresentation(parseJsonText(outputText), project, sources, "yandex");
}

async function requestYandexText(apiKey: string, systemText: string, userText: string, jsonObject: boolean) {
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
        temperature: 0.25,
        maxTokens: "8000",
      },
      jsonObject,
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

export function buildGenerationPrompt(project: ProjectInput, sources: Source[]) {
  return [
    "Create a complete StudyDeck PresentationDocument as JSON.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Mode: ${project.mode}`,
    "All slide-facing text must be in Russian.",
    "First create the complete Russian study narration in `generatedText`, divided exactly as `Слайд 1: ...` through the requested slide count.",
    "`generatedText` is the single source of truth for the deck. It must read like a coherent short oral presentation, not like an outline or a template.",
    "Then build every slide field from `generatedText`: slide titles, thesis, bullets, blocks, speakerNotes, and speechScript must only compress, split, or closely restate the matching slide part of `generatedText`.",
    "Do not generate a separate second story outside `generatedText`.",
    "Voice model:",
    "- use the style of a school or college study report: clear, concrete, calm, and human;",
    "- give the audience a path through the subject: what it is, why it matters, what changes, where the conflict or key tension is, and what conclusion follows;",
    "- use concrete details from the material: names, products, organizations, events, causes, consequences, comparisons, or examples;",
    "- when a personal or evaluative conclusion fits the scenario, write it plainly, for example 'Для меня эта история - предупреждение', but only if it suits the topic;",
    "- vary sentence length. Do not make every paragraph the same rhythm.",
    "Required deck structure:",
    "- slide 1 must have slideKind title;",
    "- the final slide must have slideKind summary and contain a human conclusion plus 3-5 key takeaways in bullets;",
    "- include slideKind section divider slides between major chapters when the deck has enough slides;",
    "- all other study slides must have slideKind content.",
    "Required JSON fields: id, title, scenario, level, slideCount, generatedText, outline, speechScript, slides.",
    "Each slide must include: id, order, title, slideKind, layout, thesis, bullets, definition, keyConcepts, visual, highlights, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "Layout rules:",
    "- layout must be one of: hero, bullets, two-column, summary, statement, quote, definition, timeline, comparison, process, image-focus, case-study, question-answer, myth-fact, metrics;",
    "- do not use the same content layout more than twice in a row;",
    "- choose the layout from the slide's idea, not from a fixed template;",
    "- use statement for one strong claim with one short callout and no list;",
    "- use quote when a concise quote or author-like formulation is central;",
    "- use definition when one term needs explanation;",
    "- use timeline for chronology, process for ordered actions, comparison for two sides, image-focus for a concrete image, case-study for situation/action/result, question-answer for a question with an answer, myth-fact for misconception correction, metrics for 2-4 numbers or measurable facts;",
    "- use bullets only when the slide is genuinely a list of takeaways.",
    "Content slide rules:",
    "- title: short, ideally 6-8 words or fewer;",
    "- title: semantic and memorable. Avoid generic titles such as 'Контекст', 'Ключевые факты', 'Примеры', 'Выводы', and 'Итоги' unless there is only one such title in the whole deck;",
    "- thesis: one concise sentence about the real subject matter, not a meta sentence about the slide;",
    "- every slide must contain 1-3 useful slide-facing sentences total across thesis, bullets, and blocks; never leave a slide with only a title or one vague line;",
    "- bullets: 0-3 short meaningful points; use bullets only when the slide is genuinely a list or a summary;",
    "- definition: { term, text } only when an important term needs a simple definition; otherwise null;",
    "- keyConcepts: return an empty array; do not create small keyword chips on slides;",
    "- highlights: return an empty array; do not create small highlighted word badges on slides;",
    "- blocks: keep a backward-compatible fallback using callout, quote, or bullets; mirror the chosen layout instead of always returning bullets.",
    "Slide-facing text style:",
    "- use the same clear study-report style as the narration, but much shorter;",
    "- do not write 'Главная идея связана с темой', 'Материал стоит разбирать по смысловым частям', or similar filler;",
    "- do not repeat the user's request as content. Answer the request instead.",
    "- do not mention nonexistent topics, pictures, diagrams, images, examples, sources, or visual objects unless they are explicitly present in the provided material;",
    "- do not refer to the slide itself with phrases like 'на слайде показано', 'этот слайд помогает', or 'текст на слайде';",
    "- if the source material is thin, write a cautious general explanation instead of inventing facts or visuals.",
    "- never write generic filler such as 'Финальный вывод раскрывается через контекст, причины и последствия', 'Главные факты лучше воспринимаются, когда между ними видна связь', 'Точная формулировка помогает перейти от факта к смыслу', or similar universal placeholder phrases.",
    "Narration rules:",
    "- speakerNotes must be a connected 2-5 sentence explanation for that exact slide, in Russian, derived from the matching part of generatedText;",
    "- speechScript must contain one matching 2-5 sentence item for every slide and must duplicate or closely restate the matching speakerNotes;",
    "- slide thesis, bullets, definition, blocks, and visual content must be a short outline based on generatedText, not on a separate story;",
    "- write narration in a concise study-report style: concrete, human, explanatory, and understandable to listeners;",
    "- write about the topic, event, phenomenon, causes, consequences, and conclusion, not about the presentation structure;",
    "- do not start narration with 'Слайд ...', 'На этом слайде ...', or similar meta phrases;",
    "- do not use phrases about 'текст на слайде', 'опорные пункты', 'основной смысл раскрывается', 'рассказ про', 'главный акцент здесь', 'часть подводит', or 'Примеры. Поэтому';",
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
    "- visual.description must describe a concrete, searchable image for this exact slide in Russian or English;",
    "- every slide must have a different visual.description concept so later image search can choose different pictures;",
    "- do not put URLs or image provider names into visual.description; describe the desired scene, object, person, place, chart, or illustration only.",
    "Hard limits:",
    "- Do not write long text blocks on slides.",
    "- Do not put markdown headings, source names, citations, sourceRefs, TODOs, or instructions into slide text.",
    "- Do not invent precise facts when the material does not support them; give a general explanation instead.",
    "- Keep detailed narration only in speakerNotes and speechScript.",
    `Source material for internal factual grounding only; do not show source labels to the user:\n${formatSourceText(sources)}`,
  ].join("\n\n");
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
    "Требования к слайдам:",
    "- каждый слайд выглядит как 16:9 учебный кадр: короткий заголовок и один блок текста на 1-2 фразы;",
    "- текст на слайде должен быть кратким, без маркированных списков, markdown-заголовков и длинных абзацев;",
    "- источники используй только как внутренний материал для фактов; не упоминай слово 'источник' и названия источников в slides, speakerNotes и speechScript;",
    "- speakerNotes и speechScript должны быть подробным связным текстом, который можно читать во время выступления;",
    "- не используй фразы: 'тезис нужно объяснить', 'проверьте тезис', 'добавьте источник', 'ключевой вывод нужно связать', 'основная мысль слайда'.",
    "Обязательный JSON: id, title, scenario, level, slideCount, outline, speechScript, slides.",
    "Для каждого slide: id, order, title, layout, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "layout: hero, bullets, two-column или summary. blocks лучше возвращать как один callout; bullets допустимы только если это 1-2 короткие фразы.",
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
): PresentationDocument {
  const input = raw && typeof raw === "object" ? (raw as Partial<PresentationDocument>) : {};
  assertRawGenerationQuality(input, project, generationMode);
  const publicSources = normalizeSources(sources, project);
  const outline = normalizeOutline(input.outline);
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  const slides = rawSlides.slice(0, project.slideCount).map((slide, index) => normalizeSlide(slide, index + 1, publicSources, project));

  while (slides.length < project.slideCount) {
    slides.push(buildFallbackSlide(slides.length + 1, project, publicSources));
  }

  repairRepeatedSlideTitles(slides, outline, project);
  diversifySlideLayouts(slides);

  const rawSpeechScript = Array.isArray(input.speechScript) ? input.speechScript : [];
  const speechTitleCounts = countTitles(rawSpeechScript.map((item) => cleanText(item?.slideTitle)));
  const speechScript = slides.map((slide, index) => {
    const source = rawSpeechScript.find((item) => Number(item?.slideOrder) === slide.order) || rawSpeechScript[index];
    const sourceTitle = cleanText(source?.slideTitle);

    return {
      slideOrder: slide.order,
      slideTitle: shouldReplaceTitle(sourceTitle, speechTitleCounts) ? slide.title : sourceTitle || slide.title,
      text: normalizeSpeechScriptText(source?.text, slide, project, index),
    };
  });
  const fallbackGeneratedText = buildGeneratedTextFromSlides(slides);

  const presentation = presentationSchema.parse({
    id: cleanText(input.id) || crypto.randomUUID(),
    title: cleanText(input.title) || project.title,
    scenario: cleanText(input.scenario) || project.scenario,
    level: cleanText(input.level) || project.level,
    slideCount: slides.length,
    generationMode,
    generatedText: normalizeGeneratedText(generatedText || cleanMultilineText(input.generatedText) || fallbackGeneratedText, project),
    sources: publicSources,
    outline: slides.map((slide) => slide.title),
    speechScript,
    slides,
  });

  assertPresentationQuality(presentation, project, generationMode);
  return presentation;
}

function normalizeSlide(rawSlide: unknown, order: number, sources: Source[], project: ProjectInput): Slide {
  const slide = rawSlide && typeof rawSlide === "object" ? (rawSlide as Partial<Slide>) : {};
  const sourceRefs = Array.isArray(slide.sourceRefs) && slide.sourceRefs.length
    ? slide.sourceRefs
    : [sourceRefFromSource(sources[(order - 1) % sources.length])];
  const rawBlocks = Array.isArray(slide.blocks) ? slide.blocks.map(normalizeBlock).filter((block): block is SlideBlock => Boolean(block)) : [];
  const slideKind = normalizeSlideKind(slide.slideKind, order, project.slideCount);
  const title = shortenWords(cleanText(slide.title) || fallbackTitle(project, order), slideKind === "title" ? 12 : 8);
  const thesis = normalizeThesis(slide.thesis, rawBlocks, project, order, slideKind);
  const bullets = ensureSlideSentenceDensity(normalizeBullets(slide.bullets, rawBlocks, project, order, slideKind), thesis, project, order, slideKind);
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
    }),
    thesis,
    bullets,
    definition,
    keyConcepts,
    visual,
    highlights,
    blocks,
    speakerNotes: normalizeSpeakerNotes(slide.speakerNotes, { title, thesis, bullets, definition, visual }, project, order),
    timingSeconds: clampNumber(Number(slide.timingSeconds || 55), 20, 240),
    sourceRefs: sourceRefs.map((ref) => ({
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

function normalizeThesis(value: unknown, blocks: SlideBlock[], project: ProjectInput, order: number, slideKind: SlideKind) {
  if (slideKind === "section") return "";
  const fromValue = firstSentence(sanitizeScreenText(value));
  if (fromValue) return shortenSentence(fromValue, 180);
  const fromBlocks = firstSentence(slideText(blocks));
  return shortenSentence(fromBlocks || fallbackSlideText(project, order), slideKind === "title" ? 220 : 180);
}

function normalizeBullets(value: unknown, blocks: SlideBlock[], project: ProjectInput, order: number, slideKind: SlideKind) {
  const fromValue = Array.isArray(value) ? value.map(sanitizeScreenText).filter(Boolean) : [];
  const fromBlocks = blocks.flatMap((block) => (block.type === "bullets" ? block.items : splitIntoSentences("content" in block ? block.content : "")));
  const items = uniqueShortItems([...fromValue, ...fromBlocks]).slice(0, 5);

  if (slideKind === "title" || slideKind === "section") {
    return items.slice(0, 3);
  }

  if (slideKind !== "summary" && items.length) {
    return items.slice(0, 5);
  }

  const minimum = slideKind === "summary" ? 3 : 2;
  const fallback = buildFallbackBulletItems(project, order);
  return ensureRange(items, fallback, minimum, 5);
}

function ensureSlideSentenceDensity(items: string[], thesis: string, project: ProjectInput, order: number, slideKind: SlideKind) {
  const existing = uniqueShortItems(items).slice(0, slideKind === "summary" ? 5 : 3);
  const visibleSentenceCount = splitIntoSentences([thesis, ...existing].join(" ")).length;
  const minimum = slideKind === "summary" ? 3 : 2;

  if (visibleSentenceCount >= minimum) {
    return existing;
  }

  const fallback = buildFallbackBulletItems(project, order).filter((item) => item.toLowerCase() !== thesis.toLowerCase());
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
    title: sanitizeScreenText(candidate.title) || visualTitle(type),
    description,
    leftLabel: sanitizeScreenText(candidate.leftLabel) || defaultLeftLabel(type),
    rightLabel: sanitizeScreenText(candidate.rightLabel) || defaultRightLabel(type),
    items,
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

function buildFallbackSlide(order: number, project: ProjectInput, sources: Source[]): Slide {
  const source = sources[(order - 1) % sources.length];
  const slideKind = normalizeSlideKind(undefined, order, project.slideCount);
  const title = fallbackTitle(project, order);
  const thesis = normalizeThesis("", [], project, order, slideKind);
  const bullets = ensureSlideSentenceDensity(normalizeBullets([], [], project, order, slideKind), thesis, project, order, slideKind);
  const definition = fallbackDefinition(order, title, thesis, slideKind);
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
    speakerNotes: buildFallbackSpeakerNotes(project, order),
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

  if (["statement", "question-answer", "case-study", "image-focus", "definition"].includes(layout)) {
    return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
  }

  if (slideKind === "summary" || bullets.length >= 2) {
    return [{ type: "bullets", items: bullets.length ? bullets : buildFallbackBulletItems(project, order) }];
  }

  return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
}

function fallbackDefinition(order: number, title: string, thesis: string, slideKind: SlideKind): SlideDefinition | null {
  if (slideKind !== "content") return null;
  const layout = CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
  if (layout !== "definition") return null;
  return {
    term: shortenSentence(title, 60),
    text: shortenSentence(thesis, 180),
  };
}

function fallbackVisual(order: number, title: string, thesis: string, bullets: string[], slideKind: SlideKind, project: ProjectInput): SlideVisual {
  const layout = CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
  const items = bullets.slice(0, 4).map((label) => ({ label, text: "" }));
  const description = imageConcept(project, order, title, thesis, bullets, slideKind);

  if (slideKind === "title" || slideKind === "section") {
    return { ...emptyVisual(), type: "image", title: "Visual example", description };
  }

  if (layout === "process" && items.length >= 2) {
    return { ...emptyVisual(), type: "process_diagram", title: visualTitle("process_diagram"), description, items };
  }

  if (layout === "timeline" && items.length >= 2) {
    return { ...emptyVisual(), type: "timeline", title: visualTitle("timeline"), description, items };
  }

  if (layout === "comparison" && bullets.length >= 2) {
    return {
      ...emptyVisual(),
      type: "comparison_diagram",
      title: visualTitle("comparison_diagram"),
      description,
      leftLabel: defaultLeftLabel("comparison_diagram"),
      rightLabel: defaultRightLabel("comparison_diagram"),
      rows: [{ label: title, left: bullets[0], right: bullets[1] }],
    };
  }

  return { ...emptyVisual(), type: "image", title: "Visual example", description };
}

function imageConcept(project: ProjectInput, order: number, title: string, thesis: string, bullets: string[], slideKind: SlideKind) {
  const topic = cleanText(project.title || project.prompt);
  const focus = cleanText(title || fallbackTitle(project, order));
  const detail = cleanText(thesis || bullets[0] || project.prompt);
  const role = slideKind === "summary" ? "summary educational image" : slideKind === "title" ? "opening educational image" : "educational image";
  return shortenSentence(`${role}: ${topic}; ${focus}; ${detail}`, 220);
}

function fallbackTitle(project: ProjectInput, order: number) {
  const titles = [
    project.title,
    "Что стоит понять сначала",
    "Факты за общей темой",
    "Как меняется ситуация",
    "Пример для понимания",
    "Смысл простыми словами",
    "Что остается в памяти",
    "К чему это приводит",
    "Главная мысль",
    "Что можно вынести",
  ];
  return titles[order - 1] || `${order}. ${project.title}`;
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
) {
  const text = sanitizeSpeechText(value);
  if (isSpecificNarration(text)) {
    return limitSentences(text, 5);
  }

  return buildSlideNarration(slide, project, order);
}

function normalizeSpeechScriptText(value: unknown, slide: Slide, project: ProjectInput, index: number) {
  const text = sanitizeSpeechText(value);
  if (isSpecificNarration(text)) {
    return limitSentences(text, 5);
  }

  return normalizeSpeakerNotes(slide.speakerNotes, slide, project, index + 1);
}

function buildSlideNarration(slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual">, project: ProjectInput, order: number) {
  const title = cleanText(slide.title) || fallbackTitle(project, order);
  const thesis = cleanText(slide.thesis) || fallbackSlideText(project, order);
  const bullets = slide.bullets.map(cleanText).filter(Boolean);
  const firstPoint = bullets[0] || slide.definition?.text || thesis;
  const secondPoint = bullets.find((item) => item.toLowerCase() !== firstPoint.toLowerCase()) || visualNarrationText(slide.visual);
  const lead = order === 1
    ? `${title}: ${sentenceFragment(thesis)}.`
    : `${title}: ${sentenceFragment(thesis)}.`;
  const detail = secondPoint
    ? `Важная деталь здесь в том, что ${sentenceFragment(secondPoint)}.`
    : `Так тема становится понятнее без лишних общих слов.`;
  const ending = order === project.slideCount
    ? `Главный вывод: ${sentenceFragment(firstPoint)}.`
    : `Эта мысль нужна, чтобы слушатель увидел не только факт, но и его значение.`;

  return sanitizeSpeechText(
    [
      lead,
      `${sentenceFragment(firstPoint)}.`,
      detail,
      ending,
    ].join(" "),
  );

}

function visualNarrationText(visual: SlideVisual) {
  if (!visual || visual.type === "none") return "";
  const item = visual.items.find((entry) => entry.label || entry.text);
  const row = visual.rows.find((entry) => entry.label || entry.left || entry.right);
  return cleanText(item?.text || item?.label || row?.left || row?.right || visual.description || visual.title);
}

function isSpecificNarration(text: string) {
  if (sentenceCount(text) < 2) return false;
  if (text.length < 80) return false;
  const lower = text.toLowerCase();
  return !GENERIC_NARRATION_PHRASES.some((phrase) => lower.includes(phrase));
}

function sentenceCount(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).length;
}

function limitSentences(text: string, max: number) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.slice(0, max).join(" ");
}

function sentenceFragment(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : "";
}

function buildFallbackBulletItems(project: ProjectInput, order: number) {
  const topic = cleanText(project.title || project.prompt);
  const focus = order > 1 ? fallbackTitle(project, order) : topic;
  const request = shortenSentence(cleanText(project.prompt), 120);
  const base = [
    `${focus}: ${request || topic}`,
    `${topic} нужно раскрыть через конкретные факты.`,
    `Смысл темы понятнее, когда видны причины и последствия.`,
    `Для аудитории важен простой вывод без лишних общих слов.`,
    `Финальная мысль должна быть связана с запросом: ${shortenSentence(request || topic, 90)}`,
  ];
  return base.map((item) => shortenSentence(item, 120));
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

function visualTitle(type: SlideVisual["type"]) {
  const titles: Record<SlideVisual["type"], string> = {
    process_diagram: "Процесс",
    comparison_diagram: "Сравнение",
    cause_effect_diagram: "Причина и следствие",
    before_after_table: "До и после",
    pros_cons_table: "Плюсы и минусы",
    timeline: "Хронология",
    mind_map: "Карта понятий",
    illustration: "Иллюстрация",
    schema: "Схема",
    image: "Визуальный пример",
    none: "",
  };
  return titles[type];
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
  const topic = project.title || project.prompt;
  const request = cleanText(project.prompt || topic);
  const texts = [
    `${topic}: ${request}`,
    `${topic} стоит объяснять через понятную проблему и конкретный контекст.`,
    `Факты по теме должны показывать, что меняется и почему это важно.`,
    `Главная перемена заметна там, где появляются новые причины и последствия.`,
    `Пример нужен для того, чтобы общая мысль стала ближе к реальной жизни.`,
    `Сложную часть темы лучше передать простыми словами и одним точным примером.`,
    `Слушателю важно запомнить не набор фраз, а связь между фактами.`,
    `Перед финалом нужно оставить только самые сильные выводы из рассказа.`,
    `Главная мысль показывает, к чему приводит вся история темы.`,
    `Финальный вывод должен отвечать на вопрос: ${request}.`,
  ];
  return shortenSentence(texts[order - 1] || `${topic}: главное объяснить суть темы коротко и понятно.`, 230);
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

function normalizeLayout(
  layout: unknown,
  order: number,
  slideCount: number,
  slideKind: SlideKind,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks">,
): Slide["layout"] {
  if (order === 1 || slideKind === "title" || slideKind === "section") return "hero";
  if (order === slideCount || slideKind === "summary") return "summary";

  const requested = SLIDE_LAYOUTS.includes(layout as SlideLayout) ? (layout as SlideLayout) : undefined;
  if (requested && requested !== "hero" && requested !== "summary") {
    return requested;
  }

  return inferContentLayout(slide, order);
}

function inferContentLayout(
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks">,
  order: number,
): Slide["layout"] {
  if (slide.visual.image?.url || slide.visual.type === "image" || slide.visual.type === "illustration") return "image-focus";
  if (slide.blocks.some((block) => block.type === "quote")) return "quote";
  if (slide.definition) return "definition";
  if (slide.visual.type === "timeline") return "timeline";
  if (slide.visual.type === "process_diagram") return "process";
  if (["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(slide.visual.type)) return "comparison";
  if (/[?？]$/.test(cleanText(slide.title))) return "question-answer";
  if (hasMeasurableText(slide)) return "metrics";

  return CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
}

function diversifySlideLayouts(slides: Slide[]) {
  const contentSlides = slides.filter((slide) => slide.slideKind === "content");
  const contentCount = contentSlides.length;
  if (contentCount <= 1) return;

  let previous: SlideLayout[] = [];
  contentSlides.forEach((slide, index) => {
    const semantic = inferContentLayout(slide, slide.order);
    let next = semantic;

    if (previous.length >= 2 && previous.at(-1) === next && previous.at(-2) === next) {
      next = nextDiverseLayout(index, previous, slide);
    }

    if (next === "bullets" && contentCount >= 3 && slide.visual.type !== "none") {
      next = inferContentLayout(slide, slide.order);
    }

    slide.layout = next;
    previous = [...previous.slice(-1), next];
  });
}

function nextDiverseLayout(index: number, previous: SlideLayout[], slide: Slide): SlideLayout {
  for (let offset = 0; offset < CONTENT_LAYOUT_CYCLE.length; offset += 1) {
    const candidate = CONTENT_LAYOUT_CYCLE[(index + offset) % CONTENT_LAYOUT_CYCLE.length];
    if (candidate !== previous.at(-1) && candidate !== previous.at(-2) && layoutHasEnoughContent(candidate, slide)) {
      return candidate;
    }
  }

  return previous.at(-1) === "bullets" ? "statement" : "bullets";
}

function layoutHasEnoughContent(layout: SlideLayout, slide: Slide) {
  if (layout === "definition") return Boolean(slide.definition || slide.thesis);
  if (layout === "quote") return slide.blocks.some((block) => block.type === "quote") || Boolean(slide.thesis);
  if (layout === "comparison") return slide.visual.rows.length || slide.bullets.length >= 2;
  if (layout === "process" || layout === "timeline") return slide.visual.items.length >= 2 || slide.bullets.length >= 2;
  if (layout === "metrics") return hasMeasurableText(slide) || slide.bullets.length >= 2;
  if (layout === "image-focus") return Boolean(slide.visual.image?.url || slide.thesis);
  return true;
}

function hasMeasurableText(slide: Pick<Slide, "title" | "thesis" | "bullets" | "blocks">) {
  const text = [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ].join(" ");

  return /\d/.test(text);
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

  const text = collectRawPresentationText(input);
  if (!text) {
    throw new Error("AI generation quality check failed: response has no usable presentation text");
  }

  const rawSlideCount = Array.isArray(input.slides) ? input.slides.length : 0;
  const generatedTextSlideCount = countGeneratedTextSlides(input.generatedText);
  if (Math.max(rawSlideCount, generatedTextSlideCount) < project.slideCount) {
    throw new Error("AI generation quality check failed: response does not contain all requested slides");
  }

  const issues = qualityIssuesForText(text, project);
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

  const bannedPhrase = [...GENERIC_NARRATION_PHRASES, ...GENERIC_SCREEN_TEXT_PHRASES].find((phrase) => {
    const candidate = cleanText(phrase).toLowerCase().replace(/ё/g, "е");
    return candidate.length >= 8 && lowerText.includes(candidate);
  });
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
    slide.speakerNotes,
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

  return text;
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
    ...GENERIC_NARRATION_PHRASES,
    ...GENERIC_SCREEN_TEXT_PHRASES,
  ];
  const parts = value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const filtered = parts.filter((part) => {
    const lower = part.toLowerCase();
    return !banned.some((phrase) => lower.includes(phrase.toLowerCase()));
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
