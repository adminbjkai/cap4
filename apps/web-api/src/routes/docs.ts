/**
 * Doc pipeline routes (PIPELINE_V2 — all opt-in, never auto-triggered):
 *   POST /api/videos/:id/generate-doc — enqueue a generate_doc job
 *   GET  /api/videos/:id/doc          — fetch the generated document
 */

import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query } from "@cap/db";
import { badRequest } from "../lib/shared.js";

const env = getEnv();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID_RE.test(value);

export async function docRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>("/api/videos/:id/generate-doc", async (req, reply) => {
    const videoId = req.params.id;
    if (!isUuid(videoId)) {
      return reply.code(400).send(badRequest("Invalid video id"));
    }

    const video = await query(
      env.DATABASE_URL,
      `SELECT transcription_status, deleted_at FROM videos WHERE id = $1::uuid`,
      [videoId]
    );
    if (video.rowCount === 0 || video.rows[0].deleted_at) {
      return reply.code(404).send({ ok: false, error: "Video not found" });
    }
    if (video.rows[0].transcription_status !== "complete") {
      return reply.code(409).send({
        ok: false,
        error: `Doc generation requires a complete transcript (status: ${video.rows[0].transcription_status})`
      });
    }

    const job = await query(
      env.DATABASE_URL,
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'generate_doc', 'queued', 80, now(), '{}'::jsonb, 3)
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()
       RETURNING id, status`,
      [videoId]
    );

    return reply.code(202).send({
      ok: true,
      jobId: Number(job.rows[0].id),
      status: job.rows[0].status
    });
  });

  app.get<{ Params: { id: string } }>("/api/videos/:id/doc", async (req, reply) => {
    const videoId = req.params.id;
    if (!isUuid(videoId)) {
      return reply.code(400).send(badRequest("Invalid video id"));
    }

    const doc = await query(
      env.DATABASE_URL,
      `SELECT d.id, d.status, d.title, d.doc_type, d.markdown, d.confidence_notes,
              d.unused_frames, d.prompt_version, d.model, d.error_message,
              d.created_at, d.updated_at
       FROM documents d
       JOIN videos v ON v.id = d.video_id
       WHERE d.video_id = $1::uuid AND v.deleted_at IS NULL`,
      [videoId]
    );
    if (doc.rowCount === 0) {
      return reply.code(404).send({ ok: false, error: "No document for this video" });
    }
    const document = doc.rows[0];

    const sections = await query(
      env.DATABASE_URL,
      `SELECT s.id, s.position, s.heading, s.body_md, s.start_s, s.end_s,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'position', st.position,
                    'text', st.text,
                    'frameId', st.frame_id,
                    'frameKey', f.s3_key,
                    'frameTs', f.ts_seconds,
                    'crop', st.crop,
                    'alt', st.alt,
                    'callout', st.callout
                  ) ORDER BY st.position
                ) FILTER (WHERE st.id IS NOT NULL),
                '[]'::jsonb
              ) AS steps
       FROM doc_sections s
       LEFT JOIN doc_steps st ON st.section_id = s.id
       LEFT JOIN frames f ON f.id = st.frame_id
       WHERE s.document_id = $1::uuid
       GROUP BY s.id
       ORDER BY s.position`,
      [document.id]
    );

    return reply.send({
      ok: true,
      document: {
        id: document.id,
        status: document.status,
        title: document.title,
        docType: document.doc_type,
        markdown: document.markdown,
        confidenceNotes: document.confidence_notes,
        unusedFrames: document.unused_frames,
        promptVersion: document.prompt_version,
        model: document.model,
        errorMessage: document.error_message,
        createdAt: document.created_at,
        updatedAt: document.updated_at,
        sections: sections.rows.map((s) => ({
          id: s.id,
          position: s.position,
          heading: s.heading,
          bodyMd: s.body_md,
          startS: s.start_s === null ? null : Number(s.start_s),
          endS: s.end_s === null ? null : Number(s.end_s),
          steps: s.steps
        }))
      }
    });
  });
}
