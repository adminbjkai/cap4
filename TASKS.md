# Tasks — cap4

**Last updated:** 2026-03-06 (Phase 2 complete ✓, testing suite complete ✓)

---

## Active

### Phase 3 — Hardening

- [ ] **Rate limiting** — Add `@fastify/rate-limit` (100 req/min per IP) on upload + API endpoints
- [ ] **Nginx upload size limit** — Add `client_max_body_size 2g;` to nginx config
- [ ] **pnpm audit** — Run `pnpm audit` and fix all high/critical CVEs before v1.0.0
- [ ] **Integration tests** — Full upload → transcription → AI → complete flow
- [ ] **Audit Deepgram/Groq key logging** — Verify `@cap/logger` doesn't accidentally log API keys on startup

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
