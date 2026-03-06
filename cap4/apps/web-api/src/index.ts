import crypto from "node:crypto";
import { spawn } from "node:child_process";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@cap/config";
import { query, withTransaction } from "@cap/db";
import loggingPlugin from "./plugins/logging.js";
import healthPlugin from "./plugins/health.js";

const env = getEnv();
const app = Fastify({ logger: false });

// Register logging plugin first
await app.register(loggingPlugin, {
  serviceName: 'web-api',
  version: '0.1.0',
});

// Register health check endpoints
await app.register(healthPlugin, {
  version: '0.1.0',
});
const uiPublicBucketBase = `${(process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000").replace(/\/$/, "")}/${process.env.S3_BUCKET ?? "cap3"}`;

const PROCESSING_PHASE_RANK: Record<string, number> = {
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

type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts";

type ProcessResponse = {
  resultKey: string;
  thumbnailKey: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number | null;
  hasAudio?: boolean;
};

type WebhookPayload = {
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

type ProviderHealthState = "healthy" | "active" | "degraded" | "ready" | "unavailable";

type ProviderStatusResponse = {
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

function log(fields: Record<string, unknown>) {
  // Use service logger if available, otherwise fallback to console
  if ((app as any).serviceLogger) {
    (app as any).serviceLogger.info('web-api log', fields);
  } else {
    console.log(JSON.stringify({ service: "web-api", ...fields }));
  }
}

function badRequest(message: string) {
  return { ok: false, error: message };
}

function timingSafeEqual(expected: string, actual: string): boolean {
  // Always compare same-length buffers to prevent timing leaks
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  const maxLen = Math.max(expectedBuf.length, actualBuf.length);
  // Pad both to same length with zeros (doesn't affect security, prevents timing leak)
  const expectedPadded = Buffer.alloc(maxLen, 0);
  const actualPadded = Buffer.alloc(maxLen, 0);
  expectedBuf.copy(expectedPadded);
  actualBuf.copy(actualPadded);
  return crypto.timingSafeEqual(expectedPadded, actualPadded);
}

function verifyWebhookSignature(raw: string, timestamp: string, signatureHeader: string): boolean {
  const digest = crypto
    .createHmac("sha256", env.MEDIA_SERVER_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return timingSafeEqual(`v1=${digest}`, signatureHeader);
}

function phaseRank(phase: string): number | null {
  const rank = PROCESSING_PHASE_RANK[phase];
  return typeof rank === "number" ? rank : null;
}

function transcriptTextFromSegments(segments: unknown): string | null {
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

function keyPointsFromChapters(chapters: unknown): string[] {
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

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function configuredSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeProviderBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function deriveProviderHealthState(args: {
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

async function getSystemProviderStatus(): Promise<ProviderStatusResponse> {
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

function requireIdempotencyKey(headers: Record<string, unknown>): string | null {
  const raw = headers["idempotency-key"];
  if (!raw || typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

type IdempotencyBeginResult =
  | { kind: "proceed" }
  | { kind: "cached"; statusCode: number; body: Record<string, unknown> }
  | { kind: "conflict"; statusCode: 409; body: Record<string, unknown> };

async function idempotencyBegin(args: {
  client: { query: (text: string, params?: any[]) => Promise<{ rowCount: number; rows: any[] }> };
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

async function idempotencyFinish(args: {
  client: { query: (text: string, params?: any[]) => Promise<any> };
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

function getInternalS3ClientAndBucket() {
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

async function generateTestMp4Buffer(args: { seconds: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const seconds = Math.max(1, Math.floor(args.seconds));
    const child = spawn("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:sample_rate=44100",
      "-t",
      String(seconds),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      // Required for piping MP4 to stdout.
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "-f",
      "mp4",
      "pipe:1"
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

function encodeLibraryCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`, "utf8").toString("base64url");
}

function decodeLibraryCursor(cursor: string): { createdAtIso: string; id: string } | null {
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

type TranscriptSegmentRow = {
  startSeconds?: number;
  endSeconds?: number;
  text?: string;
  confidence?: number | null;
  speaker?: number | null;
  originalText?: string;
};

function normalizeEditableTranscriptSegments(existing: unknown, nextTranscriptText: string): TranscriptSegmentRow[] {
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

function getS3ClientAndBucket() {
  const endpoint = process.env.S3_ENDPOINT;
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

await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true
});

// Health check endpoints moved to health plugin (/health, /ready)

app.get("/api/system/provider-status", async (_req, reply) => {
  try {
    return reply.send(await getSystemProviderStatus());
  } catch (error) {
    log({ event: "provider_status.unavailable", error: String(error) });
    return reply.code(503).send({ ok: false, error: "Provider status unavailable" });
  }
});

app.get("/", async (_req, reply) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Cap3 Upload UI</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#111}
    .card{border:1px solid #ddd;border-radius:10px;padding:16px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    button{padding:10px 14px;border-radius:8px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}
    pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}
    .muted{color:#666;font-size:14px}
  </style>
</head>
<body>
  <h1>Cap3 Milestone 3 UI</h1>
  <p class="muted">Runs Milestone 2 flow: create video, request signed PUT, upload file, complete upload, poll status.</p>
  <div class="card">
    <div class="row">
      <input id="fileInput" type="file" accept="video/*" />
      <button id="startBtn">Upload + Process</button>
    </div>
    <p id="phase" class="muted">Phase: idle</p>
    <p id="progress" class="muted">Progress: 0%</p>
    <p id="videoIdText" class="muted">Video ID: -</p>
    <p id="jobIdText" class="muted">Job ID: -</p>
    <div id="links"></div>
    <pre id="log"></pre>
  </div>
  <script>
    const logEl = document.getElementById("log");
    const phaseEl = document.getElementById("phase");
    const progressEl = document.getElementById("progress");
    const videoIdTextEl = document.getElementById("videoIdText");
    const jobIdTextEl = document.getElementById("jobIdText");
    const linksEl = document.getElementById("links");
    const startBtn = document.getElementById("startBtn");
    const fileInput = document.getElementById("fileInput");
    const bucketBase = ${JSON.stringify(uiPublicBucketBase)};

    function appendLog(msg) {
      logEl.textContent += msg + "\\n";
      logEl.scrollTop = logEl.scrollHeight;
    }

    function encodeKey(key) {
      return key.split("/").map(encodeURIComponent).join("/");
    }

    async function postJson(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(path + " failed: " + res.status + " " + await res.text());
      return res.json();
    }

    async function run() {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        alert("Select a video file first.");
        return;
      }

      startBtn.disabled = true;
      linksEl.innerHTML = "";
      logEl.textContent = "";
      phaseEl.textContent = "Phase: starting";
      progressEl.textContent = "Progress: 0%";
      videoIdTextEl.textContent = "Video ID: -";
      jobIdTextEl.textContent = "Job ID: -";

      try {
        appendLog("1) POST /api/videos");
        const created = await postJson("/api/videos", {});
        const videoId = created.videoId;
        appendLog("videoId=" + videoId);
        videoIdTextEl.textContent = "Video ID: " + videoId;

        appendLog("2) POST /api/uploads/signed");
        const signed = await postJson("/api/uploads/signed", {
          videoId,
          contentType: file.type || "application/octet-stream"
        });
        appendLog("rawKey=" + signed.rawKey);

        appendLog("3) PUT file to signed URL");
        const putRes = await fetch(signed.putUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        });
        if (!putRes.ok) throw new Error("PUT failed: " + putRes.status + " " + await putRes.text());

        appendLog("4) POST /api/uploads/complete");
        const completed = await postJson("/api/uploads/complete", { videoId });
        appendLog("jobId=" + completed.jobId);
        jobIdTextEl.textContent = "Job ID: " + completed.jobId;

        appendLog("5) Poll /api/videos/:id/status");
        while (true) {
          const statusRes = await fetch("/api/videos/" + encodeURIComponent(videoId) + "/status");
          if (!statusRes.ok) throw new Error("status failed: " + statusRes.status + " " + await statusRes.text());
          const status = await statusRes.json();

          phaseEl.textContent = "Phase: " + status.processingPhase;
          progressEl.textContent = "Progress: " + status.processingProgress + "%";

          if (status.processingPhase === "failed") {
            throw new Error(status.errorMessage || "processing failed");
          }

          if (status.processingPhase === "complete") {
            const resultUrl = bucketBase + "/" + encodeKey(status.resultKey);
            const thumbUrl = bucketBase + "/" + encodeKey(status.thumbnailKey);
            linksEl.innerHTML =
              '<p><a href="' + resultUrl + '" target="_blank" rel="noreferrer">Download result.mp4</a></p>' +
              '<p><a href="' + thumbUrl + '" target="_blank" rel="noreferrer">Download thumbnail.jpg</a></p>';
            appendLog("complete");
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        appendLog("error: " + String(err));
      } finally {
        startBtn.disabled = false;
      }
    }

    startBtn.addEventListener("click", run);
  </script>
</body>
</html>`;

  return reply.type("text/html; charset=utf-8").send(html);
});

if (env.NODE_ENV !== "production") {
  app.post("/debug/enqueue", async (_req, reply) => {
    const videoResult = await query<{ id: string }>(
      env.DATABASE_URL,
      `INSERT INTO videos (name, source_type) VALUES ('Debug Queue Video', 'web_mp4') RETURNING id`
    );
    const videoId = videoResult.rows[0]!.id;

    const jobResult = await query<{ id: number }>(
      env.DATABASE_URL,
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'process_video', 'queued', 100, now(), '{}'::jsonb, $2)
       RETURNING id`,
      [videoId, env.WORKER_MAX_ATTEMPTS]
    );
    const jobId = Number(jobResult.rows[0]!.id);

    log({ event: "debug.enqueue.created", videoId, jobId });
    return reply.send({ videoId, jobId });
  });

  app.get<{ Params: { id: string } }>("/debug/job/:id", async (req, reply) => {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) {
      return reply.code(400).send(badRequest("Invalid job id"));
    }

    const result = await query(
      env.DATABASE_URL,
      `SELECT id, video_id, job_type, status, attempts, locked_by, locked_until, lease_token, run_after, last_error, updated_at
       FROM job_queue
       WHERE id = $1`,
      [jobId]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ ok: false, error: "Job not found" });
    }

    return reply.send(result.rows[0]);
  });

  app.post<{ Body: { name?: string; sourceType?: "web_mp4" | "processed_mp4" | "hls" } }>("/debug/videos", async (req, reply) => {
    const name = req.body?.name ?? "Smoke Video";
    const sourceType = req.body?.sourceType ?? "web_mp4";

    const result = await query<{ id: string }>(
      env.DATABASE_URL,
      `INSERT INTO videos (name, source_type) VALUES ($1, $2::source_type) RETURNING id`,
      [name, sourceType]
    );

    const videoId = result.rows[0]?.id;
    log({ event: "debug.video.created", videoId });
    return reply.send({ ok: true, videoId });
  });

  app.post<{ Body: { videoId: string; jobType: JobType; payload?: Record<string, unknown>; priority?: number; maxAttempts?: number } }>("/debug/jobs/enqueue", async (req, reply) => {
    const { videoId, jobType, payload, priority, maxAttempts } = req.body ?? ({} as any);
    if (!videoId || !jobType) return reply.code(400).send(badRequest("videoId and jobType are required"));

    const result = await query<{ id: number; status: string }>(
      env.DATABASE_URL,
      `INSERT INTO job_queue (video_id, job_type, status, priority, payload, max_attempts)
       VALUES ($1::uuid, $2::job_type, 'queued', COALESCE($3, 100), COALESCE($4::jsonb, '{}'::jsonb), COALESCE($5::int, $6::int))
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()
       RETURNING id, status`,
      [videoId, jobType, priority ?? null, payload ? JSON.stringify(payload) : null, maxAttempts ?? null, env.WORKER_MAX_ATTEMPTS]
    );

    const jobId = result.rows[0]?.id;
    log({ event: "debug.job.enqueued", videoId, jobId, jobType });
    return reply.send({ ok: true, id: jobId, videoId, jobType, status: result.rows[0]?.status });
  });

  app.post("/debug/smoke", async (_req, reply) => {
    try {
      const mp4 = await generateTestMp4Buffer({ seconds: 2 });
      const { client: s3Client, bucket } = getInternalS3ClientAndBucket();

      const created = await withTransaction(env.DATABASE_URL, async (client) => {
        const videoResult = await client.query<{ id: string }>(
          `INSERT INTO videos (name, source_type) VALUES ('Smoke Test Video', 'web_mp4') RETURNING id`
        );
        const videoId = videoResult.rows[0]!.id;
        const rawKey = `videos/${videoId}/raw/source.mp4`;

        await client.query(
          `INSERT INTO uploads (video_id, mode, phase, raw_key)
           VALUES ($1::uuid, 'singlepart', 'pending', $2)`,
          [videoId, rawKey]
        );

        // Create a job row so we can include a real job id in the /process payload.
        const jobResult = await client.query<{ id: number }>(
          `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
           VALUES ($1::uuid, 'process_video', 'queued', 100, now(), '{}'::jsonb, $2)
           RETURNING id`,
          [videoId, env.WORKER_MAX_ATTEMPTS]
        );

        // Monotonic guard: only move to queued if earlier than queued.
        await client.query(
          `UPDATE videos
           SET processing_phase = 'queued',
               processing_phase_rank = 10,
               processing_progress = GREATEST(processing_progress, 5),
               updated_at = now()
           WHERE id = $1::uuid
             AND processing_phase_rank < 10`,
          [videoId]
        );

        return { videoId, rawKey, jobId: Number(jobResult.rows[0]!.id) };
      });

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: created.rawKey,
          Body: mp4,
          ContentType: "video/mp4"
        })
      );

      // Mark upload complete (debug path).
      await query(
        env.DATABASE_URL,
        `UPDATE uploads
         SET phase = 'uploaded', updated_at = now()
         WHERE video_id = $1::uuid
           AND phase IN ('pending', 'uploading', 'completing')`,
        [created.videoId]
      );

      const webhookUrl = `${env.WEB_API_BASE_URL}/api/webhooks/media-server/progress`;
      const processRes = await fetch(`${env.MEDIA_SERVER_BASE_URL}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: created.videoId,
          rawKey: created.rawKey,
          jobId: String(created.jobId),
          webhookUrl
        })
      });

      if (!processRes.ok) {
        const text = await processRes.text();
        return reply.code(500).send({ ok: false, error: "media-server call failed", details: text });
      }

      const mediaJson = (await processRes.json()) as ProcessResponse;

      // Finalize processing state with rank-based monotonic guard.
      await withTransaction(env.DATABASE_URL, async (client) => {
        await client.query(
          `UPDATE videos
           SET processing_phase = 'complete',
               processing_phase_rank = 70,
               processing_progress = 100,
               result_key = $2,
               thumbnail_key = $3,
               duration_seconds = $4,
               width = $5,
               height = $6,
               fps = COALESCE($7, fps),
               error_message = NULL,
               completed_at = COALESCE(completed_at, now()),
               updated_at = now()
           WHERE id = $1::uuid
             AND processing_phase_rank < 70`,
          [
            created.videoId,
            mediaJson.resultKey,
            mediaJson.thumbnailKey,
            mediaJson.durationSeconds ?? null,
            mediaJson.width ?? null,
            mediaJson.height ?? null,
            mediaJson.fps ?? null
          ]
        );

        // This debug path bypasses the worker; mark the synthetic job row as terminal for operator clarity.
        await client.query(
          `UPDATE job_queue
           SET status = 'succeeded',
               finished_at = now(),
               locked_by = NULL,
               locked_until = NULL,
               lease_token = NULL,
               updated_at = now()
           WHERE id = $1
             AND status IN ('queued', 'leased', 'running')`,
          [created.jobId]
        );
      });

      const finalVideoResult = await query(
        env.DATABASE_URL,
        `SELECT id, processing_phase, processing_phase_rank, processing_progress, result_key, thumbnail_key, error_message, completed_at, updated_at
         FROM videos WHERE id = $1::uuid`,
        [created.videoId]
      );

      const queueRow = await query(
        env.DATABASE_URL,
        `SELECT id, status, attempts, locked_by, locked_until, lease_token, last_error, updated_at
         FROM job_queue WHERE id = $1`,
        [created.jobId]
      );

      log({ event: "debug.smoke.complete", videoId: created.videoId, jobId: created.jobId });

      return reply.send({
        ok: true,
        videoId: created.videoId,
        rawKey: created.rawKey,
        jobId: created.jobId,
        webhookUrl,
        media: mediaJson,
        finalVideo: finalVideoResult.rows[0] ?? null,
        queueJob: queueRow.rows[0] ?? null
      });
    } catch (error) {
      log({ event: "debug.smoke.error", error: String(error) });
      return reply.code(500).send({ ok: false, error: String(error) });
    }
  });
}

app.post<{ Body: { name?: string; webhookUrl?: string } }>("/api/videos", async (req, reply) => {
  const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
  if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

  const name = String(req.body?.name ?? "Untitled Video").trim() || "Untitled Video";
  const webhookUrl = req.body?.webhookUrl ? String(req.body.webhookUrl).trim() : null;
  const endpointKey = "/api/videos";
  const requestHash = sha256Hex(JSON.stringify({ name, webhookUrl }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const begin = await idempotencyBegin({
      client,
      endpoint: endpointKey,
      idempotencyKey,
      requestHash,
      ttlInterval: "24 hours"
    });

    if (begin.kind === "cached" || begin.kind === "conflict") {
      return { statusCode: begin.statusCode, body: begin.body };
    }

    const videoResult = await client.query<{ id: string }>(
      `INSERT INTO videos (name, source_type, webhook_url) VALUES ($1, 'web_mp4', $2) RETURNING id`,
      [name, webhookUrl]
    );

    const videoId = videoResult.rows[0]!.id;
    const rawKey = `videos/${videoId}/raw/source.mp4`;

    await client.query(
      `INSERT INTO uploads (video_id, mode, phase, raw_key)
       VALUES ($1::uuid, 'singlepart', 'pending', $2)`,
      [videoId, rawKey]
    );

    const body = { videoId, rawKey, webhookUrl };
    await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 200, body });
    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});

app.post<{ Body: { videoId: string; contentType?: string } }>("/api/uploads/signed", async (req, reply) => {
  const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
  if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

  const videoId = req.body?.videoId;
  if (!videoId) return reply.code(400).send(badRequest("videoId is required"));

  const contentType = String(req.body?.contentType ?? "application/octet-stream").trim() || "application/octet-stream";
  const endpointKey = "/api/uploads/signed";
  const requestHash = sha256Hex(JSON.stringify({ videoId, contentType }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const begin = await idempotencyBegin({
      client,
      endpoint: endpointKey,
      idempotencyKey,
      requestHash,
      ttlInterval: "15 minutes"
    });

    if (begin.kind === "cached" || begin.kind === "conflict") {
      return { statusCode: begin.statusCode, body: begin.body };
    }

    const uploadLookup = await client.query<{ raw_key: string }>(
      `SELECT u.raw_key
       FROM uploads u
       INNER JOIN videos v ON v.id = u.video_id
       WHERE u.video_id = $1::uuid
         AND v.deleted_at IS NULL`,
      [videoId]
    );
    if (uploadLookup.rowCount === 0) {
      const body = { ok: false, error: "Upload not found for videoId" };
      await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 404, body });
      return { statusCode: 404, body };
    }

    const rawKey = uploadLookup.rows[0]!.raw_key;
    const { client: s3Client, bucket } = getS3ClientAndBucket();

    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: rawKey,
      ContentType: contentType
    });
    const putUrl = await getSignedUrl(s3Client, putCommand, { expiresIn: 900 });

    await client.query(
      `UPDATE uploads
       SET phase = 'uploading', updated_at = now()
       WHERE video_id = $1::uuid
         AND phase IN ('pending', 'uploading', 'completing')`,
      [videoId]
    );

    const body = {
      videoId,
      rawKey,
      method: "PUT",
      putUrl,
      headers: { "Content-Type": contentType }
    };
    await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 200, body });
    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});

app.post<{ Body: { videoId: string } }>("/api/uploads/complete", async (req, reply) => {
  const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
  if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

  const videoId = req.body?.videoId;
  if (!videoId) return reply.code(400).send(badRequest("videoId is required"));

  const endpointKey = "/api/uploads/complete";
  const requestHash = sha256Hex(JSON.stringify({ videoId }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const begin = await idempotencyBegin({
      client,
      endpoint: endpointKey,
      idempotencyKey,
      requestHash,
      ttlInterval: "24 hours"
    });

    if (begin.kind === "cached" || begin.kind === "conflict") {
      return { statusCode: begin.statusCode, body: begin.body };
    }

    const uploadRow = await client.query<{ raw_key: string; phase: string }>(
      `SELECT u.raw_key, u.phase
       FROM uploads u
       INNER JOIN videos v ON v.id = u.video_id
       WHERE u.video_id = $1::uuid
         AND v.deleted_at IS NULL
       FOR UPDATE`,
      [videoId]
    );

    if (uploadRow.rowCount === 0) {
      const body = { ok: false, error: "Upload not found for videoId" };
      await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 404, body });
      return { statusCode: 404, body };
    }

    const rawKey = uploadRow.rows[0]!.raw_key;
    const phase = String(uploadRow.rows[0]!.phase);
    if (phase === "pending" || phase === "uploading" || phase === "completing") {
      await client.query(
        `UPDATE uploads
         SET phase = 'uploaded', updated_at = now()
         WHERE video_id = $1::uuid
           AND phase IN ('pending', 'uploading', 'completing')`,
        [videoId]
      );
    }

    // Monotonic guard: only move to queued if earlier than queued.
    await client.query(
      `UPDATE videos
       SET processing_phase = 'queued',
           processing_phase_rank = 10,
           processing_progress = GREATEST(processing_progress, 5),
           updated_at = now()
       WHERE id = $1::uuid
         AND processing_phase_rank < 10`,
      [videoId]
    );

    const jobResult = await client.query<{ id: number }>(
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'process_video', 'queued', 100, now(), '{}'::jsonb, $2)
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()
       RETURNING id`,
      [videoId, env.WORKER_MAX_ATTEMPTS]
    );

    const body = {
      videoId,
      rawKey,
      jobId: Number(jobResult.rows[0]!.id),
      status: "uploaded"
    };
    await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 200, body });
    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});

app.get<{ Querystring: { cursor?: string; limit?: string; sort?: string } }>("/api/library/videos", async (req, reply) => {
  const sort = req.query?.sort === "created_asc" ? "created_asc" : "created_desc";
  const rawLimit = Number.parseInt(String(req.query?.limit ?? "24"), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 24;

  const decodedCursor = req.query?.cursor ? decodeLibraryCursor(req.query.cursor) : null;
  if (req.query?.cursor && !decodedCursor) {
    return reply.code(400).send(badRequest("Invalid cursor"));
  }

  const cursorCreatedAt = decodedCursor?.createdAtIso ?? null;
  const cursorId = decodedCursor?.id ?? null;
  const asc = sort === "created_asc";

  const result = await query<{
    id: string;
    display_title: string;
    thumbnail_key: string | null;
    result_key: string | null;
    processing_phase: string;
    transcription_status: string;
    ai_status: string;
    created_at: string;
    duration_seconds: string | number | null;
  }>(
    env.DATABASE_URL,
    `SELECT
       v.id,
       CASE
         WHEN NULLIF(BTRIM(v.name), '') IS NOT NULL AND BTRIM(v.name) <> 'Untitled Video' THEN BTRIM(v.name)
         WHEN NULLIF(BTRIM(ao.title), '') IS NOT NULL THEN BTRIM(ao.title)
         WHEN NULLIF(BTRIM(v.name), '') IS NOT NULL THEN BTRIM(v.name)
         ELSE 'Untitled recording'
       END AS display_title,
       v.thumbnail_key,
       v.result_key,
       v.processing_phase,
       v.transcription_status,
       v.ai_status,
       v.created_at,
       v.duration_seconds
     FROM videos v
     LEFT JOIN ai_outputs ao ON ao.video_id = v.id
     WHERE
       v.deleted_at IS NULL
       AND
       ($1::timestamptz IS NULL OR (
         CASE WHEN $3::boolean THEN (v.created_at, v.id) > ($1::timestamptz, $2::uuid)
         ELSE (v.created_at, v.id) < ($1::timestamptz, $2::uuid)
         END
       ))
     ORDER BY
       CASE WHEN $3::boolean THEN v.created_at END ASC,
       CASE WHEN NOT $3::boolean THEN v.created_at END DESC,
       CASE WHEN $3::boolean THEN v.id END ASC,
       CASE WHEN NOT $3::boolean THEN v.id END DESC
     LIMIT $4`,
    [cursorCreatedAt, cursorId, asc, limit + 1]
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const next = rows.at(-1);

  return reply.send({
    items: rows.map((row) => ({
      videoId: row.id,
      displayTitle: row.display_title,
      hasThumbnail: Boolean(row.thumbnail_key),
      hasResult: Boolean(row.result_key),
      thumbnailKey: row.thumbnail_key,
      processingPhase: row.processing_phase,
      transcriptionStatus: row.transcription_status,
      aiStatus: row.ai_status,
      createdAt: row.created_at,
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds)
    })),
    sort,
    limit,
    nextCursor: hasMore && next ? encodeLibraryCursor(next.created_at, next.id) : null
  });
});

app.get<{ Params: { id: string } }>("/api/videos/:id/status", async (req, reply) => {
  const videoId = req.params.id;
  const result = await query<{
    id: string;
    processing_phase: string;
    processing_progress: number;
    result_key: string | null;
    thumbnail_key: string | null;
    error_message: string | null;
    transcription_status: string;
    ai_status: string;
    transcript_provider: string | null;
    transcript_language: string | null;
    transcript_vtt_key: string | null;
    transcript_segments_json: unknown;
    ai_provider: string | null;
    ai_model: string | null;
    ai_title: string | null;
    ai_summary: string | null;
    ai_chapters_json: unknown;
    transcription_dead_error: string | null;
    ai_dead_error: string | null;
  }>(
    env.DATABASE_URL,
    `SELECT
       v.id,
       v.processing_phase,
       v.processing_progress,
       v.result_key,
       v.thumbnail_key,
       v.error_message,
       v.transcription_status,
       v.ai_status,
       t.provider AS transcript_provider,
       t.language AS transcript_language,
       t.vtt_key AS transcript_vtt_key,
       t.segments_json AS transcript_segments_json,
       ao.provider::text AS ai_provider,
       ao.model AS ai_model,
       ao.title AS ai_title,
       ao.summary AS ai_summary,
       ao.chapters_json AS ai_chapters_json,
       tj.last_error AS transcription_dead_error,
       aj.last_error AS ai_dead_error
     FROM videos v
     LEFT JOIN transcripts t ON t.video_id = v.id
     LEFT JOIN ai_outputs ao ON ao.video_id = v.id
     LEFT JOIN LATERAL (
       SELECT last_error
       FROM job_queue
       WHERE video_id = v.id
         AND job_type = 'transcribe_video'
         AND status = 'dead'
       ORDER BY id DESC
       LIMIT 1
     ) tj ON true
     LEFT JOIN LATERAL (
       SELECT last_error
       FROM job_queue
       WHERE video_id = v.id
         AND job_type = 'generate_ai'
         AND status = 'dead'
       ORDER BY id DESC
       LIMIT 1
     ) aj ON true
     WHERE v.id = $1::uuid
       AND v.deleted_at IS NULL`,
    [videoId]
  );

  if (result.rowCount === 0) {
    return reply.code(404).send({ ok: false, error: "Video not found" });
  }

  const row = result.rows[0]!;
  const transcriptText = transcriptTextFromSegments(row.transcript_segments_json);
  const keyPoints = keyPointsFromChapters(row.ai_chapters_json);
  return reply.send({
    videoId: row.id,
    processingPhase: row.processing_phase,
    processingProgress: row.processing_progress,
    resultKey: row.result_key,
    thumbnailKey: row.thumbnail_key,
    errorMessage: row.error_message,
    transcriptionStatus: row.transcription_status,
    aiStatus: row.ai_status,
    transcriptErrorMessage: row.transcription_dead_error,
    aiErrorMessage: row.ai_dead_error,
    transcript: row.transcript_vtt_key
      ? {
        provider: row.transcript_provider,
        language: row.transcript_language,
        vttKey: row.transcript_vtt_key,
        text: transcriptText,
        segments: Array.isArray(row.transcript_segments_json) ? row.transcript_segments_json : []
      }
      : null,
    aiOutput:
      row.ai_provider || row.ai_model || row.ai_title || row.ai_summary || keyPoints.length > 0
        ? {
          provider: row.ai_provider,
          model: row.ai_model,
          title: row.ai_title,
          summary: row.ai_summary,
          keyPoints
        }
        : null
  });
});

app.patch<{ Params: { id: string }; Body: { title?: string | null; transcriptText?: string | null } }>("/api/videos/:id/watch-edits", async (req, reply) => {
  const videoId = req.params.id;
  const idempotencyKey = req.headers["idempotency-key"];
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    return reply.code(400).send(badRequest("Missing Idempotency-Key header"));
  }

  const titleProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "title");
  const transcriptProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "transcriptText");
  if (!titleProvided && !transcriptProvided) {
    return reply.code(400).send(badRequest("At least one field must be provided: title, transcriptText"));
  }

  const title = titleProvided ? String(req.body?.title ?? "").trim() : null;
  const transcriptText = transcriptProvided ? String(req.body?.transcriptText ?? "").trim() : null;
  const endpointKey = `/api/videos/${videoId}/watch-edits`;
  const requestHash = sha256Hex(JSON.stringify({ videoId, title: titleProvided ? title : undefined, transcriptText: transcriptProvided ? transcriptText : undefined }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const idempotencyInsert = await client.query<{ endpoint: string; idempotency_key: string }>(
      `INSERT INTO idempotency_keys (endpoint, idempotency_key, request_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '24 hours')
       ON CONFLICT DO NOTHING
       RETURNING endpoint, idempotency_key`,
      [endpointKey, idempotencyKey, requestHash]
    );

    if (idempotencyInsert.rowCount === 0) {
      const existingKey = await client.query<{ request_hash: string; status_code: number | null; response_body: unknown }>(
        `SELECT request_hash, status_code, response_body
         FROM idempotency_keys
         WHERE endpoint = $1 AND idempotency_key = $2`,
        [endpointKey, idempotencyKey]
      );

      if (existingKey.rowCount === 0) {
        return { statusCode: 409, body: badRequest("Idempotency key collision") };
      }

      const row = existingKey.rows[0]!;
      if (row.request_hash !== requestHash) {
        return { statusCode: 409, body: badRequest("Idempotency key reuse with different request payload") };
      }

      if (typeof row.status_code === "number" && row.response_body && typeof row.response_body === "object") {
        return { statusCode: row.status_code, body: row.response_body as Record<string, unknown> };
      }

      return { statusCode: 409, body: badRequest("Duplicate request still in progress") };
    }

    const videoLookup = await client.query<{ id: string }>(
      `SELECT id
       FROM videos
       WHERE id = $1::uuid
         AND deleted_at IS NULL`,
      [videoId]
    );
    if (videoLookup.rowCount === 0) {
      const body = { ok: false, error: "Video not found" };
      await client.query(
        `UPDATE idempotency_keys
         SET status_code = 404, response_body = $3::jsonb
         WHERE endpoint = $1 AND idempotency_key = $2`,
        [endpointKey, idempotencyKey, JSON.stringify(body)]
      );
      return { statusCode: 404, body };
    }

    let titleUpdated = false;
    let transcriptUpdated = false;

    if (titleProvided) {
      const aiLookup = await client.query<{ video_id: string }>(`SELECT video_id FROM ai_outputs WHERE video_id = $1::uuid`, [videoId]);
      if ((aiLookup.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE ai_outputs
           SET title = $2, updated_at = now()
           WHERE video_id = $1::uuid`,
          [videoId, title && title.length > 0 ? title : null]
        );
        titleUpdated = true;
      }
    }

    if (transcriptProvided) {
      const transcriptLookup = await client.query<{ segments_json: unknown }>(
        `SELECT segments_json FROM transcripts WHERE video_id = $1::uuid`,
        [videoId]
      );
      if ((transcriptLookup.rowCount ?? 0) > 0) {
        const normalizedSegments = normalizeEditableTranscriptSegments(transcriptLookup.rows[0]?.segments_json ?? [], transcriptText ?? "");
        await client.query(
          `UPDATE transcripts
           SET segments_json = $2::jsonb, updated_at = now()
           WHERE video_id = $1::uuid`,
          [videoId, JSON.stringify(normalizedSegments)]
        );
        transcriptUpdated = true;
      }
    }

    const body = {
      ok: true,
      videoId,
      updated: {
        title: titleUpdated,
        transcript: transcriptUpdated
      }
    };

    await client.query(
      `UPDATE idempotency_keys
       SET status_code = 200, response_body = $3::jsonb
       WHERE endpoint = $1 AND idempotency_key = $2`,
      [endpointKey, idempotencyKey, JSON.stringify(body)]
    );

    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});

app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId)) {
    return reply.code(400).send(badRequest("Invalid job id"));
  }

  const result = await query(
    env.DATABASE_URL,
    `SELECT id, video_id, job_type, status, attempts, locked_by, locked_until, lease_token, run_after, last_error, updated_at
     FROM job_queue
     WHERE id = $1`,
    [jobId]
  );

  if (result.rowCount === 0) {
    return reply.code(404).send({ ok: false, error: "Job not found" });
  }

  return reply.send(result.rows[0]);
});

app.post<{ Body: { videoId: string; contentType: string } }>("/api/uploads/multipart/initiate", async (req, reply) => {
  const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
  if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

  const { videoId, contentType } = req.body ?? ({} as any);
  if (!videoId || !contentType) return reply.code(400).send(badRequest("videoId and contentType are required"));

  const endpointKey = "/api/uploads/multipart/initiate";
  const requestHash = sha256Hex(JSON.stringify({ videoId, contentType }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const begin = await idempotencyBegin({ client, endpoint: endpointKey, idempotencyKey, requestHash, ttlInterval: "24 hours" });
    if (begin.kind === "cached" || begin.kind === "conflict") return { statusCode: begin.statusCode, body: begin.body };

    const uploadLookup = await client.query<{ raw_key: string }>(
      `SELECT raw_key FROM uploads WHERE video_id = $1::uuid`,
      [videoId]
    );

    if (uploadLookup.rowCount === 0) {
      const body = { ok: false, error: "Upload record not found" };
      await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 404, body });
      return { statusCode: 404, body };
    }

    const rawKey = uploadLookup.rows[0]!.raw_key;
    const { client: s3Client, bucket } = getS3ClientAndBucket();

    const multCommand = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: rawKey,
      ContentType: contentType
    });
    const { UploadId } = await s3Client.send(multCommand);

    if (!UploadId) throw new Error("Failed to initiate multipart upload: No UploadId returned");

    await client.query(
      `UPDATE uploads 
       SET mode = 'multipart', multipart_upload_id = $2, phase = 'uploading', updated_at = now()
       WHERE video_id = $1::uuid`,
      [videoId, UploadId]
    );

    const body = { ok: true, videoId, uploadId: UploadId, rawKey };
    await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 200, body });
    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});

app.post<{ Body: { videoId: string; partNumber: number } }>("/api/uploads/multipart/presign-part", async (req, reply) => {
  const { videoId, partNumber } = req.body ?? ({} as any);
  if (!videoId || !partNumber) return reply.code(400).send(badRequest("videoId and partNumber are required"));

  const uploadLookup = await query<{ raw_key: string; multipart_upload_id: string }>(
    env.DATABASE_URL,
    `SELECT raw_key, multipart_upload_id FROM uploads WHERE video_id = $1::uuid AND mode = 'multipart'`,
    [videoId]
  );

  if (uploadLookup.rowCount === 0 || !uploadLookup.rows[0]?.multipart_upload_id) {
    return reply.code(404).send({ ok: false, error: "Multipart upload not found or not in multipart mode" });
  }

  const { raw_key: rawKey, multipart_upload_id: uploadId } = uploadLookup.rows[0]!;
  const { client: s3Client, bucket } = getS3ClientAndBucket();

  const partCommand = new UploadPartCommand({
    Bucket: bucket,
    Key: rawKey,
    UploadId: uploadId,
    PartNumber: partNumber
  });

  const putUrl = await getSignedUrl(s3Client, partCommand, { expiresIn: 3600 });
  return reply.send({ ok: true, videoId, partNumber, putUrl });
});

app.post<{ Body: { videoId: string; parts: Array<{ ETag: string; PartNumber: number }> } }>("/api/uploads/multipart/complete", async (req, reply) => {
  const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
  if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

  const { videoId, parts } = req.body ?? ({} as any);
  if (!videoId || !Array.isArray(parts)) return reply.code(400).send(badRequest("videoId and parts array are required"));

  const endpointKey = "/api/uploads/multipart/complete";
  const requestHash = sha256Hex(JSON.stringify({ videoId, parts }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const begin = await idempotencyBegin({ client, endpoint: endpointKey, idempotencyKey, requestHash, ttlInterval: "24 hours" });
    if (begin.kind === "cached" || begin.kind === "conflict") return { statusCode: begin.statusCode, body: begin.body };

    const uploadLookup = await client.query<{ raw_key: string; multipart_upload_id: string }>(
      `SELECT raw_key, multipart_upload_id FROM uploads WHERE video_id = $1::uuid AND mode = 'multipart' FOR UPDATE`,
      [videoId]
    );

    if (uploadLookup.rowCount === 0 || !uploadLookup.rows[0]?.multipart_upload_id) {
      const body = { ok: false, error: "Multipart upload record not found" };
      await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 404, body });
      return { statusCode: 404, body };
    }

    const { raw_key: rawKey, multipart_upload_id: uploadId } = uploadLookup.rows[0]!;
    const { client: s3Client, bucket } = getS3ClientAndBucket();

    // S3 expects MultipartUpload with Parts sorted by PartNumber
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: rawKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts
      }
    });

    await s3Client.send(completeCommand);

    await client.query(
      `UPDATE uploads 
       SET phase = 'uploaded', etag_manifest = $2::jsonb, updated_at = now()
       WHERE video_id = $1::uuid`,
      [videoId, JSON.stringify(sortedParts)]
    );

    await client.query(
      `UPDATE videos
       SET processing_phase = 'queued', processing_phase_rank = 10, processing_progress = GREATEST(processing_progress, 5), updated_at = now()
       WHERE id = $1::uuid AND processing_phase_rank < 10`,
      [videoId]
    );

    const jobResult = await client.query<{ id: number }>(
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'process_video', 'queued', 100, now(), '{}'::jsonb, $2)
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()
       RETURNING id`,
      [videoId, env.WORKER_MAX_ATTEMPTS]
    );

    const body = { ok: true, videoId, jobId: Number(jobResult.rows[0]!.id), status: "uploaded" };
    await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 200, body });
    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});

app.post<{ Body: { videoId: string } }>("/api/uploads/multipart/abort", async (req, reply) => {
  const { videoId } = req.body ?? ({} as any);
  if (!videoId) return reply.code(400).send(badRequest("videoId is required"));

  const uploadLookup = await query<{ raw_key: string; multipart_upload_id: string }>(
    env.DATABASE_URL,
    `SELECT raw_key, multipart_upload_id FROM uploads WHERE video_id = $1::uuid AND mode = 'multipart'`,
    [videoId]
  );

  if (uploadLookup.rowCount === 0 || !uploadLookup.rows[0]?.multipart_upload_id) {
    return reply.code(404).send({ ok: false, error: "Multipart upload not found" });
  }

  const { raw_key: rawKey, multipart_upload_id: uploadId } = uploadLookup.rows[0]!;
  const { client: s3Client, bucket } = getS3ClientAndBucket();

  const abortCommand = new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: rawKey,
    UploadId: uploadId
  });

  await s3Client.send(abortCommand);

  await query(
    env.DATABASE_URL,
    `UPDATE uploads SET phase = 'aborted', updated_at = now() WHERE video_id = $1::uuid`,
    [videoId]
  );

  return reply.send({ ok: true, videoId });
});
app.get("/api/playlist", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.post<{ Params: { id: string } }>("/api/videos/:id/delete", async (req, reply) => {
  const videoId = req.params.id;
  const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
  if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

  const endpointKey = `/api/videos/${videoId}/delete`;
  const requestHash = sha256Hex(JSON.stringify({ videoId, action: "soft_delete" }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const begin = await idempotencyBegin({
      client,
      endpoint: endpointKey,
      idempotencyKey,
      requestHash,
      ttlInterval: "24 hours"
    });

    if (begin.kind === "cached" || begin.kind === "conflict") {
      return { statusCode: begin.statusCode, body: begin.body };
    }

    const videoResult = await client.query<{ id: string; deleted_at: string | null }>(
      `SELECT id, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [videoId]
    );

    if (videoResult.rowCount === 0) {
      const body = { ok: false, error: "Video not found" };
      await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 404, body });
      return { statusCode: 404, body };
    }

    let deletedAt = videoResult.rows[0]!.deleted_at;
    if (!deletedAt) {
      const deleted = await client.query<{ deleted_at: string }>(
        `UPDATE videos
         SET deleted_at = now(),
             updated_at = now()
         WHERE id = $1::uuid
         RETURNING deleted_at`,
        [videoId]
      );
      deletedAt = deleted.rows[0]!.deleted_at;

      // Enqueue a cleanup job to remove S3 artifacts, delayed by 5 minutes
      // to give any in-flight requests time to finish and to allow a brief
      // window for accidental deletion recovery in the future.
      await client.query(
        `INSERT INTO job_queue (job_type, video_id, status, run_after)
         VALUES ('cleanup_artifacts', $1::uuid, 'queued', now() + interval '5 minutes')`,
        [videoId]
      );
    }

    const body = {
      ok: true,
      videoId,
      deletedAt
    };
    await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 200, body });
    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});
app.post<{ Params: { id: string } }>("/api/videos/:id/retry", async (req, reply) => {
  const videoId = req.params.id;
  const idempotencyKey = req.headers["idempotency-key"];
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    return reply.code(400).send(badRequest("Missing Idempotency-Key header"));
  }

  const endpointKey = `/api/videos/${videoId}/retry`;
  const requestHash = sha256Hex(JSON.stringify({ videoId, action: "retry" }));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    // 1. Idempotency Check
    const idemp = await client.query(
      `INSERT INTO idempotency_keys (endpoint, idempotency_key, request_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '24 hours')
       ON CONFLICT DO NOTHING
       RETURNING endpoint, idempotency_key`,
      [endpointKey, idempotencyKey, requestHash]
    );

    if (idemp.rowCount === 0) {
      const existing = await client.query(
        `SELECT request_hash, status_code, response_body
         FROM idempotency_keys
         WHERE endpoint = $1 AND idempotency_key = $2`,
        [endpointKey, idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) {
        const row = existing.rows[0];
        if (row.request_hash !== requestHash) return { statusCode: 409, body: badRequest("Idempotency key reuse with different payload") };
        if (row.status_code) return { statusCode: row.status_code, body: row.response_body };
        return { statusCode: 409, body: badRequest("Duplicate request still in progress") };
      }
      return { statusCode: 409, body: badRequest("Idempotency key collision") };
    }

    // 2. Video existence
    const videoResult = await client.query(
      `SELECT id, transcription_status, ai_status
       FROM videos
       WHERE id = $1::uuid
         AND deleted_at IS NULL
       FOR UPDATE`,
      [videoId]
    );
    if (videoResult.rowCount === 0) {
      const body = { ok: false, error: "Video not found" };
      await client.query(`UPDATE idempotency_keys SET status_code = 404, response_body = $3::jsonb WHERE endpoint = $1 AND idempotency_key = $2`, [endpointKey, idempotencyKey, JSON.stringify(body)]);
      return { statusCode: 404, body };
    }

    const video = videoResult.rows[0];
    const jobsReset: string[] = [];

    // 3. Reset Transcription Job if failed/dead
    if (["failed", "dead", "not_started"].includes(video.transcription_status) || video.transcription_status === "processing") {
      const res = await client.query(
        `UPDATE job_queue
         SET status = 'queued',
             attempts = 0,
             run_after = now(),
             last_error = NULL,
             updated_at = now()
         WHERE video_id = $1::uuid AND job_type = 'transcribe_video'
           AND status IN ('failed', 'dead', 'running', 'leased')`,
        [videoId]
      );
      if ((res.rowCount ?? 0) > 0) {
        jobsReset.push("transcribe_video");
        await client.query(`UPDATE videos SET transcription_status = 'queued', updated_at = now() WHERE id = $1::uuid`, [videoId]);
      }
    }

    // 4. Reset AI Job if failed/dead
    if (["failed", "dead", "not_started"].includes(video.ai_status) || video.ai_status === "processing") {
      const res = await client.query(
        `UPDATE job_queue
         SET status = 'queued',
             attempts = 0,
             run_after = now(),
             last_error = NULL,
             updated_at = now()
         WHERE video_id = $1::uuid AND job_type = 'generate_ai'
           AND status IN ('failed', 'dead', 'running', 'leased')`,
        [videoId]
      );
      if ((res.rowCount ?? 0) > 0) {
        jobsReset.push("generate_ai");
        await client.query(`UPDATE videos SET ai_status = 'queued', updated_at = now() WHERE id = $1::uuid`, [videoId]);
      }
    }

    // 5. Success
    const body = { ok: true, videoId, jobsReset };
    await client.query(`UPDATE idempotency_keys SET status_code = 200, response_body = $3::jsonb WHERE endpoint = $1 AND idempotency_key = $2`, [endpointKey, idempotencyKey, JSON.stringify(body)]);
    return { statusCode: 200, body };
  });

  return reply.code(result.statusCode).send(result.body);
});

app.post(
  "/api/webhooks/media-server/progress",
  { config: { rawBody: true } },
  async (req, reply) => {
    const timestamp = req.headers["x-cap-timestamp"];
    const signature = req.headers["x-cap-signature"];
    const deliveryId = req.headers["x-cap-delivery-id"];
    const raw = (req as typeof req & { rawBody?: string }).rawBody;

    if (!timestamp || typeof timestamp !== "string") return reply.code(401).send(badRequest("Missing x-cap-timestamp"));
    if (!signature || typeof signature !== "string") return reply.code(401).send(badRequest("Missing x-cap-signature"));
    if (!deliveryId || typeof deliveryId !== "string") return reply.code(401).send(badRequest("Missing x-cap-delivery-id"));
    if (!raw) return reply.code(400).send(badRequest("Missing raw body"));

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return reply.code(401).send(badRequest("Invalid timestamp"));

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > env.WEBHOOK_MAX_SKEW_SECONDS) {
      return reply.code(401).send(badRequest("Timestamp outside allowed skew"));
    }

    if (!verifyWebhookSignature(raw, timestamp, signature)) {
      return reply.code(401).send(badRequest("Invalid signature"));
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw) as WebhookPayload;
    } catch {
      return reply.code(400).send(badRequest("Invalid JSON payload"));
    }

    const rank = phaseRank(payload.phase);
    if (rank === null) {
      return reply.code(400).send(badRequest("Invalid phase"));
    }

    const progress = Math.max(0, Math.min(100, Math.floor(Number(payload.progress ?? 0))));

    let result: { duplicate: boolean; applied: boolean };
    try {
      result = await withTransaction(env.DATABASE_URL, async (client) => {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO webhook_events (
             source, delivery_id, job_id, video_id, phase, phase_rank, progress, payload, signature, accepted
           ) VALUES (
             'media-server', $1, $2, $3::uuid, $4::processing_phase, $5::smallint, $6::int, $7::jsonb, $8, true
           )
           ON CONFLICT (source, delivery_id) DO NOTHING
           RETURNING id`,
          [deliveryId, payload.jobId, payload.videoId, payload.phase, rank, progress, raw, signature]
        );

        const duplicate = inserted.rowCount === 0;
        let applied = false;

        if (!duplicate) {
          const update = await client.query<{ webhook_url: string | null }>(
            `UPDATE videos v
             SET processing_phase = $2::processing_phase,
                 processing_phase_rank = $3::smallint,
                 processing_progress = CASE
                   WHEN $3::smallint = v.processing_phase_rank THEN GREATEST(v.processing_progress, $4::int)
                   ELSE $4::int
                 END,
                 completed_at = CASE
                   WHEN $2::processing_phase = 'complete' THEN COALESCE(v.completed_at, now())
                   ELSE v.completed_at
                 END,
                 duration_seconds = COALESCE($5::numeric, v.duration_seconds),
                 width = COALESCE($6::int, v.width),
                 height = COALESCE($7::int, v.height),
                 fps = COALESCE($8::numeric, v.fps),
                 updated_at = now()
             WHERE v.id = $1::uuid
               AND (
                 $3::smallint > v.processing_phase_rank
                 OR ($3::smallint = v.processing_phase_rank AND $4::int >= v.processing_progress)
               )
             RETURNING webhook_url`,
            [
              payload.videoId,
              payload.phase,
              rank,
              progress,
              payload.metadata?.duration ?? null,
              payload.metadata?.width ?? null,
              payload.metadata?.height ?? null,
              payload.metadata?.fps ?? null
            ]
          );

          applied = (update.rowCount ?? 0) > 0;

          await client.query(
            `UPDATE webhook_events
             SET processed_at = now(),
                 accepted = $2,
                 reject_reason = CASE WHEN $2 THEN NULL ELSE 'monotonic_guard_rejected' END
             WHERE id = $1`,
            [inserted.rows[0].id, applied]
          );

          if (applied && update.rows[0]?.webhook_url) {
            const webhookUrl = update.rows[0].webhook_url;
            await client.query(
              `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
               VALUES ($1::uuid, 'deliver_webhook', 'queued', 10, now(), $2::jsonb, 5)`,
              [
                payload.videoId,
                JSON.stringify({
                  webhookUrl,
                  event: "video.progress",
                  videoId: payload.videoId,
                  phase: payload.phase,
                  progress
                })
              ]
            );
          }
        }

        return { duplicate, applied };
      });
    } catch (error) {
      log({
        event: "webhook.processing_failed",
        videoId: payload.videoId,
        jobId: payload.jobId,
        error: String(error)
      });
      return reply.code(500).send({ ok: false, error: "Webhook processing failed" });
    }

    log({
      event: "webhook.processed",
      videoId: payload.videoId,
      jobId: payload.jobId,
      duplicate: result.duplicate,
      applied: result.applied,
      phase: payload.phase,
      progress
    });

    return reply.send({ accepted: true, duplicate: result.duplicate, applied: result.applied });
  }
);

await app.listen({ host: "0.0.0.0", port: env.WEB_API_PORT });
log({ event: "server.started", port: env.WEB_API_PORT });
