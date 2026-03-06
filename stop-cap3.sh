#!/bin/bash

# Cap3 Local Development Stop Script
# This script stops all Cap3 services

echo "🛑 Stopping Cap3 services..."

# Kill processes by pattern
pkill -9 -f "tsx watch" 2>/dev/null && echo "✅ Stopped TSX watch processes" || echo "ℹ️  No TSX processes found"
pkill -9 -f "minio server" 2>/dev/null && echo "✅ Stopped MinIO" || echo "ℹ️  No MinIO found"
pkill -9 -f "vite" 2>/dev/null && echo "✅ Stopped Vite" || echo "ℹ️  No Vite found"

echo ""
echo "✅ All Cap3 services stopped"
