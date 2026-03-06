# Video Player Improvements - Task Documentation

## Overview
This document tracks all improvements needed for the video player, chapter navigation, summary quality, and layout restructuring based on the reference project at `/Users/m17/2026/gh_repo_tests/Cap_for_reference_only`.

---

## Task 1: Chapter Navigation UI
**Status:** Not Started
**Priority:** High

### Requirements
- Add chapter navigation to the video player
- Display chapters as clickable timestamps with titles
- Clicking a chapter seeks the video to that timestamp
- Visual indicator of current chapter based on playback position

### Reference Implementation
From the reference screenshots:
- Chapters displayed as list with timestamp + title
- Current chapter highlighted
- Click-to-seek functionality

### Implementation Notes
- Already have `deriveChapters()` function in VideoPage.tsx
- Need to add chapter list UI component
- Need to integrate with video player seek functionality

---

## Task 2: Reposition Chapters Layout
**Status:** Not Started
**Priority:** High

### Requirements
- Move chapter section to the LEFT side of the video player
- Reduce video player width to accommodate chapter panel
- Create side-by-side layout: [Chapters] [Video Player]

### Current Layout
```
[Video Player - full width]
[Status Panel]
[Transcript/Notes tabs]
[Summary Card]
```

### Target Layout
```
[Chapters Panel] [Video Player - reduced width]
[Status Panel - full width]
[Transcript/Notes tabs]
[Summary Card]
```

---

## Task 3: Full Transcript Paragraph View
**Status:** Not Started
**Priority:** Medium

### Requirements
- Add a new section at the BOTTOM of the page (when scrolled down)
- Display full transcript as clean paragraphs (not timestamped segments)
- Keep the existing timestamped transcript in the right rail
- Format: Document-style paragraphs

### Current State
- Transcript only exists in right rail with timestamps
- No paragraph-formatted version exists

### Implementation Notes
- Need to convert transcript segments to paragraph text
- Add new section below existing content
- Ensure it only shows when transcript is complete

---

## Task 4: Improve Summary Generation Quality
**Status:** Not Started
**Priority:** High

### Current Issue
Current summary is too short:
> "The discussion revolves around implementing base functionality for abandoned orders..."

### Expected Quality (from reference)
> "In this video, I introduce AG Grid React and walk through setting it up in a React application. First, I create an empty React project using create-react-app and install AG Grid React. Then, I import the necessary components and CSS files, and set up a basic grid with row data and column definitions. I demonstrate various features of AG Grid, including column resizing, sorting, filtering, and editing. I also show how to customize the grid's appearance using themes and CSS variables. Additionally, I cover advanced topics such as value getters, value formatters, and cell rendering. Finally, I demonstrate how to use cell class rules and row class rules to style cells and rows based on their values."

### Root Cause Analysis (from reference project)
The reference project uses a much more detailed prompt:

**Key differences:**
1. **Prompt explicitly asks for comprehensive coverage:**
   - "detailed summary that covers ALL key points discussed"
   - "For meetings: include decisions made, action items, and key discussion points"
   - "For tutorials: cover all steps and concepts explained"
   - "Make it comprehensive enough that someone could understand the full content without watching"

2. **Uses 1st person perspective:** "In this video, I walk through..."

3. **Multi-chunk processing for long videos:**
   - Chunks transcripts at 24k characters
   - Processes each chunk individually
   - Synthesizes final summary from chunk summaries

4. **Better structured output:**
   - Title, summary, and chapters in one call
   - Chapters with timestamps

### Implementation Plan
1. Update `apps/worker/src/providers/groq.ts` with improved prompt
2. Add transcript chunking for long videos
3. Update summary generation to be more comprehensive
4. Consider adding title generation to the same call

---

## Task 5: Improve Chapter Generation Algorithm
**Status:** Not Started
**Priority:** Medium

### Current Issue
Chapters may not be as comprehensive as reference project

### Investigation Needed
- Check reference project's chapter generation logic
- Compare AI model used
- Review prompt for chapter extraction
- Check how key points are mapped to timestamps

---

## Technical Debt / Known Issues

### Unresolved from Previous Work
1. **Lease expired warnings** - May still appear but are operational, not bugs
2. **Cleanup artifacts job** - Fixed the raw_key column issue

---

## Implementation Status

### ✅ Completed Tasks

#### Task 1: Chapter Navigation UI
- Created `ChapterList.tsx` component with:
  - Clickable chapter list with timestamps
  - Active chapter highlighting
  - Scrollable list for many chapters
  - Clean styling matching workspace design

#### Task 2: Reposition Chapters Layout
- Modified `VideoPage.tsx` layout:
  - Chapters now on LEFT side (280px/320px width)
  - Video player in center with reduced width
  - Transcript and Summary below video
  - Responsive grid layout

#### Task 3: Full Transcript Paragraph View
- Created `TranscriptParagraph.tsx` component:
  - Converts transcript segments to paragraphs
  - Groups ~6 segments per paragraph
  - Shows at bottom of page
  - Clean document-style formatting

#### Task 4: Improved Summary Generation
- Updated `providers/groq.ts`:
  - Comprehensive prompt asking for detailed summaries
  - Multi-chunk processing for long transcripts (24k char chunks)
  - First-person perspective for presentations/tutorials
  - Several paragraphs for longer content
  - Added transcript chunking and synthesis

#### Task 5: Improved Chapter Generation
- Updated AI to generate chapters with timestamps
- Added `chapters` field to Groq response
- Worker now uses AI-generated chapters with fallback to key points
- Chapters include proper timestamps for navigation

---

## Files Modified

### Frontend (apps/web/src)
- ✅ `pages/VideoPage.tsx` - Layout restructured
- ✅ `components/ChapterList.tsx` - NEW component
- ✅ `components/TranscriptParagraph.tsx` - NEW component

### Backend (apps/worker/src)
- ✅ `providers/groq.ts` - Enhanced prompts + chunking
- ✅ `index.ts` - Use AI-generated chapters

---

## Testing Notes

All services are running:
- Web UI: http://localhost:5173
- API: http://localhost:3000
- Worker: Processing jobs
- Media Server: http://localhost:3100

New videos will get:
1. Longer, more detailed summaries
2. Better chapter navigation with timestamps
3. Paragraph transcript view at bottom
4. Chapters panel on left side of video

## Unresolved Issues

1. **Lease expired warnings** - These are operational, not bugs. The worker correctly reclaims expired leases.
2. **Cleanup artifacts job** - Fixed the raw_key column issue.

## Next Steps for Future Development

1. Monitor new video processing to verify summary quality improvements
2. Consider adding chapter markers to video timeline scrubber
3. Add chapter navigation keyboard shortcuts (Prev/Next)
4. Consider persisting chapter scroll position
