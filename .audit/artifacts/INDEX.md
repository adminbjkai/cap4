# Cap3 Repository Index

Generated: 2026-03-06T07:41:33Z

## Overview

- **Total LOC**: 
- **Repository**: cap3
- **Package Manager**: pnpm
- **Primary Language**: TypeScript

## Services

| Service | Port | Description |
|---------|------|-------------|
| web-api | 3000 | Fastify API server |
| web | 8022 | React + Vite UI |
| media-server | 3001 | Video processing |
| worker | - | Background job processor |
| postgres | 5432 | PostgreSQL database |
| minio/s3 | 9000 | Object storage |

## Directory Structure

```
.
├── apps/
│   ├── web/           # React frontend
│   ├── web-api/       # API server
│   ├── media-server/  # Video processing
│   └── worker/        # Job processor
├── packages/
│   ├── config/        # Shared configuration
│   ├── db/            # Database client
│   └── logger/        # Structured logging
├── db/
│   └── migrations/    # SQL migrations
├── docs/
│   ├── api/           # API documentation
│   ├── ops/           # Operations guides
│   └── ui/            # UI guidelines
└── docker-compose.yml
```

## Technology Stack

- **Runtime**: Node.js 20
- **Framework**: Fastify 4.x (API), React 18 (UI)
- **Database**: PostgreSQL 15
- **Storage**: S3/MinIO
- **Queue**: PostgreSQL-based job queue
- **Build**: TypeScript, Vite

## Key Files

- `apps/web-api/src/index.ts` - API entry point
- `apps/web/src/main.tsx` - UI entry point
- `apps/worker/src/index.ts` - Worker entry point
- `packages/db/src/index.ts` - Database layer
- `docker-compose.yml` - Service orchestration

## Dependencies

See `repo_stats.json` for detailed breakdown.

## Artifacts

This audit run generates:
- `INDEX.md` - This file
- `ARCH_STATE.md` - Architecture analysis
- `BACKEND_HEALTH_ASSESSMENT.md` - API review
- `FRONTEND_STRUCTURE_REPORT.md` - UI review
- `QUEUE_LOGIC_AUDIT.md` - Worker analysis
- `INFRASTRUCTURE_AUDIT.md` - Config review
- `DEPENDENCY_ANALYSIS.md` - Dependencies
- `DOCS_CONSISTENCY_REPORT.md` - Documentation
- `PRUNING_RECOMMENDATIONS.md` - Dead code
- `SECURITY_RISK_ASSESSMENT.md` - Security
- `FINAL_AUDIT_REPORT.md` - Synthesis
