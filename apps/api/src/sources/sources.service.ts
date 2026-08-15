import crypto from "node:crypto";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Prisma, type SourceRole } from "@prisma/client";
import { defensePlanSchema, planLimits } from "@studydeck/shared";
import sharp from "sharp";
import { ProjectAccessService } from "../access/project-access.service.js";
import { conflict } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { MalwareScanService } from "../security/malware-scan.service.js";
import { ProductAnalyticsService } from "../analytics/product-analytics.service.js";

@Injectable()
export class SourcesService {
  private s3Client?: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly access: ProjectAccessService,
    private readonly malwareScanner: MalwareScanService,
    @Optional() private readonly productAnalytics?: ProductAnalyticsService,
  ) {}

  async upload(userId: string, projectId: string, files: Express.Multer.File[]) {
    const access = await this.access.requireEditor(userId, projectId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, include: { user: true } });
    if (project && project.userId !== access.project.userId) throw new NotFoundException("Project not found");
    if (!project) throw new NotFoundException("Project not found");
    if (!files.length) throw new BadRequestException("No files uploaded");

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const limit = planLimits[project.user.planCode].maxProjectBytes;
    if (totalBytes > limit) throw new BadRequestException("Project upload limit exceeded");
    await this.scanFiles(files);

    const created = [];
    for (const file of files) {
      const originalName = file.originalname || "source";
      const extension = path.extname(originalName).replace(".", "").toUpperCase() || "FILE";
      const objectKey = `projects/${projectId}/sources/${crypto.randomUUID()}-${safeFileName(originalName)}`;
      await this.getS3().send(
        new PutObjectCommand({
          Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
          Key: objectKey,
          Body: file.buffer,
          ContentType: file.mimetype || "application/octet-stream",
        }),
      );

      created.push(
        await this.prisma.source.create({
          data: {
            projectId,
            label: originalName,
            type: extension,
            size: file.size,
            objectKey,
          },
        }),
      );
    }

    await this.prisma.project.update({ where: { id: projectId }, data: { status: "uploading" } });
    void this.productAnalytics?.capture(access.project.userId, "sources_added", {
      source_count: created.length,
      unconfirmed_source_count: created.length,
      source_origin: "upload",
      source_types: [...new Set(created.map((source) => source.type))],
    });
    return { sources: created };
  }

  async uploadDefense(
    userId: string,
    projectId: string,
    files: Express.Multer.File[],
    manifest: readonly DefenseUploadManifestEntry[],
    expectedAnalysisRevision?: number,
    idempotencyKey?: string,
  ) {
    const access = await this.access.requireEditor(userId, projectId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        user: true,
        defenseWorkspace: { select: { id: true, analysisRevision: true, planRevision: true, plan: true } },
      },
    });
    if (!project || project.userId !== access.project.userId || project.workflow !== "requirements_driven" || !project.defenseWorkspace) {
      throw new NotFoundException("Defense workspace not found");
    }
    const workspace = project.defenseWorkspace;
    if (expectedAnalysisRevision !== undefined && expectedAnalysisRevision !== workspace.analysisRevision) {
      throw conflict("ANALYSIS_REVISION_CONFLICT", "Данные защиты изменились в другой вкладке", {
        currentAnalysisRevision: workspace.analysisRevision,
      });
    }
    const plan = defensePlanSchema.safeParse(workspace.plan);
    if (plan.success && plan.data.status === "approved") {
      throw conflict(
        "DEFENSE_PLAN_ALREADY_CONFIRMED",
        "После подтверждения плана изменять материалы нельзя. Создайте новый черновик защиты.",
      );
    }
    if (!files.length) throw new BadRequestException("No files uploaded");
    if (files.length !== manifest.length) throw new BadRequestException("Each uploaded file must have exactly one role");

    const byFieldName = new Map<string, DefenseUploadManifestEntry>();
    for (const entry of manifest) {
      if (!entry.fieldName || byFieldName.has(entry.fieldName)) {
        throw new BadRequestException("Invalid defense upload manifest");
      }
      byFieldName.set(entry.fieldName, entry);
    }
    if (byFieldName.size !== files.length || files.some((file) => !byFieldName.has(file.fieldname))) {
      throw new BadRequestException("Each uploaded file must have exactly one role");
    }
    if (idempotencyKey) {
      const repeated = await this.prisma.source.findMany({
        where: { projectId, uploadRequestKey: idempotencyKey },
        orderBy: { uploadFieldName: "asc" },
      });
      if (repeated.length) {
        if (sameDefenseUploadBatch(repeated, manifest)) return { sources: repeated };
        throw conflict("DEFENSE_UPLOAD_IDEMPOTENCY_CONFLICT", "Этот ключ загрузки уже относится к другому набору файлов");
      }
    }

    const parentSourceIds = [...new Set(manifest.flatMap((entry) => entry.parentSourceId ? [entry.parentSourceId] : []))];
    if (parentSourceIds.length) {
      const parents = await this.prisma.source.count({ where: { projectId, id: { in: parentSourceIds } } });
      if (parents !== parentSourceIds.length) throw new NotFoundException("Parent source not found");
    }

    const [stored, incoming] = await Promise.all([
      this.prisma.source.aggregate({ where: { projectId }, _sum: { size: true } }),
      Promise.resolve(files.reduce((sum, file) => sum + file.size, 0)),
    ]);
    const limit = planLimits[project.user.planCode].maxProjectBytes;
    if ((stored._sum.size ?? 0) + incoming > limit) {
      throw new BadRequestException("Project upload limit exceeded");
    }
    await this.scanFiles(files);

    // Validate every file before the first external write, so a bad second
    // file cannot leave a partially accepted upload behind.
    const prepared = await Promise.all(files.map(async (file) => {
      const entry = byFieldName.get(file.fieldname);
      if (!file || !entry) throw new BadRequestException("Invalid defense upload manifest");
      const validated = await validateDefenseFile(file, entry.role);
      const objectKey = `projects/${projectId}/defense/sources/${crypto.randomUUID()}-${safeFileName(validated.originalName)}`;
      return { file, entry, validated, objectKey };
    }));

    const uploadedKeys: string[] = [];
    try {
      for (const item of prepared) {
        await this.getS3().send(
          new PutObjectCommand({
            Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
            Key: item.objectKey,
            Body: item.file.buffer,
            ContentType: item.file.mimetype || item.validated.contentType,
          }),
        );
        uploadedKeys.push(item.objectKey);
      }

      const created = await this.prisma.$transaction(async (tx) => {
        const rows = [];
        for (const item of prepared) {
          rows.push(await tx.source.create({
            data: {
              projectId,
              ...(idempotencyKey ? { uploadRequestKey: idempotencyKey, uploadFieldName: item.entry.fieldName } : {}),
              label: item.entry.label || item.validated.originalName,
              type: item.validated.extension.slice(1).toUpperCase(),
              role: item.entry.role,
              parentSourceId: item.entry.parentSourceId,
              size: item.file.size,
              objectKey: item.objectKey,
              metadata: {
                origin: "upload",
                originalFileName: item.validated.originalName,
                mimeType: item.file.mimetype || item.validated.contentType,
                ...(item.entry.parentSourceId ? { parentSourceId: item.entry.parentSourceId } : {}),
                ...(item.validated.image
                  ? {
                    image: {
                      ...item.validated.image,
                      contentType: item.file.mimetype || item.validated.contentType,
                      byteSize: item.file.size,
                    },
                  }
                  : {}),
                chunks: [],
                warnings: [],
              } as Prisma.InputJsonValue,
            },
          }));
        }
        await tx.project.update({ where: { id: projectId }, data: { status: "uploading" } });
        const bumped = await tx.defenseWorkspace.updateMany({
          where: {
            id: workspace.id,
            analysisRevision: workspace.analysisRevision,
            planRevision: workspace.planRevision,
          },
          data: {
            analysisStatus: "draft",
            analysisError: null,
            analysisRevision: { increment: 1 },
            plan: Prisma.DbNull,
            planRevision: { increment: 1 },
          },
        });
        if (!bumped.count) {
          throw conflict("ANALYSIS_REVISION_CONFLICT", "Данные защиты изменились в другой вкладке");
        }
        return rows;
      });
      void this.productAnalytics?.capture(access.project.userId, "sources_added", {
        source_count: created.length,
        unconfirmed_source_count: created.length,
        source_origin: "defense_upload",
        source_types: [...new Set(created.map((source) => source.type))],
      });
      return { sources: created };
    } catch (error) {
      await Promise.allSettled(uploadedKeys.map((objectKey) => this.getS3().send(new DeleteObjectCommand({
        Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
        Key: objectKey,
      }))));
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const repeated = await this.prisma.source.findMany({
          where: { projectId, uploadRequestKey: idempotencyKey },
          orderBy: { uploadFieldName: "asc" },
        });
        if (sameDefenseUploadBatch(repeated, manifest)) return { sources: repeated };
      }
      throw error;
    }
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

  private async scanFiles(files: readonly Express.Multer.File[]) {
    // Do this before any S3 write. A scanner outage is deliberately fail-closed
    // in production, so unverified content never reaches the shared bucket.
    await Promise.all(files.map((file) => this.malwareScanner.scan(file.buffer, file.originalname || "upload")));
  }
}

export type DefenseUploadManifestEntry = {
  fieldName: string;
  role: SourceRole;
  label?: string;
  parentSourceId?: string;
};

function sameDefenseUploadBatch(
  sources: Array<{ uploadFieldName: string | null }>,
  manifest: readonly DefenseUploadManifestEntry[],
) {
  if (sources.length !== manifest.length) return false;
  const sourceFieldNames = new Set(sources.flatMap((source) => source.uploadFieldName ? [source.uploadFieldName] : []));
  return sourceFieldNames.size === manifest.length && manifest.every((entry) => sourceFieldNames.has(entry.fieldName));
}

const documentExtensions = new Set([".txt", ".md", ".pdf", ".docx", ".pptx"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

async function validateDefenseFile(file: Express.Multer.File, role: SourceRole) {
  const originalName = (file.originalname || "").normalize("NFKC");
  if (!originalName || originalName.includes("\0") || path.basename(originalName) !== originalName || path.win32.basename(originalName) !== originalName) {
    throw new BadRequestException("Invalid file name");
  }
  const extension = path.extname(originalName).toLowerCase();
  const allowed = allowedExtensions(role);
  if (!file.size || !file.buffer.length) throw new BadRequestException("Empty files are not supported");
  if (!allowed.has(extension)) throw new BadRequestException(`File type is not allowed for role ${role}`);
  if (!matchesMime(file.mimetype, extension)) throw new BadRequestException("File MIME type does not match its extension");
  if (!matchesMagic(file.buffer, extension)) throw new BadRequestException("File content does not match its extension");
  let image: { width: number; height: number } | undefined;
  if (imageExtensions.has(extension)) {
    try {
      const metadata = await sharp(file.buffer, { failOn: "error" }).metadata();
      if (!metadata.width || !metadata.height) throw new Error("missing dimensions");
      image = { width: metadata.width, height: metadata.height };
    } catch {
      throw new BadRequestException("Image could not be decoded");
    }
  }
  return { originalName, extension, contentType: contentTypeFor(extension), image };
}

function allowedExtensions(role: SourceRole) {
  if (role === "style_reference") return new Set([".pptx"]);
  if (["screenshot", "logo", "supporting_image"].includes(role)) return imageExtensions;
  if (["project_document", "technical_spec", "defense_spec"].includes(role)) {
    return role === "project_document" ? new Set([...documentExtensions, ".zip"]) : documentExtensions;
  }
  return new Set<string>();
}

function matchesMime(mime: string | undefined, extension: string) {
  const claimed = (mime || "application/octet-stream").toLowerCase();
  if (claimed === "application/octet-stream") return true;
  const expected = contentTypeFor(extension);
  if (claimed === expected) return true;
  if ((extension === ".md" && claimed === "text/plain") || ([".docx", ".pptx"].includes(extension) && claimed === "application/zip")) {
    return true;
  }
  return false;
}

function matchesMagic(buffer: Buffer, extension: string) {
  if (extension === ".pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if ([".zip", ".docx", ".pptx"].includes(extension)) {
    const signature = buffer.subarray(0, 4).toString("hex");
    return signature === "504b0304" || signature === "504b0506" || signature === "504b0708";
  }
  if (extension === ".png") return buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (extension === ".jpg" || extension === ".jpeg") return buffer.subarray(0, 3).toString("hex") === "ffd8ff";
  if (extension === ".webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (extension === ".txt" || extension === ".md") {
    return !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
  }
  return false;
}

function contentTypeFor(extension: string) {
  const values: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return values[extension] || "application/octet-stream";
}

function safeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "-").slice(0, 120) || "source";
}
