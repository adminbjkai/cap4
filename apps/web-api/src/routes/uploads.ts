/**
 * Upload routes:
 *   POST /api/uploads/signed                — request a signed PUT URL (singlepart)
 *   POST /api/uploads/complete              — mark singlepart upload done + enqueue job
 *   POST /api/uploads/multipart/initiate    — start S3 multipart upload
 *   POST /api/uploads/multipart/presign-part — get a signed URL for one part
 *   POST /api/uploads/multipart/complete    — assemble parts + enqueue job
 *   POST /api/uploads/multipart/abort       — abort an in-progress multipart upload
 */

import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query, withTransaction } from "@cap/db";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  badRequest,
  sha256Hex,
  requireIdempotencyKey,
  idempotencyBegin,
  idempotencyFinish,
  getS3ClientAndBucket,
  getInternalS3ClientAndBucket,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from "../lib/shared.js";

const env = getEnv();

export async function uploadRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------
  // POST /api/uploads/signed — singlepart signed PUT
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // POST /api/uploads/complete — singlepart complete
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // POST /api/uploads/multipart/initiate
  // ------------------------------------------------------------------

  app.post<{ Body: { videoId: string; contentType: string } }>("/api/uploads/multipart/initiate", async (req, reply) => {
    const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

    const videoId = req.body?.videoId;
    const contentType = req.body?.contentType;
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
      const { client: s3Client, bucket } = getInternalS3ClientAndBucket();

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

  // ------------------------------------------------------------------
  // POST /api/uploads/multipart/presign-part
  // ------------------------------------------------------------------

  app.post<{ Body: { videoId: string; partNumber: number } }>("/api/uploads/multipart/presign-part", async (req, reply) => {
    const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

    const videoId = req.body?.videoId;
    const partNumber = req.body?.partNumber;
    if (!videoId || !partNumber) return reply.code(400).send(badRequest("videoId and partNumber are required"));

    const uploadLookup = await query<{ raw_key: string; multipart_upload_id: string }>(
      env.DATABASE_URL,
      `SELECT raw_key, multipart_upload_id FROM uploads u
       INNER JOIN videos v ON v.id = u.video_id
       WHERE u.video_id = $1::uuid AND u.mode = 'multipart' AND v.deleted_at IS NULL`,
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

  // ------------------------------------------------------------------
  // POST /api/uploads/multipart/complete
  // ------------------------------------------------------------------

  app.post<{ Body: { videoId: string; parts: Array<{ ETag: string; PartNumber: number }> } }>("/api/uploads/multipart/complete", async (req, reply) => {
    const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

    const videoId = req.body?.videoId;
    const parts = req.body?.parts;
    if (!videoId || !Array.isArray(parts)) return reply.code(400).send(badRequest("videoId and parts array are required"));

    const endpointKey = "/api/uploads/multipart/complete";
    const requestHash = sha256Hex(JSON.stringify({ videoId, parts }));

    const result = await withTransaction(env.DATABASE_URL, async (client) => {
      const begin = await idempotencyBegin({ client, endpoint: endpointKey, idempotencyKey, requestHash, ttlInterval: "24 hours" });
      if (begin.kind === "cached" || begin.kind === "conflict") return { statusCode: begin.statusCode, body: begin.body };

      const uploadLookup = await client.query<{ raw_key: string; multipart_upload_id: string }>(
        `SELECT raw_key, multipart_upload_id FROM uploads u
         INNER JOIN videos v ON v.id = u.video_id
         WHERE u.video_id = $1::uuid AND u.mode = 'multipart' AND v.deleted_at IS NULL
         FOR UPDATE`,
        [videoId]
      );

      if (uploadLookup.rowCount === 0 || !uploadLookup.rows[0]?.multipart_upload_id) {
        const body = { ok: false, error: "Multipart upload record not found" };
        await idempotencyFinish({ client, endpoint: endpointKey, idempotencyKey, statusCode: 404, body });
        return { statusCode: 404, body };
      }

      const { raw_key: rawKey, multipart_upload_id: uploadId } = uploadLookup.rows[0]!;
      const { client: s3Client, bucket } = getInternalS3ClientAndBucket();

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

  // ------------------------------------------------------------------
  // POST /api/uploads/multipart/abort
  // ------------------------------------------------------------------

  app.post<{ Body: { videoId: string } }>("/api/uploads/multipart/abort", async (req, reply) => {
    const idempotencyKey = requireIdempotencyKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send(badRequest("Missing Idempotency-Key header"));

    const videoId = req.body?.videoId;
    if (!videoId) return reply.code(400).send(badRequest("videoId is required"));

    const uploadLookup = await query<{ raw_key: string; multipart_upload_id: string }>(
      env.DATABASE_URL,
      `SELECT raw_key, multipart_upload_id FROM uploads u
       INNER JOIN videos v ON v.id = u.video_id
       WHERE u.video_id = $1::uuid AND u.mode = 'multipart' AND v.deleted_at IS NULL`,
      [videoId]
    );

    if (uploadLookup.rowCount === 0 || !uploadLookup.rows[0]?.multipart_upload_id) {
      return reply.code(404).send({ ok: false, error: "Multipart upload not found" });
    }

    const { raw_key: rawKey, multipart_upload_id: uploadId } = uploadLookup.rows[0]!;
    const { client: s3Client, bucket } = getInternalS3ClientAndBucket();

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
}
