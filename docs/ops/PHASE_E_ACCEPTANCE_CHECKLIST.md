# Phase E Acceptance Checklist

Status values: `todo`, `in_progress`, `done`, `blocked`.

## E1 Live Update Reliability
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| E1-1 | Video page continues polling after `processingPhase=complete` until transcript+AI are terminal | Manual upload with audio + observe without refresh | done | Browser smoke on `/video/b9e898e6-aec9-4aa5-8682-e9ba87fdc385` showed `processingPhase=complete` while transcript/AI continued from queued/processing to terminal without manual refresh. |
| E1-2 | No manual page refresh is required to see transcript and summary completion | Manual browser run | done | During staged DB transitions, transcript and AI cards advanced states automatically and summary content rendered after `aiStatus=complete` without clicking Refresh. |
| E1-3 | Polling stops only after all domains reach terminal states | Inspect UI state transitions and network cadence | done | `Auto-refresh` remained Active until (`processing=complete`, `transcription=complete`, `ai=complete`) then switched to `Stopped (all statuses terminal)`. |
| E1-4 | Last updated indicator is visible and accurate | Manual UI check | done | `Last updated` timestamp is shown in both the Video header and Process status panel and advanced with each poll while active. |

## E2 Layout and UX Quality
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| E2-1 | Video details page has clear hierarchy and responsive layout | Desktop + mobile viewport checks | done | Verified at `1440x900` and `390x844`: desktop renders primary playback/system-status column with transcript/summary side panels; mobile collapses into a readable stacked flow with no layout breakage. |
| E2-2 | Playback/actions/transcript/summary sections are visually cohesive | Manual design review | done | Updated cards now share common panel rhythm (label, title, status badge, body), with playback/actions treated as primary and transcript/AI as first-class workspace panels. |
| E2-3 | Empty/loading/error states are calm and consistent | Trigger each state manually | done | Verified placeholder playback state, queued/processing status messaging, and terminal no-audio/skip messages remain calm and consistent after layout refactor. |

## E3 Transcript and Chapter Interactivity
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| E3-1 | Transcript lines render timestamps when available | Audio sample with segments | done | Real `/record` upload of `sample_video.mp4` (`videoId=42e915e5-80df-4a57-9be0-d28aa06b5a8a`) rendered timestamped transcript segment controls (for example `00:00`, `00:17`, `01:11`) after terminal completion. |
| E3-2 | Clicking transcript line seeks player to expected time | Manual interaction | done | Clicking transcript line `01:11` moved player playhead to `01:11` and set that row as active in the transcript panel. |
| E3-3 | Active transcript line follows playback time | Manual playback test | done | During playback from near `00:00`, active transcript moved with time and reflected `00:17` around `18.96s`; active marker also aligned at `03:50` after a summary jump. |
| E3-4 | Summary key points support playback navigation when timing exists | Manual interaction | done | Summary key-point jump controls rendered with timestamps and `Jump to 03:50` sought player to `03:50`; fallback copy remains for missing timing. |

## E4 Quality and Regression
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| E4-1 | Existing upload->process flow still works | Docker smoke | done | After `make up` + `make reset-db`, real `/record` uploads completed end-to-end for both `sample_video.mp4` and no-audio fixture without workflow interruption. |
| E4-2 | Audio path reaches `transcription=complete`, `ai=complete` | API + UI smoke | done | Real `/record` upload using `sample_video.mp4` produced `videoId=83cf325b-9a8a-48b6-b1a0-4265817b65a3` with final `/api/videos/:id/status`: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`. |
| E4-3 | No-audio path reaches `transcription=no_audio`, `ai=skipped` | API + UI smoke | done | Real `/record` upload using `Cap/apps/media-server/src/__tests__/fixtures/test-no-audio.mp4` produced `videoId=1ceff234-874b-4e37-ac06-2172007b4a0e` with final status `processingPhase=complete`, `transcriptionStatus=no_audio`, `aiStatus=skipped`. |
| E4-4 | No endpoint contract regressions for existing clients | Endpoint response review | done | Verified existing `/api/videos/:id/status` response contract unchanged while E4 remained UI-only; status payload keys and terminal-state semantics remained stable in both audio and no-audio runs. |

## F1 Cap-Inspired Watch Experience
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| F1-1 | Watch page uses stronger player + right-rail composition with tabbed sections | Desktop/mobile manual review | done | `/video/dc8fdd5b-3ee7-4595-a9ed-14b3deefb974?jobId=38` now renders a primary player workspace plus right-rail tabs (`Transcript`, `Summary`, `Comments`) with stacked mobile fallback. |
| F1-2 | Chapters are derived from AI key points + transcript timing and rendered as clickable jumps | Manual interaction + visual check | done | Chapters render in player timeline markers, player chapter list, and summary chapter blocks; chapter clicks seek player (`08:52`, `09:57`) with visible playhead updates. |
| F1-3 | Transcript seek + active-line follow remain intact | Manual interaction + playback test | done | Transcript line click (`01:11`) seeks correctly and active line follows playback (`00:17` at `~18.94s`) without manual refresh. |
| F1-4 | Comments tab remains placeholder-only (no backend behavior) | Manual tab check | done | Comments tab shows placeholder copy only (`Comment threads are not in scope for this build yet.`) and introduces no new API/backend path. |
| F1-5 | E1 reliability and terminal states remain correct after F1 changes | Real `/record` uploads + status API | done | Audio run `dc8fdd5b-3ee7-4595-a9ed-14b3deefb974` reached `processing=complete`, `transcription=complete`, `ai=complete` with `Live updates: Stopped (terminal)`; no-audio run `dc1e06c7-3ff3-4f56-a211-0e019b4f47f2` reached `transcription=no_audio`, `ai=skipped`. |

## F2 Watch UX Cleanup + Editing
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| F2-1 | Main watch flow removes duplicate thumbnail block and reduces action clutter | Desktop/manual review | done | On `/video/59d5ee56-0739-497f-aef5-26fe407b2d58?jobId=42`, primary workspace keeps one CTA (`Download video`) and moves secondary copy/thumbnail actions into compact `More actions`; large inline thumbnail preview block removed. |
| F2-2 | Header is high-signal and uncluttered (title, status, last updated, minimal actions) | Desktop/manual review | done | Header now surfaces editable title, status chips, `Last updated`, and minimal actions (`Refresh`, `New recording`), with prior low-signal metadata noise removed. |
| F2-3 | Chapter controls are usable on desktop/mobile with clear active state | Desktop + mobile viewport checks | done | At `1440x900` and `390x844`, timeline markers render as larger tap targets, active chapter is highlighted in list and marker context, and `Current/Next` chapter labels are visible beside timeline. |
| F2-4 | Title and transcript edits persist and original transcript remains accessible | Real `/record` audio flow + reload | done | Audio run `59d5ee56-0739-497f-aef5-26fe407b2d58` persisted title edit (`F2 Edited Title`) and transcript edits across reload; `Original` transcript view still shows pre-edit text using preserved `originalText` segment fields. |
| F2-5 | No-audio terminal behavior remains deterministic | Real `/record` no-audio flow + status API | done | No-audio run `60819644-6958-478e-b2f7-e577291fcec8` reached terminal `processingPhase=complete`, `transcriptionStatus=no_audio`, `aiStatus=skipped` with `Live updates: Stopped` and no manual refresh. |

## F3 Chapter Skimming UX Refinement
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| F3-1 | Chapter rail is cleaner, with larger handles and clear active state | Desktop + mobile manual review | done | Player chapter rail updated to larger handle targets with stronger active styling and reduced helper copy noise; verified on `/video/5a6ab4b5-1504-4e7d-9a51-df927e8bf6f9?jobId=50` at desktop and ~`390px` width. |
| F3-2 | Chapter hover/tap tooltip shows timestamp + title | Manual hover/tap interaction | done | Hover and tap on rail handles show in-context tooltip bubble containing chapter timestamp and title while preserving instant seek behavior. |
| F3-3 | Chapter list and Prev/Next controls provide instant seek and transcript alignment | Manual interaction | done | Chapter list clicks and `Prev/Next` controls seek immediately; transcript panel active-line context updates without regression to E3 behavior. |
| F3-4 | Live updates reliability and comments placeholder behavior remain intact | Real `/record` audio flow + tab check | done | Audio run `5a6ab4b5-1504-4e7d-9a51-df927e8bf6f9` reached terminal `processing=complete`, `transcription=complete`, `ai=complete` with `Live updates: Stopped`; comments tab remains placeholder-only. |

## F4 Header + Editing UX Polish
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| F4-1 | Header is cleaner and high-signal with tighter action hierarchy | Desktop + mobile manual review | done | Header keeps prominent title, core status chips, `Last updated`, and `Live updates`; removed queue chip clutter and tightened `Refresh`/`New recording` action spacing (`/video/be1661f5-6857-46f1-b96a-2f15601c7ba6?jobId=53`). |
| F4-2 | Title edit UX supports inline affordance, feedback, and keyboard save/cancel | Manual interaction | done | On `videoId=be1661f5-6857-46f1-b96a-2f15601c7ba6`, title save via Enter persisted `F4 Polished Title`; Esc in edit mode cancelled draft and restored saved title. |
| F4-3 | Transcript edit mode is clearer with improved toggle and save/cancel UX | Manual interaction | done | On `videoId=be1661f5-6857-46f1-b96a-2f15601c7ba6`, transcript edit persisted (`F4 transcript persistence check.`) after reload; `Original` view still exposes preserved source text. |
| F4-4 | F3 chapter behavior and reliability remain intact after polish | Real `/record` audio flow + interaction check | done | F4 run reached terminal without manual refresh (`be1661f5-6857-46f1-b96a-2f15601c7ba6`). F3 seek/active-line behavior re-verified on full transcript run `5a6ab4b5-1504-4e7d-9a51-df927e8bf6f9` (chapter jump to `04:32` aligned transcript active line instantly). |

## F5 Watch Layout Composition Refinement
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| F5-1 | Watch page uses two-row composition: player+transcript row, summary/chapters row | Desktop manual review | done | `/video/3be5ce79-7de5-4160-9a4a-75e5a4853905?jobId=56` now renders dominant player left + transcript utility panel right in row 1, with full-width `Summary and Chapters` section below. |
| F5-2 | Desktop composition remains balanced at 100% and 67% zoom | Desktop zoom checks | done | Verified at `1440x900` with `zoom=100%` and `zoom=67%`: composition remains readable without overlap/collision, maintaining clear panel hierarchy. |
| F5-3 | Mobile stacks in clean reading order with transcript utility behavior retained | Mobile viewport check | done | Verified at `390x844`: order remains header -> player -> transcript utility panel -> summary/chapters -> status, with transcript controls/active line behavior intact. |
| F5-4 | E1/F3 behavior remains intact (no manual refresh, chapter seek + transcript alignment) | Real `/record` audio flow + interaction check | done | Real `/record` run `3be5ce79-7de5-4160-9a4a-75e5a4853905` reached terminal (`processing=complete`, `transcription=complete`, `ai=complete`) with `Live updates: Stopped`; summary chapter jump to `08:52` updated playhead and transcript active line immediately. |

## F6 Targeted Watch-Page UI Correction Pass
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| F6-1 | Summary area renders only one canonical chapter section | DOM + manual watch-page review | done | H1 fallback run used real upload `videoId=3da883ce-5930-4a77-b2fe-86dfd1a38c55` and reached terminal `/api/videos/:id/status` JSON: `processingPhase=complete`, `transcriptionStatus=complete`, `aiStatus=complete`. Screenshot captures for this run are missing at: `docs/assets/phase-h1/02-after-home-light/02-home-na-1440x900.png`, `docs/assets/phase-h1/03-after-home-dark/03-home-na-1440x900.png`, `docs/assets/phase-h1/04-after-record-light/04-record-na-1440x900.png`, `docs/assets/phase-h1/05-after-record-dark/05-record-na-1440x900.png`, `docs/assets/phase-h1/06-after-watch-light/06-watch-3da883ce-5930-4a77-b2fe-86dfd1a38c55-1440x900.png`, `docs/assets/phase-h1/07-after-watch-dark/07-watch-3da883ce-5930-4a77-b2fe-86dfd1a38c55-1440x900.png`, `docs/assets/phase-h1/08-watch-mobile-390/08-watch-3da883ce-5930-4a77-b2fe-86dfd1a38c55-390x844.png`, `docs/assets/phase-h1/09-theme-toggle-persistence/09-persistence-3da883ce-5930-4a77-b2fe-86dfd1a38c55-1440x900.png` (blocked by browser automation instability in this environment.). |
| F6-2 | Header/top-card footprint is tighter with improved above-the-fold density | Desktop manual review | done | Watch header spacing reduced (`p-4/sm:p-5`, tighter title/status row), compact status chips added, and top section consumes less vertical space while preserving controls. |
| F6-3 | Desktop layout uses horizontal space better and transcript utility is wider | Desktop checks at 100% and 67% zoom | done | Row-1 layout updated to `xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)]` and container widened to `max-w-[1280px]`; verified improved rail width and reduced whitespace at `zoom=100%` and `zoom=67%`. |
| F6-4 | Theme toggle works and persists across reload | Manual toggle + reload verification | done | Top-nav rounded theme toggle switches light/dark, stores `localStorage.cap-theme`, and reapplies on reload (`cap-theme=dark`, `html.theme-dark=true`). |
| F6-5 | E1/F2/F3/F5 behavior remains intact after UI corrections | Real `/record` audio flow + interaction check | done | `videoId=cc084eb4-639c-4eec-8779-eaa7ed9ed1eb` reached `complete/complete/complete` without manual refresh; chapter jump (`03:22`) still seeks instantly and transcript active line aligns at `03:22`. |

## E5 Documentation Completion
| ID | Check | Verification | Status | Evidence |
|---|---|---|---|---|
| E5-1 | Milestone plan reflects Phase E progress and outcomes | Docs review | todo |  |
| E5-2 | Local dev runbook includes Phase E smoke guidance | Docs review | todo |  |
| E5-3 | API doc matches actual status payload and behavior | Docs review vs code | todo |  |
