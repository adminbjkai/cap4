# Frontend Structure Report

**Generated:** 2026-03-06  
**Auditor:** Frontend Architecture Reviewer  
**Scope:** React SPA (`apps/web`)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total Components | 10 |
| Pages | 3 |
| API Methods | 14 |
| Critical Issues | 0 |
| High Issues | 3 |
| Medium Issues | 6 |
| Low Issues | 4 |

**Overall Assessment:** The frontend follows a clean component structure with good TypeScript coverage. Main concerns center around the `RecordPage` component complexity, missing memoization in render-heavy components, and code duplication across timestamp formatting utilities.

---

## Component Hierarchy

```
App (main.tsx)
├── BrowserRouter
│   └── App.tsx
│       └── AppShell
│           ├── Sidebar (desktop)
│           ├── Mobile Header + Menu
│           └── Routes
│               ├── HomePage
│               │   ├── ProviderStatusPanel
│               │   └── ConfirmationDialog
│               ├── RecordPage
│               │   └── (self-contained, 776 lines)
│               └── VideoPage
│                   ├── PlayerCard
│                   ├── StatusPanel
│                   │   └── ProviderStatusPanel
│                   ├── TranscriptCard
│                   ├── SummaryCard
│                   └── ConfirmationDialog
```

---

## File Inventory

### Pages (3)
| File | Lines | Complexity |
|------|-------|------------|
| `RecordPage.tsx` | 776 | **Very High** |
| `VideoPage.tsx` | 541 | High |
| `HomePage.tsx` | 192 | Medium |

### Components (7)
| File | Lines | Purpose |
|------|-------|---------|
| `AppShell.tsx` | 141 | Layout wrapper with theme |
| `PlayerCard.tsx` | 280 | Video player with chapters |
| `TranscriptCard.tsx` | 352 | Transcript display/editor |
| `StatusPanel.tsx` | 193 | Processing status display |
| `SummaryCard.tsx` | 159 | AI summary display |
| `ProviderStatusPanel.tsx` | 92 | Provider health |
| `ConfirmationDialog.tsx` | 49 | Modal dialog |

### Utilities (3)
| File | Lines | Purpose |
|------|-------|---------|
| `api.ts` | 407 | API client |
| `format.ts` | 41 | Formatting utilities |
| `sessions.ts` | 44 | localStorage wrapper |

---

## Findings by Category

### 1. Component Architecture

#### 🔴 HIGH: RecordPage Excessive Complexity
**File:** `apps/web/src/pages/RecordPage.tsx` (776 lines)  
**Lines:** 1-776

The `RecordPage` component violates the single responsibility principle with 776 lines managing:
- Media stream lifecycle (display, microphone, camera)
- MediaRecorder orchestration
- Audio context and analyser for mic level visualization
- Upload state machine (single-part and multipart)
- 15+ useRef references for imperative media handling
- 20+ state variables

**Current Code (lines 46-95):**
```typescript
export function RecordPage() {
  const navigate = useNavigate();

  const [state, setState] = useState<RecorderState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  // ... 14 more refs and state variables
```

**Risk:**
- Difficult to test individual behaviors
- High cognitive load for developers
- Risk of state synchronization bugs
- Hard to reuse recording logic elsewhere

**Recommendation:**
Extract custom hooks:
```typescript
// hooks/useMediaRecorder.ts
function useMediaRecorder(options: { micEnabled: boolean; cameraEnabled: boolean }) {
  // Returns: { start, stop, state, blob, error }
}

// hooks/useUpload.ts  
function useUpload() {
  // Returns: { upload, progress, state, retry }
}

// RecordPage.tsx becomes ~200 lines
export function RecordPage() {
  const recorder = useMediaRecorder({ micEnabled, cameraEnabled });
  const uploader = useUpload();
  // ... simplified JSX
}
```

---

#### 🟡 MEDIUM: Inline SVG Duplication
**File:** `apps/web/src/components/AppShell.tsx`  
**Lines:** 48-51, 82-89

SVG icons are defined inline, making them hard to reuse and maintain.

**Current Code:**
```typescript
const navItems = [
  { label: "Home", path: "/", icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">...</svg> },
  // ...
];
```

**Recommendation:** Create an `Icon` component or import from a library like `lucide-react`.

---

#### 🟡 MEDIUM: VideoPage Component Size
**File:** `apps/web/src/pages/VideoPage.tsx` (541 lines)  
**Lines:** 108-541

While better than `RecordPage`, this still mixes:
- Data fetching and polling logic
- Chapter derivation algorithm
- Title editing state management
- Delete confirmation handling
- Multiple UI sections (player, transcript, summary)

**Recommendation:** Consider splitting into container/presentational pattern or extracting `useVideoStatus` hook.

---

### 2. State Management

#### 🟡 MEDIUM: Excessive useState in HomePage
**File:** `apps/web/src/pages/HomePage.tsx`  
**Lines:** 8-18

```typescript
const [libraryItems, setLibraryItems] = useState<LibraryVideoCard[]>([]);
const [nextCursor, setNextCursor] = useState<string | null>(null);
const [loadingLibrary, setLoadingLibrary] = useState(false);
const [libraryError, setLibraryError] = useState<string | null>(null);
const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
const [loadingProviderStatus, setLoadingProviderStatus] = useState(false);
const [providerStatusError, setProviderStatusError] = useState<string | null>(null);
const [deleteTarget, setDeleteTarget] = useState<LibraryVideoCard | null>(null);
const [isDeleting, setIsDeleting] = useState(false);
const [deleteError, setDeleteError] = useState<string | null>(null);
```

**Risk:** Related state variables could be grouped to reduce complexity.

**Recommendation:** Use reducer pattern or group related state:
```typescript
const [library, setLibrary] = useState({
  items: [],
  cursor: null,
  loading: false,
  error: null
});
```

---

#### 🟢 LOW: Missing useCallback for Event Handlers
**File:** `apps/web/src/pages/HomePage.tsx`  
**Lines:** 20-35

The `phaseLabel` and `dateLabel` functions are recreated on every render but don't depend on component state.

```typescript
const phaseLabel = (phase?: string | null) => {
  const labels: Record<string, string> = { ... };
  return phase ? labels[phase] ?? phase : "Queued";
};
```

**Recommendation:** Move outside component or wrap in `useCallback`.

---

### 3. API Integration

#### 🟢 LOW: No Request Deduplication
**File:** `apps/web/src/lib/api.ts`  
**Lines:** 160-222

API functions use native `fetch` without deduplication. Rapid calls could result in redundant network requests.

**Current Code:**
```typescript
export async function getVideoStatus(videoId: string): Promise<VideoStatusResponse> {
  return parseJson<VideoStatusResponse>(await fetch(`/api/videos/${encodeURIComponent(videoId)}/status`));
}
```

**Recommendation:** Consider React Query (TanStack Query) for caching, deduplication, and background refetching.

---

#### 🟢 LOW: Error Handling Inconsistency
**File:** `apps/web/src/lib/api.ts`  
**Lines:** 146-151

```typescript
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}
```

Generic Error throwing loses HTTP status information that callers might need for specific handling.

**Recommendation:** Create custom error class:
```typescript
class ApiError extends Error {
  constructor(message: string, public status: number, public response: Response) {
    super(message);
  }
}
```

---

### 4. Performance

#### 🔴 HIGH: Missing Memoization in TranscriptCard
**File:** `apps/web/src/components/TranscriptCard.tsx`  
**Lines:** 51-61, 128-147

The component uses `setInterval` to poll video playback time and recalculates active line index on every render.

```typescript
useEffect(() => {
  const interval = window.setInterval(() => {
    const player = document.querySelector("video");
    // ... updates state every 250ms
  }, 250);
  return () => window.clearInterval(interval);
}, []);
```

**Risk:** Frequent state updates trigger re-renders; without memoization, derived calculations run unnecessarily.

**Recommendation:**
```typescript
const activeLineIndex = useMemo(() => {
  // ... expensive calculation
}, [transcriptLines, playbackTimeSeconds, observedPlaybackTime, seekFocusSeconds]);
```

---

#### 🔴 HIGH: PlayerCard Missing Memoization
**File:** `apps/web/src/components/PlayerCard.tsx`  
**Lines:** 72-83

```typescript
const activeChapterIndex = useMemo(() => {
  if (timelineChapters.length === 0) return -1;
  let active = 0;
  for (let index = 0; index < timelineChapters.length; index += 1) {
    // ... loop
  }
  return active;
}, [timelineChapters, playbackTimeSeconds]);
```

Good use of `useMemo`, but `timelineChapters` (line 70) is not memoized and recalculates on every render:

```typescript
const timelineChapters = durationSeconds > 0 ? chapters.filter(...) : [];
```

**Recommendation:**
```typescript
const timelineChapters = useMemo(() => 
  durationSeconds > 0 ? chapters.filter(...) : [],
  [chapters, durationSeconds]
);
```

---

#### 🟡 MEDIUM: StatusPanel Inline Object Definitions
**File:** `apps/web/src/components/StatusPanel.tsx`  
**Lines:** 71-79, 80-91

Static lookup objects defined inside component:
```typescript
const steps = [
  { key: "queued", label: "Queued", rank: 10 },
  // ...
] as const;
```

These should be defined outside the component to avoid recreation.

---

### 5. TypeScript

#### 🟡 MEDIUM: Type Assertions Without Validation
**File:** `apps/web/src/lib/api.ts`  
**Lines:** 146-151

```typescript
return (await res.json()) as T;
```

Type assertion bypasses runtime validation. Malformed responses could cause runtime errors.

**Risk:** Type safety is only at compile time; runtime data could be anything.

**Recommendation:** Use Zod or similar for runtime validation:
```typescript
import { z } from 'zod';

const VideoStatusSchema = z.object({
  videoId: z.string(),
  processingPhase: z.string(),
  // ...
});

type VideoStatusResponse = z.infer<typeof VideoStatusSchema>;
```

---

#### 🟢 LOW: Inconsistent Optional Chaining
**File:** `apps/web/src/pages/VideoPage.tsx`  
**Lines:** 139

```typescript
const chapters = useMemo(() => deriveChapters(status?.aiOutput, transcriptSegments), [status?.aiOutput, transcriptSegments]);
```

The dependency array includes `status?.aiOutput` which is fine, but mixing optional chaining patterns can be confusing.

---

### 6. Code Duplication

#### 🟡 MEDIUM: Timestamp Formatting Duplicated
**Files:**
- `apps/web/src/components/PlayerCard.tsx` (lines 14-23)
- `apps/web/src/components/TranscriptCard.tsx` (lines 21-30)
- `apps/web/src/components/SummaryCard.tsx` (lines 18-27)

Three identical `formatTimestamp` functions exist.

**Current Code (PlayerCard.tsx):**
```typescript
function formatTimestamp(secondsInput: number): string {
  const totalSeconds = Math.max(0, Math.floor(secondsInput));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
```

**Recommendation:** Export from `format.ts`:
```typescript
// lib/format.ts
export function formatTimestamp(secondsInput: number): string { ... }
```

---

#### 🟢 LOW: ChapterItem Type Duplicated
**Files:**
- `apps/web/src/components/PlayerCard.tsx` (lines 9-12)
- `apps/web/src/pages/VideoPage.tsx` (lines 35-38)

```typescript
type ChapterItem = {
  title: string;
  seconds: number;
};
```

**Recommendation:** Define in shared types file.

---

### 7. Effects and Lifecycle

#### 🟡 MEDIUM: VideoPage Polling Logic Complexity
**File:** `apps/web/src/pages/VideoPage.tsx`  
**Lines:** 228-238

```typescript
useEffect(() => {
  if (!videoId || isDeleted) return;
  if (hasReachedTerminalState(status)) return;
  const delayMs = consecutivePollFailures === 0 ? 2000 : Math.min(15000, 2000 * 2 ** consecutivePollFailures);
  const timeout = window.setTimeout(() => {
    void refresh();
  }, delayMs);
  return () => {
    window.clearTimeout(timeout);
  };
}, [videoId, status, refresh, consecutivePollFailures]);
```

Polling logic is embedded in component. This is complex and hard to test.

**Recommendation:** Extract to `usePolling` hook:
```typescript
function usePolling(callback: () => void, options: { enabled: boolean; interval: number; backoff?: boolean }) {
  // ...
}
```

---

#### 🟢 LOW: Missing Cleanup in HomePage
**File:** `apps/web/src/pages/HomePage.tsx`  
**Lines:** 51-59

Effect loads data but doesn't handle component unmount during async operation.

```typescript
useEffect(() => {
  void refreshLibrary();
  const loadStatus = async () => { ... };
  void loadStatus();
}, []);
```

**Risk:** State update on unmounted component (though React 18+ handles this better).

**Recommendation:** Use abort controller or cleanup flag:
```typescript
useEffect(() => {
  let cancelled = false;
  const load = async () => {
    const data = await fetchData();
    if (!cancelled) setData(data);
  };
  load();
  return () => { cancelled = true; };
}, []);
```

---

### 8. Accessibility

#### 🟢 LOW: Missing aria-label on Icon Buttons
**File:** `apps/web/src/pages/HomePage.tsx`  
**Lines:** 165-170

Delete button uses SVG without accessible label:
```typescript
<button
  onClick={(e) => { e.preventDefault(); setDeleteTarget(item); }}
  className="..."
>
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">...</svg>
</button>
```

**Recommendation:** Add `aria-label="Delete video"`.

---

## Recommendations Summary

### Immediate (High Priority)
1. **Refactor RecordPage** - Extract `useMediaRecorder` and `useUpload` hooks
2. **Add memoization** - Wrap `timelineChapters` in `PlayerCard`, optimize `TranscriptCard`
3. **Consolidate format utilities** - Move `formatTimestamp` to shared location

### Short Term (Medium Priority)
4. **Create shared types** - Extract `ChapterItem`, API response types
5. **Extract polling hook** - Simplify `VideoPage` polling logic
6. **Add runtime validation** - Use Zod for API response parsing
7. **Group related state** - Use reducer pattern in `HomePage`

### Long Term (Low Priority)
8. **Adopt React Query** - Replace manual fetching/caching
9. **Icon component** - Replace inline SVGs
10. **Add error boundaries** - Wrap page components
11. **Accessibility audit** - Add aria labels, focus management

---

## Architecture Strengths

1. **Good TypeScript coverage** - All files use TypeScript with defined interfaces
2. **Clean component boundaries** - Props are well-defined and typed
3. **Consistent styling** - Uses Tailwind with consistent class patterns
4. **Proper cleanup** - Effects generally clean up subscriptions/intervals
5. **API separation** - Clean abstraction in `api.ts`
6. **Theme support** - Dark/light mode with localStorage persistence

---

## Appendix: Dependency Analysis

### External Dependencies
- `react` / `react-dom` - Core framework
- `react-router-dom` - Routing
- Tailwind CSS - Styling

### Missing (Consider Adding)
- `@tanstack/react-query` - Data fetching
- `zod` - Runtime validation
- `lucide-react` - Icons
- `date-fns` - Date formatting (if complexity grows)

---

*End of Frontend Structure Report*
