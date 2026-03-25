---
title: "Master Plan"
description: "High-level synthesis of the project, its current state, and its history"
---

# cap4 — Master Plan

**Status:** Current-state synthesis for the repo
**Last reviewed:** 2026-03-24
**Purpose:** Keep one concise high-level document that explains what cap4 is,
how it got here, and what is currently true.

This document is not a feature backlog. For current technical contracts, use:

- [API reference](api.md)
- [Architecture](architecture.md)
- [Database schema](database.md)
- [Environment variables](environment.md)
- [Local development](local-dev.md)
- [Deployment](deployment.md)

---

## Current State

cap4 is a single-tenant video processing platform with:

- React watch app
- Fastify API
- PostgreSQL-backed job queue
- background worker
- FFmpeg media-server
- S3-compatible object storage

Current repo state:

- upload -> process -> transcript -> AI summary flow is implemented
- recordings auto-upload after capture; file selections remain explicit upload actions
- custom video controls, transcript search, confidence review, command palette, speaker diarization, editable speaker labels, and summary enrichments are shipped
- the checked-in Docker Compose stack is self-bootstrapping via the `migrate` service
- GitHub Actions is consolidated into one authoritative workflow at `.github/workflows/test.yml`
- the repo has no end-user authentication layer; auth is out of scope for the current state

Current validation command set used in this repo:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm --filter @cap/web test:e2e`
- `pnpm --filter @cap/web-api test:e2e`
- `pnpm db:migrate`
- `make smoke` against a running stack

---

## Current System Shape

- `web-api` owns HTTP routes, health/readiness, idempotency, and queue enqueue paths
- `worker` claims `job_queue` work with PostgreSQL leasing and calls Deepgram, Groq, and `media-server`
- `media-server` exposes `/health` and `/process`; the mainline worker path calls it synchronously
- `webhook` terminology is split:
  - incoming media progress route: `POST /api/webhooks/media-server/progress`
  - outgoing user callbacks: `deliver_webhook` jobs to `videos.webhook_url`
- frontend assets are built by `web-builder` and served by nginx in `web-internal`

For the detailed contract, do not rely on this file. Use [architecture.md](architecture.md), [api.md](api.md), and [database.md](database.md).

---

## Delivered Milestones

### Phase 1

- web-api monolith split into route modules and shared helpers
- GitHub repo, issue templates, and CI workflows added

### Phase 3

- rate limiting and raw-body webhook support
- nginx hardening
- Fastify v5 migration
- log redaction and security cleanup

### Phase 4

- integration suite for the real upload -> transcode -> transcribe -> AI flow
- API contract coverage for uploads, videos, jobs, library, and webhooks

### Phase 4.5

- automatic migrations on Compose startup
- local-dev and config docs aligned to the real stack
- `make reset-db` and `make smoke` corrected for the current runtime

### Phase 4.7

- micro-interactions and theme redesign
- custom video player controls
- command palette and shortcut overlay
- speaker diarization UI
- confidence review flow
- transcript full-text search
- summary enrichments for entities, action items, and quotes

---

## Historical Lineage

| Version | Codebase | What mattered |
|---------|----------|---------------|
| v1 | `Cap_for_reference_only` | Reference product only; not the architecture cap4 uses |
| v2 | `Cap_v2` | Established the PostgreSQL job-queue architecture |
| v3 | `cap3` | Matured multipart upload and core service split |
| v4 | `cap3test` | Security hardening and the base for cap4 |

Two historical docs are kept intentionally:

- [docs/archive/audit-plan.md](archive/audit-plan.md) — completed audit tracker
- [docs/archive/roadmap.md](archive/roadmap.md) — archived cap3-era roadmap

They are history, not the current contract.

---

## What This File Should Not Do

This file should not:

- duplicate route-by-route API details
- restate the database schema in SQL-like detail
- describe unsupported deployment targets
- carry speculative future phases or roadmap expansion

If it starts doing any of those again, trim it back and push the details into
the focused docs that already exist.
