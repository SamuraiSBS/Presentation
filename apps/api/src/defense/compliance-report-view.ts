import path from "node:path";
import type { Prisma } from "@prisma/client";
import { complianceReportDocumentSchema } from "@studydeck/shared";

export type ComplianceReportRow = {
  id: string;
  workspaceId: string;
  status: string;
  presentationRevision: number;
  analysisRevision: number;
  planRevision: number;
  document: Prisma.JsonValue;
  requiredSatisfied: number;
  requiredTotal: number;
  recommendedSatisfied: number;
  recommendedTotal: number;
  preferenceSatisfied: number;
  preferenceTotal: number;
  pdfObjectKey: string | null;
  pdfStatus: string | null;
  error: string | null;
  queueJobId?: string | null;
  pdfQueueJobId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DefenseRevisions = {
  presentationRevision: number;
  analysisRevision: number;
  planRevision: number;
};

/** Pure API view for compliance reports; orchestration remains in DefenseService. */
export function reportDetail(report: ComplianceReportRow) {
  const document = complianceReportDocumentSchema.safeParse(report.document);
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    status: report.status,
    presentationRevision: report.presentationRevision,
    analysisRevision: report.analysisRevision,
    planRevision: report.planRevision,
    document: document.success ? document.data : null,
    counts: document.success ? document.data.counts : null,
    pdfStatus: report.pdfStatus ?? "not_requested",
    pdfObjectKey: report.pdfObjectKey,
    error: report.error,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

export function reportSummary(report: ComplianceReportRow, revisions: DefenseRevisions) {
  const detail = reportDetail(report);
  const items = detail.document?.items ?? [];
  return {
    id: detail.id,
    status: detail.status,
    presentationRevision: detail.presentationRevision,
    analysisRevision: detail.analysisRevision,
    planRevision: detail.planRevision,
    checkedAt: detail.document?.checkedAt ?? null,
    counts: detail.counts,
    hasBlockingIssues: items.some((item) => (
      item.priority === "required" && ["partial", "unsatisfied", "needs_review"].includes(item.result)
    )) || Boolean(detail.document?.placeholders.some((item) => !item.resolved))
      || Boolean(detail.document?.conflicts.some((item) => item.state === "unresolved")),
    stale: isReportStale(report, revisions),
    pdfStatus: detail.pdfStatus,
  };
}

export function isReportStale(report: ComplianceReportRow, revisions: DefenseRevisions) {
  return report.presentationRevision !== revisions.presentationRevision
    || report.analysisRevision !== revisions.analysisRevision
    || report.planRevision !== revisions.planRevision;
}

export function safeReportName(objectKey: string) {
  return path.basename(objectKey).replace(/[^\w.-]+/g, "-") || "defense-compliance-report.pdf";
}
