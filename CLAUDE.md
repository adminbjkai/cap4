# Working Memory — cap4

**Last updated:** 2026-03-09 (Phase 4 complete — 18/18 tests passing)
**Project:** cap4 — single-tenant video processing platform
**Source dir:** cap3test (virtiofs mount — cannot rename, this IS cap4)
**GitHub:** https://github.com/adminbjkai/cap4

---

## Current State

Phases 1–4 complete. Repository clean.
**Phase 4 — Integration Tests: ✅ 18/18 passing** (7 pipeline + 11 API contract)

### Latest Changes
- ✅ Integration test suite: 18/18 passing — full upload → transcribe → AI → complete pipeline
- ✅ Polling waits for all 3 pipelines: processingPhase + transcriptionStatus + aiStatus
- ✅ transcript.language defaulted to 'en' at 3 layers (deepgram.ts, worker SQL COALESCE, API COALESCE)
- ✅ Migration 0004: backfills NULL language → 'en', adds NOT NULL DEFAULT 'en'
- ✅ Video player thumbnail: added `poster` attribute to `<video>` element
- ✅ AppShell branding: Cap3 → Cap4
- ✅ Cap_for_reference_only added to .gitignore

**Next Phase:** Phase 5 — Auth

---

## Key Files

| File | Purpose |
|------|---------|
| `CAP4_MASTER_PLAN.md` | Authoritative plan — start here |
| `README.md` | Clean project overview |
| `ARCHITECTURE.md` | State machine, job queue, services |
| `CONTRIBUTING.md` | Dev workflow and contribution guide |
| `docs/api/ENDPOINTS.md` | Full API reference |
| `docs/api/WEBHOOKS.md` | Webhook payload + HMAC verification |
| `docs/DATABASE.md` | Schema reference |
| `docs/ops/DEPLOYMENT.md` | Production deployment guide |
| `docs/ops/LOCAL_DEV.md` | Local dev setup |
| `docs/ops/TROUBLESHOOTING.md` | Common issues + fixes |
| `docs/ui/DESIGN_SYSTEM.md` | UI tokens and component guide |
| `apps/web-api/src/index.ts` | Fastify entry — rate limiting + route modules |
| `apps/web/src/` | React/Vite frontend |

---

## Architecture in 30 Seconds

- **7 Docker services:** Nginx → web (React/Vite) + web-api (Fastify) → PostgreSQL + MinIO + media-server; worker polls separately
- **Job queue:** PostgreSQL `FOR UPDATE SKIP LOCKED` — no Redis
- **State machine:** Monotonic `processing_phase_rank`, terminal states: `complete`, `failed`, `cancelled`
- **Webhooks:** media-server → web-api via HMAC-signed HTTP (replay-protected)
- **AI:** Deepgram (transcription) + Groq (title/summary/chapters)

---

## Glossary

| Term | Meaning |
|------|---------|
| cap3test | The working source directory (virtiofs mount — IS cap4) |
| cap4 | The project name (the old `cap4/` docs subdirectory has been removed) |
| monolith | Was `apps/web-api/src/index.ts` (2007 lines) — now split into route modules ✓ |
| Phase 1 | API split + GitHub repo creation ✓ |
| Phase 2 | Player UI (ChapterList, TranscriptParagraph, lg breakpoint) ✓ |
| Phase 3 | Hardening (rate limiting, nginx, fastify v5, key log audit) ✓ |
| Phase 4 | Integration tests — 18/18 passing, full upload → AI pipeline verified ✓ |
| progress_bucket | Webhook dedup column — prevents duplicate 10%-bucket updates |
| delivery_id | Webhook idempotency key stored in webhook_deliveries table |
| phase_rank | Integer enforcing monotonic state transitions |
| SKIP LOCKED | PostgreSQL clause for lock-free concurrent job claiming |

---

## People / Context

- **Murry** — owner, sole developer

---

## What to Ignore

Nothing left to ignore — repository is clean. `.gitignore` covers all dev artifacts.
