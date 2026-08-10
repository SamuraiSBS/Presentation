import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class HealthStorageService {
  private client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  async check() {
    await this.getClient().send(new HeadBucketCommand({
      Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
    }));
  }

  private getClient() {
    if (!this.client) {
      this.client = new S3Client({
        region: this.config.get<string>("S3_REGION") || "us-east-1",
        endpoint: this.config.getOrThrow<string>("S3_ENDPOINT"),
        forcePathStyle: this.config.get<string>("S3_FORCE_PATH_STYLE") !== "false",
        credentials: {
          accessKeyId: this.config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
          secretAccessKey: this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY"),
        },
      });
    }
    return this.client;
  }
}
