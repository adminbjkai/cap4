# Local Development

## Prerequisites
- Docker + Docker Compose
- `pnpm` (host-side checks when needed)

## 1) Configure environment

```bash
cp .env.example .env
```

Required backend provider vars for transcript + AI:
- `DEEPGRAM_API_KEY`
- `GROQ_API_KEY`

Optional provider overrides:
- `DEEPGRAM_MODEL`
- `GROQ_MODEL`
- `DEEPGRAM_BASE_URL`
- `GROQ_BASE_URL`
- `PROVIDER_TIMEOUT_MS`

```bash
make setup
```

This command builds/starts the services, waits for health checks, and applies database migrations automatically.

Services:
- `postgres`
- `minio`
- `minio-setup`
- `web-api`
- `worker`
- `media-server`
- `web-builder` (builds `apps/web` into a shared volume)
- `web-internal` (nginx serving built `apps/web` + proxying `/api` + `/health`)

`minio-setup` applies bucket CORS from `/Users/m17/2026/gh_repo_tests/cap3/docker/minio/cors.json`.

## 3) (Optional) Manual migrations

If you need to re-run migrations manually:

```bash
make reset-db
```

## 4) Health checks

```bash
curl -sS http://localhost:3000/health
curl -sS http://localhost:3100/health
```

## 5) Milestone 4 baseline smoke (record/upload/process)

```bash
cd /Users/m17/2026/gh_repo_tests/cap3
make down
make up
make reset-db
```

1. Open `http://localhost:8022`.
2. Record or upload a file on `/record`.
3. Confirm `/video/:videoId` reaches `processingPhase=complete`.
4. Confirm playback and download links work.

Notes:
- Docker-first UI (production-like): open `http://localhost:8022`.
- Frontend dev server (optional, host-side): run `pnpm dev:web` and open `http://localhost:5173`.

## 6) Transcript + AI API smoke (Docker-only)

Audio path expected terminal state:
- `processingPhase=complete`
- `transcriptionStatus=complete`
- `aiStatus=complete`

No-audio path expected terminal state:
- `processingPhase=complete`
- `transcriptionStatus=no_audio`
- `aiStatus=skipped`

Failure-path expected behavior:
- bounded retries in `job_queue` until `attempts >= max_attempts`
- terminal `job_queue.status=dead`
- `/api/videos/:id/status` includes `aiStatus=failed` and `aiErrorMessage`

## 7) Current Known UX Gap
- Video detail live updates may require manual refresh in some timing windows after processing completes while transcript/AI continue.
- This is tracked for Phase E.

See:
- `docs/ops/PHASE_E_PLAYBACK_INTELLIGENCE_PLAN.md`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`

## 8) View logs

```bash
make logs
```

## 9) Stop stack

```bash
make down
```

### Deep Workspace Clean
If artifacts or database states become corrupted:

```bash
make prune
```

This removes all volumes, orphan containers, and cleans the build cache.

## Troubleshooting

### Missing or Updated API Keys
If you update the `.env` file (e.g., adding `DEEPGRAM_API_KEY` or `GROQ_API_KEY`) after the Docker containers are already running, the `worker` and `web-api` containers will not automatically pick up the new variables.

A simple `docker restart` will **not** reload the .env file. You must recreate the containers using Docker Compose:

```bash
# Recreate containers to load the new .env variables
docker compose -p cap3-dev up -d --force-recreate worker web-api
```

If a transcription or AI job failed because of missing keys and reached the maximum retry limit (status: `dead`), you can manually reset it in the database to force a retry once the containers are recreated:

```bash
# Find the failed job ID
docker exec cap3-postgres psql -U app -d cap3 -c "SELECT id, job_type, status, attempts FROM job_queue WHERE video_id = '<VIDEO_ID>';"

# Reset the job
docker exec cap3-postgres psql -U app -d cap3 -c "UPDATE job_queue SET status = 'queued', attempts = 0, run_after = now(), last_error = NULL, locked_by = NULL, locked_until = NULL, lease_token = NULL WHERE id = <JOB_ID>;"

# Reset the video state
docker exec cap3-postgres psql -U app -d cap3 -c "UPDATE videos SET transcription_status = 'processing', ai_status = 'not_started', error_message = NULL WHERE id = '<VIDEO_ID>';"
```
