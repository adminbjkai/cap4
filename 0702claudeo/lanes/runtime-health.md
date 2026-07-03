# Lane brief — Live runtime health, logs, recent runs (prod host, cap4.bjk.ai)

> Produced 2026-07-02 by a fresh-context review agent (Sonnet) as part of the 0702 full audit.
> Read-only against the live stack: docker logs, psql read queries, cron, disk, process table.

# cap4 Live Runtime Health — Audit Brief

## 1. Overall Verdict: **Degraded** (not broken)

All 6 live containers are up, healthy, and stable (0 restarts across 13d–5w uptimes). Web-api `/health` and `/ready` return 200; `https://cap4.bjk.ai/` returns 200. Job queue is fully drained (0 queued/leased/running), no stuck videos, disk healthy (47% used). **However, a real bug in the worker's hourly maintenance sweep has been silently failing on every run since at least 2026-06-24 (likely since the 2026-06-19 deploy), which has disabled the stuck-video watchdog and left two cleanup tables growing unbounded.** User-facing pipeline (upload/transcode/transcribe/AI/doc) is unaffected today — no stuck videos currently exist — but the safety net for future stuck jobs is not functioning.

## 2. Findings, ranked by severity

**HIGH — Worker maintenance sweep permanently broken (`webhook_events.created_at` doesn't exist)**
`apps/worker/src/index.ts:270-273` (`CLEANUP_MAINTENANCE_SQL`): `DELETE FROM webhook_events WHERE created_at < now() - interval '7 days'` — but `webhook_events` has no `created_at` column, only `received_at` (confirmed via `\d webhook_events`). This runs inside the same DB transaction as the stuck-video watchdog (`index.ts:379-410`, `runMaintenance()`), so **the whole transaction aborts and rolls back on every hourly tick** — meaning the transcode watchdog (`processing_phase_rank BETWEEN 20 AND 60` → auto-fail on timeout) has never actually executed since this bug was introduced.
- Evidence: `docker logs cap4-worker-1` — `{"service":"worker","event":"maintenance.error","error":"error: column \"created_at\" does not exist"}` firing on an hourly timer, 204 occurrences in the last 2000 log lines, oldest sampled timestamp `2026-06-24T16:27:12Z`, still firing at `2026-07-03T03:27:12Z`.
- Downstream proof of never running: `webhook_events` has 373 rows with `oldest=2026-06-10` (16+ days old, should be pruned at 7 days); `idempotency_keys` has 1643 rows, **1566 of them already expired** and never deleted.
- Current impact is low (queue is fully drained, no stuck videos right now), but this is a latent risk: the next media-server crash that drops a webhook will leave a video stuck at rank 20-60 forever with no automatic recovery, exactly the bug this watchdog (from the 2026-06-10 changelog entry) was built to fix.
- **Fix is one line**: `created_at` → `received_at` in `apps/worker/src/index.ts:272`.

**LOW — Transient Groq `generate_ai` JSON-validation failures (self-healing)**
5 occurrences of `job.failed` for `generate_ai` in recent logs, all `groq request failed (400): json_validate_failed` / `max completion tokens reached before generating a valid document`. All retried automatically and succeeded on attempt 2 (e.g. job 952: attempt 1 failed 17:13:38, attempt 2 succeeded 17:14:22). Zero `dead` generate_ai jobs. Not urgent — external API/prompt-length issue, not a cap4 bug; watch frequency.

**LOW — One defunct ffmpeg zombie process**
`bjkai 4045709 ... Z Jul01 0:01 [ffmpeg] <defunct>` — a single zombie, not accumulating (12 zombies system-wide but only this one cap4-attributable). Not currently a problem; spot-check if it recurs or multiplies.

**INFO — 1 pre-existing dead job (not new)**
`job_queue` id 441, `process_video`, dead after 6 attempts, `created_at 2026-05-09`, `last_error: fetch failed`. Old, already terminal, not contributing to current queue health.

## 3. Anomalies worth watching
- Doc-worker host process (`pid 1486465`, `WORKER_ID=doc-worker-host`, `WORKER_JOB_TYPES=generate_doc`) is **single-instance, no duplicate** — the known "stale duplicate doc-worker" bug class is NOT currently present. Running since Jun 22, processed generate_doc jobs cleanly through job_id 971+ in the tail of `/tmp/cap4-doc-worker.log`, all `doc.job.complete` → `job.acked`, no doc job failures visible in the sampled log window.
- `crontab -l` confirms both expected entries present: `30 4 * * * .../prune-raw-originals.sh --min-age-hours 24` and `@reboot sleep 30 && .../doc-worker.sh`. Prune log (`/tmp/cap4-prune.log`) shows healthy repeated runs, freeing hundreds of MB to a few GB per run, 0 errors across all sampled runs.
- `cap4-migrate-1` and `cap4-minio-setup-1` are `Exited (0)` — expected one-shot init containers.

## 4. Queue / DB stats

| job_type | status | count |
|---|---|---|
| process_video | succeeded | 309 |
| process_video | dead | 1 |
| transcribe_video | succeeded | 307 |
| generate_ai | succeeded | 292 |
| cleanup_artifacts | succeeded | 19 |
| generate_doc | succeeded | 37 |

Currently queued/leased/running: **0** (empty). Videos not deleted: 285 `complete`/`complete`, 7 `complete`/`no_audio`+`skipped` — **0 videos in any non-terminal phase (rank 10-69)**. `documents`: 48 rows, 34 `complete`, 0 `failed`. `doc_model_cache`: 48 rows. `webhook_events`: 373 rows, all `accepted=true`, none rejected — but retention broken (see finding above).

## 5. Disk situation
- Host: `/dev/nvme1n1p1` 1.8T total, 808G used (47%), 933G free — healthy headroom.
- MinIO data volume (`cap4_minio_data`): 25G.
- All DB tables tiny (largest `transcripts` at 5.6MB); no table-bloat concern.
- No leftover `/tmp/cap4-media` dirs (media-server per-attempt work dirs cleaned up correctly). No stray nginx temp-upload dirs found.

**Recommended next step:** fix `apps/worker/src/index.ts:272` (`created_at` → `received_at`), rebuild worker dist, hot-swap `cap4-worker-1` (per the documented hot-swap deploy mechanism) — the one actionable, low-risk bug in this lane. Everything else is healthy or self-healing.
