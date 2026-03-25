/**
 * Library routes:
 *   GET /api/library/videos — paginated video listing (cursor-based)
 */

import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query } from "@cap/db";
import {
  badRequest,
  encodeLibraryCursor,
  decodeLibraryCursor,
  normalizeCursorTimestamp
} from "../lib/shared.js";

const env = getEnv();

export async function libraryRoutes(app: FastifyInstance) {
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
      created_at: string | Date;
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

    const nextCursor = hasMore && next ? normalizeCursorTimestamp(next.created_at) : null;
    if (hasMore && next && !nextCursor) {
      throw new Error(`Unable to encode library cursor for video ${next.id}`);
    }

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
      nextCursor: nextCursor && next ? encodeLibraryCursor(nextCursor, next.id) : null
    });
  });
}
