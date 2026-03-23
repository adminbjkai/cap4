---
title: "Environment Variables"
description: "Complete reference for all cap4 environment variables"
---

# Environment Variables Reference

Complete reference for all cap4 environment variables.

---

## Quick Comparison: Docker vs Local Dev

| Variable | Docker full-stack | Local (no Docker) |
|----------|------------------|-------------------|
| `DATABASE_URL` | `postgres://app:app@postgres:5432/cap4` | `postgres://app:app@localhost:5432/cap4` |
| `S3_ENDPOINT` | `http://minio:9000` | `http://localhost:9000` |
| `S3_PUBLIC_ENDPOINT` | `http://localhost:8922` | `http://localhost:9000` |
| `MEDIA_SERVER_BASE_URL` | `http://media-server:3100` | `http://localhost:3100` |
| `VITE_S3_PUBLIC_ENDPOINT` | *(leave unset)* | *(leave unset)* |

See `.env.example` for a ready-to-copy starting point.

---

## Variable Reference

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Node.js environment. Set to `production` in Docker. |
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |

---

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | — | PostgreSQL superuser name. Used by the `postgres` and `migrate` services. |
| `POSTGRES_PASSWORD` | — | PostgreSQL superuser password. **No default — must be set.** |
| `POSTGRES_DB` | `cap4` | Database name to create on first run. |
| `POSTGRES_PORT` | `5432` | Host port that PostgreSQL is mapped to. |
| `DATABASE_URL` | — | Full connection string used by web-api, worker, and the migrate runner. Must match `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`. |

**Docker:**
```
DATABASE_URL=postgres://app:app@postgres:5432/cap4
```
The hostname `postgres` is the Docker service name.

**Local:**
```
DATABASE_URL=postgres://app:app@localhost:5432/cap4
```

**Migrations** run automatically via the `migrate` Docker service on every
`docker compose up`. For local dev, run the SQL files manually once (see
`docs/local-dev.md`).

`POSTGRES_*` values are used by the Compose-managed PostgreSQL and migrate
containers. The application processes themselves use `DATABASE_URL`.

---

### Object Storage (MinIO / S3)

Two separate endpoint variables serve different purposes:

| Variable | Purpose |
|----------|---------|
| `S3_ENDPOINT` | Backend → MinIO. Used for internal server-to-server operations (worker encoding, media-server uploads). Must be reachable from inside the Docker network. |
| `S3_PUBLIC_ENDPOINT` | Browser-accessible URL. Used when generating presigned PUT upload URLs and in the dev UI result links. Must be reachable from the browser. |

The current repo expects S3-compatible configuration through the `S3_*` variables above. There is no separate `AWS_*` environment contract in the application code.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_ENDPOINT` | — | Internal MinIO URL. Docker: `http://minio:9000`. Local: `http://localhost:9000`. |
| `S3_PUBLIC_ENDPOINT` | `http://localhost:9000` | External/browser MinIO URL. Docker: `http://localhost:8922`. Local: `http://localhost:9000`. |
| `S3_REGION` | `us-east-1` | AWS region string (MinIO ignores it but the SDK requires it). |
| `S3_ACCESS_KEY` | — | MinIO access key. Matches `MINIO_ROOT_USER`. |
| `S3_SECRET_KEY` | — | MinIO secret key. Matches `MINIO_ROOT_PASSWORD`. |
| `S3_BUCKET` | `cap4` | S3 bucket name. Created automatically by the `minio-setup` service. |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO path-style access (e.g. `http://host/bucket/key`). |
| `MINIO_ROOT_USER` | — | MinIO root username. Must match `S3_ACCESS_KEY`. |
| `MINIO_ROOT_PASSWORD` | — | MinIO root password. Must match `S3_SECRET_KEY`. |
| `MINIO_PORT` | `8922` | Host port that MinIO API is mapped to. |
| `MINIO_CONSOLE_PORT` | `8923` | Host port that MinIO console is mapped to. |

In the checked-in Compose stack, the MinIO console host port is bound to `127.0.0.1` only.

**Why two endpoints?**

MinIO inside Docker is reachable at `http://minio:9000` (internal network
hostname). From the browser on the host machine, that hostname doesn't resolve —
you reach MinIO at `http://localhost:8922` (mapped host port). Presigned upload
URLs must contain a browser-reachable URL, so `S3_PUBLIC_ENDPOINT` is what ends
up in the URL the browser PUTs to.

---

### Frontend Vite Variables (`VITE_` prefix)

Vite strips all env vars except those prefixed with `VITE_` before baking them
into the frontend bundle at build time. These are **only** for the React app.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_S3_PUBLIC_ENDPOINT` | *(unset)* | When unset, the frontend constructs relative paths (`/cap4/...`) which nginx proxies to MinIO — the correct behavior for Docker. Set to `http://localhost:8922` only when running `pnpm dev:web` against Docker infrastructure. |
| `VITE_S3_BUCKET` | `cap4` | S3 bucket name baked into frontend bundle. Leave unset unless you've changed `S3_BUCKET`. |

**For Docker builds:** Do **not** set `VITE_S3_PUBLIC_ENDPOINT`. The frontend
will use relative paths and nginx handles routing to MinIO.

**For `pnpm dev:web` with Docker infra:** Set
`VITE_S3_PUBLIC_ENDPOINT=http://localhost:8922` in your local `.env`. Without
this, the Vite proxy routes `/cap4/` to `http://localhost:9000` (which
won't match Docker's MinIO port mapping).

---

### Service Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_API_PORT` | `3000` | Host port for the web-api service. |
| `MEDIA_SERVER_PORT` | `3100` | Host port for the media-server service. |

---

### Internal Service URLs

These are **Docker service name** URLs — they resolve inside the Docker network
but not from your browser or local machine.

| Variable | Default (Docker) | Local override |
|----------|-----------------|----------------|
| `MEDIA_SERVER_BASE_URL` | `http://media-server:3100` | `http://localhost:3100` |

`MEDIA_SERVER_BASE_URL` is used by the main worker flow and the debug/system route to call `POST /process` on the media-server.

Do not set `WEB_API_BASE_URL`. It is not part of the current config schema.

---

### Webhook Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `MEDIA_SERVER_WEBHOOK_SECRET` | *(no default — must set)* | HMAC-SHA256 shared secret. **Must be at least 32 characters.** Generate with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. Change before deploying. |
| `WEBHOOK_MAX_SKEW_SECONDS` | `300` | Maximum age (in seconds) of an accepted webhook timestamp. Prevents replay attacks. |

---

### AI Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `DEEPGRAM_API_KEY` | — | Deepgram API key for audio transcription. **Required for transcription to work.** |
| `GROQ_API_KEY` | — | Groq API key for AI title/summary/chapter generation. **Required for AI to work.** |
| `DEEPGRAM_MODEL` | `nova-2` | Deepgram speech model. `nova-2` is recommended. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq language model. |
| `DEEPGRAM_BASE_URL` | `https://api.deepgram.com` | Deepgram API base URL. Override only for testing. |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq API base URL. Override only for testing. |
| `PROVIDER_TIMEOUT_MS` | `45000` | Timeout in ms for AI provider HTTP calls. |

---

### Worker Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_ID` | `worker-1` | Unique identifier for this worker instance. Used in job lock ownership. |
| `WORKER_CLAIM_BATCH_SIZE` | `5` | How many jobs to claim per polling cycle. |
| `WORKER_LEASE_SECONDS` | `60` | Job lease duration. Worker must renew or the job can be reclaimed. |
| `WORKER_POLL_MS` | `2000` | How often the worker polls for new jobs (milliseconds). |
| `WORKER_HEARTBEAT_MS` | `15000` | How often the worker renews active job leases. |
| `WORKER_RECLAIM_MS` | `10000` | How often the worker scans for expired leases to reclaim. |
| `WORKER_MAX_ATTEMPTS` | `6` | Maximum retries before a job is marked `dead`. |

---

## Example Configurations

### Docker Full-Stack (`.env`)

```bash
NODE_ENV=development
LOG_LEVEL=info

POSTGRES_USER=app
POSTGRES_PASSWORD=app
POSTGRES_DB=cap4
DATABASE_URL=postgres://app:app@postgres:5432/cap4

S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://localhost:8922
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123
S3_BUCKET=cap4
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=minio123
MINIO_PORT=8922

MEDIA_SERVER_BASE_URL=http://media-server:3100

DEEPGRAM_API_KEY=<your_key>
GROQ_API_KEY=<your_key>

MEDIA_SERVER_WEBHOOK_SECRET=change-this-to-a-secret-of-32-plus-chars
```

### Local Dev Without Docker (`.env`)

```bash
NODE_ENV=development
LOG_LEVEL=info

POSTGRES_USER=app
POSTGRES_PASSWORD=app
POSTGRES_DB=cap4
DATABASE_URL=postgres://app:app@localhost:5432/cap4

S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=cap4
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

MEDIA_SERVER_BASE_URL=http://localhost:3100

DEEPGRAM_API_KEY=<your_key>
GROQ_API_KEY=<your_key>

MEDIA_SERVER_WEBHOOK_SECRET=dev-only-secret-that-is-32-plus-chars-long
```

### Mixed (Docker infra + local Vite dev server)

Same as Docker full-stack, plus:

```bash
VITE_S3_PUBLIC_ENDPOINT=http://localhost:8922
```

This makes the frontend construct absolute MinIO URLs (`http://localhost:8922/cap4/...`)
instead of relative paths, so playback and asset links work when the app is
served at `http://localhost:5173` (Vite) rather than `http://localhost:8022` (nginx).
