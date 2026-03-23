---
title: "Troubleshooting"
description: "Practical fixes for common cap4 runtime and operator issues"
---

# Troubleshooting Guide

This guide focuses on the checked-in Docker Compose stack and the current API
contract. When in doubt, use the code and the route docs as the source of truth.

---

## First Checks

Start here before debugging deeper:

```bash
docker compose ps
docker compose logs --tail=200
curl http://localhost:3000/health
curl http://localhost:3000/ready
make smoke
```

If those checks fail, fix the stack-level issue first before chasing app-level symptoms.

---

## Stack Won't Start

### Containers fail immediately

```bash
docker compose ps
docker compose logs postgres
docker compose logs migrate
docker compose logs web-api
docker compose logs worker
docker compose logs media-server
```

Common causes:

- invalid or missing values in `.env`
- `POSTGRES_PASSWORD`, provider keys, or `MEDIA_SERVER_WEBHOOK_SECRET` not set correctly
- host port collision on `3000`, `3100`, `5432`, `8022`, `8922`, or `8923`

Useful checks:

```bash
lsof -i :3000
lsof -i :3100
lsof -i :5432
lsof -i :8022
lsof -i :8922
```

### Migrations fail

```bash
docker compose logs migrate
```

If the database is disposable and you want a clean reset:

```bash
make reset-db
```

For non-disposable environments, inspect the failing SQL and database state before retrying.

---

## Health or Readiness Fails

### `/health` returns 503

The usual cause is database connectivity.

```bash
docker compose logs web-api
docker compose exec postgres pg_isready -U app -d cap4
```

### `/ready` returns 503 with `"status": "not_ready"`

The readiness route marks the API not ready when the DB check fails or is too slow.

Check:

```bash
docker compose logs web-api
docker compose exec postgres psql -U app -d cap4 -c "SELECT 1"
```

---

## Upload Flow Fails

### `400 Bad Request` on create/upload routes

Most mutation routes require `Idempotency-Key`.

Correct pattern:

```bash
curl -X POST http://localhost:3000/api/videos \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"test upload"}'
```

Do not send a multipart form directly to `/api/videos`. The current API flow is:

1. `POST /api/videos`
2. `POST /api/uploads/signed` or multipart endpoints
3. upload bytes to MinIO/S3
4. `POST /api/uploads/complete` or multipart complete

### Signed upload URLs do not work

Check `S3_PUBLIC_ENDPOINT`.

- Docker full-stack: `http://localhost:8922`
- Local no-Docker MinIO: `http://localhost:9000`

If the browser cannot reach the URL embedded in the presigned upload, uploads fail even when the backend is healthy.

### Vite dev server can’t load video assets

If you are running `pnpm dev:web` against Docker infrastructure, set:

```bash
VITE_S3_PUBLIC_ENDPOINT=http://localhost:8922
```

Leave it unset for the nginx-served Docker app on `http://localhost:8022`.

### Multipart upload routes return 404

The current multipart endpoints are:

- `POST /api/uploads/multipart/initiate`
- `POST /api/uploads/multipart/presign-part`
- `POST /api/uploads/multipart/complete`
- `POST /api/uploads/multipart/abort`

Common causes:

- multipart upload was never initiated
- the video was soft-deleted
- required fields or `Idempotency-Key` are missing

---

## Processing, Transcription, or AI Fails

### Worker is not making progress

```bash
docker compose logs -f worker
docker compose logs -f media-server
```

Check:

- `MEDIA_SERVER_BASE_URL` resolves correctly inside Docker
- Deepgram and Groq keys are valid
- ffmpeg is available in the image and media-server starts cleanly

### Transcription fails

Typical causes:

- invalid `DEEPGRAM_API_KEY`
- provider quota or rate-limit issues
- source file has no usable audio

Inspect:

```bash
docker compose logs worker | grep -i deepgram
```

### AI generation fails

Typical causes:

- invalid `GROQ_API_KEY`
- provider timeout / quota / rate limit
- upstream transcript is missing or empty

Inspect:

```bash
docker compose logs worker | grep -i groq
```

### Video processing fails

Inspect `media-server` and `worker` together:

```bash
docker compose logs media-server
docker compose logs worker
```

If needed, inspect the input file locally:

```bash
ffprobe -v error sample.mp4
```

---

## Queue Issues

### Jobs appear stuck in `leased` or `running`

```bash
docker compose exec postgres psql -U app -d cap4 -c \
  "SELECT id, video_id, job_type, status, locked_by, locked_until, updated_at
   FROM job_queue
   WHERE status IN ('leased', 'running')
   ORDER BY updated_at DESC;"
```

Expired leases that are not being reclaimed usually point to a worker health issue:

```bash
docker compose logs worker
docker compose restart worker
```

### Need a quick queue summary

```bash
docker compose exec postgres psql -U app -d cap4 -c \
  "SELECT status, count(*) FROM job_queue GROUP BY status ORDER BY status;"
```

### Need to inspect one job

```bash
curl http://localhost:3000/api/jobs/123
```

The API exposes `last_error` from `job_queue`, which is the primary failure field for queue rows.

---

## Database and Storage Issues

### PostgreSQL connection errors

```bash
docker compose logs postgres
docker compose exec postgres pg_isready -U app -d cap4
```

Check that `DATABASE_URL` matches the credentials in `.env`.

### MinIO access errors

```bash
docker compose ps minio
docker compose logs minio
curl http://localhost:8922/minio/health/live
```

Check that:

- `S3_ACCESS_KEY` matches `MINIO_ROOT_USER`
- `S3_SECRET_KEY` matches `MINIO_ROOT_PASSWORD`
- `S3_BUCKET` matches the bucket created by `minio-setup`

### MinIO console unavailable

The checked-in Compose file binds the console host port to localhost only.

Use:

```bash
http://localhost:8923
```

from the same host running Docker.

---

## Soft Delete Behavior

If a deleted video “disappears,” that is expected.

Current behavior:

- `POST /api/videos/:id/delete` sets `videos.deleted_at`
- deleted videos disappear from `GET /api/videos/:id/status`
- deleted videos disappear from `GET /api/library/videos`
- multipart upload routes reject soft-deleted videos

If you need to inspect deleted rows directly:

```bash
docker compose exec postgres psql -U app -d cap4 -c \
  "SELECT id, name, deleted_at FROM videos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;"
```

---

## Full Reset

For a disposable environment only:

```bash
make down
docker system prune -a
docker volume rm cap4_postgres_data cap4_minio_data
make up
make smoke
```

This deletes local database and object-storage data.
