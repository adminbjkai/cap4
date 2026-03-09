# cap4 Architecture

Deep dive into cap4's system design, guarantees, and implementation details.

---

## Philosophy

cap4 is built on three core principles:

1. **Deterministic** — Given the same input, you always get the same output (bit-perfect)
2. **Observable** — Every action is logged and queryable; state machine transitions are visible
3. **Recoverable** — System can restart and recover from any failure without data loss

These principles are achieved through:
- Monotonic state machine (only forward transitions)
- Explicit job queue (all work is queued, nothing is lost)
- Idempotency keys (duplicate requests are detected and ignored)
- Webhook logging (external service calls are tracked)

---

## System Overview

```
┌────────────────────────────────────────────────────────────┐
│                                                             │
│  [Browser UI]                                              │
│  (React frontend)                                          │
│       │                                                    │
│       ▼                                                    │
│  [web-api] ◄─────────────────────────────────────┐        │
│  (Fastify HTTP)                                 │        │
│  - Upload endpoint                              │        │
│  - Status endpoint                              │        │
│  - Retry endpoint                               │        │
│  - Delete endpoint                              │        │
│       │                                         │        │
│       ▼                                         │        │
│  ┌──────────────────────────────────┐          │        │
│  │     PostgreSQL Database          │          │        │
│  ├──────────────────────────────────┤          │        │
│  │ - videos table (state machine)   │          │        │
│  │ - jobs table (work queue)        │          │        │
│  │ - webhook_requests (audit trail) │          │        │
│  │ - idempotency keys (dedup)       │          │        │
│  └──────────────────────────────────┘          │        │
│       ▲                                        │        │
│       │                                        │        │
│       └────────────────────────────────────────┘        │
│                   Polling: SELECT                        │
│       ───────────────────────────────────────           │
│                   Writes: INSERT/UPDATE                 │
│                                                         │
│       ┌─────────────────────────────┐                  │
│       │                             │                  │
│       ▼                             ▼                  │
│  [Worker]                    [media-server]            │
│  (Node.js bg processor)      (FFmpeg wrapper)          │
│  - Claims jobs               - Encodes video           │
│  - Runs pipeline             - Emits webhooks          │
│  - Updates state             - Generates thumbnail     │
│                                                         │
│       ▼                             ▼                  │
│  [External APIs]             [MinIO S3]               │
│  - Deepgram (speech-to-text) - Output video files    │
│  - Groq (LLM for titles)     - Thumbnails            │
│  - (with retries)            - Input uploads         │
│                                                         │
└────────────────────────────────────────────────────────┘
```

---

## State Machine

Every video has a `processingPhase` that transitions monotonically (only forward).

### Phases (Rank Ordering)

```
Rank 0: not_required
        │
        │ (user initiates upload)
        │
        ▼
Rank 5: uploading
        │
        │ (file uploaded to S3)
        │
        ▼
Rank 10: queued
        │
        ├──▶ Rank 30: transcribing  ──▶ Rank 35: transcribed / failed_transcription
        │
        ├──▶ Rank 40: generating_ai ──▶ Rank 45: generated_ai / failed_ai_gen
        │
        └──▶ Rank 20: processing    ──▶ Rank 25: processed / failed_processing
                │
                └─────────────────────┐
                                      │
                                      ▼
                              Rank 50: complete
                              (terminal state)

Terminal States (no further transitions):
  - complete (successful)
  - failed_processing (video encoding failed)
  - failed_transcription (speech-to-text failed)
  - failed_ai_gen (title/summary/chapters generation failed)
  - cancelled (user cancelled)
```

### Key Guarantees

1. **Monotonic** — Only forward transitions allowed
   ```sql
   -- This is enforced in code:
   -- UPDATE videos SET phase = $1 WHERE id = $2 AND rank <= $3
   -- If $3 <= current_rank, UPDATE fails (conditional update)
   ```

2. **Atomic** — Compare-and-set prevents race conditions
   ```sql
   UPDATE videos
   SET processingPhase = $1, updatedAt = NOW()
   WHERE id = $2 AND processingPhase = $3
   RETURNING *;
   ```

3. **Observable** — Phase history is tracked
   ```sql
   INSERT INTO phase_transitions (videoId, from, to, timestamp)
   VALUES ($1, $2, $3, NOW());
   ```

---

## Job Queue Architecture

Work is explicit, queued, and logged. Nothing happens outside the queue.

### Job Model

```typescript
interface Job {
  id: string;                 // Unique ID
  videoId: string;            // Which video to process
  type: 'process_video' | 'transcribe' | 'generate_ai';  // What to do
  status: 'pending' | 'claimed' | 'completed' | 'failed'; // State
  leaseExpiry?: Date;         // When worker's lease expires
  retryCount: number;         // How many retries
  maxRetries: number;         // Max retries allowed
  error?: string;             // Last error message
  createdAt: Date;            // When job was queued
  claimedAt?: Date;           // When worker claimed it
  completedAt?: Date;         // When job finished
}
```

### Job Lifecycle

```
1. Create (pending)
   - web-api creates job after upload succeeds
   - Job state = 'pending'
   - Status = 'queued'

2. Claim (claimed)
   - Worker polls: SELECT * FROM jobs WHERE status='pending'
   - Worker updates: UPDATE jobs SET status='claimed', leaseExpiry=NOW()+5min
   - Uses FOR UPDATE SKIP LOCKED (prevents thundering herd)

3. Process
   - Worker executes job (video encode, transcribe, etc.)
   - Updates video state: processing → processed
   - On success: DELETE job (or mark completed)
   - On failure: INSERT into job_errors, decrement retries

4. Retry or Dead-Letter
   - If retryCount > 0: Re-insert as pending job
   - If retryCount = 0: Move to dead_letter table (operator reviews)

5. Expire Claim
   - If leaseExpiry < NOW(): Job is eligible for reclaim
   - Another worker can claim it (worker crash recovery)
```

### Leasing Strategy

```sql
-- Worker polls for work (prevents multiple workers claiming same job)
SELECT * FROM jobs
WHERE status = 'pending'
FOR UPDATE SKIP LOCKED
LIMIT 1;

-- FOR UPDATE = lock this row
-- SKIP LOCKED = if row is locked, skip it (don't wait)
-- Result: Only one worker gets a job even with concurrent polling
```

---

## Idempotency & Deduplication

The same request should always produce the same result.

### Idempotency Key

```bash
# Client must provide Idempotency-Key header
curl -X POST /api/videos \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -F "video=@file.mp4"
```

### Deduplication Logic

```typescript
// 1. Check if idempotency key was seen before
const existing = await db.query(
  'SELECT * FROM idempotency_keys WHERE key = $1',
  [idempotencyKey]
);

if (existing) {
  // 2. Same request? Return cached response
  return existing.response;
}

// 3. New request? Process it
const response = await processUpload(file);

// 4. Store for next time
await db.query(
  'INSERT INTO idempotency_keys (key, response, ttl) VALUES ($1, $2, $3)',
  [idempotencyKey, response, '24 hours']
);

return response;
```

### Idempotency Keys Table

```sql
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  videoId TEXT REFERENCES videos(id),
  response JSONB,
  createdAt TIMESTAMP DEFAULT NOW(),
  expiresAt TIMESTAMP  -- Auto-delete after 24h
);
```

---

## Processing Pipeline

### Upload Flow

```
1. User selects video
2. web-api generates signed S3 PUT URL
3. Browser uploads directly to MinIO (S3)
4. web-api receives webhook from MinIO (file uploaded)
5. State: not_required → uploading → queued
6. Jobs created: process_video, transcribe, generate_ai
7. Worker picks up jobs in order
```

### Processing Flow

```
Job 1: process_video
├─ Worker calls media-server HTTP endpoint
├─ media-server spawns FFmpeg
├─ FFmpeg encodes video to standard format
├─ Saves to MinIO with resultKey
├─ Emits webhook: "processing_complete"
├─ Worker marks job done
└─ Video state: queued → processing → processed

Job 2: transcribe (parallel)
├─ Worker calls Deepgram API with audio file
├─ Deepgram returns transcript + timing
├─ Save to videos.transcript column
├─ Video state: processing → transcribing → transcribed
└─ (failures go to failed_transcription, retryable)

Job 3: generate_ai (parallel)
├─ Worker calls Groq API with transcript
├─ Groq returns: title, summary, chapters
├─ Save to videos.{title,summary,chapters}
├─ Video state: transcribing → generating_ai → generated_ai
└─ (failures go to failed_ai_gen, retryable)

All complete:
└─ Final state: complete ✓
```

---

## Webhook Architecture

External services (media-server, MinIO, external webhooks) call back to web-api.

### Webhook Flow

```
1. FFmpeg finishes encoding
   ├─ media-server makes HTTP POST to web-api
   └─ POST /api/internal/webhooks/media-server
      Payload: { videoId, status, error?, duration? }

2. web-api receives webhook
   ├─ Validates HMAC signature (if present)
   ├─ Deduplicates by webhook ID (if idempotent)
   ├─ Updates video state
   ├─ Logs to webhook_requests table
   └─ Returns 200 OK

3. media-server considers delivery successful
   └─ Retry delivery if 5xx status
```

### Webhook Signature Verification

```typescript
// Compute HMAC-SHA256
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(rawBody)
  .digest('hex');

// Compare with header
const headerSig = request.headers['x-webhook-signature'];
if (signature !== headerSig) {
  throw new Error('Invalid webhook signature');
}
```

### Webhook Request Logging

```sql
CREATE TABLE webhook_requests (
  id SERIAL PRIMARY KEY,
  videoId TEXT REFERENCES videos(id),
  source TEXT,  -- 'media-server', 'minio', etc.
  payload JSONB,
  signature TEXT,
  verified BOOLEAN,
  status INTEGER,
  error TEXT,
  receivedAt TIMESTAMP DEFAULT NOW()
);

-- This is the audit trail for debugging
-- Every webhook is logged before processing
```

---

## Failure Recovery

### Worker Crash

```
Scenario: Worker crashes while processing job

1. Worker claimed job (leaseExpiry = NOW() + 5 minutes)
2. Worker crashes before completing
3. Lease expires after 5 minutes
4. Next poll picks up job (leaseExpiry < NOW())
5. Retries job processing
6. Eventually succeeds or reaches maxRetries
```

### Database Corruption

```
Scenario: Database is somehow corrupted

1. All state lives in database (no in-memory state)
2. Can wipe and replay from S3 files
3. Migration: INSERT INTO videos FROM (S3 list)
4. State = 'queued' (processing incomplete)
5. Restart workers
```

### External API Failure

```
Scenario: Deepgram transcription API times out

1. Worker calls Deepgram, timeout
2. Job marked failed
3. Decrements retryCount
4. Re-inserted as pending job
5. Exponential backoff: wait 1s, 2s, 4s, 8s, ...
6. Max 5 retries before dead-letter
```

---

## Performance Characteristics

### Query Performance

| Query | Index | Time | Notes |
|-------|-------|------|-------|
| Get video by ID | PRIMARY KEY | O(1) | Direct lookup |
| List pending jobs | (status, createdAt) | O(log n) | Composite index |
| Claim job | (status) + FOR UPDATE | O(log n) + lock | Prevents race |
| Update video state | PRIMARY KEY | O(1) | Direct update |

### Storage

```
Per video:
- Metadata: ~1KB
- Transcript: ~10-50KB (depends on duration)
- AI metadata: ~2KB
- S3 blobs: source video + processed video

Example: 10-minute video
- Source: ~500MB
- Processed: ~100MB
- Metadata: <1MB
- Total: ~600MB per video
```

### Throughput

With single worker:
- ~10 videos/hour (depends on video length, external API latency)

With N workers:
- ~10N videos/hour
- Limited by: external APIs (Deepgram, Groq), FFmpeg hardware

---

## Security Considerations

### Threats & Mitigations

| Threat | Mitigation |
|--------|-----------|
| Unauthorized uploads | No auth (single-tenant design); IP whitelist optional |
| Malicious video files | FFmpeg in sandboxed container; input validation |
| API key exposure | Secrets in environment variables; never log keys |
| Webhook replay attacks | HMAC signature + idempotency keys |
| Timing attacks | Use `timingSafeEqual` for signature comparison |
| SQL injection | Parameterized queries; no string concatenation |

### Secrets Management

```bash
# .env (never check in)
DEEPGRAM_API_KEY=xxx
GROQ_API_KEY=xxx
MINIO_ROOT_PASSWORD=xxx

# Used in code
process.env.DEEPGRAM_API_KEY
process.env.GROQ_API_KEY
process.env.MINIO_ROOT_PASSWORD
```

---

## Testing Strategy

### Unit Tests
- Job queue logic (claiming, retries)
- State machine transitions
- Idempotency key deduplication

### Integration Tests
- Full upload → processing → complete flow
- Webhook verification
- Error recovery

### Smoke Test (End-to-End)
```bash
make smoke
# 1. Upload a test video
# 2. Poll until complete (with timeout)
# 3. Verify output files exist
# 4. Verify transcript was generated
# 5. Verify AI metadata exists
```

---

## Deployment Considerations

### Single vs. Multi-Worker

**Single Worker (Development):**
- Simple setup
- Slower (1 video at a time)
- Good for testing

**Multi-Worker (Production):**
- 3-5 workers recommended
- Parallel processing
- Requires shared database + S3
- Load balancing between workers

### Scaling Limits

Current limitations:
- Single PostgreSQL instance (no replication)
- Single MinIO instance (no clustering)
- Workers can scale horizontally (no shared state)

Future work:
- Database replication
- MinIO clustering
- Circuit breakers for external APIs

---

## Monitoring & Observability

### Key Metrics

```
- Videos uploaded (per hour)
- Videos processed (per hour)
- Average processing time (by video length)
- Error rate (by type: transcription, AI, etc.)
- Worker utilization (% time processing vs. idle)
- Database connection pool
```

### Logs to Monitor

```
[worker] Job claimed: videoId=xxx jobType=process_video
[worker] Job failed: videoId=xxx error="timeout"
[worker] Job completed: videoId=xxx duration=45s
[web-api] Upload received: videoId=xxx size=500MB
[web-api] Webhook received: source=media-server status=complete
```

---

## Future Improvements

- [ ] Multi-worker load balancing
- [ ] Database replication for high availability
- [ ] Circuit breaker for external APIs
- [ ] Caching layer (Redis) for frequently accessed metadata
- [ ] CDN integration for video delivery
- [ ] Rate limiting + quota enforcement
- [ ] Audit logging for compliance

---

## References

- State Machine Pattern: https://martinfowler.com/articles/patterns-of-distributed-systems/monotonic-reads.html
- Idempotency: https://stripe.com/blog/idempotency
- Job Queue: https://brandur.org/job-queue
- PostgreSQL Advisory Locks: https://www.postgresql.org/docs/current/explicit-locking.html

---

**Questions?** See [README.md](README.md) or [CONTRIBUTING.md](CONTRIBUTING.md) for support.
