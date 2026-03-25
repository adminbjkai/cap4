---
title: "Tasks"
description: "Current project status and completed milestone summary"
---

# Tasks — cap4

**Last updated:** 2026-03-24

This file is a current status snapshot, not a speculative roadmap.

---

## Current Status

- Full audit phases A-F are complete
- Documentation is aligned to the checked-in code paths and current scripts/workflows
- The repo is in a single-tenant, no-auth state by design

Current verification baseline:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm --filter @cap/web test:e2e`
- `pnpm --filter @cap/web-api test:e2e`
- `pnpm db:migrate`
- `make smoke` against a running stack

---

## Completed Milestones

### Phase 4.7 — UI and Workflow Sprint

- BJK-9 through BJK-18 shipped
- custom controls, transcript search, confidence review, speaker diarization, editable speaker labels, summary enrichments, command palette, and theme refresh are in the repo

### Phase 4.5 — Docker and Config Audit

- automatic migrations on startup
- corrected local-dev and URL-routing documentation
- corrected smoke path and Compose startup behavior

### Phase 4 — Integration Coverage

- end-to-end upload -> process -> transcript -> AI integration coverage added
- API contract coverage for uploads, videos, jobs, library, webhooks, and health endpoints
- dedicated web and API Playwright E2E paths are part of the current CI workflow

### Phase 3 — Hardening

- rate limiting, nginx hardening, Fastify v5, secret redaction, idempotency tightening

### Earlier Platform Work

- API split from the old monolith into route modules
- GitHub repo and CI workflows established
- historical audit artifacts cleaned out of the product repo

---

## Deferred / Out Of Scope

- end-user authentication
- accessibility follow-up beyond the currently shipped state

These are intentionally not expanded here into a roadmap.

---

## Historical References

Use these only for historical context:

- [docs/archive/audit-plan.md](archive/audit-plan.md)
- [docs/archive/roadmap.md](archive/roadmap.md)
