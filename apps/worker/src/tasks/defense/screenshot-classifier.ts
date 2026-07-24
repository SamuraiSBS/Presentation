import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { z } from "zod";
import { normalizeOpenAIUsage, recordAiUsage } from "../../usage-ledger.js";
import { createOpenAIClient } from "../../openai-client.js";

const screenshotKindSchema = z.enum([
  "landing",
  "authentication",
  "dashboard",
  "navigation",
  "list",
  "detail",
  "form",
  "settings",
  "report",
  "mobile",
  "other",
]);

const visionResultSchema = z.object({
  kind: screenshotKindSchema,
  label: z.string().trim().min(1).max(160),
  visiblePurpose: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1),
  matchedFactIds: z.array(z.string()).max(20).default([]),
  matchedRequirementIds: z.array(z.string()).max(20).default([]),
});

export type DefenseScreenshotClassification = z.infer<typeof visionResultSchema> & {
  sourceId: string;
  status: "classified" | "needs_review" | "user_confirmed";
  provider: "openai" | "metadata" | "user";
  width?: number;
  height?: number;
};

export async function classifyDefenseScreenshot(input: {
  sourceId: string;
  label: string;
  buffer: Buffer;
  contentType?: string;
  facts?: Array<{ id: string; statement: string }>;
  requirements?: Array<{ id: string; text: string }>;
}, dependencies: { openAI?: OpenAI } = {}): Promise<DefenseScreenshotClassification> {
  const metadata = await sharp(input.buffer, { limitInputPixels: 48_000_000, failOn: "error" }).metadata();
  const fallback = metadataClassification(input, metadata.width, metadata.height);
  if (process.env.VISION_PROVIDER !== "openai" || !process.env.OPENAI_API_KEY?.trim()) return fallback;

  const client = dependencies.openAI || createOpenAIClient();
  const startedAt = new Date();
  try {
    const response = await client.responses.create({
      model: process.env.VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildVisionPrompt(input),
          },
          {
            type: "input_image",
            image_url: `data:${input.contentType || contentTypeForFormat(metadata.format)};base64,${input.buffer.toString("base64")}`,
            detail: "low",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "studydeck_defense_screenshot",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "label", "visiblePurpose", "confidence", "matchedFactIds", "matchedRequirementIds"],
            properties: {
              kind: { type: "string", enum: screenshotKindSchema.options },
              label: { type: "string" },
              visiblePurpose: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              matchedFactIds: { type: "array", items: { type: "string" } },
              matchedRequirementIds: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    });
    const payload = response as typeof response & { output_parsed?: unknown };
    const parsed = visionResultSchema.parse(payload.output_parsed || JSON.parse(response.output_text));
    const factIds = new Set((input.facts || []).map((item) => item.id));
    const requirementIds = new Set((input.requirements || []).map((item) => item.id));
    await recordAiUsage({
      provider: "openai",
      model: process.env.VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      operation: "screenshot_classification",
      schemaName: "studydeck_defense_screenshot",
      providerRequestId: response.id,
      usage: normalizeOpenAIUsage(response.usage),
      startedAt,
    });
    return {
      ...parsed,
      sourceId: input.sourceId,
      matchedFactIds: parsed.matchedFactIds.filter((id) => factIds.has(id)),
      matchedRequirementIds: parsed.matchedRequirementIds.filter((id) => requirementIds.has(id)),
      status: parsed.confidence >= 0.65 ? "classified" : "needs_review",
      provider: "openai",
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    await recordAiUsage({
      provider: "openai",
      model: process.env.VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      operation: "screenshot_classification",
      schemaName: "studydeck_defense_screenshot",
      startedAt,
      error,
    });
    return fallback;
  }
}

function metadataClassification(
  input: { sourceId: string; label: string },
  width?: number,
  height?: number,
): DefenseScreenshotClassification {
  const filename = path.parse(input.label).name.replace(/[-_]+/g, " ").trim();
  const normalized = filename.toLowerCase();
  const kind = normalized.includes("dashboard") || normalized.includes("панел")
    ? "dashboard"
    : normalized.includes("form") || normalized.includes("форм")
      ? "form"
      : normalized.includes("mobile") || normalized.includes("мобил") || (width && height && height > width * 1.2)
        ? "mobile"
        : normalized.includes("result") || normalized.includes("report") || normalized.includes("отчёт") || normalized.includes("результ")
          ? "report"
          : normalized.includes("landing") || normalized.includes("главн")
            ? "landing"
            : "other";
  return {
    sourceId: input.sourceId,
    kind,
    label: filename || "Скриншот проекта",
    visiblePurpose: "Проверьте назначение скриншота перед распределением по слайдам.",
    confidence: kind === "other" ? 0.15 : 0.35,
    matchedFactIds: [],
    matchedRequirementIds: [],
    status: "needs_review",
    provider: "metadata",
    width,
    height,
  };
}

function buildVisionPrompt(input: {
  label: string;
  facts?: Array<{ id: string; statement: string }>;
  requirements?: Array<{ id: string; text: string }>;
}) {
  return [
    "Классифицируй пользовательский скриншот проекта для размещения в презентации защиты.",
    `Имя файла: ${input.label}`,
    "Опиши только назначение видимого экрана. Не превращай текст интерфейса или догадку в факт о продукте.",
    "matchedFactIds/matchedRequirementIds могут содержать только ID из списков ниже и только при очевидном соответствии.",
    `Факты: ${JSON.stringify((input.facts || []).slice(0, 30))}`,
    `Требования: ${JSON.stringify((input.requirements || []).slice(0, 30))}`,
  ].join("\n");
}

function contentTypeForFormat(format?: string) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}
