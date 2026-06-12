import crypto from "node:crypto";
import OpenAI from "openai";
import {
  type PresentationDocument,
  type Slide,
  type SlideBlock,
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
        content:
          "Ты создаешь учебные презентации на русском языке. На слайды нужно писать готовый содержательный текст: факты, объяснения, примеры и выводы. Не пиши инструкции пользователю, заглушки, фразы про проверку тезиса или просьбы добавить источник. Верни только валидный JSON.",
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
          text:
            "Ты создаешь учебные презентации на русском языке. На слайды нужно писать готовый содержательный текст: факты, объяснения, примеры и выводы. Не пиши инструкции пользователю, заглушки, фразы про проверку тезиса или просьбы добавить источник. Верни только валидный JSON.",
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

function buildGenerationPrompt(project: ProjectInput, sources: Source[]) {
  return [
    "Собери готовую презентацию StudyDeck PresentationDocument.",
    `Тема и запрос пользователя: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень аудитории: ${project.level}`,
    `Количество слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    "Требования к слайдам:",
    "- каждый слайд содержит 3-5 содержательных пунктов или короткий вывод;",
    "- текст должен раскрывать тему, а не повторять промпт;",
    "- используй факты из источников и ставь sourceRefs на релевантные источники;",
    "- speakerNotes и speechScript должны быть связным текстом для выступления;",
    "- не используй фразы: 'тезис нужно объяснить', 'проверьте тезис', 'добавьте источник', 'основная мысль слайда'.",
    "Обязательный JSON: id, title, scenario, level, slideCount, outline, speechScript, slides.",
    "Для каждого slide: id, order, title, layout, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "layout: hero, bullets, two-column или summary. blocks: bullets, callout или quote.",
    `Источники:\n${formatSourceText(sources)}`,
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
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  const slides = rawSlides.slice(0, project.slideCount).map((slide, index) => normalizeSlide(slide, index + 1, publicSources, project));

  while (slides.length < project.slideCount) {
    slides.push(buildFallbackSlide(slides.length + 1, project, publicSources));
  }

  const speechScript = slides.map((slide, index) => {
    const source = Array.isArray(input.speechScript)
      ? input.speechScript.find((item) => Number(item?.slideOrder) === slide.order) || input.speechScript[index]
      : undefined;

    return {
      slideOrder: slide.order,
      slideTitle: cleanText(source?.slideTitle || slide.title),
      text: cleanText(source?.text || buildSpeechText(slide, project, index)),
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
    outline: Array.isArray(input.outline) && input.outline.length ? input.outline.map(cleanText).filter(Boolean) : slides.map((slide) => slide.title),
    speechScript,
    slides,
  });
}

function normalizeSlide(rawSlide: unknown, order: number, sources: Source[], project: ProjectInput): Slide {
  const slide = rawSlide && typeof rawSlide === "object" ? (rawSlide as Partial<Slide>) : {};
  const sourceRefs = Array.isArray(slide.sourceRefs) && slide.sourceRefs.length
    ? slide.sourceRefs
    : [sourceRefFromSource(sources[(order - 1) % sources.length])];
  const blocks = Array.isArray(slide.blocks) ? slide.blocks.map(normalizeBlock).filter((block): block is SlideBlock => Boolean(block)) : [];

  return {
    id: cleanText(slide.id) || `slide-${order}`,
    order,
    title: cleanText(slide.title) || fallbackTitle(project, order),
    layout: normalizeLayout(slide.layout, order, project.slideCount),
    blocks: blocks.length ? blocks : buildFallbackBlocks(project, sources[(order - 1) % sources.length]),
    speakerNotes: cleanText(slide.speakerNotes) || `Расскажите, как раздел "${fallbackTitle(project, order)}" связан с темой "${project.title}".`,
    timingSeconds: clampNumber(Number(slide.timingSeconds || 55), 20, 240),
    sourceRefs: sourceRefs.map((ref) => ({
      sourceId: cleanText(ref.sourceId) || sources[0]?.id || "src-prompt",
      label: cleanText(ref.label) || sources.find((source) => source.id === ref.sourceId)?.label || "Источник",
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
    const items = Array.isArray(candidate.items) ? candidate.items.map(cleanText).filter(Boolean).slice(0, 6) : [];
    return items.length ? { type: "bullets", items } : null;
  }

  if (candidate.type === "quote" || candidate.type === "callout") {
    const content = cleanText(candidate.content);
    return content ? { type: candidate.type, content } : null;
  }

  return null;
}

function normalizeSources(sources: Source[], project: ProjectInput): Source[] {
  const normalized = sources
    .map((source) => ({
      id: cleanText(source.id),
      label: cleanText(source.label) || "Источник",
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
  return {
    id: `slide-${order}`,
    order,
    title: fallbackTitle(project, order),
    layout: normalizeLayout(undefined, order, project.slideCount),
    blocks: buildFallbackBlocks(project, source),
    speakerNotes: buildSpeechText({ title: fallbackTitle(project, order), blocks: buildFallbackBlocks(project, source), sourceRefs: [sourceRefFromSource(source)] } as Slide, project, order - 1),
    timingSeconds: order === 1 || order === project.slideCount ? 45 : 55,
    sourceRefs: [sourceRefFromSource(source)],
  };
}

function buildFallbackBlocks(project: ProjectInput, source: Source | undefined): SlideBlock[] {
  const excerpt = shortenSentence(source?.excerpt || project.prompt, 180);
  return [
    {
      type: "bullets",
      items: [
        excerpt,
        `Этот факт помогает раскрыть тему "${project.title}" для аудитории уровня ${project.level}.`,
        "Ключевой вывод нужно связать с предыдущими и следующими слайдами.",
      ],
    },
    {
      type: "callout",
      content: shortenSentence(excerpt, 140),
    },
  ];
}

function buildSpeechText(slide: Slide, project: ProjectInput, index: number) {
  const bullets = slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])).slice(0, 3);
  const intro = index === 0
    ? `Сегодня я расскажу о теме "${project.title}".`
    : `На этом слайде раскрывается раздел "${slide.title}".`;
  return `${intro} ${bullets.join(" ")} Эти данные связаны с источником: ${slide.sourceRefs[0]?.label || "материалы"}.`;
}

function fallbackTitle(project: ProjectInput, order: number) {
  const titles = [
    `Тема: ${project.title}`,
    "Контекст и актуальность",
    "Ключевые факты",
    "Главные изменения",
    "Примеры",
    "Источники и подтверждения",
    "Объяснение простыми словами",
    "Что важно запомнить",
    "Выводы",
    "Источники",
  ];
  return titles[order - 1] || `${order}. ${project.title}`;
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

function shortenSentence(value: string, maxLength: number) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
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
