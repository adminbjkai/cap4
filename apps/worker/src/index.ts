import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { PoolClient } from "pg";
import { buildWebVtt } from "./lib/transcript.js";
import { downloadObjectToFile, getS3ClientAndBucket, putObjectBuffer, deleteObjects } from "./lib/s3.js";
import { transcribeWithDeepgram, type TranscriptSegment } from "./providers/deepgram.js";
import { summarizeWithGroq } from "./providers/groq.js";
import { extractAudioFromFile } from "./lib/ffmpeg.js";
import { handleGenerateDocJob } from "./doc/generate-doc.js";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts" | "deliver_webhook" | "generate_doc";

type JobPayload = Record<string, unknown>;

type JobRow = {
  id: number;
  video_id: string;
  job_type: JobType;
  lease_token: string;
  payload: JobPayload;
  attempts: number;
  max_attempts: number;
};

type FailResult = {
  id: number;
  status: "queued" | "dead";
};

const PROCESSING_PHASE_META = {
  queued: { rank: 10, progress: 5 },
  downloading: { rank: 20, progress: 20 },
  probing: { rank: 30, progress: 33 },
  processing: { rank: 40, progress: 60 },
  uploading: { rank: 50, progress: 88 },
  generating_thumbnail: { rank: 60, progress: 95 },
  complete: { rank: 70, progress: 100 },
  failed: { rank: 80, progress: 100 },
  cancelled: { rank: 90, progress: 100 }
} as const;

type ProcessingPhase = keyof typeof PROCESSING_PHASE_META;

const env = getEnv();
const { client: s3Client, bucket: s3Bucket } = getS3ClientAndBucket();

class DeletedVideoSkipError extends Error {
  constructor(videoId: string) {
    super(`video ${videoId} deleted`);
    this.name = "DeletedVideoSkipError";
  }
}

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "worker", event, ...fields }));
}

function payloadString(payload: JobPayload, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isFatalError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "fatal" in error
    && (error as { fatal?: unknown }).fatal === true;
}

function parseTranscriptTextFromSegments(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((segment) => {
      if (!segment || typeof segment !== "object") return "";
      const text = (segment as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();
}

function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return error.message;

  const details: string[] = [];
  const code = "code" in cause ? cause.code : undefined;
  const errno = "errno" in cause ? cause.errno : undefined;
  const syscall = "syscall" in cause ? cause.syscall : undefined;
  const address = "address" in cause ? cause.address : undefined;
  const port = "port" in cause ? cause.port : undefined;

  if (typeof code === "string" && code) details.push(code);
  if (typeof errno === "number") details.push(`errno=${errno}`);
  if (typeof syscall === "string" && syscall) details.push(`syscall=${syscall}`);
  if (typeof address === "string" && address) details.push(`address=${address}`);
  if (typeof port === "number") details.push(`port=${port}`);

  const causeMessage = "message" in cause && typeof cause.message === "string" ? cause.message : "";
  if (causeMessage && causeMessage !== error.message) details.push(causeMessage);

  return details.length > 0 ? `${error.message} (${details.join(", ")})` : error.message;
}

async function waitForDatabaseReady(): Promise<void> {
  while (true) {
    try {
      await withTransaction(env.DATABASE_URL, async (client) => {
        await client.query("SELECT 1");
      });
      log("db.ready", {});
      return;
    } catch (error) {
      log("db.waiting", { error: String(error) });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const CLAIM_SQL = `
WITH candidates AS (
  SELECT id
  FROM job_queue
  WHERE status IN ('queued', 'leased')
    AND run_after <= now()
    AND attempts < max_attempts
    AND (status = 'queued' OR locked_until < now())
  ORDER BY priority DESC, run_after ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE job_queue j
SET status = 'leased',
    locked_by = $2,
    locked_until = now() + $3::interval,
    lease_token = gen_random_uuid(),
    attempts = j.attempts + 1,
    last_attempt_at = now(),
    last_error = NULL,
    updated_at = now()
FROM candidates c
WHERE j.id = c.id
RETURNING j.id, j.video_id, j.job_type, j.lease_token, j.payload, j.attempts, j.max_attempts;
`;

const MARK_RUNNING_SQL = `
UPDATE job_queue
SET status = 'running', updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status = 'leased'
RETURNING id;
`;

const HEARTBEAT_SQL = `
UPDATE job_queue
SET locked_until = now() + $4::interval,
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
  AND locked_until > now()
RETURNING id;
`;

const ACK_SQL = `
UPDATE job_queue
SET status = 'succeeded',
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    finished_at = now(),
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
RETURNING id;
`;

async function ack(client: PoolClient, job: JobRow): Promise<void> {
  const result = await client.query(ACK_SQL, [job.id, env.WORKER_ID, job.lease_token]);
  if (result.rowCount === 0) {
    throw new Error(`unable to ack job ${job.id}: row not found or lease lost`);
  }
}

// Releases a leased/running job back to the queue to run later WITHOUT
// consuming a retry attempt (claiming incremented attempts; undo that).
const SNOOZE_SQL = `
UPDATE job_queue
SET status = 'queued',
    run_after = now() + make_interval(secs => $4),
    attempts = GREATEST(0, attempts - 1),
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
RETURNING id;
`;

async function snooze(client: PoolClient, job: JobRow, delaySeconds: number): Promise<void> {
  const result = await client.query(SNOOZE_SQL, [job.id, env.WORKER_ID, job.lease_token, delaySeconds]);
  if (result.rowCount === 0) {
    throw new Error(`unable to snooze job ${job.id}: row not found or lease lost`);
  }
}

const FAIL_SQL = `
UPDATE job_queue
SET status = (CASE WHEN $5 = true OR attempts >= max_attempts THEN 'dead' ELSE 'queued' END)::job_status,
    run_after = CASE
      WHEN $5 = true OR attempts >= max_attempts THEN run_after
      ELSE now() + make_interval(secs => LEAST(7200, (30 * power(2, GREATEST(0, attempts - 1)))::INT))
    END,
    last_error = $4,
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    finished_at = CASE WHEN $5 = true OR attempts >= max_attempts THEN now() ELSE NULL END,
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
RETURNING id, status;
`;

const RECLAIM_SQL = `
WITH stale AS (
  SELECT id
  FROM job_queue
  WHERE status IN ('leased', 'running')
    AND locked_until < now()
  ORDER BY locked_until ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE job_queue j
SET status = (CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END)::job_status,
    run_after = CASE
      WHEN attempts >= max_attempts THEN run_after
      ELSE now() + make_interval(secs => LEAST(7200, (30 * power(2, GREATEST(0, attempts - 1)))::INT))
    END,
    last_error = COALESCE(last_error, 'Lease expired'),
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
    updated_at = now()
FROM stale s
WHERE j.id = s.id
RETURNING j.id, j.video_id, j.job_type, j.status;
`;

const CLEANUP_MAINTENANCE_SQL = `
DELETE FROM idempotency_keys WHERE expires_at < now();
DELETE FROM webhook_events WHERE created_at < now() - interval '7 days';
`;

async function markRunning(client: PoolClient, job: JobRow): Promise<void> {
  const result = await client.query(MARK_RUNNING_SQL, [job.id, env.WORKER_ID, job.lease_token]);
  if (result.rowCount === 0) {
    throw new Error(`unable to transition job ${job.id} to running`);
  }
}

async function heartbeat(job: JobRow): Promise<boolean> {
  const rowCount = await withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query(HEARTBEAT_SQL, [job.id, env.WORKER_ID, job.lease_token, `${env.WORKER_LEASE_SECONDS} seconds`]);
    return result.rowCount;
  });
  return (rowCount ?? 0) > 0;
}

function startHeartbeatLoop(job: JobRow): () => void {
  let stopped = false;
  let inFlight = false;

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;

    void heartbeat(job)
      .then((alive) => {
        if (!alive) {
          log("job.heartbeat.lost", {
            job_id: job.id,
            video_id: job.video_id,
            job_type: job.job_type
          });
        }
      })
      .catch((error) => {
        log("job.heartbeat.error", {
          job_id: job.id,
          video_id: job.video_id,
          job_type: job.job_type,
          error: String(error)
        });
      })
      .finally(() => {
        inFlight = false;
      });
  }, env.WORKER_HEARTBEAT_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ack is now purely transactional and moved up

async function fail(job: JobRow, error: unknown, fatal = false): Promise<FailResult | null> {
  return withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query<FailResult>(FAIL_SQL, [
      job.id,
      env.WORKER_ID,
      job.lease_token,
      error instanceof Error ? error.message : String(error),
      fatal
    ]);
    return result.rows[0] ?? null;
  });
}

// Optional allowlist of job types this worker claims (WORKER_JOB_TYPES CSV).
// Unset = every type except generate_doc, which needs the `claude` CLI and is
// handled by a dedicated host worker (WORKER_JOB_TYPES=generate_doc).
const allowedJobTypes: JobType[] | null = env.WORKER_JOB_TYPES
  ? (env.WORKER_JOB_TYPES.split(",").map((t) => t.trim()).filter(Boolean) as JobType[])
  : null;

async function claimOne(excludeTypes: JobType[] = []): Promise<JobRow | null> {
  const filters: string[] = [];
  const params: unknown[] = [1, env.WORKER_ID, `${env.WORKER_LEASE_SECONDS} seconds`];
  if (allowedJobTypes) {
    params.push(allowedJobTypes);
    filters.push(`AND job_type = ANY($${params.length}::job_type[])`);
  }
  if (excludeTypes.length > 0) {
    params.push(excludeTypes);
    filters.push(`AND NOT (job_type = ANY($${params.length}::job_type[]))`);
  }
  const sql = filters.length > 0
    ? CLAIM_SQL.replace("WHERE status IN ('queued', 'leased')", `WHERE status IN ('queued', 'leased') ${filters.join(" ")}`)
    : CLAIM_SQL;

  return withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query<JobRow>(sql, params);
    return result.rows[0] ?? null;
  });
}

async function isMediaServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${env.MEDIA_SERVER_BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function runMaintenance(): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    await client.query(CLEANUP_MAINTENANCE_SQL);

    // Watchdog for the async transcode handoff: if media-server accepted a
    // job but never reported completion or failure (crash, lost webhooks),
    // the video would sit at rank 20-60 forever. Past the transcode budget,
    // with no process_video job left in the queue, mark it failed so the UI
    // reaches a terminal state and the Retry button works.
    const stuck = await client.query<{ id: string }>(
      `UPDATE videos v
       SET processing_phase = 'failed',
           processing_phase_rank = 80,
           processing_progress = 100,
           error_message = 'video processing timed out (no completion report from media-server)',
           updated_at = now()
       WHERE v.deleted_at IS NULL
         AND v.processing_phase_rank BETWEEN 20 AND 60
         AND v.updated_at < now() - make_interval(secs => $1)
         AND NOT EXISTS (
           SELECT 1 FROM job_queue j
           WHERE j.video_id = v.id
             AND j.job_type = 'process_video'
             AND j.status IN ('queued', 'leased', 'running')
         )
       RETURNING v.id`,
      [Math.ceil(env.MEDIA_PROCESS_TIMEOUT_MS / 1000)]
    );
    for (const row of stuck.rows) {
      log("maintenance.transcode_watchdog_failed_video", { video_id: row.id });
    }
  });
}

async function markTerminalFailure(job: JobRow, errorMessage: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    if (job.job_type === "process_video") {
      await client.query(
        `UPDATE videos
         SET processing_phase = 'failed',
             processing_phase_rank = 80,
             processing_progress = GREATEST(processing_progress, $3),
             error_message = $2,
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND (
             processing_phase_rank < 80
             OR (processing_phase_rank = 80 AND processing_progress < $3)
           )`,
        [job.video_id, errorMessage, PROCESSING_PHASE_META.failed.progress]
      );
      return;
    }

    if (job.job_type === "transcribe_video") {
      await client.query(
        `UPDATE videos
         SET transcription_status = 'failed',
             ai_status = CASE WHEN ai_status IN ('not_started', 'queued') THEN 'skipped' ELSE ai_status END,
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND transcription_status IN ('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
      return;
    }

    if (job.job_type === "generate_ai") {
      await client.query(
        `UPDATE videos
         SET ai_status = 'failed',
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND ai_status IN ('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
    }
  });
}

async function ensureVideoNotDeleted(job: JobRow, phase: string): Promise<void> {
  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    return client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at
       FROM videos
       WHERE id = $1::uuid`,
      [job.video_id]
    );
  });

  if (result.rowCount === 0) {
    throw new Error(`video ${job.video_id} not found`);
  }

  if (result.rows[0]?.deleted_at) {
    log("job.deleted.skip", {
      job_id: job.id,
      video_id: job.video_id,
      job_type: job.job_type,
      phase
    });
    throw new DeletedVideoSkipError(job.video_id);
  }
}

async function updateProcessingPhase(client: PoolClient, job: JobRow, phase: ProcessingPhase): Promise<boolean> {
  const next = PROCESSING_PHASE_META[phase];
  const result = await client.query<{ id: string }>(
    `UPDATE videos
     SET processing_phase = $2::processing_phase,
         processing_phase_rank = $3,
         processing_progress = GREATEST(processing_progress, $4),
         error_message = CASE WHEN $2::processing_phase = 'failed' THEN error_message ELSE NULL END,
         updated_at = now()
     WHERE id = $1::uuid
       AND deleted_at IS NULL
       AND (
         processing_phase_rank < $3
         OR (processing_phase_rank = $3 AND processing_progress < $4)
       )
     RETURNING id`,
    [job.video_id, phase, next.rank, next.progress]
  );

  if ((result.rowCount ?? 0) > 0) {
    log("job.process.phase_transition", {
      job_id: job.id,
      video_id: job.video_id,
      phase,
      phase_rank: next.rank,
      progress: next.progress
    });
    return true;
  }

  return false;
}

async function handleProcessVideo(job: JobRow): Promise<void> {
  const preProcess = await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{ processing_phase_rank: number; deleted_at: string | null }>(
      `SELECT processing_phase_rank, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found`);
    }

    const videoRow = videoResult.rows[0]!;
    if (videoRow.deleted_at) {
      return { skip: true as const, rawKey: "", reason: "deleted" };
    }

    const currentRank = Number(videoRow.processing_phase_rank ?? 0);
    if (currentRank >= 70) {
      return { skip: true as const, rawKey: "", reason: "already_terminal" };
    }

    const uploadResult = await client.query<{ raw_key: string }>(
      `SELECT raw_key FROM uploads WHERE video_id = $1::uuid`,
      [job.video_id]
    );
    if (uploadResult.rowCount === 0) {
      throw new Error(`no upload row found for video ${job.video_id}`);
    }

    await updateProcessingPhase(client, job, "downloading");

    return { skip: false as const, rawKey: uploadResult.rows[0]!.raw_key, reason: "" };
  });

  if (preProcess.skip) {
    log("job.process.skip", { job_id: job.id, video_id: job.video_id, reason: preProcess.reason });
    await withTransaction(env.DATABASE_URL, async (client) => {
      await ack(client, job);
    });
    return;
  }

  // Hand off to the media-server: it replies 202 immediately and reports
  // phases / completion / failure via signed webhooks to web-api, which owns
  // the finalize logic (result keys, downstream transcription, no-audio).
  // The 202 means the job is accepted, so the queue job is done here; the
  // worker maintenance watchdog catches handoffs that never report back.
  let mediaRes: Response;
  try {
    mediaRes = await fetch(`${env.MEDIA_SERVER_BASE_URL}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
      body: JSON.stringify({
        videoId: job.video_id,
        rawKey: preProcess.rawKey,
        jobId: String(job.id)
      })
    });
  } catch (error) {
    throw new Error(
      `media-server /process request failed for ${env.MEDIA_SERVER_BASE_URL}: ${formatFetchError(error)}`
    );
  }

  if (!mediaRes.ok) {
    const text = await mediaRes.text();
    throw new Error(`media-server /process failed: ${mediaRes.status} ${text}`);
  }

  log("job.process.handoff", { job_id: job.id, video_id: job.video_id });

  await withTransaction(env.DATABASE_URL, async (client) => {
    await ack(client, job);
  });
}

async function handleTranscribeVideo(job: JobRow): Promise<void> {
  const deepgramModel = payloadString(job.payload, "deepgramModel") ?? env.DEEPGRAM_MODEL;

  const prepared = await withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query<{
      result_key: string | null;
      raw_key: string | null;
      transcription_status: string;
      processing_phase_rank: number;
      deleted_at: string | null;
    }>(
      `SELECT v.result_key, u.raw_key, v.transcription_status, v.processing_phase_rank, v.deleted_at
       FROM videos v
       LEFT JOIN uploads u ON u.video_id = v.id
       WHERE v.id = $1::uuid
       FOR UPDATE OF v`,
      [job.video_id]
    );

    if (result.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found`);
    }

    const row = result.rows[0]!;
    if (row.deleted_at) {
      return { skip: true as const, resultKey: "", reason: "deleted" };
    }

    const status = String(row.transcription_status);

    if (status === "complete" || status === "no_audio" || status === "skipped" || status === "failed") {
      return { skip: true as const, resultKey: "", reason: `status_${status}` };
    }

    // Prefer the raw upload: its audio is identical to the transcoded result,
    // and it is available immediately — transcription no longer waits for the
    // transcode. result_key remains as a fallback for legacy rows.
    const mediaKey = row.raw_key ?? row.result_key;
    if (!mediaKey) {
      throw new Error(`no media key (raw or result) for video ${job.video_id}`);
    }

    // While the same video is being transcoded, ffmpeg saturates CPU and
    // bandwidth and the Deepgram upload crawls — defer (no attempt consumed)
    // instead of racing it. Two signals: a process_video job still queued
    // (pre-handoff), or a phase rank of 20-60 (media-server is working on it
    // after the async handoff). A lost transcode can't defer us forever: the
    // maintenance watchdog fails stuck videos past MEDIA_PROCESS_TIMEOUT_MS.
    const phaseRank = Number(row.processing_phase_rank ?? 0);
    const transcodeActive = await client.query(
      `SELECT 1 FROM job_queue
       WHERE video_id = $1::uuid
         AND job_type = 'process_video'
         AND status IN ('queued', 'leased', 'running')
       LIMIT 1`,
      [job.video_id]
    );
    if ((transcodeActive.rowCount ?? 0) > 0 || (phaseRank >= 20 && phaseRank <= 60)) {
      return { skip: false as const, defer: true as const, resultKey: "", reason: "transcode_in_progress" };
    }

    await client.query(
      `UPDATE videos
       SET transcription_status = 'processing',
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND transcription_status IN ('queued', 'not_started')`,
      [job.video_id]
    );

    return { skip: false as const, resultKey: mediaKey, reason: "" };
  });

  if (prepared.skip) {
    log("job.transcribe.skip", {
      job_id: job.id,
      video_id: job.video_id,
      reason: prepared.reason
    });
    await withTransaction(env.DATABASE_URL, async (client) => {
      await ack(client, job);
    });
    return;
  }

  if ("defer" in prepared && prepared.defer) {
    log("job.transcribe.deferred", {
      job_id: job.id,
      video_id: job.video_id,
      reason: prepared.reason
    });
    await withTransaction(env.DATABASE_URL, async (client) => {
      await snooze(client, job, 15);
    });
    return;
  }

  if (!env.DEEPGRAM_API_KEY) {
    throw new Error("Missing DEEPGRAM_API_KEY in worker environment");
  }

  // Stream the source to disk (it can be GBs — never buffer it in memory),
  // then extract a compact mp3: Deepgram only needs the audio track, so the
  // upload shrinks ~20-50x versus sending the whole video.
  const mediaPath = join(tmpdir(), `cap4-transcribe-${randomUUID()}`);
  let audioBuffer: Buffer;
  let extractedAudio = true;
  try {
    await downloadObjectToFile(s3Client, s3Bucket, prepared.resultKey, mediaPath);
    try {
      audioBuffer = await extractAudioFromFile(mediaPath);
    } catch (err) {
      log("job.transcribe.audio_extraction_failed", {
        video_id: job.video_id,
        error: err instanceof Error ? err.message : String(err)
      });
      // Fallback: send the original media so an ffmpeg hiccup can't kill
      // transcription outright. Deepgram accepts video containers too.
      audioBuffer = await fs.readFile(mediaPath);
      extractedAudio = false;
    }
  } finally {
    await fs.rm(mediaPath, { force: true }).catch(() => undefined);
  }

  const transcription = await transcribeWithDeepgram({
    apiKey: env.DEEPGRAM_API_KEY,
    baseUrl: env.DEEPGRAM_BASE_URL,
    model: deepgramModel,
    timeoutMs: env.TRANSCRIBE_TIMEOUT_MS,
    mediaBuffer: audioBuffer,
    mediaContentType: extractedAudio ? "audio/mpeg" : "application/octet-stream"
  });

  if (!transcription.transcriptText.trim()) {
    await withTransaction(env.DATABASE_URL, async (client) => {
      await client.query(
        `UPDATE videos
         SET transcription_status = 'no_audio',
             ai_status = CASE WHEN ai_status IN ('not_started', 'queued') THEN 'skipped' ELSE ai_status END,
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND transcription_status IN ('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
      await ack(client, job);
    });

    log("job.transcribe.no_audio", {
      job_id: job.id,
      video_id: job.video_id
    });
    return;
  }

  const segments: TranscriptSegment[] = transcription.segments;
  const vttText = buildWebVtt(segments);
  const vttKey = `videos/${job.video_id}/transcript/transcript.vtt`;

  await ensureVideoNotDeleted(job, "transcribe_before_vtt_upload");
  await putObjectBuffer(s3Client, s3Bucket, vttKey, Buffer.from(vttText, "utf8"), "text/vtt; charset=utf-8");

  await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{ ai_status: string; deleted_at: string | null }>(
      `SELECT ai_status, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found during transcription finalize`);
    }

    if (videoResult.rows[0]!.deleted_at) {
      log("job.transcribe.skip", {
        job_id: job.id,
        video_id: job.video_id,
        reason: "deleted_during_finalize"
      });
      await ack(client, job);
      return;
    }

    await client.query(
      `INSERT INTO transcripts (video_id, provider, language, vtt_key, segments_json)
       VALUES ($1::uuid, 'deepgram', COALESCE($2, 'en'), $3, $4::jsonb)
       ON CONFLICT (video_id)
       DO UPDATE SET
         provider = EXCLUDED.provider,
         language = COALESCE(EXCLUDED.language, 'en'),
         vtt_key = EXCLUDED.vtt_key,
         segments_json = EXCLUDED.segments_json,
         updated_at = now()`,
      [job.video_id, transcription.language, vttKey, JSON.stringify(segments)]
    );

    const updateResult = await client.query<{ ai_status: string; webhook_url: string | null }>(
      `UPDATE videos
       SET transcription_status = 'complete',
           ai_status = CASE WHEN ai_status = 'not_started' THEN 'queued' ELSE ai_status END,
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND transcription_status IN ('processing', 'queued', 'not_started')
       RETURNING ai_status, webhook_url`,
      [job.video_id]
    );

    const row = updateResult.rows[0];
    const aiStatus = row?.ai_status;

    if (row?.webhook_url) {
      await client.query(
        `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
         VALUES ($1::uuid, 'deliver_webhook', 'queued', 10, now(), $2::jsonb, 5)
         ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [job.video_id, JSON.stringify({ webhookUrl: row.webhook_url, event: "video.transcription_complete", videoId: job.video_id })]
      );
    }

    if (aiStatus !== "queued") {
      await ack(client, job);
      return;
    }

    // First try to reset any existing dead job
    const resetResult = await client.query(
      `UPDATE job_queue
       SET status = 'queued',
           attempts = 0,
           run_after = now(),
           last_error = NULL,
           updated_at = now()
       WHERE video_id = $1::uuid
         AND job_type = 'generate_ai'
         AND status = 'dead'
       RETURNING id`,
      [job.video_id]
    );

    // If no dead job was reset, insert a new one
    if ((resetResult.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
         VALUES ($1::uuid, 'generate_ai', 'queued', 90, now(), '{}'::jsonb, $2)
         ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
         DO UPDATE SET updated_at = now()`,
        [job.video_id, env.WORKER_MAX_ATTEMPTS]
      );
    }

    await ack(client, job);
  });

  log("job.transcribe.complete", {
    job_id: job.id,
    video_id: job.video_id,
    language: transcription.language,
    segments: transcription.segments.length
  });
}

async function handleGenerateAi(job: JobRow): Promise<void> {
  const groqModel = payloadString(job.payload, "groqModel") ?? env.GROQ_MODEL;

  const transcriptRecord = await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{
      ai_status: string;
      transcription_status: string;
      deleted_at: string | null;
    }>(
      `SELECT ai_status, transcription_status, deleted_at
       FROM videos
       WHERE id = $1:: uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found`);
    }

    const row = videoResult.rows[0]!;
    if (row.deleted_at) {
      return { skip: true as const, reason: "deleted", segmentsJson: null as unknown };
    }

    const transcriptResult = await client.query<{ segments_json: unknown }>(
      `SELECT segments_json FROM transcripts WHERE video_id = $1:: uuid`,
      [job.video_id]
    );

    if (row.ai_status === "complete" || row.ai_status === "skipped" || row.ai_status === "failed") {
      return { skip: true as const, reason: `status_${row.ai_status} `, segmentsJson: null as unknown };
    }

    if (row.transcription_status === "no_audio" || row.transcription_status === "skipped" || row.transcription_status === "failed") {
      await client.query(
        `UPDATE videos
         SET ai_status = 'skipped',
      updated_at = now()
         WHERE id = $1:: uuid
           AND deleted_at IS NULL
           AND ai_status IN('not_started', 'queued', 'processing')`,
        [job.video_id]
      );
      return { skip: true as const, reason: `transcription_${row.transcription_status} `, segmentsJson: null as unknown };
    }

    await client.query(
      `UPDATE videos
       SET ai_status = 'processing',
      updated_at = now()
       WHERE id = $1:: uuid
         AND deleted_at IS NULL
         AND ai_status IN('queued', 'not_started')`,
      [job.video_id]
    );

    return { skip: false as const, reason: "", segmentsJson: transcriptResult.rows[0]?.segments_json ?? null };
  });

  if (transcriptRecord.skip) {
    log("job.ai.skip", {
      job_id: job.id,
      video_id: job.video_id,
      reason: transcriptRecord.reason
    });
    await withTransaction(env.DATABASE_URL, async (client) => {
      await ack(client, job);
    });
    return;
  }

  if (!env.GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY in worker environment");
  }

  const transcriptText = parseTranscriptTextFromSegments(transcriptRecord.segmentsJson);
  if (!transcriptText) {
    await withTransaction(env.DATABASE_URL, async (client) => {
      await client.query(
        `UPDATE videos
         SET ai_status = 'skipped',
      updated_at = now()
         WHERE id = $1:: uuid
           AND deleted_at IS NULL
           AND ai_status IN('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
      await ack(client, job);
    });

    log("job.ai.skip", {
      job_id: job.id,
      video_id: job.video_id,
      reason: "empty_transcript"
    });
    return;
  }

  const summary = await summarizeWithGroq({
    apiKey: env.GROQ_API_KEY,
    baseUrl: env.GROQ_BASE_URL,
    model: groqModel,
    timeoutMs: env.PROVIDER_TIMEOUT_MS,
    transcript: transcriptText
  });

  // Use AI-generated chapters if available, otherwise fall back to key points
  const chaptersJson = summary.chapters.length > 0 
    ? summary.chapters.map((chapter, index) => ({
        order: index + 1,
        point: chapter.title,
        startSeconds: chapter.start
      }))
    : summary.keyPoints.map((point: string, index: number) => ({
        order: index + 1,
        point
      }));

  await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at
       FROM videos
       WHERE id = $1:: uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found during ai finalize`);
    }

    if (videoResult.rows[0]!.deleted_at) {
      log("job.ai.skip", {
        job_id: job.id,
        video_id: job.video_id,
        reason: "deleted_during_finalize"
      });
      await ack(client, job);
      return;
    }

    await client.query(
      `INSERT INTO ai_outputs(video_id, provider, model, title, summary, chapters_json, entities_json, action_items_json, quotes_json)
    VALUES($1:: uuid, 'groq', $2, $3, $4, $5:: jsonb, $6:: jsonb, $7:: jsonb, $8:: jsonb)
       ON CONFLICT(video_id)
       DO UPDATE SET
    provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      chapters_json = EXCLUDED.chapters_json,
      entities_json = EXCLUDED.entities_json,
      action_items_json = EXCLUDED.action_items_json,
      quotes_json = EXCLUDED.quotes_json,
      updated_at = now()`,
      [
        job.video_id,
        summary.model,
        summary.title,
        summary.summary,
        JSON.stringify(chaptersJson),
        summary.entities ? JSON.stringify(summary.entities) : null,
        summary.actionItems ? JSON.stringify(summary.actionItems) : null,
        summary.quotes ? JSON.stringify(summary.quotes) : null
      ]
    );

    const updateResult = await client.query<{ webhook_url: string | null }>(
      `UPDATE videos
       SET ai_status = 'complete',
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND ai_status IN ('processing', 'queued', 'not_started')
       RETURNING webhook_url`,
      [job.video_id]
    );

    const row = updateResult.rows[0];
    if (row && row.webhook_url) {
      await client.query(
        `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
         VALUES ($1::uuid, 'deliver_webhook', 'queued', 10, now(), $2::jsonb, 5)
         ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [job.video_id, JSON.stringify({ webhookUrl: row.webhook_url, event: "video.ai_complete", videoId: job.video_id })]
      );
    }

    await ack(client, job);
  });

  log("job.ai.complete", {
    job_id: job.id,
    video_id: job.video_id,
    points: summary.keyPoints.length,
    model: summary.model
  });
}

async function handleJob(job: JobRow): Promise<void> {
  log("job.handler.start", { job_id: job.id, video_id: job.video_id, job_type: job.job_type, attempt: job.attempts });
  await ensureVideoNotDeleted(job, "before_handle");

  if (job.job_type === "process_video") {
    await handleProcessVideo(job);
    return;
  }

  if (job.job_type === "transcribe_video") {
    await handleTranscribeVideo(job);
    return;
  }

  if (job.job_type === "generate_ai") {
    await handleGenerateAi(job);
    return;
  }

  if (job.job_type === "cleanup_artifacts") {
    await handleCleanupArtifacts(job);
    return;
  }

  if (job.job_type === "deliver_webhook") {
    await handleDeliverWebhook(job);
    return;
  }

  if (job.job_type === "generate_doc") {
    await handleGenerateDocJob(job, {
      env,
      s3Client,
      s3Bucket,
      ackJob: () =>
        withTransaction(env.DATABASE_URL, async (client) => {
          await ack(client, job);
        }),
      log
    });
    return;
  }

  throw new Error(`unsupported job type: ${job.job_type} `);
}

async function handleDeliverWebhook(job: JobRow): Promise<void> {
  const payload = job.payload as { webhookUrl?: string; event?: string; videoId?: string; phase?: string; progress?: number };
  if (!payload.webhookUrl) {
    throw new Error("Missing webhookUrl in deliver_webhook payload");
  }

  const body = JSON.stringify({
    event: payload.event,
    videoId: payload.videoId,
    phase: payload.phase,
    progress: payload.progress,
    timestamp: new Date().toISOString()
  });

  try {
    const response = await fetch(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed with status ${response.status}`);
    }

    log("job.webhook.delivered", { job_id: job.id, video_id: job.video_id, event: payload.event });
  } catch (err: unknown) {
    log("job.webhook.delivery_failed", { job_id: job.id, video_id: job.video_id, error: String(err) });
    throw err; // Let it retry
  }

  await withTransaction(env.DATABASE_URL, async (client) => {
    await ack(client, job);
  });
}

async function handleCleanupArtifacts(job: JobRow): Promise<void> {
  const videoId = job.video_id;

  const keysToDelete: string[] = [];

  await withTransaction(env.DATABASE_URL, async (client) => {
    // Get keys from videos table (result, thumbnail)
    const videoResult = await client.query<{
      thumbnail_key: string | null;
      result_key: string | null;
    }>(
      `SELECT thumbnail_key, result_key
       FROM videos
       WHERE id = $1::uuid`,
      [videoId]
    );

    if (videoResult.rowCount != null && videoResult.rowCount > 0 && videoResult.rows[0]) {
      const row = videoResult.rows[0];
      if (row.thumbnail_key) keysToDelete.push(row.thumbnail_key);
      if (row.result_key) keysToDelete.push(row.result_key);
    }

    // Get raw_key from uploads table
    const uploadResult = await client.query<{
      raw_key: string | null;
    }>(
      `SELECT raw_key
       FROM uploads
       WHERE video_id = $1::uuid`,
      [videoId]
    );

    for (const row of uploadResult.rows) {
      if (row.raw_key) keysToDelete.push(row.raw_key);
    }

    // Get vtt_key from transcripts table
    const transcriptResult = await client.query<{
      vtt_key: string | null;
    }>(
      `SELECT vtt_key
       FROM transcripts
       WHERE video_id = $1::uuid`,
      [videoId]
    );

    for (const row of transcriptResult.rows) {
      if (row.vtt_key) keysToDelete.push(row.vtt_key);
    }
  });

  if (keysToDelete.length > 0) {
    const { client: s3Client, bucket } = getS3ClientAndBucket(process.env);
    await deleteObjects(s3Client, bucket, keysToDelete);
    log("job.cleanup.deleted_objects", { job_id: job.id, video_id: videoId, count: keysToDelete.length });
  } else {
    log("job.cleanup.no_objects", { job_id: job.id, video_id: videoId });
  }

  await withTransaction(env.DATABASE_URL, async (client) => {
    await ack(client, job);
  });
}

async function processJob(job: JobRow): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    await markRunning(client, job);
  });

  const stopHeartbeat = startHeartbeatLoop(job);

  try {
    const alive = await heartbeat(job);
    if (!alive) {
      throw new Error(`lease expired before handling job ${job.id} `);
    }
    if (job.job_type === "cleanup_artifacts") {
      await handleCleanupArtifacts(job);
      return;
    }

    await handleJob(job);
    log("job.acked", { job_id: job.id, video_id: job.video_id, job_type: job.job_type });
  } catch (error) {
    if (error instanceof DeletedVideoSkipError) {
      await withTransaction(env.DATABASE_URL, async (client) => {
        await ack(client, job);
      });
      log("job.acked", {
        job_id: job.id,
        video_id: job.video_id,
        job_type: job.job_type,
        reason: "video_deleted"
      });
      return;
    }

    const isFatal = isFatalError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failed = await fail(job, errorMessage, isFatal);

    if (failed?.status === "dead") {
      await markTerminalFailure(job, errorMessage);
    }

    log("job.failed", {
      job_id: job.id,
      video_id: job.video_id,
      job_type: job.job_type,
      status: failed?.status ?? "unknown",
      attempts: job.attempts,
      max_attempts: job.max_attempts,
      error: errorMessage
    });
  } finally {
    stopHeartbeat();
  }
}

async function reclaimExpiredLeases(): Promise<void> {
  const reclaimed = await withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query(RECLAIM_SQL, [env.WORKER_CLAIM_BATCH_SIZE]);
    return result.rows;
  });

  for (const row of reclaimed) {
    log("job.reclaimed", {
      job_id: String(row.id),
      video_id: String(row.video_id),
      job_type: String(row.job_type),
      status: String(row.status)
    });

    if (String(row.status) === "dead") {
      await markTerminalFailure(
        {
          id: Number(row.id),
          video_id: String(row.video_id),
          job_type: String(row.job_type) as JobType,
          lease_token: "",
          payload: {},
          attempts: 0,
          max_attempts: 0
        },
        "Lease expired and retry budget exhausted"
      );
    }
  }
}

async function main(): Promise<void> {
  log("worker.started", { worker_id: env.WORKER_ID });
  await waitForDatabaseReady();

  setInterval(() => {
    void reclaimExpiredLeases().catch((error) => {
      log("reclaim.error", { error: String(error) });
    });
  }, env.WORKER_RECLAIM_MS);

  setInterval(() => {
    void runMaintenance().catch((error) => {
      log("maintenance.error", { error: String(error) });
    });
  }, 1000 * 60 * 60); // Run once per hour

  // Two concurrent job slots so transcription (network-bound, reads the raw
  // upload) can overlap the transcode (media-server HTTP call) for the same
  // or different videos. ffmpeg-heavy process_video jobs stay capped at 1.
  const MAX_CONCURRENT_JOBS = 2;
  const inFlight = new Set<Promise<void>>();
  let inFlightProcessVideo = 0;

  // Cache the media-server health probe — previously an HTTP round-trip on
  // every poll tick, even when idle.
  let healthCachedAt = 0;
  let healthCachedValue = true;
  const HEALTH_CACHE_MS = 10_000;
  const checkMediaHealthy = async (): Promise<boolean> => {
    const now = Date.now();
    if (now - healthCachedAt < HEALTH_CACHE_MS) return healthCachedValue;
    healthCachedValue = await isMediaServerHealthy();
    healthCachedAt = now;
    return healthCachedValue;
  };

  while (true) {
    let claimed = false;

    if (inFlight.size < MAX_CONCURRENT_JOBS) {
      const excludeTypes: JobType[] = [];
      if (!allowedJobTypes) {
        excludeTypes.push("generate_doc");
      }
      if (inFlightProcessVideo >= 1) {
        excludeTypes.push("process_video");
      } else if (!allowedJobTypes || allowedJobTypes.includes("process_video")) {
        // Only probe media-server health when this worker can actually claim
        // process_video (the host doc-worker can't reach it and never will).
        const mediaHealthy = await checkMediaHealthy();
        if (!mediaHealthy) {
          excludeTypes.push("process_video");
          log("worker.health.degraded", { reason: "media_server_unhealthy", skipping: excludeTypes });
        }
      }

      const job = await claimOne(excludeTypes);
      if (job) {
        claimed = true;
        log("job.claimed", {
          job_id: job.id,
          video_id: job.video_id,
          job_type: job.job_type,
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          in_flight: inFlight.size + 1
        });
        if (job.job_type === "process_video") inFlightProcessVideo += 1;
        const task: Promise<void> = processJob(job)
          .catch((error) => {
            log("job.unhandled_error", { job_id: job.id, job_type: job.job_type, error: String(error) });
          })
          .finally(() => {
            inFlight.delete(task);
            if (job.job_type === "process_video") inFlightProcessVideo -= 1;
          });
        inFlight.add(task);
      }
    }

    if (claimed) {
      // A job was just claimed (and the one before it may have enqueued a
      // follow-up) — try to claim again immediately instead of sleeping.
      continue;
    }

    // Idle or slots full: wait for the poll interval OR a slot to free up.
    if (inFlight.size > 0) {
      await Promise.race([
        Promise.race(inFlight),
        new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS))
      ]);
    } else {
      await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS));
    }
  }
}

main().catch((error) => {
  log("worker.crash", { error: String(error) });
  process.exit(1);
});
