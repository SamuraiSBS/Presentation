import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
