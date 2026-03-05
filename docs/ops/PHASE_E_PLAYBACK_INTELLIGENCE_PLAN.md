# Phase E Plan: Playback Intelligence UX

## Objective
Upgrade the video details experience from a status dashboard into an interactive playback workspace with live updates, transcript navigation, chapter-aware summary consumption, and polished layout quality.

This phase builds on completed Phase D (processing + transcription + AI pipelines) and targets professional UX parity with a modern product standard.

## Scope and Guardrails
- Repository scope: `/Users/m17/2026/gh_repo_tests/Cap_v2` only.
- Docker-first validation only.
- No auth/users/accounts/tenants.
- Preserve existing API endpoints unless absolutely required.
- If one endpoint addition becomes necessary, justify in writing before implementation.
- Keep Postgres as source of truth and existing worker leasing/retry semantics intact.

## Current UX Gap Summary
1. Transcript/AI sections can lag visually and require manual refresh in some flows.
2. Video page information hierarchy is serviceable but not workspace-grade.
3. Transcript is readable but not timeline-integrated with player interactions.
4. AI summary and transcript sections are separated from playback flow and chapters.
5. Empty/loading/error states are clear but not yet cohesive as a unified, premium interaction model.

## Delivery Breakdown

### E1: Live Status Reliability (must complete first)
- Ensure polling continues until all three domains are terminal:
  - `processingPhase` terminal: `complete|failed|cancelled`
  - `transcriptionStatus` terminal: `complete|no_audio|skipped|failed`
  - `aiStatus` terminal: `complete|skipped|failed`
- Show `last updated` timestamp and polling state.
- Prevent stale UI when processing completes before transcript/AI complete.

Primary files:
- `apps/web/src/pages/VideoPage.tsx`
- `apps/web/src/components/StatusPanel.tsx`

### E2: Layout and Component System Upgrade
- Recompose video page into strong visual hierarchy:
  - Playback and controls as anchor region
  - Transcript and summary as first-class side/stack panels
  - Action row (copy, download, share) grouped by intent
- Improve spacing, typography rhythm, and responsive behavior for desktop/mobile.
- Keep calm theme direction (warm off-white, slate/gray, restrained accent).

Primary files:
- `apps/web/src/pages/VideoPage.tsx`
- `apps/web/src/components/PlayerCard.tsx`
- `apps/web/src/components/TranscriptCard.tsx`
- `apps/web/src/components/SummaryCard.tsx`
- `apps/web/src/index.css`

### E3: Transcript and Chapter Interactivity
- Add timestamp rendering for transcript segments.
- Add click-to-seek behavior from transcript line to video time.
- Add active-line highlighting synchronized to playback time.
- Add summary key-point navigation hooks (chapter chips / jump anchors) where timing exists.

Primary files:
- `apps/web/src/components/TranscriptCard.tsx`
- `apps/web/src/components/SummaryCard.tsx`
- `apps/web/src/components/PlayerCard.tsx`
- `apps/web/src/pages/VideoPage.tsx`

### E4: State and Copy Consistency Pass
- Normalize labels across status, transcript, summary, and playback actions.
- Ensure error recovery messages are actionable and concise.
- Ensure loading/empty/failure states are visually consistent and non-jarring.

Primary files:
- `apps/web/src/components/StatusPanel.tsx`
- `apps/web/src/components/TranscriptCard.tsx`
- `apps/web/src/components/SummaryCard.tsx`
- `apps/web/src/pages/VideoPage.tsx`

### E5: Docs, QA Evidence, and Release Readiness
- Update phase evidence in milestone plan.
- Keep API and local-dev docs in sync with behavior.
- Record smoke evidence for audio and no-audio flows, plus UI interaction checks.

Primary files:
- `docs/ops/MILESTONE5_UX_RELIABILITY_PLAN.md`
- `docs/ops/LOCAL_DEV.md`
- `docs/api/ENDPOINTS.md`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`

## Risks and Mitigations
- Risk: Overly aggressive polling increases load.
  - Mitigation: adaptive cadence with terminal-state cutoff.
- Risk: Player/transcript sync edge cases on missing segment timestamps.
  - Mitigation: graceful fallback to plain transcript view.
- Risk: Layout overhaul causes regressions in existing flows.
  - Mitigation: keep E1 isolated first, then iterate with focused smoke checks.

## Out of Scope (Phase E)
- New auth model or user identity features.
- Multi-video collections/workspaces/folders.
- Billing/subscription.
- Non-deterministic background side effects from GET.

## Definition of Done (Phase E)
1. No manual refresh required for transcript/AI completion visibility.
2. Transcript is interactive (timestamps + click-to-seek + active line).
3. Summary and playback actions feel integrated and predictable.
4. UI quality and information architecture are substantially improved.
5. Docs and smoke evidence fully updated and aligned to shipped behavior.
