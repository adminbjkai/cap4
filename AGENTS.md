# AGENTS Guide

This document defines non-negotiable engineering rules for contributors and automation agents working in this repository.

## Project Purpose
- Build and operate a single-tenant video web app.
- Deliver a public-by-ID share model.
- Run deterministic background workflows: `upload -> processing -> transcription -> ai`.
- Keep platform scope intentionally minimal: no auth, no users, no orgs, no tenant boundaries.

## Architectural Principles
1. Read endpoints are side-effect free.
2. Async operations are represented as explicit DB jobs.
3. Mutating API operations require `Idempotency-Key` and must be replay-safe.
4. State transitions must be monotonic and validated at write time.
5. Job execution uses SQL leasing with `FOR UPDATE SKIP LOCKED`.
6. Webhook writes require HMAC verification and replay protection.
7. Object storage is not authoritative state; Postgres is authoritative state.

## High-Level Topology
- `web-api`: route handlers, share delivery, webhook intake.
- `worker`: queue claim/execute/retry/dead-letter.
- `media-server`: FFmpeg/FFprobe and thumbnail processing.
- `postgres`: system of record for state, jobs, idempotency, webhook events.
- `s3/minio`: raw/result/transcript/thumbnail blobs.

## State Machine Baseline
### Upload
`pending -> uploading -> completing -> uploaded`
`uploading|completing -> failed|aborted`

### Processing
`not_required`
`queued -> downloading -> probing -> processing -> uploading -> generating_thumbnail -> complete`
`queued|downloading|probing|processing|uploading|generating_thumbnail -> failed|cancelled`

### Transcription
`not_started -> queued -> processing -> complete`
`processing -> no_audio|failed`
`not_started|queued -> skipped`

### AI
`not_started -> queued -> processing -> complete`
`processing -> failed`
`not_started|queued -> skipped`

## Non-Goals
- Multi-tenant behavior.
- Billing and subscription systems.
- Workspaces, organizations, folders, memberships, sharing policies.
- Authentication/session providers.
- Implicit polling side-effects that enqueue or mutate workflows.

## Repository Conventions
- Migrations: `db/migrations`
- Schema artifacts: `db/schema`
- API routes: `apps/web-api/src/routes`
- Worker runtime: `apps/worker/src`
- Media server: `apps/media-server/src`
- Shared libraries: `packages/*`
- Architecture and runbooks: `docs/*`

## Critical Contributor Constraints
1. Never trigger jobs from `GET` endpoints.
2. Never mutate workflow state outside transactions when multiple tables are involved.
3. Never model transitions by deleting state rows.
4. Never bypass idempotency persistence on mutating endpoints.
5. Always enforce monotonic phase/progress updates.
6. Always include `video_id` and `job_id` in operational logs where applicable.
7. Always record retry attempts and terminal dead-letter outcomes in DB.

## Job and Retry Discipline
- Claim jobs through SQL leasing only.
- Renew leases via heartbeat while work is active.
- Reclaim expired leases deterministically.
- Apply bounded exponential backoff for retries.
- Move exhausted jobs to dead-letter state; do not spin indefinitely.

## Webhook Discipline
- Verify signature before parsing business payload.
- Enforce timestamp skew window.
- Enforce delivery dedupe.
- Enforce monotonic phase/progress before applying updates.
- Persist webhook receipt and processing outcome.

## Operational Philosophy
- Deterministic state is mandatory.
- Observability is first-class and structured.
- Retries are explicit, bounded, and inspectable.
- Recovery actions are per-video and per-job, never bulk by default.
