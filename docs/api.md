---
title: "API Reference"
description: "HTTP endpoints and webhook contract"
---

# API Reference

Current HTTP contract for the Fastify API in `apps/web-api`.

- Base URL: `http://localhost:3000`
- Auth: none
- Global rate limit: `100 requests / minute / IP`
- Webhook route is excluded from the global rate limiter
- Most validation errors return `{"ok": false, "error": "..." }`
- Responses are route-specific JSON objects; there is no global `{ success, data }` envelope

## Upload Lifecycle

The upload flow is:

1. `POST /api/videos`
2. `POST /api/uploads/signed` or multipart endpoints
3. Upload file bytes to S3/MinIO
4. `POST /api/uploads/complete` or `POST /api/uploads/multipart/complete`
5. Poll `GET /api/videos/:id/status`

## Video Routes

### `POST /api/videos`

Create a video row plus an upload record.

Request:

```bash
curl -X POST http://localhost:3000/api/videos \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-video-1" \
  -d '{"name":"Demo upload","webhookUrl":"https://example.com/hook","originalFileCreatedAt":"2024-01-15T10:30:00.000Z"}'
```

Response:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "rawKey": "videos/550e8400-e29b-41d4-a716-446655440000/raw/source.mp4",
  "webhookUrl": "https://example.com/hook"
}
```

Notes:

- `Idempotency-Key` is required.
- `name` is optional; default is `"Untitled Video"`.
- `webhookUrl` is optional and stored on `videos.webhook_url`.
- `originalFileCreatedAt` is optional (ISO 8601). For file uploads the web client
  sends the source file's `File.lastModified`; it is stored on
  `videos.original_file_created_at` and distinguishes the file's own creation time
  from when it was uploaded into cap4 (`videos.created_at`). Values that are
  unparseable, before 1990, or more than ~1 day in the future are ignored
  (stored as `NULL`). Screen recordings omit it.

### `GET /api/videos/:id/status`

Canonical watch-page payload.

```bash
curl http://localhost:3000/api/videos/550e8400-e29b-41d4-a716-446655440000/status
```

Response shape:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Demo upload",
  "processingPhase": "complete",
  "processingProgress": 100,
  "resultKey": "videos/.../result.mp4",
  "thumbnailKey": "videos/.../thumbnail.jpg",
  "errorMessage": null,
  "transcriptionStatus": "complete",
  "aiStatus": "complete",
  "transcriptErrorMessage": null,
  "aiErrorMessage": null,
  "transcript": {
    "provider": "deepgram",
    "language": "en",
    "vttKey": "videos/.../transcript.vtt",
    "text": "Joined transcript text",
    "speakerLabels": {
      "0": "Host",
      "1": "Guest"
    },
    "segments": []
  },
  "aiOutput": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "title": "Weekly review",
    "summary": "Summary text",
    "keyPoints": ["Point 1", "Point 2"]
  }
}
```

Processing phases:

- `not_required`
- `queued`
- `downloading`
- `probing`
- `processing`
- `uploading`
- `generating_thumbnail`
- `complete`
- `failed`
- `cancelled`

Transcript statuses:

- `not_started`
- `queued`
- `processing`
- `complete`
- `no_audio`
- `skipped`
- `failed`

AI statuses:

- `not_started`
- `queued`
- `processing`
- `complete`
- `skipped`
- `failed`

Important:

- The database stores enrichment fields such as `entities_json`, `action_items_json`, and `quotes_json`, but `GET /api/videos/:id/status` does not currently expose them.

### `PATCH /api/videos/:id/watch-edits`

Update editable watch-page metadata.

```bash
curl -X PATCH http://localhost:3000/api/videos/550e8400-e29b-41d4-a716-446655440000/watch-edits \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: watch-edits-1" \
  -d '{
    "title": "Updated title",
    "transcriptText": "Edited transcript text",
    "speakerLabels": { "0": "Host", "1": "Guest" }
  }'
```

Response:

```json
{
  "ok": true,
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "updated": {
    "title": true,
    "transcript": true,
    "speakerLabels": true
  }
}
```

Notes:

- `Idempotency-Key` is required.
- At least one of `title`, `transcriptText`, or `speakerLabels` must be present.
- `title` updates `ai_outputs.title` if an AI row exists; otherwise falls back to updating `videos.name`.
- `transcriptText` rewrites `transcripts.segments_json` while preserving timing metadata shape.

### `POST /api/videos/:id/retry`

Requeue failed/stuck jobs. Depending on state this can reset the `process_video`,
`transcribe_video`, and/or `generate_ai` jobs; `jobsReset` lists what was re-queued.

```bash
curl -X POST http://localhost:3000/api/videos/550e8400-e29b-41d4-a716-446655440000/retry \
  -H "Idempotency-Key: retry-video-1"
```

Response:

```json
{
  "ok": true,
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "jobsReset": ["process_video", "transcribe_video", "generate_ai"]
}
```

### `POST /api/videos/:id/delete`

Soft-delete a video and enqueue cleanup.

```bash
curl -X POST http://localhost:3000/api/videos/550e8400-e29b-41d4-a716-446655440000/delete \
  -H "Idempotency-Key: delete-video-1"
```

Response:

```json
{
  "ok": true,
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "deletedAt": "2026-03-09T20:10:00.000Z"
}
```

## Upload Routes

### `POST /api/uploads/signed`

Request a signed singlepart PUT URL.

```bash
curl -X POST http://localhost:3000/api/uploads/signed \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: signed-upload-1" \
  -d '{"videoId":"550e8400-e29b-41d4-a716-446655440000","contentType":"video/mp4"}'
```

Response:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "rawKey": "videos/.../raw/source.mp4",
  "method": "PUT",
  "putUrl": "https://...",
  "headers": {
    "Content-Type": "video/mp4"
  }
}
```

### `POST /api/uploads/complete`

Mark singlepart upload complete and enqueue `process_video`.

```bash
curl -X POST http://localhost:3000/api/uploads/complete \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: upload-complete-1" \
  -d '{"videoId":"550e8400-e29b-41d4-a716-446655440000"}'
```

Response:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "rawKey": "videos/.../raw/source.mp4",
  "jobId": 101,
  "status": "uploaded"
}
```

### `POST /api/uploads/multipart/initiate`

Start multipart upload state.

Request body:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "contentType": "video/mp4"
}
```

Response:

```json
{
  "ok": true,
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadId": "s3-upload-id",
  "rawKey": "videos/.../raw/source.mp4"
}
```

### `POST /api/uploads/multipart/presign-part`

Request a presigned URL for a part upload.

Request body:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "partNumber": 1
}
```

Response:

```json
{
  "ok": true,
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "partNumber": 1,
  "putUrl": "https://..."
}
```

### `POST /api/uploads/multipart/complete`

Complete multipart upload and enqueue `process_video`.

Request body:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "parts": [
    { "ETag": "\"etag-1\"", "PartNumber": 1 },
    { "ETag": "\"etag-2\"", "PartNumber": 2 }
  ]
}
```

Response:

```json
{
  "ok": true,
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "jobId": 101,
  "status": "uploaded"
}
```

### `POST /api/uploads/multipart/abort`

Abort multipart upload state.

Request body:

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Response:

```json
{
  "ok": true,
  "videoId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Library, Jobs, and System Routes

### `GET /api/library/videos`

Cursor-based library list.

Query params:

- `cursor`
- `limit` (`1..50`, default `24`)
- `sort` (`created_desc` or `created_asc`)

Response:

```json
{
  "items": [
    {
      "videoId": "550e8400-e29b-41d4-a716-446655440000",
      "displayTitle": "Demo upload",
      "hasThumbnail": true,
      "hasResult": true,
      "thumbnailKey": "videos/.../thumbnail.jpg",
      "processingPhase": "complete",
      "transcriptionStatus": "complete",
      "aiStatus": "complete",
      "createdAt": "2026-03-09T20:10:00.000Z",
      "originalFileCreatedAt": "2024-01-15T10:30:00.000Z",
      "durationSeconds": 123.456
    }
  ],
  "sort": "created_desc",
  "limit": 24,
  "nextCursor": null
}
```

Notes:

- `createdAt` is when the video was uploaded into cap4. `originalFileCreatedAt`
  is the source file's own timestamp (`File.lastModified`) and is `null` for
  screen recordings and for videos uploaded before migration `0007`.
- The web client renders this list as either a card **grid** (default) or a
  **list/table** view (toggle persisted in `localStorage` under `cap4:libraryView`).
  The table adds show/hide + drag-reorder columns (persisted under
  `cap4:libraryColumns`), per-column + global filtering with clear-all, click-to-sort
  headers, EST date/time rendering of `createdAt` and `originalFileCreatedAt`, and an
  inline per-row note stored client-side under `cap4:notes:<videoId>`. Sorting and
  filtering are applied **client-side over the loaded page(s)** (the server only sorts
  by `created_asc`/`created_desc`), so with pagination they reorder loaded rows only.

### `GET /api/jobs/:id`

Return one `job_queue` row.

```json
{
  "id": 101,
  "video_id": "550e8400-e29b-41d4-a716-446655440000",
  "job_type": "process_video",
  "status": "queued",
  "attempts": 0,
  "locked_by": null,
  "locked_until": null,
  "lease_token": null,
  "run_after": "2026-03-09T20:10:00.000Z",
  "last_error": null,
  "updated_at": "2026-03-09T20:10:00.000Z"
}
```

### `GET /api/system/provider-status`

Provider health summary consumed by the home page.

```json
{
  "checkedAt": "2026-03-09T20:10:00.000Z",
  "providers": [
    {
      "key": "deepgram",
      "label": "Deepgram",
      "purpose": "transcription",
      "state": "healthy",
      "configured": true,
      "baseUrl": "https://api.deepgram.com",
      "model": "nova-2",
      "lastSuccessAt": "2026-03-09T20:00:00.000Z",
      "lastJob": null
    }
  ]
}
```

---

## Webhooks

Current webhook contract for media-server progress updates handled by `apps/web-api`.

- Route: `POST /api/webhooks/media-server/progress`
- Purpose: update `videos.processing_phase` and `processing_progress`
- Auth: HMAC verification plus timestamp skew validation
- Rate limit: excluded from the global API limiter
- Content type: `application/cap4-webhook+json`
- Flow note: this route is the mainline completion path. The worker's `POST /process` call returns `202` immediately and the media-server emits these signed callbacks as it works: phase transitions (`probing`, `processing`, `uploading`), then `complete` (carrying `resultKey`, `thumbnailKey`, `hasAudio`, and `metadata`) or `failed` (carrying `error`).

### What This Route Does

When a signed progress update is posted to this route, the API:

1. Verifies required headers.
2. Verifies the HMAC signature against the raw request body.
3. Rejects stale timestamps outside `WEBHOOK_MAX_SKEW_SECONDS`.
4. Deduplicates deliveries by `source + delivery_id`.
5. Applies the update only if it moves the video state forward or increases progress at the same rank. On `complete` it also persists `result_key`/`thumbnail_key`, clears `error_message`, and either queues transcription (when `hasAudio` is not `false`) or marks transcription `no_audio` and AI `skipped`. On `failed` it stores the error message.
6. Optionally enqueues an outbound `deliver_webhook` job when the video has a user-configured `webhook_url`.

### Required Headers

```http
Content-Type: application/cap4-webhook+json
x-cap-timestamp: 1710806400
x-cap-signature: <hex hmac signature>
x-cap-delivery-id: 550e8400-e29b-41d4-a716-446655440000
```

- `x-cap-timestamp`: Unix timestamp in seconds
- `x-cap-signature`: HMAC-SHA256 signature derived from `timestamp + "." + rawBody`
- `x-cap-delivery-id`: unique delivery identifier used for deduplication

### Webhook Request Body

```json
{
  "jobId": "4f857d7f-1187-4ee4-9934-8c3879dfab06",
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "phase": "processing",
  "progress": 75,
  "message": "ffmpeg pass running",
  "metadata": {
    "duration": 930,
    "width": 1920,
    "height": 1080,
    "fps": 30
  }
}
```

Fields:

- `jobId`: media-server job identifier
- `videoId`: target video UUID
- `phase`: processing phase accepted by the API state machine
- `progress`: integer percentage, clamped to `0..100`
- `message`: optional status detail
- `error`: optional error text (persisted to `videos.error_message` on `phase: "failed"`)
- `resultKey`: optional S3 key of the processed result (sent with `phase: "complete"`)
- `thumbnailKey`: optional S3 key of the thumbnail (sent with `phase: "complete"`)
- `hasAudio`: optional boolean; `false` short-circuits transcription/AI to `no_audio`/`skipped`
- `metadata`: optional duration/size/fps values to persist

### Accepted Processing Phases

- `not_required`
- `queued`
- `downloading`
- `probing`
- `processing`
- `uploading`
- `generating_thumbnail`
- `complete`
- `failed`
- `cancelled`

### Example Webhook Request

```bash
curl -X POST http://localhost:3000/api/webhooks/media-server/progress \
  -H "Content-Type: application/cap4-webhook+json" \
  -H "x-cap-timestamp: 1710806400" \
  -H "x-cap-signature: <computed-hmac>" \
  -H "x-cap-delivery-id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jobId": "4f857d7f-1187-4ee4-9934-8c3879dfab06",
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "phase": "processing",
    "progress": 75
  }'
```

### Webhook Success Response

```json
{
  "accepted": true,
  "duplicate": false,
  "applied": true
}
```

- `accepted`: request authenticated and parsed successfully
- `duplicate`: `delivery_id` was already seen
- `applied`: update passed the monotonic/progress guard and changed video state

### Webhook Failure Cases

- `400`: malformed JSON, missing raw body, or invalid phase
- `401`: missing auth headers, invalid timestamp, stale timestamp, or invalid signature
- `500`: webhook processing failed after authentication

Common error shape:

```json
{
  "ok": false,
  "error": "Invalid signature"
}
```

### Signature Verification

The API verifies the signature against the raw request body, not parsed JSON. The current verifier signs:

```text
timestamp + "." + rawBody
```

using `MEDIA_SERVER_WEBHOOK_SECRET` and HMAC-SHA256.

### Webhook Notes

- This document only covers the incoming media-server callback route.
- Outbound user webhooks are separate `deliver_webhook` jobs queued by the API and worker when `videos.webhook_url` is set.
