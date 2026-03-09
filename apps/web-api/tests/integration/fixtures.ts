/**
 * Test fixture: a minimal but real MP4 video with audio.
 *
 * Generated via ffmpeg (must be installed on the host):
 *   - 320x240, 25fps, libx264/yuv420p
 *   - 1kHz sine-wave audio, AAC 64k
 *   - 4 seconds — long enough for Deepgram to produce utterances
 *   - fragmented MP4 (frag_keyframe+empty_moov) for streaming compatibility
 *
 * The buffer is generated once per test process and cached.
 */

import { spawnSync } from "node:child_process";

let _cached: Buffer | null = null;

/**
 * Returns a Buffer containing a minimal valid MP4.
 * Throws a clear error if ffmpeg is not found.
 */
export function getTestMp4(): Buffer {
  if (_cached) return _cached;

  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      // Video: moving SMPTE test pattern — gives the media-server something real to probe
      "-f", "lavfi",
      "-i", "testsrc=size=320x240:rate=25",
      // Audio: a 440Hz tone — required for Deepgram to produce a transcription
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "4",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "ultrafast",
      "-c:a", "aac",
      "-b:a", "64k",
      // Fragmented MP4 — lets us pipe to stdout and upload without seeking
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
      "pipe:1",
    ],
    {
      maxBuffer: 20 * 1024 * 1024, // 20 MB safety cap
      // Suppress the ffmpeg banner on stderr
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    }
  );

  if (result.error) {
    throw new Error(
      `ffmpeg not found or failed to spawn.\n` +
        `Install ffmpeg (brew install ffmpeg) and retry.\n` +
        `Underlying error: ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `ffmpeg exited with code ${result.status}.\n` +
        `stderr:\n${result.stderr?.toString() ?? "(no stderr)"}`
    );
  }

  const buf = result.stdout as Buffer;
  if (!buf || buf.length < 1024) {
    throw new Error(
      `ffmpeg produced a suspiciously small output (${buf?.length ?? 0} bytes). Check ffmpeg install.`
    );
  }

  _cached = buf;
  return _cached;
}
