# Working Memory — cap4

**Last updated:** 2026-03-06
**Project:** cap4 — single-tenant video processing platform
**Source dir:** cap3test (virtiofs mount — cannot rename, this IS cap4)
**Plan:** See CAP4_MASTER_PLAN.md in this directory

---

## Current State

The master plan is written and ready. The codebase (cap3test) is production-quality. All documentation is complete inside the `cap4/` subdirectory.

**Phase 1 is next** — split the monolithic API + push to GitHub.

---

## Key Files

| File | Purpose |
|------|---------|
| `CAP4_MASTER_PLAN.md` | Authoritative plan — start here |
| `cap4/README.md` | Clean project overview |
| `cap4/ARCHITECTURE.md` | State machine, job queue, services |
| `cap4/docs/api/ENDPOINTS.md` | Full API reference (all doc errors fixed) |
| `cap4/docs/DATABASE.md` | Schema reference |
| `apps/web-api/src/index.ts` | 2007-line monolith — needs splitting (Phase 1) |
| `VIDEO_PLAYER_IMPROVEMENTS.md` | UI features → convert to GitHub issues |

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
| cap4 | The project name + the `cap4/` docs subdirectory inside cap3test |
| cap4_new | A standalone copy created for reference; cap3test is the working source |
| monolith | `apps/web-api/src/index.ts` — 2007 lines, needs splitting |
| Phase 1 | API split + GitHub repo creation |
| DOC-001-005 | Five API doc errors fixed in cap4/docs/api/ENDPOINTS.md |
| progress_bucket | Webhook dedup column — prevents duplicate 10%-bucket updates |
| delivery_id | Webhook idempotency key stored in webhook_deliveries table |
| phase_rank | Integer enforcing monotonic state transitions |
| SKIP LOCKED | PostgreSQL clause for lock-free concurrent job claiming |

---

## People / Context

- **Murry** — owner, sole developer
- **Kimi** — previous AI agent that worked on cap3/cap3test; left `.audit/` artifacts + `bykimi.md` (to be removed from cap4 GitHub push)

---

## What to Ignore

- `AGENTS.md` — Kimi's audit config, not a product file
- `bykimi.md` — Kimi's 589-line audit spec, not a product file
- `.audit/` — Kimi's audit artifacts
- `Cap3 › All issues.csv` — old Linear export
- `cap4_new/` — reference copy only; work in cap3test
