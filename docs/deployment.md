---
title: "Deployment"
description: "How cap4 is actually deployed and operated in production"
---

# Deployment Guide

> This describes the **actual single-host production setup** for cap4
> (`cap4.bjk.ai`), not a generic/idealized one. `CLAUDE.md` "Current State"
> is the running log of every deploy performed against this host — check it
> for the most recent changes and their verification evidence. `DECISIONS.md`
> #11 and #16 record why the deploy mechanism looks the way it does.

---

## Overview

cap4 runs entirely on **one host**, as a single Docker Compose project plus
two host-side processes (a doc-worker and a cron job). No registry, no
orchestrator, no multi-node scaling — deploys are done by hand on the host.

```
cap4.bjk.ai (TLS, wildcard bjk.ai cert)
   -> host nginx  /etc/nginx/sites-enabled/cap4.bjk.ai
   -> 127.0.0.1:8007  (PORT in .env)
   -> cap4-web-internal-1  (nginx:alpine; config = docker/nginx/default.conf,
                             a single-file BIND MOUNT -- see gotchas)
        location /      -> static SPA (web_dist volume)
        location /api   -> cap4-web-api-1 :3000
        location /cap4/ -> cap4-minio-1 :9000 (S3 objects)

cap4-web-api-1 -> cap4-postgres-1, cap4-minio-1, cap4-media-server-1
cap4-worker-1  -> container worker; every job type EXCEPT generate_doc

Host-side (outside Compose, no published container ports needed):
  - doc-worker (scripts/doc-worker.sh): claims ONLY generate_doc,
    needs the `claude` CLI + OAuth subscription login (no API key, ever)
  - cron 30 4 * * *: scripts/prune-raw-originals.sh --min-age-hours 24
```

---

## Prerequisites

- SSH/shell access to the single production host.
- Repo checked out at `/apps/cap4`, owned by the deploying user (not root).
- `.env` present on the host with real secrets (`DATABASE_URL`,
  `POSTGRES_*`, `MINIO_ROOT_*`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`,
  `DOC_MODEL_STRONG`, etc.) — never committed.
- `docker compose` available; the build environment on this host **can**
  reach `apk`/`npm` (confirmed 2026-06-19), so `docker compose build` works
  directly — no external registry or CI artifact needed.
- For Doc-tab work: the `claude` CLI installed on the host, logged in via
  OAuth subscription (`claude /login`). This is the **only** supported
  Claude access path for cap4 — no `ANTHROPIC_API_KEY` is ever set.

---

## Standard deploy

There are three independent things you might deploy: a **backend service**
(web-api / worker / media-server), the **frontend** (static SPA), or the
**nginx config**. They use different mechanisms — do not mix them up.

### Backend service (web-api, worker, media-server) — preferred path

Build environment on this host reaches the package registries, so a real
image rebuild is the normal path (not a hot-swap):

```bash
cd /apps/cap4

# 1. Tag the currently-running image as a rollback point (instant, no downtime)
docker tag cap4-web-api:prod cap4-web-api:rollback
docker tag cap4-worker:prod cap4-worker:rollback
docker tag cap4-media-server:prod cap4-media-server:rollback

# 2. Build the new image(s)
docker compose build web-api worker media-server

# 3. Recreate ONE service at a time, least-risky first (worker → media-server → web-api)
docker compose -p cap4 up -d --no-deps worker
# verify worker is healthy (check logs / job progress), then:
docker compose -p cap4 up -d --no-deps media-server
docker compose -p cap4 up -d --no-deps web-api
curl -fsS http://127.0.0.1:8007/health
```

This is the **only** path that carries `node_modules` / dependency changes
(a `docker cp` hot-swap of compiled `dist/` does not touch `node_modules`
inside the image).

### Frontend (static SPA)

The frontend is built on the **host**, not inside a container image, and
copied into the `cap4_web_dist` docker volume that `web-internal` nginx
serves from:

```bash
cd /apps/cap4
pnpm --filter @cap/web build          # produces apps/web/dist/

# Additive copy into the running volume (zero-downtime; avoids an
# empty-directory window that a `rm -rf` + copy would create)
docker run --rm \
  -v cap4_web_dist:/dist \
  -v /apps/cap4/apps/web/dist:/src:ro \
  alpine sh -c 'cp -r /src/assets/. /dist/assets/ && cp /src/index.html /dist/index.html'
```

No nginx action is required — static files are read fresh on every request
(no reload/restart needed for this volume).

### nginx config changes (`docker/nginx/default.conf`)

```bash
# Edit the file, then validate before touching the live container:
docker run --rm --network cap4_default \
  -v /apps/cap4/docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine nginx -t

# Apply — reload is NOT enough (see "single-file bind mount" gotcha):
docker compose -p cap4 restart web-internal   # = docker restart cap4-web-internal-1
curl -fsS http://127.0.0.1:8007/health
```

If the change affects upload size limits, keep the **host** nginx file
(`/etc/nginx/sites-available/cap4.bjk.ai`, not in this repo) in sync too —
see Known gotchas.

### Legacy / emergency-only: hot-swap compiled `dist/`

For an urgent route/logic fix where a full rebuild isn't practical, compiled
JS can be copied directly into a running container:

```bash
pnpm --filter @cap/web-api build   # or @cap/worker / @cap/media-server
docker cp apps/web-api/dist/routes/<file>.js cap4-web-api-1:/workspace/apps/web-api/dist/routes/<file>.js
docker cp apps/web-api/dist/routes/<file>.js.map cap4-web-api-1:/workspace/apps/web-api/dist/routes/<file>.js.map
docker restart cap4-web-api-1
```

**Stopgap only.** It doesn't touch `node_modules` (can't carry dependency
changes) and leaves the container's filesystem diverged from the image it
was built from — a later `docker compose up --force-recreate` or rebuild
silently reverts it. Always follow up with a real `docker compose build` +
recreate once things have settled, so the image matches what's running.

---

## Rollback

Backend services: retag and recreate the previous image.

```bash
docker tag cap4-web-api:rollback cap4-web-api:prod
docker compose -p cap4 up -d --no-deps web-api
curl -fsS http://127.0.0.1:8007/health
```

Frontend: restore from a pre-deploy backup of the volume (take one before
any risky change):

```bash
docker run --rm -v cap4_web_dist:/v:ro -v /tmp:/out alpine \
  sh -c 'cd /v && tar czf /out/cap4_web_dist_backup.tgz .'
# to restore:
docker run --rm -v cap4_web_dist:/v -v /tmp:/in:ro alpine \
  sh -c 'cd /v && tar xzf /in/cap4_web_dist_backup.tgz'
```

nginx config: `git checkout` (or restore) the previous
`docker/nginx/default.conf`, re-validate with `nginx -t` as above, then
restart `web-internal` again.

---

## Host doc-worker lifecycle

`generate_doc` jobs (the Doc tab) are processed **exclusively** by a
host-side worker process, because the `claude-cli` model backend needs the
`claude` binary and an OAuth subscription login — neither exists inside the
worker container (no outbound network to install/login either). Container
workers exclude `generate_doc` by default via the `WORKER_JOB_TYPES`
allowlist, so a doc job can never be picked up somewhere it can't run.

Start it: `cd /apps/cap4 && nohup ./scripts/doc-worker.sh >>
/tmp/cap4-doc-worker.log 2>&1 &`

- Restarts automatically after a host reboot via a `@reboot` crontab entry
  (startup delay + a `PATH` that includes wherever `claude` lives).
- Resolves the postgres/minio **container IPs** at startup (they publish no
  host ports) — **restart it whenever those containers are recreated**, or
  it keeps talking to stale IPs.
- Doc generation is **manual-only**, enqueued only by `POST
  /api/videos/:id/generate-doc` (the Generate-doc button). If the
  doc-worker isn't running, jobs just sit `queued` — nothing else breaks.
- It runs the same compiled `apps/worker/dist` as the container worker, so
  a worker code deploy needs the doc-worker process restarted too.

---

## Cron jobs

| Schedule | Command | Purpose |
|---|---|---|
| `30 4 * * *` | `scripts/prune-raw-originals.sh --min-age-hours 24` | Deletes the raw upload S3 object (`videos/<id>/raw/source.mp4`) once a video is done with it (`transcription_status IN ('complete','no_audio') AND result_key IS NOT NULL`). **Deletes the S3 object only** — never nulls `uploads.raw_key`. Idempotent; safe to re-run. |

Both the doc-worker and the pruner resolve postgres/minio via docker-network
IPs at invocation time and `source .env` for credentials, since neither
service publishes a host port.

---

## Migrations

The `migrate` Compose service applies every pending file in
`db/migrations/*.sql` and tracks applied versions in `schema_migrations`.
It runs automatically on every `docker compose up`, and `web-api`/`worker`
wait for it to complete (`service_completed_successfully`) before starting.

Manual re-run without a full restart:

```bash
docker compose -p cap4 run --rm migrate
```

There is no rollback command — migrations are forward-only; undo with a new
forward migration.

---

## Health checks & smoke

`web-api` publishes **no host port** — everything goes through the
`web-internal` nginx container on `PORT` (default `8007`), which proxies
`/health` and `/ready` to `web-api:3000`. Do not check `:3000` directly on
the host; it is not exposed.

```bash
make smoke      # curls http://localhost:8007/health and /ready
```

`Makefile`'s `smoke` target and `PORT ?= 8007` encode this; override with
`make PORT=8007 smoke` if `.env`'s `PORT` differs.

---

## Known gotchas

- **nginx single-file bind mount + reload doesn't reload.**
  `docker/nginx/default.conf` is bind-mounted as a single file. Editing the
  host file creates a new inode; the running container's `nginx` stays
  bound to the **old** one, so `nginx -s reload` silently keeps serving the
  old config. Use `docker compose restart web-internal` instead.
- **Upload size limit must stay in sync at both nginx layers.**
  `client_max_body_size` is `10g` in both the container config and the host
  nginx file (`/etc/nginx/sites-available/cap4.bjk.ai`, a system file, not
  in this repo) — uploads pass through both, and the lower one wins. Files
  over 5 GB must use the multipart upload path (S3's single-PUT cap is 5 GB).
- **Doc-worker stale IPs after container recreation.** It resolves
  postgres/minio IPs once at process start; recreating either container
  leaves it talking to a stale IP until it's restarted.
- **Legacy `docker cp` hot-swap causes image/container drift.** It patches
  a running container's writable layer without touching the image — a
  later `docker compose up --force-recreate` (or any rebuild) silently
  reverts it. Treat it as a stopgap; follow up with a real
  `docker compose build` once the fix is confirmed.
- **No Anthropic API key, ever.** Doc-tab model access is subscription/OAuth
  `claude -p` only (`DOC_MODEL_BACKEND=claude-cli`). Setting
  `ANTHROPIC_API_KEY` or switching to `DOC_MODEL_BACKEND=anthropic-api` (an
  unimplemented stub) is out of policy.

---

**Need help?** See [troubleshooting.md](troubleshooting.md) or
[CONTRIBUTING.md](../CONTRIBUTING.md). Deploy history and verification
evidence for specific changes lives in `/apps/cap4/CLAUDE.md` under
"Current State".
