# Tasks — cap4

**Last updated:** 2026-03-09 (Phase 1–4 complete ✓ — 18/18 integration tests passing)

---

## Active

### Phase 5 — Auth (NEXT UP)

- [ ] Single-user authentication (JWT or session-based)
- [ ] Protected routes on frontend
- [ ] Auth middleware on API endpoints

---

## Recently Completed

### Phase 4 — Integration Tests (✓ Complete — 18/18 passing)
- [x] **Vitest integration config** — 180s timeout, singleFork execution
- [x] **Test fixtures** — vid0.mp4 (30s, 2.6 MB) for fast real-pipeline tests
- [x] **Full-flow tests (7)** — upload → transcribe → AI → complete pipeline verified
- [x] **API contract tests (11)** — 404, missing headers, idempotency, soft-delete, health/ready
- [x] **Polling** — waits for all 3 pipelines: processingPhase + transcriptionStatus + aiStatus
- [x] **transcript.language** — defaults to 'en' at 3 layers (deepgram.ts, worker SQL COALESCE, API COALESCE)
- [x] **Migration 0004** — backfills NULL language → 'en', adds NOT NULL DEFAULT 'en'
- [x] **Phase 4.5 audit** — branding, docs, docker-compose container names, TASKS.md, CAP4_MASTER_PLAN.md

---

## Someday / Backlog

- [ ] Batch video operations
- [ ] PgBouncer connection pooling
- [ ] CDN integration for video delivery
- [ ] Tinybird analytics integration
- [ ] Multiple worker instances (architecturally supported — just scale the service)
- [ ] `RecordPage` — in-browser recording (placeholder exists in web/src/pages)

---

## Completed

### Phase 3 — Hardening (✓ Complete)
- [x] **Rate limiting** — `@fastify/rate-limit` v10.3.0 registered globally (100 req/min per IP); webhooks exempt via `rateLimit: false`
- [x] **Nginx upload size limit** — `client_max_body_size 2g;` added to both nginx configs
- [x] **Security audit** — fastify bumped to ^5.8.1; `routerPath` → `routeOptions.url` migration applied
- [x] **Key log audit** — `@cap/logger` pino redact strips API keys + secrets with `remove: true`
- [x] **cap3→cap4 naming** — Commit edd4120 (14 files, 34 insertions, 183 deletions)

### Earlier phases
- [x] Full audit of all 4 project versions (v1/v2/v3/v4)
- [x] Write CAP4_MASTER_PLAN.md — authoritative synthesis
- [x] Rewrite all documentation (11 files in cap4/docs/)
- [x] Fix DOC-001 through DOC-005 (API documentation errors)
- [x] Remove Kimi audit artifacts from cap4 docs
- [x] Remove all Linear issue references from docs
- [x] Create memory/glossary.md and CLAUDE.md working memory
- [x] Split monolithic API (2007→57 line index.ts + 6 route modules + shared lib)
- [x] Create `.github/ISSUE_TEMPLATE/bug.yml` and `feature.yml`
- [x] Create `.github/workflows/test.yml` (typecheck + lint + vitest on every PR)
- [x] Create `.github/workflows/build.yml` (Docker build on push to main)
- [x] Remove Kimi artifacts from git index (AGENTS.md, .audit/ — 53 files untracked, .gitignore updated)
- [x] Create GitHub repo `adminbjkai/cap4` — public, 392 objects pushed, origin updated
- [x] Tag v1.0.0 + GitHub release — https://github.com/adminbjkai/cap4/releases/tag/v1.0.0
- [x] Convert VIDEO_PLAYER_IMPROVEMENTS.md to GitHub Issues — issues #1–#4 created
- [x] Phase 2 complete — ChapterList seek wired, lg breakpoint layout, TranscriptParagraph click-to-seek, Groq keyPoints prompt
- [x] Test suite — 22 vitest unit tests (ChapterList + TranscriptParagraph) + 16 Playwright E2E tests with 10 visual regression screenshots
