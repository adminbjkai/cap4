# Plan 001: Clear the critical + high runtime-reachable dependency vulnerabilities

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 05737be..HEAD -- package.json apps/web-api/package.json apps/worker/package.json apps/media-server/package.json apps/web/package.json pnpm-lock.yaml`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live files before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (dependency bumps can break build/tests; mitigated by typecheck + test + build gates below)
- **Depends on**: none
- **Category**: security / dependencies
- **Planned at**: commit `05737be`, 2026-06-19

## Why this matters

`pnpm audit` currently reports **1 critical + 15 high** advisories. The
runtime-reachable ones sit on the request path of a service that accepts
uploads and webhooks: a Fastify body-schema-validation bypass, two `fast-uri`
parsing flaws (path traversal / host confusion) pulled in by Fastify, a
`fast-xml-parser` entity-expansion DoS pulled in by the AWS S3 SDK, and a `ws`
memory-exhaustion DoS. The rest are dev/test-only tooling (vitest, vite,
happy-dom, picomatch, flatted) that never runs in the hardened production
stack. This plan bumps the cleanly-bumpable packages and pins patched
transitive versions via `pnpm.overrides`, so `pnpm audit --audit-level=high`
reports **no critical and no runtime-reachable high** advisories. Plan 002 then
adds a CI gate so this never silently regresses.

## Current state

- `package.json` (repo root) — pnpm workspace root. Declares
  `packageManager: "pnpm@9.12.3"`, devDeps include `eslint@^9.15.0`. **There is
  no `pnpm.overrides` block today** — you will add one.
- `apps/web-api/package.json` — uses `fastify@^5.8.1`,
  `@aws-sdk/client-s3@^3.997.0`, `vitest@^4.0.18`.
- `apps/media-server/package.json` — uses `fastify@^5.8.1`,
  `@aws-sdk/client-s3@^3.997.0`, `vitest@^4.0.18`.
- `apps/worker/package.json` — uses `@aws-sdk/client-s3@^3.997.0`,
  `vitest@^4.0.18`.
- `apps/web/package.json` — uses `react-router-dom@^6.28.0`, `vite@^5.4.10`,
  `vitest@^4.0.18`. **Note: `vite` is a *direct major-5* dependency here.**

Exact patched targets, from `pnpm audit --audit-level=high --json` at this
commit:

| Package | Severity | Vulnerable | Patched at | Reached via |
|---|---|---|---|---|
| `fastify` | high | `<=5.8.4` | `>=5.8.5` | direct (web-api, media-server) |
| `fast-uri` | high | `<=3.1.1` | `>=3.1.2` | transitive (fastify) |
| `fast-xml-parser` | high | `<5.5.6` | `>=5.7.0` (take latest) | transitive (`@aws-sdk/*`) |
| `ws` | high | `<8.21.0` | `>=8.21.0` | transitive |
| `vitest` | **critical** | `>=4.0.0 <4.1.0` | `>=4.1.0` | direct (all four apps) |
| `flatted` | high | `<=3.4.1` | `>=3.4.2` | transitive (eslint → file-entry-cache) |
| `react-router` | moderate | `<6.30.4` | `>=6.30.4` | transitive (`react-router-dom`) |
| `vite` | high | `<=6.4.2` | `>=6.4.3` | **direct major-5 in apps/web — DEFER, see Step 5** |
| `happy-dom`, `picomatch`, `esbuild`, `postcss`, `js-yaml`, `brace-expansion`, `@babel/core` | high/mod/low | various | various | dev/test transitives — DEFER, see Step 5 |

**Repo conventions:**
- Package manager is **pnpm 9** (`packageManager: "pnpm@9.12.3"`). Use `pnpm`,
  never `npm`/`yarn`. Overrides go under a top-level `"pnpm": { "overrides": {…} }`
  key in the **root** `package.json` (pnpm reads overrides only from the
  workspace root).
- Version ranges in this repo use caret form (`^5.8.1`). Match that style when
  editing a direct dependency's version.
- **Do not** add `@anthropic-ai/sdk`, any `ANTHROPIC_API_KEY`, or any new model
  dependency. Claude usage in this repo is subscription/OAuth CLI only. If a bump
  somehow tries to pull an Anthropic SDK, that is a STOP condition.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0, lockfile updates |
| Audit (high+) | `pnpm audit --audit-level=high` | see Done criteria for the acceptable residual |
| Audit JSON | `pnpm audit --audit-level=high --json` | machine-readable list for checking residuals |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Tests | `pnpm test` | all pass (web + worker suites) |
| Build | `pnpm build` | exit 0 for every package/app |
| Why a dep | `pnpm why <pkg>` | shows the dependency path |

## Scope

**In scope** (the only files you should modify):
- `package.json` (root — add `pnpm.overrides`, bump `eslint`)
- `apps/web-api/package.json` (bump `fastify`, `@aws-sdk/client-s3`, `vitest`)
- `apps/media-server/package.json` (bump `fastify`, `@aws-sdk/client-s3`, `vitest`)
- `apps/worker/package.json` (bump `@aws-sdk/client-s3`, `vitest`)
- `apps/web/package.json` (bump `react-router-dom`, `vitest`)
- `pnpm-lock.yaml` (regenerated by `pnpm install` — do not hand-edit)

**Out of scope** (do NOT touch, even though they look related):
- `apps/web`'s **`vite` major upgrade** (5 → 6/7). It is a breaking build-tool
  change and the advisory is dev-server-only (the production stack serves
  pre-built static assets through nginx, never the vite dev server). Deferring
  it is a deliberate decision — see Step 5. Do not bump `vite` in this plan.
- Any application source code (`*.ts`, `*.tsx`). This plan is dependency-only.
  If a bump *requires* a source change to typecheck/build, that is a STOP
  condition — report it; do not start editing app code.
- `.github/workflows/*` — the CI audit gate is Plan 002.

## Git workflow

- Branch off the current branch: `advisor/001-dep-vuln-remediation`.
- One commit for the whole plan is fine; message style is conventional commits
  (see `git log --oneline`: e.g. `fix(deps): bump vulnerable packages, pin patched transitives`).
- End the commit message body with the repo's existing trailer convention if one
  is visible in `git log`; otherwise a plain message is fine.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bump the direct dependencies

Edit the version ranges (keep caret style):

- `apps/web-api/package.json`: `fastify` → `^5.8.5`,
  `@aws-sdk/client-s3` → `^3.999.0` (or the latest published 3.x — see note),
  `vitest` → `^4.1.0`.
- `apps/media-server/package.json`: `fastify` → `^5.8.5`,
  `@aws-sdk/client-s3` → `^3.999.0`, `vitest` → `^4.1.0`.
- `apps/worker/package.json`: `@aws-sdk/client-s3` → `^3.999.0`,
  `vitest` → `^4.1.0`.
- `apps/web/package.json`: `react-router-dom` → `^6.30.4`, `vitest` → `^4.1.0`.
- `package.json` (root): `eslint` → `^9.39.0` (or latest 9.x).

Note on `@aws-sdk/client-s3`: you cannot see the exact latest patch from here.
Set it to a version `>= 3.999.0`; after `pnpm install` in Step 3, run
`pnpm why fast-xml-parser` and confirm the resolved `fast-xml-parser` is
`>= 5.7.0`. If the AWS SDK bump alone does not lift `fast-xml-parser`, the
override in Step 2 will. Do **not** jump to AWS SDK v4 if one exists — stay on
the latest **3.x**.

**Verify**: `git diff package.json apps/*/package.json` shows exactly the
version-string changes above and nothing else.

### Step 2: Add `pnpm.overrides` for stubborn transitive packages

In the **root** `package.json`, add a top-level block (sibling of
`"devDependencies"`). Use exactly these — they are same-major or additive and
safe:

```json
"pnpm": {
  "overrides": {
    "fast-uri": ">=3.1.2",
    "fast-xml-parser": ">=5.7.0",
    "ws": ">=8.21.0",
    "flatted": ">=3.4.2"
  }
}
```

Do **not** add overrides for `picomatch`, `esbuild`, `postcss`, `js-yaml`, or
`brace-expansion` — those span major versions across different consumers and a
blanket override risks breaking a consumer pinned to an older major. They are
dev/test-only and handled in Step 5.

**Verify**: `cat package.json` shows the `pnpm.overrides` block with the four
entries above.

### Step 3: Reinstall and confirm resolution

Run `pnpm install`.

**Verify**:
- `pnpm install` exits 0.
- `pnpm why fast-uri` shows resolved version `>= 3.1.2`.
- `pnpm why fast-xml-parser` shows resolved version `>= 5.7.0`.
- `pnpm why ws` shows resolved version `>= 8.21.0`.
- `pnpm why flatted` shows resolved version `>= 3.4.2`.

### Step 4: Verify the build still works

Run, in order:

- `pnpm typecheck` → exit 0, no errors.
- `pnpm test` → all tests pass (the web + worker suites; web-api/media-server
  `test` scripts pass with no test files — that is expected).
- `pnpm build` → exit 0 for every package and app.

**If `pnpm test` or `pnpm build` fails** because of the `fastify@5.8.5`,
`vitest@4.1`, `react-router-dom@6.30.4`, or AWS SDK bump: this is a STOP
condition (see below). Do not patch app source to work around it — report the
failing output instead.

### Step 5: Document the deliberately-deferred residual advisories

After Steps 1–4, run `pnpm audit --audit-level=high` and capture the residual
list. The expected residual is **dev/test-only**: `vite` (the direct major-5 in
`apps/web`, plus its transitives) and possibly `happy-dom`, `picomatch`,
`esbuild`. These do not run in the production stack.

Append a short note to `DECISIONS.md` (this is the repo's decision log; open it
and match its numbered-entry style) recording: which advisories remain, that
they are dev/test-tooling only (not reachable in the nginx-served production
build), and that the `vite` 5→6/7 major upgrade is deferred as separate work.
Keep it to one concise entry.

**Verify**: `pnpm audit --audit-level=high --json | python3 -c "import json,sys; d=json.load(sys.stdin); crit=[a for a in d['advisories'].values() if a['severity']=='critical']; print('criticals:', len(crit))"`
→ prints `criticals: 0`.

## Test plan

This plan writes no new tests — it is a dependency remediation. The existing
suites are the regression guard:

- `pnpm test` must stay green (proves the bumped libraries didn't break the
  web/worker unit suites).
- `pnpm build` must stay green (proves `vite`/`tsc` still compile every app with
  the new `react-router-dom` and AWS SDK).
- `pnpm typecheck` must stay green (proves the Fastify 5.8.5 and AWS SDK types
  are still compatible with the route/worker code).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm install` exits 0 and `pnpm-lock.yaml` is updated.
- [ ] `pnpm audit --audit-level=high` reports **0 critical** advisories.
- [ ] No remaining **high** advisory is reachable at runtime: specifically
      `fastify`, `fast-uri`, `fast-xml-parser`, and `ws` no longer appear in
      `pnpm audit --audit-level=high` output. (`vite`/dev-tooling highs may
      remain — they are documented in Step 5.)
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] `git status` shows only the in-scope files changed (the five
      `package.json` files, `pnpm-lock.yaml`, and `DECISIONS.md`).
- [ ] No `@anthropic-ai/sdk` or `ANTHROPIC_API_KEY` was introduced
      (`grep -rn "anthropic" package.json apps/*/package.json` → no new SDK dep).
- [ ] `plans/README.md` status row for 001 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- The `package.json` files don't match the "Current state" versions (codebase
  drifted since this plan was written).
- `pnpm typecheck`, `pnpm test`, or `pnpm build` fails after a bump and the fix
  would require editing application source (`*.ts`/`*.tsx`) — report the failing
  output and which bump caused it; let the owner decide whether to pin back or
  adapt code.
- Lifting `fast-xml-parser`/`fast-uri` to the patched version would require an
  AWS SDK or Fastify **major** version jump (v4 / v6).
- Any bump pulls in `@anthropic-ai/sdk` or an Anthropic-API code path.
- A verification fails twice after a reasonable retry.

## Maintenance notes

- The deferred `vite` 5→6/7 major upgrade is real follow-up work; track it
  separately. When it's done, the `apps/web` vite advisories clear and the
  Step-5 `DECISIONS.md` note should be updated.
- The `pnpm.overrides` block forces transitive versions repo-wide. When you next
  bump Fastify or the AWS SDK, re-check whether the overrides are still needed
  (`pnpm why fast-uri` / `pnpm why fast-xml-parser`); remove an override once the
  parent ships the patched version natively, to avoid silently pinning an old
  range.
- Reviewer should scrutinize: that no app source changed, that the AWS SDK
  stayed on 3.x, and that no Anthropic API/SDK path was introduced.
