# Phase G Plan: Global Library + Management Model (G0 Planning)

Status: `in_progress` (G1 implemented; G2-G4 planned).

## Scope and Guardrails
- Single-tenant scope only; no auth/users/org/workspace expansion.
- No runtime code/database implementation in G0.
- Preserve AGENTS principles for later implementation:
  - read endpoints side-effect free,
  - monotonic state transitions,
  - idempotency for mutating APIs,
  - no GET-triggered job mutations.

## Problem Statement
Current home/library experience is anchored on local browser sessions and does not productize global asset access and management. We need a universal library read model and basic management operations (delete, folders, move), then watch-page spatial optimization.

## Target Product Outcome
1. Global library view replaces local-session-primary UX.
2. Videos visible across browsers/devices via backend read model.
3. Foundational management primitives: delete, folder create, move.
4. Watch page better utilizes horizontal space and reduces vertical scrolling.

## Phase Breakdown

### G1: Global Library Read Model + UI
Objective:
- Replace “Recent local sessions” as primary source with backend global library listing.

Acceptance criteria:
- Home/library shows human title, compact thumbnail cards, status, date, duration, quick actions.
- Library data is consistent across browser sessions/devices.
- Local sessions remain optional secondary helper only (not primary data source).

DB changes/migrations:
- Add listing support fields/indexes only (no processing-state behavior changes):
  - `videos.title_display` (nullable, denormalized fallback for sorting/display),
  - `videos.deleted_at` (nullable soft delete marker; used in G2),
  - indexes for `created_at DESC`, `deleted_at IS NULL`.
- Backfill:
  - initialize `title_display` from existing AI title when present, else synthetic fallback.

Endpoint contracts (planned):
- `GET /api/library/videos?cursor=&limit=&status=&folderId=&q=&sort=created_desc`
  - Read-only, no side effects.
  - Response: `items[]` card model + `nextCursor`.
- `GET /api/library/videos/:id/card`
  - Read-only compact card/read-model fetch for detail overlays.

Frontend surfaces:
- `HomePage` -> global card grid/list.
- Shared `LibraryCard` component (thumbnail, title, status chip, date, duration, actions).
- Keep quick action to open `/video/:id`.

Rollout/backfill strategy:
- Ship read endpoint and UI behind feature flag `LIBRARY_V2`.
- During rollout, fall back to local sessions if API unavailable.
- Run one-time title_display backfill migration.

Risks:
- Large result sets and slow list queries.
- Title inconsistency between AI title and user-edited title.

Rollback:
- Disable `LIBRARY_V2`, revert to current local-session-first UI.
- Keep additive schema columns unused if rolled back.

Implementation status:
- `done` for baseline G1 scope (without new DB columns in this iteration).

Evidence (2026-02-26):
- Added read-only endpoint `GET /api/library/videos` backed by `videos` + `ai_outputs` with cursor pagination and `created_desc` default sort.
- Home page primary block now renders compact global server-backed library cards (thumbnail, human title, statuses, date, duration, open action).
- Local session list retained as de-emphasized secondary helper only.
- Cross-session verification passed by clearing browser localStorage and reloading Home; global library still rendered server-backed entries.

### G2: Video Management Mutations (Delete + Metadata Update)
Objective:
- Add safe mutations for delete and metadata updates in library/watch contexts.

Acceptance criteria:
- User can rename title and delete video from library/watch.
- Mutations are replay-safe using `Idempotency-Key`.
- Deleted videos disappear from default library listing and remain auditable.

DB changes/migrations:
- Reuse `videos.deleted_at` from G1 for soft delete.
- Add `videos.deleted_reason` nullable text (optional operational metadata).
- No hard delete in MVP.

Endpoint contracts (planned):
- `PATCH /api/videos/:id`
  - Header: `Idempotency-Key` required.
  - Body: `{ title?: string }`
  - Response: `{ ok, videoId, updated: { title: boolean } }`.
- `DELETE /api/videos/:id`
  - Header: `Idempotency-Key` required.
  - Behavior: soft delete (`deleted_at` set once).
  - Response: `{ ok, videoId, deletedAt }`.

Frontend surfaces:
- Library card action menu: `Rename`, `Delete`.
- Watch header action menu reuses same rename/delete operations.

Rollout/backfill strategy:
- Introduce delete as soft delete only.
- Exclude `deleted_at IS NOT NULL` from default library queries.

Risks:
- Accidental deletes.
- Race between rename and delete.

Rollback:
- Hide delete action in UI.
- Keep soft-deleted rows recoverable by DB operation if required.

### G3: Folder Model + Move Operations
Objective:
- Add foundational organization primitives with folders and move operation.

Acceptance criteria:
- User can create folders and move videos between folders.
- Library can filter by folder.
- Move operations are idempotent and observable.

DB changes/migrations:
- New table: `folders`
  - `id (uuid)`, `name`, `created_at`, `updated_at`, `deleted_at`.
- Add `videos.folder_id` nullable FK -> `folders.id`.
- Indexes:
  - `videos(folder_id, created_at desc)`,
  - `folders(name)` for basic lookup.

Endpoint contracts (planned):
- `GET /api/library/folders`
  - Read-only folder list.
- `POST /api/library/folders`
  - Header: `Idempotency-Key` required.
  - Body: `{ name: string }`.
- `POST /api/library/videos/:id/move`
  - Header: `Idempotency-Key` required.
  - Body: `{ targetFolderId: string | null }` (`null` => unfiled).

Frontend surfaces:
- Library sidebar/filter chips for folders.
- Card bulk/single move action.
- Folder creation modal/sheet.

Rollout/backfill strategy:
- Default all existing videos to `folder_id = null` (unfiled).
- Release folders as optional layer; unfiled remains first-class.

Risks:
- Folder sprawl / weak naming.
- Move UX complexity on mobile.

Rollback:
- Hide folder UI and keep all videos effectively unfiled.
- Preserve schema and data for forward re-enable.

### G4: Watch Layout Utilization Optimization
Objective:
- Optimize watch-page horizontal utilization and reduce scroll burden while preserving interaction reliability.

Acceptance criteria:
- Better horizontal usage at 100% zoom.
- Wider transcript utility when appropriate.
- Reduced vertical scrolling in common “watch + skim + jump” flow.
- Chapters placement evaluated and finalized against interaction telemetry/usability testing.

DB changes/migrations:
- None required.

Endpoint contracts (planned):
- None required if using existing status/read models.
- Optional future read-only view-preference endpoint is out-of-scope for MVP.

Frontend surfaces:
- `/video/:id` spatial composition tuning:
  - player/transcript widths,
  - summary/chapter density,
  - chapter placement A/B candidates (rail-only vs summary-first vs split).

Rollout/backfill strategy:
- UI-only rollout with feature flag `WATCH_LAYOUT_G4`.
- Compare against current layout with smoke and usability checks.

Risks:
- Over-optimization hurting smaller laptops.
- Regression in transcript active-line readability.

Rollback:
- Feature-flag fallback to F5 composition.

## MVP Recommendation (Smallest High-Value Slice)
Recommended first slice: `G1 + minimal G2(rename/delete)` without folders.

Why:
- Highest user-facing value quickly (global visibility + core management).
- Avoids folder model complexity while unblocking real productization.
- Keeps migrations and API surface small.

In scope for MVP:
- Global library read endpoints + compact card UI.
- Title rename and soft delete with idempotency.

Out of scope for MVP:
- Folder hierarchy, nested folders, drag-drop organizer.
- Bulk operations beyond simple single-item actions.
- Watch layout experimentation beyond minor adjustments.

## Sequencing Rationale
1. `G1` first to establish universal source of truth and remove local-session dependency.
2. `G2` second to add essential lifecycle controls (rename/delete) on top of stable read model.
3. `G3` third after base management is stable; folders add schema + UX complexity.
4. `G4` last to optimize watch spatial model once library and management flows are settled.

## G0 Acceptance Checklist
| ID | Check | Status |
|---|---|---|
| G0-1 | Phases G1..G4 defined with objective + acceptance criteria | done |
| G0-2 | Each phase includes DB changes, endpoint contracts, frontend impacts | done |
| G0-3 | Each phase includes rollout/backfill and risk/rollback | done |
| G0-4 | MVP recommendation includes explicit in-scope/out-of-scope | done |
| G0-5 | Contracts are marked planned, not implemented | done |

## G1 Acceptance Checklist
| ID | Check | Status |
|---|---|---|
| G1-1 | Read endpoint is side-effect free and DB-backed | done |
| G1-2 | Response includes id/title/thumbnail+result presence/status/date/duration | done |
| G1-3 | Pagination + newest-first sort available | done |
| G1-4 | Home primary block uses global library compact cards | done |
| G1-5 | Cross-session visibility validated | done |

## Backlog Notes (Captured, Not Implemented in G1)
- Reduce top vertical waste on watch page.
- Add simple round light/dark theme toggle button.
