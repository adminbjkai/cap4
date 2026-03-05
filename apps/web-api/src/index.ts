import crypto from "node:crypto";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@cap/config";
import { query, withTransaction } from "@cap/db";

const env = getEnv();
const app = Fastify({ logger: false });
const uiPublicBucketBase = `${(process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000").replace(/\/$/, "")}/${process.env.S3_BUCKET ?? "cap-v2"}`;

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

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "web-api", ...fields }));
}

function badRequest(message: string) {
  return { ok: false, error: message };
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
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

app.get("/health", async (_req, reply) => {
  try {
    await query(env.DATABASE_URL, "SELECT 1");
    return reply.send({ ok: true });
  } catch (error) {
    log({ event: "health.db_unavailable", error: String(error) });
    return reply.code(503).send({ ok: false });
  }
});

app.get("/", async (_req, reply) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Cap v2 Upload UI</title>
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
  <h1>Cap v2 Milestone 3 UI</h1>
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
        headers: { "Content-Type": "application/json" },
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
  const videoInsert = await query<{ id: string }>(
    env.DATABASE_URL,
    `INSERT INTO videos (name, source_type) VALUES ('Smoke Test Video', 'web_mp4') RETURNING id`
  );
  const videoId = videoInsert.rows[0]!.id;

  const enqueueResult = await query<{ id: number }>(
    env.DATABASE_URL,
    `INSERT INTO job_queue (video_id, job_type, status, priority, payload, max_attempts)
     VALUES ($1::uuid, 'process_video', 'queued', 100, '{}'::jsonb, $2)
     ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [videoId, env.WORKER_MAX_ATTEMPTS]
  );
  const queueJobId = enqueueResult.rows[0]!.id;

  const mediaJobId = crypto.randomUUID();
  const webhookUrl = `${env.WEB_API_BASE_URL}/api/webhooks/media-server/progress`;

  const processRes = await fetch(`${env.MEDIA_SERVER_BASE_URL}/video/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId: mediaJobId,
      videoId,
      outputPresignedUrl: "https://example.invalid/output",
      thumbnailPresignedUrl: "https://example.invalid/thumb",
      webhookUrl
    })
  });

  if (!processRes.ok) {
    const text = await processRes.text();
    return reply.code(500).send({ ok: false, error: "media-server call failed", details: text });
  }

  const timeoutMs = 15000;
  const start = Date.now();
  let finalVideoState: any = null;
  let eventsCount = 0;

  while (Date.now() - start < timeoutMs) {
    const videoResult = await query(
      env.DATABASE_URL,
      `SELECT id, processing_phase, processing_phase_rank, processing_progress, completed_at, updated_at
       FROM videos WHERE id = $1::uuid`,
      [videoId]
    );

    const evResult = await query<{ count: string }>(
      env.DATABASE_URL,
      `SELECT COUNT(*)::text as count FROM webhook_events WHERE video_id = $1::uuid`,
      [videoId]
    );

    finalVideoState = videoResult.rows[0] ?? null;
    eventsCount = Number(evResult.rows[0]?.count ?? "0");

    if (finalVideoState?.processing_phase === "complete" && eventsCount >= 4) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const queueRow = await query(
    env.DATABASE_URL,
    `SELECT id, status, attempts, locked_by, locked_until, lease_token
     FROM job_queue WHERE id = $1`,
    [queueJobId]
  );

  log({ event: "debug.smoke.complete", videoId, jobId: mediaJobId, queuedJobId: queueJobId, webhookEvents: eventsCount });

  return reply.send({
    ok: true,
    videoId,
    mediaJobId,
    queueJobId,
    webhookEvents: eventsCount,
    finalVideo: finalVideoState,
    queueJob: queueRow.rows[0] ?? null
  });
});

app.post<{ Body: { name?: string } }>("/api/videos", async (req, reply) => {
  const name = req.body?.name ?? "Untitled Video";

  const created = await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{ id: string }>(
      `INSERT INTO videos (name, source_type) VALUES ($1, 'web_mp4') RETURNING id`,
      [name]
    );

    const videoId = videoResult.rows[0]!.id;
    const rawKey = `videos/${videoId}/raw/source.mp4`;

    await client.query(
      `INSERT INTO uploads (video_id, mode, phase, raw_key)
       VALUES ($1::uuid, 'singlepart', 'pending', $2)`,
      [videoId, rawKey]
    );

    return { videoId, rawKey };
  });

  return reply.send(created);
});

app.post<{ Body: { videoId: string; contentType?: string } }>("/api/uploads/signed", async (req, reply) => {
  const videoId = req.body?.videoId;
  if (!videoId) return reply.code(400).send(badRequest("videoId is required"));

  const uploadLookup = await query<{ raw_key: string }>(
    env.DATABASE_URL,
    `SELECT raw_key FROM uploads WHERE video_id = $1::uuid`,
    [videoId]
  );
  if (uploadLookup.rowCount === 0) {
    return reply.code(404).send({ ok: false, error: "Upload not found for videoId" });
  }

  const rawKey = uploadLookup.rows[0]!.raw_key;
  const contentType = req.body?.contentType ?? "application/octet-stream";
  const { client, bucket } = getS3ClientAndBucket();

  const putCommand = new PutObjectCommand({
    Bucket: bucket,
    Key: rawKey,
    ContentType: contentType
  });
  const putUrl = await getSignedUrl(client, putCommand, { expiresIn: 900 });

  await query(
    env.DATABASE_URL,
    `UPDATE uploads SET phase = 'uploading', updated_at = now() WHERE video_id = $1::uuid`,
    [videoId]
  );

  return reply.send({
    videoId,
    rawKey,
    method: "PUT",
    putUrl,
    headers: { "Content-Type": contentType }
  });
});

app.post<{ Body: { videoId: string } }>("/api/uploads/complete", async (req, reply) => {
  const videoId = req.body?.videoId;
  if (!videoId) return reply.code(400).send(badRequest("videoId is required"));

  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const uploadResult = await client.query<{ raw_key: string }>(
      `UPDATE uploads
       SET phase = 'uploaded', updated_at = now()
       WHERE video_id = $1::uuid
       RETURNING raw_key`,
      [videoId]
    );

    if (uploadResult.rowCount === 0) {
      return null;
    }

    await client.query(
      `UPDATE videos
       SET processing_phase = 'queued',
           processing_phase_rank = 10,
           processing_progress = 0,
           updated_at = now()
       WHERE id = $1::uuid`,
      [videoId]
    );

    const jobResult = await client.query<{ id: number }>(
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'process_video', 'queued', 100, now(), '{}'::jsonb, $2)
       RETURNING id`,
      [videoId, env.WORKER_MAX_ATTEMPTS]
    );

    return {
      videoId,
      rawKey: uploadResult.rows[0]!.raw_key,
      jobId: Number(jobResult.rows[0]!.id),
      status: "uploaded"
    };
  });

  if (!result) return reply.code(404).send({ ok: false, error: "Upload not found for videoId" });
  return reply.send(result);
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
     WHERE v.id = $1::uuid`,
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

    const videoLookup = await client.query<{ id: string }>(`SELECT id FROM videos WHERE id = $1::uuid`, [videoId]);
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

app.post("/api/uploads/multipart/initiate", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.post("/api/uploads/multipart/presign-part", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.post("/api/uploads/multipart/complete", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.post("/api/uploads/multipart/abort", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.get("/api/playlist", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.post("/api/videos/:videoId/retry-processing", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.post("/api/videos/:videoId/retry-transcription", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));
app.post("/api/videos/:videoId/retry-ai", async (_req, reply) => reply.code(501).send({ ok: false, error: "Not Implemented" }));

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

    const result = await withTransaction(env.DATABASE_URL, async (client) => {
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
        const update = await client.query(
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
             )`,
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
      }

      return { duplicate, applied };
    });

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
