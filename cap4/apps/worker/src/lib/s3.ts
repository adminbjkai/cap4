import { GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

function isReadableStream(body: unknown): body is Readable {
  return Boolean(body) && typeof body === "object" && Symbol.asyncIterator in (body as Record<string, unknown>);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
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

export async function getObjectBuffer(client: S3Client, bucket: string, key: string): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  const body = response.Body;
  if (!body) {
    throw new Error(`S3 object body missing for key ${key}`);
  }

  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (isReadableStream(body)) return streamToBuffer(body);

  throw new Error(`Unsupported S3 body type for key ${key}`);
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
