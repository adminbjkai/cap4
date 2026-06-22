# Working Memory — cap4

**Last updated:** 2026-06-19 (security/CI/DX hardening pass — committed, pushed, and LIVE in prod; see Current State)
**Project:** cap4 — single-tenant video processing platform
**Source dir:** cap3test (virtiofs mount — cannot rename, this IS cap4)
**GitHub:** https://github.com/adminbjkai/cap4

> **Deploy note (2026-06-05):** the live stack's containers have no outbound
> network, so images cannot be rebuilt with `docker compose build`. Frontend is
> built on the host (`pnpm --filter @cap/web build`) and copied into the
> `cap4_web_dist` volume (then `nginx -s reload` on `cap4-web-internal-1`).
> Backend route changes are compiled on the host and hot-swapped into
> `cap4-web-api-1` via `docker cp` + `docker restart`. See the
> `frontend-deploy-mechanism` memory.
>
> **Correction (2026-06-19):** on this host the **build environment CAN reach
> apk + npm**, and `docker compose build web-api worker media-server` succeeded —
> so dependency/image changes ARE deployable here (build → tag old images
> `:rollback` → `docker compose up -d --no-deps <svc>` per service → verify
> `/health`). Use this for changes that live in `node_modules` (dep bumps), which
> the `docker cp dist/` hot-swap does NOT carry. Also: the nginx config is a
> **single-file bind mount**, so editing `docker/nginx/default.conf` then
> `nginx -s reload` does NOT pick up the change (reload re-reads the old inode) —
> **restart `cap4-web-internal-1`** instead. Full request path:
> `cap4.bjk.ai` → host nginx (`/etc/nginx/sites-enabled/cap4.bjk.ai`, bjk.ai
> wildcard TLS) → `127.0.0.1:8007` → `cap4-web-internal-1` → web-api/minio/static.

---

## Current State

### 2026-06-22 — Doc screenshots now high-res (LIVE — deployed + validated)
- **Fix:** doc-pipeline frames were extracted at 768px (`stage-a.ts` `scale=768:-2`,
  `-q:v 4`) and the doc UI (`DocCard.tsx` `<img src=frameKey>`) renders that frame
  directly — so screenshots looked soft/pixelated when enlarged. Raised extraction to
  **up to 1920px wide** (`scale=min(1920\,iw):-2`, capped, never upscaled) at `-q:v 2`;
  `stage-d.ts` crops bumped to `-q:v 2` too. Worker-only change (no schema/route/frontend
  change); same frames are the model's vision input, so this also gives the model crisper
  input. Files: `apps/worker/src/doc/stage-a.ts`, `stage-d.ts`.
- **Deploy:** rebuilt `apps/worker/dist`, restarted the **host doc-worker** (it alone
  processes `generate_doc`; the container worker excludes it). Caught + killed a STALE
  doc-worker (pid from Jun 18) running old code so only one runs the new code.
- **Validated live:** regenerated video `098e5a81` — frames went **768×432 → 1920×1080**
  (47KB → 328KB), worker job 783 complete, served via `/cap4/.../frames/`. Existing docs
  keep their old frames until regenerated (Regenerate button); browser may cache old
  frame URLs (same keys) — hard-refresh to see the new ones. Model call was a cache hit
  (no extra spend); stage-a re-extracts frames every run regardless.

### 2026-06-19 — Security/CI/DX hardening pass (LIVE — committed, pushed, deployed)
- Three `/improve` plans executed, committed (`8cc7aaa` feature work + `e4a311a`
  hardening), **pushed** to `feat/collapsed-doc-pipeline`, and **deployed to prod**
  (cap4.bjk.ai) and verified end-to-end. Plans + status in `plans/`; full rationale in
  `DECISIONS.md #16`. Independently fresh-context-verified (PASS on 7 checks:
  typecheck/test/build green — web 36, worker 51; `pnpm audit --prod` clean; no peer
  mismatch; no Anthropic SDK/API introduced).
- **Deploy (2026-06-19), all on this host, rollback-protected, verified live:**
  1. **Frontend** rebuilt on host → new `dist` copied into `cap4_web_dist` volume
     (additive, zero-downtime; `https://cap4.bjk.ai/` 200 serving the new bundle).
  2. **nginx `/ready`**: edited `docker/nginx/default.conf`; the single-file bind mount
     needed a `cap4-web-internal-1` **restart** to pick it up (a reload re-reads the old
     inode). `/ready` now proxies to web-api (real readiness JSON) instead of falling
     through to the SPA. `make smoke` passes.
  3. **Backend dep patches**: `docker compose build web-api worker media-server` (build
     env CAN reach apk+npm — see deploy-note correction below), then recreated all three
     with `--no-deps`, one at a time (worker → media-server → web-api), each verified
     healthy. **Live containers now run fastify 5.8.5 / fast-uri 4.0.0 / fast-xml-parser
     5.9.2.** Old images kept as `cap4-{web-api,worker,media-server}:rollback` (safe to
     delete once confident). Rollback volume backup: `/tmp/cap4_web_dist_ROLLBACK.tgz`.
  4. **Upload ceiling raised 500M → 10g** (owner request). Uploads flow through BOTH
     nginx layers, so both were raised: container nginx `docker/nginx/default.conf`
     (committed) and the **host** nginx `/etc/nginx/sites-available/cap4.bjk.ai`
     (system file, NOT in repo; backup at `…cap4.bjk.ai.bak-20260619-uploadlimit`,
     `sudo nginx -t` + `sudo nginx -s reload`). Request buffering left ON by default —
     turning it off breaks S3 presigned-PUT signatures (need fixed Content-Length).
     Note: files >5 GB must use the multipart upload path (S3 single-PUT cap is 5 GB);
     large single PUTs are buffered to nginx temp disk, so ensure host disk headroom.
- **Dependency-vuln remediation (Plan 001):** `pnpm audit` went 36 advisories (1 crit + 15
  high) → **0 in production deps**. Request-path libs patched: `fastify ^5.8.5`, plus root
  `pnpm.overrides` for `fast-uri >=3.1.2` / `fast-xml-parser >=5.7.0` / `ws >=8.21.0` /
  `flatted >=3.4.2`; `react-router-dom ^6.30.4`, `happy-dom ^20.8.9`. Residual advisories
  are **dev/build tooling only** (vitest `--ui`, vite-5 dev server, picomatch) — never run
  in the nginx-served prod stack; clearing them needs the deferred **vite 5→6 major**, so
  `vitest` is pinned to `~4.0.18` (vite-5-compatible) for now.
- **CI consolidation (Plan 002):** deleted the redundant `test.yml`; `ci.yml` is now the
  single workflow on **pnpm 9** (was split pnpm 8 / pnpm 9) with lint/typecheck/
  test(+postgres)/build/**audit** jobs. New `audit` job runs `pnpm audit --prod
  --audit-level=high` (gates shipped deps; won't red on the deferred dev advisories).
- **Smoke/docs port fix (Plan 003):** `make smoke` + README now target the nginx host
  port (`PORT`, default 8007) instead of the unexposed `:3000`; added a `location /ready`
  proxy to `docker/nginx/default.conf` (mirrors `/health`). **Deploy step still pending:**
  the nginx `/ready` change needs `nginx -s reload` on `cap4-web-internal-1` for `make
  smoke`'s `/ready` check to pass live. `playwright.config.ts` intentionally unchanged
  (its `webServer` self-boots web-api on :3000, so that default is correct).
- **Additive-only / no UX change:** no application source or user-facing behavior changed;
  Groq/Deepgram/doc pipeline untouched. Claude usage remains subscription/OAuth CLI only
  (no API key) — see `claude-subscription-auth-only` memory.

### 2026-06-18 — Record page: drag-and-drop + clipboard paste upload (LIVE)
- The `/record` "Use an existing local file" area is now a **dashed dropzone**: drag &
  drop a video onto it, or **paste a file with ⌘V / Ctrl+V** (window `paste` listener
  reads `clipboardData.files`), in addition to the existing Choose File input. All three
  funnel through the existing `handleExistingFileSelection`. New `acceptIncomingFile`
  guard accepts `video/*` (or unknown type) and rejects other types with a hint.
  RecordPage.tsx only; verified live via Playwright (drop + paste both load preview).

### 2026-06-18 — Doc export with embedded images: DOCX + PDF (LIVE)
- Doc tab download was raw `.md` only (images were remote refs, not in the file). Added
  a **"Download ▾" menu** in `DocCard.tsx`: **PDF (with images)**, **Word .docx (with
  images)**, and Markdown (.md). PDF/DOCX are **self-contained** — screenshots fetched
  (same-origin `/cap4/...`) and embedded inline, matching the Doc tab.
- Pure **client-side** export (`apps/web/src/lib/doc-export.ts`): walks the doc
  sections/steps/callouts/confidenceNotes. Uses `docx@9.7.1` + `jspdf@4.2.1`,
  **dynamically imported** so they code-split into lazy chunks (only load on export).
  No backend route, no model calls, no container changes.
- Verified live via Playwright on dcb167cd: PDF 228KB (`%PDF`), DOCX 199KB (zip with
  `word/media/` images), no console errors. Web tests 36/36. Deployed via host build →
  `cap4_web_dist` volume copy → nginx reload (see `frontend-deploy-mechanism`).

### 2026-06-18 — Raw-original prune (disk cleanup) + doc-worker reboot fix (LIVE)
- **Disk cleanup**: cap4 used to keep BOTH the raw upload (`raw/source.mp4`) and the
  transcoded `result/result.mp4` forever — raws were ~62% of MinIO. New
  `scripts/prune-raw-originals.{sh,mjs}` deletes the raw S3 object once a video is done
  with it (`transcription_status IN ('complete','no_audio') AND result_key NOT NULL AND
  deleted_at IS NULL`). **Deletes the S3 object ONLY — never touches `uploads.raw_key`**
  (NOT NULL, read without null-guards by upload endpoints; nulling = risk). Safe because
  a complete video's raw is never read again (transcribe short-circuits on status before
  the `raw_key ?? result_key` read; doc prefers result_key; cleanup is null-guarded +
  idempotent). Backfill freed **27.6 GB** (videos dir 44G→17G); E2E-verified videos still
  play + transcripts/docs intact. **Daily host cron** (4:30am, `--min-age-hours 24`)
  keeps it pruned. Tradeoff: can't re-transcode from pristine source anymore.
  See memory `raw-original-prune-cleanup`.
- **Doc-worker reboot fix**: the host doc-worker (processes `generate_doc`) had died on
  a host reboot (~2026-06-16), so manual Generate-doc clicks queued forever and `GET
  /doc` 404'd. Restarted it; added `@reboot` crontab entry + PATH incl.
  `/home/bjkai/.local/bin` so it auto-starts with `claude` on PATH. **Doc generation
  remains manual-only** (enqueued ONLY by `POST /api/videos/:id/generate-doc`, docs.ts:42
  — not in the automated pipeline). See memory `doc-worker-host-process`.

### 2026-06-11 — Collapsed doc pipeline (branch `feat/collapsed-doc-pipeline`, LIVE)
- **Deployed 2026-06-11**: migration 0008 applied to live DB; web-api + worker
  hot-swapped (incl. packages/config dist); frontend rebuilt + copied to
  `cap4_web_dist` volume; **host doc-worker running**
  (`nohup ./scripts/doc-worker.sh >> /tmp/cap4-doc-worker.log 2>&1 &`,
  `WORKER_ID=doc-worker-host`, claims ONLY `generate_doc` via the new
  `WORKER_JOB_TYPES` allowlist; container workers exclude generate_doc by
  default; doc worker does not survive host reboot — restart manually).
  E2E-verified live: video b3c85d5c → Doc complete, 2 model calls
  (haiku triage + opus doc), crops served via /cap4/ nginx path.
- **UI**: VideoPage right rail has a 4th tab **Doc** (`DocCard.tsx`):
  manual Generate button (enabled when transcription complete), polls while
  generating, renders sections/steps with screenshots (click → seek player),
  callouts, confidence notes, Download .md, Regenerate. DOC_* config lives in
  live `.env`.
- **New opt-in feature, purely additive** — turns a recording into a structured
  how-to doc (runbook/tutorial/SOP) with frame screenshots. Nothing in the
  existing pipeline changed: Groq summary/chapters/title, Deepgram
  transcription/diarization, speaker editing, transcript download all work
  exactly as before on their existing API keys.
- **All LLM calls via headless Claude Code** (`claude -p`, OAuth subscription —
  no ANTHROPIC_API_KEY, no SDK). `DocModelClient` in
  `apps/worker/src/doc/model-client.ts`: claude-cli backend (JSON parse,
  zod validation, retry-once, timeout, stderr capture) + anthropic-api stub.
  Credit protection: result cache (`doc_model_cache`, SHA-256 of
  transcript+manifest+prompt version+model) and call guards
  (`DOC_MAX_MODEL_CALLS_PER_JOB`=6, `DOC_MAX_MODEL_CALLS_PER_DAY`=60).
  Models via `DOC_MODEL_STRONG` / `DOC_MODEL_TRIAGE` env (never hardcoded).
- **Stages** (single `generate_doc` worker job, triggered only by
  `POST /api/videos/:id/generate-doc`; prompt v3, simplified 2026-06-12 per
  owner): A) ffmpeg scene detect → 12-40 deduped 768px frames (no LLM);
  C) **ONE strong-model call** per recording regardless of length (≤16 images
  sent; no triage/chaptering/merge — stage-b in .trash/); D) frame-ref
  validation (retry once on hallucinated refs, then drop-with-note) +
  screenshot budget (max 6/doc, 2/frame, no dup crops, slivers widened),
  ffmpeg crops, markdown render, persist to
  `documents`/`doc_sections`/`doc_steps`/`frames` (migration 0008, applied
  live). Read via `GET /api/videos/:id/doc`. v3 E2E live: 43-min video →
  complete in 75s, exactly 1 opus call.
- **Deploy constraint**: worker needs the `claude` CLI + login → host-run
  worker only (containers have no network/CLI). See docs/PIPELINE_V2.md.
- Tests: worker 51/51 (was 8), workspace 81 passing vs 38 baseline; live smoke
  (`DOC_LIVE_SMOKE=1`) verified once for real. Docs: docs/AUDIT.md,
  docs/PIPELINE_V2.md, DECISIONS.md.

### 2026-06-10 — Transcode timeout fix + lightweight status polling (live)
- **Transcode timeout fixed** — worker's media-server `POST /process` call now uses new
  `MEDIA_PROCESS_TIMEOUT_MS` config (default 30 min) instead of `PROVIDER_TIMEOUT_MS`
  (45 s), which aborted any long non-remuxable transcode (a 1h49m VP9 upload was stuck
  "downloading 20%" with transcript complete). Media-server work dir is now per-attempt
  (`/tmp/cap4-media/<videoId>-<uuid>`) so overlapping retries can't delete each other's
  files. Closes the "worker transcode timeout" open audit finding.
- **Transcription hardened** — new `TRANSCRIBE_TIMEOUT_MS` (default 10 min) for the
  Deepgram call (was the shared 45 s `PROVIDER_TIMEOUT_MS`, which aborted ~2 h files).
  `transcribe_video` now defers (new `snooze()` — requeue without consuming an attempt)
  while a `process_video` job for the same video is active, so the ffmpeg transcode no
  longer starves the Deepgram upload of CPU/bandwidth.
- **Compact transcription uploads** — worker streams the source to a temp file (never
  buffers GBs in RAM) and sends only the extracted mp3 audio track to Deepgram
  (~20-50x smaller upload); falls back to the original media if ffmpeg extraction fails.
- **Async media-server** — `POST /process` replies 202 immediately; the pipeline runs in
  the background and reports `probing`/`processing`/`uploading`/`complete`/`failed` via
  signed webhooks to web-api's `/api/webhooks/media-server/progress`, which now also
  persists `result_key`/`thumbnail_key`/`error_message` and owns downstream orchestration
  (queue transcription, or `no_audio`/`skipped`). The worker acks `process_video` at
  handoff; a maintenance watchdog fails videos stuck at rank 20-60 past
  `MEDIA_PROCESS_TIMEOUT_MS` with no active process job. Real per-phase progress now
  reaches the UI during transcode. Media-server retries the whole pipeline internally
  (3 attempts) before sending `failed`, replacing the queue-level retries the sync flow
  had. `/debug/smoke` updated to poll for terminal phase instead of expecting a sync
  result. E2E-verified live: happy path (VP9 upload → complete, all jobs attempt 1,
  full webhook trail) and failure path (missing S3 key → terminal `failed` + Retry works).
- **Status polling slimmed** — `GET /api/videos/:id/status?view=summary` returns the
  status fields without transcript segments / AI output (~0.5 KB vs ~292 KB). VideoPage
  polls the summary and refetches the full payload only when `transcriptionStatus` /
  `aiStatus` change. Polling still stops at terminal state.
- Deployed via hot-swap (worker, media-server, web-api videos route) + frontend volume
  copy; stuck video d1b084cd reprocessed successfully end-to-end. Web tests 30/30.

### 2026-06-05 — Phase 4.8 (live)
- **Rail-tab crossfade fix** — VideoPage tab transition no longer leaves the previous
  panel stuck as an absolute overlay under `prefers-reduced-motion` (effect timer race
  fixed + reduced-motion CSS hides `.rail-tab-panel-exit`).
- **Original file date** — `videos.original_file_created_at` (migration `0007`), captured
  from the browser `File.lastModified` on upload, surfaced as `originalFileCreatedAt` in
  `POST /api/videos` and `GET /api/library/videos`. Distinct from `created_at` (cap4 upload time).
- **Library list/table view** — homepage has a grid⇄list toggle (persisted in
  `localStorage:cap4:libraryView`). List view: EST date+time columns
  (**Uploaded (EST)** = `createdAt`, **File created (EST)** = `originalFileCreatedAt`),
  show/hide + drag-reorder columns (persisted `cap4:libraryColumns`), global + per-column
  filtering with clear-all, click-to-sort headers, and an inline-editable per-row **Note**
  (persisted `cap4:notes:<videoId>`, shared with the video page Notes tab). Frontend-only
  (no backend changes). Note: `File created` is blank for screen recordings / pre-`0007`
  rows — only file uploads populate it (from `File.lastModified`).
- Web test suite 30/30 (rail-tab + library-list: column hide, per-column filter/clear,
  note edit). Migration 0007 applied to live DB; web-api hot-swapped; frontend redeployed
  (twice); verified end-to-end.



Full-app review completed 2026-03-23 (Claude Opus 4.6 + Codex GPT-5.4, independent reviews, cross-validated). 15 security/correctness bugs fixed, 19 doc alignment issues corrected across two passes. Documentation re-scanned and verified against code. Host runtime verification also completed on 2026-03-23: `pnpm typecheck`, `pnpm build`, `docker compose up -d --build`, `GET /health`, `GET /ready`, `pnpm test:integration` (18/18), and `make smoke` all passed.

**Audit:** [audit-plan.md](docs/archive/audit-plan.md) — Phases A-F complete (F6 auth + F8 a11y deferred).

**Phase 4 — Integration Tests: ✅ 18/18 passing** (7 pipeline + 11 API contract; host-verified 2026-03-23)

### 2026-03-23 Review Fixes (15 code + 7 doc)
- ✅ **SSRF protection** — webhookUrl now validated (protocol, hostname blocklist for internal services)
- ✅ **Path traversal fix** — media-server validates videoId is UUID before S3 key construction
- ✅ **Webhook rate-limit bypass** — skip callback added to @fastify/rate-limit (was using unsupported per-route config)
- ✅ **Webhook secret hardened** — MEDIA_SERVER_WEBHOOK_SECRET now requires `.min(32)` (was `.min(1)`)
- ✅ **Webhook timestamp default** — WEBHOOK_MAX_SKEW_SECONDS now defaults to 300s (was NaN on missing env var)
- ✅ **Migration runner SQL injection** — version now uses dollar-quoting in psql INSERT
- ✅ **MinIO console** — port 8923 bound to 127.0.0.1 only
- ✅ **Unacked worker jobs** — skip paths in handleTranscribeVideo now call ack() before return
- ✅ **Webhook dedupe** — catches second unique constraint violation (source, job_id, phase, progress_bucket)
- ✅ **Webhook job queue** — deliver_webhook INSERT now has ON CONFLICT handling
- ✅ **Title handling** — /status now returns `v.name`; watch-edits falls back to `videos.name` when no ai_outputs row
- ✅ **Provider status** — deriveProviderHealthState returns `"idle"` (was `"ready"`, frontend mismatch)
- ✅ **Multipart soft-delete** — presign-part, complete, abort now JOIN videos and check deleted_at IS NULL
- ✅ **Groq chunk errors** — logged per-chunk failures, abort if >30% fail
- ✅ **DB pool config** — Pool now has max:20, idleTimeoutMillis:30000, connectionTimeoutMillis:5000
- ✅ **7 doc fixes** — master-plan Fastify version, deployment npm→pnpm, stale endpoints, media-server description, queue status enums

### Earlier Post-Audit Fixes
- ✅ **Deepgram diarization** — added `diarize=true` to Deepgram API call so multi-speaker videos get proper speaker labels
- ✅ **Multipart upload S3 client** — `complete` and `abort` endpoints now use internal S3 endpoint (was using public endpoint, causing ECONNREFUSED in Docker)
- ✅ **Presign-part idempotency** — frontend now sends `Idempotency-Key` header on `presign-part` requests (required after Phase F hardening)
- ✅ **Auto-upload recordings** — RecordPage auto-uploads immediately after capture; file selections still require manual "Upload and process"
- ✅ **Fullscreen video fix** — fullscreen now targets the container holding both `<video>` and controls overlay (was only fullscreening the controls div, leaving video behind)

### Latest Changes (Phase 4.7 — Agent Sprint: BJK-9 through BJK-18)
- ✅ **BJK-9** — micro-interaction animations added (page transitions, card motion, dialog backdrop)
- ✅ **BJK-10** — color system redesign and enhanced dark mode tokenization
- ✅ **BJK-11** — custom video controls shipped (play/pause, seek, volume, rate, PiP, fullscreen)
- ✅ **BJK-12** — library grid redesign with rich media cards and polished hover/processing states
- ✅ **BJK-13** — keyboard shortcuts + command palette (`Cmd+K` / `Ctrl+K`) and shortcuts overlay
- ✅ **BJK-14** — speaker diarization UI (badges, editable labels, filters) + API support for `speakerLabels`
- ✅ **BJK-15** — transcript confidence highlighting and uncertain-segment review workflow
- ✅ **BJK-16** — Groq enrichment upgrade: entities, action items, quotes + schema validation (chapter sentiment parsed but not yet persisted)
- ✅ **BJK-17** — transcript full-text search with highlighting + keyboard match navigation
- ✅ **BJK-18** — sage green theme pass, true-dark surfaces, delete button fix, summary strip between player and chapters

### Earlier Changes (Phase 4.5 — Docker & Config Audit)
- ✅ **Auto-migrations** — `migrate` service in docker-compose applies all pending SQL on startup
- ✅ `docker/postgres/run-migrations.sh` — migration runner with `schema_migrations` tracking table
- ✅ **Makefile** — `reset-db` = `down -v + up`; `migrate` target added
- ✅ **package.json** — `migrate` + `reset-db` scripts updated
- ✅ **`.env.example`** — comprehensive comments; `VITE_S3_PUBLIC_ENDPOINT` section documented
- ✅ **LOCAL_DEV.md** — full rewrite: Docker + no-Docker, port table, URL routing explanation
- ✅ **`scripts/dev-local.sh`** — run all 4 services without Docker

### Earlier Changes (Phase 4 + 4.5 branding)
- ✅ apps/web/index.html: title cap3 → cap4
- ✅ docker-compose.yml: container names cap3-* → cap4-* (commented)
- ✅ Integration test suite: 18/18 passing — full upload → transcribe → AI → complete pipeline (host-verified 2026-03-23)
- ✅ transcript.language defaulted to 'en' at 3 layers
- ✅ Migration 0004: backfills NULL language → 'en', adds NOT NULL DEFAULT 'en'

---

## Key Files

### Documentation (`docs/`)

| File | Purpose |
|------|---------|
| `README.md` | Clean project overview |
| `CONTRIBUTING.md` | Dev workflow and contribution guide |
| `docs/architecture.md` | State machine, job queue, services |
| `docs/api.md` | Full API reference + webhook contract |
| `docs/database.md` | Schema reference + migrations |
| `docs/environment.md` | Environment variable reference |
| `docs/local-dev.md` | Local dev setup (Docker + no-Docker) |
| `docs/deployment.md` | Production deployment guide |
| `docs/troubleshooting.md` | Common issues + fixes |
| `docs/design-system.md` | UI tokens and component guide |
| `docs/tech-stack.md` | Languages, frameworks, versions |
| `docs/agents.md` | AI agent roles and conventions |
| `docs/master-plan.md` | Authoritative plan — start here |
| `docs/tasks.md` | Current and completed work |
| `docs/qa.md` | Speaker diarization test plan |
| `docs/archive/audit-plan.md` | Completed audit tracker (phases A-F) |
| `docs/archive/roadmap.md` | Archived cap3 roadmap |

### Code

| File | Purpose |
|------|---------|
| `apps/web/src/components/CommandPalette.tsx` | Command palette modal with keyboard navigation |
| `apps/web/src/components/CustomVideoControls.tsx` | Custom player chrome and transport controls |
| `apps/web/src/components/ShortcutsOverlay.tsx` | In-app keyboard shortcut reference modal |
| `apps/web/src/hooks/useKeyboardShortcuts.ts` | Shared keyboard shortcut registration logic |
| `db/migrations/0005_add_ai_enrichment_fields.sql` | Adds AI enrichment columns: entities/action items/quotes |
| `db/migrations/0006_add_transcript_speaker_labels.sql` | Adds transcript speaker label storage column |
| `db/migrations/0007_add_original_file_created_at.sql` | Adds `videos.original_file_created_at` (source file's own date) |
| `apps/web/src/pages/HomePage.tsx` | Library grid + sortable/searchable list/table view + view toggle |
| `docker/postgres/run-migrations.sh` | Migration runner script |
| `scripts/dev-local.sh` | Run all services without Docker |
| `apps/web-api/src/index.ts` | Fastify entry — rate limiting + route modules |
| `apps/web/src/` | React/Vite frontend |

---

## Architecture in 30 Seconds

- **9 Docker services:** postgres + migrate (auto-runs SQL) + minio + minio-setup + web-api + worker + media-server + web-builder + web-internal (nginx)
- **Migrations:** `migrate` service uses `schema_migrations` table to track applied migrations; runs on every `docker compose up`
- **Job queue:** PostgreSQL `FOR UPDATE SKIP LOCKED` — no Redis
- **State machine:** Monotonic `processing_phase_rank`, terminal states: `complete`, `failed`, `cancelled`
- **Webhooks:** mainline flow — worker POSTs `/process`, media-server replies 202 and reports phases/completion/failure via signed webhooks to web-api, which owns finalize (result keys, queue transcription, no_audio). Worker watchdog fails videos stuck mid-processing past `MEDIA_PROCESS_TIMEOUT_MS`
- **AI:** Deepgram (transcription) + Groq (title/summary/chapters)
- **URL routing:** Frontend uses relative `/cap4/...` paths → nginx proxies to MinIO (Docker); Vite dev server proxies to `localhost:9000` (local dev)

---

## URL Configuration Notes

| Env var | Used by | Purpose |
|---------|---------|---------|
| `S3_ENDPOINT` | Backend (server→MinIO) | Internal Docker URL: `http://minio:9000` |
| `S3_PUBLIC_ENDPOINT` | Backend (presigned PUT URLs + dev UI) | Browser-accessible: `http://localhost:8922` |
| `VITE_S3_PUBLIC_ENDPOINT` | Frontend (build-time) | Leave unset for Docker nginx (uses relative path); set to `http://localhost:8922` for Vite dev + Docker infra |

---

## Glossary

| Term | Meaning |
|------|---------|
| cap3test | The working source directory (virtiofs mount — IS cap4) |
| cap4 | The project name |
| monolith | Was `apps/web-api/src/index.ts` (2007 lines) — now split into route modules ✓ |
| Phase 1 | API split + GitHub repo creation ✓ |
| Phase 2 | Player UI (ChapterList, TranscriptParagraph, lg breakpoint) ✓ |
| Phase 3 | Hardening (rate limiting, nginx, fastify v5, key log audit) ✓ |
| Phase 4 | Integration tests — 18/18 passing (host-verified 2026-03-23) |
| Phase 4.5 | Docker/config audit — auto-migrations, local dev docs ✓ |
| command palette | Global quick-action and navigation modal opened via `Cmd+K` / `Ctrl+K` |
| speaker diarization | Per-segment speaker attribution with editable display labels |
| confidence review | Transcript mode focused on low-confidence segments for verification |
| custom controls | App-rendered video controls replacing native browser video chrome |
| sage green theme | Muted green accent system replacing prior blue-heavy palette |
| Phase 5 | Auth — single-user JWT/session (deferred by owner; out of scope) |
| schema_migrations | Table tracking which SQL migrations have been applied |
| migrate service | Docker Compose service that auto-runs migrations on startup |
| progress_bucket | Webhook dedup column — prevents duplicate 10%-bucket updates |
| delivery_id | Webhook idempotency key stored in the webhook_events table |
| phase_rank | Integer enforcing monotonic state transitions |
| SKIP LOCKED | PostgreSQL clause for lock-free concurrent job claiming |
| audit-plan.md | Completed audit doc at `docs/archive/audit-plan.md` (6 phases A-F) |
| unacked skip | Worker bug: handler returns without calling ack(), job retries forever |
| job_status enum | `queued \| leased \| running \| succeeded \| cancelled \| dead` — no `'failed'` |

---

## People / Context

- **Murry** — owner, sole developer

---

## What to Ignore

Nothing left to ignore — repository is clean. `.gitignore` covers all dev artifacts.
