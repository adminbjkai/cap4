/**
 * Shared types, constants, and helper utilities used across route modules.
 * Extracted from the monolithic index.ts — no logic changes.
 */

import crypto from "node:crypto";
import { getEnv } from "@cap/config";
import { query } from "@cap/db";

const env = getEnv();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROCESSING_PHASE_RANK: Record<string, number> = {
  not_required: 0,
  queued: 10,
  downloading: 20,
  probing: 30,
  processing: 40,
  uploading: 50,
  generating_thumbnail: 60,
  complete: 70,
  failed: 80,
  cancelled: 90
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts";

export type ProcessResponse = {
  resultKey: string;
  thumbnailKey: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number | null;
  hasAudio?: boolean;
};

export type WebhookPayload = {
  jobId: string;
  videoId: string;
  phase: keyof typeof PROCESSING_PHASE_RANK;
  progress: number;
  message?: string;
  error?: string;
  metadata?: {
    duration?: number;
    width?: number;
    height?: number;
    fps?: number;
  };
};

export type ProviderHealthState = "healthy" | "active" | "degraded" | "ready" | "unavailable";

export type ProviderStatusResponse = {
  checkedAt: string;
  providers: Array<{
    key: "deepgram" | "groq";
    label: string;
    purpose: "transcription" | "ai";
    state: ProviderHealthState;
    configured: boolean;
    baseUrl: string | null;
    model: string | null;
    lastSuccessAt: string | null;
    lastJob: {
      id: number;
      videoId: string;
      status: string;
      updatedAt: string;
      lastError: string | null;
    } | null;
  }>;
};

export type IdempotencyBeginResult =
  | { kind: "proceed" }
  | { kind: "cached"; statusCode: number; body: Record<string, unknown> }
  | { kind: "conflict"; statusCode: 409; body: Record<string, unknown> };

type QueryResult<Row extends Record<string, unknown>> = {
  rowCount: number;
  rows: Row[];
};

type QueryClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
};

export type TranscriptSegmentRow = {
  startSeconds?: number;
  endSeconds?: number;
  text?: string;
  confidence?: number | null;
  speaker?: number | null;
  originalText?: string;
};

// ---------------------------------------------------------------------------
// Simple helpers
// ---------------------------------------------------------------------------

export function badRequest(message: string) {
  return { ok: false, error: message };
}

export function phaseRank(phase: string): number | null {
  const rank = PROCESSING_PHASE_RANK[phase];
  return typeof rank === "number" ? rank : null;
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function configuredSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function sanitizeProviderBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return value;
  }
}

export function timingSafeEqual(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  const maxLen = Math.max(expectedBuf.length, actualBuf.length);
  const expectedPadded = Buffer.alloc(maxLen, 0);
  const actualPadded = Buffer.alloc(maxLen, 0);
  expectedBuf.copy(expectedPadded);
  actualBuf.copy(actualPadded);
  return crypto.timingSafeEqual(expectedPadded, actualPadded);
}

export function verifyWebhookSignature(raw: string, timestamp: string, signatureHeader: string): boolean {
  const digest = crypto
    .createHmac("sha256", env.MEDIA_SERVER_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return timingSafeEqual(`v1=${digest}`, signatureHeader);
}

export function requireIdempotencyKey(headers: Record<string, unknown>): string | null {
  const raw = headers["idempotency-key"];
  if (!raw || typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

export function transcriptTextFromSegments(segments: unknown): string | null {
  if (!Array.isArray(segments)) return null;
  const text = segments
    .map((segment) => {
      if (!segment || typeof segment !== "object") return "";
      const value = (segment as { text?: unknown }).text;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

export function keyPointsFromChapters(chapters: unknown): string[] {
  if (!Array.isArray(chapters)) return [];
  return chapters
    .map((chapter) => {
      if (typeof chapter === "string") return chapter.trim();
      if (!chapter || typeof chapter !== "object") return "";
      const point = (chapter as { point?: unknown }).point;
      if (typeof point === "string") return point.trim();
      const title = (chapter as { title?: unknown }).title;
      return typeof title === "string" ? title.trim() : "";
    })
    .filter((point) => point.length > 0);
}

export function encodeLibraryCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`, "utf8").toString("base64url");
}

export function decodeLibraryCursor(cursor: string): { createdAtIso: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const [createdAtIso, id] = decoded.split("|");
    if (!createdAtIso || !id) return null;
    const parsedDate = Date.parse(createdAtIso);
    if (!Number.isFinite(parsedDate)) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    return { createdAtIso, id };
  } catch {
    return null;
  }
}

export function normalizeEditableTranscriptSegments(existing: unknown, nextTranscriptText: string): TranscriptSegmentRow[] {
  const existingSegments = Array.isArray(existing)
    ? existing.filter((segment) => segment && typeof segment === "object") as TranscriptSegmentRow[]
    : [];

  const lines = nextTranscriptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  if (existingSegments.length === 0) {
    return lines.map((text, index) => ({
      text,
      startSeconds: index * 5,
      endSeconds: index * 5 + 4,
      originalText: text
    }));
  }

  return lines.map((text, index) => {
    const fallback = existingSegments[Math.min(index, existingSegments.length - 1)] ?? {};
    const startSeconds = Number(fallback.startSeconds);
    const endSeconds = Number(fallback.endSeconds);
    const confidence = fallback.confidence;
    const speaker = fallback.speaker;
    const originalText = typeof fallback.originalText === "string"
      ? fallback.originalText
      : typeof fallback.text === "string"
        ? fallback.text
        : text;

    const normalizedStart = Number.isFinite(startSeconds) ? startSeconds : index * 5;
    const normalizedEnd = Number.isFinite(endSeconds) ? Math.max(normalizedStart, endSeconds) : normalizedStart + 4;

    return {
      text,
      startSeconds: normalizedStart,
      endSeconds: normalizedEnd,
      confidence: typeof confidence === "number" ? confidence : null,
      speaker: typeof speaker === "number" ? speaker : null,
      originalText
    };
  });
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from "@aws-sdk/client-s3";

export {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
};

export function getS3ClientAndBucket() {
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000";
  const signingEndpoint = publicEndpoint;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  if (!signingEndpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 configuration: S3_ENDPOINT/S3_PUBLIC_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET");
  }

  const client = new S3Client({
    endpoint: signingEndpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });

  return { client, bucket };
}

export function getInternalS3ClientAndBucket() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 configuration: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET");
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

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

export async function idempotencyBegin(args: {
  client: QueryClient;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
  ttlInterval: string;
}): Promise<IdempotencyBeginResult> {
  // Allow reuse after expiry (best-effort; there is no cleanup job yet).
  await args.client.query(
    `DELETE FROM idempotency_keys
     WHERE endpoint = $1
       AND idempotency_key = $2
       AND expires_at < now()`,
    [args.endpoint, args.idempotencyKey]
  );

  const inserted = await args.client.query(
    `INSERT INTO idempotency_keys (endpoint, idempotency_key, request_hash, expires_at)
     VALUES ($1, $2, $3, now() + $4::interval)
     ON CONFLICT DO NOTHING
     RETURNING endpoint`,
    [args.endpoint, args.idempotencyKey, args.requestHash, args.ttlInterval]
  );

  if (inserted.rowCount > 0) return { kind: "proceed" };

  const existing = await args.client.query(
    `SELECT request_hash, status_code, response_body
     FROM idempotency_keys
     WHERE endpoint = $1 AND idempotency_key = $2`,
    [args.endpoint, args.idempotencyKey]
  );

  if (existing.rowCount === 0) {
    return { kind: "conflict", statusCode: 409, body: badRequest("Idempotency key collision") };
  }

  const row = existing.rows[0] as { request_hash?: string; status_code?: number | null; response_body?: unknown };
  if (row.request_hash !== args.requestHash) {
    return { kind: "conflict", statusCode: 409, body: badRequest("Idempotency key reuse with different request payload") };
  }

  if (typeof row.status_code === "number" && row.response_body && typeof row.response_body === "object") {
    return { kind: "cached", statusCode: row.status_code, body: row.response_body as Record<string, unknown> };
  }

  return { kind: "conflict", statusCode: 409, body: badRequest("Duplicate request still in progress") };
}

export async function idempotencyFinish(args: {
  client: QueryClient;
  endpoint: string;
  idempotencyKey: string;
  statusCode: number;
  body: Record<string, unknown>;
}): Promise<void> {
  await args.client.query(
    `UPDATE idempotency_keys
     SET status_code = $3,
         response_body = $4::jsonb
     WHERE endpoint = $1 AND idempotency_key = $2`,
    [args.endpoint, args.idempotencyKey, args.statusCode, JSON.stringify(args.body)]
  );
}

// ---------------------------------------------------------------------------
// Provider status helpers
// ---------------------------------------------------------------------------

export function deriveProviderHealthState(args: {
  configured: boolean;
  lastJobStatus: string | null;
  lastJobError: string | null;
  lastSuccessAt: string | null;
}): ProviderHealthState {
  if (!args.configured) return "unavailable";
  if (args.lastJobStatus === "queued" || args.lastJobStatus === "leased" || args.lastJobStatus === "running") {
    return "active";
  }
  if (args.lastJobStatus === "dead" || args.lastJobError) {
    return "degraded";
  }
  if (args.lastSuccessAt) {
    return "healthy";
  }
  return "ready";
}

export async function getSystemProviderStatus(): Promise<ProviderStatusResponse> {
  const [deepgramJobResult, groqJobResult, deepgramSuccessResult, groqSuccessResult] = await Promise.all([
    query<{
      id: number;
      video_id: string;
      status: string;
      updated_at: string;
      last_error: string | null;
    }>(
      env.DATABASE_URL,
      `SELECT id, video_id, status, updated_at, last_error
       FROM job_queue
       WHERE job_type = 'transcribe_video'
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    query<{
      id: number;
      video_id: string;
      status: string;
      updated_at: string;
      last_error: string | null;
    }>(
      env.DATABASE_URL,
      `SELECT id, video_id, status, updated_at, last_error
       FROM job_queue
       WHERE job_type = 'generate_ai'
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    query<{ updated_at: string }>(
      env.DATABASE_URL,
      `SELECT updated_at
       FROM transcripts
       WHERE provider = 'deepgram'
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    query<{ updated_at: string }>(
      env.DATABASE_URL,
      `SELECT updated_at
       FROM ai_outputs
       WHERE provider = 'groq'
       ORDER BY updated_at DESC
       LIMIT 1`
    )
  ]);

  const deepgramJob = deepgramJobResult.rows[0] ?? null;
  const groqJob = groqJobResult.rows[0] ?? null;
  const deepgramLastSuccessAt = deepgramSuccessResult.rows[0]?.updated_at ?? null;
  const groqLastSuccessAt = groqSuccessResult.rows[0]?.updated_at ?? null;
  const deepgramConfigured = configuredSecret(process.env.DEEPGRAM_API_KEY);
  const groqConfigured = configuredSecret(process.env.GROQ_API_KEY);

  return {
    checkedAt: new Date().toISOString(),
    providers: [
      {
        key: "deepgram",
        label: "Deepgram",
        purpose: "transcription",
        configured: deepgramConfigured,
        state: deriveProviderHealthState({
          configured: deepgramConfigured,
          lastJobStatus: deepgramJob?.status ?? null,
          lastJobError: deepgramJob?.last_error ?? null,
          lastSuccessAt: deepgramLastSuccessAt
        }),
        baseUrl: sanitizeProviderBaseUrl(process.env.DEEPGRAM_BASE_URL ?? env.DEEPGRAM_BASE_URL),
        model: process.env.DEEPGRAM_MODEL ?? env.DEEPGRAM_MODEL,
        lastSuccessAt: deepgramLastSuccessAt,
        lastJob: deepgramJob
          ? {
            id: deepgramJob.id,
            videoId: deepgramJob.video_id,
            status: deepgramJob.status,
            updatedAt: deepgramJob.updated_at,
            lastError: deepgramJob.last_error
          }
          : null
      },
      {
        key: "groq",
        label: "Groq",
        purpose: "ai",
        configured: groqConfigured,
        state: deriveProviderHealthState({
          configured: groqConfigured,
          lastJobStatus: groqJob?.status ?? null,
          lastJobError: groqJob?.last_error ?? null,
          lastSuccessAt: groqLastSuccessAt
        }),
        baseUrl: sanitizeProviderBaseUrl(process.env.GROQ_BASE_URL ?? env.GROQ_BASE_URL),
        model: process.env.GROQ_MODEL ?? env.GROQ_MODEL,
        lastSuccessAt: groqLastSuccessAt,
        lastJob: groqJob
          ? {
            id: groqJob.id,
            videoId: groqJob.video_id,
            status: groqJob.status,
            updatedAt: groqJob.updated_at,
            lastError: groqJob.last_error
          }
          : null
      }
    ]
  };
}
