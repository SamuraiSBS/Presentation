import type { Job } from "bullmq";
import { errorLogFields, logger } from "../observability.js";

export const GENERATION_PROGRESS_STAGES = [
  "queued",
  "extracting_sources",
  "extracting_requirements",
  "classifying_assets",
  "building_defense_plan",
  "checking_compliance",
  "saving_report",
  "researching",
  "drafting_speech",
  "building_slides",
  "selecting_visuals",
  "polishing",
  "saving",
  "completed",
  "failed",
] as const;

export type GenerationProgressStage = typeof GENERATION_PROGRESS_STAGES[number];

export type GenerationRetryClass = "transient" | "repairable_schema" | "fatal";

const STAGE_META: Record<GenerationProgressStage, { label: string; percent: number }> = {
  queued: { label: "В очереди", percent: 0 },
  extracting_sources: { label: "Разбираем материалы проекта", percent: 12 },
  extracting_requirements: { label: "Выделяем факты и требования", percent: 36 },
  classifying_assets: { label: "Проверяем стиль и изображения", percent: 62 },
  building_defense_plan: { label: "Составляем план защиты", percent: 78 },
  checking_compliance: { label: "Проверяем презентацию по ТЗ", percent: 55 },
  saving_report: { label: "Сохраняем версию отчёта", percent: 90 },
  researching: { label: "Собираем факты и источники", percent: 15 },
  drafting_speech: { label: "Готовим текст выступления", percent: 35 },
  building_slides: { label: "Собираем слайды", percent: 60 },
  selecting_visuals: { label: "Подбираем визуалы", percent: 78 },
  polishing: { label: "Проверяем качество", percent: 88 },
  saving: { label: "Сохраняем результат", percent: 96 },
  completed: { label: "Готово", percent: 100 },
  failed: { label: "Не получилось", percent: 100 },
};

export function progressForStage(stage: GenerationProgressStage) {
  return { stage, ...STAGE_META[stage] };
}

export function generationJobOptions() {
  return {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 100 },
    removeOnFail: { age: 60 * 60 * 24 * 7, count: 200 },
  };
}

export async function updateGenerationProgress(
  job: Pick<Job, "id" | "updateProgress">,
  stage: GenerationProgressStage,
  persist: (data: { progressStage: string; progressLabel: string; progressPercent: number; stageStartedAt?: Date }) => Promise<unknown>,
) {
  const progress = progressForStage(stage);
  const payload = {
    stage: progress.stage,
    label: progress.label,
    percent: progress.percent,
    at: new Date().toISOString(),
  };
  await job.updateProgress(payload);
  await persist({
    progressStage: progress.stage,
    progressLabel: progress.label,
    progressPercent: progress.percent,
    stageStartedAt: new Date(payload.at),
  });
  return payload;
}

export function classifyGenerationError(error: unknown): GenerationRetryClass {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const text = `${name} ${message}`.toLowerCase();

  if (
    text.includes("api_key")
    || text.includes("api key")
    || text.includes("is required")
    || text.includes("unsupported web_search_provider")
    || text.includes("yandex_folder_id")
    || text.includes("yandex_model_uri")
    || text.includes("no accepted speech text")
  ) {
    return "fatal";
  }

  if (
    name === "StructuredGenerationError"
    || text.includes("failed validation")
    || text.includes("quality check failed")
    || text.includes("schema")
  ) {
    return "repairable_schema";
  }

  if (
    text.includes("fetch failed")
    || text.includes("timeout")
    || text.includes("timed out")
    || text.includes("econnreset")
    || text.includes("etimedout")
    || text.includes("429")
    || /\b5\d{2}\b/.test(text)
  ) {
    return "transient";
  }

  return "fatal";
}

export function safeErrorSummary(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Generation failed");
  return errorLogFields(error).errorMessage || message.slice(0, 500);
}

export function logGenerationStage(input: {
  projectId: string;
  jobId: string | number | undefined;
  stage: GenerationProgressStage;
  durationMs: number;
  error?: unknown;
}) {
  const payload = {
    projectId: input.projectId,
    jobId: input.jobId ? String(input.jobId) : "",
    stage: input.stage,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    ...(input.error ? errorLogFields(input.error) : {}),
  };
  logger.info(payload, "generation stage");
}
