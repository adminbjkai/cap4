# Tasks — cap4

**Last updated:** 2026-03-06 (Phase 2 complete ✓, testing suite complete ✓, Phase 3 hardening in progress)

---

## Active

### Phase 3 — Hardening

- [x] **Rate limiting** — `@fastify/rate-limit` v9 registered globally (100 req/min per IP); webhooks exempt via `rateLimit: false`
- [x] **Nginx upload size limit** — `client_max_body_size 2g;` added to both nginx configs
- [x] **pnpm audit** — 4 vulns found: fastify bumped to ^5.8.1 (fixes HIGH CVE + LOW DoS); `routerPath` → `routeOptions.url` migration applied; esbuild moderate is dev-server-only (low production risk); fast-xml-parser low is @aws-sdk transitive (no direct fix available). **Run `pnpm install` on your Mac to complete the fastify v5 upgrade.**
- [x] **Audit Deepgram/Groq key logging** — `@cap/logger` clean: pino `redact` already strips `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `MEDIA_SERVER_WEBHOOK_SECRET`, `DATABASE_URL` with `remove: true`
- [ ] **Integration tests** — Full upload → transcription → AI → complete flow

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
