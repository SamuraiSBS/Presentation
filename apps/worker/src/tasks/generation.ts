import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import {
  designBriefSchema,
  ensureEditableCanvas,
  PREMIUM_PRESENTATION_THEMES,
  publicNarrationFailureMessage,
  type PresentationDocument,
  type Source,
} from "@studydeck/shared";
import { finalCanvasSafetyIssues, materializePlannedVisuals, productionQualityReleaseResult } from "./presentation-quality.js";
import { preparePresentationForExport } from "./export-preflight.js";
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
import { isManagedSlideCount } from "./presentation/visual-policy.js";
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
  presentationOnlyRecovery?: boolean;
  presentationRetry?: boolean;
  expectedPresentationRevision?: number;
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

  // Keep a blocked operator recovery from briefly changing a ready project to
  // `generating`. This check is deliberately before any state transition; a
  // stale revision or active job is an operational rejection, not a generation
  // failure that should replace the existing presentation.
  if (kind === "presentation" && job.data.presentationOnlyRecovery) {
    try {
      await assertPresentationOnlyRecoveryPreconditions(job);
    } catch (error) {
      job.discard();
      await prisma.generationJob.updateMany({
        where: jobWhere,
        data: {
          status: "failed",
          progressStage: "failed",
          progressLabel: "Восстановление заблокировано",
          progressPercent: 100,
          error: error instanceof Error ? error.message : "presentation_recovery_precondition_failed",
        },
      });
      throw error;
    }
  }

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
      return buildLocalPresentationFromAcceptedNarration(generationProject, sources, speechDraft, { deferMissingPhotoFallback: true });
    };
    // A user-requested presentation retry gets its own active cost envelope
    // and reruns the paid presentation/image stages. Only the operator-only
    // recovery path and legacy non-retry jobs may use a local projection when
    // their envelope is already terminal.
    const recoveryReason = job.data.costEnvelopeId
      ? await presentationRecoveryReason(job.data.costEnvelopeId)
      : null;
    if (job.data.presentationRetry && recoveryReason) {
      throw new Error(`presentation_retry_cost_envelope_unavailable:${recoveryReason}`);
    }
    let usedLocalPresentationRecovery = false;
    let imageEnrichmentPassUsed = false;
    let recoveryMetadata: RecoveryMetadata = {
      recoveryApplied: false,
      replacedImages: 0,
      replacedDiagrams: 0,
    };
    const attemptedSlideOrders = new Set<number>();
    const noteRecovery = (
      stage: RecoveryStage,
      reason: string,
      before?: PresentationDocument,
      after?: PresentationDocument,
    ) => {
      const replacements = before && after ? countRecoveryVisualReplacements(before, after) : { replacedImages: 0, replacedDiagrams: 0 };
      recoveryMetadata = {
        recoveryApplied: true,
        recoveryStage: stage,
        recoveryReason: reason,
        replacedImages: recoveryMetadata.replacedImages + replacements.replacedImages,
        replacedDiagrams: recoveryMetadata.replacedDiagrams + replacements.replacedDiagrams,
      };
    };

    let generatedPresentation: PresentationDocument;
    if (job.data.presentationOnlyRecovery) {
      const error = new Error("presentation_only_recovery");
      generatedPresentation = recoverAcceptedNarration("building_slides", error);
      usedLocalPresentationRecovery = true;
      noteRecovery("accepted_narration", "operator_presentation_only_recovery");
    } else if (recoveryReason) {
      const error = new Error(recoveryReason);
      captureGenerationError(error, { projectId, stage: "building_slides", provider: process.env.AI_PROVIDER });
      generatedPresentation = recoverAcceptedNarration("building_slides", error);
      usedLocalPresentationRecovery = true;
      noteRecovery("accepted_narration", recoveryReason);
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
        if (job.data.presentationRetry) throw error;
        generatedPresentation = recoverAcceptedNarration("building_slides", error);
        usedLocalPresentationRecovery = true;
        noteRecovery("accepted_narration", "provider_presentation_failure");
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
    // Image lookup is one bounded, idempotent pass per generation attempt.
    // Recovery reuses its results and never starts a second paid/search pass.
    let presentationWithImages = presentationWithPlannedVisuals;
    if (!usedLocalPresentationRecovery) {
      await setStage("selecting_visuals");
      presentationWithImages = await enrichPresentationImages(generationProject, presentationWithPlannedVisuals, { attemptedSlideOrders });
      finishStage("selecting_visuals");
      imageEnrichmentPassUsed = true;
    } else if (canRunRecoveryImagePass(job.data.costEnvelopeId, recoveryReason)) {
      await setStage("selecting_visuals");
      presentationWithImages = await enrichPresentationImages(generationProject, presentationWithPlannedVisuals, {
        recovery: true,
        skipSlideOrders: attemptedSlideOrders,
        attemptedSlideOrders,
      });
      finishStage("selecting_visuals");
      imageEnrichmentPassUsed = true;
    }
    const materializedPresentation = materializePlannedVisuals(presentationWithImages, {
      fallbackMissingPhotos: usedLocalPresentationRecovery && isManagedSlideCount(generationProject.slideCount),
    });
    if (usedLocalPresentationRecovery) {
      noteRecovery("accepted_narration", "local_visual_projection", groundedPresentation, materializedPresentation);
    }
    presentationWithImages = materializedPresentation;
    await setStage("polishing");
    // The model may return a schema-valid but geometrically unsafe canvas. A
    // generated presentation is not user-edited yet, so rebuild its canvas
    // from the validated slide content before running the layout audit.
    let presentation = ensureEditableCanvas({
      ...presentationWithImages,
      slides: presentationWithImages.slides.map((slide) => ({ ...slide, canvas: undefined })),
    }, { recovery: usedLocalPresentationRecovery });
    let unsafeCanvases = finalCanvasSafetyIssues(presentation);
    if (unsafeCanvases.length) {
      logger.warn({ projectId, jobId: job.id, fallback: "roomy_local_layout", issueCount: unsafeCanvases.length }, "generated canvas is unsafe; applying local layout recovery");
      const beforeLayoutRecovery = presentation;
      presentation = repairPresentationLayout(presentation);
      noteRecovery("canvas_layout", "unsafe_generated_canvas", beforeLayoutRecovery, presentation);
      unsafeCanvases = finalCanvasSafetyIssues(presentation);
      if (unsafeCanvases.length) {
        const beforeEmergencyRecovery = presentation;
        presentation = buildEmergencyReadablePresentation(presentation);
        noteRecovery("emergency", "unsafe_recovery_canvas", beforeEmergencyRecovery, presentation);
        unsafeCanvases = finalCanvasSafetyIssues(presentation);
      }
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
      gate: "provider_quality",
    }, "provider_quality_released");
    if (release.finalDisposition !== "released") {
      // A schema-valid provider response can still fail the production gate.
      // Re-project only the already accepted narration and snapshot sources;
      // then run the exact same gate again.  Do not use an emergency generic
      // deck here: it would weaken provenance and content integrity.
      const beforeQualityRecovery = presentation;
      let recoveredPresentation = mergeRecoveredVisuals(
        recoverAcceptedNarration("validating", new Error(`provider presentation rejected: ${release.issueCategories.join(", ") || "unspecified quality issue"}`)),
        presentation,
      );
      usedLocalPresentationRecovery = true;
      noteRecovery("accepted_narration", "quality_gate_rejected", beforeQualityRecovery, recoveredPresentation);
      if (canRunRecoveryImagePass(job.data.costEnvelopeId, recoveryReason) && !imageEnrichmentPassUsed) {
        recoveredPresentation = await enrichPresentationImages(generationProject, recoveredPresentation, {
          recovery: true,
          skipSlideOrders: attemptedSlideOrders,
          attemptedSlideOrders,
        });
        imageEnrichmentPassUsed = true;
      }
      recoveredPresentation = materializePlannedVisuals(recoveredPresentation, { fallbackMissingPhotos: true });
      presentation = ensureEditableCanvas({
        ...recoveredPresentation,
        slides: recoveredPresentation.slides.map((slide) => ({ ...slide, canvas: undefined })),
      }, { recovery: true });
      release = productionQualityReleaseResult(presentation, presentation.sources, { ...generationProject, mandatorySourceSnapshot: Boolean(job.data.costEnvelopeId), acceptedNarrationRecovery: true });
      if (release.finalDisposition !== "released") {
        // The first local projection keeps the usual editorial design.  If it
        // still contains provider-shaped generic text or an unfulfillable
        // visual, release the same accepted narration through the intentionally
        // plain, self-contained canvas. This is fully deterministic: no second
        // provider call, source search, or invented claim is allowed here.
        logger.warn({ projectId, jobId: job.id, fallback: "accepted_narration_emergency_readable", issueCategories: release.issueCategories }, "local presentation projection still failed quality gate; applying emergency readable recovery");
        const beforeEmergencyRecovery = presentation;
        presentation = buildEmergencyReadablePresentation(presentation);
        noteRecovery("emergency", "quality_gate_rejected_local_projection", beforeEmergencyRecovery, presentation);
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
      let economicGate = evaluateEconomicReleaseGate({
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
      if (!economicGate.passed && economicGate.categories.includes("canvas_audit")) {
        // The economic gate evaluates the exact persisted document. A local
        // projection can still carry a provider-selected canvas family after
        // the editorial gate has released it, so give it the same bounded
        // roomier layout recovery used by the pre-save canvas audit.
        const beforeEconomicLayoutRecovery = presentation;
        presentation = repairPresentationLayout(presentation);
        noteRecovery("canvas_layout", "economic_canvas_audit", beforeEconomicLayoutRecovery, presentation);
        economicGate = evaluateEconomicReleaseGate({
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
        if (!economicGate.passed && economicGate.categories.includes("canvas_audit")) {
          const beforeEconomicEmergencyRecovery = presentation;
          presentation = buildEmergencyReadablePresentation(presentation);
          noteRecovery("emergency", "economic_canvas_audit", beforeEconomicEmergencyRecovery, presentation);
          economicGate = evaluateEconomicReleaseGate({
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
        }
      }
      logger.info({ projectId, jobId: job.id, stage: "validating", releaseGate: "economic_standard", passed: economicGate.passed, categories: economicGate.categories }, "economic presentation release gate");
      if (!economicGate.passed) throw new EconomicReleaseGateError(economicGate.categories);
    }
    const finalCanvasIssues = finalCanvasSafetyIssues(presentation);
    logger.info({
      projectId,
      jobId: job.id,
      stage: "validating",
      gate: "final_canvas",
      finalAction: finalCanvasIssues.length ? "rejected" : "released",
      issueCount: finalCanvasIssues.length,
      issues: finalCanvasIssues.slice(0, 8),
    }, "final_canvas_released");
    if (finalCanvasIssues.length) throw new Error(`Final canvas gate rejected presentation: ${finalCanvasIssues.slice(0, 8).join("; ")}`);
    presentation = {
      ...presentation,
      productionQualityGate: {
        version: 1,
        capability: "silent-production-quality-gate",
        ...(recoveryMetadata.recoveryApplied ? recoveryMetadata : {}),
      },
    };
    if (job.data.presentationOnlyRecovery) {
      const exportPreflight = await preparePresentationForExport(presentation, {
        format: "pptx",
        project: generationProject,
        readObject: readObjectBuffer,
      });
      if (!exportPreflight.report.passed) {
        throw new Error(`Presentation export preflight rejected recovery: ${exportPreflight.report.slideIssues.flatMap((issue) => issue.categories).join(", ") || "unspecified issue"}`);
      }
      // Persist exactly the document that passed the release and export
      // preflight checks. The old revision remains untouched until this
      // transaction succeeds.
      presentation = exportPreflight.document;
    }
    finishStage("validating");
    await setStage("saving");
    // The release capability, persisted canvas and ready status describe one
    // revision. Do not expose ready if writing that canonical document fails.
    if (job.data.presentationOnlyRecovery) {
      const expectedRevision = job.data.expectedPresentationRevision;
      if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new Error("presentation_recovery_expected_revision_required");
      }
      await prisma.$transaction(async (tx) => {
        const updated = await tx.presentation.updateMany({
          where: { projectId, revision: expectedRevision },
          data: { document: presentation, revision: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw new Error("presentation_recovery_revision_changed_before_save");
        }
        await tx.project.update({ where: { id: projectId }, data: { status: "ready" } });
      });
    } else {
      await prisma.$transaction([
        prisma.presentation.upsert({
          where: { projectId },
          create: { projectId, document: presentation },
          update: { document: presentation, revision: { increment: 1 } },
        }),
        prisma.project.update({ where: { id: projectId }, data: { status: "ready" } }),
      ]);
    }
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

async function assertPresentationOnlyRecoveryPreconditions(job: Job<GenerationJobData>) {
  const expectedRevision = job.data.expectedPresentationRevision;
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("presentation_recovery_expected_revision_required");
  }
  const revision = expectedRevision;
  if (!job.data.generationJobId) {
    throw new Error("presentation_recovery_generation_job_id_required");
  }

  const prisma = getPrisma();
  const project = await prisma.project.findUnique({
    where: { id: job.data.projectId },
    select: { speechDraft: true },
  });
  if (!project) throw new Error("presentation_recovery_project_not_found");
  if (!project.speechDraft?.trim()) throw new Error("presentation_recovery_accepted_speech_required");

  const presentation = await prisma.presentation.findUnique({
    where: { projectId: job.data.projectId },
    select: { revision: true },
  });
  if (!presentation) throw new Error("presentation_recovery_presentation_not_found");
  if (presentation.revision !== revision) {
    throw new Error(`presentation_recovery_revision_mismatch:${presentation.revision}`);
  }

  const activeJob = await prisma.generationJob.findFirst({
    where: {
      projectId: job.data.projectId,
      kind: "presentation",
      status: { in: ["queued", "active"] },
      id: { not: job.data.generationJobId },
    },
    select: { id: true },
  });
  if (activeJob) throw new Error("presentation_recovery_generation_active");
}

function canRunRecoveryImagePass(costEnvelopeId: string | undefined, recoveryReason: string | null) {
  // The worker checks the envelope status before entering this path. A new
  // recovery image pass is therefore allowed only for an explicitly linked,
  // still-active envelope; terminal retries remain fully local.
  return Boolean(costEnvelopeId && !recoveryReason);
}

/**
 * Copies only persisted images from the rejected presentation projection into
 * the accepted-narration projection. Stable slide ids are the sole join key:
 * order/title similarity must never move an asset to another slide.
 */
export function mergeRecoveredVisuals(
  recovered: PresentationDocument,
  rejected: PresentationDocument,
): PresentationDocument {
  const rejectedById = new Map(rejected.slides.map((slide) => [slide.id, slide]));
  return {
    ...recovered,
    slides: recovered.slides.map((slide) => {
      if (slide.visual.image) return slide;
      const rejectedSlide = rejectedById.get(slide.id);
      const image = rejectedSlide?.visual.image;
      if (!image?.objectKey?.trim()) return slide;
      return { ...slide, visual: { ...slide.visual, image } };
    }),
  };
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

  const materialized = materializePlannedVisuals(presentation, { fallbackMissingPhotos: true });
  const repaired = ensureEditableCanvas({
    ...materialized,
    // The recovery path must not carry a cramped theme or an AI-selected
    // direction into its second layout pass.  Those directions can select an
    // editorial canvas with fixed text slots again, which turns a recoverable
    // overflow into a failed paid generation.  Preserve the slide content and
    // narration, but use the roomiest deterministic canvas family.
    presentationTheme: PREMIUM_PRESENTATION_THEMES.studydeckEditorial,
    designBrief: cleanRecoveryDesignBrief(materialized.designBrief, materialized.slides),
    slides: materialized.slides.map((slide) => ({
      ...slide,
      title: compactRecoveryTitle(slide.title),
      layout: recoveryLayoutForSlide(slide),
      thesis: shortestCompleteSentence(slide),
      bullets: slide.bullets.slice(0, 3),
      blocks: slide.blocks.filter((block) => block.type === "bullets").slice(0, 1),
      // An image is optional decoration. A local safe deck must never retain
      // an unfulfilled image requirement after image search or download fails.
      visual: {
        ...slide.visual,
        type: slide.visual.type,
        description: slide.visual.description,
      },
      canvas: undefined,
    })),
  }, { recovery: true });

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
 * accepted. It keeps text compact, preserves safe stored images, and turns
 * missing image plans into grounded local diagrams so recovery stays visual
 * without depending on another provider or network request.
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
  const compactEmergencyBullet = (value: string) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/gu) || [];
    const readable = sentences.find((sentence) => {
      const candidate = sentence.trim();
      return candidate.length <= 130 && candidate.split(/\s+/u).filter(Boolean).length <= 18;
    });
    if (readable) return readable.trim();

    // A reviewed support point can still be just over the renderer limit.
    // Keep a complete, bounded sentence-shaped claim rather than returning a
    // word fragment or moving the same content into a second block.
    const source = (sentences[0] || text).trim();
    const selected: string[] = [];
    for (const word of source.split(/\s+/u).filter(Boolean).slice(0, 18)) {
      const candidate = [...selected, word].join(" ");
      if (candidate.length > 129) break;
      selected.push(word);
    }
    const compact = selected.join(" ").replace(/[.!?]+$/u, "").trim();
    return compact.split(/\s+/u).filter(Boolean).length >= 4 ? `${compact}.` : "";
  };
  const fallbackLayouts = ["statement", "two-column", "comparison", "process"] as const;
  // Keep the last safe visual projection before simplifying the text. Missing
  // photos are converted into grounded local diagrams here, so the emergency
  // path remains visual even when the paid image lookup is unavailable.
  const materialized = materializePlannedVisuals(presentation, { fallbackMissingPhotos: true });
  const emergency = {
    ...materialized,
    presentationTheme: PREMIUM_PRESENTATION_THEMES.studydeckEditorial,
    designBrief: cleanRecoveryDesignBrief(materialized.designBrief, materialized.slides),
    // Keep the canonical document, notes and script in lockstep after the
    // emergency canvas is assembled from accepted narration.
    // The accepted narration is canonical. Emergency layout recovery may
    // shorten the screen title, but it must never rewrite generatedText.
    generatedText: materialized.generatedText,
    speechScript: materialized.slides.map((slide) => ({ slideOrder: slide.order, slideTitle: slide.title, text: slide.speakerNotes })),
    slides: materialized.slides.map((slide) => {
      const title = compactVisibleText(slide.title, 90, `Слайд ${slide.order}`);
      // The provider/local projection may contain a weak thesis even when the
      // accepted narration is sound. Always derive this visible claim from the
      // canonical narration, not from the rejected presentation text.
      const thesis = compactVisibleText(slide.speakerNotes || slide.thesis, 180, title);
      const bullets = [...new Set(slide.bullets
        .map(compactEmergencyBullet)
        .filter((value) => value && value.split(/\s+/u).length >= 4 && /[.!?]$/u.test(value))
        .filter((value) => value !== title && value !== thesis))]
        .slice(0, 3);
      return {
        ...slide,
        title,
        layout: fallbackLayouts[(slide.order - 1) % fallbackLayouts.length],
        thesis,
        // Keep the reviewed support-point projection in the canonical Slide
        // fields. The recovery canvas renders it once; blocks stay empty so
        // the same sentence is not painted a second time.
        bullets,
        blocks: [],
        // Preserve fulfilled images and grounded diagrams. The recovery canvas
        // knows how to render both without depending on a provider response.
        visual: slide.visual.type === "none"
          ? { ...slide.visual, title: "", description: "Text-only emergency recovery surface.", items: [], rows: [] }
          : slide.visual,
        canvas: undefined,
      };
    }),
  };
  const recovered = ensureEditableCanvas({
    ...emergency,
    slides: emergency.slides.map((slide) => ({ ...slide, canvas: undefined })),
  }, { recovery: true });

  return {
    ...recovered,
    productionQualityGate: {
      version: 1,
      capability: "silent-production-quality-gate",
      recoveryApplied: true,
      recoveryStage: "emergency",
      recoveryReason: "unsafe_recovery_canvas",
    },
  };
}

type RecoveryStage = "accepted_narration" | "canvas_layout" | "emergency";
type RecoveryMetadata = {
  recoveryApplied: boolean;
  recoveryStage?: RecoveryStage;
  recoveryReason?: string;
  replacedImages: number;
  replacedDiagrams: number;
};

function recoveryLayoutForSlide(slide: PresentationDocument["slides"][number]) {
  if (slide.slideKind === "title" || slide.slideKind === "section" || slide.slideKind === "summary") return "statement" as const;
  if (slide.visual.image) return "image-focus" as const;
  if (["comparison_diagram", "before_after_table", "pros_cons_table"].includes(slide.visual.type)) return "comparison" as const;
  if (slide.visual.type === "timeline") return "timeline" as const;
  if (["process_diagram", "cause_effect_diagram", "mind_map", "schema"].includes(slide.visual.type)) return "process" as const;
  return "statement" as const;
}

function compactRecoveryTitle(value: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= 48) return text;
  const words = text.split(/\s+/u);
  let result = "";
  for (const word of words) {
    const candidate = result ? `${result} ${word}` : word;
    if (candidate.length > 48) break;
    result = candidate;
  }
  return result || text.slice(0, 48).trim();
}

function cleanRecoveryDesignBrief(
  designBrief: PresentationDocument["designBrief"],
  slides: PresentationDocument["slides"],
  emergency = false,
) {
  if (!designBrief) return undefined;
  return designBriefSchema.parse({
    ...designBrief,
    themeId: "studydeckEditorial",
    themePreset: "minimal",
    mood: "serious",
    slideDirections: designBrief.slideDirections.map((direction) => {
      const slide = slides.find((candidate) => candidate.order === direction.slideOrder);
      if (!slide || slide.slideKind === "summary" || emergency) {
        return {
          ...direction,
          layoutIntent: slide?.slideKind === "summary" ? "summary" : "statement",
          imageStrategy: "none",
          visualPurpose: "text_only",
          sceneTextMode: slide?.slideKind === "summary" ? "takeaway" : "talk_sentences",
        };
      }
      if (slide.visual.image) {
        return {
          ...direction,
          layoutIntent: "split_image_text",
          imageStrategy: "real_photo",
          visualPurpose: "photo",
          sceneTextMode: "visual_labels",
        };
      }
      if (isRecoveryDiagramType(slide.visual.type)) {
        const comparison = ["comparison_diagram", "before_after_table", "pros_cons_table"].includes(slide.visual.type);
        return {
          ...direction,
          layoutIntent: slide.visual.type === "timeline" ? "timeline" : comparison ? "comparison" : "diagram",
          imageStrategy: "diagram",
          visualPurpose: slide.visual.type === "timeline" ? "timeline" : comparison ? "comparison" : "diagram",
          sceneTextMode: "visual_labels",
        };
      }
      return {
        ...direction,
        layoutIntent: "statement",
        imageStrategy: "none",
        visualPurpose: "text_only",
        sceneTextMode: "talk_sentences",
      };
    }),
  });
}

function isRecoveryDiagramType(type: string) {
  return ["process_diagram", "comparison_diagram", "cause_effect_diagram", "before_after_table", "pros_cons_table", "timeline", "mind_map", "schema"].includes(type);
}

function countRecoveryVisualReplacements(before: PresentationDocument, after: PresentationDocument) {
  let replacedImages = 0;
  let replacedDiagrams = 0;
  const beforeByOrder = new Map(before.slides.map((slide) => [slide.order, slide]));
  after.slides.forEach((slide) => {
    const previous = beforeByOrder.get(slide.order);
    if (!previous) return;
    const becameDiagram = isRecoveryDiagramType(slide.visual.type)
      && Boolean(slide.visual.diagram || slide.visual.graph || slide.visual.items.length >= 2 || slide.visual.rows.length >= 2);
    if (becameDiagram && (previous.visual.image || ["image", "illustration"].includes(previous.visual.type))) replacedImages += 1;
    if (becameDiagram && !isRecoveryDiagramType(previous.visual.type)) replacedDiagrams += 1;
  });
  return { replacedImages, replacedDiagrams };
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
    const webSearchProvider = (process.env.WEB_SEARCH_PROVIDER || "tavily").toLowerCase();
    const maxAttempts = webSearchProvider === "aitunnel"
      ? 1
      : Math.max(1, Math.min(3, Math.floor(Number(sourceBudgetRub) / Number(perAttemptRub))));
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
      } catch (error) {
        if (error instanceof Error && error.message === "mandatory_source_search_insufficient") {
          await settleCostEnvelope({
            envelopeId: options.costEnvelopeId,
            idempotencyKey: reservationKey,
            actualRub: perAttemptRub,
            reason: "mandatory_source_search_insufficient",
            exhaustEnvelope: true,
          });
          throw error;
        }
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
    const snapshot = createMandatorySourceSnapshot(snapshotCandidates, new Date(), webSearchProvider === "aitunnel" ? "aitunnel" : "tavily");
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
