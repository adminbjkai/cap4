# Lane brief — Infrastructure: nginx chain, Docker, CI, deploy story

> Produced 2026-07-02 by a fresh-context review agent (Sonnet) as part of the 0702 full audit.
> Read-only; included live host checks (docker inspect/exec diff, host nginx config, crontab).

# Infrastructure Audit — cap4 (nginx chain, Docker, CI, deploy)

## 1. Summary — Grade: B-

Container-side security posture is genuinely strong (zero unnecessary host port exposure, secrets not in git, SSRF/path-traversal fixes already landed), and the two-layer nginx chain works correctly with no config drift. But the manual hot-swap deploy mechanism has real drift risk that has already manifested twice (stale image on disk lagging 3 days behind git HEAD; a genuinely stale doc-worker process had to be hand-killed), `docs/deployment.md` is 100% fictional boilerplate that would actively mislead anyone following it, and I found a live, previously-unnoticed bug: the hourly DB maintenance cleanup has been silently failing since **2026-03-23** (100+ days), leaving `idempotency_keys` and `webhook_events` unpruned.

## 2. Strengths

- **Minimal host attack surface, verified live**: `docker port` on postgres, minio, worker, media-server, web-api all return nothing — only `web-internal` publishes `127.0.0.1:8007->80/tcp`. Everything else is Docker-network-internal.
- **No config drift in the container nginx**: `docker exec cap4-web-internal-1 cat /etc/nginx/conf.d/default.conf` diffed byte-identical against the repo file — the running proxy matches source.
- **`.env` correctly gitignored** (`.gitignore:20`), not in `git log --all`, real 32+ char webhook secret enforced by schema.
- **Secret-probe blocklist** on the host nginx (`/etc/nginx/snippets/block-secret-probes.conf`) returns 404 for `.env`, `.git`, `wp-`, `phpmyadmin`, etc., with `access_log off` — thoughtful, low-noise hardening.
- **Idempotent migration runner** (`docker/postgres/run-migrations.sh`) — dollar-quoted version strings (no SQL injection), safe to rerun every `up`.
- **CI is honest about scope**: `audit` job gates `pnpm audit --prod --audit-level=high` only (won't red on deferred dev-tooling advisories), unit tests explicitly excluded from DB-backed integration/e2e (documented, not hidden).

## 3. Issues, ranked by severity

**S1 — Maintenance cleanup query has been silently broken since 2026-03-23 (~100 days), unbounded table growth.**
`apps/worker/src/index.ts:270-273`:
```sql
DELETE FROM idempotency_keys WHERE expires_at < now();
DELETE FROM webhook_events WHERE created_at < now() - interval '7 days';
```
`webhook_events` has no `created_at` column — it's `received_at` (`db/migrations/0001_init.sql:239`). Verified live: `/tmp/cap4-doc-worker.log` has **570 occurrences** of `{"event":"maintenance.error","error":"error: column \"created_at\" does not exist"}`, one per hourly tick, going back to line 57 of the log (near worker start). Because both DELETEs are sent as one multi-statement `query()` call, Postgres runs them in one implicit transaction — the second statement's error rolls back the first too. Confirmed at the DB: `idempotency_keys` has **1,643 rows, 1,566 already expired**, oldest from **2026-03-23** (the very day this feature shipped); `webhook_events` has 373 rows going back to 2026-06-10 (should be ≤7 days). This runs on **every** worker process (container workers + host doc-worker), all hitting the same bug every hour. Low urgency today (row counts are still small) but it is a genuine, unmonitored functional regression that will compound. **Fix:** change `created_at` → `received_at` on line 272; one-line patch, redeploy worker.
*(Cross-lane note: the runtime lane additionally established that the stuck-video watchdog shares this transaction — so the watchdog safety net is disabled too. See `lanes/runtime-health.md`.)*

**S2 — `docs/deployment.md` is entirely fictional and would actively mislead an operator.**
It documents `docker build -t yourregistry/cap4:latest`, `DB_HOST`/`MINIO_HOST`/`AWS_BUCKET` env vars that don't exist anywhere in the codebase, Kubernetes manifests that don't exist, `curl http://localhost:3000/health` (that port isn't published to the host at all — confirmed above), and a GitHub Actions "build and push on release" step that isn't in `ci.yml`. Someone following this doc to stand up a second environment would fail at step one. **Fix:** rewrite to describe the actual mechanism (host build → volume copy for frontend; `docker compose build` + `--no-deps` swap + `:rollback` tag for backend; host doc-worker via cron `@reboot`), or at minimum add a banner pointing to `CLAUDE.md`/`DECISIONS.md` as the source of truth.

**S3 — Deploy mechanism has already produced real drift, caught here live.**
`docker inspect cap4-web-api:prod` shows the image was built **2026-06-19**, while `git log -1` on the checked-out branch is **2026-06-22** (`c745230`, the frame-extraction fix). That particular commit was worker-only so web-api not moving is *expected*, but it's incidental — nothing enforces or even checks image-vs-HEAD correspondence for the other services. Worse: `docker exec cap4-worker-1 grep scale= .../stage-a.js` still shows `scale=768:-2`, the **pre-fix** value, 10 days after the 1920px fix was supposedly deployed — because that commit was hot-swapped only into the **host doc-worker**, not into the container-worker's `dist`/image, and nothing records that asymmetry anywhere machine-checkable (only prose in CLAUDE.md). (The container worker never runs `generate_doc`, so this stale code is dormant — but it is live proof of the drift class.) Two independent code paths (container image dist vs. host-swapped dist vs. host doc-worker's own separately-restarted process) can each be at a different git commit with no single source of truth for "what's actually running." CLAUDE.md is carrying deploy-state tracking that should be structural (image tags, a `/version` endpoint, or at minimum a build-SHA label baked into each image).

**S4 — MinIO CORS config is stale/dead and would break browser uploads if the proxy topology ever changes.**
`docker/minio/cors.json` allows only `http://localhost:8022` and `https://cap4.example.com` — neither matches the real dev port (8007) nor the real prod origin (`cap4.bjk.ai`). It currently doesn't bite because `S3_PUBLIC_ENDPOINT=https://cap4.bjk.ai` (confirmed in live `.env`) routes presigned PUTs same-origin through nginx's `/cap4/` proxy, never hitting MinIO cross-origin — and MinIO publishes no host port, so direct browser→MinIO CORS is moot today. But it's landmine-shaped: if anyone ever re-exposes MinIO directly, uploads will fail with an opaque CORS error and this file won't be the first place anyone looks. **Fix:** update the placeholder origins or delete the file with a comment explaining it's currently unused given the same-origin proxy design.

**S5 — No security response headers anywhere in the chain.**
Neither `docker/nginx/default.conf` nor the host `sites-available/cap4.bjk.ai` block sets HSTS, `X-Content-Type-Options`, `X-Frame-Options`, or CSP (`grep add_header` returned nothing in either). TLS termination + wildcard cert exist, so HSTS at minimum is a near-zero-cost, meaningful addition. Not urgent for a single-tenant internal tool, but cheap to fix.

**S6 — No healthcheck on `worker` or `media-server`.**
`docker-compose.yml` defines healthchecks for `postgres` and `web-api` only. `worker`/`media-server` use `restart: unless-stopped`, which only restarts on process exit — an internally wedged (but still-running) worker (e.g., stuck job, DB pool exhaustion) won't be detected or auto-recovered by Docker. Combined with S1 (errors that get logged but never alerted on), this is a monitoring gap, not just a healthcheck gap.

**S7 — Container nginx layer has no explicit timeouts for the `/cap4/` and `/api` proxy locations.**
Given `client_max_body_size 10g` is explicitly designed for large uploads, the lack of `proxy_send_timeout`/`proxy_read_timeout` overrides at the container-nginx hop (only the host layer sets `proxy_read_timeout 86400`) means large-body writes rely on nginx's 60s default "gap between successive writes" window. Probably fine for steady uploads, but worth an explicit match to the host layer's generous timeout given the stated 10GB use case.

## 4. Should-have-been-different

- **The hot-swap deploy story (`docker cp` + restart) trades observability for speed.** It's understandable given "containers have no outbound network," but the *build* environment does have network (per CLAUDE.md's own 2026-06-19 correction) — meaning `docker compose build` already works here. The frontend-volume-copy and backend-`docker cp` paths look like vestigial workarounds from before that was known, kept alive because they're faster for small changes. Recommend: standardize on `docker compose build <svc> && up -d --no-deps` for **all** changes (already proven to work), and reserve the hot-swap only as a documented "emergency hotfix" path with a mandatory follow-up full rebuild — instead of it being the default. This would have prevented S3.
- **The single-file bind-mount nginx config + inode-reload gotcha** is a sharp edge that's already bitten this project once (documented in CLAUDE.md). A `docker compose restart web-internal` after config edits should just be the standing procedure, not tribal knowledge in a memory file — worth a comment directly in `docker-compose.yml` next to the `web-internal` service.
- **Host doc-worker outside compose** (`scripts/doc-worker.sh`, cron `@reboot`) resolves Postgres/MinIO container IPs once at process start (`container_ip cap4-postgres-1`). If those containers are ever recreated (routine `docker compose up -d --no-deps postgres`) while the doc-worker keeps running on stale IPs, it silently loses DB/S3 connectivity until manually restarted — this class of failure is exactly what happened with the stale-PID incident noted for 2026-06-22. A supervisor (systemd unit with `Restart=always` + a periodic IP-staleness check, or re-resolving on each DB error) would be more robust than cron `@reboot` alone.
- **`docs/deployment.md` should not exist in its current form** — a doc that actively contradicts reality is worse than no doc.

## 5. Nginx chain assessment (two-layer proxy)

The design — host nginx (TLS + wildcard cert + generic secret-probe blocking) → `127.0.0.1:8007` → container nginx (routing to web-api/minio/static) — is sound and cleanly separates concerns: the host layer only needs to know about one upstream port across dozens of unrelated sites on this box, and the container layer owns all cap4-specific routing. Verified no drift between deployed and repo config.

Two genuine gaps: (1) `client_max_body_size 10g` is correctly duplicated at both layers (verified in both files) but the comment in `docker/nginx/default.conf` explicitly calls out that they "must match" — this is manually-synced tribal state with no automated check; a future edit to one without the other silently reintroduces the 1MB-default upload failure. (2) the host layer's `proxy_read_timeout 86400` is generous but scoped only to reading the upstream response, and isn't mirrored by an equivalent write-side timeout at the container hop (S7) — for a system whose flagship feature is large video uploads, timeout tuning deserves a single source of truth rather than asymmetric per-layer defaults.

## Key files/evidence
- `apps/worker/src/index.ts:270-273` — broken maintenance SQL (S1), confirmed via live log + DB query
- `db/migrations/0001_init.sql:227-243` — actual `webhook_events` schema (has `received_at`, not `created_at`)
- `docker-compose.yml`, `docker/nginx/default.conf` — container layer, verified no drift via `docker exec ... diff`
- `/etc/nginx/sites-available/cap4.bjk.ai` (+ `.bak-20260619-uploadlimit`) — host layer
- `docs/deployment.md` — fictional, contradicts real deploy mechanism (S2)
- `docker/minio/cors.json` — stale placeholder origins (S4)
- `.github/workflows/ci.yml` — single consolidated workflow, pnpm 9
- `docker inspect cap4-web-api:prod` (built 2026-06-19) vs `git log -1` (2026-06-22) and `docker exec cap4-worker-1 grep scale=` (still `768:-2`) — live evidence of S3 drift
