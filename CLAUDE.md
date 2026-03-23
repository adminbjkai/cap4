# Working Memory — cap4

**Last updated:** 2026-03-23 (Cross-validated review: Claude Opus + Codex + Gemini; all fixes applied)
**Project:** cap4 — single-tenant video processing platform
**Source dir:** cap3test (virtiofs mount — cannot rename, this IS cap4)
**GitHub:** https://github.com/adminbjkai/cap4

---

## Current State

Full-app review completed 2026-03-23 (Claude Opus 4.6 + Codex GPT-5.4, independent reviews, cross-validated). 15 security/correctness bugs fixed, 19 doc alignment issues corrected across two passes. Documentation re-scanned and verified against code. Host runtime verification also completed on 2026-03-23: `pnpm typecheck`, `pnpm build`, `docker compose up -d --build`, `GET /health`, `GET /ready`, `pnpm test:integration` (18/18), and `make smoke` all passed.

**Audit:** [audit-plan.md](docs/archive/audit-plan.md) — Phases A-F complete (F6 auth + F8 a11y deferred).

**Phase 4 — Integration Tests: ✅ 18/18 passing** (7 pipeline + 11 API contract; host-verified 2026-03-23)

### 2026-03-23 Review Fixes (15 code + 7 doc)
- ✅ **SSRF protection** — webhookUrl now validated (protocol, hostname blocklist for internal services)
- ✅ **Path traversal fix** — media-server validates videoId is UUID before S3 key construction
- ✅ **Webhook rate-limit bypass** — `allowList` callback added to `@fastify/rate-limit` (was using unsupported per-route config)
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
- **Webhooks:** inbound progress webhook route exists for signed callbacks; mainline worker flow currently calls media-server synchronously via `POST /process`
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
| delivery_id | Incoming webhook delivery identifier stored on `webhook_events` and deduped by `(source, delivery_id)` |
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
