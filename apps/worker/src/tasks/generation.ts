import type { Job } from "bullmq";
import { auditSlideCanvas, ensureEditableCanvas, type Source } from "@studydeck/shared";
import { captureGenerationError, type TraceCarrier, withTraceSpan } from "../observability.js";
import { getPrisma } from "../prisma.js";
import { readObjectBuffer } from "../storage.js";
import { extractTextFromSource } from "./extract.js";
import { enrichPresentationImages } from "./image-search.js";
import {
  classifyGenerationError,
  logGenerationStage,
  safeErrorSummary,
  updateGenerationProgress,
  type GenerationProgressStage,
} from "./job-progress.js";
import { generateNarrationDraft, generatePresentationFromNarration } from "./presentation.js";
import { searchWebSources } from "./web-search.js";

type GenerationJobData = {
  projectId: string;
  userId: string;
  traceContext?: TraceCarrier;
};

export async function handleGenerationJob(job: Job<GenerationJobData>) {
  const prisma = getPrisma();
  const { projectId, traceContext } = job.data;
  const kind = job.name === "generate-narration" ? "narration" : "presentation";

  await prisma.project.update({
    where: { id: projectId },
    data: { status: kind === "narration" ? "script_generating" : "generating", error: null },
  });
  await prisma.generationJob.updateMany({
    where: { projectId, queueJobId: job.id, kind },
    data: { status: "active", progressStage: "queued", progressLabel: "В очереди", progressPercent: 0, stageStartedAt: new Date() },
  });

  const stageStartedAt = new Map<GenerationProgressStage, number>();
  const setStage = async (stage: GenerationProgressStage) => {
    stageStartedAt.set(stage, Date.now());
    await updateGenerationProgress(job, stage, (data) =>
      prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id, kind }, data }),
    );
  };
  const finishStage = (stage: GenerationProgressStage, error?: unknown) => {
    const startedAt = stageStartedAt.get(stage) || Date.now();
    logGenerationStage({ projectId, jobId: job.id, stage, durationMs: Date.now() - startedAt, error });
  };

  try {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { sources: true } });
    await setStage("researching");
    const sources = await withTraceSpan("generation.research", {
      "studydeck.project_id": projectId,
      "studydeck.job_id": String(job.id || ""),
      "studydeck.stage": "research",
      "studydeck.provider": process.env.WEB_SEARCH_PROVIDER || "tavily",
    }, () => prepareGenerationSources(project), traceContext);
    finishStage("researching");

    if (kind === "narration") {
      await setStage("drafting_speech");
      const draft = await withTraceSpan("generation.speech", {
        "studydeck.project_id": projectId,
        "studydeck.job_id": String(job.id || ""),
        "studydeck.stage": "speech",
        "studydeck.provider": process.env.AI_PROVIDER || "demo",
      }, () => generateNarrationDraft(project, sources), traceContext);
      finishStage("drafting_speech");
      await setStage("saving");
      await prisma.project.update({
        where: { id: projectId },
        data: {
          speechDraft: draft.text,
          speechDraftUpdatedAt: new Date(),
          status: "script_ready",
          error: null,
        },
      });
      finishStage("saving");
      await setStage("completed");
      await prisma.generationJob.updateMany({
        where: { projectId, queueJobId: job.id, kind },
        data: { status: "completed", progressStage: "completed", progressLabel: "Готово", progressPercent: 100 },
      });
      return;
    }

    if (!project.speechDraft?.trim()) {
      throw new Error("No accepted speech text was found for presentation generation");
    }
    const speechDraft = project.speechDraft;

    await setStage("building_slides");
    const generatedPresentation = await withTraceSpan("generation.slides", {
      "studydeck.project_id": projectId,
      "studydeck.job_id": String(job.id || ""),
      "studydeck.stage": "slides",
      "studydeck.provider": process.env.AI_PROVIDER || "demo",
    }, () => generatePresentationFromNarration(project, sources, speechDraft), traceContext);
    finishStage("building_slides");
    await setStage("selecting_visuals");
    const presentationWithImages = await withTraceSpan("generation.visuals", {
      "studydeck.project_id": projectId,
      "studydeck.job_id": String(job.id || ""),
      "studydeck.stage": "visuals",
      "studydeck.provider": process.env.PRESENTATION_IMAGES_ENABLED === "false" ? "disabled" : process.env.WEB_SEARCH_PROVIDER || "tavily",
    }, () => enrichPresentationImages(project, generatedPresentation), traceContext);
    finishStage("selecting_visuals");
    await setStage("polishing");
    const presentation = ensureEditableCanvas(presentationWithImages);
    const unsafeCanvases = presentation.slides.flatMap((slide) =>
      (slide.canvas ? auditSlideCanvas(slide.canvas) : ["canvas is missing"])
        .map((issue) => `slide ${slide.order}: ${issue}`),
    );
    if (unsafeCanvases.length) {
      throw new Error(`Presentation layout check failed: ${unsafeCanvases.slice(0, 8).join("; ")}`);
    }
    finishStage("polishing");
    await setStage("saving");
    await prisma.presentation.upsert({
      where: { projectId },
      create: { projectId, document: presentation },
      update: { document: presentation },
    });
    await prisma.project.update({ where: { id: projectId }, data: { status: "ready" } });
    finishStage("saving");
    await setStage("completed");
    await prisma.generationJob.updateMany({
      where: { projectId, queueJobId: job.id, kind },
      data: { status: "completed", progressStage: "completed", progressLabel: "Готово", progressPercent: 100 },
    });
  } catch (error) {
    const message = safeErrorSummary(error);
    const retryClass = classifyGenerationError(error);
    const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
    const willRetry = retryClass === "transient" && job.attemptsMade + 1 < attempts;
    if (!willRetry) {
      job.discard();
    }
    logGenerationStage({ projectId, jobId: job.id, stage: "failed", durationMs: 0, error });
    captureGenerationError(error, {
      projectId,
      jobId: job.id,
      stage: "failed",
      provider: process.env.AI_PROVIDER,
    });
    if (!willRetry) {
      await prisma.project.update({ where: { id: projectId }, data: { status: "failed", error: message } });
    }
    await prisma.generationJob.updateMany({
      where: { projectId, queueJobId: job.id, kind },
      data: {
        status: willRetry ? "active" : "failed",
        error: message,
        progressStage: willRetry ? "queued" : "failed",
        progressLabel: willRetry ? "Временная ошибка, попробуем ещё раз" : "Не получилось",
        progressPercent: willRetry ? 5 : 100,
        stageStartedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function prepareGenerationSources(project: {
  id: string;
  prompt: string;
  mode: string;
  speechDraft?: string | null;
  sources: Array<{
    id: string;
    label: string;
    type: string;
    size: number;
    objectKey: string | null;
    url: string | null;
    excerpt: string;
    text: string;
  }>;
}) {
  const sources: Source[] = [];

  for (const source of project.sources) {
    if (source.type === "WEB") {
      continue;
    }

    if (!source.objectKey) {
      if (source.excerpt || source.text) {
        sources.push({
          id: source.id,
          label: source.label,
          type: source.type,
          size: source.size,
          excerpt: source.excerpt || makeExcerpt(source.text, project.prompt),
          url: source.url || undefined,
        });
      }
      continue;
    }

    const buffer = await readObjectBuffer(source.objectKey);
    const text = cleanText(await extractTextFromSource(source.label, buffer)).slice(0, 9000);
    const excerpt = makeExcerpt(text, project.prompt);
    const prisma = getPrisma();
    const updated = await prisma.source.update({ where: { id: source.id }, data: { text, excerpt } });
    sources.push({
      id: updated.id,
      label: updated.label,
      type: updated.type,
      size: updated.size,
      objectKey: updated.objectKey || undefined,
      excerpt: updated.excerpt,
      url: updated.url || undefined,
    });
  }

  if (!sources.length || project.mode === "with_sources") {
    const prisma = getPrisma();
    await prisma.source.deleteMany({ where: { projectId: project.id, type: "WEB" } });
    let webSources: Source[];
    try {
      webSources = await searchWebSources(project.prompt);
    } catch (error) {
      captureGenerationError(error, {
        projectId: project.id,
        stage: "researching",
        provider: process.env.WEB_SEARCH_PROVIDER || "tavily",
      });
      throw error;
    }

    for (const source of webSources) {
      const created = await prisma.source.create({
        data: {
          projectId: project.id,
          label: source.label,
          type: source.type,
          excerpt: source.excerpt,
          text: source.excerpt,
          url: source.url,
        },
      });

      sources.push({
        id: created.id,
        label: created.label,
        type: created.type,
        size: created.size,
        objectKey: created.objectKey || undefined,
        excerpt: created.excerpt,
        url: created.url || undefined,
      });
    }
  }

  if (!sources.length && project.speechDraft?.trim()) {
    const text = cleanText(project.speechDraft).slice(0, 9000);
    sources.push({
      id: `${project.id}-accepted-speech`,
      label: "Accepted speech text",
      type: "PROMPT",
      size: text.length,
      excerpt: makeExcerpt(text, project.prompt) || text.slice(0, 1100),
    });
  }

  if (!sources.length) {
    throw new Error("No source material was found for generation");
  }

  return sources;
}

function cleanText(value: string) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function makeExcerpt(text: string, prompt: string) {
  const sentences = cleanText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const promptWords = new Set(cleanText(prompt).toLowerCase().split(/\s+/).filter((word) => word.length > 4));
  return sentences
    .map((sentence) => ({
      sentence,
      score: sentence.toLowerCase().split(/\s+/).reduce((sum, word) => sum + (promptWords.has(word) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.sentence)
    .join(" ")
    .slice(0, 1100);
}
