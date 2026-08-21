import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import {
  auditSlideCanvas,
  ensureEditableCanvas,
  PREMIUM_PRESENTATION_THEMES,
  publicNarrationFailureMessage,
  type PresentationDocument,
  type Source,
} from "@studydeck/shared";
import { materializePlannedVisuals, productionQualityReleaseResult } from "./presentation-quality.js";
import { captureGenerationError, errorLogFields, logger, type TraceCarrier, withTraceSpan } from "../observability.js";
import { getPrisma } from "../prisma.js";
import { readObjectBuffer } from "../storage.js";
import { extractTextFromSource } from "./extract.js";
import {
  generationFailureCategory,
  logGenerationStage,
  safeGenerationError,
  shouldRetryGenerationJob,
  updateGenerationProgress,
  publicNarrationFailureState,
  type GenerationProgressStage,
} from "./job-progress.js";
import { buildLocalPresentationFromAcceptedNarration, generateNarrationDraft, generatePresentationFromNarration } from "./presentation.js";
import { repairReleaseCandidate } from "./presentation/quality/orchestration.js";
import { assessFullNarrationDocument } from "./presentation/narration/processing.js";
import { searchWebSources } from "./web-search.js";
import { enrichPresentationImages } from "./image-search.js";
import { runWithUsageContext } from "../usage-ledger.js";
import { failCostEnvelope, finalizeFailedCostEnvelope, reserveCostEnvelope, settleCostEnvelope } from "../cost-envelope.js";
import { EconomicReleaseGateError, evaluateEconomicReleaseGate } from "../economic-release-gate.js";
import { createMandatorySourceSnapshot, parseMandatorySourceSnapshot, snapshotSources } from "../source-snapshot.js";
import { captureWorkerProductAnalytics } from "../product-analytics.js";
import { releaseGenerationQuotaReservation } from "../generation-quota.js";
import {
  handleDefenseAnalysisJob,
  handleDefenseComplianceJob,
  type DefenseAnalysisJobData,
  type DefenseComplianceJobData,
} from "./defense/jobs.js";
import {
  applyDefenseGroundingToPresentation,
  assertDefensePresentation,
  assertDefenseNarrationReadiness,
  buildDefenseGroundingBundle,
  defenseGroundingSource,
  prepareDefenseGenerationProject,
  type DefenseGroundingWorkspaceRow,
} from "./defense/grounding.js";

type GenerationJobData = {
  projectId: string;
  userId: string;
  generationJobId?: string;
  costEnvelopeId?: string;
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
  const envelope = generationJob.data.costEnvelopeId
    ? await prisma.costEnvelope.findUnique({ where: { id: generationJob.data.costEnvelopeId }, select: { policyVersion: true, policySnapshot: true, catalogSnapshot: true } })
    : null;

  return runWithUsageContext({
    userId: generationJob.data.userId,
    projectId,
    generationJobId: databaseJob?.id,
    costEnvelopeId: generationJob.data.costEnvelopeId,
    costEnvelopePolicyVersion: envelope?.policyVersion,
    costEnvelopeSnapshot: envelope ? { policy: envelope.policySnapshot, catalog: envelope.catalogSnapshot } : undefined,
    queueJobId: generationJob.id ? String(generationJob.id) : undefined,
    stage: kind === "narration" ? "drafting_speech" : "building_slides",
  }, () => runGenerationJob(generationJob, kind, traceContext));
}

async function runGenerationJob(job: Job<GenerationJobData>, kind: "narration" | "presentation", traceContext?: TraceCarrier) {
  const prisma = getPrisma();
  const { projectId } = job.data;
  const startedAt = Date.now();
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
  let currentStage: GenerationProgressStage = "queued";
  const setStage = async (stage: GenerationProgressStage) => {
    const cancellation = await prisma.generationJob.findFirst({ where: jobWhere, select: { cancelRequestedAt: true } });
    if (cancellation?.cancelRequestedAt) throw new Error("Generation cancelled by administrator");
    currentStage = stage;
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
    if (defenseBundle) assertDefenseNarrationReadiness(defenseBundle);
    const generationProject = defenseBundle ? prepareDefenseGenerationProject(project, defenseBundle) : project;
    await setStage("researching");
    const sources = await withTraceSpan("generation.research", {
      "studydeck.project_id": projectId,
      "studydeck.job_id": String(job.id || ""),
      "studydeck.stage": "research",
      "studydeck.provider": process.env.WEB_SEARCH_PROVIDER || "tavily",
    }, () => defenseBundle
      ? Promise.resolve([defenseGroundingSource(project.id, defenseBundle)])
      : prepareGenerationSources(project, { refreshWeb: kind === "narration", costEnvelopeId: job.data.costEnvelopeId }), traceContext);
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
      const narrationOutcome = "narrationOutcome" in draft ? draft.narrationOutcome : undefined;
      await setStage("saving");
      await prisma.project.update({
        where: { id: projectId },
        data: {
          // The approved defense plan and its confirmed facts are already
          // supplied to the model through generationProject and sources. Do
          // not replace the completed narration with the plan's technical
          // requirements after generation.
          speechDraft: draft.text,
          speechDraftUpdatedAt: new Date(),
          status: "script_ready",
          error: null,
        },
      });
      finishStage("saving");
      await setStage("completed");
      await prisma.generationJob.updateMany({
        where: jobWhere,
        data: {
          status: "completed",
          progressStage: "completed",
          progressLabel: "Готово",
          progressPercent: 100,
          // This is a public-safe terminal routing state, not an operational
          // error. API serializers deliberately omit it from job.error.
          error: narrationOutcome?.kind === "editable_draft" ? "editable_draft" : "accepted_speech",
        },
      });
      await prisma.userActivityEvent.create({ data: {
        userId: job.data.userId,
        projectId,
        type: "generation.completed",
        // Keep recovery telemetry text-free: speech drafts, prompts and model
        // responses never leave the narration state machine.
        metadata: { kind, narrationOutcome: narrationOutcome?.kind, narrationStage: narrationOutcome?.stage },
      } });
      void captureWorkerProductAnalytics(job.data.userId, "generation_completed", {
        kind,
        attempt: job.attemptsMade + 1,
        duration_ms: Date.now() - startedAt,
      });
      return;
    }

    if (!project.speechDraft?.trim()) {
      throw new Error("No accepted speech text was found for presentation generation");
    }
    const speechDraft = project.speechDraft;

    await setStage("building_slides");
    const canUseAcceptedNarrationRecovery = () => hasAcceptedNarrationRecoveryArtifacts(generationProject, sources, speechDraft);
    const recoverAcceptedNarration = (stage: "building_slides" | "validating", error: unknown) => {
      if (!canUseAcceptedNarrationRecovery()) throw error;
      // This is a deterministic projection only.  In particular, it must not
      // call a provider or repeat source research after the accepted artifacts
      // have been persisted for this attempt group.
      logger.warn({ projectId, jobId: job.id, stage, fallback: "accepted_narration_local_projection", ...errorLogFields(error) }, "recovering presentation from accepted narration and source snapshot");
      return buildLocalPresentationFromAcceptedNarration(generationProject, sources, speechDraft);
    };
    // A presentation retry inherits the original attempt envelope.  Once that
    // envelope is terminal (or cannot be read), it must never begin another
    // paid provider stage.  The only permitted continuation is the local
    // projection from the accepted narration and persisted source snapshot.
    const recoveryReason = job.data.costEnvelopeId
      ? await presentationRecoveryReason(job.data.costEnvelopeId)
      : null;
    let usedLocalPresentationRecovery = false;

    let generatedPresentation: PresentationDocument;
    if (recoveryReason) {
      const error = new Error(recoveryReason);
      captureGenerationError(error, { projectId, stage: "building_slides", provider: process.env.AI_PROVIDER });
      generatedPresentation = recoverAcceptedNarration("building_slides", error);
      usedLocalPresentationRecovery = true;
    } else {
      try {
        generatedPresentation = await withTraceSpan("generation.slides", {
          "studydeck.project_id": projectId,
          "studydeck.job_id": String(job.id || ""),
          "studydeck.stage": "slides",
          "studydeck.provider": process.env.AI_PROVIDER || "demo",
        }, () => generatePresentationFromNarration(generationProject, sources, speechDraft), traceContext);
      } catch (error) {
        captureGenerationError(error, { projectId, stage: "building_slides", provider: process.env.AI_PROVIDER });
        generatedPresentation = recoverAcceptedNarration("building_slides", error);
        usedLocalPresentationRecovery = true;
      }
    }
    finishStage("building_slides");
    const groundedPresentation = defenseBundle
      ? applyDefenseGroundingToPresentation(generatedPresentation, defenseBundle, project.sources)
      : generatedPresentation;
    // Directions are not display data. Turn each planned local diagram into a
    // real slide visual before the canvas is built, including local recovery
    // documents which do not pass through the provider quality orchestrator.
    const presentationWithPlannedVisuals = materializePlannedVisuals(groundedPresentation);
    // A fresh presentation attempt may make its bounded, idempotent photo
    // lookups once. Recovery and retry paths stay entirely local: they reuse
    // only persisted narration/sources and diagram fallbacks, never Tavily.
    let presentationWithImages = presentationWithPlannedVisuals;
    if (!usedLocalPresentationRecovery) {
      await setStage("selecting_visuals");
      presentationWithImages = await enrichPresentationImages(generationProject, presentationWithPlannedVisuals);
      finishStage("selecting_visuals");
    }
    await setStage("polishing");
    // The model may return a schema-valid but geometrically unsafe canvas. A
    // generated presentation is not user-edited yet, so rebuild its canvas
    // from the validated slide content before running the layout audit.
    let presentation = ensureEditableCanvas({
      ...presentationWithImages,
      slides: presentationWithImages.slides.map((slide) => ({ ...slide, canvas: undefined })),
    });
    if (!usedLocalPresentationRecovery) {
      // Image enrichment can replace a photo direction with a diagram or add
      // Tavily metadata after the provider's first release gate. Re-run the
      // existing deterministic release repair on that exact post-image
      // document so its compact-copy and visual fallbacks are applied before
      // the final gate. This does not suppress source, schema, or canvas
      // blockers: the same gate below still evaluates the repaired document.
      presentation = repairReleaseCandidate(presentation, presentation.sources, generationProject);
    }
    let unsafeCanvases = canvasAuditIssues(presentation);
    if (unsafeCanvases.length) {
      // A geometry-only repair can preserve provider-shaped visual directions
      // which then fail the semantic quality gate after the canvas audit has
      // passed. Use the same deterministic readable projection as the
      // accepted-narration recovery: it removes optional visuals as well as
      // cramped canvas geometry without spending on another provider call.
      logger.warn({ projectId, jobId: job.id, fallback: "emergency_readable_layout", issueCount: unsafeCanvases.length }, "generated canvas is unsafe; applying deterministic readable recovery");
      presentation = buildEmergencyReadablePresentation(presentation);
      unsafeCanvases = canvasAuditIssues(presentation);
      if (unsafeCanvases.length) throw new Error(`Production quality gate rejected canvas safety: ${unsafeCanvases.slice(0, 8).join("; ")}`);
    }
    if (defenseBundle) assertDefensePresentation(presentation, defenseBundle);
    // Image fulfillment and canvas composition happen after the model-facing
    // quality loop. Re-audit the exact document that will be persisted: a
    // rejected candidate must never increment a revision or become ready.
    await setStage("validating");
    let release = productionQualityReleaseResult(presentation, presentation.sources, { ...generationProject, mandatorySourceSnapshot: Boolean(job.data.costEnvelopeId), acceptedNarrationRecovery: hasAcceptedNarrationRecoveryArtifacts(generationProject, sources, speechDraft) });
    logger.info({
      projectId,
      jobId: job.id,
      stage: "polishing",
      issueCategories: release.issueCategories,
      attempts: release.attempts,
      finalAction: release.finalDisposition,
    }, "presentation production quality gate");
    if (release.finalDisposition !== "released") {
      // A schema-valid provider response can still fail the production gate.
      // Re-project only the already accepted narration and snapshot sources;
      // then run the exact same gate again.  Do not use an emergency generic
      // deck here: it would weaken provenance and content integrity.
      const recoveredPresentation = recoverAcceptedNarration("validating", new Error(`provider presentation rejected: ${release.issueCategories.join(", ") || "unspecified quality issue"}`));
      usedLocalPresentationRecovery = true;
      presentation = ensureEditableCanvas({
        ...recoveredPresentation,
        slides: recoveredPresentation.slides.map((slide) => ({ ...slide, canvas: undefined })),
      });
      release = productionQualityReleaseResult(presentation, presentation.sources, { ...generationProject, mandatorySourceSnapshot: Boolean(job.data.costEnvelopeId), acceptedNarrationRecovery: true });
      if (release.finalDisposition !== "released") {
        // The first local projection keeps the usual editorial design.  If it
        // still contains provider-shaped generic text or an unfulfillable
        // visual, release the same accepted narration through the intentionally
        // plain, self-contained canvas. This is fully deterministic: no second
        // provider call, source search, or invented claim is allowed here.
        logger.warn({ projectId, jobId: job.id, fallback: "accepted_narration_emergency_readable", issueCategories: release.issueCategories }, "local presentation projection still failed quality gate; applying emergency readable recovery");
        presentation = buildEmergencyReadablePresentation(presentation);
        release = productionQualityReleaseResult(presentation, presentation.sources, { ...generationProject, mandatorySourceSnapshot: Boolean(job.data.costEnvelopeId), acceptedNarrationRecovery: true });
      }
      if (release.finalDisposition !== "released") throw new Error(`Production quality gate rejected generated presentation: ${release.issueCategories.join(", ") || "unspecified quality issue"}`);
    }
    if (job.data.costEnvelopeId) {
      const envelope = await prisma.costEnvelope.findUniqueOrThrow({
        where: { id: job.data.costEnvelopeId },
        select: {
          limitRub: true,
          reservedRub: true,
          settledRub: true,
          status: true,
          sourceSnapshot: true,
          reservations: { select: { status: true, reason: true } },
          _count: { select: { costEvents: { where: { category: "image_search" } } } },
        },
      });
      const economicGate = evaluateEconomicReleaseGate({
        presentation,
        sources,
        project: { ...generationProject, mandatorySourceSnapshot: true, acceptedNarrationRecovery: usedLocalPresentationRecovery },
        envelope: {
          limitRub: envelope.limitRub.toString(),
          reservedRub: envelope.reservedRub.toString(),
          settledRub: envelope.settledRub.toString(),
          status: envelope.status,
          sourceSnapshot: envelope.sourceSnapshot,
          reservations: envelope.reservations,
          imageSearchQueries: envelope._count.costEvents,
        },
      });
      logger.info({ projectId, jobId: job.id, stage: "validating", releaseGate: "economic_standard", passed: economicGate.passed, categories: economicGate.categories }, "economic presentation release gate");
      if (!economicGate.passed) throw new EconomicReleaseGateError(economicGate.categories);
    }
    presentation = {
      ...presentation,
      productionQualityGate: { version: 1, capability: "silent-production-quality-gate" },
    };
    finishStage("validating");
    await setStage("saving");
    // The release capability, persisted canvas and ready status describe one
    // revision. Do not expose ready if writing that canonical document fails.
    await prisma.$transaction([
      prisma.presentation.upsert({
        where: { projectId },
        create: { projectId, document: presentation },
        update: { document: presentation, revision: { increment: 1 } },
      }),
      prisma.project.update({ where: { id: projectId }, data: { status: "ready" } }),
    ]);
    finishStage("saving");
    await setStage("completed");
    await prisma.generationJob.updateMany({
      where: jobWhere,
      data: { status: "completed", progressStage: "completed", progressLabel: "Готово", progressPercent: 100 },
    });
    await prisma.userActivityEvent.create({ data: { userId: job.data.userId, projectId, type: "generation.completed", metadata: { kind } } });
    const timeToReadyMs = project.createdAt instanceof Date
      ? Date.now() - project.createdAt.getTime()
      : undefined;
    void captureWorkerProductAnalytics(job.data.userId, "generation_completed", {
      kind,
      attempt: job.attemptsMade + 1,
      duration_ms: Date.now() - startedAt,
      time_to_ready_ms: timeToReadyMs ?? null,
      local_recovery: usedLocalPresentationRecovery,
    });
  } catch (error) {
    const recovery = safeGenerationError(error);
    const failureCategory = generationFailureCategory(error);
    const narrationState = publicNarrationFailureState(kind, currentStage);
    const internalError = error instanceof EconomicReleaseGateError
      ? `economic_release_gate:${error.categories.join(",")}`
      : kind === "presentation" && error instanceof Error
        ? error.message
        : recovery.message;
    const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
    const willRetry = shouldRetryGenerationJob(kind, error, job.attemptsMade, attempts);
    if (!willRetry) {
      job.discard();
    }
    logGenerationStage({ projectId, jobId: job.id, stage: "failed", durationMs: 0, error, attempt: job.attemptsMade + 1, failureCategory, finalDisposition: willRetry ? "retry_scheduled" : "failed" });
    void captureWorkerProductAnalytics(job.data.userId, "generation_failed", {
      kind,
      attempt: job.attemptsMade + 1,
      duration_ms: Date.now() - startedAt,
      failure_category: failureCategory,
      retry_scheduled: willRetry,
    });
    captureGenerationError(error, {
      projectId,
      jobId: job.id,
      stage: "failed",
      provider: process.env.AI_PROVIDER,
    });
    if (!willRetry) {
      const existing = await prisma.presentation.findUnique({ where: { projectId }, select: { id: true } });
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: existing ? "ready" : "failed",
          error: narrationState && !existing ? publicNarrationFailureMessage(narrationState) : recovery.message,
        },
      });
    }
    await prisma.generationJob.updateMany({
      where: jobWhere,
        data: {
          status: willRetry ? "active" : "failed",
          // Project responses are sanitized by the API.  GenerationJob keeps a
          // compact operational category for admins without persisting provider
          // messages, tokens, or stack traces.
          // Project.error is public-safe. Keep the worker job's compact
          // presentation diagnostic intact so a failed recovery is
          // diagnosable and not overwritten by that public message.
          error: kind === "presentation" ? internalError : narrationState || internalError,
        progressStage: willRetry ? "queued" : "failed",
        progressLabel: willRetry ? "Временная ошибка, попробуем ещё раз" : "Не получилось",
        progressPercent: willRetry ? 5 : 100,
        stageStartedAt: new Date(),
      },
    });
    if (kind === "presentation" && !willRetry && job.data.generationJobId) {
      // The customer was charged only for a queued launch. A terminal service
      // failure returns that launch exactly once; the conditional reservation
      // transition also keeps duplicate BullMQ deliveries harmless.
      await releaseGenerationQuotaReservation(prisma, job.data.generationJobId).catch((releaseError) => {
        logger.error({ projectId, jobId: job.id, generationJobId: job.data.generationJobId, ...errorLogFields(releaseError) }, "generation quota refund failed");
      });
    }
    if (kind === "narration" && !willRetry && job.data.costEnvelopeId) {
      try {
        // The in-memory project that began this job may be stale. Only close
        // an envelope when the current persisted project still has no draft.
        const currentProject = await prisma.project.findUnique({
          where: { id: projectId },
          select: { speechDraft: true },
        });
        if (!currentProject?.speechDraft?.trim()) {
          await finalizeFailedCostEnvelope({ envelopeId: job.data.costEnvelopeId });
        }
      } catch (finalizationError) {
        // Preserve the original generation error and its public-safe routing,
        // but make an operational finalization failure observable.
        logger.error({
          projectId,
          jobId: job.id,
          costEnvelopeId: job.data.costEnvelopeId,
          ...errorLogFields(finalizationError),
        }, "terminal failed narration envelope finalization failed");
        captureGenerationError(finalizationError, {
          projectId,
          jobId: job.id,
          stage: "failed_envelope_finalization",
          provider: process.env.AI_PROVIDER,
        });
      }
    }
    throw error;
  }
}

function canvasAuditIssues(presentation: PresentationDocument) {
  return presentation.slides.flatMap((slide) =>
      (slide.canvas ? auditSlideCanvas(slide.canvas) : ["canvas is missing"])
        .map((issue) => `slide ${slide.order}: ${issue}`),
    );
}

/**
 * Presentation recovery is permitted only after both expensive upstream
 * artifacts are present.  `prepareGenerationSources` supplies these sources
 * from the persisted mandatory snapshot for an envelope-backed presentation
 * job, so this check is intentionally local and has no provider side effects.
 */
export function hasAcceptedNarrationRecoveryArtifacts(
  project: { id: string; title: string; prompt: string; scenario: string; level: string; mode: string; slideCount: number },
  sources: Source[],
  narrationText: string,
) {
  const narration = assessFullNarrationDocument(narrationText, project);
  return narration.isAccepted
    && sources.length >= 3
    && sources.every((source) => source.type === "WEB" && Boolean(source.url?.trim()) && Boolean(source.excerpt?.trim()));
}

async function presentationRecoveryReason(costEnvelopeId: string) {
  try {
    const envelope = await getPrisma().costEnvelope.findUnique({
      where: { id: costEnvelopeId },
      select: { status: true },
    });
    if (!envelope) return "presentation_recovery_envelope_unavailable";
    return envelope.status === "active" ? null : `presentation_recovery_envelope_${envelope.status}`;
  } catch {
    // An unreadable lineage is not authorization to spend again. Keep the
    // diagnostic stable and let the existing terminal path preserve it.
    return "presentation_recovery_envelope_unavailable";
  }
}

export function repairPresentationLayout(presentation: PresentationDocument): PresentationDocument {
  const shortestCompleteSentence = (slide: PresentationDocument["slides"][number]) => {
    const candidates = [
      slide.thesis,
      ...slide.bullets,
      ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content]),
      slide.speakerNotes,
    ]
      .flatMap((value) => String(value || "").match(/[^.!?]+[.!?]+/g) || [])
      .map((value) => value.trim())
      .filter(Boolean)
      .sort((left, right) => left.length - right.length);
    return candidates.find((value) => value.length <= 220) || candidates[0] || slide.title;
  };

  const repaired = ensureEditableCanvas({
    ...presentation,
    // The recovery path must not carry a cramped theme or an AI-selected
    // direction into its second layout pass.  Those directions can select an
    // editorial canvas with fixed text slots again, which turns a recoverable
    // overflow into a failed paid generation.  Preserve the slide content and
    // narration, but use the roomiest deterministic canvas family.
    presentationTheme: PREMIUM_PRESENTATION_THEMES.academicClean,
    designBrief: undefined,
    slides: presentation.slides.map((slide) => ({
      ...slide,
      layout: "statement",
      thesis: shortestCompleteSentence(slide),
      bullets: [],
      blocks: [],
      // An image is optional decoration. A local safe deck must never retain
      // an unfulfilled image requirement after image search or download fails.
      visual: { ...slide.visual, type: slide.visual.type === "image" ? "schema" : slide.visual.type, image: undefined },
      canvas: undefined,
    })),
  });

  // `ensureEditableCanvas` has already calculated the smallest readable font
  // size.  A fallback slide must not advertise another automatic shrink at
  // that floor: the audit correctly treats that promise as unsafe even when
  // the fitted text itself is inside its slot.
  return {
    ...repaired,
    slides: repaired.slides.map((slide) => ({
      ...slide,
      canvas: slide.canvas
        ? {
          ...slide.canvas,
          elements: slide.canvas.elements.map((element) =>
            element.type === "text" ? { ...element, autoFit: false } : element,
          ),
        }
        : slide.canvas,
    })),
  };
}

/**
 * Last-resort local canvas for a presentation whose narration is already
 * accepted.  It deliberately has two wide, fixed text slots and no optional
 * visuals, so a faulty provider response or a theme-specific geometry cannot
 * send the user back to the script-review failure state.
 */
export function buildEmergencyReadablePresentation(presentation: PresentationDocument): PresentationDocument {
  const compactVisibleText = (value: string, maximum: number, fallback: string) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return fallback;
    if (text.length <= maximum) return text;
    const sentence = text.split(/(?<=[.!?])\s+/u).find((part) => part.length <= maximum && part.trim());
    if (sentence) return sentence.trim();
    const words = text.split(/\s+/u);
    const compact = words.reduce<string[]>((result, word) => {
      const candidate = [...result, word].join(" ");
      return candidate.length <= maximum ? [...result, word] : result;
    }, []).join(" ");
    return compact || fallback;
  };
  const fallbackLayouts = ["statement", "two-column", "comparison", "process"] as const;
  return {
    ...presentation,
    presentationTheme: PREMIUM_PRESENTATION_THEMES.academicClean,
    designBrief: undefined,
    // Keep the canonical document, notes and script in lockstep after the
    // emergency canvas is assembled from accepted narration.
    generatedText: presentation.slides.map((slide) => `\u0421\u043b\u0430\u0439\u0434 ${slide.order}: ${slide.title}\n${slide.speakerNotes}`).join("\n\n"),
    speechScript: presentation.slides.map((slide) => ({ slideOrder: slide.order, slideTitle: slide.title, text: slide.speakerNotes })),
    slides: presentation.slides.map((slide) => {
      const title = compactVisibleText(slide.title, 90, `Слайд ${slide.order}`);
      // The provider/local projection may contain a weak thesis even when the
      // accepted narration is sound. Always derive this visible claim from the
      // canonical narration, not from the rejected presentation text.
      const thesis = compactVisibleText(slide.speakerNotes || slide.thesis, 180, title);
      const background = "#F8FAFC";
      return {
        ...slide,
        title,
        layout: fallbackLayouts[(slide.order - 1) % fallbackLayouts.length],
        thesis,
        // The emergency canvas renders one complete claim per slide. Optional
        // bullets are more likely to become fragments when projected from a
        // long narration; the full evidence remains in speaker notes.
        bullets: [],
        blocks: [],
        visual: { type: "schema", title: `Схема: ${title}`, description: `Схема показывает: ${thesis}`, leftLabel: "", rightLabel: "", items: [], rows: [] },
        canvas: {
          version: 2,
          width: 1280,
          height: 720,
          background,
          elements: [
            { id: `${slide.id}-background`, type: "shape", shape: "rect", x: 0, y: 0, w: 1280, h: 720, rotation: 0, zIndex: 0, opacity: 1, locked: true, fill: background, stroke: background, strokeWidth: 0 },
            { id: `${slide.id}-title`, type: "text", role: "title", typographyRole: "slideTitle", x: 96, y: 84, w: 1088, h: 88, rotation: 0, zIndex: 2, opacity: 1, locked: false, text: title, runs: [{ text: title }], fontSize: 36, autoFit: false, fontFamily: "Arial", color: "#111827", bold: true, italic: false, underline: false, align: "center", valign: "middle" },
            { id: `${slide.id}-body`, type: "text", role: "body", typographyRole: "body", x: 130, y: 230, w: 1020, h: 250, rotation: 0, zIndex: 2, opacity: 1, locked: false, text: thesis, runs: [{ text: thesis }], fontSize: 28, autoFit: false, fontFamily: "Arial", color: "#334155", bold: false, italic: false, underline: false, align: "center", valign: "middle" },
            { id: `${slide.id}-custom-canvas-marker`, type: "shape", shape: "rect", x: 0, y: 0, w: 1, h: 1, rotation: 0, zIndex: 0, opacity: 0, locked: true, fill: background, stroke: background, strokeWidth: 0 },
          ],
        },
      };
    }),
  };
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
  title?: string | null;
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
}, options: { refreshWeb?: boolean; costEnvelopeId?: string } = {}) {
  // Requirements-driven projects may use the web for user-approved decorative
  // images, but never as factual grounding. Keep that boundary server-side so
  // a legacy `with_sources` mode cannot accidentally trigger Tavily research.
  const refreshWeb = project.workflow === "requirements_driven" ? false : options.refreshWeb ?? true;
  // Staging can explicitly validate the one-job accepted-speech path without
  // inventing a WEB source snapshot. This remains opt-in so production keeps
  // the mandatory snapshot contract for ordinary presentation generation.
  const allowAcceptedSpeechWithoutSourceSnapshot = process.env.ALLOW_PRESENTATION_WITHOUT_SOURCE_SNAPSHOT === "true"
    && !refreshWeb
    && Boolean(project.speechDraft?.trim());
  const sources: Source[] = [];
  const storedWebSources: Source[] = [];

  if (options.costEnvelopeId) {
    const envelope = await getPrisma().costEnvelope.findUnique({
      where: { id: options.costEnvelopeId },
      select: { sourceSnapshot: true, policySnapshot: true },
    });
    const snapshot = parseMandatorySourceSnapshot(envelope?.sourceSnapshot);
    if (snapshot) return snapshotSources(snapshot);
    if (!refreshWeb && !allowAcceptedSpeechWithoutSourceSnapshot) {
      throw new Error("Mandatory source snapshot is unavailable for this generation run");
    }
  }

  for (const source of project.sources) {
    if (source.included === false) continue;
    if (source.type === "WEB") {
      const storedSource = {
        id: source.id,
        label: source.label,
        type: source.type,
        size: source.size,
        excerpt: source.excerpt,
        url: source.url || undefined,
        included: true,
      } satisfies Source;
      if (!refreshWeb) {
        sources.push(storedSource);
      } else {
        storedWebSources.push(storedSource);
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

    try {
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
    } catch (error) {
      // A damaged upload or a temporary object-storage outage is not a reason
      // to discard an already approved speech. Reuse the last extracted copy
      // when available and otherwise continue with the remaining sources and
      // the accepted-narration fallback below.
      captureGenerationError(error, {
        projectId: project.id,
        stage: "researching",
        provider: "source_storage",
      });
      logger.warn({ projectId: project.id, sourceId: source.id, sourceLabel: source.label, fallback: source.excerpt || source.text ? "cached_source_text" : "skip_unreadable_source", ...errorLogFields(error) }, "source extraction failed; continuing generation");
      const cached = source.excerpt || makeExcerpt(source.text, project.prompt);
      if (cached) {
        sources.push({
          id: source.id,
          label: source.label,
          type: source.type,
          size: source.size,
          objectKey: source.objectKey || undefined,
          excerpt: cached,
          url: source.url || undefined,
          included: true,
        });
      }
    }
  }

  if (options.costEnvelopeId && refreshWeb) {
    const prisma = getPrisma();
    const envelope = await prisma.costEnvelope.findUniqueOrThrow({ where: { id: options.costEnvelopeId }, select: { policySnapshot: true } });
    const sourceBudgetRub = String((envelope.policySnapshot as { buckets?: { sources?: string } }).buckets?.sources || "");
    const perAttemptRub = "0.50000000";
    const maxAttempts = Math.max(1, Math.min(3, Math.floor(Number(sourceBudgetRub) / Number(perAttemptRub))));
    const refinements = ["", "официальные данные исследования", "аналитика история технология"];
    const sourcesByUrl = new Map<string, Source>();

    for (let attempt = 0; attempt < maxAttempts && sourcesByUrl.size < 3; attempt += 1) {
      const reservationKey = `${options.costEnvelopeId}:mandatory-source-search:${attempt + 1}`;
      const reservation = await reserveCostEnvelope({
        envelopeId: options.costEnvelopeId,
        idempotencyKey: reservationKey,
        bucket: "sources",
        stage: "mandatory_source_search",
        amountRub: perAttemptRub,
      });
      if (reservation.status !== "reserved") throw new Error("Mandatory source research is unavailable for this generation run");
      // A retained reservation belongs to another worker attempt. Never
      // issue the same paid query concurrently.
      if (reservation.idempotent) throw new Error("Mandatory source research is already in progress for this generation run");
      try {
        const result = await searchWebSources({
          prompt: project.prompt,
          title: project.title,
          researchAngle: refinements[attempt],
          costEnvelopeRub: perAttemptRub,
        });
        result.forEach((source) => {
          if (source.url && !sourcesByUrl.has(source.url)) sourcesByUrl.set(source.url, source);
        });
        const isLastAttempt = attempt === maxAttempts - 1;
        await settleCostEnvelope({
          envelopeId: options.costEnvelopeId,
          idempotencyKey: reservationKey,
          actualRub: perAttemptRub,
          ...(sourcesByUrl.size < 3 && isLastAttempt
            ? { reason: "mandatory_source_search_insufficient", exhaustEnvelope: true }
            : sourcesByUrl.size < 3
              ? { reason: "mandatory_source_search_refining" }
              : {}),
        });
      } catch {
        // Retry bounded provider failures from the next independently
        // reserved slot. The exact provider payload stays out of telemetry.
        await failCostEnvelope({
          envelopeId: options.costEnvelopeId,
          idempotencyKey: reservationKey,
          reason: "mandatory_source_search_failed",
          exhaustEnvelope: attempt + 1 >= maxAttempts,
        }).catch(() => undefined);
        if (attempt + 1 < maxAttempts) continue;
        const safeFailure = new Error("mandatory_source_search_provider_failure");
        captureGenerationError(safeFailure, {
          projectId: project.id,
          stage: "researching",
          provider: process.env.WEB_SEARCH_PROVIDER || "tavily",
        });
        throw safeFailure;
      }
    }
    const webSources = [...sourcesByUrl.values()];
    const snapshotCandidates: Source[] = [];
    for (const source of webSources.slice(0, 4)) {
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

      snapshotCandidates.push({
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
    const snapshot = createMandatorySourceSnapshot(snapshotCandidates);
    if (!snapshot) {
      throw new Error("Mandatory source research did not return enough relevant sources");
    }
    await prisma.costEnvelope.update({ where: { id: options.costEnvelopeId }, data: { sourceSnapshot: snapshot } });
    return snapshotSources(snapshot);
  }

  if (refreshWeb && (!sources.length || project.mode === "with_sources")) {
    const prisma = getPrisma();
    let webSources: Source[];
    try {
      webSources = await searchWebSources({ prompt: project.prompt, title: project.title });
    } catch (error) {
      captureGenerationError(error, { projectId: project.id, stage: "researching", provider: process.env.WEB_SEARCH_PROVIDER || "tavily" });
      if (sources.length || storedWebSources.length) return [...sources, ...storedWebSources];
      throw error;
    }
    await prisma.source.deleteMany({ where: { projectId: project.id, type: "WEB" } });
    for (const source of webSources) {
      const created = await prisma.source.create({ data: { projectId: project.id, label: source.label, type: source.type, excerpt: source.excerpt, text: source.excerpt, url: source.url, included: true } });
      sources.push({ id: created.id, label: created.label, type: created.type, size: created.size, objectKey: created.objectKey || undefined, excerpt: created.excerpt, url: created.url || undefined, included: true });
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

  // Web research is optional grounding. When every search result is rejected,
  // let the new job continue from the user's own brief instead of inventing a
  // WEB source or failing solely because Tavily returned poor matches.
  if (!sources.length && project.prompt.trim()) {
    const text = cleanText(project.prompt).slice(0, 9000);
    sources.push({
      id: `${project.id}-project-prompt`,
      label: "Project brief",
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
