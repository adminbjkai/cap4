import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Extracts the audio track as mp3.
 *
 * The input is written to a temp file rather than piped via stdin: mp4 files
 * whose moov atom sits at the end (i.e. anything not written with +faststart,
 * which raw uploads typically are) cannot be demuxed from an unseekable pipe —
 * ffmpeg then exits 0 with an EMPTY output, which used to poison the
 * downstream transcription call.
 */
export async function extractAudio(videoBuffer: Buffer): Promise<Buffer> {
  const inputPath = join(tmpdir(), `cap4-audio-${randomUUID()}`);
  await fs.writeFile(inputPath, videoBuffer);

  try {
    const audio = await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i", inputPath,
        "-vn",
        "-acodec", "libmp3lame",
        "-b:a", "128k",
        "-f", "mp3",
        "pipe:1"
      ]);

      const chunks: Buffer[] = [];
      let stderr = "";

      ffmpeg.stdout.on("data", (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      ffmpeg.on("error", (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        }
      });
    });

    // An "mp3" of just headers/padding means no audio was actually encoded.
    if (audio.length < 1024) {
      throw new Error(`audio extraction produced an empty output (${audio.length} bytes)`);
    }

    return audio;
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => undefined);
  }
}
