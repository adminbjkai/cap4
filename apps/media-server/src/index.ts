import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
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
  jobId?: string | number;
};

type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  pixFmt: string | null;
  audioCodec: string | null;
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
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
    format?: { duration?: string };
  };

  const videoStream = (parsed.streams ?? []).find((stream) => stream.codec_type === "video");
  const audioStream = (parsed.streams ?? []).find((stream) => stream.codec_type === "audio");
  const hasAudio = Boolean(audioStream);
  const duration = Number(parsed.format?.duration ?? "0");

  return {
    durationSeconds: Number.isFinite(duration) ? Number(duration.toFixed(3)) : 0,
    width: Number(videoStream?.width ?? 0),
    height: Number(videoStream?.height ?? 0),
    fps: parseFps(videoStream?.r_frame_rate),
    hasAudio,
    videoCodec: videoStream?.codec_name ?? null,
    pixFmt: videoStream?.pix_fmt ?? null,
    audioCodec: audioStream?.codec_name ?? null
  };
}

/**
 * A source can be remuxed (stream-copied) into a web-playable mp4 — skipping the
 * expensive re-encode entirely — when its codecs are already browser-compatible.
 */
function canRemux(probe: ProbeResult): boolean {
  if (probe.videoCodec !== "h264") return false;
  if (probe.pixFmt !== "yuv420p") return false;
  if (probe.hasAudio && probe.audioCodec !== "aac") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Signed progress webhooks → web-api
//
// Processing is async: /process replies 202 immediately and this reports
// phase transitions, completion (with result/thumbnail keys + metadata), or
// failure. Signature format matches web-api's verifyWebhookSignature:
// v1=<hmac-sha256(secret, `${timestamp}.${rawBody}`)>.
// ---------------------------------------------------------------------------

const WEBHOOK_URL = `${env.WEB_API_BASE_URL}/api/webhooks/media-server/progress`;

async function sendProgressWebhook(
  jobId: string,
  videoId: string,
  phase: string,
  progress: number,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  const payload = JSON.stringify({ jobId, videoId, phase, progress, ...extra });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature =
        "v1=" +
        createHmac("sha256", env.MEDIA_SERVER_WEBHOOK_SECRET)
          .update(`${timestamp}.${payload}`)
          .digest("hex");
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/cap4-webhook+json",
          "x-cap-timestamp": timestamp,
          "x-cap-signature": signature,
          "x-cap-delivery-id": randomUUID()
        },
        body: payload,
        signal: AbortSignal.timeout(10_000)
      });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
      return true;
    } catch (error) {
      log("webhook.send_failed", { videoId, phase, attempt, error: String(error) });
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return false;
}

app.get("/health", async () => ({ ok: true }));

app.post<{ Body: ProcessRequest }>("/process", async (req, reply) => {
  const { videoId, rawKey, jobId } = req.body ?? ({} as ProcessRequest);
  if (!videoId || !rawKey) {
    return reply.code(400).send({ ok: false, error: "videoId and rawKey are required" });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(videoId)) {
    return reply.code(400).send({ error: "Invalid videoId format" });
  }

  // Accept immediately; the pipeline runs in the background and reports its
  // phases, completion, or failure via signed webhooks to web-api. The
  // caller (worker) acks its queue job on this 202.
  void processVideo(videoId, rawKey, String(jobId ?? videoId));
  return reply.code(202).send({ ok: true, accepted: true, videoId });
});

// In the sync flow, transient failures (S3 blips, races) were retried by the
// worker's job queue. The async handoff acks the queue job up front, so the
// retry responsibility moves here: a bounded internal retry loop before the
// terminal `failed` webhook is sent.
async function processVideo(videoId: string, rawKey: string, jobId: string): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await processVideoAttempt(videoId, rawKey, jobId);
      return;
    } catch (error) {
      log("process.attempt_failed", { videoId, rawKey, attempt, error: String(error) });
      if (attempt === MAX_ATTEMPTS) {
        await sendProgressWebhook(jobId, videoId, "failed", 100, {
          error: String(error).slice(0, 1000)
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 15_000 * attempt));
    }
  }
}

async function processVideoAttempt(videoId: string, rawKey: string, jobId: string): Promise<void> {
  // Per-attempt directory: a retried/abandoned attempt for the same video must
  // not delete the files of a still-running one.
  const workDir = join("/tmp", "cap4-media", `${videoId}-${randomUUID()}`);
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
    await sendProgressWebhook(jobId, videoId, "probing", 33);

    // Probe the INPUT first: decides remux vs transcode and gives a seek point
    // for the thumbnail (which runs concurrently, straight off the source).
    const inputProbe = await probeVideo(inputPath);
    const remux = canRemux(inputProbe);
    await sendProgressWebhook(jobId, videoId, "processing", 60);

    const transcodeArgs = remux
      ? [
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        resultPath
      ]
      : [
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
      ];

    // Thumbnail from the source via a cheap seek (decode ~1 frame, not the
    // whole file), in parallel with the transcode/remux.
    const thumbSeekSeconds =
      inputProbe.durationSeconds > 2 ? Math.min(1, inputProbe.durationSeconds / 2) : 0;
    const thumbnailArgs = [
      "-y",
      "-ss",
      String(thumbSeekSeconds),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      thumbPath
    ];

    log(remux ? "process.ffmpeg.remux.start" : "process.ffmpeg.transcode.start", {
      videoId,
      videoCodec: inputProbe.videoCodec,
      audioCodec: inputProbe.audioCodec,
      pixFmt: inputProbe.pixFmt
    });
    await Promise.all([
      runCommand("ffmpeg", transcodeArgs),
      runCommand("ffmpeg", thumbnailArgs)
    ]);

    const metadata = await probeVideo(resultPath);

    log("process.upload.start", { videoId, resultKey, thumbnailKey, remux });
    await sendProgressWebhook(jobId, videoId, "uploading", 88);
    await Promise.all([
      uploadFile(client, bucket, resultKey, resultPath, "video/mp4"),
      uploadFile(client, bucket, thumbnailKey, thumbPath, "image/jpeg")
    ]);

    await fs.rm(workDir, { recursive: true, force: true });

    log("process.completed", { videoId, resultKey, thumbnailKey, ...metadata });
    await sendProgressWebhook(jobId, videoId, "complete", 100, {
      resultKey,
      thumbnailKey,
      hasAudio: metadata.hasAudio,
      metadata: {
        duration: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps
      }
    });
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw error;
  }
}

await app.listen({ host: "0.0.0.0", port: env.MEDIA_SERVER_PORT });
log("server.started", { port: env.MEDIA_SERVER_PORT });
