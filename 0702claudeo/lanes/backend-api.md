# Lane brief — Backend API & shared packages (apps/web-api, packages/*)

> Produced 2026-07-02 by a fresh-context review agent (Sonnet) as part of the 0702 full audit. Read-only.

# Backend API & Shared Packages — Audit Brief

## 1. Summary + Grade

**Grade: B+** — Well-architected, defense-in-depth API layer (idempotency, monotonic state machine, HMAC webhook verification, transactional job enqueueing) let down by an incomplete SSRF blocklist, S3 config that bypasses the centralized env validator, and a test suite that is comprehensive but **not actually exercised in CI**.

## 2. Impressive Strengths

- **Idempotency-key framework** (`apps/web-api/src/lib/shared.ts:450-513`) — generic `idempotencyBegin`/`idempotencyFinish` used consistently across mutating routes, with request-hash mismatch detection (409 on key reuse with different payload) and expiry cleanup. Genuinely solid engineering for a hand-rolled (no framework) implementation.
- **Monotonic webhook state machine** (`apps/web-api/src/routes/webhooks.ts:118-148`) — the `UPDATE ... WHERE $3::smallint > v.processing_phase_rank OR (...)` guard, backed by a DB `CHECK` constraint pinning `processing_phase` to `processing_phase_rank` (`db/migrations/0001_init.sql:112-123`), makes out-of-order/duplicate webhook delivery provably safe. Double-layered dedupe (`ON CONFLICT (source, delivery_id)` + a second unique index on `(source, job_id, phase, progress_bucket)`, caught via `err.code === '23505'`, `webhooks.ts:92-105`) is a nice touch most teams skip.
- **Job queue design** — partial unique index `uq_job_queue_one_active_per_video_type` (`0001_init.sql:187-189`) plus `ON CONFLICT ... DO UPDATE` upserts prevents duplicate active jobs per (video, type) without app-level locking; `chk_job_queue_lease_consistency` CHECK constraint enforces lock-field consistency at the DB level.
- **Webhook auth** — HMAC-SHA256 over `timestamp.rawBody`, constant-time compare via a manual zero-padded `timingSafeEqual` (`shared.ts:164-181`) that correctly avoids the throw-on-length-mismatch pitfall of Node's native `crypto.timingSafeEqual`.
- **`/api/library/videos`** keyset (cursor) pagination (`library.ts:33-79`) uses a proper composite-tuple comparison, correctly handles asc/desc via a single parameterized query rather than duplicated SQL branches — avoids the classic offset-pagination performance trap.

## 3. Issues, ranked by severity

**HIGH — SSRF blocklist is an incomplete denylist, not a real defense** (`apps/web-api/src/routes/videos.ts:68-81`). `webhookUrl` validation only rejects an exact-match hostname list (`localhost, 127.0.0.1, 0.0.0.0, ::1, minio, postgres, media-server, web-api, worker`) plus `.internal`/`.local` suffixes. It does **not** block private/link-local IP literals (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or the cloud metadata address `169.254.169.254`. An unauthenticated caller (no auth is by design) can set `webhookUrl: "http://169.254.169.254/latest/meta-data/..."` or any internal Docker-network IP; when `deliver_webhook` fires it becomes a server-side request. Given this app has no auth layer at all, this is the most exploitable finding. Fix: resolve+validate the hostname against RFC1918/link-local/loopback CIDR ranges (allowlist over denylist), and re-validate at delivery time in the worker (the payload originates here).

**MEDIUM — S3 credentials/config bypass the centralized env validator** (`apps/web-api/src/lib/shared.ts:397-444`). Every other secret is validated fail-fast via zod in `packages/config/src/index.ts` (`getEnv()`), but `getS3ClientAndBucket`/`getInternalS3ClientAndBucket` read `process.env.S3_*` directly with silent fallbacks (`S3_PUBLIC_ENDPOINT ?? "http://localhost:9000"`, `S3_REGION ?? "us-east-1"`) and only throw at first-use if creds are missing. A misconfigured prod deploy won't fail at boot — it'll fail on the first user's upload attempt, mid-request. Fix: add `S3_ENDPOINT/S3_PUBLIC_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET` to the zod schema in `packages/config`.

**LOW/DESIGN — `multipart/presign-part` and `multipart/abort` require an `Idempotency-Key` header but never enforce it** (`apps/web-api/src/routes/uploads.ts:274-306`, `409-446`). `requireIdempotencyKey` only checks presence; unlike every other mutating route, neither calls `idempotencyBegin`/`idempotencyFinish`. Functionally harmless (presigning is side-effect-free; abort is naturally idempotent at the S3 layer), but it's a misleading API contract — clients are told a key is required for dedup that never happens. Either implement it or drop the requirement.

**LOW — code duplication / drift risk in `videos.ts`**: `PATCH /watch-edits` (lines 368-399) and `POST /retry` (lines 583-607) hand-roll the idempotency insert/lookup logic inline instead of calling the shared `idempotencyBegin`/`idempotencyFinish` helpers used everywhere else (`uploads.ts`, `videos.ts` POST/delete). Behaviorally equivalent today, but any future fix to the shared helper (e.g., the TTL-expiry cleanup) won't propagate to these two call sites.

**LOW — `GET /api/jobs/:id` and `/debug/job/:id` leak internal job-queue fields** (`jobs.ts:20-46`, `system.ts:269-288`), including `locked_by` (worker id) and `lease_token` (a UUID used internally for lease ownership), to any caller with no auth. Since there's no HTTP path that accepts a client-supplied `lease_token` to act on a job, this doesn't appear directly exploitable, but it's unnecessary infrastructure exposure — worth trimming the response shape.

## 4. Should-have-been-different

- **No request-body size/shape validation via a schema library** (zod/typebox) on route bodies — every route manually does `String(req.body?.x ?? ...)` coercion. Works, but is easy to get subtly wrong (e.g., `watch-edits` accepts `speakerLabels` as an arbitrary object with no cap on key count before `normalizeSpeakerLabels` runs — `videos.ts:30-41` — unbounded input size before the 80-char-per-label truncation).
- **`webhookUrl` and doc-pipeline routes rely on separate ad-hoc UUID regexes** (`docs.ts:14`) rather than a shared validator, despite `decodeLibraryCursor` in `shared.ts:319` having its own copy too — three near-identical UUID regexes across the codebase.
- **Debug routes are gated only by `NODE_ENV !== "production"`** (`system.ts:248`) with no additional guard (e.g., a debug-token). If `NODE_ENV` is ever misconfigured on a reachable host, `/debug/jobs/enqueue` lets anyone enqueue arbitrary job types with arbitrary payloads against any video.

## 5. Test Coverage Assessment

The **e2e Playwright suite is genuinely thorough** — 2,365 lines across `uploads.test.ts` (multipart lifecycle, idempotency, error paths), `videos.test.ts`, `webhooks.test.ts` (HMAC, skew, dedupe, malformed payloads), `library.test.ts`, `jobs.test.ts` — plus a 613-line integration test covering the full upload→transcode→transcribe→AI pipeline and `/health`/`/ready`.

**However, none of it runs in CI.** `apps/web-api/package.json`'s `test` script (`vitest run --passWithNoTests`) is scoped by `vitest.config.ts` to `src/**/*.test.ts` only — i.e. `apps/web-api/src/lib/shared.test.ts`, a set of pure-function unit tests (cursor encoding, timestamp normalization). `.github/workflows/ci.yml`'s `test` job runs exactly this and explicitly comments that `test:integration`/`test:e2e` are "intentionally out of CI" because they need a live Docker stack + paid provider keys. That means **every route handler in this lane — videos.ts, uploads.ts, webhooks.ts, library.ts, jobs.ts, and the entirety of docs.ts and system.ts (zero test files exist for either)** — has no automated regression coverage; correctness depends on someone remembering to run the Playwright suite locally before merging. This is a reasonable cost/tradeoff for a single-tenant, no-CI-budget project, but it should be flagged as the single biggest gap between "looks well-tested" and "is verified on every push."

**Key files:** `apps/web-api/src/routes/videos.ts`, `apps/web-api/src/routes/webhooks.ts`, `apps/web-api/src/routes/uploads.ts`, `apps/web-api/src/lib/shared.ts`, `packages/config/src/index.ts`, `db/migrations/0001_init.sql`, `.github/workflows/ci.yml`, `apps/web-api/vitest.config.ts`.
