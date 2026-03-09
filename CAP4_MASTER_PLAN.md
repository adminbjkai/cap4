# cap4 — Master Plan

**Date:** March 9, 2026
**Status:** Authoritative — supersedes all earlier planning docs
**Purpose:** Synthesis of all 4 project versions into a confident cap4 roadmap

---

## Executive Summary

cap4 is a single-tenant video processing platform. A user uploads a video; cap4 encodes it, transcribes the audio, generates AI titles/summaries/chapters, and serves everything in a clean player UI.

This document is the result of a full audit across all four project generations:

| Version | Codebase | Key Characteristic |
|---------|----------|--------------------|
| v1 | `Cap_for_reference_only` | Original Cap open-source SaaS — multi-tenant, Tauri desktop, MySQL, 39 tables. **Reference only, not the same product.** |
| v2 | `Cap_v2` | Greenfield rewrite — Fastify, PostgreSQL, SQL job queue. Clean architecture, multipart stubbed (501). |
| v3 | `cap3` | Matured v2 — 2007-line API, 3 migrations, multipart fully implemented, Nginx added. |
| v4 | `cap3test` | cap3 + Kimi's security audit hardening. Best production state so far. |

**cap4 = cap3test codebase + documentation rewrite + planned feature improvements.**

The source code is production-ready now. The work remaining is: split the monolithic API, add CI/CD, create the GitHub repo, and build out the video player UI improvements.

---

## What We Learned from Each Version

### From v1 (Cap open-source)
v1 is a completely different product — multi-org SaaS with Stripe billing, WorkOS SSO, Tauri desktop app, and 39 database tables. We don't adopt its architecture. However, two ideas are worth noting:
- **Tinybird analytics** — lightweight event analytics worth considering later
- **Chapter derivation** — v1 had a chapter algorithm matching AI key points to transcript segments, which is relevant to our AI pipeline

### From v2 (greenfield)
v2 established the clean architectural foundation that all later versions built on:
- DB-backed job queue with `FOR UPDATE SKIP LOCKED` (no Redis needed)
- Monotonic state machine with phase ranks
- Idempotency key enforcement on all POST mutations
- Separate `media-server` service isolating FFmpeg from business logic
- Phased roadmap docs (Phase E/F/G) showing disciplined planning

**Key mistake to avoid:** v2's multipart upload was stubbed (`501 Not Implemented`) and documented as unimplemented. Always keep docs and code in sync.

### From v3 (cap3)
v3 completed what v2 started. The full implementation is here:
- Multipart upload fully working (init → presign-part → complete → abort)
- `@cap/logger` package extracted (structured Pino logging)
- `@cap/config` and `@cap/db` as shared packages
- 3 SQL migrations establishing a clean schema evolution pattern
- `generate_ai` job properly separated from transcription
- Webhook progress deduplication via `progress_bucket` column

**Key problem in v3:** 2007-line monolithic `index.ts`. Everything in one file is unsustainable.

### From v4 (cap3test — current best)
v4 = v3 + Kimi's security hardening:
- Webhook timestamp validation (replay attack prevention)
- HMAC signature verification with timing-safe comparison
- Delivery ID deduplication in webhook_deliveries table
- `TranscriptParagraph` component (paragraph view for transcript)
- `ChapterList` component (left sidebar navigation)
- `RecordPage` placeholder (future recording feature)
- `ProviderStatusPanel` (Deepgram/Groq health checks in UI)

**What to discard from v4:** The `.audit/` directory, `AGENTS.md`, and `bykimi.md` (already removed in cap4 clean copy). These are operational audit infrastructure, not product.

---

## Tech Stack — Definitive

No changes from what's working in v4. The stack is proven.

### Backend
| Component | Technology | Version |
|-----------|------------|---------|
| HTTP API | Fastify | 4.28.1 |
| Runtime | Node.js | 20+ |
| Language | TypeScript | strict mode |
| Database | PostgreSQL | 16 |
| Object Storage | MinIO (S3-compatible) | Latest |
| Video Processing | FFmpeg (via media-server) | 6+ |
| Transcription | Deepgram | Nova-2 model |
| AI Generation | Groq | llama-3.1-8b-instant |
| Logging | Pino (via @cap/logger) | Structured JSON |
| Package Manager | pnpm workspaces | 9+ |

### Frontend
| Component | Technology | Version |
|-----------|------------|---------|
| Framework | React | 18.3.1 |
| Build Tool | Vite | 5+ |
| Language | TypeScript | strict mode |
| Styling | CSS Modules / vanilla CSS | — |
| Video Player | Native HTML5 `<video>` | — |

### Infrastructure
| Component | Technology |
|-----------|------------|
| Container | Docker + Docker Compose |
| Reverse Proxy | Nginx |
| CI/CD | GitHub Actions (to be added) |
| Repo | GitHub |

---

## Database Schema — Authoritative State

The schema across 4 migrations is stable. Here's the full picture:

### Core Tables

**videos** — Central entity. Owns all state.
```sql
id                  TEXT PRIMARY KEY        -- UUID v4
name                TEXT                    -- Filename or user-provided title
upload_mode         upload_mode             -- 'singlepart' | 'multipart'
upload_phase        upload_phase            -- 'pending' → 'uploaded'
source_key          TEXT                    -- S3 key of original file
result_key          TEXT                    -- S3 key of processed file
thumbnail_key       TEXT                    -- S3 key of thumbnail
processing_phase    processing_phase        -- State machine (see below)
processing_phase_rank INT                   -- Monotonic rank (enforces forward-only)
transcription_status transcription_status  -- Separate from processing
ai_status           ai_status               -- Separate from transcription
transcript_text     TEXT                    -- Raw transcript from Deepgram
title               TEXT                    -- AI-generated title
summary             TEXT                    -- AI-generated summary
chapters            JSONB                   -- AI-generated chapters [{timestamp,title,startMs}]
metadata            JSONB                   -- duration, width, height, fps, hasAudio
webhook_url         TEXT                    -- Optional: notify this URL when complete
deleted_at          TIMESTAMP               -- Soft delete (migration 0002)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

**jobs** — Work queue. One row per unit of work.
```sql
id            TEXT PRIMARY KEY
video_id      TEXT REFERENCES videos(id)
type          job_type                  -- 'process_video' | 'transcribe_video' | 'generate_ai' | 'cleanup_artifacts'
status        job_status                -- 'queued' → 'leased' → 'running' → 'succeeded' | 'dead'
lease_expires_at TIMESTAMP             -- Lease timeout (crash recovery)
heartbeat_at  TIMESTAMP                -- Worker liveness
retry_count   INT DEFAULT 0
max_retries   INT DEFAULT 5
error_message TEXT
created_at    TIMESTAMP DEFAULT NOW()
leased_at     TIMESTAMP
completed_at  TIMESTAMP
```

**webhook_deliveries** — Idempotency for incoming webhooks.
```sql
delivery_id   TEXT PRIMARY KEY          -- x-cap-delivery-id header
video_id      TEXT REFERENCES videos(id)
phase         processing_phase
progress_bucket INT                     -- Dedup: only one update per 10% bucket
payload       JSONB
received_at   TIMESTAMP DEFAULT NOW()
```

**uploads** — Multipart upload tracking.
```sql
id            TEXT PRIMARY KEY          -- Our internal upload ID
video_id      TEXT REFERENCES videos(id)
minio_upload_id TEXT                    -- MinIO multipart ID
parts         JSONB                     -- [{PartNumber, ETag}]
status        upload_phase
created_at    TIMESTAMP
```

### State Machine Phases (processing_phase)

```
not_required (rank 0)
    ↓
queued (rank 10)
    ↓
downloading (rank 20)
    ↓
probing (rank 30)
    ↓
processing (rank 40)       ← FFmpeg encoding
    ↓
uploading (rank 50)         ← Upload to MinIO
    ↓
generating_thumbnail (rank 60)
    ↓
complete (rank 70)          ← Terminal: success
failed (rank 80)            ← Terminal: encoding failed
cancelled (rank 90)         ← Terminal: user cancelled
```

**Transcription and AI** have their own independent status enums (`transcription_status`, `ai_status`) that run in parallel once `processing_phase = complete`.

---

## Architecture — Services

```
Browser (React)
     │
     ▼
[Nginx] ──────────── port 8022 (external)
     │
     ├─────────────▶ [web] React SPA
     │                (port 5173 internal)
     │
     └─────────────▶ [web-api] Fastify HTTP
                      (port 3000 internal)
                           │
                           ├─── [PostgreSQL] Database
                           │     (port 5432)
                           │
                           ├─── [MinIO] S3 Storage
                           │     (port 9000)
                           │
                           └─── [media-server] FFmpeg
                                 (port 3001 internal)
                                 └── Emits HMAC webhooks
                                     back to web-api

[worker] Node.js background processor
     │── Polls PostgreSQL jobs table
     │── Claims jobs: FOR UPDATE SKIP LOCKED
     │── Calls Deepgram (transcription)
     │── Calls Groq (AI title/summary/chapters)
     └── Updates video state
```

### Key Architectural Guarantees

1. **Monotonic state** — `processing_phase_rank` enforced on every UPDATE
2. **Atomic job claiming** — `FOR UPDATE SKIP LOCKED` prevents thundering herd
3. **Crash recovery** — `lease_expires_at` allows reclaim after worker crash
4. **Idempotent mutations** — Delivery ID dedup in `webhook_deliveries`
5. **Webhook security** — HMAC-SHA256 + timestamp skew check (±5 min)
6. **No data loss** — Database is the single source of truth; S3 holds blobs

---

## Monolith Refactor Plan (Priority 1)

The 2007-line `apps/web-api/src/index.ts` is the biggest maintenance risk. It needs to be split into route modules. This is the first code change for cap4.

### Target Structure

```
apps/web-api/src/
├── index.ts                     ← Fastify app setup + plugin registration only
├── plugins/
│   ├── logging.ts               ← Already exists ✓
│   └── health.ts                ← Already exists ✓
└── routes/
    ├── uploads.ts               ← All /api/uploads/* routes
    ├── videos.ts                ← All /api/videos/* routes
    ├── library.ts               ← /api/library/* routes
    ├── jobs.ts                  ← /api/jobs/* routes
    ├── system.ts                ← /api/system/* routes (provider-status)
    └── webhooks.ts              ← /api/webhooks/media-server/progress
```

Each route file exports a Fastify plugin using `fastify-plugin`:

```typescript
// routes/videos.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const videosRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/videos/:id/status', async (req, reply) => { ... });
  app.post('/api/videos/:id/retry', async (req, reply) => { ... });
  app.post('/api/videos/:id/delete', async (req, reply) => { ... });
};

export default fp(videosRoutes);
```

This is a mechanical refactor — no logic changes, just file organization. It should be done first before any feature work.

---

## Video Player UI Improvements (Priority 2)

From `VIDEO_PLAYER_IMPROVEMENTS.md` — these are the known UI improvements. The components (`ChapterList`, `TranscriptParagraph`) already exist in v4; the work is finishing and polishing them.

### Feature 1: Chapter Navigation (Epic)
**Status:** `ChapterList.tsx` component exists, needs integration into player layout
**Goal:** Click a chapter → video seeks to that timestamp

Implementation:
- Wire `ChapterList` props: `chapters`, `currentTime`, `onSeek`
- Sync active chapter highlight as video plays
- `VideoPage.tsx` passes `videoRef.current.currentTime` as prop

### Feature 2: Reposition Chapter Layout
**Status:** Chapters currently render below video
**Goal:** Chapter list on left sidebar (desktop), collapsed accordion (mobile)

Implementation:
- CSS Grid: `[chapters] [video]` on `>1024px`, stacked below on `<1024px`
- No new components needed, just layout restructure in `VideoPage.tsx`

### Feature 3: Transcript Paragraph View
**Status:** `TranscriptParagraph.tsx` component exists
**Goal:** Display transcript as readable paragraphs with timestamps, not raw text dump

Implementation:
- Parse `transcript_text` into paragraph-sized chunks (split on sentence boundaries or Deepgram word groups with >1s gaps)
- Use `TranscriptParagraph` to render each chunk with its start timestamp
- Clicking a paragraph seeks video to that point

### Feature 4: Summary Quality Improvement
**Status:** Groq prompt in worker generates summary
**Goal:** Better structured summaries with bullet points and key takeaways

Implementation:
- Revise Groq system prompt in `apps/worker/src/providers/` (or equivalent)
- Add `keyPoints: string[]` to the AI response schema
- Store in `chapters` JSONB or add a `key_points` column in a future migration

---

## GitHub Setup Plan

### Step 1: Create Repository
```bash
# From cap4/ directory (the clean copy at cap3test/cap4/ or cap4_new/cap4/)
cd /path/to/cap4
git init
git add .
git commit -m "feat: initial cap4 release"
gh repo create cap4 --public --source=. --push
```

### Step 2: Issue Templates
Create `.github/ISSUE_TEMPLATE/`:

**bug.yml:**
```yaml
name: Bug Report
description: Something isn't working
labels: ["bug"]
body:
  - type: textarea
    id: description
    attributes:
      label: What happened?
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
  - type: textarea
    id: logs
    attributes:
      label: Relevant logs
      render: shell
```

**feature.yml:**
```yaml
name: Feature Request
description: Suggest an improvement
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
```

### Step 3: CI/CD Workflows

**`.github/workflows/test.yml`** — Run on every PR:
```yaml
name: Test
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: cap4_test
          POSTGRES_USER: cap4
          POSTGRES_PASSWORD: password
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm test
```

**`.github/workflows/build.yml`** — Validate Docker builds:
```yaml
name: Build
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build .
```

### Step 4: Create GitHub Issues (from VIDEO_PLAYER_IMPROVEMENTS.md)
Create these 4 issues at launch:
1. **[Epic] Chapter Navigation UI** — Wire `ChapterList` to video player
2. **Reposition Chapter Layout** — Left sidebar on desktop, accordion on mobile
3. **Transcript Paragraph View** — Parse and display transcript in readable chunks
4. **Summary Quality Improvement** — Revise Groq prompt for structured output

### Step 5: Tag v1.0.0
```bash
git tag v1.0.0
git push origin v1.0.0
# Create GitHub Release with release notes
```

---

## Security Checklist

Items identified in the v4 audit as still pending:

| Issue | Severity | Action |
|-------|----------|--------|
| No rate limiting on upload endpoint | P1 | Add `@fastify/rate-limit` (100 req/min per IP) |
| Worker processes untrusted video with FFmpeg | P1 | Ensure media-server runs in isolated container (already true via Docker) |
| Nginx not enforcing upload size limit | P2 | Add `client_max_body_size 2g;` in nginx config |
| No input validation on webhook `phase` enum | P2 | Already has `phaseRank()` check — verify coverage |
| Deepgram/Groq keys logged on startup? | P2 | Audit `@cap/logger` for accidental key logging |
| `pnpm audit` — check for CVEs | P3 | Run before v1.0.0 release |

All P0 security issues were fixed in v4 (Kimi's audit): HMAC verification, timestamp replay protection, delivery ID dedup, timing-safe comparison.

---

## Documentation Structure (Already Complete)

The `cap4/` directory already contains all the documentation from the previous refactor:

```
cap4/
├── README.md                    ✓ Project overview + quick start
├── CONTRIBUTING.md              ✓ Dev workflow, PR format, commit standards
├── ARCHITECTURE.md              ✓ System design, state machine, job queue
│
└── docs/
    ├── DATABASE.md              ✓ Full schema + state machine SQL
    ├── api/
    │   ├── ENDPOINTS.md         ✓ API reference (all DOC errors fixed)
    │   └── WEBHOOKS.md          ✓ Webhook events, signing, delivery
    ├── ops/
    │   ├── LOCAL_DEV.md         ✓ 5-minute setup
    │   ├── DEPLOYMENT.md        ✓ Production guide
    │   └── TROUBLESHOOTING.md   ✓ Common issues
    └── ui/
        └── DESIGN_SYSTEM.md     ✓ Component library
```

No documentation changes needed before GitHub push.

---

## Development Phases

### Phase 1 — Ship ✅ Complete
Goal: Get a clean, working codebase onto GitHub.

- [x] API monolith refactor (2007-line `index.ts` → 6 route modules)
- [x] Create `.github/ISSUE_TEMPLATE/` files
- [x] Create `.github/workflows/test.yml` + `build.yml`
- [x] `gh repo create cap4 --public` → https://github.com/adminbjkai/cap4
- [x] Tag v1.0.0 + GitHub release

### Phase 2 — Player UI ✅ Complete
Goal: Finish the video player UX improvements.

- [x] Chapter navigation (ChapterList → video seek)
- [x] Chapter layout (left sidebar on lg+ breakpoint)
- [x] TranscriptParagraph click-to-seek
- [x] Groq prompt revision (better key points)

### Phase 3 — Hardening ✅ Complete
Goal: Production-grade reliability.

- [x] Rate limiting (`@fastify/rate-limit` v10.3.0 — 100 req/min per IP)
- [x] Nginx upload size limit (`client_max_body_size 2g`)
- [x] Fastify security audit (bumped to ^5.8.1)
- [x] Key log audit — pino redacts API keys and secrets

### Phase 4 — Integration Tests ✅ Complete (18/18 passing)
Goal: Verify full upload → encode → transcribe → AI pipeline end-to-end.

- [x] Vitest integration config (180s timeout, singleFork)
- [x] Test fixture `vid0.mp4` (30s, 2.6 MB) for fast real-pipeline tests
- [x] Full-flow tests (7) — upload → transcribe → AI → complete pipeline
- [x] API contract tests (11) — 404, missing headers, idempotency, soft-delete, health/ready
- [x] `transcript.language` defaults to `'en'` at 3 layers
- [x] Migration 0004 — backfills NULL language → 'en', adds NOT NULL DEFAULT 'en'

### Phase 4.5 — Docker & Config Audit ✅ Complete
Goal: `docker compose down -v && docker compose up` works with zero manual steps.

- [x] **Auto-migrations** — `migrate` service applies all pending SQL via `run-migrations.sh`
- [x] **Makefile** updated — `reset-db` + `migrate` targets
- [x] **`.env.example`** — comprehensive comments, URL guidance
- [x] **LOCAL_DEV.md** — full rewrite: Docker and non-Docker paths, URL routing table
- [x] **`scripts/dev-local.sh`** — run all services without Docker
- [x] Branding: all cap3 → cap4 references cleaned up

### Phase 4.6 — UI Design System Overhaul ✅ Complete
Goal: Modern, polished video page matching original Cap.so aesthetic — clean colors, proper component library, 3-tab rail, interactive seeker.

- [x] **tailwind.config.cjs** — semantic color tokens backed by CSS vars (`bg-surface`, `text-foreground`, `text-muted`, `blue.*` etc.); `darkMode` config; font + shadow extensions
- [x] **index.css** — blue accent vars (`--accent-blue` family light + dark); all previously-missing component classes: `line-item/active`, `chapter-handle/active`, `popover-panel`, `seeker-*`, `rail-tab-*`, `notes-textarea`, `chapter-row-active`, `scroll-panel`; thin global scrollbars
- [x] **VideoPage.tsx** — 3-tab right rail: Notes | Summary | Transcript; `NotesPanel` with `localStorage` persistence + debounced auto-save; Chapters below-fold only
- [x] **PlayerCard.tsx** — full-width clickable seeker track; hover preview tooltip (timestamp + nearest chapter title); `seeker-fill` playback bar; chapter dots with `stopPropagation`; time display alongside Prev/Next
- [x] **SummaryCard.tsx** — dedicated compact branch: "Generated by Cap AI", `text-[13px]` body, inline chapter list with dividers
- [x] **ChapterList.tsx** — replaced non-functional `bg-primary/10` with `.chapter-row-active`; active dot uses `var(--accent-blue)`
- [x] **docs/ui/DESIGN_SYSTEM.md** — complete rewrite: token table, component class catalog, layout diagram, accessibility, spacing conventions

### Phase 5 — Auth (Next)
Goal: Protect the single-tenant instance with authentication.

- [ ] Single-user authentication (JWT or session-based)
- [ ] Protected routes on frontend
- [ ] Auth middleware on API endpoints

### Backlog
- [ ] Batch video operations
- [ ] PgBouncer connection pooling
- [ ] CDN integration for video delivery
- [ ] Tinybird analytics integration
- [ ] Multiple worker instances (architecturally supported — scale the service)

---

## What NOT to Do

Lessons from the 4-version evolution:

1. **Don't mix operational tooling with the product repo.** The `.audit/` directory and `bykimi.md` are the canonical example. Audit tools, AI specs, and operational runbooks belong in separate repos or internal wikis.

2. **Don't let docs drift from code.** DOC-001 through DOC-005 in cap3 were all cases where the code was updated but docs were not. Every PR must include a doc check.

3. **Don't use Linear (or any paid PM tool) in open-source docs.** All issue tracking should use GitHub Issues.

4. **Don't build multi-tenancy unless you need it.** v1 has 39 tables, Stripe, WorkOS, and an entire org management system. cap4 is single-tenant by design — that's a feature, not a limitation.

5. **Don't let a single file grow to 2000 lines.** The monolithic `index.ts` is the biggest source of cognitive overhead. The Phase 1 refactor addresses this.

6. **Don't stub endpoints and mark them as unimplemented in docs.** If it's in the API, it should work. If it doesn't work, remove it from the docs.

---

## Key Metrics (cap4 at Launch)

| Metric | Value |
|--------|-------|
| Source code | ~3,500 lines (TypeScript) |
| Documentation | 11 markdown files |
| Services | 7 Docker containers |
| DB migrations | 4 SQL files |
| API endpoints | ~15 routes |
| Dependencies | ~30 packages |
| Repo size | ~5MB (no audit artifacts) |
| Test coverage | 18/18 integration tests + smoke test |

---

## Quick Reference

| Task | Command |
|------|---------|
| Start everything | `make up` |
| Stop everything | `make down` |
| Full test | `make smoke` |
| Reset database | `make reset-db` |
| View all logs | `docker compose logs` |
| Run linter | `pnpm lint` |
| Format code | `pnpm format` |
| Unit tests | `pnpm test` |

---

## Files Summary

### Start Here
- **README.md** — 5-minute project overview
- **docs/ops/LOCAL_DEV.md** — Set up your dev environment
- **ARCHITECTURE.md** — Understand the system design

### Reference
- **docs/api/ENDPOINTS.md** — Every API endpoint
- **docs/DATABASE.md** — Full schema
- **CONTRIBUTING.md** — How to contribute code

### This Document
- **CAP4_MASTER_PLAN.md** — This file. The authoritative plan.

---

**Status: Phases 1–4.5 complete. Phase 5 (Auth) is next.**

All Docker infrastructure is self-bootstrapping — `docker compose up` applies
migrations automatically. 18/18 integration tests pass. Next step: single-user
authentication (Phase 5).
