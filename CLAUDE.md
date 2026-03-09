# Working Memory — cap4

**Last updated:** 2026-03-09 (Phase 4 integration tests ready)
**Project:** cap4 — single-tenant video processing platform
**Source dir:** cap3test (virtiofs mount — cannot rename, this IS cap4)
**GitHub:** https://github.com/adminbjkai/cap4

---

## Current State

Phases 1–3 complete. Tagged v1.1.0. Repository clean.
**Phase 4 — Integration Tests:** Ready to run. Vitest suite created with 18 tests (7 pipeline + 11 API contract).

### Latest Changes
- ✅ cap3 → cap4 naming transition: 14 files, 34 insertions, 183 deletions (commit edd4120)
- ✅ Integration test suite: fixtures.ts + full-flow.test.ts + separate vitest configs
- ✅ Fixed fastify v5 compatibility: moved @fastify/rate-limit from devDependencies → dependencies (v10.3.0)
- ✅ TypeScript compilation: all 7 workspace projects pass typecheck

**Next Actions (on your Mac):**
1. `pnpm install` — pull latest dependencies
2. `docker compose up -d` — start 7-service stack
3. Wait ~60 seconds for all services healthy
4. `pnpm test:integration` — run full pipeline tests

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
| Phase 4 | Integration tests — full upload → AI pipeline (READY: 18 tests created + fastify v5 fixed) ✓ |
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
