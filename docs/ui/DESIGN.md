# Design Reference — cap4

Visual design specification: color palette, typography, spacing, and component patterns.

> **Last updated:** 2026-03-09 (Phase 4.7 — sage theme, true-dark mode, command workflows)

---

## Color Palette

### Light Mode (`:root`)

| Role | CSS Variable | Value | Tailwind |
|---|---|---|---|
| Page background | `--bg-app` | `#f9fafb` (gray-50) | `bg-app` |
| Card / panel | `--bg-surface` | `#ffffff` | `bg-surface` |
| Inset / input | `--bg-surface-subtle` | `#f3f4f6` (gray-100) | `bg-surface-subtle` |
| Hover fill | `--bg-surface-muted` | `#e5e7eb` (gray-200) | `bg-surface-muted` |
| Tooltip / popover | `--bg-elevated` | `#ffffff` | — |
| Primary text | `--text-primary` | `#1f2937` (gray-800) | `text-foreground` |
| Secondary text | `--text-secondary` | `#6b7280` (gray-500) | `text-secondary` |
| Muted / label | `--text-muted` | `#9ca3af` (gray-400) | `text-muted` |
| Default border | `--border-default` | `#e5e7eb` (gray-200) | — |
| Strong border | `--border-strong` | `#d1d5db` (gray-300) | — |
| Interactive accent | `--accent-blue` | `#6b8f71` | `text-blue` / `bg-blue` |
| Accent hover | `--accent-blue-hover` | `#5a7d60` | — |
| Active bg (accent) | `--accent-blue-subtle` | `#f0f5f1` | `bg-blue-subtle` |
| Active border | `--accent-blue-border` | `#b8d4bc` | — |
| Row hover | `--hover-surface` | `#f3f4f6` | `bg-hover` |

### Dark Mode (`:root.theme-dark`)

| Role | CSS Variable | Value | Tailwind |
|---|---|---|---|
| Page background | `--bg-app` | `#0a0a0a` | `bg-app` |
| Card / panel | `--bg-surface` | `#141414` | `bg-surface` |
| Inset / input | `--bg-surface-subtle` | `#1e1e1e` | `bg-surface-subtle` |
| Hover fill | `--bg-surface-muted` | `#2a2a2a` | `bg-surface-muted` |
| Primary text | `--text-primary` | `#e8e8e8` | `text-foreground` |
| Secondary text | `--text-secondary` | `#a0a0a0` | `text-secondary` |
| Muted / label | `--text-muted` | `#6b6b6b` | `text-muted` |
| Default border | `--border-default` | `#2a2a2a` | — |
| Strong border | `--border-strong` | `#3a3a3a` | — |
| Interactive accent | `--accent-blue` | `#7da882` | `text-blue` / `bg-blue` |
| Accent hover | `--accent-blue-hover` | `#93bea0` | — |
| Active bg (accent) | `--accent-blue-subtle` | `rgba(125,168,130,0.10)` | `bg-blue-subtle` |

**WCAG AA targets:** Light mode primary text (`#1f2937`) on white passes 10.5:1. Dark mode primary text (`#e8e8e8`) on `#141414` passes AA. Interactive accent meets 3:1 on both backgrounds.

---

## Typography

Font stack: `Inter, system-ui, -apple-system, sans-serif`
Mono stack: `JetBrains Mono, Menlo, Consolas, monospace`

| Usage | Tailwind classes | Computed size |
|---|---|---|
| Page heading | `text-xl font-bold` | 20px / 700 |
| Section heading | `text-sm font-semibold` | 14px / 600 |
| Body copy | `text-[13px] leading-[1.55]` | 13px |
| Timestamps / mono | `text-[11px] font-mono` | 11px |
| Labels / chips | `text-[10px] uppercase tracking-wide` | 10px |

---

## Spacing

| Context | Value |
|---|---|
| Card padding | `p-6` (24px) |
| Rail tab | `px-4 py-2.5` |
| Transcript line | `px-3 py-2` |
| Chapter row (inline) | `px-4 py-2` |
| Section gap (below-fold) | `mt-5` |
| Tooltip padding | `px-2.5 py-1.5` |

---

## Shadows

Defined as Tailwind `boxShadow` extensions in `tailwind.config.cjs`:

| Token | Value | Used on |
|---|---|---|
| `shadow-card` | `0 1px 3px rgba(0,0,0,0.04)` | `.workspace-card` (rest) |
| `shadow-card-hover` | `0 4px 12px rgba(0,0,0,0.08)` | `.workspace-card:hover` |
| `shadow-tooltip` | `0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)` | `.popover-panel` |

---

## Component Patterns

### Card — `.workspace-card`
Standard surface. `rounded-xl`, `border`, `bg-surface`, `shadow-card`. Hover lifts border and shadow.

### Status panels
- `.panel-subtle` — inset area (gray-100 bg, gray-200 border)
- `.panel-warning` — amber tone for advisory states
- `.panel-danger` — red tone for failures
- `.panel-success` — green tone for confirmations

### Buttons
- `.btn-primary` — filled `--accent` background, white text
- `.btn-secondary` — `bg-surface-subtle`, `border-default` border
- `.btn-tertiary` — fully transparent, hover only

### Tabs — Rail tab system
```
.rail-tab-bar    flex strip; border-bottom: 1px solid --border-default
.rail-tab        px-4 py-2.5; color: --text-muted; border-bottom: 2px solid transparent; margin-bottom: -1px
.rail-tab-active color: --text-primary; border-bottom-color: --accent-blue
```

### Transcript line
```
.line-item         block w-full text-left; hover: bg --hover-surface
.line-item-active  border-left: 2px solid --accent-blue; bg: --accent-blue-subtle
```

### Player timeline
```
.seeker-track          h-8 full-width clickable; cursor-pointer
.seeker-fill           absolute h-[3px]; background: --accent-blue; width = playback %
.seeker-hover-indicator absolute hairline at cursor X; opacity transition
.chapter-handle        3.5×3.5 circle; border: 2px solid --border-strong
.chapter-handle-active border+bg: --accent-blue; box-shadow: glow ring
.popover-panel         rounded-lg; bg: --bg-elevated; shadow-tooltip; px-2.5 py-1.5
```

### Right rail — 3-tab
```
Tab "Notes"      — <NotesPanel> localStorage key: cap4:notes:{videoId}; debounced 600ms
Tab "Summary"    — <SummaryCard compact> AI output; "Generated by Cap AI" label
Tab "Transcript" — <TranscriptCard compact> timestamp-synced playback segments
```

### Command Palette
Global action launcher opened with `Cmd+K` / `Ctrl+K`.

- Search videos and jump directly to watch routes
- Keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`)
- Integrated with shortcuts overlay and global key handling

### Custom Video Controls
Custom control surface replaces native browser video chrome.

- Play/pause, seek, volume, speed, PiP, fullscreen
- Keyboard-accessible controls with visible focus treatment
- Uses shared accent tokens for active/hover states

### Speaker Diarization UI
Transcript and timeline expose speaker-level context.

- Colored speaker badges per segment
- Editable speaker labels persisted via `speakerLabels`
- Speaker filters to isolate participants in transcript view

### Summary Strip
Inline summary band sits between the player grid and chapter list.

- Rendered only when AI summary exists
- Uses `bg-surface-subtle` and subtle top/bottom borders
- Compact typography (`text-[13px]`) with "Generated by Cap AI" label

---

## Layout

```
Desktop (lg+)
┌────────────────────────────┬──────────────────┐
│  Video player   (8fr)      │  Right rail (5fr)│
│  + chapter timeline        │  [Notes|Sum|Tx]  │
│                            │  scrollable 520px│
├────────────────────────────┴──────────────────┤
│  Chapters (full width, inline list)           │
└───────────────────────────────────────────────┘

Mobile (< lg)
Single column: player → rail → chapters
```

Grid: `lg:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]`

---

## Adding New Colors

1. Add the CSS variable to both `:root` and `:root.theme-dark` in `index.css`
2. Map it to a Tailwind utility in `tailwind.config.cjs` under `theme.extend.colors`
3. Use the Tailwind class in components — never hardcode hex values

## Adding New Component Classes

1. Add to `@layer components` in `index.css`
2. Document in this file and in `DESIGN_SYSTEM.md`
3. Reference via class name in JSX — do not repeat the CSS inline

---

## File Reference

| File | Role |
|---|---|
| `apps/web/src/index.css` | All CSS custom properties + component classes |
| `apps/web/tailwind.config.cjs` | Tailwind semantic color/shadow/font extensions |
| `docs/ui/DESIGN_SYSTEM.md` | Component catalog, token table, layout diagram |
| `apps/web/src/pages/VideoPage.tsx` | Layout + 3-tab rail + NotesPanel |
| `apps/web/src/components/PlayerCard.tsx` | Video + seeker timeline + hover preview |
| `apps/web/src/components/TranscriptCard.tsx` | Transcript lines (compact + standalone) |
| `apps/web/src/components/SummaryCard.tsx` | AI summary + chapter list (compact + standalone) |
| `apps/web/src/components/ChapterList.tsx` | Below-fold chapter navigation |
