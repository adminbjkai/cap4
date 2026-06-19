# Plan 004: Upgrade `apps/web` from Vite 5 to Vite 6/7 and re-enable the vitest bump

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 05737be..HEAD -- apps/web/package.json apps/web/vite.config.ts apps/web/vitest.config.ts pnpm-lock.yaml package.json`
> If these changed since this plan was written, compare against the "Current
> state" notes before proceeding.

## Status

- **Priority**: P3
- **Effort**: M (build-tool major; mostly config + verification, occasionally a plugin bump)
- **Risk**: MED (build tooling for the user-facing app; a broken build means a broken deploy — but fully caught by local build/test before any deploy)
- **Depends on**: Plan 001 (the `~4.0.18` vitest pin and the deferred-advisory note this plan removes)
- **Category**: dependencies / migration
- **Planned at**: commit `05737be`, 2026-06-19

## Why this matters

`apps/web` is pinned to **Vite 5** (`vite@^5.4.10`). Vite 5 has reached the end
of its security-fix window: `pnpm audit` reports high-severity `server.fs.deny`
bypass advisories against it with **no fix available in the 5.x line** (patched
only in `>=6.4.3`). Those advisories are dev-server-only — they do not run in
the nginx-served production build — which is why Plan 001 deliberately deferred
this and pinned `vitest` to `~4.0.18` (vitest 4.1 drops Vite-5 peer support).
This plan closes that loop: move the web app to a supported Vite major, then
restore the `vitest` bump so the last dev-tooling advisories (vitest, vite,
picomatch) clear and the CI `pnpm audit --prod` gate can be tightened. The win
is a fully-supported, advisory-free toolchain; the user-facing app behavior must
be **identical** — this is a build-tool swap, not a feature change.

## Current state

- `apps/web/package.json` (devDependencies):
  - `vite`: `^5.4.10`
  - `vitest`: `~4.0.18` (pinned by Plan 001 to stay Vite-5-compatible)
  - `@vitejs/plugin-react`: `^4.3.3`
  - `happy-dom`: `^20.8.9`, `tailwindcss`: `^3.4.14`, `postcss`: `^8.4.47`,
    `autoprefixer`: `^10.4.20`, `typescript`: `^5.6.3`
  - Also present: `@esbuild/linux-arm64`, `@rollup/rollup-linux-arm64-gnu`
    (explicit optional native deps — note the arch; the deploy host builds the
    web app, see `CLAUDE.md` deploy note).
- Build script: `apps/web/package.json` → `"build": "tsc -b && vite build"`.
- Test script: `"test": "vitest run --passWithNoTests"`.
- Vite config: look for `apps/web/vite.config.ts` (or `.js`) and any
  `vitest.config.ts` / a `test:` block inside the vite config — confirm which
  file holds the config before editing. (Read it first; do not assume.)
- Root `package.json` has a `pnpm.overrides` block (from Plan 001) pinning
  `fast-uri`/`fast-xml-parser`/`ws`/`flatted` — **leave those untouched**.
- `DECISIONS.md #16` documents the deferral this plan resolves — update it in
  Step 6.

**Repo conventions:** pnpm 9 workspace; caret ranges; the web app is built on
the deploy host and the `dist/` copied into the `cap4_web_dist` volume (it is
NOT rebuilt in-container). So a successful local `pnpm --filter @cap/web build`
is the real gate — it is exactly what the deploy runs.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Web build (the deploy-critical gate) | `pnpm --filter @cap/web build` | exit 0, emits `dist/` |
| Web tests | `pnpm --filter @cap/web test` | all pass (currently 36) |
| Web typecheck | `pnpm --filter @cap/web typecheck` | exit 0 |
| Web dev smoke | `pnpm --filter @cap/web dev` then open the printed URL | app loads, no console errors (Ctrl-C after) |
| Audit | `pnpm audit --audit-level=high` | residual shrinks (see Done) |
| Peer check | `pnpm install 2>&1 \| grep -i peer` | no vite/vitest peer warnings |

## Scope

**In scope:**
- `apps/web/package.json` (bump `vite`, restore `vitest`, bump
  `@vitejs/plugin-react` / native esbuild+rollup deps if required for the major)
- `apps/web/vite.config.ts` (or wherever the config lives) — only if the major
  requires a config change
- `pnpm-lock.yaml` (regenerated)
- `DECISIONS.md` (update entry #16)
- `.github/workflows/ci.yml` — ONLY the audit step, ONLY if Step 5 shows the
  audit is now fully clean (tighten `--prod --audit-level=high` → drop `--prod`)
- `plans/README.md` (status row)

**Out of scope:**
- Any application source under `apps/web/src/**` — if the Vite major requires a
  source change (e.g. an import-meta or env-var API change), that is a STOP
  condition, not a free-for-all refactor. Report it.
- The root `pnpm.overrides` block.
- The other apps (web-api/worker/media-server have no Vite).
- Tailwind/PostCSS majors — do not bump them here unless the Vite major hard-
  requires it (and if it does, STOP and report — that is a second migration).

## Git workflow

- Branch: `advisor/004-vite-major`.
- Conventional commit, e.g. `build(web): migrate Vite 5 -> 7, restore vitest 4.1`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Read the current Vite config and pick the target major

- Read `apps/web/vite.config.ts` (and `vitest.config.ts` if separate). Note the
  plugins used (`@vitejs/plugin-react`), any `server`, `build`, `resolve`,
  `define`, or `test` blocks.
- Choose the target: **Vite 7** (current latest) if `@vitejs/plugin-react` and
  `vitest@4.1` both support it; otherwise Vite 6. Verify support by checking the
  plugin's peer range (`npm view @vitejs/plugin-react peerDependencies`) and
  vitest's (`npm view vitest@4.1 peerDependencies`). Record which major you
  picked and why.

**Verify**: you can state the target Vite major and that `@vitejs/plugin-react`
+ `vitest@4.1` both list it in their peer ranges.

### Step 2: Bump the dependencies

In `apps/web/package.json`:
- `vite`: `^5.4.10` → `^7.0.0` (or `^6.0.0` if Step 1 chose 6)
- `vitest`: `~4.0.18` → `^4.1.0`
- `@vitejs/plugin-react`: bump to the version whose peer range includes the
  chosen Vite major (check `npm view @vitejs/plugin-react version`).
- If present and they block the resolve: bump `@esbuild/linux-arm64` and
  `@rollup/rollup-linux-arm64-gnu` to versions matching the Vite major's bundled
  esbuild/rollup (Vite 7 uses newer esbuild/rollup). If unsure, removing these
  two explicit optional deps and letting Vite pull its own is often cleaner —
  but only do that if the build fails with them pinned.

Then `pnpm install`.

**Verify**: `pnpm install` exits 0; `pnpm install 2>&1 | grep -i peer` shows no
vite/vitest peer warnings.

### Step 3: Build and test

- `pnpm --filter @cap/web typecheck` → exit 0.
- `pnpm --filter @cap/web build` → exit 0, emits `dist/` with hashed assets
  (this is the deploy-critical gate).
- `pnpm --filter @cap/web test` → all pass (expect the same count as before,
  currently 36).

If the build fails with a config error (e.g. a renamed option), apply the
**minimal** config change in `vite.config.ts` per the Vite migration guide. If
it fails inside `apps/web/src/**` (a source API change), STOP and report.

**Verify**: all three commands above pass.

### Step 4: Dev-server smoke (manual)

- Run `pnpm --filter @cap/web dev`, open the printed local URL in a browser.
- Confirm the app loads, the library page renders, and there are **no console
  errors**. Navigate to a video page (routing exercises `react-router-dom`).
- Ctrl-C to stop.

If a browser is unavailable in the executor environment, skip this and note it;
the `build` + `test` gates are the hard requirements.

**Verify**: app loads with no console errors, or a clear note that the manual
smoke was not runnable.

### Step 5: Re-audit and (if clean) tighten the CI gate

- `pnpm audit --audit-level=high --json` — the residual `vite`/`vitest` highs
  should now be gone. `picomatch` may remain (a separate transitive — note it).
- If `pnpm audit --audit-level=high` is now fully clean (no high/critical at
  all), change the `audit` job in `.github/workflows/ci.yml` from
  `pnpm audit --prod --audit-level=high` to `pnpm audit --audit-level=high`
  (gate the full tree, not just prod). If `picomatch` (or anything) still
  remains, leave the `--prod` gate as-is and note the residual.

**Verify**: `pnpm audit --audit-level=high` output recorded; CI gate change (if
any) is the only edit to `ci.yml`.

### Step 6: Update the decision log

Update `DECISIONS.md #16`: strike the "deferred vite 5→6 major / vitest pinned
to ~4.0.18" caveat and record that the web app is now on Vite `<major>` with
`vitest@4.1`, and what the final `pnpm audit` state is.

**Verify**: `grep -n "deferred" DECISIONS.md` no longer points at the vite
deferral (or the entry clearly marks it resolved).

## Test plan

No new application tests. The migration is proven by:
- `pnpm --filter @cap/web build` succeeding (identical to the deploy step).
- `pnpm --filter @cap/web test` staying green at the same count.
- The manual dev smoke (Step 4) confirming runtime parity.
- A reduced `pnpm audit` residual.

## Done criteria

- [ ] `apps/web` `vite` is `^6` or `^7`; `vitest` is `^4.1`.
- [ ] `pnpm install` clean, no vite/vitest peer warnings.
- [ ] `pnpm --filter @cap/web typecheck` / `build` / `test` all pass (test count
      unchanged).
- [ ] `pnpm audit --audit-level=high` no longer lists `vite` or `vitest`.
- [ ] No file under `apps/web/src/**` changed (build-tool only).
- [ ] `DECISIONS.md #16` updated.
- [ ] `plans/README.md` status row for 004 updated.

## STOP conditions

- The Vite major requires changes inside `apps/web/src/**` (source API break) —
  report what broke; don't refactor app code under cover of a build-tool bump.
- The build fails and the fix would need a Tailwind/PostCSS major too — that's a
  separate migration; STOP and report.
- `@vitejs/plugin-react` has no release supporting the chosen Vite major.
- Test count drops or any test fails after the bump.

## Maintenance notes

- After this lands, the deploy is the same host-build → `cap4_web_dist` volume
  copy → nginx reload (see `CLAUDE.md` deploy note); rebuild the web `dist/`
  from the new Vite before copying.
- Once Vite 5 is gone, the `pnpm.overrides` from Plan 001 are still needed for
  the backend transitives — do not remove them as part of this.
- Reviewer should scrutinize: zero `apps/web/src/**` changes, identical test
  count, and a successful `vite build` artifact list comparable to before.
