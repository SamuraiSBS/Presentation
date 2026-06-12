import crypto from "node:crypto";
import OpenAI from "openai";
import {
  type PresentationDocument,
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

type YandexCompletionResponse = {
  alternatives?: Array<{
    message?: {
      text?: string;
    };
  }>;
};

export async function generatePresentation(project: ProjectInput, sources: Source[]): Promise<PresentationDocument> {
  const provider = process.env.AI_PROVIDER?.toLowerCase();

  if (provider === "yandex" || (!provider && process.env.YANDEX_API_KEY)) {
    try {
      return await generateWithYandex(project, sources);
    } catch (error) {
      console.warn("Yandex generation failed, falling back to demo:", error);
      return demoPresentation(project, sources, "demo-fallback");
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      return await generateWithOpenAI(project, sources);
    } catch (error) {
      console.warn("OpenAI generation failed, falling back to demo:", error);
      return demoPresentation(project, sources, "demo-fallback");
    }
  }

  return demoPresentation(project, sources, "demo");
}

async function generateWithOpenAI(project: ProjectInput, sources: Source[]) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const sourceText = formatSourceText(sources);

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    input: [
      {
        role: "system",
        content:
          "You create Russian study presentations. Help the student understand and present the material. Return valid JSON only with slides, source references, speaker notes and speech script.",
      },
      {
        role: "user",
        content: buildGenerationPrompt(project, sourceText),
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
  const parsed = typedResponse.output_parsed || JSON.parse(response.output_text || "{}");
  return parsePresentationResult(parsed, sources, "openai");
}

async function generateWithYandex(project: ProjectInput, sources: Source[]) {
  const apiKey = process.env.YANDEX_API_KEY;

  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required when AI_PROVIDER=yandex");
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
        maxTokens: "6000",
      },
      jsonObject: true,
      messages: [
        {
          role: "system",
          text:
            "Ты создаешь учебные презентации на русском языке. Помоги студенту понять и представить материал. Верни только валидный JSON со слайдами, ссылками на источники, заметками спикера и сценарием речи.",
        },
        {
          role: "user",
          text: buildGenerationPrompt(project, formatSourceText(sources)),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Yandex generation request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as YandexCompletionResponse;
  const outputText = payload.alternatives?.[0]?.message?.text;

  if (!outputText) {
    throw new Error("Yandex generation response did not include text");
  }

  return parsePresentationResult(JSON.parse(outputText), sources, "yandex");
}

function buildGenerationPrompt(project: ProjectInput, sourceText: string) {
  return [
    "Верни JSON-объект в формате StudyDeck PresentationDocument.",
    "Обязательные поля: id, title, scenario, level, slideCount, outline, speechScript, slides.",
    "Для каждого slide нужны id, order, title, layout, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "layout должен быть одним из: hero, bullets, two-column, summary.",
    "blocks должны быть bullets, callout или quote.",
    "speechScript должен содержать объект для каждого слайда.",
    `Тема: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень: ${project.level}`,
    `Количество слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    `Источники:\n${sourceText || "Источники не загружены."}`,
  ].join("\n\n");
}

function formatSourceText(sources: Source[]) {
  return sources.map((source) => `[${source.id}] ${source.label}\n${source.excerpt}`).join("\n\n").slice(0, 18000);
}

function getYandexModelUri() {
  if (process.env.YANDEX_MODEL_URI) {
    return process.env.YANDEX_MODEL_URI;
  }

  if (!process.env.YANDEX_FOLDER_ID) {
    throw new Error("YANDEX_FOLDER_ID or YANDEX_MODEL_URI is required when AI_PROVIDER=yandex");
  }

  const modelName = process.env.YANDEX_MODEL_NAME || "yandexgpt";
  return `gpt://${process.env.YANDEX_FOLDER_ID}/${modelName}/latest`;
}

function parsePresentationResult(parsed: unknown, sources: Source[], generationMode: AiGenerationMode) {
  return presentationSchema.parse({ ...(parsed as object), sources, generationMode });
}

function demoPresentation(
  project: ProjectInput,
  sources: Source[],
  generationMode: FallbackGenerationMode,
): PresentationDocument {
  const normalizedSources = sources.length
    ? sources
    : [{ id: "src-prompt", label: "Запрос пользователя", type: "PROMPT", excerpt: project.prompt }];
  const titles = [
    `Тема: ${project.title}`,
    "Почему это важно",
    "Ключевые понятия",
    "Главные тезисы",
    "Пример для объяснения",
    "Что говорят источники",
    "Сложные места простыми словами",
    "Рассказ для выступления",
    "Выводы",
    "Список источников",
  ];

  const slides = Array.from({ length: project.slideCount }, (_, index) => {
    const source = normalizedSources[index % normalizedSources.length] ?? normalizedSources[0]!;
    const title = titles[index] || `${index + 1}. ${project.title}`;
    const layout: "hero" | "bullets" | "two-column" | "summary" =
      index === 0 ? "hero" : index === project.slideCount - 1 ? "summary" : index % 3 === 0 ? "two-column" : "bullets";
    return {
      id: `slide-${index + 1}`,
      order: index + 1,
      title,
      layout,
      blocks: [
        {
          type: "bullets" as const,
          items: [
            index === 0 ? `Тема выступления: ${project.title}.` : `Основная мысль слайда: ${title}.`,
            "Тезис нужно объяснить своими словами и связать с материалом.",
            source.excerpt ? source.excerpt.slice(0, 180) : "Добавьте источник, чтобы усилить доказательность.",
          ],
        },
        {
          type: "callout" as const,
          content: "Проверьте этот тезис по источнику перед выступлением.",
        },
      ],
      speakerNotes: `Слайд ${index + 1}: объясните раздел "${title}" и покажите связь с источником "${source.label}".`,
      timingSeconds: index === 0 ? 45 : 55,
      sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
    };
  });

  return {
    id: crypto.randomUUID(),
    title: project.title,
    scenario: project.scenario,
    level: project.level,
    slideCount: slides.length,
    generationMode,
    sources: normalizedSources,
    outline: slides.map((slide) => slide.title),
    speechScript: slides.map((slide) => ({
      slideOrder: slide.order,
      slideTitle: slide.title,
      text: `На этом слайде я расскажу: ${slide.blocks
        .flatMap((block) => (block.type === "bullets" ? block.items : [block.content]))
        .join(" ")} Эта часть связана с источником ${slide.sourceRefs[0]?.label || "материалами"}.`,
    })),
    slides,
  };
}

const jsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {},
};
