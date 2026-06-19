import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

/**
 * Extracts the audio track as mp3 (128k) — a fraction of the video's size,
 * which is all the transcription provider needs.
 *
 * The input is a seekable file on disk rather than a stdin pipe: mp4 files
 * whose moov atom sits at the end (i.e. anything not written with +faststart,
 * which raw uploads typically are) cannot be demuxed from an unseekable pipe —
 * ffmpeg then exits 0 with an EMPTY output, which used to poison the
 * downstream transcription call. Callers stream large media to a temp file
 * first instead of holding the whole video in memory.
 */
export async function extractAudioFromFile(inputPath: string): Promise<Buffer> {
  {
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
  }
}
