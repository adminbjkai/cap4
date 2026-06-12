# Working Memory — cap4

**Last updated:** 2026-06-05 (Phase 4.8: library list/table view + original file date; rail-tab crossfade fix — live)
**Project:** cap4 — single-tenant video processing platform
**Source dir:** cap3test (virtiofs mount — cannot rename, this IS cap4)
**GitHub:** https://github.com/adminbjkai/cap4

> **Deploy note (2026-06-05):** the live stack's containers have no outbound
> network, so images cannot be rebuilt with `docker compose build`. Frontend is
> built on the host (`pnpm --filter @cap/web build`) and copied into the
> `cap4_web_dist` volume (then `nginx -s reload` on `cap4-web-internal-1`).
> Backend route changes are compiled on the host and hot-swapped into
> `cap4-web-api-1` via `docker cp` + `docker restart`. See the
> `frontend-deploy-mechanism` memory.

---

## Current State

### 2026-06-11 — Collapsed doc pipeline (branch `feat/collapsed-doc-pipeline`, NOT deployed)
- **New opt-in feature, purely additive** — turns a recording into a structured
  how-to doc (runbook/tutorial/SOP) with frame screenshots. Nothing in the
  existing pipeline changed: Groq summary/chapters/title, Deepgram
  transcription/diarization, speaker editing, transcript download all work
  exactly as before on their existing API keys.
- **All LLM calls via headless Claude Code** (`claude -p`, OAuth subscription —
  no ANTHROPIC_API_KEY, no SDK). `DocModelClient` in
  `apps/worker/src/doc/model-client.ts`: claude-cli backend (JSON parse,
  zod validation, retry-once, timeout, stderr capture) + anthropic-api stub.
  Credit protection: result cache (`doc_model_cache`, SHA-256 of
  transcript+manifest+prompt version+model) and call guards
  (`DOC_MAX_MODEL_CALLS_PER_JOB`=6, `DOC_MAX_MODEL_CALLS_PER_DAY`=60).
  Models via `DOC_MODEL_STRONG` / `DOC_MODEL_TRIAGE` env (never hardcoded).
- **Stages** (single `generate_doc` worker job, triggered only by
  `POST /api/videos/:id/generate-doc`): A) ffmpeg scene detect → 50-150
  deduped 768px frames + chapter boundaries (no LLM); B) triage
  caption/classify with pass-through fallback; C) one strong-model doc pass
  (per-chapter >25 min + merge); D) frame-ref validation (retry once on
  hallucinated refs, then drop-with-note), ffmpeg crops, markdown render,
  persist to `documents`/`doc_sections`/`doc_steps`/`frames` (migration 0008,
  not yet applied to live DB). Read via `GET /api/videos/:id/doc`.
- **Deploy constraint**: worker needs the `claude` CLI + login → host-run
  worker only (containers have no network/CLI). See docs/PIPELINE_V2.md.
- Tests: worker 51/51 (was 8), workspace 81 passing vs 38 baseline; live smoke
  (`DOC_LIVE_SMOKE=1`) verified once for real. Docs: docs/AUDIT.md,
  docs/PIPELINE_V2.md, DECISIONS.md.

### 2026-06-10 — Transcode timeout fix + lightweight status polling (live)
- **Transcode timeout fixed** — worker's media-server `POST /process` call now uses new
  `MEDIA_PROCESS_TIMEOUT_MS` config (default 30 min) instead of `PROVIDER_TIMEOUT_MS`
  (45 s), which aborted any long non-remuxable transcode (a 1h49m VP9 upload was stuck
  "downloading 20%" with transcript complete). Media-server work dir is now per-attempt
  (`/tmp/cap4-media/<videoId>-<uuid>`) so overlapping retries can't delete each other's
  files. Closes the "worker transcode timeout" open audit finding.
- **Transcription hardened** — new `TRANSCRIBE_TIMEOUT_MS` (default 10 min) for the
  Deepgram call (was the shared 45 s `PROVIDER_TIMEOUT_MS`, which aborted ~2 h files).
  `transcribe_video` now defers (new `snooze()` — requeue without consuming an attempt)
  while a `process_video` job for the same video is active, so the ffmpeg transcode no
  longer starves the Deepgram upload of CPU/bandwidth.
- **Compact transcription uploads** — worker streams the source to a temp file (never
  buffers GBs in RAM) and sends only the extracted mp3 audio track to Deepgram
  (~20-50x smaller upload); falls back to the original media if ffmpeg extraction fails.
- **Async media-server** — `POST /process` replies 202 immediately; the pipeline runs in
  the background and reports `probing`/`processing`/`uploading`/`complete`/`failed` via
  signed webhooks to web-api's `/api/webhooks/media-server/progress`, which now also
  persists `result_key`/`thumbnail_key`/`error_message` and owns downstream orchestration
  (queue transcription, or `no_audio`/`skipped`). The worker acks `process_video` at
  handoff; a maintenance watchdog fails videos stuck at rank 20-60 past
  `MEDIA_PROCESS_TIMEOUT_MS` with no active process job. Real per-phase progress now
  reaches the UI during transcode. Media-server retries the whole pipeline internally
  (3 attempts) before sending `failed`, replacing the queue-level retries the sync flow
  had. `/debug/smoke` updated to poll for terminal phase instead of expecting a sync
  result. E2E-verified live: happy path (VP9 upload → complete, all jobs attempt 1,
  full webhook trail) and failure path (missing S3 key → terminal `failed` + Retry works).
- **Status polling slimmed** — `GET /api/videos/:id/status?view=summary` returns the
  status fields without transcript segments / AI output (~0.5 KB vs ~292 KB). VideoPage
  polls the summary and refetches the full payload only when `transcriptionStatus` /
  `aiStatus` change. Polling still stops at terminal state.
- Deployed via hot-swap (worker, media-server, web-api videos route) + frontend volume
  copy; stuck video d1b084cd reprocessed successfully end-to-end. Web tests 30/30.

### 2026-06-05 — Phase 4.8 (live)
- **Rail-tab crossfade fix** — VideoPage tab transition no longer leaves the previous
  panel stuck as an absolute overlay under `prefers-reduced-motion` (effect timer race
  fixed + reduced-motion CSS hides `.rail-tab-panel-exit`).
- **Original file date** — `videos.original_file_created_at` (migration `0007`), captured
  from the browser `File.lastModified` on upload, surfaced as `originalFileCreatedAt` in
  `POST /api/videos` and `GET /api/library/videos`. Distinct from `created_at` (cap4 upload time).
- **Library list/table view** — homepage has a grid⇄list toggle (persisted in
  `localStorage:cap4:libraryView`). List view: EST date+time columns
  (**Uploaded (EST)** = `createdAt`, **File created (EST)** = `originalFileCreatedAt`),
  show/hide + drag-reorder columns (persisted `cap4:libraryColumns`), global + per-column
  filtering with clear-all, click-to-sort headers, and an inline-editable per-row **Note**
  (persisted `cap4:notes:<videoId>`, shared with the video page Notes tab). Frontend-only
  (no backend changes). Note: `File created` is blank for screen recordings / pre-`0007`
  rows — only file uploads populate it (from `File.lastModified`).
- Web test suite 30/30 (rail-tab + library-list: column hide, per-column filter/clear,
  note edit). Migration 0007 applied to live DB; web-api hot-swapped; frontend redeployed
  (twice); verified end-to-end.



Full-app review completed 2026-03-23 (Claude Opus 4.6 + Codex GPT-5.4, independent reviews, cross-validated). 15 security/correctness bugs fixed, 19 doc alignment issues corrected across two passes. Documentation re-scanned and verified against code. Host runtime verification also completed on 2026-03-23: `pnpm typecheck`, `pnpm build`, `docker compose up -d --build`, `GET /health`, `GET /ready`, `pnpm test:integration` (18/18), and `make smoke` all passed.

**Audit:** [audit-plan.md](docs/archive/audit-plan.md) — Phases A-F complete (F6 auth + F8 a11y deferred).

**Phase 4 — Integration Tests: ✅ 18/18 passing** (7 pipeline + 11 API contract; host-verified 2026-03-23)

### 2026-03-23 Review Fixes (15 code + 7 doc)
- ✅ **SSRF protection** — webhookUrl now validated (protocol, hostname blocklist for internal services)
- ✅ **Path traversal fix** — media-server validates videoId is UUID before S3 key construction
- ✅ **Webhook rate-limit bypass** — skip callback added to @fastify/rate-limit (was using unsupported per-route config)
- ✅ **Webhook secret hardened** — MEDIA_SERVER_WEBHOOK_SECRET now requires `.min(32)` (was `.min(1)`)
- ✅ **Webhook timestamp default** — WEBHOOK_MAX_SKEW_SECONDS now defaults to 300s (was NaN on missing env var)
- ✅ **Migration runner SQL injection** — version now uses dollar-quoting in psql INSERT
- ✅ **MinIO console** — port 8923 bound to 127.0.0.1 only
- ✅ **Unacked worker jobs** — skip paths in handleTranscribeVideo now call ack() before return
- ✅ **Webhook dedupe** — catches second unique constraint violation (source, job_id, phase, progress_bucket)
- ✅ **Webhook job queue** — deliver_webhook INSERT now has ON CONFLICT handling
- ✅ **Title handling** — /status now returns `v.name`; watch-edits falls back to `videos.name` when no ai_outputs row
- ✅ **Provider status** — deriveProviderHealthState returns `"idle"` (was `"ready"`, frontend mismatch)
- ✅ **Multipart soft-delete** — presign-part, complete, abort now JOIN videos and check deleted_at IS NULL
- ✅ **Groq chunk errors** — logged per-chunk failures, abort if >30% fail
- ✅ **DB pool config** — Pool now has max:20, idleTimeoutMillis:30000, connectionTimeoutMillis:5000
- ✅ **7 doc fixes** — master-plan Fastify version, deployment npm→pnpm, stale endpoints, media-server description, queue status enums

### Earlier Post-Audit Fixes
- ✅ **Deepgram diarization** — added `diarize=true` to Deepgram API call so multi-speaker videos get proper speaker labels
- ✅ **Multipart upload S3 client** — `complete` and `abort` endpoints now use internal S3 endpoint (was using public endpoint, causing ECONNREFUSED in Docker)
- ✅ **Presign-part idempotency** — frontend now sends `Idempotency-Key` header on `presign-part` requests (required after Phase F hardening)
- ✅ **Auto-upload recordings** — RecordPage auto-uploads immediately after capture; file selections still require manual "Upload and process"
- ✅ **Fullscreen video fix** — fullscreen now targets the container holding both `<video>` and controls overlay (was only fullscreening the controls div, leaving video behind)

### Latest Changes (Phase 4.7 — Agent Sprint: BJK-9 through BJK-18)
- ✅ **BJK-9** — micro-interaction animations added (page transitions, card motion, dialog backdrop)
- ✅ **BJK-10** — color system redesign and enhanced dark mode tokenization
- ✅ **BJK-11** — custom video controls shipped (play/pause, seek, volume, rate, PiP, fullscreen)
- ✅ **BJK-12** — library grid redesign with rich media cards and polished hover/processing states
- ✅ **BJK-13** — keyboard shortcuts + command palette (`Cmd+K` / `Ctrl+K`) and shortcuts overlay
- ✅ **BJK-14** — speaker diarization UI (badges, editable labels, filters) + API support for `speakerLabels`
- ✅ **BJK-15** — transcript confidence highlighting and uncertain-segment review workflow
- ✅ **BJK-16** — Groq enrichment upgrade: entities, action items, quotes + schema validation (chapter sentiment parsed but not yet persisted)
- ✅ **BJK-17** — transcript full-text search with highlighting + keyboard match navigation
- ✅ **BJK-18** — sage green theme pass, true-dark surfaces, delete button fix, summary strip between player and chapters

### Earlier Changes (Phase 4.5 — Docker & Config Audit)
- ✅ **Auto-migrations** — `migrate` service in docker-compose applies all pending SQL on startup
- ✅ `docker/postgres/run-migrations.sh` — migration runner with `schema_migrations` tracking table
- ✅ **Makefile** — `reset-db` = `down -v + up`; `migrate` target added
- ✅ **package.json** — `migrate` + `reset-db` scripts updated
- ✅ **`.env.example`** — comprehensive comments; `VITE_S3_PUBLIC_ENDPOINT` section documented
- ✅ **LOCAL_DEV.md** — full rewrite: Docker + no-Docker, port table, URL routing explanation
- ✅ **`scripts/dev-local.sh`** — run all 4 services without Docker

### Earlier Changes (Phase 4 + 4.5 branding)
- ✅ apps/web/index.html: title cap3 → cap4
- ✅ docker-compose.yml: container names cap3-* → cap4-* (commented)
- ✅ Integration test suite: 18/18 passing — full upload → transcribe → AI → complete pipeline (host-verified 2026-03-23)
- ✅ transcript.language defaulted to 'en' at 3 layers
- ✅ Migration 0004: backfills NULL language → 'en', adds NOT NULL DEFAULT 'en'

---

## Key Files

### Documentation (`docs/`)

| File | Purpose |
|------|---------|
| `README.md` | Clean project overview |
| `CONTRIBUTING.md` | Dev workflow and contribution guide |
| `docs/architecture.md` | State machine, job queue, services |
| `docs/api.md` | Full API reference + webhook contract |
| `docs/database.md` | Schema reference + migrations |
| `docs/environment.md` | Environment variable reference |
| `docs/local-dev.md` | Local dev setup (Docker + no-Docker) |
| `docs/deployment.md` | Production deployment guide |
| `docs/troubleshooting.md` | Common issues + fixes |
| `docs/design-system.md` | UI tokens and component guide |
| `docs/tech-stack.md` | Languages, frameworks, versions |
| `docs/agents.md` | AI agent roles and conventions |
| `docs/master-plan.md` | Authoritative plan — start here |
| `docs/tasks.md` | Current and completed work |
| `docs/qa.md` | Speaker diarization test plan |
| `docs/archive/audit-plan.md` | Completed audit tracker (phases A-F) |
| `docs/archive/roadmap.md` | Archived cap3 roadmap |

### Code

| File | Purpose |
|------|---------|
| `apps/web/src/components/CommandPalette.tsx` | Command palette modal with keyboard navigation |
| `apps/web/src/components/CustomVideoControls.tsx` | Custom player chrome and transport controls |
| `apps/web/src/components/ShortcutsOverlay.tsx` | In-app keyboard shortcut reference modal |
| `apps/web/src/hooks/useKeyboardShortcuts.ts` | Shared keyboard shortcut registration logic |
| `db/migrations/0005_add_ai_enrichment_fields.sql` | Adds AI enrichment columns: entities/action items/quotes |
| `db/migrations/0006_add_transcript_speaker_labels.sql` | Adds transcript speaker label storage column |
| `db/migrations/0007_add_original_file_created_at.sql` | Adds `videos.original_file_created_at` (source file's own date) |
| `apps/web/src/pages/HomePage.tsx` | Library grid + sortable/searchable list/table view + view toggle |
| `docker/postgres/run-migrations.sh` | Migration runner script |
| `scripts/dev-local.sh` | Run all services without Docker |
| `apps/web-api/src/index.ts` | Fastify entry — rate limiting + route modules |
| `apps/web/src/` | React/Vite frontend |

---

## Architecture in 30 Seconds

- **9 Docker services:** postgres + migrate (auto-runs SQL) + minio + minio-setup + web-api + worker + media-server + web-builder + web-internal (nginx)
- **Migrations:** `migrate` service uses `schema_migrations` table to track applied migrations; runs on every `docker compose up`
- **Job queue:** PostgreSQL `FOR UPDATE SKIP LOCKED` — no Redis
- **State machine:** Monotonic `processing_phase_rank`, terminal states: `complete`, `failed`, `cancelled`
- **Webhooks:** mainline flow — worker POSTs `/process`, media-server replies 202 and reports phases/completion/failure via signed webhooks to web-api, which owns finalize (result keys, queue transcription, no_audio). Worker watchdog fails videos stuck mid-processing past `MEDIA_PROCESS_TIMEOUT_MS`
- **AI:** Deepgram (transcription) + Groq (title/summary/chapters)
- **URL routing:** Frontend uses relative `/cap4/...` paths → nginx proxies to MinIO (Docker); Vite dev server proxies to `localhost:9000` (local dev)

---

## URL Configuration Notes

| Env var | Used by | Purpose |
|---------|---------|---------|
| `S3_ENDPOINT` | Backend (server→MinIO) | Internal Docker URL: `http://minio:9000` |
| `S3_PUBLIC_ENDPOINT` | Backend (presigned PUT URLs + dev UI) | Browser-accessible: `http://localhost:8922` |
| `VITE_S3_PUBLIC_ENDPOINT` | Frontend (build-time) | Leave unset for Docker nginx (uses relative path); set to `http://localhost:8922` for Vite dev + Docker infra |

---

## Glossary

| Term | Meaning |
|------|---------|
| cap3test | The working source directory (virtiofs mount — IS cap4) |
| cap4 | The project name |
| monolith | Was `apps/web-api/src/index.ts` (2007 lines) — now split into route modules ✓ |
| Phase 1 | API split + GitHub repo creation ✓ |
| Phase 2 | Player UI (ChapterList, TranscriptParagraph, lg breakpoint) ✓ |
| Phase 3 | Hardening (rate limiting, nginx, fastify v5, key log audit) ✓ |
| Phase 4 | Integration tests — 18/18 passing (host-verified 2026-03-23) |
| Phase 4.5 | Docker/config audit — auto-migrations, local dev docs ✓ |
| command palette | Global quick-action and navigation modal opened via `Cmd+K` / `Ctrl+K` |
| speaker diarization | Per-segment speaker attribution with editable display labels |
| confidence review | Transcript mode focused on low-confidence segments for verification |
| custom controls | App-rendered video controls replacing native browser video chrome |
| sage green theme | Muted green accent system replacing prior blue-heavy palette |
| Phase 5 | Auth — single-user JWT/session (deferred by owner; out of scope) |
| schema_migrations | Table tracking which SQL migrations have been applied |
| migrate service | Docker Compose service that auto-runs migrations on startup |
| progress_bucket | Webhook dedup column — prevents duplicate 10%-bucket updates |
| delivery_id | Webhook idempotency key stored in the webhook_events table |
| phase_rank | Integer enforcing monotonic state transitions |
| SKIP LOCKED | PostgreSQL clause for lock-free concurrent job claiming |
| audit-plan.md | Completed audit doc at `docs/archive/audit-plan.md` (6 phases A-F) |
| unacked skip | Worker bug: handler returns without calling ack(), job retries forever |
| job_status enum | `queued \| leased \| running \| succeeded \| cancelled \| dead` — no `'failed'` |

---

## People / Context

- **Murry** — owner, sole developer

---

## What to Ignore

Nothing left to ignore — repository is clean. `.gitignore` covers all dev artifacts.
