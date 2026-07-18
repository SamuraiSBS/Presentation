import crypto from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import path from "node:path";
import { complianceReportDocumentSchema, type ExportType, planLimits, presentationSchema } from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
import { conflict } from "../errors/api-error.js";
import { enqueueOrRetryJob, needsQueueRecovery } from "../jobs/queue-recovery.js";
import { injectTraceContext, withTraceSpan } from "../observability.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue("exports") private readonly exportsQueue: Queue,
    private readonly access: ProjectAccessService,
  ) {}

  private s3Client?: S3Client;

  async enqueue(
    userId: string,
    projectId: string,
    type: ExportType,
    acknowledgement: ExportWarningAcknowledgement = {},
    _idempotencyKey?: string,
  ) {
    return withTraceSpan("api.export.enqueue", {
      "studydeck.project_id": projectId,
      "studydeck.stage": "generation.export",
      "studydeck.export_type": type,
    }, async () => {
      const access = await this.access.requireViewer(userId, projectId);
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          user: true,
          presentation: true,
          defenseWorkspace: {
            include: {
              complianceReports: { orderBy: { createdAt: "desc" }, take: 1 },
              _count: { select: { conflicts: { where: { state: "unresolved" } } } },
            },
          },
        },
      });
      if (!project || project.userId !== access.project.userId) throw new NotFoundException("Project not found");
      if (!project.presentation) throw new BadRequestException("Generate the presentation before export");

      const allowed = planLimits[project.user.planCode].exports;
      if (!(allowed as readonly string[]).includes(type)) throw new BadRequestException("This export type is not included in your plan");

      if (project.workflow === "requirements_driven" && project.defenseWorkspace) {
        this.requireDefenseAcknowledgement(project, acknowledgement);
      }

      // A rendered file is uniquely determined by project, type and presentation
      // revision. Client request keys must not create duplicate export jobs.
      const requestKey = "auto";
      const existing = await this.prisma.export.findUnique({
        where: {
          projectId_type_presentationRevision_requestKey: {
            projectId,
            type,
            presentationRevision: project.presentation.revision,
            requestKey,
          },
        },
      });
      if (existing && (
        existing.status === "ready"
        || ((existing.status === "queued" || existing.status === "processing")
          && !(await needsQueueRecovery(this.exportsQueue, existing.queueJobId)))
      )) return existing;

      let created = existing;
      if (created) {
        created = await this.prisma.export.update({
          where: { id: created.id },
          data: { status: "queued", objectKey: null, error: null, queueJobId: null },
        });
      } else {
        try {
          created = await this.prisma.export.create({
            data: { projectId, type, presentationRevision: project.presentation.revision, requestKey },
          });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
          const concurrent = await this.prisma.export.findUnique({
            where: {
              projectId_type_presentationRevision_requestKey: {
                projectId,
                type,
                presentationRevision: project.presentation.revision,
                requestKey,
              },
            },
          });
          if (!concurrent) throw error;
          if (
            concurrent.status === "ready"
            || ((concurrent.status === "queued" || concurrent.status === "processing")
              && !(await needsQueueRecovery(this.exportsQueue, concurrent.queueJobId)))
          ) return concurrent;
          created = concurrent;
        }
      }
      let queueJob;
      try {
        queueJob = await enqueueOrRetryJob(
          this.exportsQueue,
          "export-presentation",
          { exportId: created.id, projectId, type, traceContext: injectTraceContext() },
          { attempts: 2, jobId: `presentation-export-${created.id}` },
        );
      } catch (error) {
        await this.prisma.export.update({
          where: { id: created.id },
          data: { status: "failed", error: "Не удалось поставить экспорт в очередь" },
        });
        throw error;
      }
      return this.prisma.export.update({ where: { id: created.id }, data: { queueJobId: queueJob.id } });
    });
  }

  private requireDefenseAcknowledgement(
    project: DefenseExportProject,
    acknowledgement: ExportWarningAcknowledgement,
  ) {
    const workspace = project.defenseWorkspace;
    if (!workspace || !project.presentation) return;
    const latestReport = workspace.complianceReports[0] ?? null;
    const reportCurrent = Boolean(
      latestReport
      && latestReport.status === "ready"
      && latestReport.presentationRevision === project.presentation.revision
      && latestReport.analysisRevision === workspace.analysisRevision
      && latestReport.planRevision === workspace.planRevision,
    );
    const placeholderCount = unresolvedPlaceholderCount(project.presentation.document);
    const issues: DefenseExportIssue[] = [];
    if (!latestReport) {
      issues.push({ code: "missing_compliance_report", message: "Презентация ещё не проверена по ТЗ", count: 1 });
    } else if (!reportCurrent) {
      issues.push({ code: "stale_compliance_report", message: "Отчёт по ТЗ устарел или ещё не завершён", count: 1 });
    }
    const requiredIssueCount = latestReport ? requiredBlockingIssueCount(latestReport) : 0;
    if (requiredIssueCount) {
      issues.push({
        code: "unresolved_required_issues",
        message: "Есть невыполненные обязательные требования",
        count: requiredIssueCount,
      });
    }
    const needsReviewCount = latestReport ? semanticNeedsReviewCount(latestReport.document) : 0;
    if (needsReviewCount) {
      issues.push({
        code: "unresolved_semantic_issues",
        message: "Часть требований требует ручной проверки",
        count: needsReviewCount,
      });
    }
    if (workspace._count.conflicts) {
      issues.push({
        code: "unresolved_conflicts",
        message: "Есть неразрешённые противоречия",
        count: workspace._count.conflicts,
      });
    }
    if (placeholderCount) {
      issues.push({
        code: "unresolved_placeholders",
        message: "В презентации остались незаполненные данные",
        count: placeholderCount,
      });
    }
    if (!issues.length) return;

    const preflightToken = this.defensePreflightToken(project, issues);
    const details = {
      requiresAcknowledgement: true,
      allowed: false,
      projectId: project.id,
      presentationRevision: project.presentation.revision,
      complianceReportId: reportCurrent ? latestReport?.id ?? null : null,
      reportStale: Boolean(latestReport && !reportCurrent),
      preflightToken,
      warnings: issues,
      issues,
    };
    if (!acknowledgement.acknowledgeWarnings) {
      throw conflict(
        "DEFENSE_EXPORT_WARNING",
        "Экспорт содержит нерешённые проблемы защиты",
        details,
      );
    }
    if (acknowledgement.expectedPresentationRevision !== project.presentation.revision) {
      throw conflict(
        "DEFENSE_EXPORT_ACK_STALE",
        "Презентация изменилась после подтверждения предупреждения",
        details,
      );
    }
    const reportAcknowledged = Boolean(
      reportCurrent
      && acknowledgement.complianceReportId
      && acknowledgement.complianceReportId === latestReport?.id,
    );
    const tokenAcknowledged = Boolean(
      acknowledgement.preflightToken
      && safeTokenEqual(acknowledgement.preflightToken, preflightToken),
    );
    if (!reportAcknowledged && !tokenAcknowledged) {
      throw conflict(
        "DEFENSE_EXPORT_ACK_INVALID",
        "Подтверждение предупреждения устарело или не относится к этой презентации",
        details,
      );
    }
  }

  private defensePreflightToken(project: DefenseExportProject, issues: readonly DefenseExportIssue[]) {
    const secret = this.config.getOrThrow<string>("INTERNAL_API_TOKEN");
    const workspace = project.defenseWorkspace;
    const payload = [
      project.id,
      project.presentation?.revision ?? 0,
      workspace?.analysisRevision ?? 0,
      workspace?.planRevision ?? 0,
      workspace?.complianceReports[0]?.id ?? "none",
      ...issues.map((item) => `${item.code}:${item.count ?? 0}`).sort(),
    ].join("|");
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  }

  async get(userId: string, projectId: string, exportId: string) {
    await this.access.requireViewer(userId, projectId);
    const item = await this.prisma.export.findFirst({ where: { id: exportId, projectId } });
    if (!item) throw new NotFoundException("Export not found");
    return item;
  }

  async getDownloadUrl(userId: string, projectId: string, exportId: string) {
    const item = await this.get(userId, projectId, exportId);
    if (item.status !== "ready" || !item.objectKey) throw new BadRequestException("Export is not ready");
    const presentation = await this.prisma.presentation.findUnique({ where: { projectId }, select: { revision: true } });
    if (!presentation || item.presentationRevision !== presentation.revision) {
      throw new BadRequestException("Экспорт устарел после редактирования презентации. Подготовьте новый файл.");
    }

    const url = await getSignedUrl(
      this.getS3(),
      new GetObjectCommand({
        Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
        Key: item.objectKey,
        ResponseContentDisposition: `attachment; filename="${safeDownloadName(item.objectKey)}"`,
      }),
      { expiresIn: 60 * 5 },
    );

    return { url };
  }

  private getS3() {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        region: this.config.get<string>("S3_REGION") || "us-east-1",
        endpoint: this.config.get<string>("S3_ENDPOINT"),
        forcePathStyle: this.config.get<string>("S3_FORCE_PATH_STYLE") !== "false",
        credentials: {
          accessKeyId: this.config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
          secretAccessKey: this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY"),
        },
      });
    }

    return this.s3Client;
  }
}

export type ExportWarningAcknowledgement = {
  acknowledgeWarnings?: boolean;
  complianceReportId?: string;
  preflightToken?: string;
  expectedPresentationRevision?: number;
};

type DefenseExportIssue = {
  code: string;
  message: string;
  count?: number;
};

type DefenseExportProject = {
  id: string;
  presentation: { revision: number; document: unknown } | null;
  defenseWorkspace: {
    analysisRevision: number;
    planRevision: number;
    complianceReports: Array<{
      id: string;
      status: string;
      presentationRevision: number;
      analysisRevision: number;
      planRevision: number;
      requiredSatisfied: number;
      requiredTotal: number;
      document: unknown;
    }>;
    _count: { conflicts: number };
  } | null;
};

function unresolvedPlaceholderCount(document: unknown) {
  const parsed = presentationSchema.safeParse(document);
  if (!parsed.success) return 0;
  return parsed.data.slides.reduce(
    (total, slide) => total + ((slide as { placeholders?: Array<{ resolved?: boolean }> }).placeholders || [])
      .filter((placeholder) => !placeholder.resolved).length,
    0,
  );
}

function requiredBlockingIssueCount(report: { document: unknown; requiredTotal: number; requiredSatisfied: number }) {
  const document = complianceReportDocumentSchema.safeParse(report.document);
  if (!document.success) return Math.max(0, report.requiredTotal - report.requiredSatisfied);
  const counts = document.data.counts.required;
  return counts.partial + counts.unsatisfied + counts.needsReview;
}

function semanticNeedsReviewCount(document: unknown) {
  const parsed = complianceReportDocumentSchema.safeParse(document);
  if (!parsed.success) return 0;
  return parsed.data.items.filter((item) => (
    item.semanticResult !== undefined
    && item.result !== "ignored"
    && ["partial", "unsatisfied", "needs_review"].includes(item.semanticResult)
  )).length;
}

function safeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function safeDownloadName(objectKey: string) {
  return path.basename(objectKey).replace(/[^\w.-]+/g, "-") || "presentation";
}
