# Glossary — cap4

## Project Directories

| Name | Path | Notes |
|------|------|-------|
| cap3test | `/Users/m17/2026/gh_repo_tests/cap3test` | Working source (virtiofs mount — IS cap4, can't rename) |
| cap4/ | `cap3test/cap4/` | New documentation subdirectory |
| cap4_new/ | `cap3test/../cap4_new/` | Standalone reference copy — not the working dir |
| Cap_for_reference_only | `gh_repo_tests/Cap_for_reference_only` | Original Cap open-source SaaS — DIFFERENT product |
| Cap_v2 | `gh_repo_tests/Cap_v2` | Greenfield rewrite — historical reference |
| cap3 | `gh_repo_tests/cap3` | Previous version — historical reference |

## Architecture Terms

| Term | Meaning |
|------|---------|
| web-api | Fastify HTTP service, port 3000 — all API routes |
| web | React/Vite SPA, port 5173 — browser frontend |
| worker | Node.js background service — processes jobs from PostgreSQL queue |
| media-server | FFmpeg wrapper service, port 3001 — receives job from web-api, emits progress webhooks |
| @cap/db | Shared package — `query()` and `withTransaction()` helpers |
| @cap/config | Shared package — `getEnv()` typed environment loading |
| @cap/logger | Shared package — structured Pino JSON logging |
| monolith | `apps/web-api/src/index.ts` — 2007-line file that needs splitting |

## State Machine

| Phase | Rank | Meaning |
|-------|------|---------|
| not_required | 0 | No processing needed |
| queued | 10 | Job created, waiting for worker |
| downloading | 20 | Worker downloading from MinIO |
| probing | 30 | FFprobe running |
| processing | 40 | FFmpeg encoding |
| uploading | 50 | Uploading result to MinIO |
| generating_thumbnail | 60 | Creating thumbnail |
| complete | 70 | Terminal — success |
| failed | 80 | Terminal — encoding error |
| cancelled | 90 | Terminal — user cancelled |

## Job Types

| Type | Triggered By | Does |
|------|-------------|------|
| process_video | upload complete | Dispatches to media-server for FFmpeg |
| transcribe_video | process_video success | Calls Deepgram, stores transcript_text |
| generate_ai | transcribe_video success | Calls Groq for title/summary/chapters |
| cleanup_artifacts | generate_ai success | Removes temp files from MinIO |

## Key Concepts

| Term | Meaning |
|------|---------|
| phase_rank | Integer enforcing monotonic state transitions — can only go forward |
| SKIP LOCKED | PostgreSQL `FOR UPDATE SKIP LOCKED` — lock-free concurrent job claiming |
| delivery_id | x-cap-delivery-id header — idempotency key for webhook_deliveries table |
| progress_bucket | Column on webhook_deliveries — deduplicates progress updates per 10% bucket |
| HMAC | webhook signature: `HMAC-SHA256(secret, timestamp + "." + body)` |
| skew | Max allowed age of webhook timestamp — default ±5 minutes |
| idempotency key | x-idempotency-key header required on all POST mutations — 24h TTL |
| DOC-001-005 | Five critical API doc errors fixed in cap4/docs/api/ENDPOINTS.md |

## People

| Name | Role |
|------|------|
| Murry | Owner, sole developer |
| Kimi | Previous AI agent — worked on cap3/cap3test, left .audit/ artifacts |

## Things to Ignore

| File/Dir | Why |
|----------|-----|
| `.audit/` | Kimi's operational audit infrastructure — not product code |
| `AGENTS.md` | Kimi's audit config |
| `bykimi.md` | Kimi's 589-line audit spec |
| `Cap3 › All issues.csv` | Old Linear export |
| `Cap_for_reference_only/` | Different product entirely (multi-tenant SaaS) |
