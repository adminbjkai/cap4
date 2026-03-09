/**
 * Integration tests — Phase 4
 *
 * Prerequisites (tests skip with a clear message if not met):
 *   - `docker compose up -d` running and healthy
 *   - Real DEEPGRAM_API_KEY + GROQ_API_KEY in .env
 *   - ffmpeg installed on the host machine
 *
 * Optional overrides via environment variables:
 *   INTEGRATION_API_URL   — default http://localhost:3000
 *   INTEGRATION_POLL_MS   — polling interval, default 3000
 *   INTEGRATION_TIMEOUT_MS — pipeline timeout, default 150000 (2.5 min)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { getTestMp4 } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = (process.env.INTEGRATION_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const POLL_INTERVAL_MS = Number(process.env.INTEGRATION_POLL_MS ?? "3000");
const PIPELINE_TIMEOUT_MS = Number(process.env.INTEGRATION_TIMEOUT_MS ?? "600000"); // 10 min for Deepgram transcription

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
  confidence: number | null;
  speaker: number | null;
}

interface TranscriptOutput {
  provider: string | null;
  language: string | null;
  vttKey: string | null;
  text: string | null;
  segments: TranscriptSegment[];
}

interface AiOutput {
  provider: string | null;
  model: string | null;
  title: string | null;
  summary: string | null;
  keyPoints: string[];
}

interface VideoStatusResponse {
  videoId: string;
  processingPhase: string;
  processingProgress: number;
  resultKey: string | null;
  thumbnailKey: string | null;
  errorMessage: string | null;
  transcriptionStatus: string;
  aiStatus: string;
  transcriptErrorMessage: string | null;
  aiErrorMessage: string | null;
  transcript: TranscriptOutput | null;
  aiOutput: AiOutput | null;
}

interface CreateVideoResponse {
  videoId: string;
  rawKey: string;
  webhookUrl: string | null;
}

interface SignedUrlResponse {
  videoId: string;
  rawKey: string;
  method: string;
  putUrl: string;
  headers: { "Content-Type": string };
}

interface UploadCompleteResponse {
  videoId: string;
  rawKey: string;
  jobId: number;
  status: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiPost<T = unknown>(
  path: string,
  body: unknown,
  idempotencyKey: string
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function apiGet<T = unknown>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`);
  return { status: res.status, body: (await res.json()) as T };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls GET /api/videos/:id/status until the video reaches a terminal phase
 * (complete, failed, or cancelled) or the timeout expires.
 *
 * Logs each phase transition so test output is readable.
 */
async function pollUntilTerminal(videoId: string): Promise<VideoStatusResponse> {
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS;
  let lastPhase = "";
  let pollCount = 0;

  while (Date.now() < deadline) {
    const { status, body } = await apiGet<VideoStatusResponse>(`/api/videos/${videoId}/status`);

    if (status !== 200) {
      throw new Error(`Unexpected ${status} from status endpoint while polling`);
    }

    const { processingPhase, processingProgress, transcriptionStatus, aiStatus } = body;

    if (processingPhase !== lastPhase) {
      console.log(
        `  [poll #${++pollCount}] phase=${processingPhase} ` +
          `progress=${processingProgress}% transcription=${transcriptionStatus} ai=${aiStatus}`
      );
      lastPhase = processingPhase;
    }

    // Wait for ALL three pipelines to reach terminal state before returning:
    // 1. processingPhase  — video encode/thumbnail
    // 2. transcriptionStatus — Deepgram
    // 3. aiStatus — Groq title/summary/chapters
    const isProcessingDone =
      processingPhase === "complete" ||
      processingPhase === "failed" ||
      processingPhase === "cancelled";

    const isTranscriptionDone =
      transcriptionStatus === "complete" ||
      transcriptionStatus === "not_started" ||
      transcriptionStatus === "no_audio" ||
      transcriptionStatus === "skipped" ||
      transcriptionStatus === "failed";

    // AI is terminal only when it has actually run to completion/failure.
    // "not_started" is NOT terminal — it transitions to "queued" as soon as transcription completes.
    // Only allow "not_started" as terminal if transcription also never ran (no audio / failed).
    const transcriptionNeverRan =
      transcriptionStatus === "not_started" ||
      transcriptionStatus === "no_audio" ||
      transcriptionStatus === "skipped" ||
      transcriptionStatus === "failed";
    const isAiDone =
      aiStatus === "complete" ||
      aiStatus === "skipped" ||
      aiStatus === "failed" ||
      (aiStatus === "not_started" && transcriptionNeverRan);

    if (isProcessingDone && isTranscriptionDone && isAiDone) {
      console.log(
        `  [poll returning] phase=${processingPhase} transcription=${transcriptionStatus} ai=${aiStatus}`
      );
      return body;
    }

    // Log what we're still waiting for
    const waiting: string[] = [];
    if (!isTranscriptionDone) waiting.push(`transcription=${transcriptionStatus}`);
    if (!isAiDone) waiting.push(`ai=${aiStatus}`);
    if (waiting.length > 0) {
      console.log(`  [poll waiting] ${waiting.join(", ")}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Video ${videoId} did not reach a terminal phase within ${PIPELINE_TIMEOUT_MS}ms. ` +
      `Last observed phase: ${lastPhase}`
  );
}

// ---------------------------------------------------------------------------
// Suite 1: Full pipeline (upload → process → transcribe → AI → complete)
//
// Tests in this suite are order-dependent — each one builds on state created
// by the previous step. A failure at step N causes subsequent steps to fail
// with a clear "depends on" message.
// ---------------------------------------------------------------------------

describe("Full pipeline: upload → transcription → AI → complete", () => {
  let videoId = "";
  let mp4Buffer: Buffer;

  // Cached for the final assertion test — set by the polling test.
  let finalStatus: VideoStatusResponse;

  // -------------------------------------------------------------------------
  // Setup: generate test fixture, verify stack is reachable
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    // Load the real test video before any test runs. This gives a clear error
    // upfront if the video file is missing rather than buried inside a test.
    mp4Buffer = getTestMp4();
    console.log(`  [fixture] loaded test video: ${(mp4Buffer.length / 1024 / 1024).toFixed(1)} MB`);
  });

  afterAll(async () => {
    // Best-effort soft-delete — clean up the test video regardless of outcome.
    if (!videoId) return;
    try {
      const { status } = await apiPost(`/api/videos/${videoId}/delete`, {}, randomUUID());
      console.log(`  [cleanup] soft-deleted ${videoId} (status ${status})`);
    } catch (err) {
      console.warn(`  [cleanup] failed to delete ${videoId}: ${err}`);
    }
  });

  // -------------------------------------------------------------------------
  // Step 0: verify the stack is up before spending time on the pipeline
  // -------------------------------------------------------------------------

  it("stack is healthy before the pipeline runs", async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/health`);
    } catch (err) {
      throw new Error(
        `Cannot reach web-api at ${API_BASE}. ` +
          `Make sure 'docker compose up -d' is running before executing integration tests.\n` +
          `Underlying error: ${err}`
      );
    }

    const body = (await res.json()) as {
      status: string;
      checks: { database: { status: string } };
    };

    expect(
      res.ok,
      `web-api /health returned HTTP ${res.status}. Check 'docker compose logs web-api'.`
    ).toBe(true);

    expect(
      body.status,
      `web-api reports status='${body.status}'. Expected 'healthy'.`
    ).toBe("healthy");

    expect(
      body.checks.database.status,
      `Database check failed. Check 'docker compose logs postgres'.`
    ).toBe("up");
  });

  // -------------------------------------------------------------------------
  // Step 1: create video record
  // -------------------------------------------------------------------------

  it("POST /api/videos creates a video and upload record", async () => {
    const { status, body } = await apiPost<CreateVideoResponse>(
      "/api/videos",
      { name: "Integration Test Video" },
      randomUUID()
    );

    expect(status, `Expected 200, got ${status}: ${JSON.stringify(body)}`).toBe(200);
    expect(body.videoId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(body.rawKey).toMatch(/^videos\/.+\/raw\/source\.mp4$/);

    videoId = body.videoId;
    console.log(`  [step 1] created videoId=${videoId}`);
  });

  // -------------------------------------------------------------------------
  // Step 2: get signed PUT URL
  // -------------------------------------------------------------------------

  it("POST /api/uploads/signed returns a presigned PUT URL", async () => {
    expect(videoId, "depends on: POST /api/videos").toBeTruthy();

    const { status, body } = await apiPost<SignedUrlResponse>(
      "/api/uploads/signed",
      { videoId, contentType: "video/mp4" },
      randomUUID()
    );

    expect(status, `Expected 200, got ${status}: ${JSON.stringify(body)}`).toBe(200);
    expect(body.putUrl).toMatch(/^https?:\/\//);
    expect(body.method).toBe("PUT");
    expect(body.rawKey).toBe(`videos/${videoId}/raw/source.mp4`);
  });

  // -------------------------------------------------------------------------
  // Step 3: PUT the MP4 directly to MinIO via the signed URL
  // -------------------------------------------------------------------------

  it("PUT test MP4 to MinIO via signed URL succeeds", async () => {
    expect(videoId, "depends on: POST /api/uploads/signed").toBeTruthy();

    // Re-request signed URL (fresh idempotency key since last one is cached
    // but we're reusing the same videoId + contentType).
    const { body: signed } = await apiPost<SignedUrlResponse>(
      "/api/uploads/signed",
      { videoId, contentType: "video/mp4" },
      randomUUID()
    );

    const putRes = await fetch(signed.putUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: mp4Buffer,
      // @ts-expect-error — duplex required for Node 18+ fetch with a body
      duplex: "half",
    });

    expect(
      putRes.ok,
      `S3 PUT failed with HTTP ${putRes.status}: ${await putRes.text()}`
    ).toBe(true);

    console.log(`  [step 3] uploaded ${(mp4Buffer.length / 1024).toFixed(1)} KB to MinIO`);
  });

  // -------------------------------------------------------------------------
  // Step 4: mark upload complete → enqueues process_video job
  // -------------------------------------------------------------------------

  it("POST /api/uploads/complete marks upload done and enqueues processing job", async () => {
    expect(videoId, "depends on: PUT to MinIO").toBeTruthy();

    const { status, body } = await apiPost<UploadCompleteResponse>(
      "/api/uploads/complete",
      { videoId },
      randomUUID()
    );

    expect(status, `Expected 200, got ${status}: ${JSON.stringify(body)}`).toBe(200);
    expect(body.videoId).toBe(videoId);
    expect(body.jobId, "jobId should be a positive integer").toBeGreaterThan(0);
    expect(body.status).toBe("uploaded");

    console.log(`  [step 4] job enqueued — jobId=${body.jobId}`);
  });

  // -------------------------------------------------------------------------
  // Step 5: poll until terminal state
  // -------------------------------------------------------------------------

  it(
    "video reaches processingPhase=complete within the timeout",
    async () => {
      expect(videoId, "depends on: POST /api/uploads/complete").toBeTruthy();

      console.log(
        `  [step 5] polling every ${POLL_INTERVAL_MS}ms, timeout ${PIPELINE_TIMEOUT_MS}ms…`
      );

      finalStatus = await pollUntilTerminal(videoId);

      if (finalStatus.processingPhase === "failed") {
        throw new Error(
          `Pipeline failed for videoId=${videoId}.\n` +
            `errorMessage: ${finalStatus.errorMessage}\n` +
            `transcriptError: ${finalStatus.transcriptErrorMessage}\n` +
            `aiError: ${finalStatus.aiErrorMessage}\n` +
            `\nCheck docker compose logs worker for details.`
        );
      }

      expect(finalStatus.processingPhase).toBe("complete");
    },
    // Give the test its own generous timeout on top of the global 180s config
    PIPELINE_TIMEOUT_MS + 20_000
  );

  // -------------------------------------------------------------------------
  // Step 6: assert all fields are correctly populated
  // -------------------------------------------------------------------------

  it("final status has all required fields populated correctly", async () => {
    expect(videoId, "depends on: video reaches complete").toBeTruthy();
    expect(finalStatus, "depends on: pollUntilTerminal").toBeTruthy();

    // Re-fetch for a clean read (guards against stale closure state)
    const { status, body } = await apiGet<VideoStatusResponse>(`/api/videos/${videoId}/status`);
    expect(status).toBe(200);

    // --- Processing phase ---
    expect(body.processingPhase).toBe("complete");
    expect(body.processingProgress).toBe(100);
    expect(body.errorMessage).toBeNull();

    // --- Output keys ---
    expect(body.resultKey, "resultKey should be present on complete video").toBeTruthy();
    expect(body.thumbnailKey, "thumbnailKey should be present on complete video").toBeTruthy();

    // --- Transcription ---
    expect(
      body.transcriptionStatus,
      `transcriptionStatus should be 'complete', got '${body.transcriptionStatus}'`
    ).toBe("complete");

    expect(body.transcript, "transcript should not be null after completion").not.toBeNull();
    const t = body.transcript!;

    // Handle language as either string or object (from Deepgram API response)
    const lang = typeof t.language === "string" ? t.language : (t.language as any)?.language;
    expect(lang, "transcript.language should exist").toBeTruthy();
    expect(lang?.length ?? 0, "transcript.language should be non-empty").toBeGreaterThan(0);

    expect(t.text, "transcript.text should be non-empty").toBeTruthy();
    expect(t.text!.length, "transcript.text should have content").toBeGreaterThan(0);
    expect(Array.isArray(t.segments), "transcript.segments should be an array").toBe(true);
    expect(t.segments.length, "transcript.segments should have at least one entry").toBeGreaterThan(0);

    // Validate segment shape
    const firstSeg = t.segments[0]!;
    expect(typeof firstSeg.startSeconds).toBe("number");
    expect(typeof firstSeg.endSeconds).toBe("number");
    expect(firstSeg.endSeconds).toBeGreaterThanOrEqual(firstSeg.startSeconds);
    expect(typeof firstSeg.text).toBe("string");

    // --- AI output ---
    expect(
      body.aiStatus,
      `aiStatus should be 'complete', got '${body.aiStatus}'`
    ).toBe("complete");

    expect(body.aiOutput, "aiOutput should not be null after completion").not.toBeNull();
    const ai = body.aiOutput!;
    expect(ai.title, "aiOutput.title should be non-empty").toBeTruthy();
    expect(ai.title!.length, "aiOutput.title should have content").toBeGreaterThan(0);
    expect(ai.summary, "aiOutput.summary should be non-empty").toBeTruthy();
    expect(ai.summary!.length, "aiOutput.summary should have content").toBeGreaterThan(0);
    expect(Array.isArray(ai.keyPoints), "aiOutput.keyPoints should be an array").toBe(true);
    // keyPoints may be empty for very short synthetic videos — just check the shape
    ai.keyPoints.forEach((kp, i) => {
      expect(typeof kp, `keyPoints[${i}] should be a string`).toBe("string");
    });

    console.log(`  [step 6] ✓ title="${ai.title}"`);
    console.log(`  [step 6] ✓ summary="${ai.summary?.slice(0, 80)}…"`);
    console.log(`  [step 6] ✓ ${t.segments.length} transcript segment(s), language=${t.language}`);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: API contract — fast checks that don't need a running pipeline
// ---------------------------------------------------------------------------

describe("API contract: validation and error handling", () => {
  it("stack is reachable", async () => {
    const res = await fetch(`${API_BASE}/health`).catch((err) => {
      throw new Error(
        `Cannot reach ${API_BASE} — is docker compose running?\n${err}`
      );
    });
    expect(res.ok).toBe(true);
  });

  it("GET /api/videos/:id/status returns 404 for a nonexistent video", async () => {
    const { status, body } = await apiGet<{ ok: boolean; error: string }>(
      `/api/videos/${randomUUID()}/status`
    );
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it("POST /api/videos returns 400 when Idempotency-Key header is absent", async () => {
    const res = await fetch(`${API_BASE}/api/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Missing key test" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("POST /api/uploads/signed returns 400 when videoId is absent", async () => {
    const { status } = await apiPost("/api/uploads/signed", {}, randomUUID());
    expect(status).toBe(400);
  });

  it("POST /api/uploads/signed returns 404 for an unknown videoId", async () => {
    const { status, body } = await apiPost<{ ok: boolean; error: string }>(
      "/api/uploads/signed",
      { videoId: randomUUID(), contentType: "video/mp4" },
      randomUUID()
    );
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("POST /api/uploads/complete returns 404 for an unknown videoId", async () => {
    const { status, body } = await apiPost<{ ok: boolean; error: string }>(
      "/api/uploads/complete",
      { videoId: randomUUID() },
      randomUUID()
    );
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("POST /api/videos idempotency: same key + same payload returns the same videoId", async () => {
    const key = randomUUID();
    const first = await apiPost<CreateVideoResponse>(
      "/api/videos",
      { name: "Idempotency test" },
      key
    );
    const second = await apiPost<CreateVideoResponse>(
      "/api/videos",
      { name: "Idempotency test" },
      key
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      first.body.videoId,
      "Duplicate idempotency key should return the same videoId"
    ).toBe(second.body.videoId);

    // Clean up
    await apiPost(`/api/videos/${first.body.videoId}/delete`, {}, randomUUID());
  });

  it("POST /api/videos idempotency: same key + different payload returns 409", async () => {
    const key = randomUUID();
    const first = await apiPost<CreateVideoResponse>(
      "/api/videos",
      { name: "First payload" },
      key
    );
    const second = await apiPost<{ statusCode?: number; error?: string }>(
      "/api/videos",
      { name: "Different payload" }, // different request hash
      key
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);

    // Clean up
    await apiPost(`/api/videos/${first.body.videoId}/delete`, {}, randomUUID());
  });

  it("GET /health returns healthy status", async () => {
    const res = await fetch(`${API_BASE}/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("web-api");
  });

  it("GET /ready returns ready status", async () => {
    const res = await fetch(`${API_BASE}/ready`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ready");
  });

  it("POST /api/videos/:id/delete soft-deletes a video and makes it unfindable", async () => {
    // Create a fresh video to delete
    const { body: created } = await apiPost<CreateVideoResponse>(
      "/api/videos",
      { name: "Delete test video" },
      randomUUID()
    );
    const id = created.videoId;

    // Confirm it exists
    const before = await apiGet<VideoStatusResponse>(`/api/videos/${id}/status`);
    expect(before.status).toBe(200);

    // Soft delete it
    const { status: delStatus } = await apiPost(`/api/videos/${id}/delete`, {}, randomUUID());
    expect(delStatus).toBe(200);

    // Confirm it's gone
    const after = await apiGet(`/api/videos/${id}/status`);
    expect(after.status).toBe(404);
  });
});
