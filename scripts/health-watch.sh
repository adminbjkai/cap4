#!/usr/bin/env bash
# Lightweight cap4 health watcher (cron, every 6h). Read-only.
# Scans recent container + doc-worker logs for errors, checks the doc-worker
# process, and looks for videos stuck mid-transcode. Appends findings to
# $ALERT_LOG only when something is wrong — an empty/absent log means healthy.
# Born out of the 2026-07 audit: a maintenance bug fired hourly for ~100 days
# because logs were written but never watched.
set -uo pipefail
cd "$(dirname "$0")/.."

ALERT_LOG="${CAP4_ALERT_LOG:-/var/tmp/cap4-health-alerts.log}"
SINCE="${CAP4_WATCH_SINCE:-6h}"
NOW="$(date -Is)"
PROBLEMS=()

add() { PROBLEMS+=("$1"); }

# 1. Error-level lines in container logs (worker/web-api/media-server/web-internal).
for c in cap4-worker-1 cap4-web-api-1 cap4-media-server-1; do
  if docker ps --format '{{.Names}}' | grep -qx "$c"; then
    count="$(docker logs --since "$SINCE" "$c" 2>&1 | grep -c '"level":"error"\|maintenance.cleanup_error\|maintenance.error\|job.heartbeat.lost' || true)"
    [ "${count:-0}" -gt 0 ] && add "$c: $count error-level log lines in last $SINCE (docker logs --since $SINCE $c)"
  else
    add "$c: container NOT running"
  fi
done

# 2. Dead/failed jobs newly created in the window.
set -a; source .env 2>/dev/null; set +a
PSQL=(docker exec cap4-postgres-1 psql -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-cap4}" -tAc)
dead="$("${PSQL[@]}" "SELECT count(*) FROM job_queue WHERE status='dead' AND updated_at > now() - interval '${SINCE/h/ hours}'" 2>/dev/null || echo "query-failed")"
[ "$dead" = "query-failed" ] && add "postgres: health query failed"
[ "$dead" != "query-failed" ] && [ "${dead:-0}" -gt 0 ] && add "job_queue: $dead job(s) went dead in last $SINCE"

# 3. Videos stuck mid-transcode (rank 20-60 for >2h) — watchdog belt-and-braces.
stuck="$("${PSQL[@]}" "SELECT count(*) FROM videos WHERE deleted_at IS NULL AND processing_phase_rank BETWEEN 20 AND 60 AND updated_at < now() - interval '2 hours'" 2>/dev/null || echo 0)"
[ "${stuck:-0}" -gt 0 ] && add "videos: $stuck stuck mid-processing >2h (watchdog should have caught these)"

# 4. Host doc-worker: exactly one instance expected.
dw="$(pgrep -fc 'WORKER_ID=doc-worker-host|doc-worker.sh' || true)"
dw_node="$(pgrep -f 'node' | xargs -r -I{} sh -c 'grep -l doc-worker-host /proc/{}/environ 2>/dev/null' | wc -l)"
if [ "${dw_node:-0}" -eq 0 ]; then
  add "doc-worker: NOT running (generate_doc jobs will queue forever; restart: nohup ./scripts/doc-worker.sh >> /tmp/cap4-doc-worker.log 2>&1 &)"
elif [ "${dw_node:-0}" -gt 1 ]; then
  add "doc-worker: $dw_node instances running (expected 1 — kill the stale one; known past bug)"
fi

# 5. Recent errors in the doc-worker log file.
if [ -f /tmp/cap4-doc-worker.log ]; then
  recent_errors="$(tail -n 500 /tmp/cap4-doc-worker.log | grep -c '"level":"error"\|maintenance.cleanup_error' || true)"
  [ "${recent_errors:-0}" -gt 0 ] && add "doc-worker log: $recent_errors error lines in last 500 lines (/tmp/cap4-doc-worker.log)"
fi

# 6. Public endpoint alive.
code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:8007/health || echo 000)"
[ "$code" != "200" ] && add "/health via nginx :8007 returned $code (expected 200)"

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  {
    echo "=== $NOW — ${#PROBLEMS[@]} problem(s) ==="
    printf ' - %s\n' "${PROBLEMS[@]}"
  } >> "$ALERT_LOG"
fi

# Always record the last run time so "is the watcher itself alive" is checkable.
echo "$NOW ${#PROBLEMS[@]} problem(s)" > /var/tmp/cap4-health-watch.lastrun
exit 0
