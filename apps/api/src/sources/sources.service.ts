import crypto from "node:crypto";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { planLimits } from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class SourcesService {
  private s3Client?: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly access: ProjectAccessService,
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
    return { sources: created };
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

function safeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "-").slice(0, 120) || "source";
}
