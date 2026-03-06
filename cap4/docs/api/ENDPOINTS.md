# API Endpoints

Complete reference for cap4's HTTP API.

**Base URL:** `http://localhost:3000/api` (development)

**Authentication:** None (single-tenant application)

**Content-Type:** `application/json` unless otherwise specified

---

## Common Headers

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Idempotency-Key` | ✓ Yes | UUID v4 for deduplication. Must be unique per request. |
| `Content-Type` | Conditional | `application/json` (most endpoints) or `multipart/form-data` (uploads) |

### Response Headers

| Header | Description |
|--------|-------------|
| `X-Request-ID` | Unique ID for tracking |
| `X-RateLimit-Remaining` | Requests remaining in current window |

---

## Response Formats

### Success Response (2xx)

```json
{
  "success": true,
  "data": {
    // response payload
  }
}
```

### Error Response (4xx, 5xx)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      {
        "field": "videoId",
        "message": "Must be a valid UUID"
      }
    ]
  }
}
```

---

## Video Endpoints

### POST /api/videos — Upload Video

Upload a video file for processing.

**Method:** `POST`

**Content-Type:** `multipart/form-data`

**Request:**
```bash
curl -X POST http://localhost:3000/api/videos \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -F "video=@video.mp4"
```

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `video` | File | ✓ Yes | Video file (MP4 recommended, max 2GB) |

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "processingPhase": "uploading",
    "rank": 5,
    "uploadedAt": "2026-03-06T14:30:00Z",
    "status": "File received, queued for processing"
  }
}
```

**Status Codes:**
- `201` — Video uploaded successfully
- `400` — Invalid file or missing Idempotency-Key
- `413` — File too large (>2GB)
- `429` — Rate limited
- `500` — Server error

**Error Examples:**

```json
// Missing Idempotency-Key
{
  "error": {
    "code": "MISSING_HEADER",
    "message": "Idempotency-Key header is required"
  }
}

// Duplicate request (same Idempotency-Key)
{
  "error": {
    "code": "DUPLICATE_REQUEST",
    "message": "This request has already been processed",
    "data": {
      "id": "550e8400-e29b-41d4-a716-446655440000"
    }
  }
}
```

---

### GET /api/videos/:id — Get Video Status

Retrieve video status and metadata.

**Method:** `GET`

**Request:**
```bash
curl http://localhost:3000/api/videos/550e8400-e29b-41d4-a716-446655440000
```

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | Video ID (from upload response) |

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "processingPhase": "complete",
    "rank": 50,
    "uploadedAt": "2026-03-06T14:30:00Z",
    "completedAt": "2026-03-06T14:45:00Z",
    "title": "How to Use cap4 for Video Processing",
    "summary": "This video explains...",
    "chapters": [
      {
        "timestamp": "00:00:00",
        "title": "Introduction",
        "startMs": 0
      },
      {
        "timestamp": "00:02:15",
        "title": "Setup",
        "startMs": 135000
      }
    ],
    "transcript": "Hello everyone, welcome to cap4...",
    "metadata": {
      "duration": "00:15:30",
      "durationMs": 930000,
      "videoUrl": "https://s3.example.com/cap4-550e8400/result.mp4",
      "thumbnailUrl": "https://s3.example.com/cap4-550e8400/thumbnail.jpg"
    }
  }
}
```

**Processing Phases:**
- `not_required` — Initial state
- `uploading` — File being uploaded
- `queued` — Waiting for processing to start
- `processing` — FFmpeg encoding in progress
- `processed` — Video encoding complete
- `transcribing` — Speech-to-text in progress
- `transcribed` — Transcript complete
- `generating_ai` — AI generating metadata
- `generated_ai` — AI generation complete
- `complete` — All processing finished ✓
- `failed_processing` — Video encoding failed (can retry)
- `failed_transcription` — Transcript generation failed (can retry)
- `failed_ai_gen` — AI metadata generation failed (can retry)
- `cancelled` — User cancelled

**Status Codes:**
- `200` — Video found and returned
- `404` — Video not found
- `500` — Server error

---

### POST /api/videos/:id/retry — Retry Failed Processing

Retry transcription or AI generation if they failed.

**Method:** `POST`

**Request:**
```bash
curl -X POST http://localhost:3000/api/videos/550e8400-e29b-41d4-a716-446655440000/retry \
  -H "Idempotency-Key: new-uuid-here" \
  -H "Content-Type: application/json"
```

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | Video ID |

**Request Body:**
```json
{
  "jobType": "transcription"  // or "ai_generation"
}
```

**Response (202 Accepted):**

```json
{
  "success": true,
  "data": {
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "jobType": "transcription",
    "status": "Queued for retry",
    "retryCount": 1,
    "maxRetries": 5
  }
}
```

**Notes:**
- Only works for failed transcription or AI generation
- Video processing failures (video encoding) cannot be retried with current architecture
- Maximum 5 retries per job
- Each retry uses exponential backoff

**Status Codes:**
- `202` — Retry queued successfully
- `400` — Invalid job type or video not in failed state
- `404` — Video not found
- `409` — Video not in a retryable state
- `500` — Server error

---

### POST /api/videos/:id/delete — Delete Video

Permanently delete a video and all associated data.

**Method:** `POST`

**Request:**
```bash
curl -X POST http://localhost:3000/api/videos/550e8400-e29b-41d4-a716-446655440000/delete \
  -H "Idempotency-Key: delete-uuid-here" \
  -H "Content-Type: application/json"
```

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | Video ID |

**Request Body:** (empty)

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "Deleted",
    "deletedAt": "2026-03-06T14:50:00Z"
  }
}
```

**What Gets Deleted:**
- Video record from database
- S3 objects (source, processed, thumbnail)
- Transcript data
- AI metadata
- Job queue entries
- Webhook logs

**Status Codes:**
- `200` — Video deleted successfully
- `404` — Video not found
- `500` — Server error

---

## Multipart Upload Endpoints (IMPLEMENTED ✓)

### POST /api/videos/upload/init — Initialize Multipart Upload

Start a multipart upload (for large files).

**Method:** `POST`

**Request:**
```bash
curl -X POST http://localhost:3000/api/videos/upload/init \
  -H "Idempotency-Key: init-uuid" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "large_video.mp4",
    "size": 1073741824,
    "contentType": "video/mp4"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filename` | string | ✓ Yes | Original filename |
| `size` | number | ✓ Yes | Total file size in bytes |
| `contentType` | string | ✓ Yes | MIME type (e.g., `video/mp4`) |

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "uploadId": "550e8400-e29b-41d4-a716-446655440000",
    "multipartUploadId": "minio-upload-id-abc123",
    "parts": []
  }
}
```

---

### POST /api/videos/upload/:uploadId/part — Upload Part

Upload one part of a multipart upload.

**Method:** `POST`

**Request:**
```bash
curl -X POST http://localhost:3000/api/videos/upload/550e8400-e29b-41d4-a716-446655440000/part \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@part1.bin" \
  -G --data-urlencode "partNumber=1"
```

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `uploadId` | UUID | From init response |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `partNumber` | number | ✓ Yes | Part number (1-indexed) |

**Request Body:** Binary file chunk

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "partNumber": 1,
    "etag": "abc123def456",
    "size": 5242880
  }
}
```

---

### POST /api/videos/upload/:uploadId/complete — Complete Multipart Upload

Finalize the upload after all parts are sent.

**Method:** `POST`

**Request:**
```bash
curl -X POST http://localhost:3000/api/videos/upload/550e8400-e29b-41d4-a716-446655440000/complete \
  -H "Idempotency-Key: complete-uuid" \
  -H "Content-Type: application/json" \
  -d '{
    "parts": [
      { "partNumber": 1, "etag": "abc123" },
      { "partNumber": 2, "etag": "def456" }
    ]
  }'
```

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `uploadId` | UUID | From init response |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `parts` | array | List of uploaded parts with etags |

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "Uploaded successfully",
    "processingPhase": "queued"
  }
}
```

---

## Internal Webhooks

### POST /api/internal/webhooks/media-server

Receives status updates from FFmpeg processing.

**Called by:** media-server (internal)

**Payload:**
```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "complete",
  "progress": 100,
  "duration": "00:15:30",
  "error": null
}
```

**Response:** `200 OK`

---

## Error Codes Reference

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `MISSING_HEADER` | 400 | Required header missing (Idempotency-Key) |
| `DUPLICATE_REQUEST` | 409 | Same Idempotency-Key already processed |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Request conflicts with current state |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Idempotency

All POST endpoints require an `Idempotency-Key` header. If the same key is sent twice, the same response is returned (no duplicate processing).

```bash
# First request
curl -X POST /api/videos \
  -H "Idempotency-Key: abc-123-def"

# Same request with same key = same response (not reprocessed)
curl -X POST /api/videos \
  -H "Idempotency-Key: abc-123-def"
```

---

## Rate Limiting

Currently: No rate limiting (single-tenant).

Future: Will add rate limiting per IP/API key.

---

## Changelog

### v1.0.0 (Current)
- ✓ Single video upload
- ✓ Multipart upload for large files
- ✓ Status polling
- ✓ Retry failed processing
- ✓ Delete videos
- ✓ Webhook notifications

### Deprecated
None yet.

### Roadmap
- [ ] Batch operations
- [ ] Advanced filtering
- [ ] Scheduled processing
- [ ] Storage quotas

---

**Need help?** See [../ops/TROUBLESHOOTING.md](../ops/TROUBLESHOOTING.md) or [../../README.md](../../README.md)
