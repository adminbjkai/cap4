# Local Development Setup

Get cap4 running on your machine in 5 minutes.

---

## Requirements

- **Docker & Docker Compose** (latest stable)
- **Node.js 20+** (for running tests)
- **pnpm** (package manager)

---

## Quick Start (5 Minutes)

```bash
# 1. Clone repo
git clone https://github.com/yourorg/cap4
cd cap4

# 2. Setup environment
cp .env.example .env

# 3. Start services
make up

# 4. Verify it works
make smoke

# 5. Open in browser
open http://localhost:8022
```

That's it! All services are running.

---

## What's Running

After `make up`:

| Service | URL | Purpose |
|---------|-----|---------|
| **web** | http://localhost:8022 | React frontend |
| **web-api** | http://localhost:3000 | HTTP API |
| **media-server** | http://localhost:3001 | FFmpeg |
| **postgres** | localhost:5432 | Database |
| **minio** | http://localhost:9000 | S3 storage |

---

## Testing Your Setup

### Quick Smoke Test
```bash
make smoke
# Automatically:
# 1. Uploads a test video
# 2. Waits for processing to complete
# 3. Verifies outputs
```

### Manual Upload via Web UI
1. Open http://localhost:8022
2. Click "Upload Video"
3. Select a test video (MP4 recommended)
4. Wait for processing to complete
5. View chapters, transcript, AI metadata

### Manual Upload via curl
```bash
# 1. Upload
curl -X POST http://localhost:3000/api/videos \
  -H "Idempotency-Key: test-001" \
  -F "video=@sample.mp4"

# 2. Get video ID from response
# 3. Poll status
curl http://localhost:3000/api/videos/{id}

# 4. Watch worker logs
docker compose logs -f worker
```

---

## Common Commands

```bash
# Start all services
make up

# Stop all services
make down

# View logs
docker compose logs            # All services
docker compose logs worker     # Just worker
docker compose logs -f web-api # Follow logs

# Reset database (WARNING: deletes all data)
make reset-db

# Run tests
pnpm test
pnpm test:integration

# Format code
pnpm format

# Lint code
pnpm lint

# Run frontend dev server (hot reload)
cd apps/web
pnpm dev
# Or from root:
pnpm dev:web
```

---

## .env Configuration

See `.env.example` for all available options.

Key variables:
```bash
# API Port
API_PORT=3000

# Database
DB_HOST=postgres
DB_PORT=5432
DB_USER=cap4
DB_PASSWORD=password123
DB_NAME=cap4

# MinIO S3
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

# External APIs
DEEPGRAM_API_KEY=your-key-here
GROQ_API_KEY=your-key-here
```

---

## Troubleshooting

### Port Already in Use

```bash
# Find what's using the port
lsof -i :3000
lsof -i :8022

# Kill the process
kill -9 <PID>

# Or change port in .env
API_PORT=3001
```

### Database Connection Error

```bash
# Check if postgres is running
docker compose ps

# Restart postgres
docker compose restart postgres

# Or reset everything
make down && make up
```

### Video Won't Process

```bash
# Check worker logs
docker compose logs worker

# Common issues:
# 1. External API failure (Deepgram, Groq) - try retry
# 2. Video format unsupported - use MP4
# 3. Worker crashed - restart: docker compose restart worker
```

### S3 Upload Fails

```bash
# Check MinIO is running
curl http://localhost:9000/minio/health/live

# Check credentials in .env
# MinIO UI: http://localhost:9000
```

### Out of Disk Space

```bash
# Clean up Docker volumes
docker system prune -a

# Or clean specific project
docker volume rm cap4_postgres cap4_minio_data
```

---

## Frontend Development

### Run Vite Dev Server (with Hot Reload)

```bash
# From cap4 root
pnpm dev:web

# Or from apps/web
cd apps/web
pnpm dev
```

This starts frontend on `http://localhost:5173` with hot module reloading.

Backend still runs at `http://localhost:3000`.

### Debugging Frontend

Chrome DevTools work normally. Check Console, Network, and React DevTools extension.

---

## Backend Development

### Running Individual Services

Instead of `make up` (all services), run just what you need:

```bash
# Just database and MinIO (for API testing)
docker compose up -d postgres minio

# Leave worker down if testing just API endpoints
```

### Testing API Endpoints

```bash
# Test upload endpoint
curl -X POST http://localhost:3000/api/videos \
  -H "Idempotency-Key: test-001" \
  -F "video=@sample.mp4"

# Test status endpoint
curl http://localhost:3000/api/videos/{id}
```

### Debugging Worker

```bash
# Watch worker logs in real-time
docker compose logs -f worker

# Check worker code
cat apps/worker/src/index.ts
```

---

## Database Access

### Using psql (PostgreSQL Client)

```bash
# Install psql if not already
brew install postgresql  # macOS
apt-get install postgresql-client  # Ubuntu

# Connect to database
psql -h localhost -p 5432 -U cap4 -d cap4
```

### Useful SQL Queries

```sql
-- See all videos
SELECT id, processingPhase, rank, uploadedAt FROM videos;

-- See pending jobs
SELECT * FROM jobs WHERE status = 'pending';

-- See recent errors
SELECT * FROM jobs WHERE status = 'failed' ORDER BY createdAt DESC LIMIT 5;

-- Clear all data (WARNING!)
DELETE FROM videos CASCADE;
```

---

## MinIO (S3) Access

### Web UI
Open http://localhost:9000 in browser.

Login:
- Username: `minioadmin`
- Password: `minioadmin`

### Using AWS CLI (Optional)

```bash
# Configure AWS CLI for MinIO
aws configure --profile minio
# Endpoint: http://localhost:9000
# Access Key: minioadmin
# Secret Key: minioadmin
# Region: us-east-1

# List buckets
aws --endpoint-url http://localhost:9000 --profile minio s3 ls

# List video files
aws --endpoint-url http://localhost:9000 --profile minio s3 ls s3://cap4/
```

---

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes
# Test: pnpm test, make smoke

# Commit
git add .
git commit -m "feat: add chapter navigation"

# Push
git push origin feature/my-feature

# Open Pull Request on GitHub
```

See [../../CONTRIBUTING.md](../../CONTRIBUTING.md) for full guidelines.

---

## Performance Tips

- **Keep Docker containers running** — Don't rebuild constantly
- **Use `make smoke` for validation** — Faster than manual testing
- **Monitor worker logs** — Quick insight into what's happening
- **Clear volume data between major changes** — Prevents state conflicts

---

## Architecture Details

See [../../ARCHITECTURE.md](../../ARCHITECTURE.md) for deep dive into:
- State machine
- Job queue
- Webhook handling
- Failure recovery

---

## Still Having Issues?

1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
2. Read service logs: `docker compose logs {service}`
3. Ask in GitHub Discussions
4. Check ARCHITECTURE.md for design details

**Remember:** Most issues are solved by `make down && make up` + `make reset-db`
