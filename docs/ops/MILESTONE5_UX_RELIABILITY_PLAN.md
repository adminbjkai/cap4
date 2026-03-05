# Milestone 5 Plan: UX + Reliability

## Working Mode (Single Document)
- This file is the single source of truth for plan, execution status, and acceptance evidence.
- Do not maintain a separate tracker file for Milestone 5.
- Status values: `todo`, `in_progress`, `done`, `blocked`.

## Scope and Guardrails
- Repository scope only: `/Users/m17/2026/gh_repo_tests/Cap_v2`.
- Product scope: single-tenant video app, public-by-ID sharing model, no auth/users/accounts.
- Runtime model: Docker-first only.
- API contract: keep existing endpoints unchanged unless absolutely required.
- Endpoint budget: add at most one new endpoint, and only with explicit justification.

## Current State Baseline (as of 2026-02-26)

### Frontend (`apps/web`)
- Pages: `HomePage`, `RecordPage`, `VideoPage`.
- Components: `AppShell`, `StatusPanel`, `PlayerCard`, `TranscriptCard`, `SummaryCard`.
- Flow: record screen + mic, local preview, signed PUT upload to MinIO, `/api/uploads/complete`, polling `/api/videos/:id/status`, playback + downloads.
- Theme baseline: warm off-white (`stone-50`), slate text, restrained green accent.

### Backend/Workers (Docker compose)
- `web-api`, `worker`, `media-server`, `postgres`, `minio`, `minio-setup` wired in `docker-compose.yml`.
- MinIO CORS allows browser `PUT` (`docker/minio/cors.json`).
- `worker` claims jobs via SQL leasing with `FOR UPDATE SKIP LOCKED` and bounded retries.
- `media-server` performs FFmpeg transcode + thumbnail generation and writes artifacts to S3/MinIO.

### Active Frontend-Used Endpoints
- `POST /api/videos`
- `POST /api/uploads/signed`
- `POST /api/uploads/complete`
- `GET /api/videos/:id/status`
- `GET /api/jobs/:id`

## Target Outcome
Improve UX quality and reliability without expanding platform scope.
- Calm, minimal UI language and clearer microcopy.
- Better recording robustness (permissions, mic selection, audio confidence, stop handling).
- Better upload robustness (accurate progress, retry behavior, clearer failure recovery).
- Better result/status page utility (status clarity, copy links, cleaner layout and empty states).

## Progress (Update During Execution)

### Phase A
| ID | Item | Primary Files | Status | Evidence |
|---|---|---|---|---|
| M5-A1 | Robust native stop-sharing handling | `apps/web/src/pages/RecordPage.tsx` | done | Added `finalizeRecording` guard + native track `ended` handler + deterministic timer/resource cleanup; no hung recording state after native stop path. |
| M5-A2 | Upload retry without re-record | `apps/web/src/pages/RecordPage.tsx`, `apps/web/src/lib/api.ts` | done | Retry flow reuses same recorded blob and created `videoId` via persisted upload context; added explicit `Retry upload` action. |
| M5-A3 | Clear permission/error recovery copy | `apps/web/src/pages/RecordPage.tsx` | done | Added targeted permission/mic/source/upload recovery messages with next action guidance. |
| M5-A4 | Resilient polling on transient errors | `apps/web/src/pages/VideoPage.tsx` | done | Poll loop now backs off on transient failures and keeps auto-retrying without breaking terminal-state behavior. |

### Phase B
| ID | Item | Primary Files | Status | Evidence |
|---|---|---|---|---|
| M5-B1 | Mic confidence meter | `apps/web/src/pages/RecordPage.tsx` | done | Added live mic confidence meter using `AudioContext` analyser with animation-frame updates and deterministic cleanup/reset when recording ends or mic disabled. |
| M5-B2 | Status clarity/step visualization | `apps/web/src/components/StatusPanel.tsx` | done | Step rail now derives completion from a local `processingPhase -> rank` map (not API rank), preserves phase labels/helper text, and keeps `Complete` inactive for `failed/cancelled` with explicit terminal-failure visual treatment. |
| M5-B3 | Copy links + feedback on result page | `apps/web/src/components/PlayerCard.tsx` | done | Added copy buttons for result/thumbnail URLs with inline success/failure feedback while preserving download links. |
| M5-B4 | Calm empty/loading states | `apps/web/src/components/PlayerCard.tsx`, `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/StatusPanel.tsx` | done | Added calm loading panel for status fetch, clearer no-result guidance, and improved home empty-state CTA/copy. |

### Phase C (Optional)
| ID | Item | Primary Files | Status | Evidence |
|---|---|---|---|---|
| M5-C1 | Microcopy and terminology consistency pass | `apps/web/src/pages/RecordPage.tsx`, `apps/web/src/pages/VideoPage.tsx`, `apps/web/src/components/StatusPanel.tsx`, `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/PlayerCard.tsx` | done | Standardized labels and action copy across Home/Record/Video/Status/Player (recording/process/output terminology, queue wording, state labels, button copy). |
| M5-C2 | Visual consistency pass | `apps/web/src/components/AppShell.tsx`, `apps/web/src/index.css` | done | Refined navigation active treatment, restrained warm header surface, and consistent focus-visible affordance while preserving calm warm off-white/slate palette and restrained accent. |

### Phase D (Transcription + AI Pipelines)
| ID | Item | Primary Files | Status | Evidence |
|---|---|---|---|---|
| M5-D1 | Worker pipeline completion (`process -> transcribe -> ai`) | `apps/worker/src/index.ts` | done | Audio flow reached `processing=complete`, `transcription=complete`, `ai=complete` for `videoId=c6e99a94-af1f-4f9f-8f9f-db15cda934ae` with queue rows `process_video/transcribe_video/generate_ai` all `succeeded` on first attempt. |
| M5-D2 | Provider integrations (Deepgram + Groq) with backend-only secrets | `apps/worker/src/providers/deepgram.ts`, `apps/worker/src/providers/groq.ts`, `packages/config/src/index.ts` | done | Transcript and AI payloads were persisted and returned in `/api/videos/:id/status`; Groq path fix validated by successful `job.ai.complete` worker event and non-404 provider response path. |
| M5-D3 | UI parity for transcript/summary states | `apps/web/src/pages/VideoPage.tsx`, `apps/web/src/components/TranscriptCard.tsx`, `apps/web/src/components/SummaryCard.tsx`, `apps/web/src/lib/api.ts` | done | Video page now renders transcript + summary states (`loading/complete/no_audio/skipped/failed`) and copy actions for transcript/summary/shareable URL. |
| M5-D4 | Bounded retry and dead-letter proof for provider failure | `apps/worker/src/index.ts`, `apps/web-api/src/index.ts` | done | Controlled failure with `videoId=f92d9c42-35ea-4ccb-9346-098da07a6a0f`, `jobId=8`, `max_attempts=2`, invalid Groq model produced attempts `1 queued -> 2 dead`; final status `aiStatus=failed`, `transcriptionStatus=complete`, and `aiErrorMessage` populated from dead job `last_error`. |

### Phase E (Playback Intelligence UX)
| ID | Item | Primary Files | Status | Evidence |
|---|---|---|---|---|
| M5-E1 | Live status reliability (no manual refresh required) | `apps/web/src/pages/VideoPage.tsx`, `apps/web/src/components/StatusPanel.tsx` | done | Polling gate now requires all terminal domains (`processingPhase`, `transcriptionStatus`, `aiStatus`) before stopping; `last updated` and `auto-refresh` indicators added on Video/Status panels and validated in browser smoke using `videoId=b9e898e6-aec9-4aa5-8682-e9ba87fdc385` without manual refresh. |
| M5-E2 | Layout and hierarchy upgrade for video details workspace | `apps/web/src/pages/VideoPage.tsx`, `apps/web/src/components/PlayerCard.tsx`, `apps/web/src/components/TranscriptCard.tsx`, `apps/web/src/components/SummaryCard.tsx`, `apps/web/src/index.css` | done | Reframed Video page into a workspace layout (`primary` playback + actions, `system status`, and side-by-side transcript/summary panels on wide screens with stacked mobile fallback). Verified via real `/record` upload flows and responsive browser checks at `1440x900` and `390x844`. |
| M5-E3 | Transcript timeline interactivity (timestamps, seek, active line) | `apps/web/src/components/TranscriptCard.tsx`, `apps/web/src/pages/VideoPage.tsx`, `apps/web/src/components/PlayerCard.tsx` | done | Real `/record` run with `sample_video.mp4` (`videoId=42e915e5-80df-4a57-9be0-d28aa06b5a8a`) now renders segment timestamps, supports click-to-seek (for example `01:11`), and tracks active line to playback time without refresh. |
| M5-E4 | Summary/chapter interaction improvements | `apps/web/src/components/SummaryCard.tsx`, `apps/web/src/pages/VideoPage.tsx` | done | Key points now expose playback navigation hooks when segment timing is available; `Jump to 03:50` sought the player to `03:50` and transcript active state synchronized at that timestamp. |
| M5-E5 | Docs alignment and QA evidence for upgraded UX | `docs/ops/MILESTONE5_UX_RELIABILITY_PLAN.md`, `docs/ops/LOCAL_DEV.md`, `docs/api/ENDPOINTS.md`, `docs/ops/PHASE_E_*.md` | in_progress | Phase E planning docs created and baseline docs aligned to current implementation state. |

### Phase G (Global Library + Management Model)
| ID | Item | Primary Files | Status | Evidence |
|---|---|---|---|---|
| M5-G0 | Architecture + implementation planning (no runtime code changes) | `docs/ops/PHASE_G_LIBRARY_MANAGEMENT_PLAN.md`, `docs/api/ENDPOINTS.md` | done | Added focused phase plan with G1..G4 acceptance, planned DB/API/UI rollout details, MVP recommendation, and planned-only endpoint contracts. |

## Top 10 High-Leverage Improvements (No New Endpoints)
1. Permission error mapping with actionable recovery text.
2. Deterministic stop handling when browser/native sharing ends.
3. Microphone device refresh and persistence across page lifecycle.
4. Audio presence check before upload (warn on likely missing audio).
5. Retry upload path that reuses existing selected/recorded blob.
6. Upload progress UX that distinguishes `uploading` vs `finalizing`.
7. Polling resilience (transient network errors do not hard-stop updates).
8. Status copy by phase (`queued`, `processing`, `failed`, `complete`).
9. Copy-to-clipboard for result and thumbnail URLs with feedback.
10. Better empty/loading states for Home and Result views.

## Delivery Phases

### Phase A: Reliability and Recovery (Small Fixes)
Objective: eliminate fragile interactions and unclear failure behavior.

Implementation focus:
- `RecordPage`: upload retry, permission messaging, robust stop transitions.
- `VideoPage`: resilient polling strategy for transient errors.
- `api.ts`: upload progress and retry-friendly behavior.

Acceptance criteria:
- Native "Stop sharing" always transitions to preview (no hanging state/timer).
- Upload failure provides in-context retry without requiring re-record.
- Polling survives temporary network failures and resumes automatically.
- User-facing error copy includes next action.

### Phase B: Interaction and Clarity Polish
Objective: improve confidence and usability while preserving minimal scope.

Implementation focus:
- `RecordPage`: optional mic level meter + preflight hints.
- `StatusPanel`: clearer phase visualization and context text.
- `PlayerCard`: copy links + clearer loading/empty states.
- `HomePage` (if needed): stronger empty-state guidance.

Acceptance criteria:
- Mic meter reflects live input when mic is enabled.
- Status visualization cleanly communicates lifecycle progression.
- Copy buttons work for available artifact URLs and show feedback.
- Empty states are actionable and consistent with design language.

### Phase C: Optional Refinement and Maintainability
Objective: improve maintainability/traceability without broad scope expansion.

Implementation focus:
- Microcopy standardization and state-label consistency.
- Minor UI consistency pass (`AppShell`, spacing, state blocks).
- Optional local diagnostic details for failed sessions.

Acceptance criteria:
- Terminology is consistent across pages and states.
- Visual style remains calm and cohesive.
- No endpoint changes required.

### Phase E: Playback Intelligence UX (Next)
Objective: deliver a professional, interactive playback workspace where transcript and AI states update live, and transcript/chapter interactions are integrated with the player.

Implementation focus:
- Live polling/state model that remains active until processing + transcript + AI all reach terminal states.
- Improved information architecture and responsive layout for playback, transcript, summary, and actions.
- Transcript line timestamps, click-to-seek, and active-line playback sync.
- Summary/key-point ergonomics and interaction polish.

Acceptance criteria:
- Transcript/AI completion appears without manual page refresh.
- Transcript timestamps are visible where available.
- Clicking transcript line seeks video player to expected position.
- Active transcript line follows playback time.
- Updated docs and smoke evidence confirm behavior.

## Endpoint Policy
- Default path: no new endpoint.
- If one endpoint is required, candidate is retry-oriented and must satisfy:
  - Idempotent semantics.
  - Clear operational benefit over client-only retry.
  - Zero GET-side effects.
  - Explicit justification added to this document before implementation.

## Execution Order
1. Implement Phase A fully.
2. Validate Phase A with Docker smoke run.
3. Implement Phase B.
4. Validate Phase B with end-to-end recording/upload/result run.
5. Implement Phase C consistency pass.
6. Implement and validate Phase D transcription/AI pipeline.
7. Execute Phase E playback-intelligence UX upgrade.

## Test and Validation Strategy
- Runtime: Docker Compose stack only.
- Validation modes:
  - Manual browser smoke flows.
  - Targeted service health checks (`/health` endpoints).
  - Processing completion checks (`/api/videos/:id/status`).

Core smoke scenarios:
1. Record with mic, stop via in-app button.
2. Record with mic, stop via native browser stop sharing UI.
3. Upload failure and retry.
4. End-to-end processing to playable result and thumbnail.
5. Result page link copy and download behavior.

## Risks and Mitigations
- Risk: Browser media APIs differ by environment.
  - Mitigation: robust feature checks and precise fallback messaging.
- Risk: Upload progress semantics differ between XHR events and server completion.
  - Mitigation: explicit finalizing step after 100% transfer.
- Risk: Over-polish introduces state complexity.
  - Mitigation: keep state machine explicit and minimal.

## Definition of Done (Milestone 5)
- Phase A and Phase B acceptance criteria pass.
- No backend endpoint additions unless justified and approved.
- Docker-first smoke checks pass end-to-end.
- Progress section in this file updated with final statuses and evidence.

## Acceptance Evidence Ledger (Update During Execution)
| ID | Criterion | Verification Method | Status | Evidence |
|---|---|---|---|---|
| A-native-stop-preview | Native stop-sharing transitions to preview with no hung state | Manual record + native stop | done | Recorder finalization now guarded/idempotent with cleanup in `onstop`; native stream end explicitly routes through stop/finalize path. |
| A-upload-retry | Failed upload can be retried without new recording | Manual network interruption + retry | done | Verified by forced failed PUT then successful re-sign/re-upload on same `videoId` (`9199fffb-aa5d-42df-8721-82e50bc74eb8`) and successful completion (`jobId=22`). |
| A-actionable-errors | Permission/upload errors provide actionable next step | Manual scenario checks | done | Added actionable copy for denied permissions, missing capture sources, and upload retry guidance in Record page. |
| A-poll-recovery | Polling recovers after transient status fetch failure | Manual network blip on `/video/:id` | done | Implemented exponential backoff retry with non-terminal resilience in `VideoPage` polling loop; transient fetch errors no longer stop polling lifecycle. |
| B-mic-meter | Meter moves with voice when mic enabled | Manual mic test | done | Implemented analyser-driven meter in Record page; value updates live during recording and resets to 0 when mic is off/cleanup runs. |
| B-status-clarity | Status UI clearly communicates phase and progress | Manual page review across phases | done | Stepper is phase-driven on the client via local rank mapping (no API rank dependency), verified `queued -> processing -> complete`, and `failed/cancelled` now render as terminal-failure state without marking the `Complete` step active. |
| B-copy-links | Copy buttons place expected URL in clipboard | Manual copy-paste validation | done | Result page includes copy actions for both artifact URLs with inline “copied” confirmation and graceful fallback message. |
| B-empty-loading | Empty/loading states are informative and calm | Manual page review | done | Home, status, and result panels now show calm actionable empty/loading guidance with restrained visual treatment. |
| C-terminology | Labels/messages are consistent across pages | Manual content review | done | Copy is now aligned around “recording / process status / output” and consistent action wording (`Start`, `Stop`, `Upload recording`, `Refresh`) across pages. |
| C-visual-cohesion | Theme is consistent and restrained | Manual visual review desktop/mobile | done | Global and shell-level visual treatments are cohesive: warm off-white surfaces, slate text hierarchy, restrained accent, consistent focus ring, and subtle nav state styling. |
| D-audio-e2e | Audio upload resolves full pipeline | Docker API flow + DB verification | done | `videoId=c6e99a94-af1f-4f9f-8f9f-db15cda934ae` final status: `processing=complete`, `transcription=complete`, `ai=complete`; `job_queue` rows `id=4,5,6` all `succeeded` with `attempts=1`. |
| D-noaudio-e2e | No-audio path is deterministic | Docker API flow + DB verification | done | `videoId=970be822-9c31-4cc2-9be9-8b45173dec23` final status: `processing=complete`, `transcription=no_audio`, `ai=skipped`; `job_queue` row `id=7 process_video succeeded` and no downstream jobs enqueued. |
| D-dead-letter | Provider failure retries are bounded and terminal | Debug enqueue + worker logs + DB verification | done | `videoId=f92d9c42-35ea-4ccb-9346-098da07a6a0f`, `jobId=8`: worker logs show claim attempt `1` then retry, claim attempt `2` then `status=dead`; DB row `attempts=2`, `max_attempts=2`, `status=dead`, final API status `aiStatus=failed`. |
| E-live-updates | Transcript and AI updates appear without manual refresh | Browser manual run during long processing/transcription | done | Manual staged state transitions for `videoId=b9e898e6-aec9-4aa5-8682-e9ba87fdc385` (`processing=complete, transcript/ai=queued -> transcript=complete, ai=processing -> ai=complete`) updated UI automatically with no refresh; `Auto-refresh` switched to `Stopped` only after all three domains were terminal. |
| E-transcript-sync | Transcript interactions seek and sync with video playback | Manual player interaction + transcript line click | done | Verified on `videoId=42e915e5-80df-4a57-9be0-d28aa06b5a8a`: transcript timestamp click (`01:11`) sought player immediately, playback progression advanced active line (`00:17` at ~`18.96s`), and summary jump (`03:50`) synchronized playhead + active transcript row. |
| E-layout-quality | Video detail page has cohesive, professional hierarchy | Desktop and mobile UI review | done | E4 polish pass unified card/button/status-chip system, improved scan rhythm and panel copy, and refined transcript/summary action placement; verified desktop two-column composition (`1440x900`) and mobile stacked flow (`390x844`) on `videoId=83cf325b-9a8a-48b6-b1a0-4265817b65a3`. |
| F2-watch-cleanup-editing | Watch UX cleanup and editing persistence shipped without E1/E3/F1 regressions | Docker + real `/record` browser flows | done | Audio run `59d5ee56-0739-497f-aef5-26fe407b2d58` reached `complete/complete/complete` with no manual refresh, removed duplicate thumbnail, reduced action clutter, larger chapter hit targets, title edit persisted (`F2 Edited Title`), transcript edit persisted with original-text fallback; no-audio run `60819644-6958-478e-b2f7-e577291fcec8` remained `complete/no_audio/skipped`. |

## Change Log
- 2026-02-25: Plan created.
- 2026-02-25: Consolidated to single-document execution model (no separate tracker required).
- 2026-02-25: Phase A moved `todo -> in_progress -> done`; implemented recorder stop robustness, upload retry without re-record, actionable error copy, and resilient polling.
- 2026-02-25: Phase B moved `in_progress -> done`; implemented mic confidence meter, clearer status visualization, result link copy feedback, and calm empty/loading UI states.
- 2026-02-25: Phase C moved `in_progress -> done`; completed terminology consistency and restrained visual consistency pass with no backend contract changes.
- 2026-02-25: Phase D moved `in_progress -> done`; implemented transcription + AI execution pipeline, provider integrations, transcript/summary UI surfaces, no-audio deterministic path, and verified bounded retry-to-dead-letter behavior with Docker evidence.
- 2026-02-26: Phase E planning initiated; added dedicated playback-intelligence plan/checklist docs and aligned API/local-dev docs to current state.
- 2026-02-26: E2.1 blocker resolution: refined transcribe empty-result handling so audio-bearing assets with no recognized speech no longer downgrade to `transcription=no_audio`; verified `sample_video.mp4` reaches `processing=complete`, `transcription=complete`, `ai=complete`, while explicit no-audio uploads still end `transcription=no_audio`, `ai=skipped`.
- 2026-02-26: E3 completed: transcript timestamps render from segments, transcript and summary key-point controls seek the player, and active transcript highlighting follows playback time while preserving E1 auto-refresh reliability and E2 layout hierarchy.
- 2026-02-26: E4 completed: premium UI polish landed across Video workspace cards, action groups, status chips, transcript active-line behavior, and responsive composition; validated with real audio (`videoId=83cf325b-9a8a-48b6-b1a0-4265817b65a3`) and no-audio (`videoId=1ceff234-874b-4e37-ac06-2172007b4a0e`) uploads under Docker with no endpoint changes.
- 2026-02-26: Phase F2 completed: watch-page cleanup + editing features landed (single idempotent `PATCH /api/videos/:id/watch-edits` endpoint for title/transcript persistence), while preserving E1 live updates, E3 transcript seek/active-line behavior, and no-audio terminal determinism.
- 2026-02-25: Phase G0 planning completed: added `PHASE_G_LIBRARY_MANAGEMENT_PLAN.md` with phased delivery (`G1..G4`), migration/contract/frontend/rollout/risk details, and MVP sequencing recommendation. No runtime implementation performed.
