# Contributing to cap4

This repository is a pnpm workspace with a React frontend, a Fastify API, a background worker, and a media-server.

## Local Workflow

```bash
pnpm install
cp .env.example .env
docker compose up -d
make smoke
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Use `pnpm test:e2e` for the web-api Playwright suite when the local stack is running. The operator-facing smoke check is `make smoke`.

## Repo Layout

```text
apps/web          React frontend
apps/web-api      Fastify HTTP API
apps/worker       Background job runner
apps/media-server FFmpeg wrapper (worker calls POST /process)
packages/*        Shared config, DB, and logger packages
docs/             Current documentation
db/migrations     Schema source of truth
```

## Contribution Rules

- Keep docs aligned with code and migrations.
- Prefer small, reviewable commits.
- Preserve idempotency and monotonic state guarantees when touching API or worker flows.
- Add or update tests when behavior changes.
- Do not commit generated artifacts.

## Verification

Before opening a PR or handing work off, run:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Run focused package checks as needed:

```bash
pnpm --filter @cap/web test
pnpm --filter @cap/worker test
pnpm --filter @cap/web-api test:e2e
```

## Documentation

Documentation lives in `docs/` with flat naming:

- `README.md`: onboarding and quick start
- `docs/architecture.md`: system behavior and service boundaries
- `docs/api.md`: HTTP endpoints and webhook contract
- `docs/database.md`: schema and migrations
- `docs/environment.md`: environment variable reference
- `docs/local-dev.md`: local development setup
- `docs/deployment.md`: production deployment
- `docs/troubleshooting.md`: common issues and fixes
- `docs/design-system.md`: UI tokens and components
- `docs/tech-stack.md`: languages, frameworks, versions
- `docs/agents.md`: AI agent conventions
- `docs/archive/*`: historical planning docs only

Historical plans are not authoritative unless they are explicitly linked from the current docs.

When a route shape, env var, migration, or service contract changes, update the matching doc in the same change.

## Maintainers

Current maintainer:

- `@adminbjkai`
