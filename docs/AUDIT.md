# Pipeline Audit — cap4 (2026-06-11)

Pre-implementation audit for the collapsed documentation pipeline
(`docs/PIPELINE_V2.md`). Baseline established on branch
`feat/collapsed-doc-pipeline` from `main` @ `c42d86c`.

## 1. Current pipeline stages

| Stage | Where it lives | Trigger / handoff |
|-------|----------------|-------------------|
| Upload (singlepart + multipart presign) | `apps/web-api/src/routes/uploads.ts`, `apps/web-api/src/routes/videos.ts` | Browser → presigned PUT to MinIO; `POST /api/uploads/complete` enqueues `process_video` (prio 100) + `transcribe_video` (prio 95) |
| Transcode / remux + thumbnail | `apps/media-server/src/index.ts` (`processVideo`, `canRemux`, `probeVideo`) | Worker `handleProcessVideo` POSTs `/process`; media-server replies 202, runs async, reports phases via signed webhooks |
| Webhook finalize | `apps/web-api/src/routes/webhooks.ts` | On `complete`: persists `result_key`/`thumbnail_key`, queues transcription or marks `no_audio`/`skipped` |
| Transcription | `apps/worker/src/index.ts` (`handleTranscribeVideo`), `apps/worker/src/providers/deepgram.ts`, `apps/worker/src/lib/ffmpeg.ts` | Streams source to temp file, extracts mp3, Deepgram `diarize=true`, stores VTT + `transcripts.segments_json`; defers (`snooze`) while transcode active |
| AI enrichment | `apps/worker/src/index.ts` (`handleGenerateAi`), `apps/worker/src/providers/groq.ts` | Enqueued by transcription finalize; title/summary/chapters/entities/action items/quotes → `ai_outputs` |
| User webhooks | `apps/worker/src/index.ts` (`handleDeliverWebhook`) | Best-effort POST, 5 attempts |
| Cleanup | `apps/worker/src/index.ts` (`handleCleanupArtifacts`) | Manual only — never auto-enqueued |

Job queue: Postgres `FOR UPDATE SKIP LOCKED`, lease/heartbeat/ack/snooze/fail,
monotonic `processing_phase_rank`, watchdog for lost media-server handoffs.
Worker runs 2 concurrent slots, `process_video` capped at 1.

### Dead / legacy code candidates

- `ai_provider` enum value `'openai'` (`db/migrations/0001_init.sql`) — no
  OpenAI integration exists anywhere. Harmless; leave (enum values can't be
  dropped without a rewrite).
- `processJob` dispatches `cleanup_artifacts` directly
  (`apps/worker/src/index.ts:1196-1199`) before calling `handleJob`, which has
  its own `cleanup_artifacts` branch — the branch in `handleJob` is unreachable.
- Stray comment `// ack is now purely transactional and moved up`
  (`apps/worker/src/index.ts:326`).
- `generate_ai` key-points fallback path (`chaptersJson` from `keyPoints`) is
  near-dead since Groq chapters are schema-validated, but still reachable.

None of these block the new pipeline; none were removed in this pass (out of
scope, conservative).

## 2. Schema review

Migrations `0001`–`0007` (runner: `docker/postgres/run-migrations.sh`,
tracked in `schema_migrations`, applied by the `migrate` compose service).

Existing tables: `videos`, `uploads`, `job_queue`, `transcripts`,
`ai_outputs`, `idempotency_keys`, `webhook_events`.

**There are no tables for frames or documents.** The only frame-like artifact
is the single thumbnail JPEG produced by media-server
(`videos/{id}/thumb/screen-capture.jpg`, `videos.thumbnail_key`).

`transcripts.segments_json` stores utterance-level segments
(`startSeconds`/`endSeconds`/`text`/`confidence`/`speaker`) — segment-level,
not word-level, timestamps.

## 3. Gaps versus target architecture

| Target (PIPELINE_V2) | Current state | Gap |
|---|---|---|
| Model access layer (`DocModelClient`, claude-cli backend) | Nothing — no Anthropic/claude code anywhere | Build from scratch |
| Stage A scene detection + candidate frames (50–150 @ ~768px) + SSIM dedup | One thumbnail frame | Build (ffmpeg-based; see DECISIONS.md on PySceneDetect/sharp) |
| Stage A chapter boundaries (silence gaps + scene clusters) | Groq generates "chapters" from text only, post-hoc | Build deterministic chaptering |
| Stage B frame triage | — | Build (P1) |
| Stage C single strong-model doc pass + caching + call guard | — | Build |
| Stage D render + `documents`/`doc_sections`/`doc_steps` | — | Build (new `generate_doc` worker job type + migration `0008`) |
| Word-timestamped transcript | Segment-timestamped (utterances) | Sufficient for `source_span` at seconds granularity — not extending (DECISIONS.md) |

## 4. Risk list

- **Runtime placement of `claude` CLI**: the live worker container has no
  outbound network, no `claude` binary, and no OAuth login. The doc pipeline
  is only runnable where the CLI is available (host via
  `scripts/dev-local.sh`, or a container with the CLI + credentials mounted).
  Known issue, documented in PIPELINE_V2.md §Deployment.
- **Native deps can't reach the container**: images can't be rebuilt
  (no outbound network), and backend changes are hot-swapped as compiled JS.
  Anything requiring new native modules (e.g. `sharp`) would break the
  hot-swap deploy path — that's why crops use ffmpeg instead.
- **Subscription credit pool**: `claude -p` draws from the developer's
  OAuth subscription. Caching (`doc_model_cache`) and call guards
  (`DOC_MAX_MODEL_CALLS_PER_JOB`, `DOC_MAX_MODEL_CALLS_PER_DAY`) are P0;
  doc generation is opt-in per video, never auto-enqueued on upload.
- **Env baking**: `VITE_S3_PUBLIC_ENDPOINT` is baked at frontend build time
  (pre-existing). New doc config is backend-only env, no baking risk.
- **Test coverage holes (baseline)**: web-api and media-server have zero unit
  tests; integration tests (18) require the live Docker stack + real
  Deepgram/Groq keys and were not re-run for this baseline (cost; they were
  host-verified 18/18 on 2026-03-23). Unit baseline on this machine:
  **38/38 passing** (web 30, worker 8).
- **Long-video CLI calls**: a >25 min recording triggers per-chapter Stage C
  calls — each is a separate `claude -p` spawn with images; per-job call guard
  (default 6) bounds the blast radius but very long recordings can hit it and
  fail before completing. Documented behavior, not silent.
- **`job_type` enum extension**: `ALTER TYPE ... ADD VALUE` is idempotent-ish
  via `IF NOT EXISTS` but cannot be used in the same transaction that uses the
  value — migration 0008 keeps the enum change in its own statement, mirroring
  migration 0003 (`deliver_webhook`).
