#!/usr/bin/env bash
# Host-side raw-original pruner. Deletes videos/<id>/raw/source.mp4 from MinIO for
# videos that are done with them (transcription complete + transcoded result exists).
# Mirrors scripts/doc-worker.sh: postgres/minio publish no host ports, so we reach
# them via their docker-network IPs (resolved fresh each run).
#
# Usage:
#   ./scripts/prune-raw-originals.sh --dry-run
#   ./scripts/prune-raw-originals.sh --video <uuid>        # test one
#   ./scripts/prune-raw-originals.sh                       # prune all eligible
#   ./scripts/prune-raw-originals.sh --min-age-hours 24    # cron-safe grace window
set -euo pipefail
cd "$(dirname "$0")/.."

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

exec node scripts/prune-raw-originals.mjs "$@"
