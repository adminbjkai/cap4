import { join } from "node:path";
import { promises as fs } from "node:fs";
import { runProcess } from "./exec.js";

export type SceneChange = { ts: number; score: number };

const SCENE_THRESHOLD = 0.10;
const CAPTURE_OFFSET_S = 0.5; // capture at scene-change end + 500ms
// Docs only ever render a handful of screenshots, so extract modestly:
// fewer ffmpeg seeks, fewer SSIM compares, fewer images to upload.
const MIN_FRAMES = 12;
const MAX_FRAMES = 40;
// Frames are BOTH the model's vision input AND the screenshots rendered in the
// doc UI (DocCard shows the frame directly). 768px looked soft / pixelated when
// enlarged, so extract at up to 1920px wide (capped, never upscaled) at high
// JPEG quality. This also gives the model crisper input.
const FRAME_MAX_WIDTH = 1920;
const FRAME_JPEG_QUALITY = "2"; // ffmpeg -q:v: 1=best … 31=worst
// Screen recordings change little between near-identical states (cursor,
// caret); 0.92 trims those at the source so fewer images reach the model.
const SSIM_DUP_THRESHOLD = 0.92;

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
      // cap width at FRAME_MAX_WIDTH, never upscale (min with input width);
      // the comma inside min() is escaped for the ffmpeg filtergraph parser.
      "-vf", `scale=min(${FRAME_MAX_WIDTH}\\,iw):-2`,
      "-q:v", FRAME_JPEG_QUALITY,
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

