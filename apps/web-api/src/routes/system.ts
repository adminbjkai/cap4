/**
 * System routes:
 *   GET  /api/system/provider-status
 *   GET  /                            (dev UI)
 *   POST /debug/enqueue              (non-prod)
 *   GET  /debug/job/:id             (non-prod)
 *   POST /debug/videos              (non-prod)
 *   POST /debug/jobs/enqueue        (non-prod)
 *   POST /debug/smoke               (non-prod)
 */

import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query, withTransaction } from "@cap/db";
import {
  badRequest,
  getSystemProviderStatus,
  getInternalS3ClientAndBucket,
  PutObjectCommand,
  JobType,
  ProcessResponse
} from "../lib/shared.js";

const env = getEnv();

const uiPublicBucketBase = `${(process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000").replace(/\/$/, "")}/${process.env.S3_BUCKET ?? "cap4"}`;

function log(app: FastifyInstance, fields: Record<string, unknown>) {
  if (app.serviceLogger) {
    app.serviceLogger.info("web-api log", fields);
  } else {
    console.log(JSON.stringify({ service: "web-api", ...fields }));
  }
}

async function generateTestMp4Buffer(args: { seconds: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const seconds = Math.max(1, Math.floor(args.seconds));
    const child = spawn("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc=size=320x240:rate=25",
      "-f", "lavfi",
      "-i", "sine=frequency=1000:sample_rate=44100",
      "-t", String(seconds),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      // Required for piping MP4 to stdout.
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
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

export async function systemRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------
  // Provider status
  // ------------------------------------------------------------------

  app.get("/api/system/provider-status", async (_req, reply) => {
    try {
      return reply.send(await getSystemProviderStatus());
    } catch (error) {
      log(app, { event: "provider_status.unavailable", error: String(error) });
      return reply.code(503).send({ ok: false, error: "Provider status unavailable" });
    }
  });

  // ------------------------------------------------------------------
  // Root dev UI
  // ------------------------------------------------------------------

  app.get("/", async (_req, reply) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Cap4 Upload UI</title>
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
  <h1>Cap4 Dev UI</h1>
  <p class="muted">Runs full upload flow: create video, request signed PUT, upload file, complete upload, poll status.</p>
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

  // ------------------------------------------------------------------
  // Debug routes (non-production only)
  // ------------------------------------------------------------------

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

      log(app, { event: "debug.enqueue.created", videoId, jobId });
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
      log(app, { event: "debug.video.created", videoId });
      return reply.send({ ok: true, videoId });
    });

    app.post<{ Body: { videoId: string; jobType: JobType; payload?: Record<string, unknown>; priority?: number; maxAttempts?: number } }>("/debug/jobs/enqueue", async (req, reply) => {
      const videoId = req.body?.videoId;
      const jobType = req.body?.jobType;
      const payload = req.body?.payload;
      const priority = req.body?.priority;
      const maxAttempts = req.body?.maxAttempts;
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
      log(app, { event: "debug.job.enqueued", videoId, jobId, jobType });
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

        const processRes = await fetch(`${env.MEDIA_SERVER_BASE_URL}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: created.videoId,
            rawKey: created.rawKey
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

        log(app, { event: "debug.smoke.complete", videoId: created.videoId, jobId: created.jobId });

        return reply.send({
          ok: true,
          videoId: created.videoId,
          rawKey: created.rawKey,
          jobId: created.jobId,
          media: mediaJson,
          finalVideo: finalVideoResult.rows[0] ?? null,
          queueJob: queueRow.rows[0] ?? null
        });
      } catch (error) {
        log(app, { event: "debug.smoke.error", error: String(error) });
        return reply.code(500).send({ ok: false, error: String(error) });
      }
    });
  }
}
