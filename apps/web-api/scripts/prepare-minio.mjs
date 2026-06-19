/* global fetch, process, console, URL, setTimeout */

import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000";
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? "us-east-1";
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

if (!accessKeyId || !secretAccessKey || !bucket) {
  console.error("S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET are required.");
  process.exit(1);
}

async function waitForMinio(url) {
  const healthUrl = new URL("/minio/health/live", url);

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { method: "GET" });
      if (response.ok) return;
    } catch {
      // keep retrying until MinIO is ready
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`MinIO did not become ready at ${healthUrl.toString()}`);
}

await waitForMinio(endpoint);

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`Bucket already exists: ${bucket}`);
} catch (error) {
  const errorName =
    typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";

  if (errorName !== "NotFound" && errorName !== "NoSuchBucket" && errorName !== "UnknownError") {
    throw error;
  }

  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`Bucket created: ${bucket}`);
}
