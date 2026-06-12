# DECISIONS — collapsed documentation pipeline (2026-06-11)

Ambiguity calls made during the autonomous session, simplest-option-first.

1. **Test baseline excludes live integration suite.** Unit baseline recorded
   as 38/38 (web 30, worker 8). The 18 integration tests run a real
   upload→Deepgram→Groq pipeline against the live Docker stack and consume
   paid credits; they were host-verified 18/18 on 2026-03-23 and were not
   re-run. Exit criterion compares against the 38 unit baseline.

2. **ffmpeg scene detection instead of PySceneDetect.** The worker is Node,
   and the runtime containers have no outbound network (cannot pip-install
   anything). ffmpeg's `select='gt(scene,T)'` + `metadata=print` produces the
   same contract (scene-change timestamps + scores) with zero new
   dependencies — ffmpeg is already required by the worker.

3. **ffmpeg crops instead of sharp.** Same constraint: `sharp` is a native
   module that could not be installed into the live worker container (deploys
   are hot-swapped compiled JS; images can't be rebuilt). ffmpeg's `crop`
   filter on a JPEG does the job with no new deps.

4. **SSIM dedup via pairwise ffmpeg `ssim` filter** on temporally adjacent
   candidate frames (drop the later frame when score > threshold). Bounded at
   ≤150 comparisons of ~768px JPEGs — cheap, deterministic, no new deps.

5. **One new job type (`generate_doc`) runs Stages A→D sequentially** inside
   the existing worker. The spec's "Stage D — new worker job type, not a new
   service" is read as: doc generation lives in the worker as a queue job.
   Splitting each stage into its own job type would add orchestration state
   for no benefit — stage results are cached, so a retried job re-enters
   cheaply.

6. **Doc generation is opt-in**, triggered by `POST /api/videos/:id/generate-doc`,
   never auto-enqueued on upload. The CLI backend draws from a limited
   subscription credit pool; the owner decides which recordings become docs.

7. **No default model IDs in code.** `DOC_MODEL_STRONG` / `DOC_MODEL_TRIAGE`
   are optional env vars with no zod defaults; the claude-cli backend throws
   `"DOC_MODEL_STRONG not configured"` at call time if unset. Suggested values
   live only in `.env.example`.

8. **Hallucinated frame refs: one corrective retry, then drop-with-note.**
   Stage D rejects any `frame_id` not in the manifest and retries the Stage C
   call once with the invalid refs listed. If refs are still invalid, the
   affected steps render without an image and the dropped refs are recorded in
   `documents.confidence_notes`. Nothing hallucinated is ever rendered, and
   nothing is dropped silently.

9. **Segment-level (not word-level) transcript timestamps.** Deepgram
   utterance segments already carry start/end seconds, which is all
   `source_span` needs. Word-level storage would touch the transcription
   path for no P0 benefit.

10. **Chapter boundaries are computed on the fly** (transcript silence gaps
    ≥ 3 s intersected with scene-change clusters), not persisted — they are
    only used to split >25 min recordings for Stage C and are deterministic
    from inputs that are persisted.

11. **Deployment is a known issue, not solved here.** The doc pipeline
    requires the `claude` CLI + OAuth login in the worker's environment; the
    live worker container has neither. It runs today via the host worker
    (`scripts/dev-local.sh`). See PIPELINE_V2.md §Deployment.

12. **Per-day call guard added** (`DOC_MAX_MODEL_CALLS_PER_DAY`, default 60)
    alongside the spec'd per-job guard, counted from a `doc_model_calls` log
    table — the simplest durable counter across worker restarts.

13. **Markdown is stored in `documents.markdown` (TEXT)**, with frame/crop
    images in MinIO under `videos/{id}/doc/`. No S3 round-trip needed to read
    a doc; images are served like thumbnails (relative `/cap4/...` paths).
    HTML render deferred to P1.

14. **`POST /api/videos/:id/generate-doc` requires `transcription_status =
    'complete'`** and returns 409 otherwise. A doc without a transcript
    contradicts the Stage C contract; `no_audio` videos can't have docs.

15a. **Screenshot-spam hardening (owner feedback, 2026-06-12, prompt v2).**
    The first live 43-min doc used 3 frames for 18 of 25 step screenshots,
    sliced into ~5%-height row strips. Fixes: deterministic Stage D guard
    (max 2 image uses per frame, no duplicate frame+crop, slivers widened to
    ≥12%), prompt v2 (screenshots only when informative, no row-slicing),
    ≤40 images per model call, SSIM dedup tightened to 0.92. PROMPT_VERSION
    bumped to v2 so caches invalidate correctly.

15. **Additive-only guarantee (owner request, mid-session).** Nothing in the
    existing pipeline was changed: Groq still does title/summary/chapters/
    enrichment on its own API key, Deepgram still does transcription +
    diarization, speaker label editing and transcript download are untouched.
    The doc pipeline is a separate opt-in job type with its own tables and
    routes; the only edits to existing files are registrations (worker
    dispatch branch, web-api route module, config/env additions). Deleting
    `apps/worker/src/doc/`, `routes/docs.ts`, and migration 0008 would restore
    the previous system exactly.
