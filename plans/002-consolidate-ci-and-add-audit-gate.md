# Plan 002: Consolidate the two CI workflows into one and add a `pnpm audit` gate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 05737be..HEAD -- .github/workflows/ package.json`
> If any workflow file or `package.json` changed since this plan was written,
> compare the "Current state" excerpts against the live files before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (CI config only; no runtime or source impact)
- **Depends on**: **Plan 001** — the new audit gate fails until 001 has cleared
  the critical/high advisories. Do 001 first.
- **Category**: dx
- **Planned at**: commit `05737be`, 2026-06-19

## Why this matters

The repo has **two overlapping CI workflows that have drifted**:
`.github/workflows/ci.yml` (jobs: `lint-and-typecheck`, `test`, `build`) and
`.github/workflows/test.yml` (jobs: `typecheck`, `lint`, `test`). They run the
same checks twice on every push/PR, wasting CI minutes, and they disagree on
tooling: `ci.yml` pins **pnpm 8** via `pnpm/action-setup@v2`, while `test.yml`
uses **pnpm 9** via `@v4` — yet `package.json` declares `packageManager:
"pnpm@9.12.3"`. Running CI on pnpm 8 against a pnpm-9 lockfile risks spurious
warnings and "works on my machine" divergence. There is also **no security
gate**: `pnpm audit` never runs in CI, which is exactly how the backlog of
advisories that Plan 001 fixes built up unnoticed. This plan collapses the two
files into one correct workflow on pnpm 9 and adds a non-blocking-then-blocking
`pnpm audit` step so regressions surface on every PR.

## Current state

Two workflow files exist and overlap:

- `.github/workflows/ci.yml` — three jobs:
  - `lint-and-typecheck`: `pnpm/action-setup@v2` `version: 8`, manual pnpm-store
    cache, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`.
  - `test`: a `postgres:15-alpine` service, runs `pnpm db:migrate` then
    `pnpm test` with `DATABASE_URL=postgres://cap4:cap4_test@localhost:5432/cap4_test`.
  - `build`: `needs: [lint-and-typecheck]`, runs `pnpm build`.
  - All three use `pnpm/action-setup@v2` with `version: 8`.
- `.github/workflows/test.yml` — three jobs (`typecheck`, `lint`, `test`), each
  `pnpm/action-setup@v4` `version: 9`, `actions/setup-node@v4` with
  `cache: pnpm`. Its `test` job runs `pnpm test` with **no** database service.
- `.github/workflows/build.yml` — a separate Docker-image build
  (`docker/build-push-action`). **Leave this file alone** — it is not part of
  the lint/typecheck/test overlap.
- `package.json:6` — `"packageManager": "pnpm@9.12.3"`.

Note the one capability that lives **only** in `ci.yml`: the `test` job's
Postgres service + `pnpm db:migrate` step. The worker test suite may rely on a
database; the consolidated workflow must keep that service. `test.yml`'s
test job lacks it, so it is the weaker of the two and should not be the one you
keep as-is.

The `db:migrate` script is `docker compose run --rm migrate` (`package.json`).
**Confirm whether `pnpm db:migrate` actually works in CI** — `ci.yml` invokes it
against the service Postgres, but `db:migrate` shells out to `docker compose`,
which may not be the intended runner inside the GitHub `services:` model. Verify
during Step 2; if it's a no-op or fails, that's noted as a STOP/escalate point.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Validate YAML locally | `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/ci.yml` | exit 0, no exception |
| Audit (high+) | `pnpm audit --audit-level=high` | exit 0 after Plan 001 (or only deferred dev advisories) |
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |

You cannot run GitHub Actions locally; verification here is YAML validity + the
underlying commands passing locally + a careful diff review.

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/ci.yml` (rewrite into the single consolidated workflow)
- `.github/workflows/test.yml` (delete)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `.github/workflows/build.yml` — separate Docker-build pipeline, unrelated.
- `package.json` scripts — do not change `db:migrate`, `test`, etc. (Plan 001
  already edited `package.json`; this plan must not.)
- Any application source.

## Git workflow

- Branch: `advisor/002-ci-consolidation` (or stack on the 001 branch if the
  operator asked for a single PR).
- Conventional-commit message, e.g.
  `ci: consolidate workflows onto pnpm 9 and add pnpm audit gate`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Delete the redundant `test.yml`

Remove `.github/workflows/test.yml` entirely. Its checks (typecheck, lint, test)
are absorbed into the consolidated `ci.yml` below, and its `test` job is the
weaker one (no Postgres service).

**Verify**: `test -f .github/workflows/test.yml && echo EXISTS || echo GONE`
→ prints `GONE`.

### Step 2: Rewrite `ci.yml` as the single source of truth on pnpm 9

Rewrite `.github/workflows/ci.yml` so that:

- Every job uses `pnpm/action-setup@v4` with `version: 9` and
  `actions/setup-node@v4` with `node-version: '20'` and `cache: pnpm` (drop the
  hand-rolled `pnpm store path` cache steps — `setup-node`'s `cache: pnpm`
  replaces them).
- Keep these jobs:
  - **`lint-and-typecheck`** — `pnpm install --frozen-lockfile`, then
    `pnpm lint`, then `pnpm typecheck`.
  - **`test`** — keep the `postgres:15-alpine` service block and the
    `DATABASE_URL=postgres://cap4:cap4_test@localhost:5432/cap4_test` env exactly
    as in the current `ci.yml`, run `pnpm db:migrate` then `pnpm test`.
  - **`build`** — `needs: [lint-and-typecheck]`, `pnpm build`.
  - **`audit`** (NEW, see Step 3).
- Preserve the existing `on:` triggers (push + pull_request to `main`/`master`)
  and the `concurrency` block from the current `ci.yml`.

Use `actions/checkout@v4` (already in use). Match the existing indentation/style.

**Verify**:
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
  → exit 0 (valid YAML).
- `grep -c "action-setup@v2" .github/workflows/ci.yml` → `0`.
- `grep -c "version: 8" .github/workflows/ci.yml` → `0`.
- `grep -c "postgres:15-alpine" .github/workflows/ci.yml` → `1` (the test
  service was preserved).

### Step 3: Add the `pnpm audit` security gate

Add a new `audit` job to `ci.yml`:

```yaml
  audit:
    name: Security Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Audit (fail on high or critical)
        run: pnpm audit --audit-level=high
```

**Important interaction with Plan 001:** this job runs `pnpm audit
--audit-level=high` with no `|| true`, so it **fails the build on any high or
critical advisory**. That is only safe after Plan 001 has cleared the
runtime-reachable ones. If Plan 001 left documented dev-only `vite`/`happy-dom`
highs unresolved (per its Step 5), this gate will red on them too. To avoid a
permanently-red pipeline, do ONE of the following and note which in the commit
message:

- **Preferred**: if `pnpm audit --audit-level=high` is fully clean locally after
  Plan 001, use the strict step above as-is.
- **If documented dev-only highs remain**: change the audit step to
  `pnpm audit --audit-level=critical` (so it blocks only on critical, which
  Plan 001 fully clears) and add a comment in the YAML pointing at the
  `DECISIONS.md` entry that lists the accepted dev-only highs. Do **not** add
  `|| true` — a gate that never fails is not a gate.

Decide based on the **actual** local `pnpm audit` result after Plan 001, not on
assumption.

**Verify**:
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
  → exit 0.
- `pnpm audit --audit-level=high; echo "exit=$?"` locally — if `exit=0`, the
  strict gate is correct; if non-zero, confirm the only remaining advisories are
  the dev-only ones documented by Plan 001 and use the `--audit-level=critical`
  variant.

### Step 4: Sanity-check the underlying commands locally

Confirm the commands the workflow invokes all succeed on this machine:

- `pnpm install --frozen-lockfile` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm typecheck` → exit 0.
- `pnpm test` → all pass.
- `pnpm build` → exit 0.

(You cannot run `pnpm db:migrate` here unless Docker + compose are available;
if it is not runnable locally, note that the CI Postgres-service path is
unverifiable locally and rely on the diff review — do not delete the migrate
step.)

## Test plan

No application tests change. Verification is:
- YAML validity of the single `ci.yml` (Step 2/3 verify commands).
- The underlying `pnpm` commands pass locally (Step 4).
- A human/reviewer reads the final `ci.yml` diff to confirm job parity (lint,
  typecheck, test-with-postgres, build, audit) and that pnpm 9 is used
  everywhere.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/test.yml` no longer exists.
- [ ] `.github/workflows/ci.yml` is valid YAML
      (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` exits 0).
- [ ] `grep -n "action-setup@v2\|version: 8" .github/workflows/ci.yml` returns
      nothing (no pnpm-8 anywhere).
- [ ] `ci.yml` contains an `audit` job that runs `pnpm audit` with
      `--audit-level=high` (or `--audit-level=critical` per Step 3) and **no**
      `|| true`.
- [ ] `ci.yml` still contains the `postgres:15-alpine` service and the
      `pnpm db:migrate` step in its `test` job.
- [ ] `.github/workflows/build.yml` is unchanged (`git status` shows it untouched).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally.
- [ ] `plans/README.md` status row for 002 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- The current `ci.yml`/`test.yml` don't match the "Current state" description
  (drift since this plan was written).
- Plan 001 is not yet merged/applied (the audit gate would red the pipeline on
  the unfixed advisories) — confirm 001 is done first.
- `pnpm db:migrate` turns out to be broken or a no-op in the GitHub `services:`
  model and you'd need to redesign the migration step — report it; do not invent
  a new migration mechanism here.
- You're unsure whether to use `--audit-level=high` vs `--audit-level=critical`
  because the local audit residual is ambiguous — report the residual list and
  let the owner choose.

## Maintenance notes

- Single workflow now owns lint/typecheck/test/build/audit. If a future change
  needs a new check, add a job here — do not recreate a second overlapping
  workflow.
- The audit gate will start failing the day a new high/critical advisory lands
  in a dependency. That is intended; the fix is to bump the dep (à la Plan 001),
  not to weaken the gate.
- If the `vite` major upgrade (deferred by Plan 001) later lands and clears the
  dev-only highs, tighten the audit step back to `--audit-level=high` if it was
  set to `critical`.
- Reviewer should scrutinize: pnpm-9 everywhere, the Postgres service preserved,
  `build.yml` untouched, and that the audit step has no `|| true` escape.
