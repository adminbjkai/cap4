# Design System — cap4

Component library, token reference, and UI patterns.

> **Last updated:** 2026-03-09 (Phase 4.7 — sage accent tokenization + agent sprint components)

---

## Architecture

The design system has two layers:

1. **CSS Custom Properties** (`apps/web/src/index.css`) — all raw values as `:root` / `.theme-dark` variables.
2. **Tailwind color extensions** (`apps/web/tailwind.config.cjs`) — semantic aliases mapping utility classes (`bg-surface`, `text-foreground`, etc.) to those CSS vars.

**Rule:** Never hardcode hex colors in component files. Always use the token layer.

---

## Color Tokens

### Light Mode

| CSS Variable | Tailwind | Value | Usage |
|---|---|---|---|
| `--bg-app` | `bg-app` | `#f9fafb` | Page background |
| `--bg-surface` | `bg-surface` | `#ffffff` | Cards, panels |
| `--bg-surface-subtle` | `bg-surface-subtle` | `#f3f4f6` | Inputs, inset areas |
| `--bg-surface-muted` | `bg-surface-muted` | `#e5e7eb` | Hover backgrounds |
| `--bg-elevated` | `bg-elevated` | `#ffffff` | Tooltips, popovers |
| `--text-primary` | `text-foreground` | `#1f2937` | Headings, primary text |
| `--text-secondary` | `text-secondary` | `#6b7280` | Body text |
| `--text-muted` | `text-muted` | `#9ca3af` | Labels, timestamps, hints |
| `--border-default` | — | `#e5e7eb` | Default borders |
| `--border-strong` | — | `#d1d5db` | Focused/active borders |
| `--accent` | `text-primary` / `bg-primary` | `#1f2937` | Primary ink |
| `--accent-blue` | `text-blue` / `bg-blue` | `#6b8f71` | Tabs, active states, focus |
| `--accent-blue-hover` | — | `#5a7d60` | Accent hover |
| `--accent-blue-subtle` | `bg-blue-subtle` | `#f0f5f1` | Active transcript line bg |
| `--accent-blue-border` | — | `#b8d4bc` | Active item border |
| `--accent-blue-muted` | — | `#dce8dd` | Focus rings, glow |
| `--hover-surface` | `bg-hover` | `#f3f4f6` | Row hover |

### Dark Mode (`.theme-dark`)

Key differences from light: `--bg-app: #0a0a0a`, `--bg-surface: #141414`, `--bg-surface-subtle: #1e1e1e`, `--bg-surface-muted: #2a2a2a`, `--text-primary: #e8e8e8`, `--text-secondary: #a0a0a0`, `--text-muted: #6b6b6b`, `--border-default: #2a2a2a`, `--border-strong: #3a3a3a`, `--accent-blue: #7da882`, `--accent-blue-hover: #93bea0`.

---

## Typography

Font stack: `Inter, system-ui, -apple-system, sans-serif` / `JetBrains Mono, Menlo, Consolas, monospace`

| Usage | Class | Size |
|---|---|---|
| Page title | `text-xl font-bold` | 20px |
| Section heading | `text-sm font-semibold` | 14px |
| Body | `text-[13px]` | 13px |
| Timestamps | `text-[11px] font-mono` | 11px |
| Labels/chips | `text-[10px] uppercase tracking-wide` | 10px |

---

## Component Classes

All defined in `apps/web/src/index.css` under `@layer components`.

### Component Inventory Additions (BJK-9 through BJK-18)

| Component | Purpose |
|---|---|
| `CommandPalette` | Keyboard-first command launcher for navigation/actions |
| `CustomVideoControls` | Custom playback control bar replacing native video controls |
| `ShortcutsOverlay` | Modal reference for supported keyboard shortcuts |
| Speaker badges | Per-speaker identity and editing affordances in transcript rows |
| Summary strip | Compact AI summary band between player and chapter list |

### Cards & Panels
```
.workspace-card    standard card — border + bg-surface + hover shadow
.panel-subtle      inset — bg-surface-subtle
.panel-warning     amber border + bg
.panel-danger      red border + bg
```

### Buttons
```
.btn-primary       filled, accent bg
.btn-secondary     bordered, bg-surface-subtle
.btn-tertiary      ghost / transparent
```

### Inputs
```
.input-control     rounded-lg, focus ring in --accent-blue
```

### Command Surfaces
```
.command-palette-shell  searchable modal shell for quick actions
.command-palette-item   keyboard-focusable result row
.shortcuts-overlay      keyboard shortcut reference modal
```

### Toggles
```
.pill-toggle           container (Current/Original etc.)
.pill-toggle-btn       inactive
.pill-toggle-btn-active active (white bg, shadow)
```

### Transcript
```
.line-item         clickable segment row
.line-item-active  playing row — blue left border + subtle bg
.scroll-panel      thin scrollbar helper
```

### Player / Timeline
```
.chapter-handle        dot on timeline (white + border)
.chapter-handle-active blue filled
.popover-panel         tooltip bubble (shadow-tooltip)
.seeker-track          clickable full-width timeline
.seeker-fill           blue playback bar
.seeker-hover-indicator cursor hairline on hover
```

### Custom Video Controls
```
.custom-video-controls       unified playback control container
.custom-video-control-button icon button with visible focus ring
.custom-video-timecode       mono current/duration display
```

### Right Rail (3-tab)
```
.rail-tab-bar      tab strip — border-bottom
.rail-tab          individual tab button
.rail-tab-active   selected — blue underline + primary text
.notes-textarea    transparent textarea for Notes tab
```

### Speaker Diarization
```
.speaker-badge           per-speaker color badge
.speaker-badge-editing   editable label input state
.speaker-filter-chip     show/hide speaker filter chip
```

### Summary Strip
```
.summary-strip      compact AI summary band between player and chapters
.summary-strip-copy truncated summary body text
```

### Chapters
```
.chapter-row-active  active chapter in sidebar (replaces non-functional bg-primary/10)
```

---

## Right Rail — 3-Tab System

| Tab | Content | Persistence |
|---|---|---|
| **Notes** | User's private notes (NotesPanel) | `localStorage` key: `cap4:notes:{videoId}`, debounced 600ms |
| **Summary** | AI summary + "Generated by Cap AI" + chapter list | Remote (API) |
| **Transcript** | Timestamp-aligned segments synced to playback | Remote (API) |

Container: `max-height: 520px`, scrollable with thin scrollbar.

---

## Video Player Features

- Custom player controls (native controls disabled)
- **Custom chapter timeline overlay** — dot markers at chapter positions
- **Seeker hover preview** — hover anywhere on the track → timestamp tooltip + nearest chapter title
- **Clickable track** — click any position to seek
- **Chapter dots** — click to jump; active dot filled blue with glow ring
- **Playback fill bar** — blue bar showing % played
- **Prev/Next chapter** — buttons to step between chapters
- **Poster frame** — thumbnail before play

---

## Page Layout

```
Desktop (lg+)
┌─────────────────────────┬────────────────┐
│  Video player (8fr)     │  Rail (5fr)    │
│  + chapter timeline     │  Notes         │
│                         │  Summary ← tab │
│                         │  Transcript    │
├─────────────────────────┴────────────────┤
│  Chapters (full width, inline mode)      │
└──────────────────────────────────────────┘

Mobile (below lg)
Single column — player → rail → chapters
```

Grid: `lg:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]`

---

## Accessibility

- `type="button"` on all interactive elements
- `aria-label` on icon-only buttons
- `role="slider"` + `aria-value*` on timeline track
- `sr-only` on chapter handle buttons
- `aria-pressed` on toggle buttons
- Focus-visible styles on all interactive elements
- Tab keyboard navigation

---

## Spacing Conventions

| Location | Value |
|---|---|
| Rail tab padding | `px-4 py-2.5` |
| Transcript line | `px-3 py-2` |
| Chapter row (inline) | `px-4 py-2` |
| Below-fold gap | `mt-5` |
| Card padding | `p-6` |

---

## Design Maintenance Rules

- Add new raw values in `apps/web/src/index.css` as CSS variables first.
- Map reusable values into Tailwind tokens before using them across components.
- Do not hardcode hex colors in component files.
- Add new shared component classes under `@layer components` in `apps/web/src/index.css`.
- Update this file when adding a reusable visual pattern, token, or layout convention.

---

## File Reference

| File | Role |
|---|---|
| `apps/web/src/index.css` | CSS tokens + all component classes |
| `apps/web/tailwind.config.cjs` | Tailwind color/shadow/font extensions |
| `apps/web/src/pages/VideoPage.tsx` | Layout, 3-tab rail, NotesPanel |
| `apps/web/src/components/PlayerCard.tsx` | Video + timeline + seeker preview |
| `apps/web/src/components/TranscriptCard.tsx` | Transcript display + edit |
| `apps/web/src/components/SummaryCard.tsx` | AI summary + chapter list |
| `apps/web/src/components/ChapterList.tsx` | Below-fold chapters (inline mode) |
