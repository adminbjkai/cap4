# 0702claudeo — Full audit of cap4 (2026-07-02)

Read-only audit run: five independent fresh-context review agents (backend, worker/media/doc-pipeline, frontend, infra/nginx/CI/deploy, live runtime) + synthesis. **No source or config changes were made in this run.**

| File | What it is |
|---|---|
| `REPORT.md` | The main review: overall grade (B+; A- code / C+ ops), what's impressive, all confirmed issues ranked, design-hindsight critiques |
| `ACTION-PLAN.md` | Prioritized, self-contained execution plan (P0 → P3) with files, effort estimates, deploy notes |
| `lanes/backend-api.md` | Lane brief: web-api routes + shared packages (grade B+) |
| `lanes/worker-media-doc.md` | Lane brief: worker, media-server, doc pipeline (grade B+) |
| `lanes/frontend.md` | Lane brief: React/Vite app (grade B+) |
| `lanes/infra-nginx-ci.md` | Lane brief: two-layer nginx, Docker, CI, deploy mechanics (grade B-) |
| `lanes/runtime-health.md` | Lane brief: live prod stack — logs, DB, cron, disk (verdict: degraded, not broken) |

## The two things to know immediately

1. **P0-1:** The worker's hourly maintenance sweep has silently failed for ~100 days (`webhook_events.created_at` should be `received_at`, `apps/worker/src/index.ts:272`). Because it shares a transaction with the stuck-video watchdog, that safety net is currently OFF in prod. One-line fix.
2. **P0-2:** The `webhookUrl` SSRF denylist doesn't block private-IP literals — on an unauthenticated public API, that's a server-side request forgery hole. Small validator fix in `videos.ts` + re-check in the worker.

Everything else is in `ACTION-PLAN.md`, ordered.
