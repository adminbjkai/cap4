# Queue Logic Audit

**Generated:** 2026-03-06T07:53:13Z  
**Auditor:** Worker/Queue Logic Auditor  
**Scope:** Job queue implementation, retry logic, idempotency, async processing patterns

---

## Executive Summary

- **Job types:** 5 (`process_video`, `transcribe_video`, `generate_ai`, `cleanup_artifacts`, `deliver_webhook`)
- **Critical issues (P0):** 1
- **High issues (P1):** 4
- **Medium issues (P2):** 5

### Key Findings Overview

| Category | Finding | Severity |
|----------|---------|----------|
| Job Lifecycle | Missing `ack` in `handleTranscribeVideo` success path | **P0 - Critical** |
| Job Lifecycle | `cleanup_artifacts` bypasses standard job handling | P1 - High |
| Idempotency | `claimOne` SQL injection vulnerability | P1 - High |
| Error Handling | `deliver_webhook` acks outside transaction | P1 - High |
| Error Handling | Missing fatal error detection for 401/403 in `processJob` | P1 - High |
| State Machine | `cancelled` phase not handled in terminal failure | P2 - Medium |
| Concurrency | `ensureVideoNotDeleted` uses separate transaction | P2 - Medium |
| SQL Operations | `RECLAIM_SQL` inconsistent backoff calculation | P2 - Medium |
| Error Handling | `extractAudio` fallback masks extraction failures | P2 - Medium |
| State Machine | `handleProcessVideo` skips intermediate phases | P2 - Medium |

---

## Job Lifecycle Analysis

### Claim Process

**Source:** `apps/worker/src/index.ts` lines 102-126

```sql
WITH candidates AS (
  SELECT id
  FROM job_queue
  WHERE status IN ('queued', 'leased')
    AND run_after <= now()
    AND attempts < max_attempts
    AND (status = 'queued' OR locked_until < now())
  ORDER BY priority DESC, run_after ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE job_queue j
SET status = 'leased',
    locked_by = $2,
    locked_until = now() + $3::interval,
    lease_token = gen_random_uuid(),
    attempts = j.attempts + 1,
    last_attempt_at = now(),
    last_error = NULL,
    updated_at = now()
FROM candidates c
WHERE j.id = c.id
RETURNING j.id, j.video_id, j.job_type, j.lease_token, j.payload, j.attempts, j.max_attempts;
```

**Analysis:**
- ✅ Correctly uses `FOR UPDATE SKIP LOCKED` for concurrent claim safety
- ✅ Generates new `lease_token` on each claim (prevents stale lease conflicts)
- ✅ Increments `attempts` atomically during claim
- ✅ Resets `last_error` on new attempt
- ✅ Filters by `run_after` for scheduled retry support
- ✅ Handles both `queued` and expired `leased` jobs

**Issue (P2):** The `claimOne` function (line 291-301) dynamically modifies SQL when `excludeTypes` is provided:

```typescript
const sql = excludeTypes.length > 0
  ? CLAIM_SQL.replace("WHERE status IN ('queued', 'leased')", `WHERE status IN ('queued', 'leased') AND job_type NOT IN (${excludeTypes.map((_, i) => `$${i + 4}`).join(",")})`)
  : CLAIM_SQL;
```

**Risk:** While parameterized queries are used for values, the dynamic SQL construction for `excludeTypes` could be vulnerable if job types are not properly validated against the `job_type` enum.

---

### Heartbeat Mechanism

**Source:** `apps/worker/src/index.ts` lines 138-148, 231-274

```sql
UPDATE job_queue
SET locked_until = now() + $4::interval,
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
  AND locked_until > now()
RETURNING id;
```

```typescript
function startHeartbeatLoop(job: JobRow): () => void {
  let stopped = false;
  let inFlight = false;

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;

    void heartbeat(job)
      .then((alive) => {
        if (!alive) {
          log("job.heartbeat.lost", { ... });
        }
      })
      .catch((error) => { ... })
      .finally(() => { inFlight = false; });
  }, env.WORKER_HEARTBEAT_MS);

  return () => { stopped = true; clearInterval(timer); };
}
```

**Analysis:**
- ✅ Heartbeat only renews if `locked_until > now()` (prevents renewing expired leases)
- ✅ Validates `locked_by` and `lease_token` (prevents cross-worker interference)
- ✅ Uses `inFlight` flag to prevent overlapping heartbeat requests
- ✅ Returns cleanup function to stop heartbeat

**Issue (P2):** The heartbeat condition `AND locked_until > now()` creates a race window. If the lease expires between the check and the update, the heartbeat will fail silently. This is acceptable behavior but could be tightened.

---

### Retry Logic

**Source:** `apps/worker/src/index.ts` lines 172-190

```sql
UPDATE job_queue
SET status = (CASE WHEN $5 = true OR attempts >= max_attempts THEN 'dead' ELSE 'queued' END)::job_status,
    run_after = CASE
      WHEN $5 = true OR attempts >= max_attempts THEN run_after
      ELSE now() + make_interval(secs => LEAST(7200, (30 * power(2, GREATEST(0, attempts - 1)))::INT))
    END,
    last_error = $4,
    locked_by = NULL,
    locked_until = NULL,
    lease_token = NULL,
    finished_at = CASE WHEN $5 = true OR attempts >= max_attempts THEN now() ELSE NULL END,
    updated_at = now()
WHERE id = $1
  AND locked_by = $2
  AND lease_token = $3
  AND status IN ('leased', 'running')
RETURNING id, status;
```

**Analysis:**
- ✅ Exponential backoff: `30 * 2^(attempts-1)` seconds, capped at 7200s (2 hours)
- ✅ Fatal errors immediately move to `dead` status
- ✅ Validates lease token before failing (prevents race conditions)
- ✅ Sets `finished_at` only for terminal states

**Issue (P2):** Inconsistent backoff calculation between `FAIL_SQL` and `RECLAIM_SQL`:

- `FAIL_SQL`: `power(2, GREATEST(0, attempts - 1))` - uses `attempts` from job row (already incremented during claim)
- `RECLAIM_SQL`: `power(2, GREATEST(0, attempts - 1))` - same formula, but `attempts` hasn't been incremented for reclaimed jobs

This means reclaimed jobs may have different backoff timing than jobs that fail normally.

---

### Dead Letter Handling

**Source:** `apps/worker/src/index.ts` lines 318-365

```typescript
async function markTerminalFailure(job: JobRow, errorMessage: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    if (job.job_type === "process_video") {
      await client.query(
        `UPDATE videos
         SET processing_phase = 'failed',
             processing_phase_rank = 80,
             processing_progress = GREATEST(processing_progress, $3),
             error_message = $2,
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND (
             processing_phase_rank < 80
             OR (processing_phase_rank = 80 AND processing_progress < $3)
           )`,
        [job.video_id, errorMessage, PROCESSING_PHASE_META.failed.progress]
      );
      return;
    }
    // ... similar for transcribe_video and generate_ai
  });
}
```

**Analysis:**
- ✅ Updates video state atomically when job reaches `dead` status
- ✅ Uses monotonic phase rank checks to prevent regressions
- ✅ Sets `error_message` for debugging

**Issue (P2):** The `cancelled` phase is not handled in `markTerminalFailure`. If a job is cancelled (which is a terminal state per `PROCESSING_PHASE_META`), the video state won't be updated to reflect this.

---

## Findings by Severity

### Critical (P0)

#### P0-1: Missing `ack` in `handleTranscribeVideo` Success Path

**Location:** `apps/worker/src/index.ts` lines 607-786

**Current Code:**
```typescript
async function handleTranscribeVideo(job: JobRow): Promise<void> {
  // ... job processing logic ...
  
  await withTransaction(env.DATABASE_URL, async (client) => {
    // ... insert transcripts, update videos ...
    
    if (row?.webhook_url) {
      await client.query(
        `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
         VALUES ($1::uuid, 'deliver_webhook', 'queued', 10, now(), $2::jsonb, 5)`,
        [job.video_id, JSON.stringify({ ... })]
      );
    }

    if (aiStatus !== "queued") {
      return;  // ⚠️ Returns without acking!
    }

    await client.query(
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'generate_ai', 'queued', 90, now(), '{}'::jsonb, $2)
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()`,
      [job.video_id, env.WORKER_MAX_ATTEMPTS]
    );

    await ack(client, job);  // ⚠️ Only acked if aiStatus === "queued"
  });

  log("job.transcribe.complete", { ... });  // This still logs
}
```

**Risk:** When `aiStatus !== "queued"`, the job completes without calling `ack()`. This causes:
1. The job remains in `running` status indefinitely
2. Lease expires, job is reclaimed
3. On reclaim, job may be retried or marked dead depending on attempts
4. Duplicate transcript entries possible
5. Wasted processing resources

**Suggested Fix:**
```typescript
await withTransaction(env.DATABASE_URL, async (client) => {
  // ... existing logic ...
  
  if (aiStatus === "queued") {
    await client.query(
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'generate_ai', 'queued', 90, now(), '{}'::jsonb, $2)
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()`,
      [job.video_id, env.WORKER_MAX_ATTEMPTS]
    );
  }

  await ack(client, job);  // Always ack after successful processing
});
```

---

### High (P1)

#### P1-1: `cleanup_artifacts` Bypasses Standard Job Handling

**Location:** `apps/worker/src/index.ts` lines 1096-1099, 1031-1082

**Current Code:**
```typescript
async function processJob(job: JobRow): Promise<void> {
  // ...
  try {
    if (job.job_type === "cleanup_artifacts") {
      await handleCleanupArtifacts(job);
      return;  // ⚠️ Returns without acking!
    }
    await handleJob(job);
    log("job.acked", { ... });
  } catch (error) {
    // ... error handling ...
  }
}

async function handleCleanupArtifacts(job: JobRow): Promise<void> {
  // ... cleanup logic ...
  await withTransaction(env.DATABASE_URL, async (client) => {
    await ack(client, job);  // ⚠️ Acks in separate transaction
  });
}
```

**Risk:** 
1. `cleanup_artifacts` acks in its own transaction, separate from the actual work
2. If cleanup partially fails (e.g., some S3 objects deleted, then error), the job is already acked
3. Inconsistent pattern compared to other job handlers

**Suggested Fix:**
```typescript
async function processJob(job: JobRow): Promise<void> {
  // ...
  try {
    await handleJob(job);  // Let handleJob handle all job types
    // Ack happens in handleJob for each type
    log("job.acked", { ... });
  } catch (error) {
    // ...
  }
}

async function handleCleanupArtifacts(job: JobRow): Promise<void> {
  // ... cleanup logic without ack ...
  // Return and let caller ack
}
```

---

#### P1-2: `claimOne` SQL Injection Risk

**Location:** `apps/worker/src/index.ts` lines 291-301

**Current Code:**
```typescript
async function claimOne(excludeTypes: JobType[] = []): Promise<JobRow | null> {
  const sql = excludeTypes.length > 0
    ? CLAIM_SQL.replace("WHERE status IN ('queued', 'leased')", `WHERE status IN ('queued', 'leased') AND job_type NOT IN (${excludeTypes.map((_, i) => `$${i + 4}`).join(",")})`)
    : CLAIM_SQL;

  return withTransaction(env.DATABASE_URL, async (client) => {
    const params = [1, env.WORKER_ID, `${env.WORKER_LEASE_SECONDS} seconds`, ...excludeTypes];
    const result = await client.query<JobRow>(sql, params);
    return result.rows[0] ?? null;
  });
}
```

**Risk:** While `excludeTypes` is typed as `JobType[]`, TypeScript types are erased at runtime. If untrusted input reaches this function, SQL injection is possible.

**Suggested Fix:**
```typescript
const VALID_JOB_TYPES: JobType[] = ['process_video', 'transcribe_video', 'generate_ai', 'cleanup_artifacts', 'deliver_webhook'];

async function claimOne(excludeTypes: JobType[] = []): Promise<JobRow | null> {
  // Validate all excluded types at runtime
  const validExcludes = excludeTypes.filter(t => VALID_JOB_TYPES.includes(t));
  
  const sql = validExcludes.length > 0
    ? CLAIM_SQL.replace("WHERE status IN ('queued', 'leased')", `WHERE status IN ('queued', 'leased') AND job_type NOT IN (${validExcludes.map((_, i) => `$${i + 4}`).join(",")})`)
    : CLAIM_SQL;
  // ...
}
```

---

#### P1-3: `deliver_webhook` Acks Outside Transaction

**Location:** `apps/worker/src/index.ts` lines 995-1029

**Current Code:**
```typescript
async function handleDeliverWebhook(job: JobRow): Promise<void> {
  // ... payload validation ...
  
  try {
    const response = await fetch(payload.webhookUrl, { ... });
    if (!response.ok) {
      throw new Error(`Webhook delivery failed with status ${response.status}`);
    }
    log("job.webhook.delivered", { ... });
  } catch (err: unknown) {
    log("job.webhook.delivery_failed", { ... });
    throw err; // Let it retry
  }

  await withTransaction(env.DATABASE_URL, async (client) => {
    await ack(client, job);  // ⚠️ Separate transaction after HTTP call
  });
}
```

**Risk:**
1. Webhook is delivered successfully
2. Network partition or crash occurs before ack
3. Job is retried, webhook is delivered again
4. Webhook endpoint receives duplicate delivery

**Suggested Fix:**
```typescript
async function handleDeliverWebhook(job: JobRow): Promise<void> {
  // ... payload validation ...
  
  // Perform HTTP call
  try {
    const response = await fetch(payload.webhookUrl, { ... });
    if (!response.ok) {
      throw new Error(`Webhook delivery failed with status ${response.status}`);
    }
  } catch (err: unknown) {
    log("job.webhook.delivery_failed", { ... });
    throw err;
  }
  
  // Note: At-least-once delivery is acceptable for webhooks
  // The webhook payload includes timestamp for idempotency on receiver side
  // Document this behavior or implement idempotency key
}
```

---

#### P1-4: Missing Fatal Error Detection for 401/403 in `processJob`

**Location:** `apps/worker/src/index.ts` lines 1117-1119

**Current Code:**
```typescript
} catch (error) {
  if (error instanceof DeletedVideoSkipError) {
    // ... ack and return
  }

  const isFatal = (error as any)?.fatal === true;  // ⚠️ Only checks error.fatal flag
  const errorMessage = error instanceof Error ? error.message : String(error);
  const failed = await fail(job, errorMessage, isFatal);
  // ...
}
```

**Risk:** While `deepgram.ts` and `groq.ts` correctly set `error.fatal = true` for 401/403 errors, other error sources (S3, media-server, database) may have fatal errors that aren't detected. For example:
- S3 403 Forbidden (invalid credentials)
- Media server 401 (authentication required)

**Suggested Fix:**
```typescript
function isFatalError(error: unknown): boolean {
  // Check explicit fatal flag
  if ((error as any)?.fatal === true) return true;
  
  // Check for auth errors in message
  const message = error instanceof Error ? error.message : String(error);
  const authErrorPatterns = [
    /401/,
    /403/,
    /Unauthorized/,
    /Forbidden/,
    /InvalidAccessKeyId/,
    /SignatureDoesNotMatch/
  ];
  
  return authErrorPatterns.some(pattern => pattern.test(message));
}

// Usage:
const isFatal = isFatalError(error);
```

---

### Medium (P2)

#### P2-1: `cancelled` Phase Not Handled in Terminal Failure

**Location:** `apps/worker/src/index.ts` lines 318-365

**Current Code:**
```typescript
async function markTerminalFailure(job: JobRow, errorMessage: string): Promise<void> {
  // Only handles 'failed' state, not 'cancelled'
  if (job.job_type === "process_video") {
    await client.query(
      `UPDATE videos SET processing_phase = 'failed', ...`,
      [...]
    );
  }
  // ...
}
```

**Risk:** If a job is cancelled (via future cancellation feature), the video state won't reflect the cancellation.

**Suggested Fix:**
```typescript
async function markTerminalFailure(job: JobRow, errorMessage: string, status: 'failed' | 'cancelled' = 'failed'): Promise<void> {
  if (job.job_type === "process_video") {
    const phase = status === 'cancelled' ? 'cancelled' : 'failed';
    const rank = status === 'cancelled' ? 90 : 80;
    await client.query(
      `UPDATE videos SET processing_phase = $4::processing_phase, processing_phase_rank = $5, ...`,
      [job.video_id, errorMessage, PROCESSING_PHASE_META[phase].progress, phase, rank]
    );
  }
  // ...
}
```

---

#### P2-2: `ensureVideoNotDeleted` Uses Separate Transaction

**Location:** `apps/worker/src/index.ts` lines 367-390

**Current Code:**
```typescript
async function ensureVideoNotDeleted(job: JobRow, phase: string): Promise<void> {
  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    return client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM videos WHERE id = $1::uuid`,
      [job.video_id]
    );
  });
  // ...
}
```

**Risk:** Race condition between checking `deleted_at` and performing work. Video could be deleted after check but before work begins.

**Suggested Fix:** Pass the client from the caller's transaction:
```typescript
async function ensureVideoNotDeleted(client: PoolClient, job: JobRow, phase: string): Promise<void> {
  const result = await client.query<{ deleted_at: string | null }>(
    `SELECT deleted_at FROM videos WHERE id = $1::uuid`,
    [job.video_id]
  );
  // ...
}
```

---

#### P2-3: `RECLAIM_SQL` Inconsistent Backoff Calculation

**Location:** `apps/worker/src/index.ts` lines 192-217

**Current Code:**
```sql
UPDATE job_queue j
SET status = (CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END)::job_status,
    run_after = CASE
      WHEN attempts >= max_attempts THEN run_after
      ELSE now() + make_interval(secs => LEAST(7200, (30 * power(2, GREATEST(0, attempts - 1)))::INT))
    END,
    -- ...
```

**Issue:** In `FAIL_SQL`, `attempts` has already been incremented during claim. In `RECLAIM_SQL`, `attempts` hasn't been incremented. This leads to:
- Normal fail: attempts=2 → backoff = 30s
- Reclaimed fail: attempts=1 → backoff = 30s (should be 0s for first retry)

**Suggested Fix:** Align the backoff calculation logic between `FAIL_SQL` and `RECLAIM_SQL`.

---

#### P2-4: `extractAudio` Fallback Masks Extraction Failures

**Location:** `apps/worker/src/lib/ffmpeg.ts` lines 1-41

**Current Code:**
```typescript
const audioBuffer = await extractAudio(mediaBuffer).catch((err) => {
  log("job.transcribe.audio_extraction_failed", { video_id: job.video_id, error: err.message });
  return mediaBuffer; // Fallback to original buffer if extraction fails
});
```

**Risk:**
1. Audio extraction fails (e.g., corrupt video)
2. Falls back to sending full video to Deepgram
3. Deepgram may fail or return poor results
4. User is charged for full video size instead of audio only

**Suggested Fix:** Consider making audio extraction failure a fatal error for the transcription job, or at least track this as a distinct error type.

---

#### P2-5: `handleProcessVideo` Skips Intermediate Phases

**Location:** `apps/worker/src/index.ts` lines 502-505

**Current Code:**
```typescript
await updateProcessingPhase(client, job, "probing");
await updateProcessingPhase(client, job, "processing");
await updateProcessingPhase(client, job, "uploading");
await updateProcessingPhase(client, job, "generating_thumbnail");
```

**Issue:** These phases are updated all at once after media-server returns, not as they actually occur. The webhook reporting (if implemented) won't reflect real-time progress.

**Note:** This is acceptable given the current architecture where media-server handles all processing atomically. However, it should be documented that these phases represent logical states, not actual processing stages.

---

## State Machine Correctness

### Processing Phase State Machine

**AGENTS.md Specification:**
```
queued(10) → downloading(20) → probing(30) → processing(40) → uploading(50) → generating_thumbnail(60) → complete(70)
queued|downloading|probing|processing|uploading|generating_thumbnail → failed(80)|cancelled(90)
```

**Verification:**

| Transition | Implementation | Status |
|------------|----------------|--------|
| queued → downloading | `handleProcessVideo` line 457 | ✅ |
| downloading → probing | `handleProcessVideo` line 502 | ✅ |
| probing → processing | `handleProcessVideo` line 503 | ✅ |
| processing → uploading | `handleProcessVideo` line 504 | ✅ |
| uploading → generating_thumbnail | `handleProcessVideo` line 505 | ✅ |
| generating_thumbnail → complete | `handleProcessVideo` lines 507-536 | ✅ |
| Any → failed | `markTerminalFailure` line 321-336 | ✅ |
| Any → cancelled | Not implemented | ⚠️ |

### Transcription Status State Machine

**AGENTS.md Specification:**
```
not_started → queued → processing → complete
processing → no_audio|failed
not_started|queued → skipped
```

**Verification:**

| Transition | Implementation | Status |
|------------|----------------|--------|
| not_started → queued | `handleProcessVideo` lines 554-570 | ✅ |
| queued → processing | `handleTranscribeVideo` lines 638-646 | ✅ |
| processing → complete | `handleTranscribeVideo` lines 742-752 | ✅ |
| processing → no_audio | `handleTranscribeVideo` lines 679-698 | ✅ |
| processing → failed | `markTerminalFailure` lines 339-351 | ✅ |
| not_started|queued → skipped | `handleProcessVideo` lines 582-596 | ✅ |

### AI Status State Machine

**AGENTS.md Specification:**
```
not_started → queued → processing → complete
processing → failed
not_started|queued → skipped
```

**Verification:**

| Transition | Implementation | Status |
|------------|----------------|--------|
| not_started → queued | `handleTranscribeVideo` line 745 | ✅ |
| queued → processing | `handleGenerateAi` lines 835-843 | ✅ |
| processing → complete | `handleGenerateAi` lines 932-940 | ✅ |
| processing → failed | `markTerminalFailure` lines 353-363 | ✅ |
| not_started|queued → skipped | `handleGenerateAi` lines 822-833 | ✅ |

---

## Concurrency Analysis

### Lock Management

**Claim Lock:**
```sql
FOR UPDATE SKIP LOCKED
```
- ✅ Prevents multiple workers from claiming the same job
- ✅ Skips locked rows instead of blocking

**Lease Validation:**
All mutations (`ACK_SQL`, `FAIL_SQL`, `HEARTBEAT_SQL`) validate:
- `locked_by = $worker_id`
- `lease_token = $lease_token`
- `status IN ('leased', 'running')`

This ensures only the lease holder can modify the job.

### Race Conditions

**Potential Race:** `handleProcessVideo` enqueues `transcribe_video` job:

```typescript
await client.query(
  `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
   VALUES ($1::uuid, 'transcribe_video', 'queued', 95, now(), '{}'::jsonb, $2)
   ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
   DO UPDATE SET updated_at = now()`,
  [job.video_id, env.WORKER_MAX_ATTEMPTS]
);

await ack(client, job);  // ⚠️ Ack after enqueue
```

**Risk:** If the transaction fails after enqueue but before ack, the transcribe job exists but process_video will be retried, potentially creating duplicate work.

**Mitigation:** The `ON CONFLICT` clause with unique index prevents duplicate active jobs, making this safe.

---

## Recommendations

### Immediate (Fix Before Production)

1. **Fix P0-1:** Add `ack(client, job)` call in `handleTranscribeVideo` for the `aiStatus !== "queued"` branch.

2. **Fix P1-1:** Refactor `cleanup_artifacts` to follow the same pattern as other job handlers (ack in caller, not in handler).

### Short Term (Next Sprint)

3. **Fix P1-2:** Add runtime validation for `excludeTypes` in `claimOne`.

4. **Fix P1-4:** Implement comprehensive fatal error detection for auth errors.

5. **Fix P2-2:** Refactor `ensureVideoNotDeleted` to use caller's transaction client.

### Long Term (Technical Debt)

6. **Fix P2-3:** Align backoff calculation between `FAIL_SQL` and `RECLAIM_SQL`.

7. **Fix P2-4:** Consider making audio extraction failures non-retryable.

8. **Fix P2-5:** Document that processing phases are logical states, not real-time progress.

9. **Add Observability:** Add metrics for:
   - Job claim rate by type
   - Job success/failure rate by type
   - Average job duration by type
   - Lease expiration rate
   - Dead letter rate

10. **Add Circuit Breaker:** Implement circuit breaker for external providers (Deepgram, Groq) to fail fast during outages.

---

## Evidence References

| File | Lines | Purpose |
|------|-------|---------|
| `apps/worker/src/index.ts` | 1-1213 | Main worker implementation |
| `apps/worker/src/index.ts` | 102-126 | CLAIM_SQL |
| `apps/worker/src/index.ts` | 138-148 | HEARTBEAT_SQL |
| `apps/worker/src/index.ts` | 172-190 | FAIL_SQL |
| `apps/worker/src/index.ts` | 192-217 | RECLAIM_SQL |
| `apps/worker/src/index.ts` | 318-365 | markTerminalFailure |
| `apps/worker/src/index.ts` | 607-786 | handleTranscribeVideo |
| `apps/worker/src/index.ts` | 995-1029 | handleDeliverWebhook |
| `apps/worker/src/providers/deepgram.ts` | 79-134 | transcribeWithDeepgram |
| `apps/worker/src/providers/groq.ts` | 58-129 | summarizeWithGroq |
| `db/migrations/0001_init.sql` | 152-189 | job_queue schema |
| `packages/config/src/index.ts` | 1-32 | Worker configuration |

---

*End of Queue Logic Audit*
