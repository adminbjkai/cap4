/**
 * Webhook routes:
 *   POST /api/webhooks/media-server/progress — HMAC-verified progress callback
 *
 * Requires rawBody to be registered globally (fastify-raw-body with global: false
 * and { config: { rawBody: true } } on this route).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import {
  badRequest,
  verifyWebhookSignature,
  phaseRank,
  WebhookPayload
} from "../lib/shared.js";

const env = getEnv();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidatedWebhookPayload = {
  jobId: string;
  videoId: string;
  phase: WebhookPayload["phase"];
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

function log(app: FastifyInstance, fields: Record<string, unknown>) {
  if (app.serviceLogger) {
    app.serviceLogger.info("web-api log", fields);
  } else {
    console.log(JSON.stringify({ service: "web-api", ...fields }));
  }
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function validateWebhookPayload(input: unknown): { payload?: ValidatedWebhookPayload; error?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Invalid webhook payload" };
  }

  const record = input as Record<string, unknown>;
  const rawJobId = record.jobId;
  if (!(typeof rawJobId === "string" || typeof rawJobId === "number")) {
    return { error: "Missing or invalid jobId" };
  }
  const jobId = String(rawJobId).trim();
  if (!jobId) {
    return { error: "Missing or invalid jobId" };
  }

  const rawVideoId = typeof record.videoId === "string" ? record.videoId.trim() : "";
  if (!rawVideoId || !UUID_RE.test(rawVideoId)) {
    return { error: "Missing or invalid videoId" };
  }

  const rawPhase = typeof record.phase === "string" ? record.phase : "";
  if (!rawPhase) {
    return { error: "Missing or invalid phase" };
  }
  const rank = phaseRank(rawPhase);
  if (rank === null) {
    return { error: "Invalid phase" };
  }

  const metadataRecord =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : null;
  const metadata = metadataRecord
    ? {
        duration: toOptionalFiniteNumber(metadataRecord.duration),
        width: toOptionalFiniteNumber(metadataRecord.width),
        height: toOptionalFiniteNumber(metadataRecord.height),
        fps: toOptionalFiniteNumber(metadataRecord.fps)
      }
    : undefined;

  return {
    payload: {
      jobId,
      videoId: rawVideoId,
      phase: rawPhase as WebhookPayload["phase"],
      progress: Number(record.progress ?? 0),
      message: typeof record.message === "string" ? record.message : undefined,
      error: typeof record.error === "string" ? record.error : undefined,
      metadata
    }
  };
}

export async function webhookRoutes(app: FastifyInstance) {
  // Register a dedicated webhook content-type parser that returns the raw body as a string.
  // Avoid overriding Fastify's global JSON parser for normal API routes.
  app.addContentTypeParser(
    "application/cap4-webhook+json",
    { parseAs: "buffer" },
    async (_req: FastifyRequest, body: Buffer) => body.toString("utf8")
  );

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
      const WEBHOOK_MAX_SKEW_SECONDS = Number(env.WEBHOOK_MAX_SKEW_SECONDS) || 300;
      if (Math.abs(now - ts) > WEBHOOK_MAX_SKEW_SECONDS) {
        return reply.code(401).send(badRequest("Timestamp outside allowed skew"));
      }

      if (!verifyWebhookSignature(raw, timestamp, signature)) {
        return reply.code(401).send(badRequest("Invalid signature"));
      }

      let parsedPayload: WebhookPayload;
      try {
        parsedPayload = JSON.parse(raw) as WebhookPayload;
      } catch {
        return reply.code(400).send(badRequest("Invalid JSON payload"));
      }

      const validation = validateWebhookPayload(parsedPayload);
      if (!validation.payload) {
        return reply.code(400).send(badRequest(validation.error ?? "Invalid webhook payload"));
      }
      const payload = validation.payload;

      const rank = phaseRank(payload.phase);
      if (rank === null) return reply.code(400).send(badRequest("Invalid phase"));

      const progress = Math.max(0, Math.min(100, Math.floor(Number(payload.progress ?? 0))));

      let result: { duplicate: boolean; applied: boolean };
      try {
        result = await withTransaction(env.DATABASE_URL, async (client) => {
          let duplicate = false;
          let insertedId: number | undefined;

          try {
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

            duplicate = inserted.rowCount === 0;
            insertedId = inserted.rows[0]?.id;
          } catch (err: unknown) {
            if (
              typeof err === "object" &&
              err !== null &&
              "code" in err &&
              (err as { code?: unknown }).code === "23505"
            ) {
              duplicate = true;
            } else {
              throw err;
            }
          }

          if (duplicate && !insertedId) {
            return { duplicate: true, applied: false };
          }

          if (!insertedId) {
            return { duplicate: true, applied: false };
          }

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
              [insertedId, applied]
            );

            if (applied && update.rows[0]?.webhook_url) {
              const webhookUrl = update.rows[0].webhook_url;
              await client.query(
                `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
                 VALUES ($1::uuid, 'deliver_webhook', 'queued', 10, now(), $2::jsonb, 5)
                 ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running') DO UPDATE SET updated_at = now()`,
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
        log(app, {
          event: "webhook.processing_failed",
          videoId: payload.videoId,
          jobId: payload.jobId,
          error: String(error)
        });
        return reply.code(500).send({ ok: false, error: "Webhook processing failed" });
      }

      log(app, {
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
}
