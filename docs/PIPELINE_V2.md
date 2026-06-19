# PIPELINE_V2 — Collapsed Documentation Pipeline

Turns a processed recording into a structured how-to document
(runbook / tutorial / SOP) with a few frame screenshots: one deterministic
preprocessing pass, **ONE model call** (plus at most one corrective retry),
and a deterministic render. All LLM access goes through headless Claude Code
(`claude -p`) on the developer's OAuth subscription — **no API keys, no SDK**.

```
upload ──► transcode (media-server) ──► transcription (Deepgram)   [existing]
                                              │
              POST /api/videos/:id/generate-doc  (opt-in trigger)
                                              ▼
                                  job_queue: generate_doc
                                              │
   Stage A  candidate frames  (ffmpeg, deterministic, no LLM)
   Stage C  doc pass — ONE model call (DocModelClient, DOC_MODEL_STRONG)
   Stage D  validate + crop + render markdown + persist (no LLM)
                                              ▼
                       documents / doc_sections / doc_steps (+ frames)
```

## Model access layer — `DocModelClient`

`apps/worker/src/doc/model-client.ts`

```ts
generateStructured({ systemPrompt, userPrompt, imagePaths, schema, model,
                     workdir, cacheKey, videoId, purpose }) → parsed JSON
```

Backend selected by `DOC_MODEL_BACKEND`:

- **`claude-cli`** (default, implemented): spawns
  `claude -p --output-format json --model <id> --append-system-prompt <sys>
  --allowedTools Read` with `cwd` set to a temp job folder containing the
  frame JPEGs, so the model reads images from disk by relative path. The user
  prompt is piped via stdin. stdout is parsed as CLI JSON (`.result` holds the
  text), the text is parsed as JSON (code fences stripped) and validated with
  zod. On malformed/invalid output the call is retried **once** with the
  validation error appended. Per-call timeout `DOC_MODEL_TIMEOUT_MS` (SIGKILL
  on expiry); stderr is captured into job logs.
- **`anthropic-api`**: interface stub only — throws
  `"anthropic-api backend not configured"`. Swapping backends later is a
  config change (`DOC_MODEL_BACKEND=anthropic-api`) plus implementing the stub
  against the Claude API with a paid key; callers are backend-agnostic.

Model IDs are never hardcoded: callers resolve `DOC_MODEL_STRONG` from env;
the client throws if the resolved value is empty.

**Caching (P0).** Before spawning, the client checks `doc_model_cache` by
`cacheKey` (SHA-256 over transcript hash + frame-manifest hash + prompt
version + model); hits return the cached JSON for free. Every real call is
appended to `doc_model_calls`.

**Call guards (P0).** A real (cache-miss) call throws if the per-job count
would exceed `DOC_MAX_MODEL_CALLS_PER_JOB` (default 6) or the trailing-24h
count in `doc_model_calls` would exceed `DOC_MAX_MODEL_CALLS_PER_DAY`
(default 60).

## Stage A — deterministic preprocessing (no LLM)

`apps/worker/src/doc/stage-a.ts`

Inputs already exist: normalized mp4 in MinIO (`result_key`, falling back to
`raw_key`) and the Deepgram segment-timestamped transcript.

1. **Scene detection**: `ffmpeg -vf "select='gt(scene,0.10)',metadata=print"`
   → list of `{ts, score}` scene changes (no PySceneDetect — see
   DECISIONS.md #2).
2. **Candidate frames**: captured at `scene_change_end + 500 ms` (clamped to
   duration), downscaled to 768 px wide JPEGs. Target band **12–40 frames**
   (docs only render a handful of screenshots, so extraction stays light):
   sparse timelines are supplemented with uniform samples; above 40 the
   lowest-score scene changes are dropped.
3. **SSIM dedup**: adjacent frames compared with ffmpeg's `ssim` filter;
   the later frame is dropped when `All ≥ 0.92`.

Frames are uploaded to `videos/{id}/frames/f_NNNN.jpg` and recorded in the
`frames` table. Frame ids exposed to the model are the stable labels
`f_0001 …`.

## Stage C — one strong-model call per recording (`DOC_MODEL_STRONG`)

Exactly ONE model call per recording, regardless of length: the full
transcript (with `[mm:ss]` markers), a manifest of at most **16 frame
images** (evenly thinned across the timeline), and the images readable from
the working directory. No triage pass, no chaptering, no merge pass — one
recording, one call. Output is strict JSON:

```json
{
  "title": "...",
  "doc_type": "runbook|tutorial|sop",
  "sections": [{
    "heading": "...", "body_md": "...",
    "steps": [{"text": "...", "frame_id": "f_087",
      "crop": {"x":0.6,"y":0.1,"w":0.35,"h":0.3},
      "alt": "...", "callout": "..."}],
    "source_span": {"start_s": 261, "end_s": 318}
  }],
  "unused_frames": [], "confidence_notes": []
}
```

`frame_id`, `crop`, `alt`, `callout` are optional per step. The prompt
instructs at most 5 screenshots per document, attached only where seeing the
screen is essential.

Results are cached by SHA-256(transcript hash + manifest hash + prompt
version + model), so retries and re-renders cost zero credits.

## Stage D — deterministic render

`apps/worker/src/doc/stage-d.ts`, running inside the `generate_doc` worker
job (not a new service).

1. **Frame-ref validation**: every `step.frame_id` must exist in the
   manifest. On hallucinated refs the Stage C call is retried once with the
   invalid ids listed; refs still invalid after that are dropped from their
   steps and recorded in `confidence_notes` — never rendered silently.
1b. **Screenshot budget guard** (`dedupeStepImages`): at most 6 screenshots
   per document, at most 2 uses of any frame, no duplicate frame+crop, and
   sliver crops (<12% of the frame) widened to a usable centered region.
   Removals are summarized in one confidence note — deterministic, so it
   holds even if the model ignores the prompt.
2. **Crops**: frames pulled from MinIO; fractional `crop` boxes applied with
   ffmpeg's `crop` filter (not sharp — DECISIONS.md #3), written to
   `videos/{id}/doc/{frame_id}_crop.jpg`.
3. **Render**: markdown assembled (title, sections, steps, images via
   relative `/cap4/<s3-key>` paths, callouts as blockquotes, source spans as
   `[mm:ss–mm:ss]` annotations) and stored on the document row.
4. **Persist** (one transaction): `documents` (title, doc_type, markdown,
   status, notes), `doc_sections` (heading, body, source_span),
   `doc_steps` (text, `frame_id` FK → `frames`, crop JSON, alt, callout).

## Data model (migration `0008_doc_pipeline.sql`)

- `job_type` enum += `generate_doc`
- `frames(id, video_id FK, frame_no, ts_seconds, s3_key, caption,
  classification, created_at)` — unique `(video_id, frame_no)`
- `documents(id, video_id FK unique, status generating|complete|failed,
  title, doc_type, markdown, confidence_notes jsonb, unused_frames jsonb,
  prompt_version, model, error_message, timestamps)`
- `doc_sections(id, document_id FK, position, heading, body_md, start_s,
  end_s)`
- `doc_steps(id, section_id FK, position, text, frame_id FK→frames,
  crop jsonb, alt, callout)`
- `doc_model_cache(cache_key PK, response_json, model, created_at)`
- `doc_model_calls(id, video_id, purpose, model, created_at)`

## API

- `POST /api/videos/:id/generate-doc` — enqueues `generate_doc`
  (409 unless `transcription_status = 'complete'`; idempotent while a job is
  active via the existing one-active-job-per-type constraint).
- `GET /api/videos/:id/doc` — document + sections + steps (404 until one
  exists).

## Configuration

| Var | Default | Purpose |
|-----|---------|---------|
| `DOC_MODEL_BACKEND` | `claude-cli` | `claude-cli \| anthropic-api` |
| `DOC_MODEL_STRONG` | *(unset)* | model id for the single doc call (`claude -p --model`) |
| `DOC_MODEL_TIMEOUT_MS` | `300000` | per-CLI-call timeout |
| `DOC_MAX_MODEL_CALLS_PER_JOB` | `6` | per-job real-call guard |
| `DOC_MAX_MODEL_CALLS_PER_DAY` | `60` | trailing-24h real-call guard |

## Deployment

The claude-cli backend requires the `claude` binary and an OAuth login, which
the worker **container** does not have (and has no outbound network to
install). The split is therefore:

- **Container worker** (unchanged env): claims every job type EXCEPT
  `generate_doc` — workers without `WORKER_JOB_TYPES` exclude it by default,
  so doc jobs can never be picked up by a worker that can't run them.
- **Host doc worker**: `scripts/doc-worker.sh` runs the same compiled worker
  on the host with `WORKER_JOB_TYPES=generate_doc` (claims ONLY doc jobs),
  `WORKER_ID=doc-worker-host`, and DB/MinIO reached via their docker network
  IPs (resolved at startup; postgres/minio publish no host ports). Start it
  with `nohup ./scripts/doc-worker.sh >> /tmp/cap4-doc-worker.log 2>&1 &`.
  If it isn't running, doc jobs simply wait in the queue (UI shows
  "generating") until it starts — nothing breaks.

`WORKER_JOB_TYPES` (CSV allowlist) is general: any worker can be pinned to a
subset of job types.

## UI

VideoPage right rail has a **Doc** tab (`DocCard.tsx`): shows a manual
"Generate doc" button (enabled once transcription is complete), polls while
generating, then renders the document — sections with `[mm:ss]` jump links,
numbered steps with screenshots (click a screenshot to seek the player to
that moment), callouts, confidence notes, a **Download .md** button, and a
Regenerate action (cached model calls make regeneration cheap unless inputs
changed).

## Failure & retry behavior

- The `generate_doc` job uses the standard queue retry/backoff
  (`WORKER_MAX_ATTEMPTS`); stage results are cached, so retries skip
  completed model calls.
- Media-server-style internal retries are not duplicated here; the only
  in-job retry is the single malformed-JSON / hallucinated-ref corrective
  call.
- Terminal failure sets `documents.status='failed'` + `error_message`
  (visible via `GET /api/videos/:id/doc`).

## Testing

- Unit: model client (parse / retry-once / timeout / guards / cache), Stage A
  pure functions (scene parse, capture timing, chaptering), Stage C cache key
  + chapter split, Stage D validation + render.
- Integration (model **mocked** with fixture JSON, local files standing in
  for MinIO): full A→D pass over generated fixture frames asserting every
  step has ≥1 valid frame ref and zero unvalidated refs reach the render.
- Live smoke (opt-in, skipped in CI): `DOC_LIVE_SMOKE=1 pnpm --filter
  @cap/worker test` runs one real `claude -p` structured call end to end.
