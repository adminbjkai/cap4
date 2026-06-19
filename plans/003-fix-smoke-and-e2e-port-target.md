# Plan 003: Point `make smoke`, the e2e config, and the README at the real host port

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 05737be..HEAD -- Makefile README.md apps/web-api/playwright.config.ts docker/nginx/default.conf docker-compose.yml .env.example`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live files before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (dev/ops tooling + docs; one small nginx location addition)
- **Depends on**: none
- **Category**: dx / docs
- **Planned at**: commit `05737be`, 2026-06-19

## Why this matters

The production/hardened Docker stack does **not** expose the web-api container on
the host. The only host-facing port is the `web-internal` nginx container, bound
to `127.0.0.1:${PORT}` (`PORT=8007` in `.env.example`); nginx reverse-proxies
`/api`, `/health`, and `/cap4/` to `web-api:3000` internally. But `make smoke`
curls `http://localhost:3000/health` **and** `http://localhost:3000/ready`, the
Playwright e2e config defaults its base URL to `http://localhost:3000`, and the
README lists `API: http://localhost:3000` (and an inconsistent `App:
http://localhost:8022`). Against the current stack every one of those targets is
unreachable, so `make smoke` fails and gives false-negative signal during
deploys, and a fresh contributor following the README hits connection-refused.
This is already logged as a known issue in the owner's audit notes. The fix is
to target the nginx host port, add the one missing nginx route so readiness is
reachable, and correct the README.

## Current state

- `Makefile:30-36` — the `smoke` target:
  ```make
  smoke:
  	@echo "--- /health ---" && curl -fsS http://localhost:3000/health
  	@echo "--- /ready ---"  && curl -fsS http://localhost:3000/ready
  	@echo "\nSmoke passed."
  ```
  The comment above it (lines 31-32) already notes `/debug/smoke` is non-prod
  only and that `/health`+`/ready` are the prod liveness checks. The Makefile
  has a `PROJECT ?= cap4` variable at the top (line 5) — follow that pattern for
  a new `PORT` variable.
- `docker-compose.yml` — the `web-api` service has **no `ports:` mapping**
  (host cannot reach `:3000`). The only published port is on `web-internal`:
  `ports: ["127.0.0.1:${PORT}:80"]` (around line 131). `web-api` runs with
  `NODE_ENV: production`.
- `docker/nginx/default.conf` — proxies three things to web-api/minio:
  `location /api` → `web-api:3000`, `location /health` → `web-api:3000/health`,
  `location /cap4/` → `minio:9000`. **There is no `location /ready`.** So even
  via the correct host port, `/ready` is currently a 404 through nginx.
- `.env.example:12` — `PORT=8007` (the host port nginx binds).
- `README.md:43-46` — lists `App: http://localhost:8022`, `API:
  http://localhost:3000`, plus MinIO ports. The `8022` and `3000` here are both
  wrong for the hardened stack. README lines 61/68/79/84 also use
  `http://localhost:3000/api/...` in an example curl sequence.
- `apps/web-api/playwright.config.ts` — `baseURL: process.env.E2E_API_URL ||
  'http://localhost:3000'` (line ~49), a doc comment "E2E_API_URL — default
  http://localhost:3000" (line ~22), and a `webServer` block with `port: 3000`
  (line ~70-73). **The `webServer` block means the e2e suite spawns its own
  web-api on port 3000 for local runs** — so its `3000` default may be correct
  for that mode and must NOT be blindly changed. See Step 4.

**Repo conventions:** Makefile uses `VAR ?= default` overridable variables
(see `PROJECT ?= cap4`). Match that. The hardened-stack deploy mechanism and
the fact that containers have no host port maps are described in `CLAUDE.md`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inspect Makefile var expansion | `make -n smoke` | prints the curl commands with the resolved port |
| Validate nginx config syntax (if docker available) | `docker run --rm -v "$PWD/docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t` | `syntax is ok` / `test is successful` |
| Grep for stale port refs | `grep -rn "localhost:3000\|localhost:8022" Makefile README.md` | only intended matches remain |

If Docker is unavailable in the executor environment, skip the live `nginx -t`
and the live `make smoke` run; rely on the config diff + the grep checks. Note
in your report that the live smoke run was not executed.

## Scope

**In scope** (the only files you should modify):
- `Makefile` (parameterize `smoke` port, target nginx host port)
- `docker/nginx/default.conf` (add a `location /ready` proxy)
- `README.md` (correct the port references)
- `apps/web-api/playwright.config.ts` (ONLY if Step 4's investigation says the
  default is wrong — otherwise leave it)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `docker-compose.yml` — do not add a `web-api` host port map; the hardened
  no-host-port posture is intentional (per the owner's audit notes). The fix is
  to use the nginx port, not to re-expose web-api.
- The `web-api` route handlers — do not change what `/health` or `/ready`
  return; this plan only changes how they're reached.
- Any other workflow/CI file (that's Plan 002).

## Git workflow

- Branch: `advisor/003-smoke-port-fix`.
- Conventional-commit message, e.g.
  `fix(dx): point smoke/e2e/docs at the nginx host port, add /ready proxy`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a `PORT` variable and fix the `smoke` target

In `Makefile`, add a `PORT ?= 8007` variable near the existing `PROJECT ?= cap4`
(line 5), with a one-line comment that it must match `PORT` in `.env`
(host port nginx binds). Then rewrite the `smoke` recipe to curl the nginx host
port instead of `:3000`:

```make
smoke:
	@echo "--- /health ---" && curl -fsS http://localhost:$(PORT)/health
	@echo "--- /ready ---"  && curl -fsS http://localhost:$(PORT)/ready
	@echo "\nSmoke passed."
```

**Verify**: `make -n smoke` prints curl commands using `http://localhost:8007/...`
(or whatever `PORT` resolves to), and no longer contains `localhost:3000`.

### Step 2: Add the missing `/ready` proxy to nginx

In `docker/nginx/default.conf`, add a `location /ready` block mirroring the
existing `/health` block (after it, lines ~34-37):

```nginx
    # Proxy /ready to web-api
    location /ready {
        proxy_pass http://web-api:3000/ready;
        proxy_set_header Host $host;
    }
```

This makes the readiness endpoint reachable through the host port so the
two-line smoke check works. (Without it, `/ready` 404s through nginx even though
the route exists on web-api.)

**Verify**:
- `grep -c "location /ready" docker/nginx/default.conf` → `1`.
- If Docker is available:
  `docker run --rm -v "$PWD/docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t`
  → prints `syntax is ok` and `test is successful`.

### Step 3: Correct the README port references

In `README.md`:
- Fix the access list (lines ~43-46): the app + API are reached at
  `http://localhost:8007` (the nginx `PORT`), not `8022`/`3000`. State that
  `:3000`/`:3100` are **container-internal** ports not published to the host,
  and that the host port is `PORT` from `.env` (default `8007`).
- Fix the example curl sequence (lines ~61/68/79/84) to use
  `http://localhost:8007/api/...` (or a `${PORT}`-style placeholder with a note),
  not `:3000`.

Keep edits minimal and factual — do not restructure the README.

**Verify**: `grep -n "localhost:3000\|localhost:8022" README.md` → no matches
(every stale reference replaced).

### Step 4: Decide on the Playwright e2e default (investigate first)

The e2e config has BOTH a `baseURL` default of `http://localhost:3000` AND a
`webServer` block with `port: 3000`. Determine which scenario the suite is built
for:

- Read `apps/web-api/playwright.config.ts` fully, including the `webServer`
  block (what `command` it runs).
- If `webServer.command` spawns a local web-api on port 3000 (e.g. `pnpm start`
  / `pnpm dev`), then **`baseURL: 'http://localhost:3000'` is correct for that
  self-hosted mode** — leave it unchanged and only update the stale doc comment
  on line ~22 if it's misleading. Do NOT change the default.
- If the suite is instead meant to run against the already-running Docker stack
  (no `webServer`, or `webServer` is disabled in CI), then change the default to
  read the nginx port:
  `baseURL: process.env.E2E_API_URL || 'http://localhost:8007'`
  and update the doc comment accordingly.

When unsure which mode is intended, **do not guess** — leave the file unchanged
and report the ambiguity (this is a STOP-soft: the rest of the plan still
stands).

**Verify**: either `apps/web-api/playwright.config.ts` is unchanged (self-hosted
mode confirmed), or its `baseURL` default now points at the nginx port and
`git diff` shows only that line + the comment.

## Test plan

No application tests change. Verification is the per-step grep/`make -n`/`nginx -t`
checks above. If Docker is available, a live end-to-end confirmation:

1. `make up` (brings the stack up), wait for health.
2. `make smoke` → prints `/health` and `/ready` bodies and `Smoke passed.`
   with exit 0.

If Docker is unavailable, state in the report that the live smoke run was not
performed and that verification rested on the static checks.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `make -n smoke` shows curls against `http://localhost:$(PORT)/...`, not
      `:3000`.
- [ ] `Makefile` defines `PORT ?= 8007`.
- [ ] `docker/nginx/default.conf` contains exactly one `location /ready` block
      proxying to `web-api:3000/ready`.
- [ ] `grep -n "localhost:3000\|localhost:8022" README.md` returns no matches.
- [ ] `apps/web-api/playwright.config.ts` is either unchanged or its `baseURL`
      default points at the nginx host port (per Step 4) — never left in a
      half-edited state.
- [ ] `docker-compose.yml` is unchanged (`git status`).
- [ ] No web-api route handler was modified.
- [ ] `plans/README.md` status row for 003 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- The live files don't match the "Current state" excerpts (drift).
- The actual host `PORT` in the deployed environment is clearly not `8007`
  (e.g. `.env` or `CLAUDE.md` says otherwise) and you can't determine the right
  default — report it and let the owner set the default.
- Step 4's investigation can't conclusively tell you whether e2e is self-hosted
  or stack-targeted — leave the config untouched and report.
- `nginx -t` fails on the edited config.

## Maintenance notes

- If the host `PORT` is ever changed in `.env`, the `Makefile` default and the
  README references should be updated to match (or always invoke
  `make PORT=<n> smoke`).
- If web-api adds new top-level non-`/api` health/diagnostic routes that ops
  needs to reach from the host, they each need a matching nginx `location`
  block — the proxy is allow-list, not catch-all.
- Reviewer should scrutinize: that `docker-compose.yml` did NOT gain a web-api
  host port map (the no-host-port hardening must stay), and that the nginx
  `/ready` block exactly mirrors `/health`.
