import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
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
import { runWithUsageContext } from "../usage-ledger.js";
import {
  handleDefenseAnalysisJob,
  handleDefenseComplianceJob,
  type DefenseAnalysisJobData,
  type DefenseComplianceJobData,
} from "./defense/jobs.js";
import {
  applyDefenseGroundingToPresentation,
  assertDefensePresentation,
  buildDefenseGroundingBundle,
  buildDefenseNarrationText,
  defenseGroundingSource,
  prepareDefenseGenerationProject,
  type DefenseGroundingWorkspaceRow,
} from "./defense/grounding.js";

type GenerationJobData = {
  projectId: string;
  userId: string;
  generationJobId?: string;
  traceContext?: TraceCarrier;
};

type GenerationQueueJobData = GenerationJobData | DefenseAnalysisJobData | DefenseComplianceJobData;

export async function handleGenerationJob(job: Job<GenerationQueueJobData>) {
  if (job.name === "analyze-defense-brief") {
    return handleDefenseAnalysisJob(job as Job<DefenseAnalysisJobData>);
  }
  if (job.name === "check-defense-compliance") {
    return handleDefenseComplianceJob(job as Job<DefenseComplianceJobData>);
  }
  if (job.name !== "generate-narration" && job.name !== "generate-presentation") {
    throw new Error(`Unsupported generation job: ${job.name}`);
  }
  const generationJob = job as Job<GenerationJobData>;
  const prisma = getPrisma();
  const { projectId, traceContext } = generationJob.data;
  const kind = generationJob.name === "generate-narration" ? "narration" : "presentation";
  const jobWhere = regularGenerationJobWhere(projectId, generationJob.id, kind, generationJob.data.generationJobId);
  const databaseJob = await prisma.generationJob.findFirst({
    where: jobWhere,
    select: { id: true },
  });

  return runWithUsageContext({
    userId: generationJob.data.userId,
    projectId,
    generationJobId: databaseJob?.id,
    queueJobId: generationJob.id ? String(generationJob.id) : undefined,
    stage: kind === "narration" ? "drafting_speech" : "building_slides",
  }, () => runGenerationJob(generationJob, kind, traceContext));
}

async function runGenerationJob(job: Job<GenerationJobData>, kind: "narration" | "presentation", traceContext?: TraceCarrier) {
  const prisma = getPrisma();
  const { projectId } = job.data;
  const jobWhere = regularGenerationJobWhere(projectId, job.id, kind, job.data.generationJobId);

  await prisma.project.update({
    where: { id: projectId },
    data: { status: kind === "narration" ? "script_generating" : "generating", error: null },
  });
  await prisma.generationJob.updateMany({
    where: jobWhere,
    data: { status: "active", progressStage: "queued", progressLabel: "В очереди", progressPercent: 0, stageStartedAt: new Date() },
  });

  const stageStartedAt = new Map<GenerationProgressStage, number>();
  const setStage = async (stage: GenerationProgressStage) => {
    const cancellation = await prisma.generationJob.findFirst({ where: jobWhere, select: { cancelRequestedAt: true } });
    if (cancellation?.cancelRequestedAt) throw new Error("Generation cancelled by administrator");
    stageStartedAt.set(stage, Date.now());
    await updateGenerationProgress(job, stage, (data) =>
      prisma.generationJob.updateMany({ where: jobWhere, data }),
    );
  };
  const finishStage = (stage: GenerationProgressStage, error?: unknown) => {
    const startedAt = stageStartedAt.get(stage) || Date.now();
    logGenerationStage({ projectId, jobId: job.id, stage, durationMs: Date.now() - startedAt, error });
  };

  try {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        sources: true,
        defenseWorkspace: {
          include: {
            facts: { include: { evidence: true } },
            requirements: true,
            conflicts: true,
            project: { include: { sources: true } },
          },
        },
      },
    });
    if (project.workflow === "requirements_driven" && !project.defenseWorkspace) {
      throw new Error("Requirements-driven project has no defense workspace");
    }
    const defenseBundle = project.workflow === "requirements_driven"
      ? buildDefenseGroundingBundle(project.defenseWorkspace as DefenseGroundingWorkspaceRow)
      : null;
    const generationProject = defenseBundle ? prepareDefenseGenerationProject(project, defenseBundle) : project;
    await setStage("researching");
    const sources = await withTraceSpan("generation.research", {
      "studydeck.project_id": projectId,
      "studydeck.job_id": String(job.id || ""),
      "studydeck.stage": "research",
      "studydeck.provider": process.env.WEB_SEARCH_PROVIDER || "tavily",
    }, () => defenseBundle
      ? Promise.resolve([defenseGroundingSource(project.id, defenseBundle)])
      : prepareGenerationSources(project, { refreshWeb: kind === "narration" }), traceContext);
    finishStage("researching");

    if (kind === "narration") {
      await setStage("drafting_speech");
      const draft = await withTraceSpan("generation.speech", {
        "studydeck.project_id": projectId,
        "studydeck.job_id": String(job.id || ""),
        "studydeck.stage": "speech",
        "studydeck.provider": process.env.AI_PROVIDER || "demo",
      }, () => generateNarrationDraft(generationProject, sources), traceContext);
      finishStage("drafting_speech");
      await setStage("saving");
      const narrationText = defenseBundle ? buildDefenseNarrationText(defenseBundle) : draft.text;
      await prisma.project.update({
        where: { id: projectId },
        data: {
          speechDraft: narrationText,
          speechDraftUpdatedAt: new Date(),
          status: "script_ready",
          error: null,
        },
      });
      finishStage("saving");
      await setStage("completed");
      await prisma.generationJob.updateMany({
        where: jobWhere,
        data: { status: "completed", progressStage: "completed", progressLabel: "Готово", progressPercent: 100 },
      });
      await prisma.userActivityEvent.create({ data: { userId: job.data.userId, projectId, type: "generation.completed", metadata: { kind } } });
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
    }, () => generatePresentationFromNarration(generationProject, sources, speechDraft), traceContext);
    finishStage("building_slides");
    const groundedPresentation = defenseBundle
      ? applyDefenseGroundingToPresentation(generatedPresentation, defenseBundle, project.sources)
      : generatedPresentation;
    await setStage("selecting_visuals");
    const presentationWithImages = await withTraceSpan("generation.visuals", {
      "studydeck.project_id": projectId,
      "studydeck.job_id": String(job.id || ""),
      "studydeck.stage": "visuals",
      "studydeck.provider": process.env.PRESENTATION_IMAGES_ENABLED === "false" ? "disabled" : process.env.WEB_SEARCH_PROVIDER || "tavily",
    }, () => enrichPresentationImages(generationProject, groundedPresentation), traceContext);
    finishStage("selecting_visuals");
    await setStage("polishing");
    // The model may return a schema-valid but geometrically unsafe canvas. A
    // generated presentation is not user-edited yet, so rebuild its canvas
    // from the validated slide content before running the layout audit.
    const presentation = ensureEditableCanvas({
      ...presentationWithImages,
      slides: presentationWithImages.slides.map((slide) => ({ ...slide, canvas: undefined })),
    });
    const unsafeCanvases = presentation.slides.flatMap((slide) =>
      (slide.canvas ? auditSlideCanvas(slide.canvas) : ["canvas is missing"])
        .map((issue) => `slide ${slide.order}: ${issue}`),
    );
    if (unsafeCanvases.length) {
      throw new Error(`Presentation layout check failed: ${unsafeCanvases.slice(0, 8).join("; ")}`);
    }
    if (defenseBundle) assertDefensePresentation(presentation, defenseBundle);
    finishStage("polishing");
    await setStage("saving");
    await prisma.presentation.upsert({
      where: { projectId },
      create: { projectId, document: presentation },
      update: { document: presentation, revision: { increment: 1 } },
    });
    await prisma.project.update({ where: { id: projectId }, data: { status: "ready" } });
    finishStage("saving");
    await setStage("completed");
    await prisma.generationJob.updateMany({
      where: jobWhere,
      data: { status: "completed", progressStage: "completed", progressLabel: "Готово", progressPercent: 100 },
    });
    await prisma.userActivityEvent.create({ data: { userId: job.data.userId, projectId, type: "generation.completed", metadata: { kind } } });
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
      where: jobWhere,
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

function regularGenerationJobWhere(
  projectId: string,
  queueJobId: string | undefined,
  kind: "narration" | "presentation",
  generationJobId?: string,
): Prisma.GenerationJobWhereInput {
  return generationJobId
    ? { id: generationJobId, projectId, kind }
    : { projectId, queueJobId, kind };
}

export async function prepareGenerationSources(project: {
  id: string;
  prompt: string;
  mode: string;
  workflow?: string;
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
    included?: boolean;
  }>;
}, options: { refreshWeb?: boolean } = {}) {
  // Requirements-driven projects may use the web for user-approved decorative
  // images, but never as factual grounding. Keep that boundary server-side so
  // a legacy `with_sources` mode cannot accidentally trigger Tavily research.
  const refreshWeb = project.workflow === "requirements_driven" ? false : options.refreshWeb ?? true;
  const sources: Source[] = [];

  for (const source of project.sources) {
    if (source.included === false) continue;
    if (source.type === "WEB") {
      if (!refreshWeb) {
        sources.push({
          id: source.id,
          label: source.label,
          type: source.type,
          size: source.size,
          excerpt: source.excerpt,
          url: source.url || undefined,
          included: true,
        });
      }
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
          included: true,
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
      included: true,
    });
  }

  if (refreshWeb && (!sources.length || project.mode === "with_sources")) {
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
          included: true,
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
        included: true,
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
      included: true,
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
