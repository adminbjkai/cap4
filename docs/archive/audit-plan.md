# Audit & Fix Plan — cap4

**Created:** 2026-03-19
**Status:** Phases A-E completed on 2026-03-19; selected Phase F items completed
**Audited by:** Claude Opus 4.6 + Codex (independent reviews, findings merged)

---

## Overview

Full-app audit covering runtime correctness, build infrastructure, frontend state, documentation accuracy, and repo hygiene. Findings are ordered by the real dependency chain: fix runtime bugs first so verification is meaningful, restore build/test infrastructure second, then fix frontend state bugs, then align docs to code truth, then clean up files.

---

## Phase A — Runtime/Job Correctness

**Status:** `completed`
**Exit criteria:** No verified queue/runtime corruption bugs remain.

### A1. Worker: 6 unacknowledged skip paths (CRITICAL)

When a job handler hits a skip condition (video deleted, already complete, no audio, etc.), it returns without calling `ack()`. The job stays `leased`, the lease expires, `reclaimExpiredLeases()` requeues it, and it retries forever — burning cycles on work that will never succeed.

| # | Handler | File | Lines | Skip Reason |
|---|---------|------|-------|-------------|
| 1 | `handleProcessVideo` | `apps/worker/src/index.ts` | 462-464 | Video deleted or already complete |
| 2 | `handleProcessVideo` | `apps/worker/src/index.ts` | 497-500 | Deleted during finalize |
| 3 | `handleProcessVideo` | `apps/worker/src/index.ts` | 548-552 | Transcription not needed |
| 4 | `handleTranscribeVideo` | `apps/worker/src/index.ts` | 697-715 | Empty transcript (no audio) |
| 5 | `handleGenerateAi` | `apps/worker/src/index.ts` | 885-891 | AI skip conditions met |
| 6 | `handleGenerateAi` | `apps/worker/src/index.ts` | 899-917 | Parsed transcript empty |

**Fix:** Add `await withTransaction(env.DATABASE_URL, async (c) => ack(c, job))` before each early return.

- [x] Fix all 6 skip paths
- [x] Verify no other unacked return paths exist

### A2. Webhook INSERT violates unique active-job index (HIGH)

`deliver_webhook` jobs are inserted without `ON CONFLICT` handling. The unique index `uq_job_queue_one_active_per_video_type` (migration 0001) allows only one active `(video_id, job_type)` row. If a prior webhook job is still queued/leased/running, the new INSERT throws a constraint violation and **rolls back the parent transaction** — marking the successful transcribe/AI job as failed.

| Location | Event |
|----------|-------|
| `apps/worker/src/index.ts:776-780` | After transcription complete |
| `apps/worker/src/index.ts:1001-1005` | After AI complete |

**Fix:** Add `ON CONFLICT (video_id, job_type) WHERE status IN ('queued','leased','running') DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`.

- [x] Fix both INSERT statements
- [x] Verify other job insertions already have ON CONFLICT (they do: lines 584-585, 808-809)

### A3. `/retry` uses invalid enum values (HIGH)

The retry endpoint queries `job_queue.status IN ('failed', ...)` but `job_status` enum is: `queued | leased | running | succeeded | cancelled | dead`. There is no `'failed'` value. PostgreSQL will throw an enum cast error at runtime.

| File | Lines | Issue |
|------|-------|-------|
| `apps/web-api/src/routes/videos.ts` | 515, 534 | `'failed'` not in `job_status` enum |

**Fix:** Remove `'failed'` from the `IN` clause. The equivalent terminal failure state is `'dead'`.

- [x] Fix job_queue status filter on lines 515 and 534

### A4. `/retry` checks `'dead'` against wrong enum (MEDIUM)

Lines 506 and 525 check `["failed", "dead", "not_started"].includes(video.transcription_status)` and same for `ai_status`. The `'dead'` value only exists in `job_status`, not in `transcription_status` or `ai_status` enums. This branch will never match — it's dead code, not a crash, but the intent was to catch terminal failures.

| File | Lines | Issue |
|------|-------|-------|
| `apps/web-api/src/routes/videos.ts` | 506, 525 | `'dead'` not in transcription_status/ai_status |

**Fix:** Remove `'dead'` from the video status checks. The correct terminal failure for these enums is `'failed'`.

- [x] Clean up status checks on lines 506 and 525

---

## Phase B — Verification Infrastructure

**Status:** `completed`
**Exit criteria:** `pnpm build`, `pnpm typecheck`, and `pnpm test` pass. `pnpm lint` passes with warnings only.

### B1. Missing root `tsconfig.json` breaks ESLint

`eslint.config.js:15` references `project: './tsconfig.json'` with `tsconfigRootDir: import.meta.dirname`. No root tsconfig exists. All lint commands fail.

- [x] Create root `tsconfig.json` with project references to each app
- [x] Verify `pnpm lint` passes on errors

### B2. Groq test asserts stale return shape

`apps/worker/src/providers/groq.test.ts:55` uses `toEqual()` but omits `chapters`, `entities`, `actionItems`, `quotes` fields that `groq.ts:334` now always returns.

- [x] Update test assertion to match full return shape

### B3. Root test scripts incomplete

Root `pnpm test` doesn't cover web-api (which uses Playwright). No unified `test:e2e` script exists.

- [x] Add `test:e2e` script to root `package.json`
- [ ] Document test commands in README

### B4. Verify dist/ excluded from test discovery

Confirm vitest configs in all apps properly ignore `dist/` and `node_modules/`.

- [x] Audit vitest.config.ts in each app

---

## Phase C — Frontend Correctness

**Status:** `completed`
**Exit criteria:** No cross-video state leakage; no user-facing state bugs remain.

### C1. Verified-segments localStorage key bleeds across videos (HIGH)

`TranscriptCard.tsx:110` derives the key from `transcript?.vttKey?.split('/')[0]` which resolves to `"videos"` for every transcript. All videos share the same verification state.

- [x] Pass `videoId` as a prop to TranscriptCard
- [x] Use `videoId` directly in the localStorage key

### C2. Verified segments don't reset on video navigation

`TranscriptCard.tsx:112-119` — `useState` initializer captures the key at first render. Navigating between videos doesn't reinitialize state.

- [x] Add `useEffect` that resets `verifiedSegments` when `videoId` changes
- [x] Re-read from localStorage with new key on change

### C3. Speaker label edit state not cleared on save failure

`TranscriptCard.tsx:482-500` — if `onSaveSpeakerLabels` fails, the edit form stays open with stale draft text and no clear recovery path.

- [x] Call `cancelSpeakerEdit()` in the error branch

### C4. Polling may continue after failed delete

`VideoPage.tsx:281-287` — polling only gates on `isDeleted`, not `isDeleting`. If the delete API call fails, polling may race on a resource being torn down.

- [x] Add `isDeleting` check to polling guard

---

## Phase D — Docs Truth Pass

**Status:** `completed`
**Exit criteria:** One source of truth per topic. No contradictory docs. Every doc reflects current code.

**Approach:** Rewrite from code outward, not from old docs inward.

### D1. `docs/api/WEBHOOKS.md` — Major rewrite needed

Lines 52-65 document a webhook **registration** endpoint that doesn't exist. Lines 383-417 document CRUD endpoints (`GET/POST/PATCH/DELETE /api/webhooks`) that don't exist. Webhooks are one-way: media-server -> web-api only.

- [x] Rewrite to document actual incoming webhook contract only
- [x] Remove all references to non-existent registration/management endpoints

### D2. `docs/api/ENDPOINTS.md` — `GET /api/playlist` stub decision

The endpoint IS implemented as a 501 stub (`videos.ts:369-372`). Docs should either document it as intentionally stubbed or the stub should be removed.

- [x] Document as "501 stub — pending implementation"

### D3. `CONTRIBUTING.md` — Placeholder content

- Maintainer section lists `@yourname` / `@othername`
- References `CODE_OF_CONDUCT.md` (doesn't exist)
- References `CHANGELOG.md` (doesn't exist)

- [x] Update maintainer to `@adminbjkai`
- [x] Remove references to non-existent files

### D4. `.env.example` vs `CAP4_MASTER_PLAN.md` — Model name mismatch

`.env.example` says `llama-3.3-70b-versatile`. Master plan says `llama-3.1-8b-instant`.

- [x] Align to whichever model is actually configured in production

### D5. `ARCHITECTURE.md` — Verify accuracy

Check state machine description, service count/names, and job flow against current docker-compose and code.

- [x] Audit and update as needed

### D6. `ROADMAP.md` — Archive

Self-declares as superseded by `CAP4_MASTER_PLAN.md`.

- [x] Move to `docs/archive/ROADMAP.md`

### D7. `docs/ui/DESIGN.md` — Merge or archive

Minimal (~50 lines), duplicated by the much more complete `DESIGN_SYSTEM.md`.

- [x] Merge useful content into `DESIGN_SYSTEM.md`, then delete `DESIGN.md`

### D8. `TASKS.md` — Update

Currently shows Phase 5 Auth as next. Needs to reflect audit work as active.

- [ ] Update to show audit phases as active work (done — see TASKS.md)

---

## Phase E — Repo Hygiene Cleanup

**Status:** `completed`
**Exit criteria:** No tracked junk, no orphaned references, no ambiguous "authoritative" duplicates.

### E1. Delete `main` (root, 0 bytes)

Empty file at repo root. No purpose.

- [x] `git rm main`

### E2. Remove tracked `.DS_Store` files

macOS metadata files are in `.gitignore` but already tracked in git index.

- [x] Verify no tracked `.DS_Store` files remained
- [x] Verify .gitignore covers them

### E3. `.cursor/` — gitignore policy

IDE config directory. Should not be tracked.

- [x] Add `.cursor/` to `.gitignore`
- [x] `git rm --cached` tracked `.cursor` plan file

### E4. `Cap_for_reference_only/` — External archive decision

Already gitignored, not tracked. Only referenced once in `CAP4_MASTER_PLAN.md` (historical context). ~1.2GB on disk.

- [ ] Owner decision: keep locally or archive externally
- [ ] Update master plan reference if removed from disk

### E5. `samplevids/` — Review contents

`vid0.mp4` is used by integration tests. Review other video files for removal.

- [x] Keep `vid0.mp4`
- [x] Review and remove unused sample videos

---

## Phase F — Optional Hardening

**Status:** `completed` for F1-F5 and F7. F6 and F8 remain deferred.
**Exit criteria:** Selected hardening items completed; deferred items explicitly noted.

| # | Item | File | Notes |
|---|------|------|-------|
| F1 | Add idempotency to `presign-part` | `uploads.ts:256` | Completed |
| F2 | Add idempotency to `multipart/abort` | `uploads.ts:365` | Completed |
| F3 | Watch-edits: preserve speaker_labels when only transcript updated | `videos.ts:318-323` | Completed |
| F4 | Standardize idempotency validation (helper vs inline) | `videos.ts:220,453` | Completed |
| F5 | `GET /api/playlist` — keep or remove stub | `videos.ts:369-372` | Removed |
| F6 | Auth planning (Phase 5) | N/A | Deferred by owner |
| F7 | Title length validation on watch-edits | `videos.ts:232` | Completed |
| F8 | Accessibility: aria-labels on icon buttons | `VideoPage.tsx` | Deferred |

---

## Reference: Audit Sources

- **Codex review** (2026-03-19): Full-app code audit covering worker, API, frontend, tests
- **Claude Opus 4.6 review** (2026-03-19): Independent parallel audit — worker (8 findings), API/DB (12 findings), frontend (20 findings), repo hygiene (15+ findings)
- **Cross-validated:** All critical findings confirmed by both reviewers with line-number verification
