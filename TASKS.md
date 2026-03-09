# Tasks — cap4

**Last updated:** 2026-03-09 (Phase 1–3 complete ✓, Phase 4 integration tests ready ✓)

---

## Active

### Phase 4 — Integration Tests (READY TO RUN)

- [x] **Vitest integration config** — 180s timeout, singleFork execution (tests/integration/** pattern)
- [x] **Test fixtures** — ffmpeg-based MP4 generation with audio, fragmented format support
- [x] **Full-flow tests (7)** — Create video → sign URL → PUT file → complete upload → poll until complete → verify transcript + AI fields
- [x] **API contract tests (11)** — 404 handling, missing headers, idempotency, soft-delete, health/ready endpoints
- [x] **Fastify v5 compatibility fix** — Moved `@fastify/rate-limit` from devDependencies → dependencies (v10.3.0)
- [x] **cap3 → cap4 naming** — 14 files updated (docker-compose.yml, configs, routes, components, docs)

**Next:** `docker compose up -d` → `pnpm test:integration` (on your Mac)

---

## Someday / Backlog

- [ ] Authentication layer (single-user JWT or session)
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
