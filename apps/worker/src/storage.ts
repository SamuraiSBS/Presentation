import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

let s3: S3Client | null = null;

function getS3() {
  if (!s3) {
    s3 = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "studydeck",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "studydeck-password",
      },
    });
  }
  return s3;
}

export async function readObjectBuffer(key: string) {
  const response = await getS3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return streamToBuffer(response.Body as Readable);
}

export async function putObjectBuffer(key: string, buffer: Buffer, contentType: string) {
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string) {
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function deleteProjectPrefix(projectId: string) {
  const prefix = `projects/${projectId}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await getS3().send(new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const item of page.Contents || []) if (item.Key) keys.push(item.Key);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  for (let offset = 0; offset < keys.length; offset += 1_000) {
    const batch = keys.slice(offset, offset + 1_000);
    if (!batch.length) continue;
    const result = await getS3().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
    if (result.Errors?.length) throw new Error(`S3 refused to delete ${result.Errors.length} account object(s)`);
  }
}

function bucket() {
  const value = process.env.S3_BUCKET;
  if (!value) throw new Error("S3_BUCKET is required");
  return value;
}

async function streamToBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
