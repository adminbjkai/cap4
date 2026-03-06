# Tasks — cap4

**Last updated:** 2026-03-06 (Phase 1 task 1 complete)

---

## Active

### Phase 1 — Ship (Do First)

- [x] **Split monolithic API** — `index.ts` 2007→57 lines. Route modules in `apps/web-api/src/routes/` + shared helpers in `apps/web-api/src/lib/shared.ts`. `tsc --noEmit` clean. All 22 routes verified.
- [ ] **Create `.github/ISSUE_TEMPLATE/` files** — bug.yml and feature.yml templates
- [ ] **Create `.github/workflows/test.yml`** — CI workflow (lint + test on every PR)
- [ ] **Create `.github/workflows/build.yml`** — Docker build validation on push
- [ ] **Create GitHub repo** — `gh repo create cap4 --public --source=. --push` from cap4 working dir
- [ ] **Tag v1.0.0** — First GitHub release with release notes
- [ ] **Convert VIDEO_PLAYER_IMPROVEMENTS.md to GitHub Issues** — 4 issues: Chapter Nav, Chapter Layout, Transcript Paragraph View, Summary Quality

### Phase 2 — Player UI

- [ ] **Wire ChapterList to video player** — `chapters` prop → click → `videoRef.current.currentTime = chapter.startMs/1000`
- [ ] **Reposition chapter layout** — CSS Grid: left sidebar on >1024px, stacked on mobile
- [ ] **Transcript paragraph view** — Parse `transcript_text` into chunks, render with `TranscriptParagraph`, clicking seeks video
- [ ] **Revise Groq summary prompt** — Better structured output with key points; store in `chapters` JSONB or new `key_points` column

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
