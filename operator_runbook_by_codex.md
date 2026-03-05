# Cap Operator Runbook (Day-2 Ops)

This runbook is for running and debugging a self-hosted Cap deployment in production-like conditions.

Use this with the architecture guide in `guide_by_codex.md`.

## 1. Runtime Topology

Expected core services:

- `cap-web` (Next.js app + API + workflow endpoints)
- `cap-media-server` (FFmpeg/FFprobe processing)
- `cap-mysql`
- `cap-minio`

Quick status:

```bash
docker compose ps
```

## 2. Golden Signals

Track these continuously:

- Availability: `cap-web` health and response latency.
- Upload success rate: multipart complete success vs failures.
- Processing success rate: media-server job completion.
- Transcript success rate: `transcriptionStatus=COMPLETE` ratio.
- AI success rate: `metadata.aiGenerationStatus=COMPLETE` ratio.

## 3. Fast Health Checks

## 3.1 Service process health

```bash
docker compose ps
docker compose logs --tail=120 cap-web
docker compose logs --tail=120 media-server
```

## 3.2 URL reachability

```bash
curl -I https://<your-cap-domain>/
curl -I https://<your-cap-domain>/s/<videoId>
```

## 3.3 DB and object-path sanity

For a problem video ID, verify:

- `videos` row exists.
- `video_uploads` state (if present).
- `result.mp4` object exists in storage.
- transcript and AI statuses are sensible.

## 4. Primary Incident Classes

## 4.1 Video page loads but video playback fails

Symptoms:

- Browser console 404 on signed `result.mp4` URL.
- Player retries then fails.

Checks:

1. Confirm `result.mp4` key path exists for `ownerId/videoId/result.mp4`.
2. Inspect `cap-web` logs for multipart completion.
3. Verify signed URL target key and bucket are correct.
4. Check `video_uploads` not stuck in inconsistent state.

Likely causes:

- Upload never finalized.
- Wrong key path.
- Bucket mismatch between metadata and active storage config.

Actions:

- Retry upload for that recording.
- If stale/failed row remains, remove or reset only that row after backup.

## 4.2 Transcript never starts

Symptoms:

- `transcriptionStatus` remains `NULL`.
- No `[transcribeVideo]` lines in `cap-web` logs.

Checks:

1. `DEEPGRAM_API_KEY` present in `cap-web` env.
2. Video/organization transcript setting not disabled.
3. Upload row not falsely considered active (`uploaded < total` should be false for completed uploads).
4. Access page `/s/:videoId` to trigger `getVideoStatus` polling path.

Actions:

- Trigger retry endpoint: `/api/videos/<videoId>/retry-transcription`.
- If still blocked, inspect upload-state gating logic and row values.

## 4.3 Transcript completes but AI summary does not

Symptoms:

- `transcriptionStatus=COMPLETE`, `aiGenerationStatus=NULL/ERROR`.

Checks:

1. `GROQ_API_KEY` or `OPENAI_API_KEY` present.
2. AI feature enabled for owner/subscription state.
3. `transcription.vtt` exists and has usable content.
4. `cap-web` logs contain AI workflow launch lines.

Actions:

- Trigger retry endpoint: `/api/videos/<videoId>/retry-ai`.
- If `SKIPPED`, inspect transcript length/content quality.

## 4.4 Import/upload from dashboard fails with “Bad header / file failed to load”

Symptoms:

- Browser-side parser errors.
- Repeated media parser warnings in console.

Checks:

1. Confirm uploaded source file is valid (probe locally with ffprobe).
2. Verify source upload completed and storage object size > 0.
3. Check media-server logs for FFmpeg/FFprobe parse failures.

Actions:

- Retry with known-good MP4.
- If issue is source-specific, preprocess/remux source before upload.

## 4.5 Media processing stalls

Symptoms:

- `video_uploads.phase=processing` for long time.
- No completion webhook.

Checks:

1. `media-server` health and queue saturation.
2. Job manager load (`MAX_CONCURRENT_VIDEO_PROCESSES`).
3. Webhook secret and callback reachability.
4. Presigned URLs still valid.

Actions:

- Restart only affected service if deadlocked.
- Re-trigger processing for affected video.

## 5. Core SQL Checks

Run against MySQL for a specific video ID:

```sql
SELECT id, ownerId, orgId, transcriptionStatus, metadata, createdAt, updatedAt
FROM videos
WHERE id = '<videoId>';

SELECT video_id, phase, uploaded, total, processing_progress, processing_message, processing_error, updated_at
FROM video_uploads
WHERE video_id = '<videoId>';
```

Interpretation:

- `uploaded = total` with stale `phase='uploading'` is suspicious if old.
- `transcriptionStatus=PROCESSING` for long periods indicates workflow/provider stall.
- `metadata.aiGenerationStatus=PROCESSING` for long periods indicates AI workflow/provider stall.

## 6. Log Patterns to Search

## 6.1 Upload and completion

Search terms:

- `Creating multipart upload`
- `Completing multipart upload`
- `Multipart upload completed successfully`

## 6.2 Transcript

Search terms:

- `[Get Status] Transcription not started`
- `[transcribeVideo] Triggering transcription workflow`
- `[transcribe] Owner check`

## 6.3 AI

Search terms:

- `AI generation not started`
- `startAiGeneration`
- `aiGenerationStatus`

## 6.4 Media processing

Search terms:

- `/video/process`
- `phase: processing`
- `generating_thumbnail`
- webhook progress updates

## 7. Safe Recovery Actions

Prefer targeted actions over global resets.

## 7.1 Single-video retry flow

1. Retry transcription.
2. If transcript succeeds, retry AI generation.
3. If playback still fails, verify storage object and processing path.

## 7.2 Service restart order

When needed:

1. `cap-web`
2. `media-server`
3. Data services (`mysql`, `minio`) only if truly required

Command:

```bash
docker compose up -d --build cap-web
docker compose up -d --build media-server
```

## 7.3 Data safety rules

- Do not mass-delete rows without snapshot/backup.
- Scope DB edits to a single failing video first.
- Never reset all upload rows as first response.

## 8. Configuration Drift Checklist

Verify these stay aligned:

- `WEB_URL`, `NEXTAUTH_URL`, public domain, reverse proxy host.
- S3 public/internal endpoints and bucket name.
- Media server URL and webhook URL/secret.
- AI/transcript provider keys.

## 9. On-Call Triage Flow (10-minute path)

1. Confirm service health (`docker compose ps`).
2. Pull problem video row and upload row.
3. Confirm object existence and playback URL validity.
4. Check transcript and AI statuses.
5. Retry targeted workflow endpoint.
6. If still failing, escalate with captured logs + row snapshots.

## 10. Escalation Data to Capture

For each incident, keep:

- Video ID(s) and owner ID.
- Relevant DB rows (`videos`, `video_uploads`).
- `cap-web` and `media-server` log excerpts for that video.
- Browser network error lines (status codes + failing URLs).
- Timestamp window (UTC).

This enables deterministic root-cause analysis and avoids guess-based fixes.
