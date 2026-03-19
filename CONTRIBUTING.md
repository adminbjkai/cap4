# Contributing to cap4

This repository is a pnpm workspace with a React frontend, a Fastify API, a background worker, and a media-server.

## Local Workflow

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Use `pnpm test:e2e` for the web-api Playwright suite when the local stack is running.

## Repo Layout

```text
apps/web          React frontend
apps/web-api      Fastify HTTP API
apps/worker       Background job runner
apps/media-server FFmpeg wrapper / webhook emitter
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

Documentation is split by topic:

- `README.md`: onboarding and quick start
- `ARCHITECTURE.md`: current system behavior and service boundaries
- `docs/api/*`: HTTP and webhook contracts
- `docs/ops/*`: environment, local dev, deployment, troubleshooting
- `docs/archive/*`: historical planning docs only

Historical plans are not authoritative unless they are explicitly linked from the current docs.

## Maintainers

Current maintainer:

- `@adminbjkai`
