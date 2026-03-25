---
title: "QA: Transcript Workspace"
description: "Regression checklist for the shipped transcript and review experience"
---

# QA: Transcript Workspace And Review Surface

This document tracks the current regression surface for the watch page areas that
change most often:

- transcript controls
- editable speaker labels and speaker filters
- transcript search and confidence review
- summary enrichments
- chapter navigation and seek actions

## Current Surface Areas

| Component | File | Scope |
|-----------|------|-------|
| Transcript control strip | `apps/web/src/components/TranscriptCard.tsx`, `apps/web/src/components/transcript-card/TranscriptControls.tsx` | Search, copy, edit, review mode, speaker filters |
| Transcript lines and speaker editing | `apps/web/src/components/TranscriptCard.tsx`, `apps/web/src/components/transcript-card/TranscriptLines.tsx` | Seeking, confidence styling, speaker rename UX |
| Verified uncertain segments | `apps/web/src/components/transcript-card/useVerifiedSegments.ts` | Browser-local persistence keyed by video |
| Watch-page rail and summary strip | `apps/web/src/pages/VideoPage.tsx`, `apps/web/src/pages/video-page/*` | Notes, summary, transcript, chapter navigation |
| Summary enrichments | `apps/web/src/components/SummaryCard.tsx` | Entities, action items, quotes |
| API persistence for watch edits | `apps/web-api/src/routes/videos.ts` | Title, transcript text, speaker labels |

## API Data Shapes Worth Regressing

```ts
transcript.segments[]: {
  startSeconds: number;
  endSeconds: number | null;
  text: string;
  originalText?: string | null;
  confidence?: number | null;
  speaker?: number | null;
}

PATCH /api/videos/:id/watch-edits
{
  "title"?: string,
  "transcriptText"?: string,
  "speakerLabels"?: { "0": "Host", "1": "Guest" }
}
```

```ts
aiOutput?: {
  summary?: string | null;
  keyPoints: string[];
  chapters?: Array<{ title: string; seconds: number }>;
  entities?: {
    people: string[];
    organizations: string[];
    locations: string[];
    dates: string[];
  };
  actionItems?: Array<{ task: string; assignee?: string; deadline?: string }>;
  quotes?: Array<{ text: string; timestamp: number }>;
}
```

## Core Regression Checklist

### Transcript Controls

- Transcript tab is selected by default on the watch page.
- Search input is visible when not editing.
- `Current` and `Original` view modes both render and switch correctly.
- `Copy` copies the currently selected transcript view.
- `Edit` opens the transcript edit panel and `Cmd+Enter` / `Esc` still work.
- Review mode toggle only appears when there are uncertain segments.
- Speaker filter chips render only when speakers exist.

### Transcript Interaction

- Clicking a transcript line seeks the player to that timestamp.
- Active-line highlighting follows playback time.
- Search result count updates as the query changes.
- Verified uncertain segments persist across refresh for the same `videoId`.
- Speaker badges keep consistent colors for the same speaker id.
- Speaker rename updates every segment for that speaker after save.
- Empty or whitespace-only speaker names are rejected and do not persist.

### Summary And Chapter UX

- Summary tab renders generated summary text.
- Structured chapter buttons seek correctly.
- Entities render in grouped sections only when present.
- Action items render task plus assignee/deadline metadata when present.
- Quotes render a jump button that seeks to the quote timestamp.
- The below-the-fold chapter list remains in sync with the summary and AI data.

### API Persistence

- `PATCH /api/videos/:id/watch-edits` persists `title`.
- `PATCH /api/videos/:id/watch-edits` persists `transcriptText`.
- `PATCH /api/videos/:id/watch-edits` persists `speakerLabels`.
- Refetching `GET /api/videos/:id/status` returns the updated watch-page state.

## Automated Coverage

- Web E2E assertions live in `apps/web/e2e/player.spec.ts` and `apps/web/e2e/layout.spec.ts`.
- API E2E coverage for uploads, webhooks, jobs, library, and videos lives under `apps/web-api/tests/e2e/`.
- CI runs lint, typecheck, unit tests, web E2E, API E2E, workspace build, and Docker build from `.github/workflows/test.yml`.

## Manual Spot Checks Worth Keeping

- Desktop watch page at `1440x900`
- Mobile watch page at `375x812`
- Transcript with multiple speakers and low-confidence segments
- Transcript with no parsed segments but plain text present
- Summary payload with and without enrichment fields
