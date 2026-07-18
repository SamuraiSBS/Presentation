import { z } from "zod";
import {
  conflictKindSchema,
  conflictStateSchema,
  contentPlaceholderSchema,
  factEvidenceSchema,
  requirementPrioritySchema,
  sourceRoleSchema,
} from "./schemas.js";

const identifierSchema = z.string().trim().min(1).max(128);
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const complianceItemResultSchema = z.enum([
  "satisfied",
  "partial",
  "unsatisfied",
  "ignored",
  "needs_review",
]);
export type ComplianceItemResult = z.infer<typeof complianceItemResultSchema>;

export const complianceReportStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export type ComplianceReportStatus = z.infer<typeof complianceReportStatusSchema>;

export const compliancePdfStatusSchema = z.enum(["not_requested", "queued", "processing", "ready", "failed"]);
export type CompliancePdfStatus = z.infer<typeof compliancePdfStatusSchema>;

export const semanticComplianceStatusSchema = z.enum(["complete", "failed", "not_run"]);
export type SemanticComplianceStatus = z.infer<typeof semanticComplianceStatusSchema>;

export const complianceEvidenceSchema = z
  .object({
    slideId: identifierSchema.optional(),
    slideOrder: z.number().int().min(1).max(20).optional(),
    matchedTextFragment: z.string().trim().min(1).max(1_000).optional(),
    factIds: z.array(identifierSchema).max(100).default([]),
    requirementIds: z.array(identifierSchema).max(100).default([]),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.slideId === undefined && evidence.slideOrder === undefined && evidence.matchedTextFragment === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Compliance evidence needs a slide or a matched text fragment",
      });
    }
  });
export type ComplianceEvidence = z.infer<typeof complianceEvidenceSchema>;

export const complianceItemSchema = z
  .object({
    id: identifierSchema,
    checkKey: z.string().trim().min(1).max(240),
    requirementId: identifierSchema.optional(),
    priority: requirementPrioritySchema,
    result: complianceItemResultSchema,
    deterministicResult: complianceItemResultSchema.optional(),
    semanticResult: complianceItemResultSchema.optional(),
    reason: z.string().trim().min(1).max(2_000),
    evidence: z.array(complianceEvidenceSchema).max(100).default([]),
  })
  .strict()
  .superRefine((item, context) => {
    if (!item.deterministicResult && !item.semanticResult) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Compliance item needs a deterministic or semantic result" });
    }
    if (item.deterministicResult === "unsatisfied" && item.result !== "unsatisfied") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result"],
        message: "Semantic evaluation cannot override a deterministic failure",
      });
    }
    if (item.deterministicResult === "partial" && item.result === "satisfied") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result"],
        message: "Semantic evaluation cannot upgrade a deterministic partial result",
      });
    }
    if (item.deterministicResult === "ignored" && item.result !== "ignored") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["result"], message: "Ignored requirements stay ignored" });
    }
    if (
      item.semanticResult &&
      (item.semanticResult === "satisfied" || item.semanticResult === "partial") &&
      item.evidence.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "Positive semantic results require evidence",
      });
    }
  });
export type ComplianceItem = z.infer<typeof complianceItemSchema>;

export const compliancePrioritySummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    satisfied: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    unsatisfied: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((summary, context) => {
    const itemTotal = summary.satisfied + summary.partial + summary.unsatisfied + summary.ignored + summary.needsReview;
    if (itemTotal !== summary.total) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["total"], message: "Summary counts must add up to total" });
    }
  });
export type CompliancePrioritySummary = z.infer<typeof compliancePrioritySummarySchema>;

export const complianceCountsSchema = z
  .object({
    required: compliancePrioritySummarySchema,
    recommended: compliancePrioritySummarySchema,
    preference: compliancePrioritySummarySchema,
  })
  .strict();
export type ComplianceCounts = z.infer<typeof complianceCountsSchema>;

export const complianceConflictSnapshotSchema = z
  .object({
    conflictId: identifierSchema,
    kind: conflictKindSchema,
    state: conflictStateSchema,
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type ComplianceConflictSnapshot = z.infer<typeof complianceConflictSnapshotSchema>;

export const complianceFactProvenanceSchema = z
  .object({
    factId: identifierSchema,
    statement: z.string().trim().min(1).max(2_000),
    evidence: z.array(factEvidenceSchema).min(1).max(50),
  })
  .strict();
export type ComplianceFactProvenance = z.infer<typeof complianceFactProvenanceSchema>;

export const complianceImageProvenanceSchema = z
  .object({
    sourceId: identifierSchema,
    role: sourceRoleSchema,
    provider: z.enum(["user", "repository", "archive", "tavily"]),
    sourceUrl: z.string().url().optional(),
    slideIds: z.array(identifierSchema).max(20).default([]),
    evidenceRole: z.boolean().default(false),
    label: z.string().trim().max(240).default(""),
  })
  .strict()
  .superRefine((image, context) => {
    if (image.provider === "tavily" && !image.sourceUrl) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceUrl"], message: "Tavily image needs sourceUrl" });
    }
    if (image.provider === "tavily" && image.evidenceRole) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRole"],
        message: "Web images cannot be project evidence",
      });
    }
  });
export type ComplianceImageProvenance = z.infer<typeof complianceImageProvenanceSchema>;

export const complianceTimingOverloadSchema = z
  .object({
    slideId: identifierSchema,
    slideOrder: z.number().int().min(1).max(20),
    allocatedSeconds: z.number().int().positive(),
    estimatedSeconds: z.number().int().positive(),
    overflowSeconds: z.number().int().positive(),
  })
  .strict()
  .superRefine((overload, context) => {
    if (overload.estimatedSeconds - overload.allocatedSeconds !== overload.overflowSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overflowSeconds"],
        message: "overflowSeconds must equal estimatedSeconds minus allocatedSeconds",
      });
    }
  });
export type ComplianceTimingOverload = z.infer<typeof complianceTimingOverloadSchema>;

export const complianceReportDiffSchema = z
  .object({
    fixedRequirementIds: z.array(identifierSchema).max(500).default([]),
    regressedRequirementIds: z.array(identifierSchema).max(500).default([]),
    newPlaceholderIds: z.array(identifierSchema).max(500).default([]),
    resolvedPlaceholderIds: z.array(identifierSchema).max(500).default([]),
  })
  .strict()
  .default({
    fixedRequirementIds: [],
    regressedRequirementIds: [],
    newPlaceholderIds: [],
    resolvedPlaceholderIds: [],
  });
export type ComplianceReportDiff = z.infer<typeof complianceReportDiffSchema>;

export const complianceReportDocumentSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    reportId: identifierSchema,
    workspaceId: identifierSchema,
    presentationRevision: z.number().int().positive(),
    analysisRevision: z.number().int().nonnegative(),
    planRevision: z.number().int().nonnegative(),
    checkedAt: isoDateTimeSchema,
    semanticStatus: semanticComplianceStatusSchema,
    counts: complianceCountsSchema,
    items: z.array(complianceItemSchema).max(1_000),
    placeholders: z.array(contentPlaceholderSchema).max(1_000).default([]),
    conflicts: z.array(complianceConflictSnapshotSchema).max(500).default([]),
    factProvenance: z.array(complianceFactProvenanceSchema).max(500).default([]),
    imageProvenance: z.array(complianceImageProvenanceSchema).max(500).default([]),
    timingOverloads: z.array(complianceTimingOverloadSchema).max(20).default([]),
    diff: complianceReportDiffSchema,
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  })
  .strict();
export type ComplianceReportDocument = z.infer<typeof complianceReportDocumentSchema>;

export const complianceReportSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    status: complianceReportStatusSchema,
    presentationRevision: z.number().int().positive(),
    analysisRevision: z.number().int().nonnegative(),
    planRevision: z.number().int().nonnegative(),
    document: complianceReportDocumentSchema.nullable().default(null),
    counts: complianceCountsSchema.nullable().default(null),
    pdfStatus: compliancePdfStatusSchema.default("not_requested"),
    pdfObjectKey: z.string().trim().min(1).max(1_000).nullable().default(null),
    error: z.string().max(2_000).nullable().default(null),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (report.status === "ready" && (!report.document || !report.counts)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Ready compliance report needs document and counts" });
    }
    if (report.document && report.document.reportId !== report.id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["document", "reportId"], message: "Report IDs do not match" });
    }
    if (report.document && report.document.presentationRevision !== report.presentationRevision) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["document", "presentationRevision"],
        message: "Presentation revisions do not match",
      });
    }
    if (report.pdfStatus === "ready" && !report.pdfObjectKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pdfObjectKey"], message: "Ready PDF needs object key" });
    }
  });
export type ComplianceReport = z.infer<typeof complianceReportSchema>;

export const complianceReportSummarySchema = z
  .object({
    id: identifierSchema,
    status: complianceReportStatusSchema,
    presentationRevision: z.number().int().positive(),
    analysisRevision: z.number().int().nonnegative(),
    planRevision: z.number().int().nonnegative(),
    checkedAt: isoDateTimeSchema.nullable(),
    counts: complianceCountsSchema.nullable(),
    hasBlockingIssues: z.boolean(),
    stale: z.boolean(),
    pdfStatus: compliancePdfStatusSchema,
  })
  .strict();
export type ComplianceReportSummary = z.infer<typeof complianceReportSummarySchema>;

export const defenseExportWarningCodeSchema = z.enum([
  "unresolved_required_issues",
  "unresolved_semantic_issues",
  "unresolved_conflicts",
  "unresolved_placeholders",
  "missing_compliance_report",
  "stale_compliance_report",
]);
export type DefenseExportWarningCode = z.infer<typeof defenseExportWarningCodeSchema>;

export const defenseExportWarningSchema = z
  .object({
    code: defenseExportWarningCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    count: z.number().int().nonnegative().default(1),
  })
  .strict();
export type DefenseExportWarning = z.infer<typeof defenseExportWarningSchema>;

export const defenseExportPreflightSchema = z
  .object({
    allowed: z.boolean(),
    presentationRevision: z.number().int().positive(),
    complianceReportId: identifierSchema.nullable().default(null),
    preflightToken: z.string().trim().min(16).max(2_000).nullable().default(null),
    warnings: z.array(defenseExportWarningSchema).max(100).default([]),
  })
  .strict()
  .superRefine((preflight, context) => {
    if (!preflight.allowed && preflight.warnings.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["warnings"], message: "Blocked export needs warnings" });
    }
    if (!preflight.allowed && !preflight.preflightToken) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["preflightToken"], message: "Blocked export needs token" });
    }
  });
export type DefenseExportPreflight = z.infer<typeof defenseExportPreflightSchema>;
