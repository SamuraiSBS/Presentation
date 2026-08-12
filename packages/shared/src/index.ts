export { adminPeriodSchema, adminTimeRangeSchema, adminListQuerySchema, adminMoneySchema, adminMetricSchema, adminOverviewSchema, adminUserRowSchema, adminUsersResponseSchema, adminUserDetailSchema, adminReasonSchema, adminPlanOverrideSchema, adminActionResultSchema } from "./admin/schemas.js";
export type { AdminPeriod, AdminTimeRange, AdminListQuery, AdminMoney, AdminOverview, AdminUserRow, AdminUsersResponse, AdminUserDetail, AdminPlanOverrideInput, AdminActionResult } from "./admin/schemas.js";
export { planCodeSchema, planLimits } from "./billing/limits.js";
export type { PlanCode } from "./billing/limits.js";
export { scenarioSchema, projectStatusSchema, projectAccessRoleSchema, projectMemberRoleSchema, folderColorSchema, jobStatusSchema, sourceSchema, updateSourceReviewInputSchema, sourceRefSchema } from "./projects/schemas.js";
export type { Scenario, ProjectStatus, ProjectAccessRole, ProjectMemberRole, FolderColor, JobStatus, Source, UpdateSourceReviewInput, SourceRef } from "./projects/schemas.js";
export { createProjectInputSchema, folderNameSchema, createFolderInputSchema, updateFolderInputSchema, updateProjectMetadataInputSchema, duplicateProjectInputSchema, createProjectInvitationInputSchema, updateProjectMemberInputSchema, projectListQuerySchema, updateSlideInputSchema, updateNarrationInputSchema, generatePresentationInputSchema } from "./projects/inputs.js";
export type { CreateProjectInput, CreateFolderInput, UpdateFolderInput, UpdateProjectMetadataInput, DuplicateProjectInput, CreateProjectInvitationInput, UpdateProjectMemberInput, ProjectListQuery, UpdateSlideInput, UpdateNarrationInput, GeneratePresentationInput } from "./projects/inputs.js";
export { exportTypeSchema, exportStatusSchema, exportWarningAcknowledgementSchema, createExportInputSchema } from "./exports/schemas.js";
export type { ExportType, ExportStatus, ExportWarningAcknowledgement, CreateExportInput } from "./exports/schemas.js";
export { exportPreflightFormatSchema, exportPreflightSlideIssueSchema, exportPreflightReportSchema } from "./exports/preflight.js";
export type { ExportPreflightFormat, ExportPreflightSlideIssue, ExportPreflightReport } from "./exports/preflight.js";
export { EXPORT_FONT_FAMILY, EXPORT_PDF_FONT_STACK, exportFontFamily, exportPdfFontStack } from "./exports/font-policy.js";
export { isoDateTimeSchema, userIdentitySummarySchema, projectSummarySchema, folderSummarySchema, projectMemberSchema, usageSummarySchema, dashboardSummarySchema } from "./projects/summaries.js";
export type { UserIdentitySummary, ProjectSummary, FolderSummary, ProjectMember, UsageSummary, DashboardSummary } from "./projects/summaries.js";
export { slideBlockSchema, slideKindSchema, slideLayoutSchema, visualTypeSchema, slideDefinitionSchema, keyConceptSchema, highlightSchema, presentationThemePresetSchema, presentationThemeMoodSchema, presentationThemeColorSchema, presentationThemeSchema, slideVisualItemSchema, slideVisualRowSchema, slideVisualImageSchema, mermaidDiagramKindSchema, mermaidDiagramSpecSchema, diagramGraphNodeSchema, diagramGraphEdgeSchema, diagramGraphSpecSchema, slideVisualSchema, canvasTextRunSchema, canvasTextElementSchema, canvasImageElementSchema, canvasShapeElementSchema, canvasElementSchema, canvasGradientStopSchema, canvasGradientBlobSchema, canvasBackgroundStyleSchema, slideCanvasSchema, slideSchema, speechScriptItemSchema } from "./presentation/schemas.js";
export type { SlideBlock, SlideKind, SlideLayout, SlideLayoutRequirement, SlideLayoutDefinition, VisualType, SlideDefinition, KeyConcept, Highlight, PresentationThemePreset, PresentationThemeMood, PresentationTheme, SlideVisualItem, SlideVisualRow, SlideVisualImage, MermaidDiagramKind, MermaidDiagramSpec, DiagramGraphNode, DiagramGraphEdge, DiagramGraphSpec, SlideVisual, CanvasTextRun, CanvasTextElement, CanvasImageElement, CanvasShapeElement, CanvasElement, CanvasBackgroundStyle, SlideCanvas, Slide, SpeechScriptItem } from "./presentation/schemas.js";
export { SLIDE_LAYOUT_DEFINITIONS, PRESENTATION_LAYOUT_CAPACITY, slideLayoutDefinition, slideLayoutOptions, presentationLayoutCapacity } from "./presentation/layouts.js";
export type { LayoutCapacity } from "./presentation/layouts.js";
export { generationProgressStageSchema, generationJobKindSchema, entityAssertionSchema, factualTopicProfileSchema, slideNarrativeSchema, deckStorySchema, slideTextPlanSchema, researchBriefSchema, sceneTextModeSchema, designBriefSlideDirectionSchema, designBriefSchema, slideBlueprintSchema, visualStrategySchema, diagramSpecSchema, qualityIssueSchema, qualityDimensionScoreSchema, qualityDimensionsSchema, qualityCritiqueSchema, generationPipelineArtifactsSchema, generationBriefSchema } from "./generation/schemas.js";
export type { GenerationProgressStage, GenerationJobKind, EntityAssertion, FactualTopicProfile, SlideNarrative, DeckStory, SlideTextPlan, ResearchBrief, SceneTextMode, DesignBriefSlideDirection, DesignBrief, SlideBlueprint, VisualStrategy, DiagramSpec, QualityIssue, QualityDimensionScore, QualityDimensions, QualityCritique, GenerationPipelineArtifacts, GenerationBrief } from "./generation/schemas.js";
export { generationFailureCategoryValues, safeGenerationRecovery } from "./generation/recovery.js";
export {
  publicNarrationStateValues,
  isPublicNarrationState,
  publicNarrationFailureMessage,
  type PublicNarrationState,
} from "./generation/public-narration-state.js";
export type { GenerationFailureCategory, SafeGenerationRecovery } from "./generation/recovery.js";
export { RUSSIAN_STUDENT_SPEECH_WORDS_PER_MINUTE, RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS, getFloorAwareSpeechTimingSectionBounds, getRussianStudentSpeechTimingBudget, getRussianStudentSpeechSectionBounds, russianSpeechMinutesFromWords } from "./generation/speech-timing.js";
export type { SpeechTimingBudget, SpeechTimingProject, SpeechTimingSectionBounds } from "./generation/speech-timing.js";
export { assessFullSpeechContract } from "./generation/narration-contract.js";
export type { FullSpeechContractAssessment, FullSpeechContractIssue } from "./generation/narration-contract.js";
export { COST_ENVELOPE_POLICY_VERSION, COST_ENVELOPE_LIMIT_RUB, COST_ENVELOPE_BUCKETS, HISTORICAL_COST_ENVELOPE_V5_BUCKETS, AITUNNEL_APPROVED_MODELS, AITUNNEL_PROVIDER_CATALOG_VERSION, AITUNNEL_PROVIDER_CATALOG, standardGenerationCostPolicy, historicalStandardGenerationCostPolicyV5, costEnvelopePolicyIsValid, isApprovedAitunnelModel, aitunnelCatalogSnapshot, aitunnelPriceForApprovedModel } from "./generation/cost-envelope.js";
export type { CostEnvelopeBucket, CostEnvelopePolicy, AitunnelApprovedModel, AitunnelCatalogPrice } from "./generation/cost-envelope.js";
export { presentationSchema } from "./presentation/document.js";
export type { PresentationDocument } from "./presentation/document.js";
export { PREMIUM_PRESENTATION_THEMES, PREMIUM_PRESENTATION_THEME_IDS, resolvePremiumPresentationTheme, resolveThemeFromDesignBrief, resolvePresentationTheme } from "./presentation/themes.js";
export type { PremiumPresentationThemeId } from "./presentation/themes.js";
export { auditSlideCanvas, auditGeneratedCanvasText, auditCanonicalSlideCanvas } from "./presentation/canvas-audit.js";
export { canvasBackgroundCss, slideBackgroundStyle } from "./presentation/canvas-background.js";
export { sortCanvasElements, compactCanvasTextToFit, minimumReadableFontSize, minimumTextColumnWidth, textSlotCapacity } from "./presentation/canvas-helpers.js";
export { presentationTypography, typographyForCanvasText, typographyRoleForCanvasText, canvasTextLineHeight } from "./presentation/typography.js";
export type { PresentationTypographyRole } from "./presentation/typography.js";
export { normalizeSourceRefs, sourceRefFromSource, formatSourceReference, formatImageAttribution, formatSlideAttribution } from "./presentation/attribution.js";
export { ensureEditableCanvas, buildSlideCanvas, hasCustomSlideCanvas, hasMeasurableValue, metricLead, fittedFontSize, compactSourceRefs, assertNever } from "./presentation/canvas-builder.js";
export * from "./defense/schemas.js";
export * from "./defense/inputs.js";
export * from "./defense/presets.js";
export * from "./defense/compliance.js";
export { assertProductionConfiguration, devAuthAllowed, productionConfigurationErrors } from "./runtime/production-config.js";
export type { RuntimeEnvironment } from "./runtime/production-config.js";
export { workerHeartbeatIntervalMs, workerHeartbeatKey, workerHeartbeatMaxAgeMs, workerHeartbeatTtlMs } from "./runtime/health.js";
