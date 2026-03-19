# Working Memory — cap4

**Last updated:** 2026-03-19 (Full audit complete — fix plan active)
**Project:** cap4 — single-tenant video processing platform
**Source dir:** cap3test (virtiofs mount — cannot rename, this IS cap4)
**GitHub:** https://github.com/adminbjkai/cap4

---

## Current State

Full-app audit completed 2026-03-19 (Claude Opus 4.6 + Codex, independent reviews, cross-validated). Critical runtime bugs found in worker job processing and API retry logic.

**Active work:** [AUDIT_PLAN.md](AUDIT_PLAN.md) — 6 phases (A through F), executing in dependency order.
**Phase 5 Auth:** Deferred until audit fixes are complete.

**Phase 4 — Integration Tests: ✅ 18/18 passing** (7 pipeline + 11 API contract)

### Latest Changes (Phase 4.7 — Agent Sprint: BJK-9 through BJK-18)
- ✅ **BJK-9** — micro-interaction animations added (page transitions, card motion, dialog backdrop)
- ✅ **BJK-10** — color system redesign and enhanced dark mode tokenization
- ✅ **BJK-11** — custom video controls shipped (play/pause, seek, volume, rate, PiP, fullscreen)
- ✅ **BJK-12** — library grid redesign with rich media cards and polished hover/processing states
- ✅ **BJK-13** — keyboard shortcuts + command palette (`Cmd+K` / `Ctrl+K`) and shortcuts overlay
- ✅ **BJK-14** — speaker diarization UI (badges, editable labels, filters) + API support for `speakerLabels`
- ✅ **BJK-15** — transcript confidence highlighting and uncertain-segment review workflow
- ✅ **BJK-16** — Groq enrichment upgrade: entities, action items, quotes, chapter sentiment + schema validation
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
- ✅ Integration test suite: 18/18 passing — full upload → transcribe → AI → complete pipeline
- ✅ transcript.language defaulted to 'en' at 3 layers
- ✅ Migration 0004: backfills NULL language → 'en', adds NOT NULL DEFAULT 'en'

---

## Key Files

| File | Purpose |
|------|---------|
| `AUDIT_PLAN.md` | Active audit fix plan — 6 phases, dependency-ordered |
| `CAP4_MASTER_PLAN.md` | Authoritative plan — start here |
| `README.md` | Clean project overview |
| `ARCHITECTURE.md` | State machine, job queue, services |
| `CONTRIBUTING.md` | Dev workflow and contribution guide |
| `docs/api/ENDPOINTS.md` | Full API reference |
| `docs/api/WEBHOOKS.md` | Webhook payload + HMAC verification |
| `docs/DATABASE.md` | Schema reference |
| `docs/ops/DEPLOYMENT.md` | Production deployment guide |
| `docs/ops/LOCAL_DEV.md` | Local dev setup (Docker + no-Docker) |
| `docs/ops/TROUBLESHOOTING.md` | Common issues + fixes |
| `docs/ui/DESIGN_SYSTEM.md` | UI tokens and component guide |
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

- **8 Docker services:** postgres + migrate (auto-runs SQL) + minio + minio-setup + web-api + worker + media-server + nginx
- **Migrations:** `migrate` service uses `schema_migrations` table to track applied migrations; runs on every `docker compose up`
- **Job queue:** PostgreSQL `FOR UPDATE SKIP LOCKED` — no Redis
- **State machine:** Monotonic `processing_phase_rank`, terminal states: `complete`, `failed`, `cancelled`
- **Webhooks:** media-server → web-api via HMAC-signed HTTP (replay-protected)
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
| Phase 4 | Integration tests — 18/18 passing ✓ |
| Phase 4.5 | Docker/config audit — auto-migrations, local dev docs ✓ |
| command palette | Global quick-action and navigation modal opened via `Cmd+K` / `Ctrl+K` |
| speaker diarization | Per-segment speaker attribution with editable display labels |
| confidence review | Transcript mode focused on low-confidence segments for verification |
| custom controls | App-rendered video controls replacing native browser video chrome |
| sage green theme | Muted green accent system replacing prior blue-heavy palette |
| Phase 5 | Auth — single-user JWT/session (NEXT UP) |
| schema_migrations | Table tracking which SQL migrations have been applied |
| migrate service | Docker Compose service that auto-runs migrations on startup |
| progress_bucket | Webhook dedup column — prevents duplicate 10%-bucket updates |
| delivery_id | Webhook idempotency key stored in webhook_deliveries table |
| phase_rank | Integer enforcing monotonic state transitions |
| SKIP LOCKED | PostgreSQL clause for lock-free concurrent job claiming |
| AUDIT_PLAN.md | Active tracking doc for 2026-03-19 full-app audit (6 phases A-F) |
| unacked skip | Worker bug: handler returns without calling ack(), job retries forever |
| job_status enum | `queued \| leased \| running \| succeeded \| cancelled \| dead` — no `'failed'` |

---

## People / Context

- **Murry** — owner, sole developer

---

## What to Ignore

Nothing left to ignore — repository is clean. `.gitignore` covers all dev artifacts.
