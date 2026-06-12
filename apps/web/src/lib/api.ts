export type VideoCreateResponse = {
  videoId: string;
  rawKey: string;
};

export type SignedUploadResponse = {
  videoId: string;
  rawKey: string;
  method: "PUT";
  putUrl: string;
  headers: Record<string, string>;
};

export type CompleteUploadResponse = {
  videoId: string;
  rawKey: string;
  jobId: number;
  status: "uploaded";
};

export type MultipartInitiateResponse = {
  ok: boolean;
  videoId: string;
  uploadId: string;
  rawKey: string;
};

export type MultipartPresignResponse = {
  ok: boolean;
  videoId: string;
  partNumber: number;
  putUrl: string;
};

export type MultipartCompleteResponse = {
  ok: boolean;
  videoId: string;
  jobId: number;
  status: "uploaded";
};

export type VideoStatusResponse = {
  videoId: string;
  name: string;
  processingPhase: string;
  processingProgress: number;
  resultKey: string | null;
  thumbnailKey: string | null;
  errorMessage: string | null;
  transcriptionStatus: string;
  aiStatus: string;
  transcriptErrorMessage: string | null;
  aiErrorMessage: string | null;
  createdAt: string;
  originalFileCreatedAt: string | null;
  transcript: {
    provider: string | null;
    language: string | null;
    vttKey: string;
    text: string | null;
    speakerLabels?: Record<string, string>;
    segments: Array<{
      startSeconds?: number;
      endSeconds?: number;
      text?: string;
      confidence?: number | null;
      speaker?: number | null;
      originalText?: string;
    }>;
  } | null;
  aiOutput: {
    provider: string | null;
    model: string | null;
    title: string | null;
    summary: string | null;
    keyPoints: string[];
  } | null;
};

export type WatchEditsResponse = {
  ok: boolean;
  videoId: string;
  updated: {
    title: boolean;
    transcript: boolean;
    speakerLabels?: boolean;
  };
};

export type DeleteVideoResponse = {
  ok: boolean;
  videoId: string;
  deletedAt: string;
};

export type LibraryVideoCard = {
  videoId: string;
  displayTitle: string;
  hasThumbnail: boolean;
  hasResult: boolean;
  thumbnailKey: string | null;
  processingPhase: string;
  transcriptionStatus: string;
  aiStatus: string;
  createdAt: string;
  originalFileCreatedAt: string | null;
  durationSeconds: number | null;
};

export type LibraryVideosResponse = {
  items: LibraryVideoCard[];
  sort: "created_desc" | "created_asc";
  limit: number;
  nextCursor: string | null;
};

export type JobStatusResponse = {
  id: string;
  video_id: string;
  job_type: string;
  status: string;
  attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  lease_token: string | null;
  run_after: string;
  last_error: string | null;
  updated_at: string;
};

export type ProviderStatusResponse = {
  checkedAt: string;
  providers: Array<{
    key: "deepgram" | "groq";
    label: string;
    purpose: "transcription" | "ai";
    state: "healthy" | "active" | "degraded" | "idle" | "unavailable";
    configured: boolean;
    baseUrl: string | null;
    model: string | null;
    lastSuccessAt: string | null;
    lastJob: {
      id: number;
      videoId: string;
      status: string;
      updatedAt: string;
      lastError: string | null;
    } | null;
  }>;
};

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function newIdempotencyKey(prefix: string): string {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export async function createVideo(
  name?: string,
  originalFileCreatedAt?: string | null
): Promise<VideoCreateResponse> {
  const body: { name?: string; originalFileCreatedAt?: string } = {};
  if (name) body.name = name;
  if (originalFileCreatedAt) body.originalFileCreatedAt = originalFileCreatedAt;
  return parseJson<VideoCreateResponse>(
    await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("videos") },
      body: JSON.stringify(body)
    })
  );
}

export async function requestSignedUpload(videoId: string, contentType: string): Promise<SignedUploadResponse> {
  return parseJson<SignedUploadResponse>(
    await fetch("/api/uploads/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("upload-signed") },
      body: JSON.stringify({ videoId, contentType })
    })
  );
}

export async function completeUpload(videoId: string): Promise<CompleteUploadResponse> {
  return parseJson<CompleteUploadResponse>(
    await fetch("/api/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("upload-complete") },
      body: JSON.stringify({ videoId })
    })
  );
}

export type VideoStatusSummary = Omit<VideoStatusResponse, "transcript" | "aiOutput">;

export async function getVideoStatus(videoId: string): Promise<VideoStatusResponse> {
  return parseJson<VideoStatusResponse>(await fetch(`/api/videos/${encodeURIComponent(videoId)}/status`));
}

/** Lightweight poll: same status fields, but without the (large, rarely
 * changing) transcript and AI output payloads. */
export async function getVideoStatusSummary(videoId: string): Promise<VideoStatusSummary> {
  return parseJson<VideoStatusSummary>(
    await fetch(`/api/videos/${encodeURIComponent(videoId)}/status?view=summary`)
  );
}

export async function getJobStatus(jobId: number): Promise<JobStatusResponse> {
  return parseJson<JobStatusResponse>(await fetch(`/api/jobs/${jobId}`));
}

export async function retryVideo(videoId: string): Promise<{ ok: boolean; videoId: string; jobsReset: string[] }> {
  return parseJson<{ ok: boolean; videoId: string; jobsReset: string[] }>(
    await fetch(`/api/videos/${encodeURIComponent(videoId)}/retry`, {
      method: "POST",
      headers: {
        "Idempotency-Key": newIdempotencyKey("retry")
      }
    })
  );
}

export async function deleteVideo(videoId: string): Promise<DeleteVideoResponse> {
  return parseJson<DeleteVideoResponse>(
    await fetch(`/api/videos/${encodeURIComponent(videoId)}/delete`, {
      method: "POST",
      headers: {
        "Idempotency-Key": newIdempotencyKey("delete-video")
      }
    })
  );
}

export async function getSystemProviderStatus(): Promise<ProviderStatusResponse> {
  return parseJson<ProviderStatusResponse>(await fetch("/api/system/provider-status"));
}

export async function saveWatchEdits(
  videoId: string,
  payload: { title?: string | null; transcriptText?: string | null; speakerLabels?: Record<string, string> | null },
  idempotencyKey: string
): Promise<WatchEditsResponse> {
  return parseJson<WatchEditsResponse>(
    await fetch(`/api/videos/${encodeURIComponent(videoId)}/watch-edits`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(payload)
    })
  );
}

export async function getLibraryVideos(params?: {
  cursor?: string | null;
  limit?: number;
  sort?: "created_desc" | "created_asc";
}): Promise<LibraryVideosResponse> {
  const queryParams = new URLSearchParams();
  if (params?.cursor) queryParams.set("cursor", params.cursor);
  if (typeof params?.limit === "number" && Number.isFinite(params.limit)) queryParams.set("limit", String(params.limit));
  if (params?.sort) queryParams.set("sort", params.sort);
  const suffix = queryParams.toString();
  return parseJson<LibraryVideosResponse>(await fetch(`/api/library/videos${suffix ? `?${suffix}` : ""}`));
}

export type UploadProgress = {
  progressPct: number;
  loadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
};

export async function uploadToSignedUrl(
  putUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", putUrl, true);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
      const speedBytesPerSec = event.loaded / elapsedSec;
      const remaining = event.total - event.loaded;
      const etaSeconds = speedBytesPerSec > 0 ? remaining / speedBytesPerSec : null;
      onProgress?.({
        progressPct: Math.round((event.loaded / event.total) * 100),
        loadedBytes: event.loaded,
        totalBytes: event.total,
        speedBytesPerSec,
        etaSeconds
      });
    };

    xhr.onerror = () => reject(new Error("Upload failed due to network error"));

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({
          progressPct: 100,
          loadedBytes: blob.size,
          totalBytes: blob.size,
          speedBytesPerSec: 0,
          etaSeconds: 0
        });
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText} ${xhr.responseText || ""}`));
      }
    };

    xhr.send(blob);
  });
}

/**
 * Streams a recording to S3 multipart parts WHILE it is still being captured,
 * so that when the user stops recording only the final part + complete remain.
 *
 * Usage: construct → start() → addChunk() per MediaRecorder chunk → finish().
 * Parts are flushed once the internal buffer reaches PART_SIZE (S3 requires
 * all parts except the last to be >= 5MB). Uploads are chained sequentially
 * so part ordering and bandwidth contention with the live capture stay sane.
 */
export class LiveMultipartUploader {
  private buffer: Blob[] = [];
  private bufferedBytes = 0;
  private nextPartNumber = 1;
  private parts: Array<{ ETag: string; PartNumber: number }> = [];
  private chain: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private started = false;
  private finished = false;
  uploadedBytes = 0;

  static readonly PART_SIZE = 8 * 1024 * 1024; // 8MB (S3 min for non-final parts is 5MB)

  constructor(
    readonly videoId: string,
    private readonly contentType: string
  ) {}

  get failed(): Error | null {
    return this.failure;
  }

  async start(): Promise<void> {
    await parseJson<MultipartInitiateResponse>(
      await fetch("/api/uploads/multipart/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("mp-init") },
        body: JSON.stringify({ videoId: this.videoId, contentType: this.contentType })
      })
    );
    this.started = true;
  }

  addChunk(chunk: Blob): void {
    if (!this.started || this.finished || this.failure) return;
    this.buffer.push(chunk);
    this.bufferedBytes += chunk.size;
    if (this.bufferedBytes >= LiveMultipartUploader.PART_SIZE) {
      this.flushPart();
    }
  }

  private flushPart(): void {
    if (this.buffer.length === 0) return;
    const partBlob = new Blob(this.buffer, { type: this.contentType });
    this.buffer = [];
    this.bufferedBytes = 0;
    const partNumber = this.nextPartNumber++;
    this.chain = this.chain.then(async () => {
      if (this.failure) return;
      try {
        const etag = await this.uploadPart(partBlob, partNumber);
        this.parts.push({ ETag: etag, PartNumber: partNumber });
        this.uploadedBytes += partBlob.size;
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
      }
    });
  }

  private async uploadPart(partBlob: Blob, partNumber: number): Promise<string> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // Fresh presign per attempt (URLs can expire between retries).
        const presign = await parseJson<MultipartPresignResponse>(
          await fetch("/api/uploads/multipart/presign-part", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("mp-presign") },
            body: JSON.stringify({ videoId: this.videoId, partNumber })
          })
        );
        const res = await fetch(presign.putUrl, {
          method: "PUT",
          headers: { "Content-Type": this.contentType || "application/octet-stream" },
          body: partBlob
        });
        if (!res.ok) throw new Error(`Part ${partNumber} upload failed: ${res.status} ${res.statusText}`);
        const etag = res.headers.get("ETag");
        if (!etag) throw new Error(`No ETag returned for part ${partNumber}`);
        return etag.replace(/"/g, "");
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Part ${partNumber} failed after ${MAX_ATTEMPTS} attempts`);
  }

  /** Flush the final part, wait for in-flight uploads, then complete. */
  async finish(): Promise<number | null> {
    if (!this.started) throw new Error("Live upload was never started");
    this.finished = true;
    this.flushPart(); // final part may be < 5MB — allowed by S3
    await this.chain;
    if (this.failure) throw this.failure;
    if (this.parts.length === 0) throw new Error("No data was uploaded");
    const completed = await parseJson<MultipartCompleteResponse>(
      await fetch("/api/uploads/multipart/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("mp-complete") },
        body: JSON.stringify({ videoId: this.videoId, parts: this.parts })
      })
    );
    return completed.jobId;
  }

  /** Best-effort abort, e.g. before falling back to a fresh whole-blob upload. */
  async abort(): Promise<void> {
    this.finished = true;
    try {
      await this.chain;
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/uploads/multipart/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("mp-abort") },
        body: JSON.stringify({ videoId: this.videoId })
      });
    } catch {
      /* best effort */
    }
  }
}

/** PUT one part via XHR (for upload progress events), returning its ETag. */
function putPartXhr(
  putUrl: string,
  chunk: Blob,
  contentType: string,
  onPartLoaded: (loadedBytes: number) => void
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", putUrl, true);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onPartLoaded(event.loaded);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etagHeader = xhr.getResponseHeader("ETag");
        if (etagHeader) {
          // S3 ETag is quoted
          resolve(etagHeader.replace(/"/g, ""));
        } else {
          reject(new Error("No ETag returned from part upload"));
        }
      } else {
        reject(new Error(`Part upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during part upload"));
    xhr.send(chunk);
  });
}

export async function uploadMultipart(
  videoId: string,
  blob: Blob,
  contentType: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<number | null> {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
  const PART_CONCURRENCY = 3;
  const PART_MAX_ATTEMPTS = 3;
  const totalParts = Math.ceil(blob.size / CHUNK_SIZE);

  // 1. Initiate
  await parseJson<MultipartInitiateResponse>(
    await fetch("/api/uploads/multipart/initiate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": newIdempotencyKey("mp-init")
      },
      body: JSON.stringify({ videoId, contentType })
    })
  );

  // 2. Upload parts in parallel (bounded), with per-part retry. Progress is
  // aggregated across in-flight parts.
  const parts: Array<{ ETag: string; PartNumber: number }> = new Array(totalParts);
  const startedAt = Date.now();
  const partLoaded: number[] = new Array(totalParts).fill(0);

  const reportProgress = () => {
    const loadedBytes = partLoaded.reduce((sum, n) => sum + n, 0);
    const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const speed = loadedBytes / elapsedSec;
    const remaining = blob.size - loadedBytes;
    onProgress?.({
      progressPct: Math.round((loadedBytes / blob.size) * 100),
      loadedBytes,
      totalBytes: blob.size,
      speedBytesPerSec: speed,
      etaSeconds: speed > 0 ? remaining / speed : null
    });
  };

  const uploadOnePart = async (index: number): Promise<void> => {
    const partNumber = index + 1;
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, blob.size);
    const chunk = blob.slice(start, end);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
      try {
        // Fresh presign per attempt (URLs can expire between retries).
        const presign = await parseJson<MultipartPresignResponse>(
          await fetch("/api/uploads/multipart/presign-part", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("mp-presign") },
            body: JSON.stringify({ videoId, partNumber })
          })
        );
        const etag = await putPartXhr(presign.putUrl, chunk, contentType, (loaded) => {
          partLoaded[index] = loaded;
          reportProgress();
        });
        parts[index] = { ETag: etag, PartNumber: partNumber };
        partLoaded[index] = chunk.size;
        reportProgress();
        return;
      } catch (error) {
        lastError = error;
        partLoaded[index] = 0;
        if (attempt < PART_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Part ${partNumber} failed after ${PART_MAX_ATTEMPTS} attempts`);
  };

  let nextIndex = 0;
  let failed = false;
  try {
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, totalParts) }, async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= totalParts || failed) return;
          try {
            await uploadOnePart(index);
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      })
    );
  } catch (error) {
    // Clean up orphaned parts so MinIO doesn't accumulate them.
    void fetch("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("mp-abort") },
      body: JSON.stringify({ videoId })
    }).catch(() => undefined);
    throw error;
  }

  // 3. Complete
  const completed = await parseJson<MultipartCompleteResponse>(
    await fetch("/api/uploads/multipart/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": newIdempotencyKey("mp-complete")
      },
      body: JSON.stringify({ videoId, parts })
    })
  );

  return completed.jobId;
}

/* ── Doc pipeline (opt-in, PIPELINE_V2) ──────────────────────────────────── */

export type DocStepResponse = {
  position: number;
  text: string;
  frameId: string | null;
  frameKey: string | null;
  frameTs: number | null;
  crop: { x: number; y: number; w: number; h: number } | null;
  alt: string | null;
  callout: string | null;
};

export type DocSectionResponse = {
  id: string;
  position: number;
  heading: string;
  bodyMd: string;
  startS: number | null;
  endS: number | null;
  steps: DocStepResponse[];
};

export type DocResponse = {
  id: string;
  status: "generating" | "complete" | "failed";
  title: string | null;
  docType: string | null;
  markdown: string | null;
  confidenceNotes: string[];
  unusedFrames: string[];
  promptVersion: string | null;
  model: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  sections: DocSectionResponse[];
};

/** Returns null when no document exists yet (404). */
export async function getVideoDoc(videoId: string): Promise<DocResponse | null> {
  const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/doc`);
  if (res.status === 404) return null;
  const body = await parseJson<{ ok: boolean; document: DocResponse }>(res);
  return body.document;
}

export async function generateVideoDoc(videoId: string): Promise<{ ok: boolean; jobId: number; status: string }> {
  return parseJson(
    await fetch(`/api/videos/${encodeURIComponent(videoId)}/generate-doc`, { method: "POST" })
  );
}
