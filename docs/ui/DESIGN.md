# Design Reference — cap4

Visual design specification: color palette, typography, spacing, and component patterns.

> **Last updated:** 2026-03-09 (Phase 4.6 — gray/slate palette, 3-tab rail, seeker preview)

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
| Interactive blue | `--accent-blue` | `#3b82f6` (blue-500) | `text-blue` / `bg-blue` |
| Active bg (blue) | `--accent-blue-subtle` | `#eff6ff` (blue-50) | `bg-blue-subtle` |
| Active border | `--accent-blue-border` | `#bfdbfe` (blue-200) | — |
| Row hover | `--hover-surface` | `#f3f4f6` | `bg-hover` |

### Dark Mode (`:root.theme-dark`)

| Role | CSS Variable | Value | Tailwind |
|---|---|---|---|
| Page background | `--bg-app` | `#0f172a` (slate-900) | `bg-app` |
| Card / panel | `--bg-surface` | `#1e293b` (slate-800) | `bg-surface` |
| Inset / input | `--bg-surface-subtle` | `#253348` | `bg-surface-subtle` |
| Hover fill | `--bg-surface-muted` | `#334155` (slate-700) | `bg-surface-muted` |
| Primary text | `--text-primary` | `#f1f5f9` (slate-100) | `text-foreground` |
| Secondary text | `--text-secondary` | `#cbd5e1` (slate-300) | `text-secondary` |
| Muted / label | `--text-muted` | `#94a3b8` (slate-400) | `text-muted` |
| Default border | `--border-default` | `#334155` (slate-700) | — |
| Interactive blue | `--accent-blue` | `#60a5fa` (blue-400) | `text-blue` / `bg-blue` |
| Active bg (blue) | `--accent-blue-subtle` | `rgba(96,165,250,0.12)` | `bg-blue-subtle` |

**WCAG AA targets:** Light mode primary text (`#1f2937`) on white passes 10.5:1. Dark mode primary text (`#f1f5f9`) on `#1e293b` passes 13.8:1. Interactive blue meets 3:1 on both backgrounds.

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
