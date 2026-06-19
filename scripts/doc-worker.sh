#!/usr/bin/env bash
# Host-side doc worker: claims ONLY generate_doc jobs. Runs on the host
# because the claude-cli model backend needs the `claude` binary and its
# OAuth login, which the worker container does not have.
#
# Postgres and MinIO publish no host ports, so we talk to them via their
# docker network IPs (resolved fresh on every start — IPs can change when
# containers are recreated).
#
# Usage:  ./scripts/doc-worker.sh            (foreground)
#         nohup ./scripts/doc-worker.sh >> /tmp/cap4-doc-worker.log 2>&1 &
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v claude > /dev/null; then
  echo "error: claude CLI not found on PATH" >&2
  exit 1
fi

container_ip() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1"
}

PG_IP="$(container_ip cap4-postgres-1)"
MINIO_IP="$(container_ip cap4-minio-1)"

set -a
# shellcheck disable=SC1091
source .env
set +a

export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${PG_IP}:5432/${POSTGRES_DB:-cap4}"
export S3_ENDPOINT="http://${MINIO_IP}:9000"
export WORKER_JOB_TYPES=generate_doc
export WORKER_ID=doc-worker-host
export NODE_ENV=production

echo "doc-worker: postgres=${PG_IP} minio=${MINIO_IP} model=${DOC_MODEL_STRONG:-UNSET}"
exec node --enable-source-maps apps/worker/dist/index.js
