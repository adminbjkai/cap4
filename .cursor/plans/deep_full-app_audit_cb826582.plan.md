---
name: Deep full-app audit
overview: Deep, file-specific review of cap4 with prioritized findings and a PR-sized execution plan (no code changes performed in plan mode).
todos:
  - id: audit-webhooks-parser
    content: Assess and fix webhook JSON parser override risk in web-api
    status: in_progress
  - id: audit-ops-exposure
    content: Harden docker-compose/nginx/media-server exposure and env sharp edges
    status: pending
  - id: audit-security-webhooks
    content: Harden webhookUrl input + outbound webhook delivery SSRF/auth/timeouts
    status: pending
  - id: audit-ui-a11y-perf
    content: Address modal/a11y and transcript/video ref performance hotspots
    status: pending
  - id: audit-docs-tests
    content: Align docs and tests with current behavior and schema
    status: pending
isProject: false
---

# cap4 deep full-app review (audit + fix plan + PR batches)

## Scope and method

- **Scope**: whole repo (backend `apps/web-api`, `apps/worker`, `apps/media-server`; frontend `apps/web`; ops `docker/`*, `docker-compose.yml`; docs `docs/`*; tests `apps/*/tests`, `apps/web/e2e`).
- **Priority order**: architecture/boundaries → reliability/ops → security → testing → UI/a11y → docs → performance.
- **Notes**: Findings below are concrete and file-specific; “Now/Soon/Later” is about risk/impact and effort.

## System map (what exists today)

- `**apps/web-api`**: Fastify HTTP API. Registers route modules (`system`, `videos`, `uploads`, `library`, `jobs`, `webhooks`). Uses `@cap/config` and `@cap/db`.
- `**apps/worker`**: DB-backed job queue processor (`FOR UPDATE SKIP LOCKED`) executing: `process_video` (calls media-server), `transcribe_video` (Deepgram), `generate_ai` (Groq), `cleanup_artifacts`, `deliver_webhook`.
- `**apps/media-server`**: internal ffmpeg wrapper with `POST /process` and `GET /health`; downloads from S3 and uploads result + thumbnail.
- `**apps/web`**: React/Vite UI for recording/uploading, library, and video viewing (player, transcript, AI summary).
- `**packages/config`**: Zod env parsing (currently a single schema used by all services).
- `**packages/db`**: basic pg pool helpers.
- `**packages/logger`**: pino logging + redaction helpers.

## Audit findings (prioritized)

### 1) Architecture & code structure

#### A1 — **CRITICAL**: webhook route globally overrides JSON parser (cross-cutting boundary violation)

- **Why it matters**: `webhookRoutes()` registers `app.addContentTypeParser("application/json", ...)` which affects the entire Fastify instance. That can silently change `req.body` shape/types for *all* JSON endpoints (e.g., `/api/videos`, `/api/uploads/`*). This is a “one module mutates global server behavior” smell and a high-risk bug source.
- **Impacted files**:
  - `apps/web-api/src/routes/webhooks.ts` (global parser registration)
  - `apps/web-api/src/index.ts` (raw-body plugin already present)
- **Recommended fix**:
  - Remove the global parser override.
  - Rely on `fastify-raw-body` (already registered with `global: false`) + `config: { rawBody: true }` for the webhook route.
  - If raw bytes are truly needed, scope a parser to a *custom content type* (not `application/json`).
- **When**: **Now**

Evidence:

- `apps/web-api/src/routes/webhooks.ts` line 32 registers the parser for `application/json`:

```29:33:/Users/m17/2026/gh_repo_tests/cap4/apps/web-api/src/routes/webhooks.ts
export async function webhookRoutes(app: FastifyInstance) {
  // Register a custom content-type parser that returns the raw buffer
  // This prevents Fastify from parsing/validating the JSON, allowing us to handle invalid JSON
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, async (_req: FastifyRequest, body: Buffer) => body.toString("utf8"));
```

#### A2 — **HIGH**: domain drift between services (job types and phase ranks duplicated/inconsistent)

- **Why it matters**: `JobType` and phase metadata appear in multiple places with different values. This guarantees future bugs when adding new jobs/phases (already happening).
- **Impacted files**:
  - `apps/web-api/src/lib/shared.ts` (`JobType` missing `deliver_webhook`, contains phase rank map)
  - `apps/worker/src/index.ts` (`JobType` also missing `deliver_webhook` while runtime handles it)
  - `db/migrations/0003_add_webhook_reporting.sql` (adds `deliver_webhook`)
- **Recommended fix**:
  - Create a small shared `packages/domain` exporting:
    - `JobType` union (includes `deliver_webhook`)
    - `ProcessingPhase` union + `PROCESSING_PHASE_RANK`
    - Small helpers (e.g., `phaseRank()`)
  - Import it in `web-api`, `worker`, (and optionally `media-server` for payload typing).
- **When**: **Soon** (unless you’re planning a lot of new job types soon, then Now)

Evidence:

- `apps/web-api/src/lib/shared.ts` defines `JobType` without `deliver_webhook`:

```33:33:/Users/m17/2026/gh_repo_tests/cap4/apps/web-api/src/lib/shared.ts
export type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts";
```

- `apps/worker/src/index.ts` defines the same incomplete union but later branches on `deliver_webhook`:

```10:11:/Users/m17/2026/gh_repo_tests/cap4/apps/worker/src/index.ts
type JobType = "process_video" | "transcribe_video" | "generate_ai" | "cleanup_artifacts";
```

…and later:

```1043:1046:/Users/m17/2026/gh_repo_tests/cap4/apps/worker/src/index.ts
  if (job.job_type === "deliver_webhook") {
    await handleDeliverWebhook(job);
    return;
  }
```

#### A3 — **HIGH**: `apps/web-api/src/lib/shared.ts` is accumulating too many cross-cutting concerns

- **Why it matters**: `shared.ts` contains domain constants, crypto, idempotency, transcript normalization, provider status, and S3 client factories. This is the start of a “god helper” module that becomes a dumping ground and blurs boundaries.
- **Impacted files**:
  - `apps/web-api/src/lib/shared.ts`
- **Recommended fix**:
  - Split into focused modules inside `apps/web-api/src/lib/`:
    - `domain.ts` (phase ranks/types)
    - `idempotency.ts`
    - `providers.ts` (provider status)
    - `s3.ts` (if it must stay in web-api)
    - `transcript.ts`
  - Or move truly shared domain bits into `packages/domain`.
- **When**: **Soon**

#### A4 — **MED**: idempotency handling is duplicated and inconsistent across endpoints

- **Why it matters**: Some routes use shared `idempotencyBegin/Finish`, others re-implement inline logic (`watch-edits`, `retry`). This leads to diverging semantics and makes bug-fixing harder.
- **Impacted files**:
  - `apps/web-api/src/routes/videos.ts` (`watch-edits`, `retry` inline idempotency)
  - `apps/web-api/src/lib/shared.ts` (shared idempotency helpers)
- **Recommended fix**:
  - Standardize all idempotent endpoints on the shared helper, or write a route-level helper around it.
- **When**: **Later** (unless you’re actively extending endpoints)

### 2) Reliability / ops

#### R1 — **CRITICAL**: `media-server` is exposed on host port and listens on `0.0.0.0`

- **Why it matters**: `POST /process` triggers ffmpeg + S3 reads/writes. Exposing it via `docker-compose` host ports makes it reachable from anywhere the host is reachable (DoS + abuse surface). It also has no auth.
- **Impacted files**:
  - `docker-compose.yml` (publishes `MEDIA_SERVER_PORT`)
  - `apps/media-server/src/index.ts` (listens on `0.0.0.0`)
- **Recommended fix**:
  - Remove the host `ports:` mapping for `media-server` (keep it internal to the Docker network), or bind it to `127.0.0.1` only.
  - Add a simple internal auth header shared between worker and media-server.
- **When**: **Now**

Evidence:

- `docker-compose.yml` publishes media-server:

```116:133:/Users/m17/2026/gh_repo_tests/cap4/docker-compose.yml
  media-server:
    ...
    ports:
      - "${MEDIA_SERVER_PORT:-3100}:3100"
```

- `apps/media-server/src/index.ts` listens on all interfaces:

```245:246:/Users/m17/2026/gh_repo_tests/cap4/apps/media-server/src/index.ts
await app.listen({ host: "0.0.0.0", port: env.MEDIA_SERVER_PORT });
```

#### R2 — **HIGH**: MinIO setup falls back to default root credentials

- **Why it matters**: `minio-setup` uses `${MINIO_ROOT_USER:-minio}` and `${MINIO_ROOT_PASSWORD:-minio123}`. If env is missing/misconfigured, it will attempt predictable credentials, contradicting the comment “No default credentials”.
- **Impacted files**:
  - `docker-compose.yml` (`minio-setup` entrypoint)
- **Recommended fix**:
  - Remove the `:-minio` / `:-minio123` fallbacks so failures are loud.
- **When**: **Now**

Evidence:

```55:64:/Users/m17/2026/gh_repo_tests/cap4/docker-compose.yml
  minio-setup:
    ...
    entrypoint: >
      /bin/sh -c " until mc alias set local http://minio:9000 ${MINIO_ROOT_USER:-minio} ${MINIO_ROOT_PASSWORD:-minio123}; ..."
```

#### R3 — **HIGH**: nginx does not set `X-Real-IP`, but web-api assumes it for rate limiting

- **Why it matters**: web-api rate limit key generator prefers `x-real-ip` and assumes nginx sets it, but nginx config doesn’t. This creates environment-dependent behavior and increases spoofing risk if web-api is ever reachable directly.
- **Impacted files**:
  - `apps/web-api/src/index.ts` (rate limit key generator)
  - `docker/nginx/default.conf` (missing `proxy_set_header X-Real-IP`)
- **Recommended fix**:
  - Add `proxy_set_header X-Real-IP $remote_addr;` and a sane `X-Forwarded-For` chain in `docker/nginx/default.conf`.
  - Consider configuring Fastify “trusted proxy” behavior if needed.
- **When**: **Soon**

Evidence:

- web-api assumption:

```37:42:/Users/m17/2026/gh_repo_tests/cap4/apps/web-api/src/index.ts
  // Use a consistent key regardless of X-Forwarded-For spoofing; nginx always
  // sets the real IP via proxy_set_header X-Real-IP in production.
  keyGenerator: (req: FastifyRequest) =>
    (req.headers["x-real-ip"] as string) ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip,
```

- nginx is missing those headers in `/api` location:

```23:31:/Users/m17/2026/gh_repo_tests/cap4/docker/nginx/default.conf
    location /api {
        proxy_pass http://web-api:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
```

#### R4 — **HIGH**: env schema is “one size fits all” and forces provider keys everywhere

- **Why it matters**: `@cap/config` makes `DEEPGRAM_API_KEY` and `GROQ_API_KEY` required for *every* service, including `media-server` (which doesn’t use them). This makes partial dev/prod operation brittle.
- **Impacted files**:
  - `packages/config/src/index.ts`
  - `apps/media-server/src/index.ts` (calls `getEnv()`)
- **Recommended fix**:
  - Split schemas by service: `getWebApiEnv()`, `getWorkerEnv()`, `getMediaServerEnv()`.
  - Alternatively make provider keys optional in base env and enforce only in worker.
- **When**: **Now** (it’s a recurring ops papercut and creates fragile boots)

Evidence:

```3:26:/Users/m17/2026/gh_repo_tests/cap4/packages/config/src/index.ts
const BaseEnv = z.object({
  ...
  DEEPGRAM_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  ...
});
```

### 3) Security

#### S1 — **HIGH**: outbound webhook delivery is an SSRF primitive and lacks timeout

- **Why it matters**: `POST /api/videos` accepts arbitrary `webhookUrl` with no validation. Worker `deliver_webhook` `fetch()`es it with no `AbortSignal.timeout`. With no auth on the API today, this becomes “anyone can make your server call internal endpoints”.
- **Impacted files**:
  - `apps/web-api/src/routes/videos.ts` (accepts `webhookUrl` as `String().trim()`)
  - `apps/worker/src/index.ts` (`handleDeliverWebhook`)
- **Recommended fix**:
  - Validate URLs on input (scheme allowlist; block localhost/private IP ranges; length limits).
  - Add request timeout + limited redirects.
  - Add outbound signature headers (HMAC w/ per-integration secret) so recipients can verify authenticity.
- **When**: **Now/Soon** (validation + timeout now; signing soon)

Evidence:

- Input accepts any string:

```53:60:/Users/m17/2026/gh_repo_tests/cap4/apps/web-api/src/routes/videos.ts
app.post<{ Body: { name?: string; webhookUrl?: string } }>("/api/videos", async (req, reply) => {
  ...
  const webhookUrl = req.body?.webhookUrl ? String(req.body.webhookUrl).trim() : null;
```

- Outbound webhook has no timeout:

```1065:1070:/Users/m17/2026/gh_repo_tests/cap4/apps/worker/src/index.ts
    const response = await fetch(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
```

#### S2 — **CRITICAL**: `media-server` internal endpoint has no auth (compounded by host exposure)

- **Why it matters**: Even if you remove the port publish, defense-in-depth says internal “do expensive work” endpoints should require an internal token.
- **Impacted files**:
  - `apps/media-server/src/index.ts`
  - `apps/worker/src/index.ts` (`handleProcessVideo` fetch to media-server)
  - `packages/config/src/index.ts` (no dedicated internal token today)
- **Recommended fix**:
  - Add `MEDIA_SERVER_INTERNAL_TOKEN` and require it on `/process`.
  - Worker includes `Authorization: Bearer ...` or `x-cap-internal-token` header.
- **When**: **Now**

#### S3 — **MED**: logging is inconsistent and increases secret/payload leakage risk

- **Why it matters**: worker/media-server log via `console.log(JSON.stringify(...))` and may eventually log payloads/URLs. `@cap/logger` exists with redaction but isn’t consistently used.
- **Impacted files**:
  - `apps/worker/src/index.ts`
  - `apps/media-server/src/index.ts`
  - `packages/logger/src/index.ts`
- **Recommended fix**:
  - Use `@cap/logger` in all services; standardize correlation fields (jobId, videoId, requestId).
- **When**: **Soon**

### 4) Testing & quality

#### T1 — **HIGH**: webhook e2e test uses invalid phase (`encoding`)

- **Why it matters**: The system’s valid phases are `queued/downloading/probing/processing/uploading/generating_thumbnail/complete/failed/cancelled` (see `PROCESSING_PHASE_RANK`), but the test asserts `encoding`. This either fails, is skipped, or creates false confidence.
- **Impacted files**:
  - `apps/web-api/tests/e2e/webhooks.test.ts`
  - `apps/web-api/src/lib/shared.ts`
- **Recommended fix**:
  - Update test payload/expectations to a valid phase (`processing` etc.), or update domain enum if you truly want `encoding` as a first-class phase.
- **When**: **Now**

Evidence:

```339:374:/Users/m17/2026/gh_repo_tests/cap4/apps/web-api/tests/e2e/webhooks.test.ts
const payload = { ... phase: 'encoding', progress: 80, ... };
...
expect(statusBody.processingPhase).toBe('encoding');
```

#### T2 — **MED**: missing concurrency/reclaim/lease tests for the job queue

- **Why it matters**: The worker has sophisticated leasing/reclaim logic; regressions here are catastrophic but can be subtle.
- **Impacted files**:
  - `apps/worker/src/index.ts` (claim/heartbeat/reclaim)
  - tests: currently none for this logic
- **Recommended fix**:
  - Add integration tests that run two worker loops against the same DB and ensure:
    - no duplicate processing
    - reclaim works after simulating lease expiry
    - monotonic update guards behave
- **When**: **Soon**

#### T3 — **LOW/MED**: CI workflow duplication and pnpm version mismatch

- **Why it matters**: increases CI fragility; inconsistent tooling versions.
- **Impacted files**:
  - `.github/workflows/ci.yml`, `.github/workflows/test.yml`
- **Recommended fix**:
  - Consolidate or harmonize versions.
- **When**: **Later**

### 5) UI/UX & accessibility

#### U1 — **CRITICAL**: modal/dialog accessibility incomplete (no semantics/focus management)

- **Why it matters**: keyboard and screen reader users can get trapped or lose focus; dialogs aren’t announced properly.
- **Impacted files**:
  - `apps/web/src/components/ConfirmationDialog.tsx`
- **Recommended fix**:
  - Implement a shared modal primitive (focus trap, restore focus, `role="dialog" aria-modal`, Escape handling, backdrop click behavior).
  - Refactor `ConfirmationDialog` to use it.
- **When**: **Now**

Evidence:

- Current `ConfirmationDialog` is just divs; no `role`, no focus mgmt:

```26:48:/Users/m17/2026/gh_repo_tests/cap4/apps/web/src/components/ConfirmationDialog.tsx
return (
  <div className="dialog-backdrop ...">
    <div className="dialog-surface ...">
      ...
    </div>
  </div>
);
```

#### U2 — **HIGH**: Command palette lacks ARIA combobox/listbox semantics and focus trap

- **Why it matters**: AT users can’t understand the active option; focus can escape.
- **Impacted files**:
  - `apps/web/src/components/CommandPalette.tsx`
- **Recommended fix**:
  - Implement ARIA combobox pattern (combobox + listbox + options + `aria-activedescendant`).
  - Add focus trap (same modal primitive).
- **When**: **Soon**

#### U3 — **HIGH**: Transcript uses `document.querySelector('video')` polling (fragile boundaries + perf)

- **Why it matters**: wrong video element risk + constant state updates every 250ms; large transcripts will stutter.
- **Impacted files**:
  - `apps/web/src/components/TranscriptCard.tsx` (polling interval)
  - likely `apps/web/src/pages/VideoPage.tsx` (active video element logic, per prior scan)
- **Recommended fix**:
  - Pass a single `videoRef` down (or via context) from the player.
  - Subscribe to `timeupdate` on that ref; update state only when active line changes.
- **When**: **Soon**

Evidence:

```121:131:/Users/m17/2026/gh_repo_tests/cap4/apps/web/src/components/TranscriptCard.tsx
useEffect(() => {
  const interval = window.setInterval(() => {
    const player = document.querySelector('video');
    ...
    setObservedPlaybackTime(next);
  }, 250);
  return () => window.clearInterval(interval);
}, []);
```

#### U4 — **MED**: nested interactive elements (`role="button"` inside `role="button"`) in transcript lines

- **Why it matters**: keyboard and screen reader confusion; event propagation bugs.
- **Impacted files**:
  - `apps/web/src/components/TranscriptCard.tsx`
- **Recommended fix**:
  - Avoid `role="button" tabIndex=0` patterns for major clickable rows; use proper `<button>` or simplify structure.
- **When**: **Soon**

Evidence: transcript line container + speaker badge both use `role="button"`.

### 6) Docs & onboarding

#### D1 — **HIGH**: `ARCHITECTURE.md` is substantially out of sync with actual schema and flow

- **Why it matters**: It describes `jobs` table, phase names, and webhook paths that don’t exist. This undermines trust and creates incorrect mental models.
- **Impacted files**:
  - `ARCHITECTURE.md`
  - source-of-truth code/docs: `docs/DATABASE.md`, `docs/api/ENDPOINTS.md`, `apps/web-api/src/routes/*`, `apps/worker/src/index.ts`
- **Recommended fix**:
  - Rewrite to match current DB (`job_queue`, `processing_phase_rank`), actual phases, and current webhook model.
- **When**: **Soon**

#### D2 — **HIGH**: `docs/api/WEBHOOKS.md` describes APIs/headers/events that don’t exist

- **Why it matters**: It talks about `/api/webhooks` registration, `X-Webhook-*` headers, and many event names. The current system stores a `videos.webhook_url` and worker posts minimal payload with no signature.
- **Impacted files**:
  - `docs/api/WEBHOOKS.md`
  - actual code: `apps/web-api/src/routes/videos.ts`, `apps/worker/src/index.ts`
- **Recommended fix**:
  - Either delete/replace with accurate docs, or clearly label as “future design”.
- **When**: **Now/Soon** (depends if external integration is active)

#### D3 — **MED**: `docs/ops/DEPLOYMENT.md` env vars and migration flow are stale

- **Why it matters**: It suggests `API_PORT`, `DB_HOST`, `npm run migrate`, etc. Current repo uses `DATABASE_URL`, auto-migrations via compose `migrate` service.
- **Impacted files**:
  - `docs/ops/DEPLOYMENT.md`
  - actual: `docker-compose.yml`, `packages/config/src/index.ts`, `.env.example`
- **Recommended fix**:
  - Rewrite deployment env section to match current reality.
- **When**: **Soon**

### 7) Performance & scalability

#### P1 — **HIGH**: TranscriptCard has a clear performance cliff on large transcripts

- **Why it matters**: 250ms polling + frequent rerenders + O(n) scans; will degrade with long videos.
- **Impacted files**:
  - `apps/web/src/components/TranscriptCard.tsx`
- **Recommended fix**:
  - Remove polling; event-driven updates via a single player ref; consider virtualization if transcripts can be huge.
- **When**: **Soon**

#### P2 — **MED**: worker `fetch` to media-server `/process` has no timeout

- **Why it matters**: a hung request can tie up worker throughput and delay retries.
- **Impacted files**:
  - `apps/worker/src/index.ts` (`handleProcessVideo`)
- **Recommended fix**:
  - Use `AbortSignal.timeout(...)` or a configured timeout, similar to the existing `isMediaServerHealthy()`.
- **When**: **Soon**

## Top 10 highest-value fixes

1. **Remove global JSON parser override** in `apps/web-api/src/routes/webhooks.ts` (A1) — prevents broad regressions.
2. **Stop exposing media-server** to host network; keep internal and add token auth (R1 + S2).
3. **Validate webhook URLs + add timeouts** for outbound webhook delivery (S1).
4. **Fix webhook e2e test invalid phase** (`encoding`) (T1).
5. **Remove MinIO default credential fallback** in `docker-compose.yml` (R2).
6. **Split env schema per service** so media-server can run without AI keys (R4).
7. **Add nginx real IP headers** to match rate limiting assumptions (R3).
8. **Create `packages/domain`** for job types + phase ranks and de-duplicate (A2).
9. **Implement a11y modal primitive** and refactor `ConfirmationDialog` + `CommandPalette` (U1/U2).
10. **Fix TranscriptCard player ref + polling removal** (U3/P1).

## Recommended execution order

- **Blockers / high blast radius first**: A1 → R1/S2 → S1 → T1
- **Ops correctness**: R2 → R4 → R3
- **Architecture cleanup enabling safer changes**: A2 → A3 → A4
- **UX/a11y + perf**: U1/U2 → U3/P1
- **Docs alignment once reality is fixed**: D2 → D1 → D3

## PR-ready implementation plan (small commit batches)

### Batch 1 — Webhook parsing correctness (A1)

- **Changes**:
  - Remove global `addContentTypeParser('application/json', ...)` from `apps/web-api/src/routes/webhooks.ts`.
  - Ensure webhook route still uses `rawBody` via `fastify-raw-body` (already registered in `apps/web-api/src/index.ts`).
- **Files**: `apps/web-api/src/routes/webhooks.ts`, possibly `apps/web-api/src/index.ts`.

### Batch 2 — Fix webhook test phase drift (T1)

- **Changes**:
  - Update `apps/web-api/tests/e2e/webhooks.test.ts` to use valid phases (`processing`, etc.) and assert accordingly.
- **Files**: `apps/web-api/tests/e2e/webhooks.test.ts`.

### Batch 3 — Lock down media-server exposure + add internal auth (R1, S2)

- **Changes**:
  - Remove host port mapping for `media-server` in `docker-compose.yml` (or bind to localhost).
  - Add `MEDIA_SERVER_INTERNAL_TOKEN` and require it in `apps/media-server/src/index.ts`.
  - Worker supplies header in `apps/worker/src/index.ts` when calling `/process`.
- **Files**: `docker-compose.yml`, `apps/media-server/src/index.ts`, `apps/worker/src/index.ts`, `packages/config/src/index.ts` (or new per-service config).

### Batch 4 — Harden MinIO setup credentials (R2)

- **Changes**:
  - Remove default fallbacks for `MINIO_ROOT_USER/PASSWORD` in `minio-setup` entrypoint.
- **Files**: `docker-compose.yml`.

### Batch 5 — Outbound webhook security + reliability (S1)

- **Changes**:
  - Validate `webhookUrl` at input in `apps/web-api/src/routes/videos.ts`.
  - Add `fetch` timeout + redirect limits in `apps/worker/src/index.ts` (`handleDeliverWebhook`).
  - Add outbound signature headers (new secret management design).
- **Files**: `apps/web-api/src/routes/videos.ts`, `apps/worker/src/index.ts`, docs (`docs/api/ENDPOINTS.md`, `docs/api/WEBHOOKS.md`).

### Batch 6 — Proxy header correctness for rate limiting (R3)

- **Changes**:
  - Add `proxy_set_header X-Real-IP $remote_addr;` and `X-Forwarded-For` in `docker/nginx/default.conf`.
- **Files**: `docker/nginx/default.conf`.

### Batch 7 — Split config per service (R4) + add S3 vars to schema

- **Changes**:
  - Create service-specific env schemas; make provider keys required only for worker.
  - Add S3 config to env parsing (currently scattered across services).
- **Files**: `packages/config/src/index.ts` (or split into modules), plus service call sites.

### Batch 8 — Domain package for shared enums and ranks (A2)

- **Changes**:
  - Add `packages/domain` (job types, phases, rank maps) and replace duplicates in web-api + worker.
- **Files**: new `packages/domain/`*, plus `apps/web-api/src/lib/shared.ts`, `apps/worker/src/index.ts`.

### Batch 9 — UI modal primitive + a11y fixes (U1, U2)

- **Changes**:
  - Add reusable modal component with focus trap and correct ARIA.
  - Refactor `ConfirmationDialog` and `CommandPalette` to use it; implement combobox/listbox semantics.
- **Files**: `apps/web/src/components/`*.

### Batch 10 — Transcript player ref plumbing + perf improvements (U3, P1)

- **Changes**:
  - Remove `document.querySelector('video')` polling.
  - Pass a stable `videoRef` through context/props; update active line updates to be event-driven.
- **Files**: `apps/web/src/components/TranscriptCard.tsx`, `apps/web/src/pages/VideoPage.tsx`, player component.

### Batch 11 — Docs alignment pass (D1–D3)

- **Changes**:
  - Rewrite `docs/api/WEBHOOKS.md` to match actual behavior (or mark as future).
  - Update `ARCHITECTURE.md` to current tables/phases.
  - Update `docs/ops/DEPLOYMENT.md` to match `DATABASE_URL` + migration runner.
- **Files**: `docs/api/WEBHOOKS.md`, `ARCHITECTURE.md`, `docs/ops/DEPLOYMENT.md`.

