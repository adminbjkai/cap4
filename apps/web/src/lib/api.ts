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
    chapters: Array<{
      title: string;
      seconds: number;
      sentiment?: "positive" | "neutral" | "negative";
    }>;
    entities: {
      people: string[];
      organizations: string[];
      locations: string[];
      dates: string[];
    } | null;
    actionItems: Array<{
      task: string;
      assignee?: string;
      deadline?: string;
    }>;
    quotes: Array<{
      text: string;
      timestamp: number;
    }>;
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

export async function createVideo(name?: string): Promise<VideoCreateResponse> {
  return parseJson<VideoCreateResponse>(
    await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("videos") },
      body: JSON.stringify(name ? { name } : {})
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

export async function getVideoStatus(videoId: string): Promise<VideoStatusResponse> {
  return parseJson<VideoStatusResponse>(await fetch(`/api/videos/${encodeURIComponent(videoId)}/status`));
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

export async function uploadMultipart(
  videoId: string,
  blob: Blob,
  contentType: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<number | null> {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
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

  const parts: Array<{ ETag: string; PartNumber: number }> = [];
  const startedAt = Date.now();
  let uploadedBytesBeforeThisPart = 0;

  // 2. Upload parts sequentially for simplicity in progress tracking
  for (let i = 0; i < totalParts; i++) {
    const partNumber = i + 1;
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, blob.size);
    const chunk = blob.slice(start, end);

    // Get presigned URL for this specific part
    const presign = await parseJson<MultipartPresignResponse>(
      await fetch("/api/uploads/multipart/presign-part", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey("mp-presign") },
        body: JSON.stringify({ videoId, partNumber })
      })
    );

    // Upload the chunk
    const etag = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", presign.putUrl, true);
      xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const currentTotalLoaded = uploadedBytesBeforeThisPart + event.loaded;
        const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
        const speed = currentTotalLoaded / elapsedSec;
        const remaining = blob.size - currentTotalLoaded;
        onProgress?.({
          progressPct: Math.round((currentTotalLoaded / blob.size) * 100),
          loadedBytes: currentTotalLoaded,
          totalBytes: blob.size,
          speedBytesPerSec: speed,
          etaSeconds: speed > 0 ? remaining / speed : null
        });
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

    parts.push({ ETag: etag, PartNumber: partNumber });
    uploadedBytesBeforeThisPart += chunk.size;
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
