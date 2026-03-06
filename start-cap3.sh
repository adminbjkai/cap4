#!/bin/bash

# Cap3 Local Development Startup Script
# This script starts all required services for local development

set -e

echo "🚀 Starting Cap3 Local Development Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if a port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}❌ Port $1 is already in use${NC}"
        return 1
    fi
    return 0
}

# Function to wait for a service to be ready
wait_for_service() {
    local port=$1
    local name=$2
    local max_attempts=30
    local attempt=1
    
    echo -e "${YELLOW}⏳ Waiting for $name on port $port...${NC}"
    while ! curl -s http://localhost:$port/health >/dev/null 2>&1; do
        if [ $attempt -ge $max_attempts ]; then
            echo -e "${RED}❌ $name failed to start${NC}"
            return 1
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    echo -e "${GREEN}✅ $name is ready${NC}"
}

# Create logs directory early
mkdir -p logs

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."
pkill -9 -f "tsx watch" 2>/dev/null || true
pkill -9 -f "minio server" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true
sleep 2

# Check required ports
echo "🔍 Checking ports..."
check_port 3000 || exit 1
check_port 3100 || exit 1
check_port 5173 || exit 1
check_port 9000 || exit 1

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
fi

# Export environment variables
echo "📋 Loading environment variables..."
set -a
source .env
set +a

# Check if PostgreSQL is running
echo "🔍 Checking PostgreSQL..."
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  PostgreSQL is not running. Please start it first:${NC}"
    echo "   brew services start postgresql@16"
    exit 1
fi
echo -e "${GREEN}✅ PostgreSQL is running${NC}"

# Check if database and user exist
echo "🔍 Checking database..."
if ! psql postgres://app:app@localhost:5432/cap3 -c "SELECT 1" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Database or user not found. Creating...${NC}"
    psql postgres -c "CREATE USER app WITH PASSWORD 'app';" 2>/dev/null || true
    psql postgres -c "CREATE DATABASE cap3 OWNER app;" 2>/dev/null || true
    psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE cap3 TO app;" 2>/dev/null || true
    
    # Run migrations
    echo "📊 Running database migrations..."
    psql postgres://app:app@localhost:5432/cap3 -f db/migrations/0001_init.sql
    psql postgres://app:app@localhost:5432/cap3 -f db/migrations/0002_video_soft_delete.sql
    psql postgres://app:app@localhost:5432/cap3 -f db/migrations/0003_add_webhook_reporting.sql
fi
echo -e "${GREEN}✅ Database is ready${NC}"

# Start MinIO
echo "🗄️  Starting MinIO..."
mkdir -p /tmp/minio-data
MINIO_ROOT_USER=minio MINIO_ROOT_PASSWORD=minio123 minio server /tmp/minio-data \
    --console-address :8923 \
    --address :9000 \
    --quiet &
MINIO_PID=$!
sleep 3

# Verify MinIO is running
if ! curl -s http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo -e "${RED}❌ MinIO failed to start${NC}"
    exit 1
fi
echo -e "${GREEN}✅ MinIO is running (PID: $MINIO_PID)${NC}"

# Start web-api
echo "🌐 Starting Web API..."
pnpm dev:web-api > logs/web-api.log 2>&1 &
WEB_API_PID=$!
sleep 3

# Start worker
echo "⚙️  Starting Worker..."
pnpm dev:worker > logs/worker.log 2>&1 &
WORKER_PID=$!
sleep 3

# Start media-server
echo "🎬 Starting Media Server..."
pnpm dev:media-server > logs/media-server.log 2>&1 &
MEDIA_SERVER_PID=$!
sleep 3

# Start web UI
echo "💻 Starting Web UI..."
pnpm dev:web > logs/web.log 2>&1 &
WEB_PID=$!
sleep 2

# Print status
echo ""
echo -e "${GREEN}✅ All services started!${NC}"
echo ""
echo "📍 Service URLs:"
echo "   Web UI:       http://localhost:5173"
echo "   API:          http://localhost:3000"
echo "   API Health:   http://localhost:3000/health"
echo "   Media Server: http://localhost:3100"
echo "   MinIO Console: http://localhost:8923 (minio/minio123)"
echo ""
echo "📋 Process IDs:"
echo "   MinIO:        $MINIO_PID"
echo "   Web API:      $WEB_API_PID"
echo "   Worker:       $WORKER_PID"
echo "   Media Server: $MEDIA_SERVER_PID"
echo "   Web UI:       $WEB_PID"
echo ""
echo "📝 Logs are being written to ./logs/"
echo ""
echo "To stop all services, run: ./stop-cap3.sh"
echo ""

# Keep script running
wait
