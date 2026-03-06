# API Endpoints

## Health
- `GET /health` -> `200 {"ok": true}`

## Frontend Routes (apps/web)
- `GET /` (Docker-first via nginx at `http://localhost:8022`; optional Vite dev at `http://localhost:5173`) -> Home, global library view (server-backed) + secondary local cache
- `GET /record` -> Recorder flow (screen + mic, preview, upload)
- `GET /video/:videoId` -> Processing status, playback, transcript, AI summary

## Implemented (web-api)
- `POST /api/videos`
  - Required header: `Idempotency-Key`
  - Creates one `videos` row and one `uploads` row (`mode=singlepart`, `phase=pending`)
  - Response: `{ videoId, rawKey }`

- `POST /api/uploads/signed`
  - Required header: `Idempotency-Key`
  - Body: `{ videoId, contentType? }`
  - Returns single-part presigned PUT URL for `uploads.raw_key`
  - Updates `uploads.phase='uploading'`
  - Response: `{ videoId, rawKey, method: "PUT", putUrl, headers }`

- `POST /api/uploads/complete`
  - Required header: `Idempotency-Key`
  - Body: `{ videoId }`
  - Updates `uploads.phase='uploaded'`
  - Updates video processing to queued
  - Enqueues `job_queue(job_type='process_video')`
  - Response: `{ videoId, rawKey, jobId, status: "uploaded" }`

- `GET /api/videos/:id/status`
  - Returns combined read model for processing + transcript + AI
  - Response fields:
    - `videoId`, `processingPhase`, `processingProgress`, `resultKey`, `thumbnailKey`, `errorMessage`
    - `transcriptionStatus`, `aiStatus`, `transcriptErrorMessage`, `aiErrorMessage`
    - `transcript` object or `null`
      - `provider`, `language`, `vttKey`, `text`, `segments[]`
    - `aiOutput` object or `null`
      - `provider`, `model`, `title`, `summary`, `keyPoints[]`

- `GET /api/jobs/:id`
  - Returns one `job_queue` row by numeric job id
  - Response fields: `id, video_id, job_type, status, attempts, locked_by, locked_until, lease_token, run_after, last_error, updated_at`

- `PATCH /api/videos/:id/watch-edits`
  - Purpose: persist watch-page title and transcript corrections.
  - Required header: `Idempotency-Key`.
  - Body (at least one field required):
    - `title?: string | null`
    - `transcriptText?: string | null`
  - Idempotency behavior:
    - same key + same payload -> replay-safe cached response
    - same key + different payload -> `409`
  - Response: `{ ok, videoId, updated: { title: boolean, transcript: boolean } }`

- `GET /api/library/videos?cursor=&limit=&sort=created_desc|created_asc`
  - Purpose: global library read model for home page cards.
  - Side effects: none (read-only).
  - Default sort: `created_desc`.
  - Response: `{ items, sort, limit, nextCursor }` where item fields include:
    - `videoId`, `displayTitle`
    - `hasThumbnail`, `hasResult`, `thumbnailKey`
    - `processingPhase`, `transcriptionStatus`, `aiStatus`
    - `createdAt`, `durationSeconds`

## Webhook
- `POST /api/webhooks/media-server/progress`
  - Verifies `X-Cap-Timestamp`, `X-Cap-Signature`, `X-Cap-Delivery-Id`
  - Enforces timestamp skew and HMAC signature
  - Dedupes by delivery id and applies monotonic processing updates
  - Response: `{ accepted, duplicate, applied }`

## Debug Endpoints (local/dev)
- `POST /debug/videos`
- `POST /debug/jobs/enqueue`
- `POST /debug/enqueue`
- `GET /debug/job/:id`
- `POST /debug/smoke`

## Implemented (web-api, continued)
- `DELETE /api/videos/:id`
  - Purpose: soft delete video from default library views.
  - Required header: `Idempotency-Key`.
  - Response: `{ ok, videoId }`

- `POST /api/videos/:videoId/retry`
  - Purpose: re-enqueue a failed `process_video` job.
  - Required header: `Idempotency-Key`.
  - Response: `{ ok, videoId, jobId }`

- `GET /api/system/provider-status`
  - Purpose: returns health and configuration status for Deepgram and Groq.
  - Response: `{ deepgram: { configured, health, ... }, groq: { ... } }`

## Planned Contracts (Phase G+)
Status: `planned` only. These routes are design targets for productization and are not available yet.

- `GET /api/library/videos/:id/card`
  - Purpose: compact card read model fetch.
  - Side effects: none (read-only).
  - Response (planned): `LibraryVideoCard`

- `GET /api/library/folders`
  - Purpose: list folders for library filtering/move UX.
  - Side effects: none (read-only).
  - Response (planned): `{ items: Folder[] }`

- `POST /api/library/folders`
  - Purpose: create folder.
  - Required header: `Idempotency-Key`.
  - Body (planned): `{ name: string }`
  - Response (planned): `{ ok, folder }`

- `POST /api/library/videos/:id/move`
  - Purpose: move a video to folder or unfile it.
  - Required header: `Idempotency-Key`.
  - Body (planned): `{ targetFolderId: string | null }`
  - Response (planned): `{ ok, videoId, folderId: string | null }`

## Not Implemented (placeholders)
- `POST /api/uploads/multipart/initiate` -> `501`
- `POST /api/uploads/multipart/presign-part` -> `501`
- `POST /api/uploads/multipart/complete` -> `501`
- `POST /api/uploads/multipart/abort` -> `501`
- `GET /api/playlist` -> `501`
- `POST /api/videos/:videoId/retry-transcription` -> `501`
- `POST /api/videos/:videoId/retry-ai` -> `501`

## Media Server
- `GET /health` -> `200 {"ok": true}`
- `POST /process` -> FFmpeg transcode + thumbnail generation + metadata probe
  - Response: `{ resultKey, thumbnailKey, durationSeconds, width, height, fps, hasAudio }`
