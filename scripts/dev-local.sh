#!/usr/bin/env bash
# dev-local.sh — Start cap4 services locally without Docker.
#
# Prerequisites:
#   - Node 20+ and pnpm installed
#   - PostgreSQL running on localhost:5432 (local install or Homebrew)
#   - MinIO running on localhost:9000 (see notes below)
#   - ffmpeg installed (brew install ffmpeg / apt install ffmpeg)
#
# Quick MinIO setup (one-time):
#   brew install minio/stable/minio        # macOS
#   apt-get install minio                  # Ubuntu (or download binary)
#   minio server ~/minio-data &            # start in background (port 9000)
#
# Quick PostgreSQL setup (one-time):
#   createdb cap4
#   createuser app --pwprompt              # set password to "app" or update DATABASE_URL
#
# Then apply migrations once:
#   psql -d cap4 -f db/migrations/0001_init.sql
#   psql -d cap4 -f db/migrations/0002_video_soft_delete.sql
#   psql -d cap4 -f db/migrations/0003_add_webhook_reporting.sql
#   psql -d cap4 -f db/migrations/0004_fix_transcript_language.sql
#   psql -d cap4 -f db/migrations/0005_add_ai_enrichment_fields.sql
#   psql -d cap4 -f db/migrations/0006_add_transcript_speaker_labels.sql
#
# Usage:
#   ./scripts/dev-local.sh           # start all 4 services concurrently
#   ./scripts/dev-local.sh api       # start only web-api
#   ./scripts/dev-local.sh worker    # start only worker

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Load .env if it exists
if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
  echo "Loaded .env"
fi

# Override service URLs for local (no Docker) operation
export DATABASE_URL="${DATABASE_URL:-postgres://app:app@localhost:5432/cap4}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
export S3_PUBLIC_ENDPOINT="${S3_PUBLIC_ENDPOINT:-http://localhost:9000}"
export MEDIA_SERVER_BASE_URL="${MEDIA_SERVER_BASE_URL:-http://localhost:3100}"
export WEB_API_PORT="${WEB_API_PORT:-3000}"
export MEDIA_SERVER_PORT="${MEDIA_SERVER_PORT:-3100}"

# Verify critical env vars
if [ -z "${DEEPGRAM_API_KEY:-}" ] || [ "${DEEPGRAM_API_KEY}" = "your_deepgram_api_key_here" ]; then
  echo "WARNING: DEEPGRAM_API_KEY is not set — transcription will fail."
fi
if [ -z "${GROQ_API_KEY:-}" ] || [ "${GROQ_API_KEY}" = "your_groq_api_key_here" ]; then
  echo "WARNING: GROQ_API_KEY is not set — AI pipeline will fail."
fi

start_api() {
  echo "[web-api] starting on :${WEB_API_PORT}"
  pnpm --filter @cap/web-api dev
}

start_worker() {
  echo "[worker] starting"
  pnpm --filter @cap/worker dev
}

start_media_server() {
  echo "[media-server] starting on :${MEDIA_SERVER_PORT}"
  pnpm --filter @cap/media-server dev
}

start_web() {
  echo "[web] starting Vite dev server on :5173"
  pnpm --filter @cap/web dev
}

MODE="${1:-all}"

case "$MODE" in
  api)          start_api ;;
  worker)       start_worker ;;
  media-server) start_media_server ;;
  web)          start_web ;;
  all)
    # Run all services concurrently (requires npx concurrently or the
    # pnpm workspace concurrency approach).
    if command -v concurrently &>/dev/null; then
      concurrently \
        --names "web-api,worker,media-server,web" \
        --prefix-colors "blue,green,yellow,cyan" \
        "$(declare -f start_api); start_api" \
        "$(declare -f start_worker); start_worker" \
        "$(declare -f start_media_server); start_media_server" \
        "$(declare -f start_web); start_web"
    else
      echo "tip: install 'concurrently' for a nicer multi-service output:"
      echo "  npm install -g concurrently"
      echo ""
      echo "Starting services sequentially in background..."
      start_api    &
      start_worker &
      start_media_server &
      start_web    &
      wait
    fi
    ;;
  *)
    echo "Usage: $0 [all|api|worker|media-server|web]"
    exit 1
    ;;
esac
