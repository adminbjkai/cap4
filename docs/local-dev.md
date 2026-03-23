---
title: "Local Development"
description: "Docker and no-Docker setup for local development"
---

# Local Development

Two ways to run cap4 locally. **Docker (recommended)** is the fastest path and
mirrors production exactly. **Local (no Docker)** is useful for rapid iteration
on individual services.

---

## Option A — Docker (Recommended)

### Requirements

- Docker Desktop (or Engine + Compose v2)
- Node 20+ and pnpm (for running tests and the Vite dev server)
- A Deepgram API key and a Groq API key

### Quick Start

```bash
# 1. Clone and enter the repo
git clone https://github.com/adminbjkai/cap4
cd cap4

# 2. Create your .env from the example
cp .env.example .env
# Edit .env — set DEEPGRAM_API_KEY and GROQ_API_KEY at minimum.

# 3. Start everything (build + migrate + launch)
make up
# or: docker compose up -d --build

# 4. Open the app
open http://localhost:8022
```

**Migrations run automatically.** On every `docker compose up`, the `migrate`
service applies any pending SQL files from `db/migrations/` using
`docker/postgres/run-migrations.sh`. No manual `psql` commands are ever needed.

### Services & Ports

| Service           | Host URL              | Purpose                      |
| ----------------- | --------------------- | ---------------------------- |
| **web (nginx)**   | http://localhost:8022 | React frontend + MinIO proxy |
| **web-api**       | http://localhost:3000 | Fastify HTTP API             |
| **media-server**  | http://localhost:3100 | FFmpeg processing            |
| **postgres**      | localhost:5432        | Database                     |
| **minio API**     | http://localhost:8922 | S3-compatible object storage |
| **minio console** | http://localhost:8923 | MinIO admin UI               |

MinIO default credentials (from `.env.example`): `minio` / `minio123`

### Resetting Everything

```bash
# Wipe all data and restart fresh — migrations auto-run on startup
make reset-db
# or: docker compose down -v && docker compose up -d --build
```

### Running Just the Frontend in Dev Mode (Hot Reload)

```bash
# 1. Start the Docker backend (API + worker + DB + MinIO)
make up

# 2. Start the Vite dev server for hot-reload
pnpm dev:web
# Opens at http://localhost:5173

# The Vite proxy routes:
#   /api     → http://localhost:3000
#   /health  → http://localhost:3000
#   /cap4    → http://localhost:9000  (for local MinIO dev)
#
# When using Docker infrastructure (MinIO mapped to :8922), add to .env:
#   VITE_S3_PUBLIC_ENDPOINT=http://localhost:8922
```

### Common Commands

```bash
make up          # Build + start all services (migrations auto-apply)
make down        # Stop services (data preserved)
make reset-db    # Wipe all data + restart (migrations auto-apply)
make migrate     # Re-run migration runner on an already-running stack
make logs        # Follow all service logs
make smoke       # Run smoke test against running stack
pnpm test:integration  # Full integration test suite (requires running stack)
```

---

## Option B — Local (No Docker)

Run every service as a native process. Useful for rapid backend iteration
without Docker rebuild cycles.

### Requirements

- Node 20+ and pnpm
- PostgreSQL 15+ running on localhost:5432
- MinIO running on localhost:9000
- ffmpeg

### One-Time Infrastructure Setup

**PostgreSQL (macOS with Homebrew):**

```bash
brew install postgresql@16
brew services start postgresql@16
createdb cap4
psql cap4 -c "CREATE USER app WITH PASSWORD 'app';"
psql cap4 -c "GRANT ALL PRIVILEGES ON DATABASE cap4 TO app;"
```

**PostgreSQL (Ubuntu/Debian):**

```bash
apt-get install postgresql
sudo -u postgres createuser app --pwprompt   # use "app" as password
sudo -u postgres createdb cap4 --owner=app
```

**MinIO (macOS):**

```bash
brew install minio/stable/minio
minio server ~/minio-data --address ":9000" --console-address ":9001" &
# Create bucket
brew install minio/stable/mc
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/cap4
mc anonymous set public local/cap4
```

**MinIO (Linux — binary):**

```bash
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
./minio server ~/minio-data --address ":9000" --console-address ":9001" &
```

**ffmpeg:**

```bash
brew install ffmpeg      # macOS
apt-get install ffmpeg   # Ubuntu/Debian
```

### Apply Migrations (One-Time, and After Each New Migration File)

```bash
for f in db/migrations/*.sql; do
  psql -U app -d cap4 -f "$f"
done
```

Current migration set:

- `0001_init.sql`
- `0002_video_soft_delete.sql`
- `0003_add_webhook_reporting.sql`
- `0004_fix_transcript_language.sql`
- `0005_add_ai_enrichment_fields.sql`
- `0006_add_transcript_speaker_labels.sql`

### Environment File for Local Dev

```bash
cp .env.example .env
```

Then update `.env` to point to `localhost` instead of Docker service names:

```bash
# Override for local (no Docker)
DATABASE_URL=postgres://app:app@localhost:5432/cap4
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
MEDIA_SERVER_BASE_URL=http://localhost:3100

# MinIO credentials (match your local MinIO setup)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin

# Real API keys required
DEEPGRAM_API_KEY=<your key>
GROQ_API_KEY=<your key>
```

### Start All Services

```bash
# Convenience script (starts all 4 services concurrently)
./scripts/dev-local.sh

# Or start each service in a separate terminal:
pnpm dev:web-api        # terminal 1 — Fastify API on :3000
pnpm dev:worker         # terminal 2 — background job worker
pnpm dev:media-server   # terminal 3 — FFmpeg service on :3100
pnpm dev:web            # terminal 4 — Vite dev server on :5173
```

Open the app at `http://localhost:5173`.

---

## URL Routing — How the Frontend Accesses MinIO

Understanding where video files are loaded from:

| Runtime                                                               | URL pattern                              | Resolved by                                                |
| --------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| **Docker via nginx**                                                  | `/cap4/videos/.../result.mp4` (relative) | nginx proxies `/cap4/` → MinIO (internal :9000)            |
| **Docker Vite dev** + `VITE_S3_PUBLIC_ENDPOINT=http://localhost:8922` | `http://localhost:8922/cap4/...`         | Browser → MinIO directly at host port 8922                 |
| **Local (no Docker) Vite dev**                                        | `/cap4/videos/.../result.mp4` (relative) | Vite dev server proxies `/cap4/` → `http://localhost:9000` |

`buildPublicObjectUrl(key)` in `apps/web/src/lib/format.ts` reads
`VITE_S3_PUBLIC_ENDPOINT` at build time. If unset, it falls back to a relative
path — the correct default for both Docker nginx and local Vite dev.

---

## Running Tests

```bash
# Unit tests (no Docker required)
pnpm test

# Integration tests (Docker stack must be running + real API keys set)
make up
pnpm test:integration
# or: pnpm --filter @cap/web-api test:integration
```

Integration tests run the real upload → transcode → transcribe → AI pipeline
end-to-end. Expect 2–5 minutes.

---

## Database Access

```bash
# Docker
docker compose exec postgres psql -U app -d cap4

# Local
psql -U app -d cap4
```

Useful queries:

```sql
-- All videos
SELECT id, processing_phase, created_at FROM videos ORDER BY created_at DESC;

-- Pending jobs
SELECT id, job_type, status, attempts FROM job_queue WHERE status = 'queued';

-- Recent failures
SELECT id, job_type, error_message, updated_at FROM job_queue
WHERE status = 'dead' ORDER BY updated_at DESC LIMIT 10;

-- Applied migrations
SELECT version, applied_at FROM schema_migrations ORDER BY version;
```

---

## Troubleshooting

### Port already in use

```bash
lsof -i :3000   # web-api
lsof -i :8022   # nginx
lsof -i :8922   # MinIO
```

### `relation "..." does not exist` (empty database)

- **Docker:** `make reset-db` — migrations auto-apply on startup
- **Local:** Run the migration SQL files manually (see above)

### Presigned upload fails

`S3_PUBLIC_ENDPOINT` must be browser-accessible (not a Docker service name):

- Docker: `http://localhost:8922`
- Local: `http://localhost:9000`

### Worker not processing jobs

```bash
docker compose logs worker      # Docker
# or check the terminal running pnpm dev:worker
```

Confirm `DATABASE_URL` and MinIO credentials are correct in `.env`.

See [troubleshooting.md](troubleshooting.md) for more common fixes.
