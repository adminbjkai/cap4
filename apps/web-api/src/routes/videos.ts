/**
 * Video routes:
 *   POST  /api/videos                    — create video + upload record
 *   GET   /api/videos/:id/status         — full status + transcript + AI output
 *   PATCH /api/videos/:id/watch-edits    — update title / transcript
 *   POST  /api/videos/:id/delete         — soft delete
 *   POST  /api/videos/:id/retry          — re-queue failed video
 */

import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query, withTransaction } from "@cap/db";
import {
  badRequest,
  sha256Hex,
  requireIdempotencyKey,
  idempotencyBegin,
  idempotencyFinish,
  transcriptTextFromSegments,
  keyPointsFromChapters,
  normalizeEditableTranscriptSegments,
  structuredActionItemsFromJson,
  structuredChaptersFromJson,
  structuredEntitiesFromJson,
  structuredQuotesFromJson
} from "../lib/shared.js";

const env = getEnv();

function normalizeSpeakerLabels(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const numericKey = Number(rawKey);
    if (!Number.isInteger(numericKey) || numericKey < 0) continue;
    const label = String(rawValue ?? "").trim();
    if (!label) continue;
    out[String(numericKey)] = label.slice(0, 80);
  }
  return out;
}

export async function videoRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------
  // POST /api/videos — create video
  // ------------------------------------------------------------------

  app.post<{ Body: { name?: string; webhookUrl?: string } }>("/api/videos", async (req, reply) => {
    const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

    const name = String(req.body?.name ?? "Untitled Video").trim() || "Untitled Video";
    const webhookUrl = req.body?.webhookUrl ? String(req.body.webhookUrl).trim() : null;

    if (webhookUrl) {
      try {
        const parsed = new URL(webhookUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return reply.code(400).send(badRequest('webhookUrl must use http or https'));
        }
        const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'minio', 'postgres', 'media-server', 'web-api', 'worker'];
        if (blocked.some(h => parsed.hostname === h) || parsed.hostname.endsWith('.internal') || parsed.hostname.endsWith('.local')) {
          return reply.code(400).send(badRequest('webhookUrl cannot target internal services'));
        }
      } catch {
        return reply.code(400).send(badRequest('webhookUrl is not a valid URL'));
      }
    }

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

  // ------------------------------------------------------------------
  // GET /api/videos/:id/status
  // ------------------------------------------------------------------

  app.get<{ Params: { id: string } }>("/api/videos/:id/status", async (req, reply) => {
    const videoId = req.params.id;
    const result = await query<{
      id: string;
      name: string;
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
      transcript_speaker_labels_json: unknown;
      ai_provider: string | null;
      ai_model: string | null;
      ai_title: string | null;
      ai_summary: string | null;
      ai_chapters_json: unknown;
      ai_entities_json: unknown;
      ai_action_items_json: unknown;
      ai_quotes_json: unknown;
      transcription_dead_error: string | null;
      ai_dead_error: string | null;
    }>(
      env.DATABASE_URL,
      `SELECT
         v.id,
         v.name,
         v.processing_phase,
         v.processing_progress,
         v.result_key,
         v.thumbnail_key,
         v.error_message,
         v.transcription_status,
         v.ai_status,
         t.provider AS transcript_provider,
         COALESCE(t.language, 'en') AS transcript_language,
         t.vtt_key AS transcript_vtt_key,
         t.segments_json AS transcript_segments_json,
         t.speaker_labels_json AS transcript_speaker_labels_json,
         ao.provider::text AS ai_provider,
         ao.model AS ai_model,
         ao.title AS ai_title,
         ao.summary AS ai_summary,
         ao.chapters_json AS ai_chapters_json,
         ao.entities_json AS ai_entities_json,
         ao.action_items_json AS ai_action_items_json,
         ao.quotes_json AS ai_quotes_json,
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
    const chapters = structuredChaptersFromJson(row.ai_chapters_json);
    const keyPoints = keyPointsFromChapters(row.ai_chapters_json);
    const entities = structuredEntitiesFromJson(row.ai_entities_json);
    const actionItems = structuredActionItemsFromJson(row.ai_action_items_json);
    const quotes = structuredQuotesFromJson(row.ai_quotes_json);
    return reply.send({
      videoId: row.id,
      name: row.name,
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
          speakerLabels: normalizeSpeakerLabels(row.transcript_speaker_labels_json),
          segments: Array.isArray(row.transcript_segments_json) ? row.transcript_segments_json : []
        }
        : null,
      aiOutput:
        row.ai_provider ||
        row.ai_model ||
        row.ai_title ||
        row.ai_summary ||
        keyPoints.length > 0 ||
        chapters.length > 0 ||
        Boolean(entities) ||
        actionItems.length > 0 ||
        quotes.length > 0
          ? {
            provider: row.ai_provider,
            model: row.ai_model,
            title: row.ai_title,
            summary: row.ai_summary,
            keyPoints,
            chapters,
            entities,
            actionItems,
            quotes
          }
          : null
    });
  });

  // ------------------------------------------------------------------
  // PATCH /api/videos/:id/watch-edits
  // ------------------------------------------------------------------

  app.patch<{ Params: { id: string }; Body: { title?: string | null; transcriptText?: string | null; speakerLabels?: Record<string, string> | null } }>("/api/videos/:id/watch-edits", async (req, reply) => {
    const videoId = req.params.id;
    const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

    const titleProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "title");
    const transcriptProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "transcriptText");
    const speakerLabelsProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "speakerLabels");
    if (!titleProvided && !transcriptProvided && !speakerLabelsProvided) {
      return reply.code(400).send(badRequest("At least one field must be provided: title, transcriptText, speakerLabels"));
    }

    const title = titleProvided ? String(req.body?.title ?? "").trim() : null;
    const transcriptText = transcriptProvided ? String(req.body?.transcriptText ?? "").trim() : null;
    const speakerLabels = speakerLabelsProvided ? normalizeSpeakerLabels(req.body?.speakerLabels ?? {}) : null;
    if (titleProvided && title !== null) {
      if (title.length === 0) {
        return reply.code(400).send(badRequest("Title cannot be empty"));
      }
      if (title.length > 500) {
        return reply.code(400).send(badRequest("Title too long (max 500 characters)"));
      }
    }
    const endpointKey = `/api/videos/${videoId}/watch-edits`;
    const requestHash = sha256Hex(JSON.stringify({
      videoId,
      title: titleProvided ? title : undefined,
      transcriptText: transcriptProvided ? transcriptText : undefined,
      speakerLabels: speakerLabelsProvided ? speakerLabels : undefined
    }));

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
      let speakerLabelsUpdated = false;

      if (titleProvided) {
        const titleResult = await client.query<{ video_id: string }>(
          `UPDATE ai_outputs
           SET title = $2, updated_at = now()
           WHERE video_id = $1::uuid
           RETURNING video_id`,
          [videoId, title && title.length > 0 ? title : null]
        );
        if ((titleResult.rowCount ?? 0) > 0) {
          titleUpdated = true;
        } else {
          await client.query(
            `UPDATE videos SET name = $2, updated_at = now() WHERE id = $1::uuid`,
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

      if (speakerLabelsProvided) {
        const transcriptLookup = await client.query<{ video_id: string }>(
          `SELECT video_id FROM transcripts WHERE video_id = $1::uuid`,
          [videoId]
        );
        if ((transcriptLookup.rowCount ?? 0) > 0) {
          await client.query(
            `UPDATE transcripts
             SET speaker_labels_json = $2::jsonb, updated_at = now()
             WHERE video_id = $1::uuid`,
            [videoId, JSON.stringify(speakerLabels ?? {})]
          );
          speakerLabelsUpdated = true;
        }
      }

      const body = {
        ok: true,
        videoId,
        updated: {
          title: titleUpdated,
          transcript: transcriptUpdated,
          speakerLabels: speakerLabelsUpdated
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

  // ------------------------------------------------------------------
  // POST /api/videos/:id/delete — soft delete (idempotent)
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // POST /api/videos/:id/retry — re-queue failed transcription / AI jobs
  // ------------------------------------------------------------------

  app.post<{ Params: { id: string } }>("/api/videos/:id/retry", async (req, reply) => {
    const videoId = req.params.id;
    const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

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
      if (["failed", "not_started"].includes(video.transcription_status) || video.transcription_status === "processing") {
        const res = await client.query(
          `UPDATE job_queue
           SET status = 'queued',
               attempts = 0,
               run_after = now(),
               last_error = NULL,
               updated_at = now()
           WHERE video_id = $1::uuid AND job_type = 'transcribe_video'
             AND status IN ('dead', 'running', 'leased')`,
          [videoId]
        );
        if ((res.rowCount ?? 0) > 0) {
          jobsReset.push("transcribe_video");
          await client.query(`UPDATE videos SET transcription_status = 'queued', updated_at = now() WHERE id = $1::uuid`, [videoId]);
        }
      }

      // 4. Reset AI Job if failed/dead
      if (["failed", "not_started"].includes(video.ai_status) || video.ai_status === "processing") {
        const res = await client.query(
          `UPDATE job_queue
           SET status = 'queued',
               attempts = 0,
               run_after = now(),
               last_error = NULL,
               updated_at = now()
           WHERE video_id = $1::uuid AND job_type = 'generate_ai'
             AND status IN ('dead', 'running', 'leased')`,
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
}
