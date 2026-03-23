---
title: "QA: Speaker Diarization"
description: "Test plan for speaker diarization UI feature"
---

# QA Test Plan: Speaker Diarization UI

**Feature:** Add speaker diarization UI and editable speaker labels
**Issue:** BJK-14
**Priority:** High
**Date:** 2026-03-09

---

## 1. Overview

This test plan covers the implementation of speaker diarization UI features that surface Deepgram's speaker detection data in the transcript interface. The feature includes speaker labels, editable names, colored badges, speaker timeline, and filtering capabilities.

### Feature Components

| Component | File | Scope |
|-----------|------|-------|
| Speaker badges in transcript | TranscriptCard.tsx | Frontend UI |
| Editable speaker names | TranscriptCard.tsx | Frontend state/persistence |
| Speaker color palette | CSS tokens + component logic | Frontend styling |
| Speaker timeline bar | PlayerCard.tsx | Frontend visualization |
| Speaker filter toggle | TranscriptCard.tsx | Frontend filtering |
| API speaker label storage | videos.ts (PATCH watch-edits) | Backend API |
| Database persistence | Migration (if needed) | Database |

---

## 2. Data Structure

### Segment Schema (Current)
```typescript
transcript.segments[]: {
  startSeconds: number
  endSeconds: number | null
  text: string
  originalText?: string | null
  speaker?: number  // 0-based speaker index from Deepgram
}
```

### Expected Structure (Post-Implementation)
```typescript
transcript: {
  segments: [...],
  speakers?: {
    [speakerId]: string  // e.g., { "0": "John", "1": "Jane" }
  }
}

ai_outputs.speaker_labels: {
  [speakerId]: string  // Persistent storage for speaker renames
}
```

### API Payload Format
```json
PATCH /api/videos/:id/watch-edits
{
  "speakerLabels": { "0": "John", "1": "Jane" }
}
```

---

## 3. Functional Test Cases

### 3.1 Speaker Badge Display (Transcript View)

**TC-001: Display speaker badges for segments with speaker data**
- **Precondition:** Video has transcript with segments containing `speaker` field (e.g., speaker: 0, 1, 2)
- **Steps:**
  1. Open Video page
  2. Navigate to Transcript rail
  3. Observe transcript segments
- **Expected Result:** Each segment displays a colored speaker badge (e.g., "Speaker 0", "Speaker 1")
- **Expected Style:** Compact badge with background color + text label
- **Test Data:** Transcript with mixed speakers (at least 3 different speaker IDs)

**TC-002: Handle missing speaker data gracefully**
- **Precondition:** Transcript segments with NO `speaker` field (null/undefined)
- **Steps:**
  1. View transcript with speaker-less segments
  2. Observe display behavior
- **Expected Result:** Segments without speaker data display NO badge (or "Unknown" badge if designed)
- **Accessibility:** Ensure no visual breaks or layout shift

**TC-003: Speaker badge styling consistency**
- **Precondition:** Multiple speakers across segments
- **Steps:**
  1. View all transcript segments
  2. Compare badge styling across speakers
- **Expected Result:**
  - All badges use consistent style (size, padding, border-radius)
  - Same speaker ID always displays same color
  - Color palette uses max 8 distinct colors (with wrapping)

---

### 3.2 Editable Speaker Names

**TC-004: Click speaker badge to edit name**
- **Precondition:** Transcript displayed with speaker badges
- **Steps:**
  1. Click on a speaker badge (e.g., "Speaker 0")
  2. Observe UI change
- **Expected Result:**
  - Badge transforms to editable state (input field appears)
  - Current name is highlighted/selected
  - Close button or accept/cancel buttons are visible

**TC-005: Edit speaker name and save**
- **Precondition:** Speaker badge in edit mode
- **Steps:**
  1. Clear current text ("Speaker 0")
  2. Type new name ("John")
  3. Press Enter or click Save
  4. Refresh page
- **Expected Result:**
  - Name updates in all segments with that speaker ID
  - Edit reverts to badge display
  - Persistence: name remains after page refresh (localStorage or API)

**TC-006: Cancel edit without saving**
- **Precondition:** Speaker badge in edit mode with unsaved changes
- **Steps:**
  1. Clear current text
  2. Type new name
  3. Press Escape or click Cancel
  4. Observe UI state
- **Expected Result:**
  - Changes are discarded
  - Badge reverts to original name
  - No network request made

**TC-007: Empty speaker name validation**
- **Precondition:** Speaker badge in edit mode
- **Steps:**
  1. Clear all text
  2. Attempt to save (Enter key or Save button)
- **Expected Result:**
  - Validation error displayed (e.g., "Name cannot be empty")
  - Name remains unchanged
  - User can edit again without closing

**TC-008: Speaker name character limits**
- **Precondition:** Speaker edit mode active
- **Steps:**
  1. Type a very long name (e.g., 100+ characters)
  2. Attempt to save
- **Expected Result:**
  - Either: truncated to reasonable limit (e.g., 50 chars)
  - Or: error message shown with character limit
  - Behavior is consistent across all speaker edits

---

### 3.3 Speaker Color Palette

**TC-009: Auto-assign colors from palette**
- **Precondition:** Transcript with 8+ different speaker IDs
- **Steps:**
  1. View transcript segments
  2. Identify unique speaker colors
- **Expected Result:**
  - First 8 unique speakers get distinct colors from palette
  - Speakers 0-7 map to palette colors in order (e.g., blue, red, green, yellow, purple, orange, teal, pink)
  - Color assignment is consistent (same speaker ID always same color)

**TC-010: Color palette wrapping for 8+ speakers**
- **Precondition:** Transcript with 9+ different speaker IDs (e.g., speakers 0-10)
- **Steps:**
  1. View all transcript segments
  2. Identify color distribution
- **Expected Result:**
  - Speaker 8 reuses color from Speaker 0
  - Speaker 9 reuses color from Speaker 1
  - Pattern repeats (modulo 8)
  - No visual conflicts or ambiguity

**TC-011: Color accessibility (contrast)**
- **Precondition:** Speaker badges visible with assigned colors
- **Steps:**
  1. Measure color contrast ratios
  2. Test with accessibility tools (WCAG 2.1 AA standard)
- **Expected Result:**
  - All text on speaker badges meets WCAG AA contrast ratio (4.5:1 minimum)
  - Badges are readable on light and dark theme backgrounds

---

### 3.4 Speaker Timeline Bar

**TC-012: Display speaker timeline below seeker**
- **Precondition:** Video with transcript containing speaker data
- **Steps:**
  1. Open VideoPage with transcript
  2. Observe PlayerCard below video element
- **Expected Result:**
  - Thin multi-color bar displays below the seeker track
  - Bar segments correspond to speaker segments from transcript
  - Each segment colored per speaker (same palette as badges)
  - Bar spans full video duration

**TC-013: Speaker timeline accuracy**
- **Precondition:** Transcript with known speaker segments
- **Steps:**
  1. Note transcript segment timing (e.g., Speaker 0: 0-5s, Speaker 1: 5-10s)
  2. Observe timeline bar
  3. Scrub through video
- **Expected Result:**
  - Timeline bar accurately reflects segment boundaries
  - Color changes align with segment start/end times
  - Playback indicator (seeker fill) moves correctly

**TC-014: Speaker timeline with sparse speakers**
- **Precondition:** Transcript with gaps (some segments missing speaker data)
- **Steps:**
  1. View timeline for transcript with partial speaker data
- **Expected Result:**
  - Gap areas either: transparent / light gray / omitted
  - Timeline does not break or show artifacts
  - Colors are still accurate where speaker data exists

**TC-015: Speaker timeline hover preview**
- **Precondition:** Speaker timeline visible on PlayerCard
- **Steps:**
  1. Hover over different parts of timeline bar
  2. Observe tooltip
- **Expected Result:**
  - Tooltip shows speaker name (or "Speaker N" if unnamed)
  - Tooltip updates as cursor moves
  - Timeline remains interactive for seeking

---

### 3.5 Speaker Filter Toggle

**TC-016: Display speaker filter controls**
- **Precondition:** Transcript with multiple speakers
- **Steps:**
  1. Open Transcript rail
  2. Look for filter controls
- **Expected Result:**
  - Filter toggles visible (e.g., checkboxes or buttons per speaker)
  - All speakers listed (e.g., "John", "Jane", "Speaker 2")
  - All are checked by default (all speakers visible)

**TC-017: Filter to show only one speaker**
- **Precondition:** Filter controls visible with multiple speakers
- **Steps:**
  1. Click filter to uncheck "Speaker 1"
  2. Observe transcript
- **Expected Result:**
  - Only segments from selected speaker(s) display
  - Other segments are hidden (not just grayed out)
  - Spacing/layout remains clean

**TC-018: Filter multiple speakers**
- **Precondition:** Filter controls visible
- **Steps:**
  1. Check filters for speakers 0, 2, 4 (uncheck others)
  2. Observe transcript
- **Expected Result:**
  - Only segments from selected speakers visible
  - Segments appear in chronological order
  - Line numbering/formatting still correct

**TC-019: Reapply filter and persistence**
- **Precondition:** Filter applied (e.g., only "John" visible)
- **Steps:**
  1. Apply filter and note state
  2. Refresh page or navigate away and back
- **Expected Result:**
  - Filter state persists (localStorage or backend preference)
  - Same speakers remain filtered on return

**TC-020: Clear all filters (show all)**
- **Precondition:** Some filters unchecked
- **Steps:**
  1. Click "Show all" or "Reset filters" button
  2. Observe transcript
- **Expected Result:**
  - All segments displayed regardless of speaker
  - Filter toggles all return to checked state

---

### 3.6 API Integration

**TC-021: PATCH /api/videos/:id/watch-edits accepts speakerLabels**
- **Precondition:** API running, transcript exists
- **Steps:**
  1. Send PATCH request:
     ```json
     PATCH /api/videos/{videoId}/watch-edits
     Idempotency-Key: {key}
     {
       "speakerLabels": { "0": "John", "1": "Jane" }
     }
     ```
  2. Observe response
- **Expected Result:**
  - Status: 200 OK
  - Response body: `{ "ok": true, "videoId": "...", "updated": { "title": false, "transcript": false, "speakerLabels": true } }`
  - Speaker labels stored in database

**TC-022: GET /api/videos/:id/status returns speaker labels**
- **Precondition:** Speaker labels saved via PATCH
- **Steps:**
  1. Send GET request to /api/videos/{videoId}/status
  2. Inspect response
- **Expected Result:**
  - `aiOutput.speakerLabels` (or transcript.speakerLabels) included
  - Contains: `{ "0": "John", "1": "Jane" }`

**TC-023: API rejects invalid speakerLabels format**
- **Precondition:** API endpoint active
- **Steps:**
  1. Send PATCH with malformed speakerLabels:
     - Array instead of object: `"speakerLabels": ["John", "Jane"]`
     - Non-string values: `"speakerLabels": { "0": 123 }`
  2. Observe response
- **Expected Result:**
  - Status: 400 Bad Request (or 422 Unprocessable Entity)
  - Error message explaining format requirement

**TC-024: Idempotency key works for speakerLabels updates**
- **Precondition:** PATCH endpoint with speakerLabels
- **Steps:**
  1. Send PATCH request with Idempotency-Key: "abc123"
  2. Send identical request again with same key
- **Expected Result:**
  - First response: 200, updates applied
  - Second response: 200, same response body (no duplicate update)
  - Speaker labels updated only once in database

---

### 3.7 Edge Cases & Error Handling

**TC-025: Transcript without speaker data (legacy)**
- **Precondition:** Video with transcript but no speaker field in segments
- **Steps:**
  1. Open transcript view
  2. Attempt to interact with speaker features
- **Expected Result:**
  - UI gracefully degrades (badges not shown, filter not shown)
  - No errors in console or UI
  - Transcript still readable

**TC-026: Handle speaker ID gaps**
- **Precondition:** Transcript with speaker IDs: 0, 2, 5 (gaps at 1, 3, 4)
- **Steps:**
  1. View speaker labels and timeline
- **Expected Result:**
  - Only present speaker IDs displayed
  - Colors assigned sequentially to existing speakers (no gaps in palette)
  - Filter shows only speakers 0, 2, 5

**TC-027: Very long speaker name**
- **Precondition:** Speaker name set to 200+ characters
- **Steps:**
  1. Edit speaker name to very long text
  2. Attempt to save
  3. View in transcript and timeline
- **Expected Result:**
  - Either accepted with truncation, or rejected with error
  - UI remains responsive and readable
  - No layout breaks or overflow issues

**TC-028: Special characters in speaker name**
- **Precondition:** Editing speaker name
- **Steps:**
  1. Enter name with special chars: "John O'Brien", "María García", "李明", emoji 👤
  2. Save and refresh
- **Expected Result:**
  - All characters preserved and displayed correctly
  - No encoding/decoding issues
  - UI renders properly

**TC-029: Rapid speaker name edits**
- **Precondition:** Multiple speaker edits in quick succession
- **Steps:**
  1. Edit Speaker 0 name
  2. Before save completes, edit Speaker 1
  3. Before that save completes, edit Speaker 2
  4. Observe all requests/responses
- **Expected Result:**
  - All edits queued/processed without conflicts
  - Final state reflects all changes
  - No race conditions or lost updates

---

## 4. Integration Test Cases

**TC-030: Full flow: upload → transcribe → edit speakers → save**
- **Precondition:** Full cap4 platform operational
- **Steps:**
  1. Upload video with multi-speaker content
  2. Wait for transcription to complete
  3. View transcript with speaker data
  4. Edit speaker names (Speaker 0 → "Host", Speaker 1 → "Guest")
  5. Apply speaker filter (Host only)
  6. Refresh page
  7. Verify filter state and name persistence
- **Expected Result:**
  - All features work end-to-end
  - Data persists across requests
  - No state loss or inconsistencies

**TC-031: Concurrent user edits**
- **Precondition:** Two users with access to same video
- **Steps:**
  1. User A edits Speaker 0 name → "John"
  2. User B simultaneously edits Speaker 1 name → "Jane"
  3. Both users refresh
- **Expected Result:**
  - Both changes persisted
  - No conflict or last-write-wins issues
  - Idempotency key ensures safety

---

## 5. Performance & Load Tests

**TC-032: Transcript with 100+ segments**
- **Precondition:** Large transcript with many segments
- **Steps:**
  1. Load video with 100+ segment transcript
  2. Scroll through entire transcript
  3. Apply filter to single speaker
  4. Measure page responsiveness
- **Expected Result:**
  - Page loads in < 2 seconds
  - Scrolling smooth (60 fps)
  - Filter applies instantly
  - No memory leaks (check DevTools)

**TC-033: Speaker timeline render performance**
- **Precondition:** 1000+ segment timeline bar
- **Steps:**
  1. Render speaker timeline for very long video (2+ hours)
  2. Scrub through timeline
  3. Measure render time
- **Expected Result:**
  - Timeline renders in < 500ms
  - Scrubbing responsive, no lag
  - Memory usage reasonable

---

## 6. Accessibility Tests

**TC-034: Keyboard navigation for speaker edits**
- **Precondition:** Transcript with speaker badges
- **Steps:**
  1. Use Tab key to navigate to speaker badge
  2. Use Enter to enter edit mode
  3. Use Escape to cancel
  4. Use Enter to confirm
- **Expected Result:**
  - All interactions accessible via keyboard
  - Focus indicators visible
  - Screen reader announces speaker name and actions

**TC-035: Screen reader support**
- **Precondition:** NVDA or JAWS running
- **Steps:**
  1. Navigate transcript with screen reader
  2. Interact with speaker badges
  3. Toggle speaker filters
- **Expected Result:**
  - Speaker badges announced (e.g., "John, speaker badge, clickable")
  - Filters announced correctly
  - Edit mode state clearly communicated

**TC-036: Color-blind visibility**
- **Precondition:** Speaker badges and timeline displayed
- **Steps:**
  1. Test with color blindness simulator (Achromatopsia, Protanopia, Deuteranopia)
  2. Verify distinguishability without relying on color alone
- **Expected Result:**
  - If colors are primary differentiator, add pattern/label fallback
  - All speakers distinguishable even in grayscale
  - Meets WCAG guidelines

---

## 7. Regression Tests

**TC-037: Existing transcript editing still works**
- **Precondition:** Speaker diarization UI implemented
- **Steps:**
  1. Edit transcript text (Current/Original toggle still present)
  2. Copy transcript
  3. Save edits
  4. Verify persistence
- **Expected Result:**
  - All existing transcript features unchanged
  - Edit/Save/Copy buttons still functional
  - No regressions in transcript formatting

**TC-038: Chapter markers with speaker data**
- **Precondition:** Video with both chapters and speakers
- **Steps:**
  1. View PlayerCard with chapter timeline
  2. Verify chapters and speaker timeline coexist
  3. Seek via chapter marker
  4. Verify speaker timeline updates
- **Expected Result:**
  - Chapter markers and speaker timeline both visible
  - No overlap or visual conflicts
  - Seeking via chapters works correctly

---

## 8. Test Data Requirements

### Sample Transcript with Speakers
```json
{
  "segments": [
    { "text": "Hello everyone.", "startSeconds": 0, "endSeconds": 2, "speaker": 0 },
    { "text": "Thanks for joining.", "startSeconds": 2, "endSeconds": 4, "speaker": 1 },
    { "text": "Today we'll discuss Q1 results.", "startSeconds": 4, "endSeconds": 7, "speaker": 0 },
    { "text": "Looking forward to it.", "startSeconds": 7, "endSeconds": 9, "speaker": 1 },
    { "text": "Revenue increased 15%.", "startSeconds": 9, "endSeconds": 11, "speaker": 2 },
    { "text": "Impressive.", "startSeconds": 11, "endSeconds": 12, "speaker": 0 }
  ]
}
```

---

## 9. Test Execution Strategy

### Phase 1: Component Unit Tests (Playwright / Vitest)
- Speaker badge rendering
- Speaker name edit input
- Color palette assignment logic
- Speaker filter logic

### Phase 2: Integration Tests
- Full transcript view with speaker features
- API PATCH/GET for speaker labels
- Persistence (localStorage / database)

### Phase 3: Manual E2E Tests
- Full upload-to-view flow
- User interactions (edit, filter, seek)
- Cross-browser testing

### Phase 4: Accessibility & Performance
- Screen reader testing
- Keyboard navigation
- Load testing
- Performance profiling

---

## 10. Success Criteria

- [ ] All TC-001 through TC-029 passing
- [ ] No regressions in existing features (TC-037, TC-038)
- [ ] All speaker data persists correctly
- [ ] API contract tests pass
- [ ] Accessibility audit passes (WCAG 2.1 AA)
- [ ] Performance metrics met (load < 2s, scroll 60fps)
- [ ] Security: no XSS/injection via speaker names
- [ ] Documentation updated (UI design system, API docs)

---

## 11. Known Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Deepgram speaker data incomplete or absent | Feature not usable for all videos | Graceful fallback UI when speaker data missing |
| Speaker name length impacts layout | UI breaks on very long names | Enforce max length, test truncation |
| Editing speakers + transcript simultaneously | Data loss or inconsistency | Use optimistic locking, idempotency keys, clear status messaging |
| Performance with 1000+ segments | Slow filtering, timeline render lag | Virtualization, memoization, lazy rendering |
| Browser cache issues with speaker edits | Stale data shown after edit | Clear cache keys, use versioning |

---

## Appendix: Related Files

- `apps/web/src/components/TranscriptCard.tsx` — Transcript display & editing
- `apps/web/src/components/PlayerCard.tsx` — Video player & timeline
- `apps/web/src/pages/VideoPage.tsx` — Main layout
- `apps/web-api/src/routes/videos.ts` — API endpoints
- `docs/design-system.md` — UI tokens & styling
- `docs/api.md` — API reference

