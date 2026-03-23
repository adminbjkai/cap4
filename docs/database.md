---
title: "Database Schema"
description: "Tables, enums, migrations, and operational notes"
---

# Database Schema

Current schema reference for cap4, based on `db/migrations/0001_init.sql` through `0006_add_transcript_speaker_labels.sql`.

## Overview

PostgreSQL is the source of truth for:

- video lifecycle state
- upload tracking
- queue state and retries
- transcript and AI outputs
- idempotency records
- webhook audit records

The application uses monotonic phase ranks to prevent stale progress updates from moving a video backwards.

## Enum Types

### `processing_phase`

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

Phase ranks are stored in `videos.processing_phase_rank` and `webhook_events.phase_rank`:

- `0` `not_required`
- `10` `queued`
- `20` `downloading`
- `30` `probing`
- `40` `processing`
- `50` `uploading`
- `60` `generating_thumbnail`
- `70` `complete`
- `80` `failed`
- `90` `cancelled`

### `transcription_status`

- `not_started`
- `queued`
- `processing`
- `complete`
- `no_audio`
- `skipped`
- `failed`

### `ai_status`

- `not_started`
- `queued`
- `processing`
- `complete`
- `skipped`
- `failed`

### Other enums

- `source_type`: `web_mp4`, `processed_mp4`, `hls`
- `upload_mode`: `singlepart`, `multipart`
- `upload_phase`: `pending`, `uploading`, `completing`, `uploaded`, `aborted`, `failed`
- `job_type`: initially `process_video`, `transcribe_video`, `generate_ai`, `cleanup_artifacts`, later migration `0003` adds `deliver_webhook`
- `job_status`: `queued`, `leased`, `running`, `succeeded`, `cancelled`, `dead`
- `ai_provider`: `groq`, `openai`

## Core Tables

### `videos`

Primary entity row for each uploaded recording.

Important columns:

- `id uuid primary key`
- `name text`
- `source_type source_type`
- `processing_phase processing_phase`
- `processing_phase_rank smallint`
- `processing_progress int`
- `transcription_status transcription_status`
- `ai_status ai_status`
- `duration_seconds numeric(10,3)`
- `width int`
- `height int`
- `fps numeric(7,3)`
- `result_key text`
- `thumbnail_key text`
- `error_code text`
- `error_message text`
- `webhook_url text` added by migration `0003`
- `deleted_at timestamptz` added by migration `0002`
- `created_at`, `updated_at`, `completed_at`

Notes:

- `name` is the user-facing persisted title fallback when no `ai_outputs.title` exists.
- Soft-deleted rows remain in the table and are excluded by API/library queries using `deleted_at IS NULL`.

Indexes:

- `idx_videos_created_at`
- `idx_videos_processing_phase`
- `idx_videos_transcription_status`
- `idx_videos_ai_status`
- `idx_videos_active_created_at` on non-deleted rows

### `uploads`

Tracks raw object upload state for a video.

Important columns:

- `video_id uuid primary key references videos(id)`
- `mode upload_mode`
- `phase upload_phase`
- `multipart_upload_id text`
- `raw_key text`
- `uploaded_bytes bigint`
- `total_bytes bigint`
- `etag_manifest jsonb`
- `last_client_heartbeat_at timestamptz`
- `created_at`, `updated_at`

### `job_queue`

Canonical async queue.

Important columns:

- `id bigserial primary key`
- `video_id uuid references videos(id)`
- `job_type job_type`
- `status job_status`
- `priority smallint`
- `payload jsonb`
- `attempts int`
- `max_attempts int`
- `run_after timestamptz`
- `locked_by text`
- `locked_until timestamptz`
- `lease_token uuid`
- `last_attempt_at timestamptz`
- `last_error text`
- `created_at`, `updated_at`, `finished_at`

Important index/constraint behavior:

- `uq_job_queue_one_active_per_video_type` prevents more than one active (`queued`, `leased`, `running`) job per `(video_id, job_type)`
- lease consistency is enforced with a table check constraint
- `last_error` is the canonical queue failure field surfaced by `GET /api/jobs/:id`

### `transcripts`

Transcript storage for a video.

Important columns:

- `video_id uuid primary key references videos(id)`
- `provider text default 'deepgram'`
- `language text not null default 'en'`
- `vtt_key text`
- `segments_json jsonb`
- `speaker_labels_json jsonb not null default '{}'::jsonb` added by migration `0006`
- `created_at`, `updated_at`

Constraints:

- `speaker_labels_json` must be a JSON object and is NOT NULL with DEFAULT '{}' (CHECK constraint)

Notes:

- `segments_json` is the source used to derive editable transcript text in the watch view

### `ai_outputs`

AI-generated metadata for a video.

Important columns:

- `video_id uuid primary key references videos(id)`
- `provider ai_provider`
- `model text`
- `title text`
- `summary text`
- `chapters_json jsonb not null default '[]'::jsonb`
- `entities_json jsonb` added by migration `0005`
- `action_items_json jsonb default '[]'::jsonb` added by migration `0005`
- `quotes_json jsonb default '[]'::jsonb` added by migration `0005`
- `created_at`, `updated_at`

Constraints:

- `chapters_json` must be a JSON array (CHECK constraint)
- `action_items_json` must be a JSON array (CHECK constraint)
- `quotes_json` must be a JSON array (CHECK constraint)

Note:

- The worker persists richer enrichment data here, but the current `/api/videos/:id/status` route only exposes `provider`, `model`, `title`, `summary`, and `keyPoints`.

### `idempotency_keys`

Deduplicates API requests and stores cached responses.

Columns:

- `endpoint text`
- `idempotency_key text`
- `request_hash text`
- `status_code int`
- `response_headers jsonb`
- `response_body jsonb`
- `created_at timestamptz`
- `expires_at timestamptz`

Primary key:

- `(endpoint, idempotency_key)`

### `webhook_events`

Audits media-server progress webhooks.

Important columns:

- `id bigserial primary key`
- `source text`
- `delivery_id text`
- `job_id text`
- `video_id uuid references videos(id)`
- `phase processing_phase`
- `phase_rank smallint`
- `progress int`
- `progress_bucket smallint generated`
- `payload jsonb`
- `signature text`
- `received_at timestamptz`
- `processed_at timestamptz`
- `accepted boolean`
- `reject_reason text`

Important uniqueness guarantees:

- `uq_webhook_source_delivery`
- `uq_webhook_source_job_phase_bucket`

Notes:

- Incoming progress webhook auditing lives in `webhook_events`; there is no separate `webhook_deliveries` table in the current schema.
- `delivery_id` dedupes exact replays, while `source + job_id + phase + progress_bucket` dedupes repeated progress updates within the same bucket.

## Relationships

One-to-one by `video_id`:

- `videos` -> `uploads`
- `videos` -> `transcripts`
- `videos` -> `ai_outputs`

One-to-many by `video_id`:

- `videos` -> `job_queue`
- `videos` -> `webhook_events`

## Updated-At Triggers

`set_updated_at()` is attached to:

- `videos`
- `uploads`
- `job_queue`
- `transcripts`
- `ai_outputs`

## Migration List

```text
0001_init.sql
0002_video_soft_delete.sql
0003_add_webhook_reporting.sql
0004_fix_transcript_language.sql
0005_add_ai_enrichment_fields.sql
0006_add_transcript_speaker_labels.sql
```

## Operational Notes

- Docker startup runs migrations automatically through the `migrate` service.
- Soft-deleted videos remain in `videos` with `deleted_at` set; API list/status routes exclude them.
- Worker retry state lives in `job_queue.attempts`, `max_attempts`, `status`, and `last_error`.
- Monotonic progress updates are enforced in route and worker logic by comparing phase rank and progress before applying updates.

---

## Running Migrations

Apply migrations in lexical order from `db/migrations/`.

### Apply locally (Docker)

```bash
docker compose up -d postgres
for f in /migrations/*.sql; do
  docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-cap4} -f "$f"
done
```

### Reset and re-apply from scratch

```bash
docker compose down -v
docker compose up -d postgres
for f in /migrations/*.sql; do
  docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-cap4} -f "$f"
done
```

### Verify

```bash
docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-cap4} -c "\dt"
```
