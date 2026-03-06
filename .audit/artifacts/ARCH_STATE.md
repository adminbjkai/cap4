# Cap3 Architecture State Analysis

**Generated:** 2026-03-06T07:53:13Z  
**Phase:** 2 - Architecture Analysis  
**Auditor:** Audit Orchestrator

---

## 1. Service Boundaries

### 1.1 web-api (Port 3000)
**Role:** HTTP API Gateway & Business Logic Coordinator  
**Entry Point:** `apps/web-api/src/index.ts` (1989 lines)

**Responsibilities:**
- Public REST API endpoints for video lifecycle management
- Idempotency key enforcement for mutating operations
- Database transaction coordination via `@cap/db`
- S3 presigned URL generation for direct client uploads
- Webhook intake from media-server with HMAC verification
- Provider health status aggregation

**Key API Endpoints:**
| Endpoint | Method | Idempotency | Purpose |
|----------|--------|-------------|---------|
| `/api/videos` | POST | Required | Create video record |
| `/api/uploads/signed` | POST | Required | Get presigned PUT URL |
| `/api/uploads/complete` | POST | Required | Mark upload complete, enqueue job |
| `/api/uploads/multipart/*` | POST | Required | Multipart upload flow |
| `/api/videos/:id/status` | GET | N/A | Poll processing status |
| `/api/videos/:id/watch-edits` | PATCH | Required | Update title/transcript |
| `/api/videos/:id/delete` | POST | Required | Soft delete video |
| `/api/videos/:id/retry` | POST | Required | Retry failed jobs |
| `/api/library/videos` | GET | N/A | Paginated video list |
| `/api/jobs/:id` | GET | N/A | Job status lookup |
| `/api/system/provider-status` | GET | N/A | Deepgram/Groq health |
| `/api/webhooks/media-server/progress` | POST | N/A | Media server webhooks |
| `/health`, `/ready` | GET | N/A | Kubernetes probes |

**Debug Endpoints (non-production only):**
- `POST /debug/enqueue` - Create test job
- `GET /debug/job/:id` - Job inspection
- `POST /debug/videos` - Create test video
- `POST /debug/jobs/enqueue` - Manual job injection
- `POST /debug/smoke` - End-to-end smoke test

---

### 1.2 worker (Background Job Processor)
**Role:** Queue Consumer & Workflow Executor  
**Entry Point:** `apps/worker/src/index.ts` (1213 lines)

**Responsibilities:**
- PostgreSQL-based job queue claim/execute/ack pattern
- SQL leasing with `FOR UPDATE SKIP LOCKED`
- Heartbeat-based lease renewal during job execution
- Exponential backoff retry with dead-letter handling
- Workflow orchestration across processing phases

**Job Types:**
| Job Type | Priority | Handler | Description |
|----------|----------|---------|-------------|
| `process_video` | 100 | `handleProcessVideo()` | Video transcoding via media-server |
| `transcribe_video` | 95 | `handleTranscribeVideo()` | Audio extraction + Deepgram STT |
| `generate_ai` | 90 | `handleGenerateAi()` | Groq LLM summarization |
| `cleanup_artifacts` | - | `handleCleanupArtifacts()` | S3 cleanup on soft delete |
| `deliver_webhook` | 10 | `handleDeliverWebhook()` | External webhook delivery |

**Key SQL Operations:**
- **CLAIM_SQL:** Claims jobs with lease token generation
- **HEARTBEAT_SQL:** Renews lease while job active
- **ACK_SQL:** Marks job succeeded
- **FAIL_SQL:** Retries with backoff or moves to dead
- **RECLAIM_SQL:** Recovers expired leases

---

### 1.3 media-server (Port 3001)
**Role:** Video Processing Engine  
**Entry Point:** `apps/media-server/src/index.ts` (246 lines)

**Responsibilities:**
- FFmpeg-based video transcoding (H.264/AAC)
- Thumbnail generation
- Video probing (duration, dimensions, FPS, audio detection)
- S3 download/upload for media files
- Stateless processing - no database access

**API Contract:**
```typescript
// POST /process
interface ProcessRequest {
  videoId: string;
  rawKey: string;  // S3 key for source video
}

interface ProcessResponse {
  resultKey: string;       // S3 key for processed video
  thumbnailKey: string;    // S3 key for thumbnail
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number | null;
  hasAudio?: boolean;
}
```

**FFmpeg Pipeline:**
1. Download from S3 to `/tmp/cap3-media/{videoId}/`
2. Transcode: `libx264` + `yuv420p` + `faststart`
3. Audio: `aac` @ 128k (if present)
4. Thumbnail: `thumbnail` filter, frame 1
5. Probe with `ffprobe -print_format json`
6. Upload results to S3
7. Cleanup temp directory

---

### 1.4 web (Port 8022 - nginx)
**Role:** React SPA Frontend  
**Entry Point:** `apps/web/src/main.tsx`

**Responsibilities:**
- Video upload UI (single-part and multipart)
- Recording interface (`/record`)
- Video player with transcript display (`/video/:id`)
- Library browsing with pagination
- Provider status dashboard

**Key Components:**
- `AppShell.tsx` - Layout wrapper
- `HomePage.tsx` - Video library
- `RecordPage.tsx` - Screen recording
- `VideoPage.tsx` - Player + transcript + AI summary
- `ProviderStatusPanel.tsx` - Deepgram/Groq health

**API Client:** `apps/web/src/lib/api.ts` (407 lines)
- TypeScript interfaces for all API responses
- XMLHttpRequest for upload progress tracking
- Multipart upload with 10MB chunk size

---

## 2. Data Flows

### 2.1 Video Upload Flow
```
┌─────────┐     POST /api/videos      ┌──────────┐     INSERT videos, uploads
│  Client │ ─────────────────────────> │ web-api  │ ───────────────────────────>
│   (web) │ <───────────────────────── │          │ <───────────────────────────
└─────────┘   {videoId, rawKey}        └──────────┘
     │
     │ POST /api/uploads/signed
     ▼
┌──────────┐     Presigned PUT URL     ┌─────────┐
│ web-api  │ ─────────────────────────>│  Client │
│          │ <─────────────────────────│         │
└──────────┘                          └─────────┘
     │                                        │
     │                                        │ PUT {video} to S3
     │                                        ▼
     │                                   ┌─────────┐
     │                                   │   S3    │
     │                                   └─────────┘
     │
     │ POST /api/uploads/complete
     ▼
┌──────────┐     INSERT job_queue      ┌──────────┐
│ web-api  │ ─────────────────────────>│  worker  │
│          │     (process_video)       │  (poll)  │
└──────────┘                          └──────────┘
```

### 2.2 Video Processing Flow
```
┌────────┐     Claim job (SQL leasing)    ┌──────────┐
│ worker │ ─────────────────────────────> │   Postgres  │
│        │ <───────────────────────────── │  job_queue  │
└────────┘                                └──────────┘
     │
     │ POST /process {videoId, rawKey}
     ▼
┌─────────────┐    Download/Process/Upload   ┌─────────┐
│ media-server│ ───────────────────────────> │   S3    │
│             │ <─────────────────────────── │         │
└─────────────┘                              └─────────┘
     │
     │ {resultKey, thumbnailKey, metadata}
     ▼
┌────────┐     Update videos table         ┌──────────┐
│ worker │ ─────────────────────────────>  │  Postgres  │
│        │     (processing_phase=complete) │   videos   │
└────────┘                                 └──────────┘
     │
     │ Enqueue transcribe_video (if hasAudio)
     ▼
┌──────────┐
│ job_queue│
└──────────┘
```

### 2.3 Transcription Flow
```
┌────────┐     Claim transcribe_video      ┌──────────┐
│ worker │ ─────────────────────────────>  │   S3     │
│        │     Get processed video         │          │
└────────┘                                 └──────────┘
     │
     │ Extract audio (ffmpeg)
     ▼
┌──────────┐     POST /v1/listen           ┌──────────┐
│ Deepgram │ <──────────────────────────── │  worker  │
│   API    │ ──────────────────────────>   │          │
└──────────┘     {transcript, segments}    └──────────┘
     │
     │ Upload VTT to S3
     ▼
┌──────────┐     INSERT transcripts        ┌──────────┐
│  worker  │ ───────────────────────────>  │  Postgres  │
│          │     Update videos.transcription_status  │
└──────────┘                                 └──────────┘
     │
     │ Enqueue generate_ai
     ▼
```

### 2.4 AI Summary Flow
```
┌────────┐     Claim generate_ai           ┌──────────┐
│ worker │ ─────────────────────────────>  │  Postgres  │
│        │     Get transcript segments     │ transcripts│
└────────┘                                 └──────────┘
     │
     │ POST /chat/completions
     ▼
┌──────────┐     {title, summary, key_points}  ┌──────────┐
│ Groq API │ <──────────────────────────────── │  worker  │
│          │ ────────────────────────────────> │          │
└──────────┘                                   └──────────┘
     │
     ▼
┌──────────┐     INSERT ai_outputs          ┌──────────┐
│  worker  │ ────────────────────────────>  │  Postgres  │
│          │     Update videos.ai_status    │   videos   │
└──────────┘                                └──────────┘
```

### 2.5 Webhook Flow (media-server → web-api)
```
┌─────────────┐     POST /api/webhooks/     ┌──────────┐
│media-server │ ─────────────────────────>  │ web-api  │
│  (future)   │  X-Cap-Signature (HMAC)     │          │
└─────────────┘                             └──────────┘
                                                  │
                                                  │ Verify signature
                                                  │ Check timestamp skew
                                                  ▼
                                            ┌──────────┐
                                            │webhook_  │
                                            │events    │
                                            │(dedupe)  │
                                            └──────────┘
                                                  │
                                                  │ Monotonic phase update
                                                  ▼
                                            ┌──────────┐
                                            │  videos  │
                                            │  table   │
                                            └──────────┘
```

---

## 3. API Contracts

### 3.1 REST API (web-api)

**Idempotency Contract:**
- Header: `Idempotency-Key` (UUID format required)
- TTL: 15 min (uploads) / 24 hours (mutations)
- Conflict: 409 if key reused with different payload
- Collision: 409 if key in progress

**Error Response Format:**
```json
{
  "ok": false,
  "error": "Human-readable message"
}
```

**Pagination (Library):**
- Cursor-based using `created_at|id` composite
- Base64url encoded cursor
- Default limit: 24, max: 50
- Sort: `created_desc` (default) or `created_asc`

### 3.2 Internal API (media-server)

**Health Check:**
```
GET /health → { "ok": true }
```

**Process Endpoint:**
```
POST /process
Content-Type: application/json

{
  "videoId": "uuid",
  "rawKey": "videos/{uuid}/raw/source.mp4"
}

Response:
{
  "resultKey": "videos/{uuid}/result/result.mp4",
  "thumbnailKey": "videos/{uuid}/thumb/screen-capture.jpg",
  "durationSeconds": 123.456,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "hasAudio": true
}
```

### 3.3 External Provider APIs

**Deepgram (/v1/listen):**
- Query params: `model`, `smart_format=true`, `punctuate=true`, `utterances=true`, `detect_language=true`
- Auth: `Authorization: Token {apiKey}`
- Timeout: 45s (configurable)
- Fatal errors: 401, 403

**Groq (/chat/completions):**
- Model: `llama-3.3-70b-versatile` (default)
- Response format: `json_object`
- Prompt truncation: 32k chars max
- Timeout: 45s (configurable)
- Fatal errors: 401, 403

---

## 4. Data Stores

### 4.1 PostgreSQL (Authoritative State)

**Core Tables:**
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `videos` | Video metadata & state machine | `processing_phase`, `transcription_status`, `ai_status` |
| `uploads` | Upload session tracking | `phase`, `raw_key`, `multipart_upload_id` |
| `job_queue` | Background job queue | `status`, `locked_by`, `lease_token`, `attempts` |
| `transcripts` | STT output | `vtt_key`, `segments_json` |
| `ai_outputs` | LLM output | `title`, `summary`, `chapters_json` |
| `idempotency_keys` | Request deduplication | `endpoint`, `idempotency_key`, `request_hash` |
| `webhook_events` | Webhook audit log | `delivery_id`, `signature`, `accepted` |

**State Machines:**

Processing Phase:
```
not_required(0) → queued(10) → downloading(20) → probing(30) 
  → processing(40) → uploading(50) → generating_thumbnail(60) 
  → complete(70) | failed(80) | cancelled(90)
```

Transcription Status:
```
not_started → queued → processing → complete
  ↓                          ↓
skipped                   failed
  ↑
no_audio (when no audio track)
```

AI Status:
```
not_started → queued → processing → complete
  ↓              ↓
skipped       failed
```

Job Status:
```
queued → leased → running → succeeded
  ↓         ↓
dead    (reclaimed)
```

### 4.2 S3/MinIO (Object Storage)

**Key Structure:**
```
videos/{videoId}/
  raw/
    source.mp4              # Original upload
  result/
    result.mp4              # Processed video
  thumb/
    screen-capture.jpg      # Thumbnail
  transcript/
    transcript.vtt          # WebVTT captions
```

**Access Pattern:**
- Client → Presigned PUT → Direct S3 upload
- media-server → Internal S3 client → Download/Upload
- worker → Internal S3 client → Download/Upload
- Client → Public S3 endpoint → Direct download

---

## 5. Cross-Cutting Concerns

### 5.1 Logging (`@cap/logger`)

**Implementation:** `packages/logger/src/index.ts` (194 lines)

**Features:**
- Pino-based structured logging
- Sensitive field redaction (password, secret, token, apiKey, DATABASE_URL, etc.)
- Request context propagation via AsyncLocalStorage
- Request ID generation and header propagation (`x-request-id`)
- Pretty printing in development (`LOG_PRETTY=true`)

**Log Levels:** trace, debug, info, warn, error

**Service Integration:**
```typescript
// Fastify plugin decorates instance with serviceLogger
app.register(loggingPlugin, { serviceName: 'web-api', version: '0.1.0' });

// Each request gets child logger with context
request.serviceLog.info('Request completed', { method, path, statusCode });
```

**Worker Logging:**
```typescript
function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "worker", event, ...fields }));
}
```

### 5.2 Configuration (`@cap/config`)

**Implementation:** `packages/config/src/index.ts` (32 lines)

**Zod Schema Validation:**
| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | - | PostgreSQL connection |
| `MEDIA_SERVER_WEBHOOK_SECRET` | - | HMAC verification |
| `WEBHOOK_MAX_SKEW_SECONDS` | 300 | Timestamp tolerance |
| `DEEPGRAM_API_KEY` | - | STT provider auth |
| `GROQ_API_KEY` | - | LLM provider auth |
| `DEEPGRAM_MODEL` | nova-2 | STT model |
| `GROQ_MODEL` | llama-3.3-70b-versatile | LLM model |
| `PROVIDER_TIMEOUT_MS` | 45000 | External API timeout |
| `WEB_API_PORT` | 3000 | API server port |
| `MEDIA_SERVER_PORT` | 3100 | Media server port |
| `WORKER_ID` | worker-1 | Worker identity |
| `WORKER_LEASE_SECONDS` | 60 | Job lease duration |
| `WORKER_MAX_ATTEMPTS` | 6 | Max retry attempts |
| `WORKER_POLL_MS` | 2000 | Queue poll interval |
| `WORKER_HEARTBEAT_MS` | 15000 | Lease renewal interval |

### 5.3 Error Handling

**web-api Patterns:**
- `badRequest(message)` - 400 responses
- Transaction rollback on error
- Idempotency cleanup on failure
- Structured error logging with request context

**worker Patterns:**
- `DeletedVideoSkipError` - Skip processing for soft-deleted videos
- Fatal error detection (401/403 from providers)
- Exponential backoff: `min(7200, 30 * 2^(attempts-1))` seconds
- Dead-letter queue (status='dead') after max attempts

**media-server Patterns:**
- Try/catch around FFmpeg operations
- Temp directory cleanup in finally block
- 500 response with error message on failure

### 5.4 Health Checks

**web-api:**
- `GET /health` - Liveness probe (DB connectivity)
- `GET /ready` - Readiness probe (DB latency < 500ms)

**media-server:**
- `GET /health` - Simple { ok: true }

**worker:**
- Database connectivity check on startup
- Health-based job filtering (skips `process_video` if media-server unhealthy)

### 5.5 Security

**Webhook Verification:**
```typescript
function verifyWebhookSignature(raw: string, timestamp: string, signatureHeader: string): boolean {
  const digest = crypto
    .createHmac("sha256", env.MEDIA_SERVER_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return timingSafeEqual(`v1=${digest}`, signatureHeader);
}
```

**Idempotency:**
- SHA256 hash of request body
- Endpoint-scoped key uniqueness
- Request hash mismatch detection

**Database:**
- Parameterized queries throughout
- Transaction boundaries for multi-table operations
- Row-level locking (`FOR UPDATE`) for state transitions

---

## 6. Evidence References

### Service Boundaries
- web-api: `apps/web-api/src/index.ts` (lines 1-1990)
- worker: `apps/worker/src/index.ts` (lines 1-1213)
- media-server: `apps/media-server/src/index.ts` (lines 1-246)
- web: `apps/web/src/App.tsx` (lines 1-18)

### Data Flows
- Upload flow: `apps/web-api/src/index.ts` lines 958-1155
- Job claiming: `apps/worker/src/index.ts` lines 102-126
- Media processing: `apps/media-server/src/index.ts` lines 171-243

### API Contracts
- Idempotency: `apps/web-api/src/index.ts` lines 305-380
- Webhook handler: `apps/web-api/src/index.ts` lines 1851-1987
- Deepgram client: `apps/worker/src/providers/deepgram.ts`
- Groq client: `apps/worker/src/providers/groq.ts`

### Cross-Cutting
- Logger: `packages/logger/src/index.ts`
- Config: `packages/config/src/index.ts`
- Database: `packages/db/src/index.ts`
- Health plugin: `apps/web-api/src/plugins/health.ts`
- Logging plugin: `apps/web-api/src/plugins/logging.ts`

### Schema
- Migrations: `db/migrations/0001_init.sql`, `0002_video_soft_delete.sql`, `0003_add_webhook_reporting.sql`

---

## 7. Architectural Findings

### 7.1 Strengths
1. **Clear service boundaries** - Each service has a single, well-defined responsibility
2. **State machine enforcement** - Database constraints ensure valid phase transitions
3. **Idempotency throughout** - All mutating endpoints enforce idempotency keys
4. **Lease-based job processing** - Prevents duplicate processing without external queue
5. **Webhook audit trail** - All webhook deliveries logged with signatures
6. **Structured logging** - Consistent JSON logging with context propagation

### 7.2 Potential Concerns
1. **No authentication/authorization** - Per AGENTS.md non-goals, but worth noting
2. **Worker is singleton** - No horizontal scaling mechanism documented
3. **No circuit breaker** - Provider failures retry with backoff but no circuit breaker
4. **S3 cleanup on failure** - No explicit cleanup of partial uploads
5. **No rate limiting** - API endpoints have no rate limiting

### 7.3 Evidence Gaps
1. No OpenAPI/Swagger specification found
2. No architecture decision records (ADRs)
3. No runbook documentation for operational procedures

---

*End of Architecture State Analysis*
