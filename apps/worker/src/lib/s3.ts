import { GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

function isReadableStream(body: unknown): body is Readable {
  return Boolean(body) && typeof body === "object" && Symbol.asyncIterator in (body as Record<string, unknown>);
}

export function getS3ClientAndBucket(raw: Record<string, string | undefined> = process.env): { client: S3Client; bucket: string } {
  const endpoint = raw.S3_ENDPOINT;
  const region = raw.S3_REGION ?? "us-east-1";
  const accessKeyId = raw.S3_ACCESS_KEY;
  const secretAccessKey = raw.S3_SECRET_KEY;
  const bucket = raw.S3_BUCKET;
  const forcePathStyle = (raw.S3_FORCE_PATH_STYLE ?? "true") === "true";

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 worker configuration");
  }

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });

  return { client, bucket };
}

/**
 * Streams an S3 object to a local file without buffering it in memory —
 * raw uploads can be multiple GB.
 */
export async function downloadObjectToFile(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string
): Promise<void> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;
  if (!body || !isReadableStream(body)) {
    throw new Error(`S3 object body is not streamable for key ${key}`);
  }
  await pipeline(body, createWriteStream(filePath));
}

export async function putObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

export async function deleteObjects(
  client: S3Client,
  bucket: string,
  keys: string[]
): Promise<void> {
  if (keys.length === 0) return;
  const Objects = keys.map((key) => ({ Key: key }));
  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects }
    })
  );
}
