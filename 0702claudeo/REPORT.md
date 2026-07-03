# cap4 — Full Repo + Infrastructure Review (2026-07-02)

**Scope:** entire repo (~20k lines of TypeScript, 87 commits, pnpm monorepo: web, web-api, worker, media-server + 3 shared packages), the two-layer nginx setup (host + container), Docker/CI/deploy mechanics, and the **live production stack** at cap4.bjk.ai (logs, database, cron, processes, disk).
**Method:** five independent fresh-context review agents (backend API, worker/media-server/doc-pipeline, frontend, infra/nginx/CI/deploy, live runtime health), cross-checked and synthesized. Full lane briefs with file:line evidence are in `lanes/`. **Read-only — nothing was changed in this run.**

---

## Overall grade: **B+ / A-** (≈ 3.5)

| Lane | Grade | One-liner |
|---|---|---|
| Backend API + packages | B+ | Defense-in-depth API (idempotency, monotonic state machine, HMAC webhooks) with an incomplete SSRF denylist and tests that don't run in CI |
| Worker / media-server / doc pipeline | B+ | Unusually rigorous job queue + genuinely smart LLM cost engineering; media-server has zero tests |
| Frontend | B+ | Mature race/upload handling and real code-splitting for exports; oversized untested components, no route splitting, one real a11y gap |
| Infra / nginx / CI / deploy | B- | Excellent attack-surface minimization and a sound two-layer nginx design, undermined by hot-swap deploy drift and a fictional deployment doc |
| Live runtime health | Degraded (not broken) | Stack healthy and drained, but the hourly maintenance sweep has silently failed for ~100 days, disabling the stuck-video watchdog |

**Verdict in one paragraph:** For a single-developer, single-tenant project, cap4's *code* is remarkably close to professional production quality — the job queue, webhook state machine, idempotency layer, and doc-pipeline cost controls are things most small teams never build correctly. What drags the grade down is not the code but the **operational layer**: a deploy mechanism that lets three copies of the code (container image, hot-swapped dist, host doc-worker) drift to different commits with no machine-checkable record; a silent hourly error that nobody noticed for 100+ days because logs are written but never watched; and documentation where the most safety-critical file (`docs/deployment.md`) is outright fiction. The pattern: **great at building, weaker at knowing what's actually running.**

---

## What's genuinely impressive

1. **The job queue** (`apps/worker/src/index.ts:128-268`) — Postgres `FOR UPDATE SKIP LOCKED` with lease tokens scoping every ack/fail (a reclaimed job can't be double-acked by its original owner), exponential backoff, and a `snooze()` primitive that requeues without burning a retry attempt — used to defer transcription while a transcode is hogging CPU. This is textbook-correct distributed-systems work, hand-rolled with no Redis/broker.
2. **The webhook state machine** (`apps/web-api/src/routes/webhooks.ts:118-148` + `db/migrations/0001_init.sql:112-123`) — monotonic phase-rank guard in the UPDATE itself, a DB CHECK constraint pinning phase↔rank, and *two* layers of dedupe (delivery-id + progress-bucket unique indexes). Out-of-order/duplicate webhook delivery is provably safe, at the database level, not just in app code.
3. **Doc-pipeline economics** (`apps/worker/src/doc/`) — one strong-model call per recording regardless of length, SHA-256 result cache, per-job and per-day call budgets, hallucinated-frame-ref validation with exactly one corrective retry then drop-with-note, and a deterministic screenshot budget (max 6/doc, 2/frame, slivers widened). This is what responsible LLM integration looks like; most codebases have none of it.
4. **The idempotency framework** (`apps/web-api/src/lib/shared.ts:450-513`) — generic begin/finish helpers with request-hash mismatch detection (409 on key reuse with a different payload). Hand-rolled and consistent across most mutating routes.
5. **Frontend upload engineering** (`apps/web/src/lib/api.ts:361-491`) — `LiveMultipartUploader` streams MediaRecorder chunks to S3 multipart parts *during* recording, retries parts with fresh presigned URLs, serializes the chain, and falls back cleanly to whole-blob upload. Plus adaptive status polling (`?view=summary`, backoff, visibilitychange pause) that most production apps don't bother with.
6. **Attack-surface discipline, verified live** — the only host-published port in the whole stack is `127.0.0.1:8007` on the container nginx; postgres/minio/web-api/worker/media-server publish nothing. Secrets are out of git; the host nginx carries a low-noise secret-probe blocklist; every ffmpeg/claude invocation is `spawn(bin, argsArray)` — zero shell-injection surface.
7. **The two-layer nginx design itself is sound** — host layer owns TLS + one upstream port; container layer owns all cap4 routing (`/api`, `/cap4/`→MinIO, static SPA). Verified byte-identical between repo and running container — no drift at the nginx layer.
8. **Honest engineering records** — DECISIONS.md logging *why* calls were made (with owner-feedback reversals like prompt v2→v3), plans/ with executed remediation plans, memory files for operational gotchas. Rare discipline for a solo project.

---

## Confirmed issues, ranked (the "fix these" list)

### P0 — real bugs / real exposure

**1. The hourly maintenance sweep has been silently broken for ~100 days — and it takes the stuck-video watchdog down with it.**
`apps/worker/src/index.ts:270-273` deletes from `webhook_events` using `created_at`, but that table's column is `received_at` (`0001_init.sql:239`). Both cleanup DELETEs go in one implicit transaction, so the error rolls back everything, and the same `runMaintenance()` failure path means the **stuck-video watchdog** (auto-fail videos wedged at rank 20-60 past `MEDIA_PROCESS_TIMEOUT_MS`) never runs either. Evidence: `maintenance.error: column "created_at" does not exist` hourly in both container-worker logs (204 occurrences in last 2000 lines) and the host doc-worker log (570 occurrences); `idempotency_keys` has 1,566 expired-but-never-deleted rows, oldest **2026-03-23 — the day the feature shipped**; `webhook_events` retains rows 16+ days past the 7-day policy. No videos are stuck *today* (queue fully drained), but the safety net built after the 2026-06-10 incident is effectively off. **Fix: one line (`created_at` → `received_at`), rebuild worker, redeploy.** Also worth separating the cleanup statements so one bad statement can't disable the watchdog again.

**2. SSRF via `webhookUrl` — an incomplete denylist on an unauthenticated public endpoint.**
`apps/web-api/src/routes/videos.ts:68-81` blocks a hostname list (`localhost`, `minio`, …) and `.internal`/`.local` suffixes, but **not** private/link-local IP literals (`10.x`, `172.16-31.x`, `192.168.x`, `169.254.169.254`). cap4.bjk.ai has no auth (deliberate), so anyone on the internet can register a video with `webhookUrl: http://172.18.0.x:9000/...` (Docker network) or a metadata endpoint, and the worker's `deliver_webhook` job will fire a signed server-side request at it. Fix: validate resolved IPs against RFC1918/loopback/link-local CIDRs (allowlist mindset), and re-check at delivery time in the worker (DNS can change between save and delivery — classic rebinding gap).

### P1 — high-value, not on fire

**3. Deploy drift is real and observed, not theoretical.** The container worker's image still contains the pre-fix `scale=768:-2` frame extraction (dormant — it never claims `generate_doc` — but 10 days stale); `cap4-web-api:prod` was built 2026-06-19 vs git HEAD 2026-06-22; deploy state lives only as prose in CLAUDE.md. Three code copies (container image, `docker cp`-swapped dist, host doc-worker) can silently sit at three different commits. Fix directionally: make `docker compose build && up -d --no-deps` the default deploy for everything (it's proven to work on this host), demote hot-swap to documented emergency-only, and bake a build SHA into each image + a `/version` endpoint so "what's running" is checkable by machine instead of by memory.

**4. `docs/deployment.md` is fiction.** Registry pushes, K8s manifests, env vars (`DB_HOST`, `AWS_BUCKET`) that exist nowhere in the codebase, and a health check on a port that isn't published. Anyone following it fails at step one; it actively contradicts the real (unusual) deploy mechanism. Replace with the real procedure or delete and point at the truth.

**5. The real test suites don't run in CI.** The impressive parts — web-api's 2,365-line route/e2e suite, the 613-line pipeline integration test — are intentionally excluded (need Docker + paid keys). What CI's `test` job actually runs for web-api is one pure-function unit file. Meanwhile **media-server has zero tests at all** and `--passWithNoTests` green-lights it silently. Every route handler and the entire ffmpeg pipeline have no automated regression protection on push. Cheapest wins: unit-test `canRemux`/probe parsing/webhook HMAC in media-server; spin the integration suite against Docker in CI with mocked providers, or at least a scheduled/manual job.

**6. Doc-worker fragility (two related weaknesses).**
(a) `scripts/doc-worker.sh` resolves postgres/minio container IPs **once at startup**; recreate either container and the doc-worker silently loses connectivity until hand-restarted — the same failure class as the June incidents. A systemd unit with `Restart=always` (or IP re-resolution on error) beats a cron `@reboot` + nohup.
(b) `model-client.ts:113-168`: environment errors (claude CLI missing/logged out, non-zero exit) skip the in-process retry *and* still record against `DOC_MAX_MODEL_CALLS_PER_DAY` **before** the spawn — a broken environment can exhaust the daily budget (60) on pure failures. Distinguish environment errors from malformed-output errors; don't budget-count the former.

### P2 — polish / hardening

**7. S3 config bypasses the zod env validator** (`shared.ts:397-444`) — silent fallbacks mean a misconfigured deploy fails on the first upload, not at boot. Add `S3_*` to `packages/config`.
**8. No security headers at either nginx layer** — HSTS at minimum is free. (Also: container-layer proxy timeouts are defaults while the host layer sets 86400s — asymmetric for a 10GB-upload product; and `client_max_body_size 10g` must be manually kept in sync across two files with no check.)
**9. Frontend fixables** — no route-level `React.lazy` splitting (all three heavy pages ship together, ~198KB gz); `ConfirmationDialog` has no `role="dialog"`/focus trap/Escape on the library page (keyboard user cannot dismiss); `document.querySelector('video')` used instead of refs in two places; a redundant 250ms `setInterval` in TranscriptCard duplicating an existing prop.
**10. No healthcheck on worker/media-server containers** and — the meta-issue — **errors are logged but nothing watches the logs**. Issue #1 fired hourly for 100 days in plain sight. Even a daily cron that greps the last 24h of logs for `"level":"error"` and emails/notifies would have caught it in a day.
**11. Stale `docker/minio/cors.json`** (placeholder origins, currently dead code because uploads are same-origin-proxied) — update or delete with a comment.
**12. Minor API-contract debt** — `presign-part`/`abort` demand an `Idempotency-Key` they never use; two routes hand-roll idempotency instead of the shared helpers; `/api/jobs/:id` leaks `lease_token`/`locked_by`; debug routes gated only by `NODE_ENV`.

---

## What should have been different (design-level, honest hindsight)

1. **Deploy should have converged on one mechanism the moment `docker compose build` was proven to work (2026-06-19).** The hot-swap machinery (`docker cp` dist, volume copies, host-built frontend) was a rational workaround for a network-less build environment — but once that constraint was found to be false, keeping three deployment paths alive turned the project's biggest strength (meticulous records) into its biggest dependency: correctness of prose in CLAUDE.md.
2. **The host doc-worker should be a systemd service, not a nohup+cron artifact.** It's a production-critical process (only thing that can run `generate_doc`) managed with the least production-grade supervision in the stack. Every doc-worker incident to date (reboot death, stale duplicate, stale IPs) is a symptom of this choice.
3. **Observability was the missing investment.** The codebase logs well (structured JSON, event names) but nothing consumes the logs. One `maintenance.error` alert would have paid for itself 570 times over. For this stack's size: a 20-line cron script, not Grafana.
4. **Giant files were allowed to keep growing.** `worker/src/index.ts` (~1300+ lines mixing queue plumbing, five job handlers, maintenance SQL), `TranscriptCard.tsx` (1,135 lines, ~25 useStates, untested), `api.ts` (703 lines, three upload strategies, untested), `media-server/index.ts` (single file, zero tests). The test gaps track the file sizes almost perfectly — the code that's hardest to test is the code that was never split.
5. **A doc that lies is worse than no doc.** `deployment.md` looks like generated boilerplate that was never reconciled with reality, sitting beside genuinely excellent docs (architecture.md explicitly says "when this conflicts with code, code wins" — the right instinct, unevenly applied).
6. **No auth was a conscious, recorded owner decision — but it raises the stakes** of everything reachable: SSRF (#2), debug-route gating, job-queue field leaks. Even a single shared bearer token at the host-nginx layer (one `location` block) would cut the exposure of a public, unauthenticated write API dramatically without building "real" auth.

---

## Grading rationale

- **A-grade qualities:** queue/state-machine/idempotency correctness, LLM cost engineering, attack-surface minimization, decision records, the additive-only discipline (old pipeline provably untouched by the doc feature).
- **What blocks an A:** a 100-day silent failure of a safety mechanism (observability gap), internet-exposed SSRF on an unauthenticated endpoint, deploy drift with no machine-checkable ground truth, the fictional deployment doc, and CI that doesn't run the tests that matter.
- **Why it's not lower:** every one of those is cheap to fix (see ACTION-PLAN.md — P0 is one line + one validator function), the live stack is healthy, and nothing found indicates data loss or corruption risk in the current design.

**Final: B+ overall, with A- code and C+ operations.** Fix the P0s and the ops story and this is an A- system.

---

*Lane briefs with full evidence: `lanes/backend-api.md`, `lanes/worker-media-doc.md`, `lanes/frontend.md`, `lanes/infra-nginx-ci.md`, `lanes/runtime-health.md`. Action plan: `ACTION-PLAN.md`.*
