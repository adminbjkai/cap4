#!/usr/bin/env node
// Prune raw original uploads (videos/<id>/raw/source.mp4) for videos that are
// fully done with them: transcription complete/no_audio AND a transcoded
// result_key exists AND not soft-deleted.
//
// SAFETY: deletes ONLY the raw S3 object. It does NOT touch the `uploads.raw_key`
// column (kept NOT NULL; never read again for a completed video — see PROGRESS.md).
// Idempotent: re-running skips already-gone objects.
//
// Env required (set by prune-raw-originals.sh): DATABASE_URL, S3_ENDPOINT,
// S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, (opt) S3_REGION, S3_FORCE_PATH_STYLE.
//
// Flags:
//   --dry-run            report only, delete nothing
//   --limit N            process at most N eligible videos (testing)
//   --video <uuid>       restrict to a single video id (testing)
//   --min-age-hours N    only prune videos whose transcription finished > N hours ago
//                        (extra safety for the recurring cron; default 0)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// pnpm workspace: pg is a dep of packages/db, the S3 client a dep of apps/worker.
// Resolve each from its owning package rather than from this script's dir.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireDb = createRequire(join(ROOT, "packages/db/package.json"));
const requireWorker = createRequire(join(ROOT, "apps/worker/package.json"));
const pg = requireDb("pg");
const { S3Client, HeadObjectCommand, DeleteObjectCommand } = requireWorker("@aws-sdk/client-s3");

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : null;
const ONLY_VIDEO = typeof arg("--video") === "string" ? arg("--video") : null;
const MIN_AGE_HOURS = arg("--min-age-hours") ? Number(arg("--min-age-hours")) : 0;

function s3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 configuration (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET)");
  }
  // Mirror apps/worker/src/lib/s3.ts exactly (MinIO needs WHEN_REQUIRED checksums).
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

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(1)} ${u[i]}`;
}

async function main() {
  const { client, bucket } = s3Client();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const params = [];
  let where =
    `v.deleted_at IS NULL
     AND v.transcription_status IN ('complete','no_audio')
     AND v.result_key IS NOT NULL
     AND u.raw_key IS NOT NULL`;
  if (MIN_AGE_HOURS > 0) {
    params.push(MIN_AGE_HOURS);
    where += ` AND v.updated_at < now() - ($${params.length} || ' hours')::interval`;
  }
  if (ONLY_VIDEO) {
    params.push(ONLY_VIDEO);
    where += ` AND v.id = $${params.length}::uuid`;
  }
  let sql =
    `SELECT v.id, u.raw_key
     FROM videos v JOIN uploads u ON u.video_id = v.id
     WHERE ${where}
     ORDER BY v.created_at`;
  if (LIMIT) sql += ` LIMIT ${Number(LIMIT)}`;

  const { rows } = await pool.query(sql, params);
  console.log(
    `[prune] mode=${DRY_RUN ? "DRY-RUN" : "DELETE"} eligible=${rows.length}` +
    (LIMIT ? ` limit=${LIMIT}` : "") +
    (ONLY_VIDEO ? ` video=${ONLY_VIDEO}` : "") +
    (MIN_AGE_HOURS ? ` min-age-hours=${MIN_AGE_HOURS}` : "")
  );

  let present = 0, deleted = 0, alreadyGone = 0, bytesFreed = 0, errors = 0;

  for (const row of rows) {
    const key = row.raw_key;
    let size = 0;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      size = Number(head.ContentLength ?? 0);
      present++;
    } catch (e) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") {
        alreadyGone++;
        continue; // idempotent: nothing to do
      }
      console.error(`[prune] HEAD failed ${key}: ${e?.name ?? e}`);
      errors++;
      continue;
    }

    if (DRY_RUN) {
      bytesFreed += size; // would-free
      continue;
    }

    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted++;
      bytesFreed += size;
      if (deleted % 25 === 0) console.log(`[prune] deleted ${deleted}... (${fmtBytes(bytesFreed)})`);
    } catch (e) {
      console.error(`[prune] DELETE failed ${key}: ${e?.name ?? e}`);
      errors++;
    }
  }

  console.log(
    `[prune] done. present=${present} already-gone=${alreadyGone} ` +
    `${DRY_RUN ? "would-delete" : "deleted"}=${DRY_RUN ? present : deleted} ` +
    `${DRY_RUN ? "would-free" : "freed"}=${fmtBytes(bytesFreed)} errors=${errors}`
  );

  await pool.end();
  if (errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[prune] fatal:", e);
  process.exit(1);
});
