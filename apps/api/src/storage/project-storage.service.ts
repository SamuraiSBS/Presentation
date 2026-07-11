import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { errorLogFields, logger } from "../observability.js";

@Injectable()
export class ProjectStorageService {
  private s3Client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  async copyProjectPrefix(sourceProjectId: string, destinationProjectId: string) {
    const sourcePrefix = projectPrefix(sourceProjectId);
    const destinationPrefix = projectPrefix(destinationProjectId);
    const sourceKeys = (await this.listKeys(sourcePrefix)).filter((key) => !key.startsWith(`${sourcePrefix}exports/`));
    const keyMap = new Map<string, string>();

    try {
      for (const sourceKey of sourceKeys) {
        const destinationKey = `${destinationPrefix}${sourceKey.slice(sourcePrefix.length)}`;
        await this.getS3().send(new CopyObjectCommand({
          Bucket: this.bucket(),
          CopySource: encodeCopySource(this.bucket(), sourceKey),
          Key: destinationKey,
        }));
        keyMap.set(sourceKey, destinationKey);
      }
      return keyMap;
    } catch (error) {
      try {
        await this.deleteProjectPrefix(destinationProjectId);
      } catch (cleanupError) {
        logger.error({
          destinationProjectId,
          ...errorLogFields(cleanupError),
        }, "could not clean up a partially copied project prefix");
      }
      throw error;
    }
  }

  async deleteProjectPrefix(projectId: string) {
    const keys = await this.listKeys(projectPrefix(projectId));
    await this.deleteKeys(keys);
  }

  async deleteObjectKey(key: string) {
    await this.deleteKeys([key]);
  }

  private async listKeys(prefix: string) {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.getS3().send(new ListObjectsV2Command({
        Bucket: this.bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const object of result.Contents || []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  private async deleteKeys(keys: string[]) {
    for (let offset = 0; offset < keys.length; offset += 1000) {
      const batch = keys.slice(offset, offset + 1000);
      if (!batch.length) continue;
      const result = await this.getS3().send(new DeleteObjectsCommand({
        Bucket: this.bucket(),
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }));
      if (result.Errors?.length) {
        throw new Error(`S3 refused to delete ${result.Errors.length} project object(s)`);
      }
    }
  }

  private bucket() {
    return this.config.getOrThrow<string>("S3_BUCKET");
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

export function rewriteProjectDocument(
  document: unknown,
  keyMap: ReadonlyMap<string, string>,
  sourceIdMap: ReadonlyMap<string, string>,
  sourceProjectId: string,
  destinationProjectId: string,
): unknown {
  return rewriteValue(document);

  function rewriteValue(value: unknown): unknown {
    if (typeof value === "string") {
      const mappedKey = keyMap.get(value);
      if (mappedKey) return mappedKey;
      return value
        .replaceAll(`projects/${sourceProjectId}/`, `projects/${destinationProjectId}/`)
        .replaceAll(`/api/projects/${sourceProjectId}/`, `/api/projects/${destinationProjectId}/`);
    }
    if (Array.isArray(value)) return value.map(rewriteValue);
    if (!value || typeof value !== "object") return value;

    const record = value as Record<string, unknown>;
    const sourceLike = typeof record.id === "string"
      && sourceIdMap.has(record.id)
      && typeof record.label === "string"
      && typeof record.type === "string";
    const rewritten: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (key === "sourceId" && typeof nested === "string" && sourceIdMap.has(nested)) {
        rewritten[key] = sourceIdMap.get(nested);
      } else if (key === "id" && sourceLike && typeof nested === "string") {
        rewritten[key] = sourceIdMap.get(nested);
      } else {
        rewritten[key] = rewriteValue(nested);
      }
    }
    return rewritten;
  }
}

function projectPrefix(projectId: string) {
  return `projects/${projectId}/`;
}

function encodeCopySource(bucket: string, key: string) {
  return encodeURIComponent(`${bucket}/${key}`).replace(/%2F/g, "/");
}
