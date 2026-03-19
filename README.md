# cap4

Single-tenant video processing platform with a React watch app, Fastify API, PostgreSQL-backed job queue, background worker, FFmpeg media server, and S3-compatible object storage.

## Current Repo Status

- Upload -> process -> transcript -> AI summary flow is implemented.
- In-browser screen recording with auto-upload (recordings upload immediately after capture; file selections require manual upload).
- Web app includes custom video controls, command palette, keyboard shortcuts, transcript review, speaker diarization, and a dark/light theme.
- Full audit complete (phases A-E) — see [audit-plan.md](docs/archive/audit-plan.md). Phase 5 auth is deferred. The repo currently runs without end-user authentication.

## Services

- `apps/web` — React/Vite frontend
- `apps/web-api` — Fastify API
- `apps/worker` — queue worker for processing, transcription, and AI jobs
- `apps/media-server` — FFmpeg wrapper with webhook progress callbacks
- `packages/db` / `db/migrations` — PostgreSQL access and schema
- `packages/logger`, `packages/config` — shared packages

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Node.js 20+
- `pnpm`
- Deepgram API key
- Groq API key

### Boot the stack

```bash
cp .env.example .env
# fill in at least DEEPGRAM_API_KEY and GROQ_API_KEY

make up
make smoke
```

Open:

- App: `http://localhost:8022`
- API: `http://localhost:3000`
- MinIO API: `http://localhost:8922`
- MinIO console: `http://localhost:8923`

## Upload Flow

The API is a two-step upload flow, not a direct multipart form upload to `/api/videos`.

1. `POST /api/videos` to create the video row and upload record.
2. `POST /api/uploads/signed` or multipart upload endpoints to obtain upload URLs.
3. Upload bytes to MinIO/S3.
4. `POST /api/uploads/complete` or `POST /api/uploads/multipart/complete` to enqueue processing.
5. Poll `GET /api/videos/:id/status` or `GET /api/jobs/:id`.

Singlepart example:

```bash
VIDEO_JSON=$(curl -sS -X POST http://localhost:3000/api/videos \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-video-1" \
  -d '{"name":"Demo upload"}')

VIDEO_ID=$(printf '%s' "$VIDEO_JSON" | jq -r '.videoId')

SIGNED_JSON=$(curl -sS -X POST http://localhost:3000/api/uploads/signed \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: signed-upload-1" \
  -d "{\"videoId\":\"$VIDEO_ID\",\"contentType\":\"video/mp4\"}")

PUT_URL=$(printf '%s' "$SIGNED_JSON" | jq -r '.putUrl')

curl -X PUT "$PUT_URL" \
  -H "Content-Type: video/mp4" \
  --data-binary @sample.mp4

curl -X POST http://localhost:3000/api/uploads/complete \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: complete-upload-1" \
  -d "{\"videoId\":\"$VIDEO_ID\"}"

curl http://localhost:3000/api/videos/$VIDEO_ID/status
```

## Development Commands

```bash
make up
make down
make logs
make migrate
make reset-db
make smoke

pnpm build
pnpm test
pnpm test:integration
pnpm dev:web
pnpm dev:web-api
pnpm dev:worker
pnpm dev:media-server
```

## Documentation

- [Architecture](docs/architecture.md) — system design, state machine, services
- [API reference](docs/api.md) — endpoints and webhook contract
- [Database schema](docs/database.md) — tables, enums, migrations
- [Environment variables](docs/environment.md) — full env var reference
- [Local development](docs/local-dev.md) — Docker and no-Docker setup
- [Deployment](docs/deployment.md) — production deployment guide
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes
- [Design system](docs/design-system.md) — UI tokens and components
- [Tech stack](docs/tech-stack.md) — languages, frameworks, versions
- [AI agents](docs/agents.md) — agent roles and conventions
- [Master plan](docs/master-plan.md) — authoritative project roadmap
- [Tasks](docs/tasks.md) — current and completed work
- [QA: speaker diarization](docs/qa.md) — test plan
- [Audit plan](docs/archive/audit-plan.md) — completed audit tracker

## Known Issues

- No authentication — Phase 5 auth is deferred.
- Accessibility (aria-labels on icon buttons) is deferred.
- See [audit-plan.md](docs/archive/audit-plan.md) for the full audit history.
