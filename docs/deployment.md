---
title: "Deployment"
description: "Current deployment guidance for the checked-in Docker Compose stack"
---

# Deployment Guide

This repo currently documents one deployment path: the checked-in Docker
Compose stack. It is the only deployment model described here because it exists
in the repo, matches the code, and is the path that has been verified.

If you adapt cap4 to another platform, treat the Compose setup, `.env.example`,
and the runtime docs in this repo as the source of truth.

---

## What Gets Deployed

The Compose stack brings up:

- `postgres`
- `migrate`
- `minio`
- `minio-setup`
- `web-api`
- `worker`
- `media-server`
- `web-builder`
- `web-internal`

Operationally important behavior:

- `migrate` applies pending SQL on startup before `web-api` and `worker` start
- `worker` drives the pipeline by claiming `job_queue` work from PostgreSQL
- `media-server` is called synchronously by the worker via `POST /process`
- `web-builder` copies the built frontend into the shared `web_dist` volume
- `web-internal` serves the frontend on port `8022`

---

## Prerequisites

- Docker Engine / Docker Desktop with Compose v2
- A host with enough CPU, disk, and memory for FFmpeg processing
- Valid `DEEPGRAM_API_KEY`
- Valid `GROQ_API_KEY`
- A `MEDIA_SERVER_WEBHOOK_SECRET` of at least 32 characters

---

## Required Configuration

Start from `.env.example`:

```bash
cp .env.example .env
```

For the checked-in Compose deployment, the important variables are:

```bash
LOG_LEVEL=info

POSTGRES_USER=app
POSTGRES_PASSWORD=app
POSTGRES_DB=cap4
POSTGRES_PORT=5432
DATABASE_URL=postgres://app:app@postgres:5432/cap4

S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://your-browser-reachable-s3-origin
S3_REGION=us-east-1
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123
S3_BUCKET=cap4
S3_FORCE_PATH_STYLE=true
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=minio123
MINIO_PORT=8922
MINIO_CONSOLE_PORT=8923

WEB_API_PORT=3000
MEDIA_SERVER_PORT=3100
MEDIA_SERVER_BASE_URL=http://media-server:3100

MEDIA_SERVER_WEBHOOK_SECRET=change-this-to-a-secret-of-32-plus-chars
WEBHOOK_MAX_SKEW_SECONDS=300

DEEPGRAM_API_KEY=...
GROQ_API_KEY=...
```

Notes:

- The checked-in Compose file sets `NODE_ENV=production` for the app services; you do not need to override it in `.env`.
- Keep `S3_ENDPOINT` on the internal Docker hostname `http://minio:9000`
- Keep `S3_PUBLIC_ENDPOINT` browser-reachable. For local single-host usage that is typically `http://localhost:8922`; for a remote host use the public origin the browser can reach.
- Leave `VITE_S3_PUBLIC_ENDPOINT` unset for the nginx-served Docker deployment
- The MinIO console host port is bound to `127.0.0.1` only in the checked-in Compose file

---

## First Deploy

```bash
git clone https://github.com/adminbjkai/cap4
cd cap4

cp .env.example .env
# edit .env for your environment

docker compose up -d --build
```

What happens on startup:

1. `postgres` becomes healthy
2. `migrate` applies pending SQL from `db/migrations/`
3. `minio` and `minio-setup` ensure the bucket exists
4. `web-api`, `worker`, and `media-server` start
5. `web-builder` copies the built frontend into `web_dist`
6. `web-internal` serves the app on port `8022`

---

## Verification

Minimum operator checks:

```bash
docker compose ps
curl http://localhost:3000/health
curl http://localhost:3000/ready
make smoke
```

Expected results:

- `docker compose ps` shows the stack up
- `GET /health` returns `200` with `"status": "healthy"`
- `GET /ready` returns `200` with `"status": "ready"`
- `make smoke` passes against the running stack

Open:

- App: `http://localhost:8022`
- API: `http://localhost:3000`
- MinIO API: `http://localhost:8922`
- MinIO console: `http://localhost:8923`

For a remote deployment, replace `localhost` above with the host or DNS name of the machine running the stack.

---

## Updating an Existing Deploy

```bash
git pull
docker compose up -d --build
```

Because migrations run automatically through the `migrate` service, updating the
stack with `docker compose up -d --build` is the normal upgrade path.

After upgrades:

- check `docker compose logs migrate`
- re-run `/health`, `/ready`, and `make smoke`
- verify a fresh upload still completes end-to-end before considering the deploy healthy

---

## Operational Notes

- PostgreSQL is the source of truth for state and queue data
- MinIO stores raw uploads, processed outputs, thumbnails, and transcript assets
- The checked-in Compose stack is single-host and single-tenant
- The current repo has no end-user authentication layer
- Incoming media progress webhooks are documented and supported, but the main worker path currently waits on synchronous `POST /process` responses from `media-server`

---

## Backups and Recovery

This repo does not automate backups. For any non-throwaway environment, back up:

- the PostgreSQL data volume or database
- the MinIO data volume or bucket contents
- the `.env` file or your secret source of truth

For a destructive reset of a local or disposable environment:

```bash
make reset-db
```

That is a local recovery convenience, not a production rollback strategy.
