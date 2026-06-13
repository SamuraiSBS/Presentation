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
  "You create structured study presentations. Return only valid JSON.",
  "All user-visible slide text, speaker notes, and speech script must be in Russian.",
  "Slides must teach through structure: short titles, one clear thesis, concise bullets, definitions, key concepts, highlights, and semantic visuals.",
  "Do not invent precise facts, dates, names, numbers, or citations when the source material does not support them. Use general explanations instead.",
  "Never mention sources, source titles, sourceRefs, or internal instructions in user-visible text.",
].join(" ");

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
      jsonObject: true,
      messages: [
        {
          role: "system",
          /* legacyText:
            "Ты создаешь учебные презентации на русском языке. На каждом слайде нужен короткий текст для экрана: заголовок и 1-2 содержательные фразы без маркеров. Подробный связный текст для чтения пиши только в speakerNotes и speechScript. Не упоминай источники в тексте для пользователя, не пиши инструкции, заглушки или просьбы что-то проверить. Верни только валидный JSON.",
          */ text: SYSTEM_PROMPT,
        },
        {
          role: "user",
          text: buildGenerationPrompt(project, sources),
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

  return normalizePresentation(parseJsonText(outputText), project, sources, "yandex");
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
    "Required deck structure:",
    "- slide 1 must have slideKind title;",
    "- the final slide must have slideKind summary and contain 3-5 key takeaways in bullets;",
    "- include slideKind section divider slides between major chapters when the deck has enough slides;",
    "- all other study slides must have slideKind content.",
    "Required JSON fields: id, title, scenario, level, slideCount, outline, speechScript, slides.",
    "Each slide must include: id, order, title, slideKind, layout, thesis, bullets, definition, keyConcepts, visual, highlights, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "Content slide rules:",
    "- title: short, ideally 6-8 words or fewer;",
    "- thesis: one sentence with the main idea of the slide;",
    "- bullets: 3-5 short key points, not paragraphs;",
    "- definition: { term, text } only when an important term needs a simple definition; otherwise null;",
    "- keyConcepts: return an empty array; do not create small keyword chips on slides;",
    "- highlights: return an empty array; do not create small highlighted word badges on slides;",
    "- blocks: keep a backward-compatible fallback, preferably one bullets block mirroring bullets or one short callout.",
    "Narration rules:",
    "- speakerNotes must be a connected 4-5 sentence story for that exact slide, in Russian;",
    "- speechScript must contain one matching 4-5 sentence narration item for every slide;",
    "- slide thesis, bullets, definition, and visual content must be a short outline based on that slide narration;",
    "- do not write generic phrases like 'this slide explains the section'; explain the actual topic of the slide.",
    "Visual field rules:",
    "- visual.type must be one of: process_diagram, comparison_diagram, cause_effect_diagram, before_after_table, pros_cons_table, timeline, mind_map, illustration, schema, image, none;",
    "- use process_diagram for ordered actions or steps;",
    "- use comparison_diagram for comparing concepts;",
    "- use cause_effect_diagram for causes and consequences;",
    "- use before_after_table for changes over time or transformation;",
    "- use pros_cons_table for evaluating options;",
    "- use timeline for historical or chronological topics;",
    "- use mind_map for relationships between concepts;",
    "- use illustration, schema, or image when a visual explanation is useful but no structured diagram fits;",
    "- visual.items contains steps/nodes; visual.rows with left/right columns is for tables and comparisons.",
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
): PresentationDocument {
  const input = raw && typeof raw === "object" ? (raw as Partial<PresentationDocument>) : {};
  const publicSources = normalizeSources(sources, project);
  const outline = normalizeOutline(input.outline);
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  const slides = rawSlides.slice(0, project.slideCount).map((slide, index) => normalizeSlide(slide, index + 1, publicSources, project));

  while (slides.length < project.slideCount) {
    slides.push(buildFallbackSlide(slides.length + 1, project, publicSources));
  }

  repairRepeatedSlideTitles(slides, outline, project);

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

  return presentationSchema.parse({
    id: cleanText(input.id) || crypto.randomUUID(),
    title: cleanText(input.title) || project.title,
    scenario: cleanText(input.scenario) || project.scenario,
    level: cleanText(input.level) || project.level,
    slideCount: slides.length,
    generationMode,
    sources: publicSources,
    outline: slides.map((slide) => slide.title),
    speechScript,
    slides,
  });
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
  const bullets = normalizeBullets(slide.bullets, rawBlocks, project, order, slideKind);
  const definition = normalizeDefinition(slide.definition);
  const keyConcepts = normalizeKeyConcepts(slide.keyConcepts, title, bullets, slideKind);
  const highlights = normalizeHighlights(slide.highlights, thesis, bullets, slideKind);
  const visual = normalizeVisual(slide.visual, title, bullets, slideKind);
  const blocks = normalizeSlideBlocks(rawBlocks, project, order, thesis, bullets, slideKind);

  return {
    id: cleanText(slide.id) || `slide-${order}`,
    order,
    title,
    slideKind,
    layout: normalizeLayout(slide.layout, order, project.slideCount),
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

  const minimum = slideKind === "summary" ? 3 : 3;
  const fallback = buildFallbackBulletItems(project, order);
  return ensureRange(items, fallback, minimum, 5);
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

function normalizeVisual(value: unknown, title: string, bullets: string[], slideKind: SlideKind): SlideVisual {
  if (slideKind === "title") return emptyVisual();

  const candidate = value && typeof value === "object" ? (value as Partial<SlideVisual>) : {};
  const type = normalizeVisualType(candidate.type, title, bullets, slideKind);
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
  const fallbackItems = bullets.slice(0, type === "timeline" ? 6 : 5).map((label) => ({ label, text: "" }));

  return {
    type,
    title: sanitizeScreenText(candidate.title) || visualTitle(type),
    description: sanitizeScreenText(candidate.description),
    leftLabel: sanitizeScreenText(candidate.leftLabel) || defaultLeftLabel(type),
    rightLabel: sanitizeScreenText(candidate.rightLabel) || defaultRightLabel(type),
    items: items.length ? items : fallbackItems,
    rows: rows.length ? rows : fallbackRows(type, bullets),
  };
}

function normalizeVisualType(value: unknown, title: string, bullets: string[], slideKind: SlideKind): SlideVisual["type"] {
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
  if (slideKind === "section") return "schema";
  const text = [title, ...bullets].join(" ").toLowerCase();
  if (/\b(step|stage|process|first|second|then|next|algorithm)\b/.test(text)) return "process_diagram";
  if (/\b(compare|versus|vs|difference|similar|unlike)\b/.test(text)) return "comparison_diagram";
  if (/\b(cause|effect|because|consequence|impact|leads to)\b/.test(text)) return "cause_effect_diagram";
  if (/\b(before|after|change|became|transformation)\b/.test(text)) return "before_after_table";
  if (/\b(pros|cons|benefit|risk|advantage|disadvantage)\b/.test(text)) return "pros_cons_table";
  if (/\b(year|century|period|timeline|history|date)\b|\b\d{3,4}\b/.test(text)) return "timeline";
  if (/\b(connection|relationship|concept|map|network)\b/.test(text)) return "mind_map";
  return slideKind === "summary" ? "mind_map" : "schema";
}

function emptyVisual(): SlideVisual {
  return { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
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
  const bullets = normalizeBullets([], [], project, order, slideKind);
  return {
    id: `slide-${order}`,
    order,
    title,
    slideKind,
    layout: normalizeLayout(undefined, order, project.slideCount),
    thesis,
    bullets,
    definition: null,
    keyConcepts: normalizeKeyConcepts([], title, bullets, slideKind),
    visual: normalizeVisual(undefined, title, bullets, slideKind),
    highlights: normalizeHighlights([], thesis, bullets, slideKind),
    blocks: buildFallbackBlocks(project, order, thesis, bullets, slideKind),
    speakerNotes: buildFallbackSpeakerNotes(project, order),
    timingSeconds: order === 1 || order === project.slideCount ? 45 : 55,
    sourceRefs: [sourceRefFromSource(source)],
  };
}

function buildFallbackBlocks(project: ProjectInput, order = 1, thesis = "", bullets: string[] = [], slideKind: SlideKind = "content"): SlideBlock[] {
  if (slideKind === "summary" || bullets.length >= 3) {
    return [{ type: "bullets", items: bullets.length ? bullets : buildFallbackBulletItems(project, order) }];
  }

  return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
}

function fallbackTitle(project: ProjectInput, order: number) {
  const titles = [
    project.title,
    "Контекст и актуальность",
    "Ключевые факты",
    "Главные изменения",
    "Примеры",
    "Как это объяснить проще",
    "Объяснение простыми словами",
    "Что важно запомнить",
    "Выводы",
    "Финальный вывод",
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
  if (blocks.length) return blocks.slice(0, 3);
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
  const topic = cleanText(project.title || project.prompt);
  const title = cleanText(slide.title) || fallbackTitle(project, order);
  const thesis = cleanText(slide.thesis) || fallbackSlideText(project, order);
  const bullets = slide.bullets.map(cleanText).filter(Boolean);
  const firstPoint = bullets[0] || thesis;
  const secondPoint = bullets[1] || slide.definition?.text || firstPoint;
  const thirdPoint = bullets[2] || visualNarrationText(slide.visual) || secondPoint;
  const ending = order === project.slideCount
    ? `В итоге по теме "${topic}" важно запомнить не отдельные слова, а связь между главной мыслью, примерами и выводом.`
    : `Поэтому текст на слайде оставляет только опорные пункты, а основной смысл раскрывается в рассказе про "${title}".`;

  return sanitizeSpeechText(
    [
      `Слайд "${title}" объясняет часть темы "${topic}" через одну главную мысль: ${lowercaseFirst(thesis)}`,
      `Сначала важно разобрать опорный пункт: ${lowercaseFirst(firstPoint)}`,
      `Затем стоит показать связь с другим элементом темы: ${lowercaseFirst(secondPoint)}`,
      `После этого можно закрепить объяснение через деталь: ${lowercaseFirst(thirdPoint)}`,
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
  if (sentenceCount(text) < 4) return false;
  if (text.length < 220) return false;
  const lower = text.toLowerCase();
  return ![
    "на этом слайде раскрывается раздел",
    "на этом слайде нужно раскрыть раздел",
    "сегодня я расскажу о теме",
    "почему этот раздел важен",
    "добавлю несколько деталей",
  ].some((phrase) => lower.includes(phrase));
}

function sentenceCount(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).length;
}

function limitSentences(text: string, max: number) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.slice(0, max).join(" ");
}

function lowercaseFirst(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}.` : "";
}

function buildFallbackBulletItems(project: ProjectInput, order: number) {
  const topic = cleanText(project.title || project.prompt);
  const base = [
    `Главная идея связана с темой: ${topic}`,
    "Материал стоит разбирать по смысловым частям",
    "Ключевые понятия помогают удержать структуру",
    "Пример или визуальная схема делает объяснение понятнее",
    "Итог должен связывать факты с главным выводом",
  ];
  return base.map((item, index) => shortenSentence(index === 0 && order > 1 ? item.replace(topic, fallbackTitle(project, order)) : item, 120));
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
  const texts = [
    `${topic} можно раскрыть через главные события, понятные примеры и короткие выводы.`,
    `Этот раздел объясняет, почему тема важна и как она связана с жизнью аудитории.`,
    `Здесь собраны основные факты, которые помогают быстро понять суть темы.`,
    `На слайде показано, какие изменения сильнее всего повлияли на развитие темы.`,
    `Примеры помогают увидеть тему не как набор дат, а как живой процесс.`,
    `Сложные идеи здесь переводятся в простое объяснение без лишних деталей.`,
    `Главное внимание стоит уделить смыслу событий и их последствиям.`,
    `Этот слайд помогает запомнить самые важные мысли перед выводом.`,
    `Вывод объединяет предыдущие слайды и показывает главный смысл темы.`,
    `Финальный акцент помогает закончить выступление ясно и уверенно.`,
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

function normalizeLayout(layout: unknown, order: number, slideCount: number): Slide["layout"] {
  if (layout === "hero" || layout === "bullets" || layout === "two-column" || layout === "summary") {
    return layout;
  }

  if (order === 1) return "hero";
  if (order === slideCount) return "summary";
  return order % 3 === 0 ? "two-column" : "bullets";
}

function normalizeProvider(value: string | undefined): AiGenerationMode | undefined {
  const normalized = value?.toLowerCase().trim();
  return normalized === "openai" || normalized === "yandex" ? normalized : undefined;
}

function isDemoGenerationAllowed() {
  return process.env.ALLOW_DEMO_GENERATION === "true";
}

function parseJsonText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AI response has no JSON text");
  }

  return JSON.parse(trimmed);
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
