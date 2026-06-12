import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTransaction } from "@cap/db";
import type { AppEnv } from "@cap/config";
import type { S3Client } from "@aws-sdk/client-s3";
import { downloadObjectToFile, putObjectBuffer } from "../lib/s3.js";
import { runProcess } from "./exec.js";
import {
  createDocModelClient,
  createClaudeCliRunner,
  type DocModelClient,
  type DocModelStore
} from "./model-client.js";
import {
  chooseCaptureTimes,
  computeChapterBoundaries,
  dedupeFrames,
  detectScenes,
  extractFrame,
  type ExtractedFrame
} from "./stage-a.js";
import { triageFrames } from "./stage-b.js";
import { generateDoc, type DocTranscriptSegment } from "./stage-c.js";
import { PROMPT_VERSION } from "./stage-c.js";
import { cropFrame, dedupeStepImages, findInvalidFrameRefs, renderMarkdown, stripInvalidFrameRefs } from "./stage-d.js";
import type { DocOutput, ManifestFrame } from "./schema.js";

type LogFn = (event: string, fields: Record<string, unknown>) => void;

export function createPgDocModelStore(databaseUrl: string): DocModelStore {
  return {
    async getCached(cacheKey) {
      return withTransaction(databaseUrl, async (client) => {
        const result = await client.query<{ response_json: unknown }>(
          `SELECT response_json FROM doc_model_cache WHERE cache_key = $1`,
          [cacheKey]
        );
        return result.rows[0]?.response_json ?? null;
      });
    },
    async putCached(cacheKey, value, model) {
      await withTransaction(databaseUrl, async (client) => {
        await client.query(
          `INSERT INTO doc_model_cache (cache_key, response_json, model)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (cache_key) DO NOTHING`,
          [cacheKey, JSON.stringify(value), model]
        );
      });
    },
    async countCallsLast24h() {
      return withTransaction(databaseUrl, async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*) AS count FROM doc_model_calls WHERE created_at > now() - interval '24 hours'`
        );
        return Number(result.rows[0]?.count ?? 0);
      });
    },
    async recordCall(videoId, purpose, model) {
      await withTransaction(databaseUrl, async (client) => {
        await client.query(
          `INSERT INTO doc_model_calls (video_id, purpose, model) VALUES ($1, $2, $3)`,
          [videoId, purpose, model]
        );
      });
    }
  };
}

async function probeDuration(inputPath: string): Promise<number> {
  const result = await runProcess({
    bin: "ffprobe",
    args: ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputPath]
  });
  const duration = Number(result.stdout.trim());
  if (result.code !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe could not determine duration: ${result.stderr.slice(-300)}`);
  }
  return duration;
}

export type FrameRecord = {
  frameId: string; // f_NNNN label
  frameNo: number;
  ts: number;
  s3Key: string;
  caption: string | null;
  classification: string | null;
};

export type DocPipelineResult = {
  doc: DocOutput;
  markdown: string;
  frames: FrameRecord[];
  /** "sectionIdx:stepIdx" → public image URL used in the markdown. */
  stepImageUrls: Map<string, string>;
};

/**
 * Stages A→D over a local media file. All side effects beyond the workdir go
 * through uploadObject, so tests can run the full pipeline against a mocked
 * model and an in-memory "S3".
 */
export async function runDocPipeline(opts: {
  videoId: string;
  mediaPath: string;
  workdir: string;
  durationSeconds: number | null;
  segments: DocTranscriptSegment[];
  client: DocModelClient;
  strongModel: string;
  triageModel: string | undefined;
  uploadObject: (key: string, body: Buffer, contentType: string) => Promise<void>;
  publicUrlFor: (key: string) => string;
  log: LogFn;
}): Promise<DocPipelineResult> {
  const duration = opts.durationSeconds ?? (await probeDuration(opts.mediaPath));

  // Stage A — scene detection, candidate frames, SSIM dedup
  const scenes = await detectScenes(opts.mediaPath, opts.workdir);
  const times = chooseCaptureTimes(scenes, duration);
  opts.log("doc.stage_a.frames", { video_id: opts.videoId, scenes: scenes.length, captures: times.length });

  const candidates: ExtractedFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    const path = join(opts.workdir, `cand_${String(i).padStart(4, "0")}.jpg`);
    await extractFrame(opts.mediaPath, times[i]!, path);
    candidates.push({ ts: times[i]!, path });
  }
  const deduped = await dedupeFrames(candidates);
  opts.log("doc.stage_a.deduped", { video_id: opts.videoId, kept: deduped.length, dropped: candidates.length - deduped.length });

  const frames: FrameRecord[] = [];
  const manifestAll: ManifestFrame[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const frameNo = i + 1;
    const frameId = `f_${String(frameNo).padStart(4, "0")}`;
    const fileName = `${frameId}.jpg`;
    const finalPath = join(opts.workdir, fileName);
    await fs.rename(deduped[i]!.path, finalPath);
    const s3Key = `videos/${opts.videoId}/frames/${fileName}`;
    await opts.uploadObject(s3Key, await fs.readFile(finalPath), "image/jpeg");
    frames.push({ frameId, frameNo, ts: deduped[i]!.ts, s3Key, caption: null, classification: null });
    manifestAll.push({ frameId, ts: deduped[i]!.ts, caption: "", fileName });
  }

  // Stage B — triage (pass-through on any failure)
  const triage = await triageFrames({
    client: opts.client,
    model: opts.triageModel,
    frames: manifestAll,
    workdir: opts.workdir,
    videoId: opts.videoId,
    log: opts.log
  });
  for (const frame of frames) {
    const manifestEntry = triage.manifest.find((m) => m.frameId === frame.frameId);
    frame.caption = manifestEntry?.caption || null;
    frame.classification = triage.classifications.get(frame.frameId) ?? null;
  }

  // Stage C — strong-model doc pass (chaptered when >25 min), with one
  // corrective retry on hallucinated frame refs (Stage D validation).
  const boundaries = computeChapterBoundaries(opts.segments, scenes);
  const manifestIds = new Set(triage.manifest.map((m) => m.frameId));
  const stageCParams = {
    client: opts.client,
    strongModel: opts.strongModel,
    triageModel: opts.triageModel,
    segments: opts.segments,
    manifest: triage.manifest,
    durationSeconds: duration,
    chapterBoundaries: boundaries,
    workdir: opts.workdir,
    videoId: opts.videoId,
    log: opts.log
  };

  let doc = await generateDoc(stageCParams);
  let invalid = findInvalidFrameRefs(doc, manifestIds);
  if (invalid.length > 0) {
    opts.log("doc.stage_d.invalid_refs_retry", { video_id: opts.videoId, invalid });
    doc = await generateDoc({
      ...stageCParams,
      correction: `These frame ids do not exist and must not be referenced: ${invalid.join(", ")}. Use only ids from the manifest.`
    });
    invalid = findInvalidFrameRefs(doc, manifestIds);
  }
  doc = stripInvalidFrameRefs(doc, invalid);
  doc = dedupeStepImages(doc);

  // Stage D — crops + markdown
  const framesByLabel = new Map(frames.map((f) => [f.frameId, f]));
  const stepImageUrls = new Map<string, string>();
  const cropsDir = join(opts.workdir, "crops");
  await fs.mkdir(cropsDir, { recursive: true });

  for (let s = 0; s < doc.sections.length; s++) {
    const steps = doc.sections[s]!.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (!step.frame_id) continue;
      const frame = framesByLabel.get(step.frame_id);
      if (!frame) continue;
      let key = frame.s3Key;
      if (step.crop) {
        const cropName = `s${s}_${i}_${frame.frameId}.jpg`;
        const cropPath = join(cropsDir, cropName);
        await cropFrame(join(opts.workdir, `${frame.frameId}.jpg`), step.crop, cropPath);
        key = `videos/${opts.videoId}/doc/crops/${cropName}`;
        await opts.uploadObject(key, await fs.readFile(cropPath), "image/jpeg");
      }
      stepImageUrls.set(`${s}:${i}`, opts.publicUrlFor(key));
    }
  }

  const markdown = renderMarkdown(doc, (sectionIndex, stepIndex) =>
    stepImageUrls.get(`${sectionIndex}:${stepIndex}`) ?? null
  );

  return { doc, markdown, frames, stepImageUrls };
}

type JobLike = { id: number; video_id: string };

/**
 * Worker job handler for `generate_doc`. DB/S3 wiring around runDocPipeline;
 * ackJob is the queue ack closure provided by the worker loop.
 */
export async function handleGenerateDocJob(
  job: JobLike,
  ctx: {
    env: AppEnv;
    s3Client: S3Client;
    s3Bucket: string;
    ackJob: () => Promise<void>;
    log: LogFn;
  }
): Promise<void> {
  const { env, s3Client, s3Bucket, log } = ctx;

  const prepared = await withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query<{
      deleted_at: string | null;
      transcription_status: string;
      duration_seconds: string | null;
      result_key: string | null;
      raw_key: string | null;
      segments_json: unknown;
    }>(
      `SELECT v.deleted_at, v.transcription_status, v.duration_seconds, v.result_key,
              u.raw_key, t.segments_json
       FROM videos v
       LEFT JOIN uploads u ON u.video_id = v.id
       LEFT JOIN transcripts t ON t.video_id = v.id
       WHERE v.id = $1::uuid`,
      [job.video_id]
    );
    if (result.rowCount === 0) throw new Error(`video ${job.video_id} not found`);
    return result.rows[0]!;
  });

  if (prepared.deleted_at) {
    log("doc.job.skip", { job_id: job.id, video_id: job.video_id, reason: "deleted" });
    await ctx.ackJob();
    return;
  }
  if (prepared.transcription_status !== "complete" || !prepared.segments_json) {
    const error = new Error(`doc generation requires a complete transcript (status=${prepared.transcription_status})`);
    (error as { fatal?: boolean }).fatal = true;
    throw error;
  }
  const mediaKey = prepared.result_key ?? prepared.raw_key;
  if (!mediaKey) {
    throw new Error(`no media key (result or raw) for video ${job.video_id}`);
  }
  const strongModel = env.DOC_MODEL_STRONG;
  if (!strongModel) {
    const error = new Error("DOC_MODEL_STRONG not configured");
    (error as { fatal?: boolean }).fatal = true;
    throw error;
  }

  const segments = (prepared.segments_json as Array<{ startSeconds: number; endSeconds: number; text: string }>)
    .filter((s) => typeof s?.text === "string" && s.text.trim().length > 0);

  await withTransaction(env.DATABASE_URL, async (client) => {
    await client.query(
      `INSERT INTO documents (video_id, status, prompt_version)
       VALUES ($1::uuid, 'generating', $2)
       ON CONFLICT (video_id) DO UPDATE SET status = 'generating', error_message = NULL, updated_at = now()`,
      [job.video_id, PROMPT_VERSION]
    );
  });

  const workdir = join(tmpdir(), `cap4-doc-${job.video_id}-${randomUUID()}`);
  await fs.mkdir(workdir, { recursive: true });

  try {
    const mediaPath = join(workdir, "source-media");
    await downloadObjectToFile(s3Client, s3Bucket, mediaKey, mediaPath);

    const client = createDocModelClient(env.DOC_MODEL_BACKEND, {
      runner: createClaudeCliRunner(),
      store: createPgDocModelStore(env.DATABASE_URL),
      timeoutMs: env.DOC_MODEL_TIMEOUT_MS,
      maxCallsPerJob: env.DOC_MAX_MODEL_CALLS_PER_JOB,
      maxCallsPerDay: env.DOC_MAX_MODEL_CALLS_PER_DAY,
      log
    });

    const result = await runDocPipeline({
      videoId: job.video_id,
      mediaPath,
      workdir,
      durationSeconds: prepared.duration_seconds === null ? null : Number(prepared.duration_seconds),
      segments,
      client,
      strongModel,
      triageModel: env.DOC_MODEL_TRIAGE,
      uploadObject: (key, body, contentType) => putObjectBuffer(s3Client, s3Bucket, key, body, contentType),
      publicUrlFor: (key) => `/${s3Bucket}/${key}`,
      log
    });

    await withTransaction(env.DATABASE_URL, async (client) => {
      const docRow = await client.query<{ id: string }>(
        `SELECT id FROM documents WHERE video_id = $1::uuid FOR UPDATE`,
        [job.video_id]
      );
      const documentId = docRow.rows[0]!.id;

      // Old sections/steps must go before old frames (doc_steps → frames FK).
      await client.query(`DELETE FROM doc_sections WHERE document_id = $1::uuid`, [documentId]);
      await client.query(`DELETE FROM frames WHERE video_id = $1::uuid`, [job.video_id]);

      const frameUuidByLabel = new Map<string, string>();
      for (const frame of result.frames) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO frames (video_id, frame_no, ts_seconds, s3_key, caption, classification)
           VALUES ($1::uuid, $2, $3, $4, $5, $6)
           RETURNING id`,
          [job.video_id, frame.frameNo, frame.ts, frame.s3Key, frame.caption, frame.classification]
        );
        frameUuidByLabel.set(frame.frameId, inserted.rows[0]!.id);
      }

      for (let s = 0; s < result.doc.sections.length; s++) {
        const section = result.doc.sections[s]!;
        const sectionRow = await client.query<{ id: string }>(
          `INSERT INTO doc_sections (document_id, position, heading, body_md, start_s, end_s)
           VALUES ($1::uuid, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            documentId,
            s,
            section.heading,
            section.body_md,
            section.source_span?.start_s ?? null,
            section.source_span?.end_s ?? null
          ]
        );
        for (let i = 0; i < section.steps.length; i++) {
          const step = section.steps[i]!;
          await client.query(
            `INSERT INTO doc_steps (section_id, position, text, frame_id, crop, alt, callout)
             VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb, $6, $7)`,
            [
              sectionRow.rows[0]!.id,
              i,
              step.text,
              step.frame_id ? frameUuidByLabel.get(step.frame_id) ?? null : null,
              step.crop ? JSON.stringify(step.crop) : null,
              step.alt ?? null,
              step.callout ?? null
            ]
          );
        }
      }

      await client.query(
        `UPDATE documents
         SET status = 'complete', title = $2, doc_type = $3, markdown = $4,
             confidence_notes = $5::jsonb, unused_frames = $6::jsonb,
             prompt_version = $7, model = $8, error_message = NULL, updated_at = now()
         WHERE id = $1::uuid`,
        [
          documentId,
          result.doc.title,
          result.doc.doc_type,
          result.markdown,
          JSON.stringify(result.doc.confidence_notes),
          JSON.stringify(result.doc.unused_frames),
          PROMPT_VERSION,
          strongModel
        ]
      );
    });

    await ctx.ackJob();
    log("doc.job.complete", {
      job_id: job.id,
      video_id: job.video_id,
      frames: result.frames.length,
      sections: result.doc.sections.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTransaction(env.DATABASE_URL, async (client) => {
      await client.query(
        `UPDATE documents SET status = 'failed', error_message = $2, updated_at = now()
         WHERE video_id = $1::uuid`,
        [job.video_id, message]
      );
    }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}
