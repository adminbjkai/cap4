# CAP3 Design System

## Intent

CAP3 uses a restrained Zinc-based interface. The product should feel operational, dense, and calm rather than decorative. Surfaces carry hierarchy through spacing, borders, and contrast, not effects.

## Color System

Primary tokens live in [index.css](/Users/m17/2026/gh_repo_tests/cap3/apps/web/src/index.css).

- App background: Zinc neutrals with a soft contrast step between page, surface, and subtle surface.
- Surface hierarchy:
  - `--bg-app`: overall page background
  - `--bg-surface`: primary card background
  - `--bg-surface-subtle`: secondary panels and grouped controls
  - `--bg-surface-muted`: tracks, placeholders, muted fills
- Text hierarchy:
  - `--text-primary`: headings and primary values
  - `--text-secondary`: body copy
  - `--text-muted`: labels, helper text, metadata
- State colors:
  - success, warning, danger, and info are muted and functional
  - avoid saturated marketing colors or gradients outside explicit progress indications

## Radius

- Cards and major panels: `0.75rem`
  - Use `rounded-xl`
  - Examples: `workspace-card`, `panel-subtle`
- Buttons, inputs, toggles, segmented controls: `0.5rem`
  - Use `rounded-lg`
- Small chips and inline pills may be tighter when needed, but should still read as part of the same family.

## Spacing

- Page sections: `gap-5` or `gap-6`
- Card padding:
  - default card: `p-6`
  - dense control card: `p-4` to `p-5`
- Internal grouping:
  - prefer `space-y-3` or `space-y-4`
  - avoid large empty gutters that make content feel detached

## Typography

- Primary heading: concise, high contrast, tight tracking
- Labels: uppercase, small, muted, generous letter spacing
- Helper copy: short and factual
- Avoid oversized hero treatments in operational views

## Component Tokens

- `workspace-card`
  - default surface for page sections
- `panel-subtle`
  - grouped sub-surface inside a primary card
- `status-chip`
  - compact state presentation
- `btn-primary`
  - strongest action in a local area
- `btn-secondary`
  - standard neutral action
- `btn-tertiary`
  - low-emphasis utility action
- `segment-btn`
  - segmented view switching
- `progress-track`
  - muted progress rail behind active fill

## Layout Rules

- Desktop should use horizontal space aggressively but cleanly.
- Primary production views should prefer split layouts over vertically stacked long pages when two concurrent tasks exist.
  - Example: video player in the main column, transcript and AI in the side rail.
- Sidebars and rails should feel structural, not decorative.

## Anti-Patterns

- No glassmorphism
- No heavy blur as a primary visual style
- No bright accent gradients except for explicit progress communication
- No oversized empty margins that reduce information density
- No ad hoc radius values outside the established card/button system

## Phase 3 Notes

- `HomePage` is the high-density library view.
- `VideoPage` is the studio view with a main player column and a right rail.
- `RecordPage` should read as one guided workflow: setup, preview, upload.
