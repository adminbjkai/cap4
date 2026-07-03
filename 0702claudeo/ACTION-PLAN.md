# cap4 — Prioritized Action Plan (from the 2026-07-02 audit)

> Companion to `REPORT.md`. Nothing here has been implemented — this run was read-only by request.
> Each item is scoped so a future session (or another agent) can execute it standalone.
> Order within each tier = recommended execution order. Deploy notes assume the documented
> mechanisms in CLAUDE.md; prefer `docker compose build && up -d --no-deps <svc>` over hot-swap.

---

## P0 — do first (real bug + real exposure; both small)

### P0-1. Fix the maintenance sweep (one line) and make it fail-independent
- **File:** `apps/worker/src/index.ts:270-273` (`CLEANUP_MAINTENANCE_SQL`).
- **Change:** `webhook_events ... created_at` → `received_at`.
- **Hardening (recommended, still small):** run the two cleanup DELETEs and the stuck-video watchdog as *separate* statements/try-blocks so one bad statement can never silently disable the watchdog again; log row counts per statement.
- **Deploy:** rebuild worker dist → `docker compose build worker && docker compose up -d --no-deps worker`; **also restart the host doc-worker** (it runs the same maintenance code). Verify: next hourly tick logs no `maintenance.error`; `SELECT count(*) FROM idempotency_keys WHERE expires_at < now()` drops to ~0; `webhook_events` older than 7 days gone.
- **Effort:** ~15 min including deploy + verify.

### P0-2. Close the SSRF hole in `webhookUrl`
- **File:** `apps/web-api/src/routes/videos.ts:68-81` (+ the worker's `deliver_webhook` handler for delivery-time re-validation).
- **Change:** after parsing the URL, resolve the hostname (`dns.lookup`, all addresses) and reject if any resolved IP is loopback (`127/8`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, `fe80::/10`), CGNAT (`100.64/10`), or unspecified (`0.0.0.0`, `::`). Keep the existing hostname denylist as a fast path. Re-run the same check in the worker immediately before the outbound fetch (guards DNS rebinding between save and delivery).
- **Tests:** unit-test the IP classifier with the ranges above + a metadata-endpoint case.
- **Deploy:** web-api + worker rebuild/recreate.
- **Effort:** ~1–2 hours.

---

## P1 — this month (drift, truth, and the safety nets)

### P1-1. Converge on ONE deploy path + machine-checkable versioning
- Make `docker compose build <svc> && docker compose up -d --no-deps <svc>` (with the existing `:rollback` tagging) the **default** for all backend changes; document hot-swap (`docker cp` dist) as emergency-only with a mandatory follow-up rebuild.
- Bake the git SHA into each image (`ARG GIT_SHA` → env → log at boot) and expose it: `GET /health` already exists — add `version` to its payload for web-api/media-server; log it at worker startup.
- Optional 10-line `scripts/check-deploy-drift.sh`: compares running containers' SHA labels to `git rev-parse HEAD` and prints a table.
- **Also:** rebuild the container worker now so its dormant stale `stage-a.js` (768px) stops being a trap if `WORKER_JOB_TYPES` defaults ever change.
- **Effort:** half a day.

### P1-2. Rewrite `docs/deployment.md` to describe reality
- Delete the registry/K8s fiction. Document: host prerequisites (node/pnpm/ffmpeg/claude CLI), the compose stack, the two-layer nginx (incl. the bind-mount-inode → **restart, don't reload** gotcha and the 10g body-size sync requirement across both layers), frontend volume-copy path, backend compose-build path, `:rollback` rollback procedure, host doc-worker lifecycle, and the two cron entries. Much of this prose already exists in CLAUDE.md/DECISIONS.md — consolidate, don't re-derive.
- **Effort:** 1–2 hours.

### P1-3. Minimal observability: watch the logs that already exist
- A host cron (e.g. every 6h) that scans the last window of `docker logs` for all cap4 containers + `/tmp/cap4-doc-worker.log` for `"level":"error"` / `maintenance.error` / `job.failed` spikes / `job.heartbeat.lost`, and surfaces them (email, ntfy push, or even append to a `PROBLEMS.log` the owner checks). Also alert if the doc-worker PID is missing or if >1 doc-worker is running (known past bug), and if any video sits in rank 20-60 for >2h (belt-and-braces for the watchdog).
- This single item would have caught P0-1 within hours instead of 100 days.
- **Effort:** ~1 hour for cron+script; more if a notification channel needs setup.

### P1-4. Doc-worker: systemd instead of nohup + cron `@reboot`
- Create a systemd user/system unit: `Restart=always`, `RestartSec=10`, journal logging (or keep the file log), `ExecStart=scripts/doc-worker.sh`. Remove the `@reboot` cron entry.
- In `doc-worker.sh` or worker startup: on DB/S3 connection failure, re-resolve container IPs and retry (or connect via compose network DNS by attaching the process to the docker network / using published localhost ports bound to 127.0.0.1). Restart-on-exit + re-resolution together close the stale-IP failure class.
- **Effort:** 1–2 hours.

### P1-5. Model-call budget: stop charging failures against the daily cap
- **File:** `apps/worker/src/doc/model-client.ts` (~:113-181).
- Record the call **after** a successful spawn+parse, or reclassify: environment errors (ENOENT, non-zero exit from auth) should throw a distinct typed error (e.g. `DocEnvironmentError`), be marked fatal (no pointless queue retries), **not** count against `DOC_MAX_MODEL_CALLS_PER_DAY`, and produce an actionable log line ("claude CLI unavailable — check login").
- **Effort:** 1–2 hours incl. tests (test harness for this file is already strong).

### P1-6. Media-server: first tests + healthchecks
- Unit-test the pure parts: `canRemux` decision matrix, `probeVideo` ffprobe-JSON parsing, webhook HMAC signature construction (mirror web-api's verification in reverse).
- Add compose healthchecks for `media-server` (it has `/health`) and a liveness signal for `worker` (e.g. touch a file per loop tick + healthcheck stat age, or a tiny HTTP port).
- **Effort:** half a day.

---

## P2 — nice-to-have hardening & polish (batch opportunistically)

| # | Item | Where | Effort |
|---|---|---|---|
| P2-1 | Validate `S3_*` env in the zod schema (fail at boot, not first upload) | `packages/config/src/index.ts`, `apps/web-api/src/lib/shared.ts:397-444` | 30 min |
| P2-2 | Security headers: HSTS (host layer), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (container layer). Remember: web-internal needs a **restart**, not reload | `/etc/nginx/sites-available/cap4.bjk.ai`, `docker/nginx/default.conf` | 30 min |
| P2-3 | Explicit `proxy_read_timeout`/`proxy_send_timeout` on container-nginx `/api` + `/cap4/` locations to match host layer; comment that `client_max_body_size` must stay in sync across both files | `docker/nginx/default.conf` | 20 min |
| P2-4 | Route-level code splitting: `React.lazy` + `Suspense` for HomePage/RecordPage/VideoPage | `apps/web/src/App.tsx` | 1 h |
| P2-5 | `ConfirmationDialog`: `role="dialog"`, `aria-modal`, initial focus, local Escape handler (fixes the no-keyboard-escape bug on the library page) | `apps/web/src/components/ConfirmationDialog.tsx` | 1 h |
| P2-6 | Replace `document.querySelector('video')` with a shared ref; delete TranscriptCard's 250ms interval in favor of the existing `playbackTimeSeconds` prop | `VideoPage.tsx:475`, `TranscriptCard.tsx:137-147` | 1 h |
| P2-7 | Trim `lease_token`/`locked_by` from `/api/jobs/:id` responses; either implement or drop the unused `Idempotency-Key` requirement on `presign-part`/`abort`; migrate `watch-edits`/`retry` to the shared idempotency helpers | `apps/web-api/src/routes/{jobs,uploads,videos}.ts` | 2 h |
| P2-8 | Fix or remove stale `docker/minio/cors.json` (placeholder origins; currently dead due to same-origin proxying) | `docker/minio/cors.json` | 10 min |
| P2-9 | Add a `# restart web-internal after editing default.conf (bind-mount inode)` comment in docker-compose.yml | `docker-compose.yml` | 5 min |
| P2-10 | Consider a single shared bearer token enforced at host nginx for `/api` write methods — cheapest possible mitigation for the no-auth public write surface (owner decision; Phase 5 auth remains deferred) | host nginx + frontend fetch wrapper | half a day |

## P3 — structural (only when touching these areas anyway)

- **Split the giants:** `worker/src/index.ts` (queue core vs job handlers vs maintenance), `TranscriptCard.tsx` (search / speaker editor / confidence review), `api.ts` (upload strategies vs typed API client). Do it incrementally when a feature touches them — not as a big-bang refactor.
- **CI integration tier:** a scheduled or manually-triggered GitHub Actions job that boots the compose stack (mock Deepgram/Groq via env-pointed stubs) and runs the existing 18 integration + web-api e2e suites, so the 2,365-line suite runs somewhere automatically.
- **Vite 5→6 major** (already planned as `plans/004`) — clears the residual dev-tooling audit advisories.
- **Frame extraction efficiency:** thin to ≤16 frames *before* S3 upload in the doc pipeline (currently up to 40 uploaded, 16 usable) — pure cost/IO saving, low priority at current volumes.

---

## Suggested execution order (if done as one pass)

1. P0-1 (15 min) → verify live next hour-tick.
2. P0-2 (2 h) → deploy web-api + worker together.
3. P1-3 observability cron (1 h) — before further changes, so future regressions are seen.
4. P1-1 deploy convergence + version stamping, rebuilding ALL services once cleanly (this also flushes the stale container-worker code).
5. P1-4 systemd doc-worker.
6. P1-2 deployment.md rewrite (capture everything just done).
7. P1-5, P1-6, then P2 batch.

Total estimated effort through P1: **~2 focused days**. Everything in P0/P1 is low-risk, additive or one-line, and consistent with the owner's additive-only / frugal-resources constraints (no new services, no API-key usage, no feature removals).
