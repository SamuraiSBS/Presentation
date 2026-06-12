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

export async function generatePresentation(project: ProjectInput, sources: Source[]): Promise<PresentationDocument> {
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
  const sourceText = sources.map((source) => `[${source.id}] ${source.label}\n${source.excerpt}`).join("\n\n").slice(0, 18000);

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
        content: [
          `Тема: ${project.prompt}`,
          `Сценарий: ${project.scenario}`,
          `Уровень: ${project.level}`,
          `Количество слайдов: ${project.slideCount}`,
          `Режим: ${project.mode}`,
          `Источники:\n${sourceText || "Источники не загружены."}`,
        ].join("\n\n"),
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
  return presentationSchema.parse({ ...parsed, sources, generationMode: "openai" });
}

function demoPresentation(project: ProjectInput, sources: Source[], generationMode: "demo" | "demo-fallback"): PresentationDocument {
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
