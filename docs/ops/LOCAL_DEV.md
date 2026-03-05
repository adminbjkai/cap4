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

## 2) Start local stack

```bash
make up
```

Services:
- `postgres`
- `minio`
- `minio-setup`
- `web-api`
- `web`
- `worker`
- `media-server`

`minio-setup` applies bucket CORS from `/Users/m17/2026/gh_repo_tests/Cap_v2/docker/minio/cors.json`.

## 3) Apply migration

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
cd /Users/m17/2026/gh_repo_tests/Cap_v2
make down
make up
make reset-db
```

1. Open `http://localhost:5173`.
2. Record or upload a file on `/record`.
3. Confirm `/video/:videoId` reaches `processingPhase=complete`.
4. Confirm playback and download links work.

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
