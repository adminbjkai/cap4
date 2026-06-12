import { join } from "node:path";
import { promises as fs } from "node:fs";
import { runProcess } from "./exec.js";

export type SceneChange = { ts: number; score: number };

const SCENE_THRESHOLD = 0.10;
const CAPTURE_OFFSET_S = 0.5; // capture at scene-change end + 500ms
const MIN_FRAMES = 50;
const MAX_FRAMES = 150;
const SSIM_DUP_THRESHOLD = 0.95;
const SILENCE_GAP_S = 3;
const SCENE_CLUSTER_WINDOW_S = 2;

/**
 * Parses ffmpeg `metadata=print:file=…` output: a `frame:` line carrying
 * pts_time followed by a `lavfi.scene_score=` line.
 */
export function parseSceneChanges(metadataOutput: string): SceneChange[] {
  const scenes: SceneChange[] = [];
  let pendingTs: number | null = null;
  for (const line of metadataOutput.split("\n")) {
    const frameMatch = line.match(/pts_time:([0-9.]+)/);
    if (frameMatch) {
      pendingTs = Number(frameMatch[1]);
      continue;
    }
    const scoreMatch = line.match(/lavfi\.scene_score=([0-9.]+)/);
    if (scoreMatch && pendingTs !== null) {
      scenes.push({ ts: pendingTs, score: Number(scoreMatch[1]) });
      pendingTs = null;
    }
  }
  return scenes;
}

export async function detectScenes(inputPath: string, workdir: string): Promise<SceneChange[]> {
  const metaPath = join(workdir, "scene-metadata.txt");
  const result = await runProcess({
    bin: "ffmpeg",
    args: [
      "-i", inputPath,
      "-an",
      "-vf", `select='gt(scene,${SCENE_THRESHOLD})',metadata=print:file=${metaPath}`,
      "-f", "null", "-"
    ]
  });
  if (result.code !== 0) {
    throw new Error(`ffmpeg scene detection failed (code ${result.code}): ${result.stderr.slice(-500)}`);
  }
  const output = await fs.readFile(metaPath, "utf8").catch(() => "");
  return parseSceneChanges(output);
}

/**
 * Scene-change timestamps → capture times at +500ms, bounded to 50–150 frames
 * (for short videos the lower bound relaxes to ~one frame per 2s). Above the
 * cap, the weakest scene changes are dropped.
 */
export function chooseCaptureTimes(scenes: SceneChange[], durationSeconds: number): number[] {
  const clamp = (t: number) => Math.min(Math.max(t, 0), Math.max(durationSeconds - 0.1, 0));

  let candidates = scenes
    .map((s) => ({ ts: clamp(s.ts + CAPTURE_OFFSET_S), score: s.score }))
    .sort((a, b) => a.ts - b.ts)
    // collapse captures closer than 250ms
    .filter((c, i, arr) => i === 0 || c.ts - arr[i - 1]!.ts > 0.25);

  if (candidates.length > MAX_FRAMES) {
    candidates = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FRAMES)
      .sort((a, b) => a.ts - b.ts);
  }

  const times = candidates.map((c) => c.ts);
  const minFrames = Math.min(MIN_FRAMES, Math.max(1, Math.floor(durationSeconds / 2)));
  if (times.length < minFrames) {
    const needed = minFrames - times.length;
    for (let i = 0; i < needed; i++) {
      const t = clamp(((i + 1) * durationSeconds) / (needed + 1));
      if (!times.some((existing) => Math.abs(existing - t) < 1)) {
        times.push(t);
      }
    }
    times.sort((a, b) => a - b);
  }
  return times;
}

export async function extractFrame(inputPath: string, ts: number, outPath: string): Promise<void> {
  const result = await runProcess({
    bin: "ffmpeg",
    args: [
      "-y",
      "-ss", ts.toFixed(3),
      "-i", inputPath,
      "-frames:v", "1",
      "-vf", "scale=768:-2",
      "-q:v", "4",
      outPath
    ]
  });
  if (result.code !== 0) {
    throw new Error(`ffmpeg frame extraction at ${ts}s failed: ${result.stderr.slice(-300)}`);
  }
}

export async function ssimScore(aPath: string, bPath: string): Promise<number> {
  const result = await runProcess({
    bin: "ffmpeg",
    args: ["-i", aPath, "-i", bPath, "-lavfi", "ssim", "-f", "null", "-"]
  });
  if (result.code !== 0) {
    throw new Error(`ffmpeg ssim failed: ${result.stderr.slice(-300)}`);
  }
  const match = result.stderr.match(/All:([0-9.]+)/);
  if (!match) {
    throw new Error("could not parse ssim score from ffmpeg output");
  }
  return Number(match[1]);
}

export type ExtractedFrame = { ts: number; path: string };

/** Drops the later of two temporally adjacent frames when SSIM ≥ threshold. */
export async function dedupeFrames(frames: ExtractedFrame[]): Promise<ExtractedFrame[]> {
  const kept: ExtractedFrame[] = [];
  for (const frame of frames) {
    const prev = kept[kept.length - 1];
    if (prev) {
      const score = await ssimScore(prev.path, frame.path);
      if (score >= SSIM_DUP_THRESHOLD) {
        await fs.rm(frame.path, { force: true });
        continue;
      }
    }
    kept.push(frame);
  }
  return kept;
}

export type TranscriptSpan = { startSeconds: number; endSeconds: number };

/**
 * Chapter boundaries: a transcript silence gap (≥3s) that coincides with a
 * scene change (±2s) marks a topic shift. Returns boundary timestamps.
 */
export function computeChapterBoundaries(segments: TranscriptSpan[], scenes: SceneChange[]): number[] {
  const boundaries: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const gapStart = segments[i - 1]!.endSeconds;
    const gapEnd = segments[i]!.startSeconds;
    if (gapEnd - gapStart < SILENCE_GAP_S) continue;
    const hasScene = scenes.some(
      (s) => s.ts >= gapStart - SCENE_CLUSTER_WINDOW_S && s.ts <= gapEnd + SCENE_CLUSTER_WINDOW_S
    );
    if (hasScene) boundaries.push(gapEnd);
  }
  return boundaries;
}

export type Chapter = { start: number; end: number };

/**
 * Splits a recording into chapters no longer than maxChapterSeconds, cutting
 * preferentially at boundaries; spans with no usable boundary split evenly.
 * Recordings within the limit stay a single chapter.
 */
export function splitIntoChapters(
  durationSeconds: number,
  boundaries: number[],
  maxChapterSeconds = 25 * 60
): Chapter[] {
  if (durationSeconds <= maxChapterSeconds) {
    return [{ start: 0, end: durationSeconds }];
  }

  const points = [0, ...boundaries.filter((b) => b > 0 && b < durationSeconds).sort((a, b) => a - b), durationSeconds];
  const merged: Chapter[] = [];
  let start = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const isLast = i === points.length - 1;
    if (isLast || points[i + 1]! - start > maxChapterSeconds) {
      merged.push({ start, end: points[i]! });
      start = points[i]!;
    }
  }

  const result: Chapter[] = [];
  for (const chapter of merged) {
    const length = chapter.end - chapter.start;
    if (length <= maxChapterSeconds) {
      result.push(chapter);
      continue;
    }
    const parts = Math.ceil(length / maxChapterSeconds);
    for (let p = 0; p < parts; p++) {
      result.push({
        start: chapter.start + (p * length) / parts,
        end: chapter.start + ((p + 1) * length) / parts
      });
    }
  }
  return result;
}
