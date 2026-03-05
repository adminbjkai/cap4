import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

export async function extractAudio(videoBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
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

    ffmpeg.stdin.write(videoBuffer);
    ffmpeg.stdin.end();
  });
}
