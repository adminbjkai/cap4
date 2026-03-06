#!/bin/bash
set -euo pipefail

# Repository Indexing Script for Cap3
# Generates INDEX.md with comprehensive repository map

REPO_ROOT="/Users/m17/2026/gh_repo_tests/cap3"
OUTPUT_DIR="${REPO_ROOT}/.audit/artifacts"
mkdir -p "$OUTPUT_DIR"

echo "🔍 Cap3 Repository Indexer"
echo "=========================="

cd "$REPO_ROOT"

# Check for optional tools
SCC_AVAILABLE=false
RG_AVAILABLE=false

if command -v scc >/dev/null 2>&1; then
  SCC_AVAILABLE=true
  echo "✅ scc available"
else
  echo "⚠️  scc not installed (optional: brew install scc)"
fi

if command -v rg >/dev/null 2>&1; then
  RG_AVAILABLE=true
  echo "✅ ripgrep available"
else
  echo "⚠️  ripgrep not installed (optional: brew install ripgrep)"
fi

# 1. Language statistics (fallback if scc not available)
echo "📊 Analyzing languages..."
if [ "$SCC_AVAILABLE" = true ]; then
  scc --format json . > "$OUTPUT_DIR/repo_stats.json" 2>/dev/null || echo "[]" > "$OUTPUT_DIR/repo_stats.json"
  TOTAL_LOC=$(scc --no-cocomo --no-complexity . | tail -1 | awk '{print $3}')
else
  # Fallback: count lines in TypeScript files
  echo "[]" > "$OUTPUT_DIR/repo_stats.json"
  TOTAL_LOC=$(find apps packages -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
fi

# 2. Find TypeScript/JavaScript files
echo "📁 Finding source files..."
find apps packages -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) 2>/dev/null | grep -v node_modules | grep -v dist > "$OUTPUT_DIR/source_files.txt" || true

# 3. Extract package info
echo "📦 Analyzing packages..."
if [ -f package.json ]; then
  cat package.json | jq -r '.workspaces[]' 2>/dev/null > "$OUTPUT_DIR/workspaces.txt" || echo "" > "$OUTPUT_DIR/workspaces.txt"
fi

# 4. Detect services from docker-compose
echo "🐳 Detecting services..."
if [ -f docker-compose.yml ]; then
  cat docker-compose.yml | grep -E "^  [a-z-]+:" | sed 's/://' > "$OUTPUT_DIR/docker_services.txt" || true
else
  echo "" > "$OUTPUT_DIR/docker_services.txt"
fi

# 5. Find entry points
echo "🚪 Finding entry points..."
if [ "$RG_AVAILABLE" = true ]; then
  rg "^import|^require" --type ts --type tsx -l 2>/dev/null | grep -E "(index|main|app)\." | head -20 > "$OUTPUT_DIR/entry_points.txt" || true
else
  find apps -name "index.ts" -o -name "main.tsx" -o -name "app.ts" 2>/dev/null | head -20 > "$OUTPUT_DIR/entry_points.txt" || true
fi

# 6. Database migrations
echo "🗄️  Checking migrations..."
ls -1 db/migrations/*.sql 2>/dev/null | wc -l > "$OUTPUT_DIR/migration_count.txt" || echo "0" > "$OUTPUT_DIR/migration_count.txt"

# 7. Generate INDEX.md
echo "📝 Generating INDEX.md..."
cat > "$OUTPUT_DIR/INDEX.md" << EOF
# Cap3 Repository Index

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Overview

- **Total LOC**: $TOTAL_LOC
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

\`\`\`
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
\`\`\`

## Technology Stack

- **Runtime**: Node.js 20
- **Framework**: Fastify 4.x (API), React 18 (UI)
- **Database**: PostgreSQL 15
- **Storage**: S3/MinIO
- **Queue**: PostgreSQL-based job queue
- **Build**: TypeScript, Vite

## Key Files

- \`apps/web-api/src/index.ts\` - API entry point
- \`apps/web/src/main.tsx\` - UI entry point
- \`apps/worker/src/index.ts\` - Worker entry point
- \`packages/db/src/index.ts\` - Database layer
- \`docker-compose.yml\` - Service orchestration

## Dependencies

See \`repo_stats.json\` for detailed breakdown.

## Artifacts

This audit run generates:
- \`INDEX.md\` - This file
- \`ARCH_STATE.md\` - Architecture analysis
- \`BACKEND_HEALTH_ASSESSMENT.md\` - API review
- \`FRONTEND_STRUCTURE_REPORT.md\` - UI review
- \`QUEUE_LOGIC_AUDIT.md\` - Worker analysis
- \`INFRASTRUCTURE_AUDIT.md\` - Config review
- \`DEPENDENCY_ANALYSIS.md\` - Dependencies
- \`DOCS_CONSISTENCY_REPORT.md\` - Documentation
- \`PRUNING_RECOMMENDATIONS.md\` - Dead code
- \`SECURITY_RISK_ASSESSMENT.md\` - Security
- \`FINAL_AUDIT_REPORT.md\` - Synthesis
EOF

echo "✅ Index complete: $OUTPUT_DIR/INDEX.md"
echo ""
echo "Tools status:"
echo "  - scc: $([ "$SCC_AVAILABLE" = true ] && echo "✅" || echo "⚠️  install with: brew install scc")"
echo "  - rg: $([ "$RG_AVAILABLE" = true ] && echo "✅" || echo "⚠️  install with: brew install ripgrep")"
