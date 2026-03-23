import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import Fastify from "fastify";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "@cap/config";

const env = getEnv();
const app = Fastify({ logger: false });

type ProcessRequest = {
  videoId: string;
  rawKey: string;
};

type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
};

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "media-server", event, ...fields }));
}

function getS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 configuration for media-server");
  }

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

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      }
    });
  });
}

async function runCommandJson(command: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse ${command} JSON output: ${String(error)}`));
      }
    });
  });
}

async function downloadObjectToFile(client: S3Client, bucket: string, key: string, filePath: string): Promise<void> {
  const output = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  if (!output.Body) {
    throw new Error(`S3 object body missing for key ${key}`);
  }

  await fs.mkdir(dirname(filePath), { recursive: true });

  const body = output.Body as NodeJS.ReadableStream;
  await pipeline(body, createWriteStream(filePath));
}

async function uploadFile(client: S3Client, bucket: string, key: string, filePath: string, contentType: string): Promise<void> {
  const body = await fs.readFile(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

async function probeVideo(filePath: string): Promise<ProbeResult> {
  const parseFps = (value?: string): number | null => {
    if (!value || typeof value !== "string") return null;
    const parts = value.split("/");
    if (parts.length !== 2) return null;
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
    return Number((numerator / denominator).toFixed(3));
  };

  const parsed = (await runCommandJson("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath
  ])) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string }>;
    format?: { duration?: string };
  };

  const videoStream = (parsed.streams ?? []).find((stream) => stream.codec_type === "video");
  const hasAudio = (parsed.streams ?? []).some((stream) => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? "0");

  return {
    durationSeconds: Number.isFinite(duration) ? Number(duration.toFixed(3)) : 0,
    width: Number(videoStream?.width ?? 0),
    height: Number(videoStream?.height ?? 0),
    fps: parseFps(videoStream?.r_frame_rate),
    hasAudio
  };
}

app.get("/health", async () => ({ ok: true }));

app.post<{ Body: ProcessRequest }>("/process", async (req, reply) => {
  const { videoId, rawKey } = req.body ?? ({} as ProcessRequest);
  if (!videoId || !rawKey) {
    return reply.code(400).send({ ok: false, error: "videoId and rawKey are required" });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(videoId)) {
    return reply.code(400).send({ error: "Invalid videoId format" });
  }

  const workDir = join("/tmp", "cap4-media", videoId);
  const inputPath = join(workDir, "source-input.mp4");
  const resultPath = join(workDir, "result.mp4");
  const thumbPath = join(workDir, "screen-capture.jpg");

  const resultKey = `videos/${videoId}/result/result.mp4`;
  const thumbnailKey = `videos/${videoId}/thumb/screen-capture.jpg`;

  try {
    const { client, bucket } = getS3Client();
    await fs.mkdir(workDir, { recursive: true });

    log("process.download.start", { videoId, rawKey });
    await downloadObjectToFile(client, bucket, rawKey, inputPath);

    log("process.ffmpeg.transcode.start", { videoId });
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      resultPath
    ]);

    log("process.ffmpeg.thumbnail.start", { videoId });
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      resultPath,
      "-vf",
      "thumbnail",
      "-frames:v",
      "1",
      thumbPath
    ]);

    const metadata = await probeVideo(resultPath);

    log("process.upload.start", { videoId, resultKey, thumbnailKey });
    await uploadFile(client, bucket, resultKey, resultPath, "video/mp4");
    await uploadFile(client, bucket, thumbnailKey, thumbPath, "image/jpeg");

    await fs.rm(workDir, { recursive: true, force: true });

    log("process.completed", { videoId, resultKey, thumbnailKey, ...metadata });
    return reply.send({ resultKey, thumbnailKey, ...metadata });
  } catch (error) {
    log("process.failed", { videoId, rawKey, error: String(error) });
    await fs.rm(workDir, { recursive: true, force: true });
    return reply.code(500).send({ ok: false, error: String(error) });
  }
});

await app.listen({ host: "0.0.0.0", port: env.MEDIA_SERVER_PORT });
log("server.started", { port: env.MEDIA_SERVER_PORT });
