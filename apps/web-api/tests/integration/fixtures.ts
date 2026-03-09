/**
 * Test fixture: loads a real MP4 video with audio from samplevids/vid0.mp4
 *
 * This uses a real video file (30 seconds) with proper audio that Deepgram can transcribe.
 * The buffer is cached once per test process.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let _cached: Buffer | null = null;

/**
 * Returns a Buffer containing a real MP4 video with audio.
 * Throws a clear error if the file is not found.
 */
export function getTestMp4(): Buffer {
  if (_cached) return _cached;

  // Path to the sample video file (relative to this file)
  // From apps/web-api/tests/integration/ → up 4 levels to project root → samplevids/
  const videoPath = resolve(__dirname, "../../../../samplevids/vid0.mp4");

  try {
    _cached = readFileSync(videoPath);
  } catch (error) {
    throw new Error(
      `Failed to load test video from ${videoPath}.\n` +
        `Make sure samplevids/vid0.mp4 exists in the project root.\n` +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!_cached || _cached.length < 1024) {
    throw new Error(
      `Video file is suspiciously small (${_cached?.length ?? 0} bytes). Check the file.`
    );
  }

  return _cached;
}
