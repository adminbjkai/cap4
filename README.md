# Cap v2: Deterministic Single-Tenant Video Web App

## Project Purpose
Cap v2 is a greenfield, single-tenant video web application focused on reliable media workflows and public sharing by video ID.

This system has no authentication, no users, no organizations, and no workspace model. Every video is accessible via a public-by-ID share route.

The core product behavior is a deterministic asynchronous pipeline:
1. Upload
2. Processing
3. Transcription
4. AI generation (title, summary, chapters)

All long-running work is executed through explicit database-backed jobs, never through read-path side effects.

## Architectural Principles
1. No implicit workflow triggers in read endpoints.
2. All async work is driven by explicit DB jobs.
3. All mutating endpoints are idempotent and require `Idempotency-Key`.
4. State transitions are monotonic and compare-and-set guarded.
5. Job leasing uses `FOR UPDATE SKIP LOCKED` with lease heartbeats.
6. Webhooks are HMAC-verified and replay-safe.
7. S3/MinIO is a blob store only; Postgres is the source of truth.

## High-Level System Topology
- `web-api`: HTTP API surface and share page delivery.
- `worker`: background job runner and retry/dead-letter mechanics.
- `media-server`: FFmpeg/FFprobe processing and thumbnail generation.
- `postgres`: canonical state, queue, idempotency, and event records.
- `s3/minio`: media object storage for raw/result/thumbnail/transcript artifacts.

The intended execution model is event-driven through DB state transitions:
- API mutation writes state + enqueues job.
- Worker claims jobs via SQL leases.
- Media-server emits signed progress webhooks.
- Webhook handler enforces dedupe + monotonic updates.

## State Machines Overview
### Upload
- `pending -> uploading -> completing -> uploaded`
- `uploading|completing -> failed|aborted`

### Processing
- `not_required` (terminal)
- `queued -> downloading -> probing -> processing -> uploading -> generating_thumbnail -> complete`
- `queued|downloading|probing|processing|uploading|generating_thumbnail -> failed|cancelled`

### Transcription
- `not_started -> queued -> processing -> complete`
- `processing -> no_audio|failed`
- `not_started|queued -> skipped`

### AI
- `not_started -> queued -> processing -> complete`
- `processing -> failed`
- `not_started|queued -> skipped`

## Non-Goals
- No multi-tenancy.
- No billing or subscription logic.
- No workspace, organization, folder, or membership logic.
- No auth/session providers of any kind.
- No read-path side effects from polling or GET routes.

## Repository Conventions
- Database migrations: `./db/migrations`
- SQL schema snapshots: `./db/schema`
- Web API routes and handlers: `./apps/web-api/src/routes`
- Worker code and job executors: `./apps/worker/src`
- Media server code: `./apps/media-server/src`
- Shared domain/state logic: `./packages/domain`
- Shared DB access layer: `./packages/data`
- Operational and architecture docs: `./docs`

## Coding Constraints for Future Contributors
1. Never trigger jobs from GET endpoints.
2. Never mutate state outside explicit transactions for multi-step changes.
3. Never delete state rows to represent transitions; write terminal states explicitly.
4. Never bypass the idempotency layer for mutating HTTP routes.
5. Always enforce monotonic state updates in DB writes.
6. Always persist retry intent in `job_queue`; do not implement in-memory retry loops as source of truth.
7. Always verify webhook signatures before any state mutation.

## Operational Philosophy
- Deterministic state first: DB state must explain system behavior at all times.
- Observable by default: structured logs with `video_id`, `job_id`, `phase`, and attempt counters.
- Explicit retries only: bounded exponential backoff with recorded errors.
- Dead-letter on exhaustion: terminal failed jobs move to dead-letter state for operator action.
- Recovery is targeted: retry per video/job type, never broad resets.

## Development Guardrails
- Treat queue rows as durable contracts.
- Prefer idempotent upserts and compare-and-set transitions.
- Keep side effects after state intent is committed.
- Make failure states explicit, queryable, and recoverable.

## Milestone 2 (Canonical)
```bash
cd /Users/m17/2026/gh_repo_tests/Cap_v2
cp .env.example .env
make down && make up && make reset-db
until curl -fsS http://localhost:3000/health >/dev/null; do sleep 1; done
for n in 1 2 3 4 5; do
  VIDEO_JSON="$(curl -sS -X POST http://localhost:3000/api/videos -H 'Content-Type: application/json' -d '{}')"
  VIDEO_ID="$(echo "$VIDEO_JSON" | jq -r '.videoId')"
  SIGNED_JSON="$(curl -sS -X POST http://localhost:3000/api/uploads/signed -H 'Content-Type: application/json' -d "{\"videoId\":\"${VIDEO_ID}\",\"contentType\":\"video/mp4\"}")"
  PUT_URL="$(echo "$SIGNED_JSON" | jq -r '.putUrl')"

  docker compose exec -T media-server sh -lc "ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=25 -f lavfi -i sine=frequency=1000:sample_rate=44100 -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/upload-${n}.mp4 >/dev/null 2>&1 && cat /tmp/upload-${n}.mp4" > "/tmp/capv2-upload-${n}.mp4"

  curl -sS -X PUT "$PUT_URL" -H 'Content-Type: video/mp4' --data-binary @"/tmp/capv2-upload-${n}.mp4" >/dev/null

  COMPLETE_JSON="$(curl -sS -X POST http://localhost:3000/api/uploads/complete -H 'Content-Type: application/json' -d "{\"videoId\":\"${VIDEO_ID}\"}")"

  until [ "$(curl -sS "http://localhost:3000/api/videos/${VIDEO_ID}/status" | jq -r '.processingPhase')" = "complete" ]; do
    sleep 1
  done

  STATUS_JSON="$(curl -sS "http://localhost:3000/api/videos/${VIDEO_ID}/status")"
  echo "$STATUS_JSON" | jq

  RESULT_KEY="$(echo "$STATUS_JSON" | jq -r '.resultKey')"
  THUMB_KEY="$(echo "$STATUS_JSON" | jq -r '.thumbnailKey')"

  curl -s -o /dev/null -w "result_status=%{http_code}\n" "http://localhost:9000/cap-v2/${RESULT_KEY}"
  curl -s -o /dev/null -w "thumb_status=%{http_code}\n" "http://localhost:9000/cap-v2/${THUMB_KEY}"
done
docker compose ps
```

Milestone 2 proves real FFmpeg processing and MinIO object I/O in Docker end-to-end: uploads produce actual `result.mp4` and thumbnail artifacts, worker updates persisted video processing state, and status resolves to `complete` with concrete output keys.

## Milestone 3 UI smoke test
```bash
cd /Users/m17/2026/gh_repo_tests/Cap_v2
make down
make up
make reset-db
```

1. Open `http://localhost:3000`.
2. Upload an `.mp4` file in the UI.
3. Confirm phase reaches `complete` at `100%`.
4. Confirm both download links are shown (`result.mp4` and `thumbnail.jpg`).

## Milestone 4 UI (record -> upload -> process -> view)
The frontend now runs as a dedicated app at `http://localhost:5173` (`apps/web`, Vite + React + TypeScript + Tailwind) and uses existing API endpoints only for upload and processing.

### Docker run
```bash
cd /Users/m17/2026/gh_repo_tests/Cap_v2
cp .env.example .env
make down
make up
make reset-db
```

### UI smoke test
1. Open `http://localhost:5173`.
2. Go to `Record`.
3. Click `Start recording`, choose a screen/tab/window, allow microphone, speak for 2 seconds.
4. Click `Stop recording` and confirm local preview playback (audio expected).
5. Click `Upload and process`.
6. Confirm navigation to `/video/:videoId` and status reaches `complete`.
7. Confirm processed video playback works and both download links open (`result.mp4`, `thumbnail.jpg`).

This repository is intentionally optimized for correctness and operability over implicit convenience.
