import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Queue } from "bullmq";
import path from "node:path";
import { type ExportType, planLimits } from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
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

  async enqueue(userId: string, projectId: string, type: ExportType) {
    return withTraceSpan("api.export.enqueue", {
      "studydeck.project_id": projectId,
      "studydeck.stage": "generation.export",
      "studydeck.export_type": type,
    }, async () => {
      const access = await this.access.requireViewer(userId, projectId);
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: { user: true, presentation: true },
      });
      if (!project || project.userId !== access.project.userId) throw new NotFoundException("Project not found");
      if (!project.presentation) throw new BadRequestException("Generate the presentation before export");

      const allowed = planLimits[project.user.planCode].exports;
      if (!(allowed as readonly string[]).includes(type)) throw new BadRequestException("This export type is not included in your plan");

      const created = await this.prisma.export.create({
        data: { projectId, type, presentationRevision: project.presentation.revision },
      });
      const queueJob = await this.exportsQueue.add(
        "export-presentation",
        { exportId: created.id, projectId, type, traceContext: injectTraceContext() },
        { attempts: 2 },
      );
      await this.prisma.export.update({ where: { id: created.id }, data: { queueJobId: queueJob.id } });
      return { ...created, queueJobId: queueJob.id };
    });
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

function safeDownloadName(objectKey: string) {
  return path.basename(objectKey).replace(/[^\w.-]+/g, "-") || "presentation";
}
