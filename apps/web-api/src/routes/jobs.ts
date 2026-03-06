/**
 * Job routes:
 *   GET /api/jobs/:id — fetch a single job queue row
 */

import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query } from "@cap/db";
import { badRequest } from "../lib/shared.js";

const env = getEnv();

export async function jobRoutes(app: FastifyInstance) {
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
}
