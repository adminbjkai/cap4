# Cap4 Refactoring & Integration Improvement Plan

> **Date:** 2026-03-25
> **Scope:** Codebase-wide analysis of refactoring opportunities to enhance integration, maintainability, type safety, and developer experience.
> **Methodology:** Full codebase exploration of all apps (web, web-api, worker, media-server), shared packages (config, db, logger), tests, CI, and documentation.

---

## Table of Contents

1. [Priority Matrix](#priority-matrix)
2. [R1 — Shared Types Package](#r1--shared-types-package)
3. [R2 — Worker Module Decomposition](#r2--worker-module-decomposition)
4. [R3 — Frontend Data Layer](#r3--frontend-data-layer)
5. [R4 — Large Component Decomposition](#r4--large-component-decomposition)
6. [R5 — Route Handler Business Logic Extraction](#r5--route-handler-business-logic-extraction)
7. [R6 — Error Boundary & Resilience](#r6--error-boundary--resilience)
8. [R7 — Test Coverage Expansion](#r7--test-coverage-expansion)
9. [R8 — API Contract Validation](#r8--api-contract-validation)
10. [R9 — Observability & Graceful Lifecycle](#r9--observability--graceful-lifecycle)
11. [R10 — Developer Experience](#r10--developer-experience)
12. [Implementation Sequence](#implementation-sequence)

---

## Priority Matrix

| ID | Refactoring | Impact | Effort | Risk | Priority |
|----|------------|--------|--------|------|----------|
| R1 | Shared Types Package | 🔴 High | 🟡 Medium | 🟢 Low | **P0** |
| R2 | Worker Module Decomposition | 🔴 High | 🟡 Medium | 🟡 Medium | **P0** |
| R3 | Frontend Data Layer | 🔴 High | 🟡 Medium | 🟡 Medium | **P1** |
| R4 | Large Component Decomposition | 🟡 Medium | 🟡 Medium | 🟢 Low | **P1** |
| R5 | Route Handler Logic Extraction | 🟡 Medium | 🟢 Low | 🟢 Low | **P1** |
| R6 | Error Boundary & Resilience | 🔴 High | 🟢 Low | 🟢 Low | **P0** |
| R7 | Test Coverage Expansion | 🟡 Medium | 🔴 High | 🟢 Low | **P2** |
| R8 | API Contract Validation | 🟡 Medium | 🟡 Medium | 🟢 Low | **P2** |
| R9 | Observability & Lifecycle | 🟡 Medium | 🟡 Medium | 🟢 Low | **P2** |
| R10 | Developer Experience | 🟢 Low | 🟢 Low | 🟢 Low | **P3** |

---

## R1 — Shared Types Package

### Problem

API types are defined independently in both the frontend (`apps/web/src/lib/api.ts`, 431 lines) and backend route files (`apps/web-api/src/routes/*.ts`). There are 19+ response types in the frontend alone, all manually kept in sync with the backend. Any schema change in a route must be manually mirrored to `api.ts` — a common source of drift bugs.

### Current State

- **Frontend:** All types are hand-written in `apps/web/src/lib/api.ts` (e.g., `VideoStatusResponse`, `LibraryVideoCard`, `SignedUploadResponse`, etc.)
- **Backend:** Zod schemas or inline TypeScript types in each route file (e.g., `videos.ts`, `uploads.ts`, `library.ts`)
- **No shared contract** exists between the two

### Proposed Solution

Create a new workspace package `packages/api-types` (`@cap/api-types`) that exports:

1. **Zod schemas** for all API request/response shapes
2. **Inferred TypeScript types** via `z.infer<typeof Schema>`
3. **Route path constants** (endpoint strings)
4. **Shared enums** (processing phases, job statuses, provider states)

### Implementation Steps

```
packages/api-types/
├── src/
│   ├── index.ts              # Re-exports everything
│   ├── videos.ts             # VideoCreateRequest, VideoStatusResponse, etc.
│   ├── uploads.ts            # SignedUploadResponse, MultipartInitiate, etc.
│   ├── library.ts            # LibraryVideoCard, LibraryVideosResponse
│   ├── jobs.ts               # JobStatusResponse
│   ├── webhooks.ts           # WebhookPayload, WebhookResponse
│   ├── system.ts             # ProviderStatusResponse
│   └── enums.ts              # ProcessingPhase, TranscriptionStatus, JobStatus, etc.
├── package.json
└── tsconfig.json
```

**Step-by-step:**

1. `mkdir -p packages/api-types/src` and create `package.json` with `"name": "@cap/api-types"`
2. Extract Zod schemas from backend route files into the new package
3. Export inferred TypeScript types alongside schemas
4. Add `@cap/api-types` as dependency to both `@cap/web-api` and `@cap/web`
5. Replace inline types in `apps/web/src/lib/api.ts` with imports from `@cap/api-types`
6. Replace inline validation in route handlers with schemas from `@cap/api-types`
7. Add the package to `build:internal` script in root `package.json`

### Key Types to Extract

| Type | Current Location | Used By |
|------|-----------------|---------|
| `VideoStatusResponse` | `apps/web/src/lib/api.ts` | Frontend polling, VideoPage |
| `LibraryVideoCard` | `apps/web/src/lib/api.ts` | HomePage grid |
| `SignedUploadResponse` | `apps/web/src/lib/api.ts` | RecordPage upload |
| `MultipartInitiateResponse` | `apps/web/src/lib/api.ts` | RecordPage multipart |
| `CompleteUploadResponse` | `apps/web/src/lib/api.ts` | RecordPage finalize |
| `ProviderStatusResponse` | `apps/web/src/lib/api.ts` | ProviderStatusPanel |
| `JobStatusResponse` | `apps/web/src/lib/api.ts` | Job polling |
| `WebhookPayload` | `apps/web-api/src/routes/webhooks.ts` | Webhook handler |
| Processing phase enum | Implicit string unions | Videos routes, worker, frontend |
| Job status enum | Implicit string unions | Job routes, worker |

### Shared Enums to Define

```typescript
// packages/api-types/src/enums.ts
export const ProcessingPhase = {
  NOT_REQUIRED: 'not_required',
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  PROBING: 'probing',
  PROCESSING: 'processing',
  UPLOADING: 'uploading',
  GENERATING_THUMBNAIL: 'generating_thumbnail',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const JobStatus = {
  QUEUED: 'queued',
  LEASED: 'leased',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  CANCELLED: 'cancelled',
  DEAD: 'dead',
} as const;

export const TranscriptionStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
  FAILED: 'failed',
} as const;
```

### Benefits

- **Single source of truth** for all API contracts
- **Compile-time safety** — frontend/backend type mismatches become build errors
- **Self-documenting** — Zod schemas serve as living documentation
- **Reusable validation** — same schema validates on both sides

### Risks & Mitigations

- **Risk:** Circular dependency if types package imports from app packages → **Mitigation:** Types package must be leaf-level (no app imports)
- **Risk:** Build order dependency → **Mitigation:** Add to `build:internal` (already handles @cap/config, @cap/db, @cap/logger)

### Estimated Effort: 3-4 hours

---

## R2 — Worker Module Decomposition

### Problem

`apps/worker/src/index.ts` is **1,308 lines** — the largest single file in the codebase. It contains:

- Worker loop (claim/heartbeat/ack/fail/reclaim logic)
- Job dispatching (5 job types)
- All job handler implementations (process_video, transcribe_video, generate_ai, cleanup_artifacts, deliver_webhook)
- Database queries for job queue operations
- State machine transition logic
- Media server health checking
- Error classification (fatal vs. retryable)

This makes the file difficult to navigate, test in isolation, and modify safely.

### Proposed Module Structure

```
apps/worker/src/
├── index.ts                    # Entry point: start loop, wire dependencies
├── loop.ts                     # Core polling loop: claim → dispatch → ack/fail
├── lease.ts                    # Job leasing: claim, heartbeat, ack, fail, reclaim
├── dispatch.ts                 # Job type → handler routing
├── handlers/
│   ├── process-video.ts        # FFmpeg transcode via media-server
│   ├── transcribe-video.ts     # Deepgram transcription
│   ├── generate-ai.ts          # Groq AI summarization
│   ├── cleanup-artifacts.ts    # S3 object deletion
│   └── deliver-webhook.ts      # Outbound webhook delivery
├── lib/
│   ├── s3.ts                   # (existing) S3 client, stream utilities
│   ├── transcript.ts           # (existing) VTT building, transcript parsing
│   ├── ffmpeg.ts               # (existing) FFmpeg wrapper
│   ├── state-machine.ts        # NEW: Phase rank guards, status transitions
│   └── health.ts               # NEW: Media server health check
├── providers/
│   ├── deepgram.ts             # (existing)
│   └── groq.ts                 # (existing)
└── types.ts                    # Worker-internal types (Job, LeaseInfo, etc.)
```

### Implementation Steps

1. **Extract `types.ts`** — Move `Job`, `LeaseInfo`, `HeartbeatHandle` and other internal types out of `index.ts`
2. **Extract `lease.ts`** — Move `claimJobs()`, `ack()`, `fail()`, `heartbeat()`, `reclaimExpired()` functions. These are pure SQL operations that can be tested independently.
3. **Extract `handlers/`** — Each `handle*` function becomes its own module:
   - `handleProcessVideo` → `handlers/process-video.ts`
   - `handleTranscribeVideo` → `handlers/transcribe-video.ts`
   - `handleGenerateAI` → `handlers/generate-ai.ts`
   - `handleCleanupArtifacts` → `handlers/cleanup-artifacts.ts`
   - `handleDeliverWebhook` → `handlers/deliver-webhook.ts`
4. **Extract `dispatch.ts`** — The job-type switch/dispatch function
5. **Extract `lib/state-machine.ts`** — Phase rank constants, `canTransition()`, `getNextPhase()` helpers
6. **Extract `lib/health.ts`** — `isMediaServerHealthy()` and `deriveProviderHealthState()`
7. **Extract `loop.ts`** — The main polling loop with claim-dispatch-ack cycle
8. **Simplify `index.ts`** — Wire dependencies, start loop, handle shutdown signals

### Handler Interface Pattern

```typescript
// handlers/types.ts
export interface HandlerContext {
  env: AppEnv;
  pool: Pool;
  log: Logger;
  s3: S3Client;
}

export type JobHandler = (
  ctx: HandlerContext,
  job: Job,
  heartbeat: HeartbeatHandle,
) => Promise<void>;
```

Each handler exports a function matching `JobHandler`, making them independently testable with mock contexts.

### Benefits

- **Testability** — Each handler and lease operation can be unit tested in isolation
- **Navigability** — ~200-line files instead of one 1,300-line file
- **Parallel development** — Different handlers can be modified without merge conflicts
- **Clear interfaces** — `HandlerContext` injection pattern enables mocking

### Estimated Effort: 4-5 hours

---

## R3 — Frontend Data Layer

### Problem

The frontend has **no data fetching abstraction**. Every component uses raw `useEffect` + `useState` + `fetch` patterns:

```tsx
// Repeated in HomePage, VideoPage, RecordPage, etc.
const [data, setData] = useState<T | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  let cancelled = false;
  async function load() {
    try {
      const result = await api.getVideoStatus(videoId);
      if (!cancelled) setData(result);
    } catch (err) {
      if (!cancelled) setError(err.message);
    } finally {
      if (!cancelled) setLoading(false);
    }
  }
  load();
  return () => { cancelled = true; };
}, [videoId]);
```

This pattern is duplicated with slight variations across 6+ locations, leading to:
- Inconsistent loading/error handling
- No request deduplication
- No cache (navigating away and back refetches everything)
- No automatic polling abstraction (manual `setInterval` in VideoPage and RecordPage)
- Prop drilling of fetched data through component trees

### Proposed Solution

Introduce a lightweight data-fetching hook using either:

**Option A: Custom `useQuery` hook** (zero dependencies, ~100 lines)

```typescript
// hooks/useQuery.ts
export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { pollInterval?: number; enabled?: boolean }
): { data: T | null; isLoading: boolean; error: string | null; refetch: () => void }
```

**Option B: TanStack Query** (battle-tested, adds ~12KB gzipped)

Both options provide: caching, deduplication, automatic polling, loading/error state, and refetch.

### Recommended: Option A (Custom Hook)

Given the single-tenant nature of cap4 and the small number of queries (< 10), a custom hook avoids adding a dependency while solving 90% of the data fetching pain:

```typescript
// hooks/useQuery.ts
const cache = new Map<string, { data: unknown; timestamp: number }>();

export function useQuery<T>(
  key: string | null,  // null = disabled
  fetcher: () => Promise<T>,
  opts: { pollMs?: number; staleMs?: number } = {}
): QueryResult<T> {
  // ... manages loading, error, data, polling, cache
}
```

### Implementation Steps

1. Create `apps/web/src/hooks/useQuery.ts` with caching, polling, and error handling
2. Create `apps/web/src/hooks/useMutation.ts` for write operations (delete, retry, save edits)
3. Refactor `VideoPage.tsx` to use `useQuery('video-status', () => getVideoStatus(id), { pollMs: 2000 })`
4. Refactor `HomePage.tsx` to use `useQuery('library', () => getLibraryVideos(params))`
5. Refactor `RecordPage.tsx` polling to use `useQuery` with conditional polling
6. Refactor `App.tsx` command palette video list to use shared cache
7. Add unit tests for `useQuery` and `useMutation`

### Benefits

- **~200 lines of boilerplate removed** from page components
- **Consistent loading/error UX** across all views
- **Automatic polling** with clean interval management
- **Cache** — navigating away and back shows stale data instantly while refetching
- **Testable** — hook can be tested independently with mock fetchers

### Estimated Effort: 3-4 hours

---

## R4 — Large Component Decomposition

### Problem

Several frontend components exceed 400+ lines, mixing UI rendering, business logic, and side effects:

| Component | Lines | Concern Mix |
|-----------|-------|-------------|
| `RecordPage.tsx` | 792 | MediaRecorder API + file upload + multipart upload + progress tracking + job polling + UI |
| `TranscriptCard.tsx` | 609 | Search + edit + speaker labels + confidence review + playback sync |
| `CustomVideoControls.tsx` | 484 | Play/pause + seek + volume + rate + fullscreen + PiP + chapter navigation |
| `SummaryCard.tsx` | 446 | Tabs (chapters/entities/action-items/quotes) + chapter click + sentiment display |
| `PlayerCard.tsx` | 429 | Video element management + controls integration + chapter overlay + transcript sync |
| `VideoPage.tsx` | 450 | Data fetching + polling + rail tab switching + edit saving + delete flow |

### Proposed Decompositions

#### RecordPage.tsx (792 → ~4 modules)

```
pages/record/
├── RecordPage.tsx              # Page shell, tab switching (record vs. upload)
├── ScreenRecorder.tsx          # MediaRecorder API, canvas preview, capture controls
├── FileUploader.tsx            # File selection, drag-and-drop, validation
├── UploadProgress.tsx          # Multipart upload progress, speed, ETA
└── useUploadFlow.ts            # Hook: signed URL → upload → complete → poll
```

**Extraction logic:**
- `ScreenRecorder` owns `navigator.mediaDevices`, `MediaRecorder`, canvas preview
- `FileUploader` owns file input, drag-drop zone, MIME validation
- `UploadProgress` is a pure display component (progress bar, speed, ETA)
- `useUploadFlow` encapsulates the full upload state machine

#### SummaryCard.tsx (446 → ~3 modules)

```
components/summary/
├── SummaryCard.tsx             # Tab container + collapsed strip
├── ChapterTimeline.tsx         # Chapter list with sentiment + click-to-seek
├── EntitiesPanel.tsx           # People, orgs, locations, dates badges
├── ActionItemsList.tsx         # Task list with assignee/deadline
└── QuotesList.tsx              # Notable quotes with timestamps
```

#### CustomVideoControls.tsx (484 → ~3 modules)

```
components/player/
├── CustomVideoControls.tsx     # Layout container + visibility logic
├── SeekBar.tsx                 # Seek track, chapter dots, hover preview
├── VolumeControl.tsx           # Volume slider + mute button
└── PlaybackControls.tsx        # Play/pause, skip, rate selector, PiP, fullscreen
```

### Implementation Steps

1. Start with `RecordPage.tsx` (largest, clearest separation points)
2. Extract `useUploadFlow` hook first (reduces RecordPage by ~200 lines)
3. Extract `ScreenRecorder` and `FileUploader` as sibling components
4. Move to `SummaryCard.tsx` — extract tab panels into standalone components
5. Move to `CustomVideoControls.tsx` — extract SeekBar, VolumeControl
6. Verify all existing tests still pass after each extraction

### Benefits

- **Readability** — each file has a single responsibility
- **Reusability** — `UploadProgress`, `SeekBar` can be reused
- **Testability** — smaller components are easier to unit test
- **Developer velocity** — less scrolling, fewer merge conflicts

### Estimated Effort: 5-6 hours

---

## R5 — Route Handler Business Logic Extraction

### Problem

Fastify route handlers in `apps/web-api/src/routes/` mix HTTP concerns (request parsing, response formatting, status codes) with business logic (database queries, state machine transitions, S3 operations). For example:

- `videos.ts` (590 lines) — contains SQL query construction, transcript normalization, AI output parsing inline with route definitions
- `uploads.ts` (415 lines) — S3 presigning logic interleaved with idempotency checks and job enqueue logic
- `system.ts` (480 lines) — embeds a full HTML dev UI as template literals

### Proposed Solution

Extract business logic into a `services/` layer that route handlers delegate to:

```
apps/web-api/src/
├── routes/           # HTTP layer: parse request → call service → format response
│   ├── videos.ts
│   ├── uploads.ts
│   ├── library.ts
│   ├── jobs.ts
│   ├── webhooks.ts
│   └── system.ts
├── services/         # Business logic: DB queries, S3 ops, state transitions
│   ├── video.service.ts       # createVideo, getStatus, applyWatchEdits, softDelete, retry
│   ├── upload.service.ts      # signUrl, completeUpload, initiateMultipart, presignPart, completeMultipart
│   ├── library.service.ts     # listVideos with cursor pagination
│   ├── webhook.service.ts     # verifySignature, processProgress, deduplication
│   └── idempotency.service.ts # Check/store idempotency keys
└── plugins/          # (existing)
```

### Implementation Pattern

```typescript
// services/video.service.ts
export async function getVideoStatus(pool: Pool, videoId: string): Promise<VideoStatusResponse> {
  // SQL query, transcript parsing, AI output formatting
  // Throws NotFoundError, ValidationError as needed
}

// routes/videos.ts — becomes thin
fastify.get('/api/videos/:id/status', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!isUUID(id)) return reply.code(400).send(badRequest('Invalid video ID'));
  const status = await getVideoStatus(pool, id);
  return reply.send(status);
});
```

### Implementation Steps

1. Create `services/` directory
2. Extract `idempotency.service.ts` first (used by both videos.ts and uploads.ts)
3. Extract `video.service.ts` from `videos.ts`
4. Extract `upload.service.ts` from `uploads.ts`
5. Extract `webhook.service.ts` from `webhooks.ts`
6. Move the HTML dev UI from `system.ts` into a separate template file (e.g., `templates/dev-ui.html`)
7. Run existing integration tests to verify no regressions

### Benefits

- **Testability** — services can be unit tested with a mock pool, no HTTP overhead
- **Reusability** — services can be called from worker, CLI scripts, or future GraphQL layer
- **Clarity** — route files become thin HTTP adapters (~50-80 lines each)
- **Separation of concerns** — HTTP concerns (status codes, headers) stay in routes; data access stays in services

### Estimated Effort: 4-5 hours

---

## R6 — Error Boundary & Resilience

### Problem

The frontend has **no React error boundaries**. Any unhandled exception in a component tree (e.g., malformed API response, null dereference) crashes the entire app with a white screen. Additionally:

- No global error handling for unhandled promise rejections
- No fallback UI for failed API requests (some components silently swallow errors)
- No retry mechanism for transient frontend errors

### Proposed Solution

#### 6a. React Error Boundaries

```
components/
├── ErrorBoundary.tsx           # Generic error boundary with fallback UI
├── PageErrorFallback.tsx       # Full-page error with "Go Home" + "Retry" buttons
└── CardErrorFallback.tsx       # In-card error for individual panels
```

```tsx
// App.tsx
<ErrorBoundary fallback={<PageErrorFallback />}>
  <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/video/:videoId" element={
      <ErrorBoundary fallback={<PageErrorFallback />}>
        <VideoPage />
      </ErrorBoundary>
    } />
    ...
  </Routes>
</ErrorBoundary>
```

#### 6b. Component-Level Error Boundaries

Wrap each card (TranscriptCard, SummaryCard, PlayerCard) in an error boundary so one panel failing doesn't take down the whole page:

```tsx
// VideoPage.tsx
<ErrorBoundary fallback={<CardErrorFallback label="Transcript" />}>
  <TranscriptCard ... />
</ErrorBoundary>
<ErrorBoundary fallback={<CardErrorFallback label="Summary" />}>
  <SummaryCard ... />
</ErrorBoundary>
```

#### 6c. Global Unhandled Rejection Handler

```typescript
// main.tsx
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled]', event.reason);
  // Optionally show toast notification
});
```

### Implementation Steps

1. Create `ErrorBoundary.tsx` (class component — React requires class for error boundaries)
2. Create `PageErrorFallback.tsx` and `CardErrorFallback.tsx`
3. Wrap `<Routes>` in App.tsx with top-level boundary
4. Wrap individual cards in VideoPage with card-level boundaries
5. Add global unhandled rejection listener in `main.tsx`
6. Add unit test for ErrorBoundary (trigger error in child, verify fallback renders)

### Benefits

- **Graceful degradation** — one broken panel doesn't crash the app
- **User-friendly errors** — clear message with retry/home actions
- **Debugging** — errors logged with component stack traces

### Estimated Effort: 2-3 hours

---

## R7 — Test Coverage Expansion

### Problem

Current test coverage is thin relative to the codebase complexity:

| Area | Test Files | Coverage |
|------|-----------|----------|
| Worker providers | 2 unit tests | Deepgram + Groq API mocking |
| Web-API routes | 1 unit test (webhooks) + 1 shared utils | Signature verification |
| Web-API integration | 1 full-flow test (18 assertions) | Happy path only |
| Web-API E2E | 5 Playwright tests | API contract validation |
| Frontend unit | 2 tests | ChapterList, TranscriptParagraph |
| Frontend E2E | 2 Playwright specs | Layout, player page |

**Major gaps:**
- No unit tests for worker job handlers (process_video, transcribe_video, etc.)
- No unit tests for route business logic (videos.ts, uploads.ts, library.ts)
- No frontend hook tests (useKeyboardShortcuts, useVideoPlayerShortcuts)
- No error path testing in integration tests
- No upload flow unit tests (RecordPage multipart logic)
- No tests for shared packages (db pool, config validation, logger)

### Proposed Test Additions

#### Priority 1: Backend Unit Tests

```
apps/web-api/src/routes/
├── videos.test.ts              # Status response formatting, transcript normalization
├── uploads.test.ts             # Idempotency key validation, multipart flow
├── library.test.ts             # Cursor encoding/decoding, pagination
└── system.test.ts              # Provider health derivation

apps/worker/src/handlers/       # (after R2 decomposition)
├── process-video.test.ts       # Mock media-server, verify DB updates
├── transcribe-video.test.ts    # Mock Deepgram, verify transcript storage
├── generate-ai.test.ts         # Mock Groq, verify AI output parsing
├── deliver-webhook.test.ts     # Mock HTTP, verify HMAC signing
└── cleanup-artifacts.test.ts   # Mock S3, verify deletion

apps/worker/src/
├── lease.test.ts               # Job claim/ack/fail/reclaim SQL
└── loop.test.ts                # Polling behavior, shutdown
```

#### Priority 2: Frontend Unit Tests

```
apps/web/src/__tests__/
├── useQuery.test.ts            # (after R3) Caching, polling, error states
├── useKeyboardShortcuts.test.ts # Key combos, editable target detection
├── api.test.ts                 # API client error handling, idempotency keys
├── sessions.test.ts            # localStorage session management
├── ErrorBoundary.test.tsx      # (after R6) Error catching and fallback
├── CommandPalette.test.tsx     # Search, keyboard navigation, action execution
├── StatusPanel.test.tsx        # Phase → UI mapping
└── ProviderStatusPanel.test.tsx # Health state display
```

#### Priority 3: Shared Package Tests

```
packages/db/src/
├── pool.test.ts                # Connection pool creation, singleton behavior
└── transaction.test.ts         # BEGIN/COMMIT/ROLLBACK, error recovery

packages/config/src/
└── config.test.ts              # Zod validation, defaults, error messages

packages/logger/src/
└── logger.test.ts              # Redaction, child loggers, request ID generation
```

#### Priority 4: Integration Test Error Paths

Add to `apps/web-api/tests/integration/full-flow.test.ts`:
- Upload with invalid content type → 400
- Complete upload for non-existent video → 404
- Watch edits on deleted video → 404
- Retry on already-complete video → 409
- Webhook with invalid signature → 401
- Webhook with expired timestamp → 401
- Duplicate webhook delivery → 200 with `duplicate: true`
- Rate limit exceeded → 429

### Implementation Steps

1. After R2 (worker decomposition), write handler unit tests
2. After R5 (service extraction), write service unit tests
3. Write frontend hook and component tests
4. Add error-path integration tests
5. Set up coverage reporting in CI (optional)

### Estimated Effort: 8-10 hours (across all priorities)

---

## R8 — API Contract Validation

### Problem

The frontend and backend are loosely coupled through implicit JSON contracts. If a backend field is renamed or its type changes, the frontend silently receives `undefined` instead of the expected value — leading to runtime bugs that are hard to trace.

### Proposed Solution

#### 8a. Runtime Response Validation (Frontend)

After implementing R1 (shared types with Zod schemas), add optional runtime validation in the API client:

```typescript
// lib/api.ts
import { VideoStatusResponseSchema } from '@cap/api-types';

export async function getVideoStatus(videoId: string): Promise<VideoStatusResponse> {
  const res = await fetch(`/api/videos/${videoId}/status`);
  const json = await parseJson(res);
  
  if (import.meta.env.DEV) {
    // Only validate in development — catch contract drift early
    VideoStatusResponseSchema.parse(json);
  }
  
  return json as VideoStatusResponse;
}
```

#### 8b. Contract Tests

Create dedicated contract tests that validate backend responses against shared schemas:

```typescript
// apps/web-api/tests/contract/video-status.contract.test.ts
import { VideoStatusResponseSchema } from '@cap/api-types';

test('GET /api/videos/:id/status matches contract', async () => {
  const res = await fetch(`${BASE_URL}/api/videos/${testVideoId}/status`);
  const json = await res.json();
  expect(() => VideoStatusResponseSchema.parse(json)).not.toThrow();
});
```

### Benefits

- **Early detection** of contract drift during development
- **Zero production overhead** (dev-only validation)
- **Automated contract tests** in CI catch breaking changes

### Estimated Effort: 2-3 hours (after R1 is complete)

---

## R9 — Observability & Graceful Lifecycle

### Problem

Several operational gaps exist:

1. **No graceful shutdown** — the worker's polling loop and in-flight jobs may be interrupted on `docker compose down`, potentially leaving jobs in `leased` state
2. **No structured metrics** — no request count, latency, or job processing duration tracking
3. **No health check aggregation** — the worker doesn't expose a health endpoint (only web-api and media-server do)
4. **No startup readiness signal** — worker starts claiming jobs immediately, even if media-server isn't ready

### Proposed Improvements

#### 9a. Graceful Shutdown (Worker)

```typescript
// worker/src/index.ts
let shuttingDown = false;

process.on('SIGTERM', () => {
  log.info('SIGTERM received, draining...');
  shuttingDown = true;
});

// In poll loop:
while (!shuttingDown) {
  const jobs = await claimJobs(...);
  await Promise.all(jobs.map(j => processJob(j)));
}

// After loop exits:
log.info('Worker drained, exiting');
await pool.end();
process.exit(0);
```

#### 9b. Worker Health Endpoint

Add a minimal HTTP server to the worker (separate port, e.g., 3200) for Docker health checks:

```yaml
# docker-compose.yml
worker:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3200/health"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 15s
```

#### 9c. Structured Metrics (Lightweight)

Without adding Prometheus/Datadog, log structured metric events that can be parsed from log output:

```typescript
log.info({ metric: 'job.duration', job_type: 'transcribe_video', duration_ms: 4523, video_id: '...' });
log.info({ metric: 'job.attempts', job_type: 'generate_ai', attempts: 2, video_id: '...' });
log.info({ metric: 'api.latency', method: 'GET', path: '/api/videos/:id/status', duration_ms: 12 });
```

#### 9d. Startup Dependency Check (Worker)

Before entering the polling loop, verify that required services are reachable:

```typescript
async function waitForDependencies() {
  await waitForDatabase(env.DATABASE_URL, { retries: 10, delayMs: 2000 });
  await waitForMediaServer(env.MEDIA_SERVER_BASE_URL, { retries: 10, delayMs: 2000 });
  log.info('All dependencies healthy, starting worker loop');
}
```

### Implementation Steps

1. Add SIGTERM/SIGINT handler to worker with drain flag
2. Ensure in-flight jobs complete before exit
3. Add `pool.end()` cleanup
4. Optionally add worker health endpoint
5. Add structured metric logging to worker job completion
6. Add startup dependency wait loop

### Estimated Effort: 3-4 hours

---

## R10 — Developer Experience

### Problem

Several small friction points exist for developers:

1. **No pre-commit hooks** — linting and formatting aren't enforced before commit
2. **No workspace-aware TypeScript navigation** — IDE may not resolve `@cap/*` imports automatically
3. **No `dev` script** that starts all services together (only individual `dev:*` scripts)
4. **Integration test setup** requires manual Docker start — no automated fixture

### Proposed Improvements

#### 10a. Pre-commit Hooks

```bash
pnpm add -Dw husky lint-staged
npx husky init
```

`.husky/pre-commit`:
```bash
pnpm lint-staged
```

`package.json`:
```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

#### 10b. Unified Dev Script

Add to root `Makefile` (note: Makefile recipes require hard tab indentation):

```makefile
dev:
	@echo "Starting all services..."
	docker compose up -d postgres minio minio-setup
	make migrate
	pnpm dev:web-api &
	pnpm dev:worker &
	pnpm dev:media-server &
	pnpm dev:web
```

#### 10c. VS Code Workspace Settings

Create `.vscode/settings.json` with TypeScript project references:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "eslint.useFlatConfig": true
}
```

#### 10d. Integration Test Docker Fixture

Add a `beforeAll` in integration tests that ensures Docker services are running:

```typescript
// tests/integration/setup.ts
beforeAll(async () => {
  const health = await fetch('http://localhost:3000/health').catch(() => null);
  if (!health?.ok) {
    throw new Error('Docker services not running. Run `make up` first.');
  }
}, 30_000);
```

### Estimated Effort: 2-3 hours

---

## Implementation Sequence

### Phase A — Foundation (Week 1)

| Order | Item | Depends On | Est. Hours |
|-------|------|-----------|-----------|
| A1 | R1: Shared Types Package | — | 3-4h |
| A2 | R6: Error Boundaries | — | 2-3h |
| A3 | R2: Worker Decomposition | — | 4-5h |

**Why first:** R1 establishes the type contract that all subsequent refactoring uses. R6 is low-effort, high-impact. R2 unblocks worker testing.

### Phase B — Architecture (Week 2)

| Order | Item | Depends On | Est. Hours |
|-------|------|-----------|-----------|
| B1 | R5: Route Service Extraction | R1 | 4-5h |
| B2 | R3: Frontend Data Layer | R1 | 3-4h |
| B3 | R4: RecordPage Decomposition | R3 | 2-3h |

**Why second:** R5 and R3 both leverage the shared types from R1. R4 is easier after R3 provides the data hook.

### Phase C — Quality (Week 3)

| Order | Item | Depends On | Est. Hours |
|-------|------|-----------|-----------|
| C1 | R7: Backend Unit Tests | R2, R5 | 4-5h |
| C2 | R7: Frontend Unit Tests | R3, R6 | 3-4h |
| C3 | R8: Contract Validation | R1 | 2-3h |
| C4 | R4: Remaining Component Splits | R3 | 3-4h |

**Why third:** Tests are most valuable after the architecture is stabilized.

### Phase D — Polish (Week 4)

| Order | Item | Depends On | Est. Hours |
|-------|------|-----------|-----------|
| D1 | R9: Graceful Shutdown & Lifecycle | R2 | 2-3h |
| D2 | R9: Structured Metrics | — | 1-2h |
| D3 | R10: Dev Experience | — | 2-3h |
| D4 | R7: Integration Error Paths | C1 | 2-3h |

### Total Estimated Effort: ~45-55 hours

---

## Summary of Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Largest backend file | 1,308 lines (worker/index.ts) | ~250 lines |
| Largest frontend file | 792 lines (RecordPage.tsx) | ~300 lines |
| Shared types | 0 (duplicated) | 1 package, ~19 schemas |
| Frontend unit tests | 2 | 12+ |
| Backend unit tests | 4 | 20+ |
| Error boundaries | 0 | 3+ (page + card level) |
| Data fetching boilerplate | ~200 lines duplicated | ~50 lines (single hook) |
| Worker handler testability | Low (monolithic) | High (isolated handlers) |
| Graceful shutdown | None | SIGTERM drain |
| Contract validation | Manual | Automated (dev + CI) |
