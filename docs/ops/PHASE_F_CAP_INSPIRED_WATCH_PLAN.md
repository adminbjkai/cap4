# Phase F: Cap-Inspired Watch Experience (F1 + F2)

## Objective
Upgrade `/video/:id` into a cleaner watch experience with stronger playback hierarchy, chapter navigation, and right-rail context while preserving E1/E2/E3/E4 behavior and API contracts.

## Constraints
- Scope only `/Users/m17/2026/gh_repo_tests/Cap_v2`
- Docker-first validation
- No auth/users/accounts/tenancy work
- No endpoint changes for F1
- Keep comments tab placeholder-only

## F1 Implementation Scope
1. Watch-page composition refresh:
   - Primary player workspace (left)
   - Right rail tab sections (`Transcript`, `Summary`, `Comments`)
   - Cleaner metadata + action row retained from prior phases
2. Chapter handling:
   - Derive chapter anchors from AI key points + transcript segments
   - Render clickable chapter lists and timeline markers in player
   - Reuse chapter anchors in summary navigation
3. Interaction polish:
   - Preserve transcript click-to-seek
   - Preserve active-line follow behavior
   - Keep chapter seeks wired to shared seek flow
4. Reliability/behavior preservation:
   - Keep E1 polling/terminal gating unchanged
   - Keep E3 transcript/summary interaction behavior intact

## Reference Mapping (Screenshots -> F1 Output)
- Screenshot cue: player-first watch canvas + side transcript/summary context
  - Implemented: left-heavy player workspace with right-rail tabbed context panels.
- Screenshot cue: chapter list beneath summary/player context
  - Implemented: chapter list in player panel and chapter section in summary panel, both seekable.
- Screenshot cue: transcript as structured time-indexed panel
  - Implemented: timestamped transcript lines retained in right rail with seek hooks and active-line tracking.
- Screenshot cue: clean control grouping and uncluttered actions
  - Implemented: consolidated action hierarchy and tab control strip with clear section ownership.

## Files Updated for F1
- `apps/web/src/pages/VideoPage.tsx`
- `apps/web/src/components/PlayerCard.tsx`
- `apps/web/src/components/TranscriptCard.tsx`
- `apps/web/src/components/SummaryCard.tsx`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`
- `docs/ops/PHASE_F_CAP_INSPIRED_WATCH_PLAN.md`

## Validation Evidence (F1)
- Audio run (`sample_video.mp4`): `videoId=dc8fdd5b-3ee7-4595-a9ed-14b3deefb974`
  - Final: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`
  - Verified no manual refresh needed for terminal completion
  - Verified transcript seek, active-line follow, chapter markers/list jumps, and summary jumps
- No-audio regression run (`test-no-audio.mp4`): `videoId=dc1e06c7-3ff3-4f56-a211-0e019b4f47f2`
  - Final: `processingPhase=complete`, `transcriptionStatus=no_audio`, `aiStatus=skipped`

## F2 Scope and Outcome
- Watch layout cleanup: removed duplicate thumbnail preview block from the primary watch flow.
- Action simplification: one primary CTA (`Download video`) plus compact secondary actions in `More actions`.
- Header cleanup: high-signal top row only (editable title, status chips, last updated, minimal actions).
- Chapter UX upgrade: larger timeline markers, active chapter affordance, and current/next chapter labels near timeline.
- Editing UX: inline title edit (save/cancel) and transcript correction mode (save/cancel) with persisted updates.
- Original transcript access preserved after edits via transcript segment `originalText` metadata.

## F2 Endpoint Justification
- Added one endpoint: `PATCH /api/videos/:id/watch-edits`.
- Justification: F2 explicitly requires title and transcript edits to persist; no existing mutating endpoint supported watch-page edits.
- Constraint compliance:
  - Single endpoint only.
  - Idempotency enforced via required `Idempotency-Key` and `idempotency_keys` replay behavior.
  - No changes to existing read/status contracts.

## Reference Mapping Additions (F2)
- Screenshot cue: cleaner watch surface with fewer competing controls.
  - Implemented: primary CTA emphasis and secondary controls collapsed into compact actions.
- Screenshot cue: chapter context tied tightly to playback timeline.
  - Implemented: larger chapter markers, active chapter highlighting, and current/next chapter copy near the timeline.
- Screenshot cue: production-grade editing affordances in watch context.
  - Implemented: inline title editing and transcript correction mode with explicit save/cancel and persisted results.

## Files Updated for F2
- `apps/web/src/pages/VideoPage.tsx`
- `apps/web/src/components/PlayerCard.tsx`
- `apps/web/src/components/TranscriptCard.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web-api/src/index.ts`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`
- `docs/ops/PHASE_F_CAP_INSPIRED_WATCH_PLAN.md`
- `docs/ops/MILESTONE5_UX_RELIABILITY_PLAN.md`
- `docs/api/ENDPOINTS.md`

## Validation Evidence (F2)
- Audio run (`sample_video.mp4`): `videoId=59d5ee56-0739-497f-aef5-26fe407b2d58`
  - Final status: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`
  - Verified no manual refresh required to terminal state.
  - Verified title edit persisted after reload (`F2 Edited Title`).
  - Verified transcript edit persisted after reload (`Edited transcript line ...`) and original view remained accessible.
  - Verified transcript click-to-seek and active line behavior remained working.
- No-audio run (`sample_video_no_audio.mp4`): `videoId=60819644-6958-478e-b2f7-e577291fcec8`
  - Final status: `processingPhase=complete`, `transcriptionStatus=no_audio`, `aiStatus=skipped`
  - Verified no-audio terminal behavior unchanged.

## F3 Scope and Outcome
- Refined chapter skimming interaction in player with a cleaner rail and larger tap targets.
- Added stronger active-chapter styling and contextual rail tooltips (timestamp + title).
- Added inline `Prev/Next` chapter controls near rail for faster chapter stepping.
- Simplified chapter list visual hierarchy and strengthened active row emphasis.
- Reduced low-signal helper text around chapter markers while keeping high-signal current/next context labels.

## Files Updated for F3
- `apps/web/src/components/PlayerCard.tsx`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`
- `docs/ops/PHASE_F_CAP_INSPIRED_WATCH_PLAN.md`

## Validation Evidence (F3)
- Audio run (`sample_video.mp4`): `videoId=5a6ab4b5-1504-4e7d-9a51-df927e8bf6f9`
  - Final status: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`
  - Verified no manual refresh required for terminal completion.
  - Verified chapter seek from rail handles, chapter list, and Prev/Next controls.
  - Verified transcript seek + active-line behavior remains intact after chapter navigation.
  - Verified mobile layout quality at ~`390px` width.

## F4 Scope and Outcome
- Simplified watch header to focus on title prominence and high-signal status only.
- Improved title edit UX with clearer inline affordance, minimal feedback states, and keyboard support.
- Improved transcript edit mode ergonomics while preserving seek/active-line behavior and persistence semantics.
- Kept chapter skimming interactions from F3 intact without backend changes.

## Files Updated for F4
- `apps/web/src/pages/VideoPage.tsx`
- `apps/web/src/components/TranscriptCard.tsx`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`
- `docs/ops/PHASE_F_CAP_INSPIRED_WATCH_PLAN.md`

## Validation Evidence (F4)
- Audio run (`sample_video.mp4`): `videoId=be1661f5-6857-46f1-b96a-2f15601c7ba6`
  - Final status: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`
  - Verified no manual refresh required for terminal completion.
  - Verified title edit persisted (`F4 Polished Title`) and Esc-cancel preserved saved title.
  - Verified transcript edit persisted (`F4 transcript persistence check.`) and `Original` transcript view remained accessible.
- F3 interaction regression check on full transcript run: `videoId=5a6ab4b5-1504-4e7d-9a51-df927e8bf6f9`
  - Verified chapter list jump to `04:32` updated player and aligned active transcript line immediately.
  - Verified mobile layout quality at ~`390px` width.

## F5 Scope and Outcome
- Re-composed watch page into a cleaner two-row layout:
  - Row 1: dominant player workspace (left) + transcript utility rail (right)
  - Row 2: full-width summary and chapters section
- Reduced player clutter by keeping chapter rail + prev/next controls and moving chapter list emphasis into summary.
- Kept right rail focused on transcript utility and comments placeholder tab only.
- Preserved persistence, chapter seek alignment, and live update reliability behavior.

## Files Updated for F5
- `apps/web/src/pages/VideoPage.tsx`
- `apps/web/src/components/PlayerCard.tsx`
- `apps/web/src/components/SummaryCard.tsx`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`
- `docs/ops/PHASE_F_CAP_INSPIRED_WATCH_PLAN.md`

## Validation Evidence (F5)
- Audio run (`sample_video.mp4`): `videoId=3be5ce79-7de5-4160-9a4a-75e5a4853905`
  - Final status: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`
  - Verified no manual refresh required for terminal completion.
  - Verified chapter jump from summary/chapters (`08:52`) seeks player and aligns transcript active line immediately.
  - Verified desktop composition quality at `1440x900` with `zoom=100%` and `zoom=67%`.
  - Verified mobile composition and usability at `390x844`.

## F6 Scope and Outcome
- Removed duplicate chapter rendering in summary area; summary now has one canonical chapters section.
- Reduced top-header vertical footprint and tightened status-chip density for better above-the-fold usage.
- Rebalanced desktop watch row layout to allocate more width to transcript utility and reduce whitespace.
- Added frontend-only light/dark theme toggle (rounded icon button in top nav) with localStorage persistence and system-preference default.

## Files Updated for F6
- `apps/web/src/components/SummaryCard.tsx`
- `apps/web/src/pages/VideoPage.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/index.css`
- `docs/ops/PHASE_E_ACCEPTANCE_CHECKLIST.md`
- `docs/ops/PHASE_F_CAP_INSPIRED_WATCH_PLAN.md`

## Validation Evidence (F6)
- Audio run (`sample_video.mp4`): `videoId=cc084eb4-639c-4eec-8779-eaa7ed9ed1eb`
  - Final status: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`.
  - Verified no manual refresh needed to reach terminal state (`Live updates: Stopped` on watch page).
  - Verified summary area renders a single chapter section (`chapterLabels=1`, `chapterLists=1` in DOM check).
  - Verified chapter jump (`03:22`) seeks player immediately and transcript active line aligns (`currentTime=202.96`, active line starts `03:22`).
  - Verified desktop checks at `zoom=100%` and `zoom=67%`, and mobile check at `390x844`.
  - Verified theme toggle persists across reload (`localStorage.cap-theme=dark`, `html.theme-dark=true`).

### H1 Fallback Wrap-Up Evidence
- Real upload fallback run (`sample_videos_multiple/hock.mp4`): `videoId=3da883ce-5930-4a77-b2fe-86dfd1a38c55`
  - Final `/api/videos/:id/status` JSON: `{"videoId":"3da883ce-5930-4a77-b2fe-86dfd1a38c55","processingPhase":"complete","transcriptionStatus":"complete","aiStatus":"complete"}`.
  - Screenshot evidence paths expected for H1 were not captured in this run:
  - `docs/assets/phase-h1/02-after-home-light/02-home-na-1440x900.png` - blocked by browser automation instability in this environment.
  - `docs/assets/phase-h1/03-after-home-dark/03-home-na-1440x900.png` - blocked by browser automation instability in this environment.
  - `docs/assets/phase-h1/04-after-record-light/04-record-na-1440x900.png` - blocked by browser automation instability in this environment.
  - `docs/assets/phase-h1/05-after-record-dark/05-record-na-1440x900.png` - blocked by browser automation instability in this environment.
  - `docs/assets/phase-h1/06-after-watch-light/06-watch-3da883ce-5930-4a77-b2fe-86dfd1a38c55-1440x900.png` - blocked by browser automation instability in this environment.
  - `docs/assets/phase-h1/07-after-watch-dark/07-watch-3da883ce-5930-4a77-b2fe-86dfd1a38c55-1440x900.png` - blocked by browser automation instability in this environment.
  - `docs/assets/phase-h1/08-watch-mobile-390/08-watch-3da883ce-5930-4a77-b2fe-86dfd1a38c55-390x844.png` - blocked by browser automation instability in this environment.
  - `docs/assets/phase-h1/09-theme-toggle-persistence/09-persistence-3da883ce-5930-4a77-b2fe-86dfd1a38c55-1440x900.png` - blocked by browser automation instability in this environment.
