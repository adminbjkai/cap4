# Database Schema & State Machine

Reference documentation for cap4's database structure.

---

## Overview

cap4 uses PostgreSQL 16 as the single source of truth for all state.

**Key principle:** All data in database. No in-memory state.
- Enables recovery from crashes
- Enables horizontal scaling (multiple workers)
- Enables webhook auditing

---

## Core Tables

### videos
Main table tracking video state.

```sql
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User metadata
  uploadedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  completedAt TIMESTAMP,
  deletedAt TIMESTAMP,  -- Soft delete
  
  -- State machine
  processingPhase TEXT NOT NULL,
  rank INT NOT NULL DEFAULT 0,
  -- Phases: not_required (0) → uploading (5) → queued (10) →
  --         processing (20) → processed (25) →
  --         transcribing (30) → transcribed (35) →
  --         generating_ai (40) → generated_ai (45) →
  --         complete (50) [terminal]
  
  -- Raw/processed files
  rawKey TEXT,              -- S3 key for uploaded video
  resultKey TEXT,           -- S3 key for processed video
  thumbnailKey TEXT,        -- S3 key for thumbnail
  
  -- Metadata
  title TEXT,               -- AI-generated
  summary TEXT,             -- AI-generated
  transcript TEXT,          -- From Deepgram
  chapters JSONB,           -- AI-generated array
  
  -- Tracking
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  version INT DEFAULT 1     -- For optimistic locking
);

CREATE INDEX idx_videos_phase ON videos(processingPhase);
CREATE INDEX idx_videos_rank ON videos(rank);
CREATE INDEX idx_videos_uploadedAt ON videos(uploadedAt DESC);
CREATE INDEX idx_videos_deletedAt ON videos(deletedAt);
```

### jobs
Async job queue for background processing.

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  videoId UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  
  -- Job details
  type TEXT NOT NULL,  -- 'process_video', 'transcribe', 'generate_ai'
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, claimed, completed, failed
  
  -- Worker lease
  leaseExpiry TIMESTAMP,  -- When lease expires (worker crash recovery)
  claimedBy TEXT,         -- Which worker claimed it
  
  -- Retry logic
  retryCount INT DEFAULT 0,
  maxRetries INT DEFAULT 5,
  lastError TEXT,
  
  -- Tracking
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  claimedAt TIMESTAMP,
  completedAt TIMESTAMP
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_videoId ON jobs(videoId);
CREATE INDEX idx_jobs_leaseExpiry ON jobs(leaseExpiry) WHERE status = 'claimed';
```

### idempotency_keys
Prevents duplicate requests.

```sql
CREATE TABLE idempotency_keys (
  key UUID PRIMARY KEY,
  videoId UUID REFERENCES videos(id),
  response JSONB NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  expiresAt TIMESTAMP NOT NULL  -- Auto-delete after 24h
);

CREATE INDEX idx_idempotency_keys_expiry ON idempotency_keys(expiresAt);
```

### webhook_requests
Audit trail of webhook calls (for debugging).

```sql
CREATE TABLE webhook_requests (
  id SERIAL PRIMARY KEY,
  videoId UUID REFERENCES videos(id),
  source TEXT,  -- 'media-server', 'minio', 'user'
  event TEXT,   -- 'processing_complete', 'error', etc.
  payload JSONB,
  signature TEXT,
  verified BOOLEAN,
  statusCode INT,
  error TEXT,
  receivedAt TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_requests_videoId ON webhook_requests(videoId);
CREATE INDEX idx_webhook_requests_source ON webhook_requests(source);
```

### phase_transitions
State machine audit log (optional, for history).

```sql
CREATE TABLE phase_transitions (
  id SERIAL PRIMARY KEY,
  videoId UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  fromPhase TEXT,
  toPhase TEXT NOT NULL,
  reason TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_phase_transitions_videoId ON phase_transitions(videoId);
```

---

## State Machine Details

### Phase Ranks

```
Rank 0:  not_required (starting)
Rank 5:  uploading
Rank 10: queued
Rank 20: processing
Rank 25: processed
Rank 30: transcribing
Rank 35: transcribed (or failed_transcription)
Rank 40: generating_ai
Rank 45: generated_ai (or failed_ai_gen)
Rank 50: complete (terminal)
         failed_processing (terminal)
         failed_transcription (terminal) [retryable]
         failed_ai_gen (terminal) [retryable]
         cancelled (terminal)
```

### Monotonic Transitions

Only forward transitions allowed:

```sql
-- This is enforced in application code:
-- UPDATE videos
-- SET processingPhase = $1, rank = $2, updatedAt = NOW()
-- WHERE id = $3 
--   AND rank <= $2  -- Only allow rank increases
```

### Atomic Updates

Compare-and-set prevents race conditions:

```sql
-- Before updating, verify current phase
UPDATE videos
SET processingPhase = $1, rank = $2, updatedAt = NOW()
WHERE id = $3 
  AND processingPhase = $4  -- Ensure it hasn't changed
RETURNING *;
```

---

## Job Queue Logic

### Claiming a Job

Only one worker claims a job:

```sql
-- Worker polls for work
SELECT * FROM jobs
WHERE status = 'pending'
FOR UPDATE SKIP LOCKED  -- Lock + skip if already locked
LIMIT 1;

-- If found, claim it
UPDATE jobs
SET status = 'claimed', leaseExpiry = NOW() + INTERVAL '5 minutes'
WHERE id = $1
RETURNING *;
```

### Completing a Job

```sql
-- After processing succeeds
DELETE FROM jobs WHERE id = $1;

-- Or mark as completed
UPDATE jobs SET status = 'completed', completedAt = NOW() WHERE id = $1;
```

### Retrying a Job

```sql
-- If max retries not exceeded
INSERT INTO jobs (videoId, type, status, retryCount, maxRetries)
VALUES ($1, $2, 'pending', $3 + 1, $4);

-- Otherwise, move to dead-letter
INSERT INTO dead_letter_jobs SELECT * FROM jobs WHERE id = $1;
DELETE FROM jobs WHERE id = $1;
```

### Lease Expiry Recovery

```sql
-- Another worker can reclaim if lease has expired
SELECT * FROM jobs
WHERE status = 'claimed' AND leaseExpiry < NOW()
FOR UPDATE SKIP LOCKED
LIMIT 1;

-- Reset and reclaim
UPDATE jobs
SET status = 'pending', leaseExpiry = NULL
WHERE id = $1
RETURNING *;
```

---

## Idempotency Key Logic

### First Request

```sql
-- Check if key has been seen before
SELECT * FROM idempotency_keys WHERE key = $1;

-- If not found, process request and cache response
INSERT INTO idempotency_keys (key, videoId, response, expiresAt)
VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours');
```

### Duplicate Request

```sql
-- Same key = return cached response
SELECT response FROM idempotency_keys WHERE key = $1;
```

---

## Performance Tuning

### Indexes

Current indexes optimize:
- Phase lookups (status queries)
- Job leasing (FOR UPDATE queries)
- Idempotency key expiry

### Connection Pooling

PostgreSQL connection pool:
```
Max connections: 20 (development), 50+ (production)
```

Configure in `.env`:
```
DB_POOL_SIZE=20
DB_POOL_IDLE_TIMEOUT=30000
```

### Query Performance

Most common queries are O(1) with direct lookups:

```sql
-- O(1) - Direct ID lookup
SELECT * FROM videos WHERE id = $1;

-- O(log n) - Index scan
SELECT * FROM jobs WHERE status = 'pending' LIMIT 1;

-- O(1) - Hash lookup
SELECT * FROM idempotency_keys WHERE key = $1;
```

---

## Backup & Recovery

### Backup Schedule

```bash
# Daily backup at 2 AM UTC
0 2 * * * pg_dump -h db -U cap4 cap4 | gzip > /backups/cap4-$(date +\%Y\%m\%d).sql.gz

# Keep last 30 days
find /backups -name "cap4-*.sql.gz" -mtime +30 -delete
```

### Restore from Backup

```bash
# Restore latest backup
gunzip < /backups/cap4-20260306.sql.gz | psql -h db -U cap4 cap4

# Or restore to point-in-time
# See PostgreSQL PITR documentation
```

### Disaster Recovery

If database is corrupted:

```sql
-- Wipe everything
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Re-run migrations
-- npm run migrate

-- Recreate from S3 (if videos are in S3)
INSERT INTO videos (id, uploadedAt, processingPhase, rank, rawKey)
SELECT uuid, now(), 'queued', 10, s3_key FROM s3_listing;
```

---

## Migrations

Database schema evolves via SQL migrations:

```
db/migrations/
├── 0001_init.sql              -- Initial schema
├── 0002_video_soft_delete.sql -- Add deleted_at column
└── 0003_add_webhook_reporting.sql
```

Run migrations:
```bash
npm run migrate
```

View status:
```bash
npm run migrate:status
```

Rollback:
```bash
npm run migrate:rollback
```

---

## Monitoring

### Key Metrics

```sql
-- Videos in progress
SELECT processingPhase, COUNT(*) 
FROM videos 
WHERE deletedAt IS NULL 
GROUP BY processingPhase;

-- Pending jobs
SELECT COUNT(*) FROM jobs WHERE status = 'pending';

-- Failed jobs
SELECT type, COUNT(*) FROM jobs WHERE status = 'failed' GROUP BY type;

-- Idempotency cache size
SELECT COUNT(*) FROM idempotency_keys;

-- Database size
SELECT pg_size_pretty(pg_database_size('cap4'));
```

### Query Performance

```sql
-- Slow queries log
SELECT mean_exec_time, calls, query 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Connection usage
SELECT count(*) FROM pg_stat_activity;
```

---

## Best Practices

1. **Always use transactions** for multi-table changes
2. **Use compare-and-set** for state machine updates
3. **Implement idempotency keys** for POST requests
4. **Clean up expired data** regularly (vacuum)
5. **Monitor slow queries** and create indexes as needed
6. **Backup regularly** and test restore procedure
7. **Use parameterized queries** to prevent SQL injection

---

**Questions?** See [ARCHITECTURE.md](ARCHITECTURE.md) or [../ops/TROUBLESHOOTING.md](../ops/TROUBLESHOOTING.md)
