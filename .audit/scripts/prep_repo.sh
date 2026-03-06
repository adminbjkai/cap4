#!/bin/bash
set -euo pipefail

# Repository Preparation Script
# Ensures clean state before audit

REPO_ROOT="/Users/m17/2026/gh_repo_tests/cap3"

echo "🔧 Preparing Cap3 Repository"
echo "============================"

cd "$REPO_ROOT"

# 1. Create artifact directories FIRST (before any writes)
echo "📁 Creating artifact directories..."
mkdir -p .audit/artifacts
mkdir -p .audit/findings
mkdir -p .audit/reports

# 2. Check git status
echo "📋 Checking git status..."
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  Warning: Uncommitted changes detected"
  git status --short
else
  echo "✅ Working tree clean"
fi

# 3. Capture commit info
echo "📝 Capturing commit info..."
git log -1 --format="%H|%ai|%s" > .audit/artifacts/git_commit.txt
COMMIT_SHA=$(git log -1 --format="%H")
echo "   Commit: $COMMIT_SHA"

# 4. Verify dependencies installed
echo "📦 Checking dependencies..."
if [ ! -d "node_modules" ]; then
  echo "   Installing dependencies..."
  pnpm install
else
  echo "   ✓ Dependencies present"
fi

# 5. Run typecheck
echo "🔍 Running typecheck..."
pnpm typecheck || echo "⚠️  Typecheck had errors (see output above)"

# 6. Run lint
echo "🔍 Running lint..."
pnpm lint || echo "⚠️  Lint had errors (see output above)"

# 7. Generate metadata
echo "📝 Generating audit metadata..."
cat > .audit/artifacts/AUDIT_METADATA.json << EOF
{
  "repository": "cap3",
  "path": "$REPO_ROOT",
  "commit_sha": "$COMMIT_SHA",
  "audit_started": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "audit_version": "1.0.0",
  "tools": {
    "node": "$(node --version)",
    "pnpm": "$(pnpm --version)"
  }
}
EOF

echo ""
echo "✅ Repository prepared for audit"
echo "   Metadata: .audit/artifacts/AUDIT_METADATA.json"
echo ""
echo "Next steps:"
echo "  1. Run: ./.audit/scripts/index_repo.sh"
echo "  2. Run: ./.audit/scripts/scan_security.sh"
echo "  3. Start OpenClaw audit workflow"
