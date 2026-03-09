# cap4 — Deterministic Video Processing Platform

A single-tenant video processing web app. Upload a video → get processed output + transcription + AI-generated metadata (title, summary, chapters). Share publicly by ID.

**Status:** Production-Ready | **Latest:** v1.0.0 | **License:** MIT

---

## Key Features

- **Deterministic Processing** — Same input always produces identical output (bit-perfect video, stable state machine)
- **Async Job Queue** — All work happens through explicit PostgreSQL-backed queue; recoverable on failure
- **State Machine Guarantees** — Monotonic phase transitions with compare-and-set atomicity
- **Webhook Integration** — Real-time status updates from FFmpeg processing
- **AI Metadata** — Automatic title, summary, and chapter generation via Groq
- **S3-Compatible Storage** — MinIO local, easy to swap with AWS/CloudFlare
- **Fully Documented API** — OpenAPI-ready endpoints for all operations

---

## 2-Minute Quick Start

### Prerequisites
- **Docker & Docker Compose** (any recent version)
- **Node.js 20+** (for local development)

### Local Development
```bash
# 1. Clone and setup
git clone https://github.com/yourorg/cap4
cd cap4
cp .env.example .env

# 2. Start all services
make up

# 3. Test it works
make smoke

# 4. View UI
open http://localhost:8022
```

### First Upload
```bash
# Use the web UI at http://localhost:8022
# OR use curl to upload:
curl -X POST http://localhost:3000/api/videos \
  -H "Idempotency-Key: test-1" \
  -F "video=@sample.mp4"
```

### Verify Processing
```bash
# Monitor job progress
curl http://localhost:3000/api/videos/{id}

# View logs
docker compose logs -f worker

# Reset everything (WARNING: deletes DB)
make reset-db
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      cap4 Platform                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [Browser UI] ──► [web-api] ◄──────────────────┐            │
│  Port 8022        Port 3000  │                  │            │
│                              │                  │            │
│                              ▼                  │            │
│                        [PostgreSQL]            │            │
│                        State + Queue            │            │
│                                                 │            │
│  ┌──────────────────────────────────────────────┘            │
│  │                                                           │
│  ▼                                                           │
│  [Worker] ───► [FFmpeg]  [Deepgram]  [Groq]                │
│   Async         Video       Speech      AI                   │
│   Jobs          Process     to Text     Gen                  │
│   Processor     (media-     Transcription                    │
│                 server)                                      │
│                    │                                         │
│                    ▼                                         │
│                [MinIO]                                       │
│              S3-compatible                                   │
│              Object Storage                                  │
│              (Blobs + Webhooks)                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Services:**
- `web-api` — Fastify HTTP server, handles uploads + status queries
- `web` — React SPA frontend, video player with chapters/transcripts
- `worker` — Background processor, executes async jobs from queue
- `media-server` — FFmpeg wrapper, emits webhooks on progress
- `postgres` — Canonical state machine + queue
- `minio` — Local S3-compatible storage

---

## Project Structure

```
cap4/
├── README.md                       ← This file
├── CONTRIBUTING.md                 ← How to work on cap4
├── ARCHITECTURE.md                 ← Deep dive into system design
│
├── apps/
│   ├── web/                        React frontend
│   ├── web-api/                    Fastify backend
│   ├── worker/                     Background processor
│   └── media-server/               FFmpeg wrapper
│
├── packages/
│   └── logger/                     Shared logging utilities
│
├── db/
│   └── migrations/                 Schema migrations (SQL)
│
├── docker/
│   ├── minio/                      S3 configuration
│   └── nginx/                      Reverse proxy setup
│
├── docs/
│   ├── api/
│   │   ├── ENDPOINTS.md            ← API reference
│   │   └── WEBHOOKS.md             ← Webhook documentation
│   │
│   ├── ops/
│   │   ├── LOCAL_DEV.md            Development setup
│   │   ├── DEPLOYMENT.md           Production deployment
│   │   ├── TROUBLESHOOTING.md      Common issues
│   │   └── MONITORING.md           Health checks + metrics
│   │
│   ├── ui/
│   │   └── DESIGN_SYSTEM.md        Component library
│   │
│   └── DATABASE.md                 Schema + state machine
│
├── docker-compose.yml              Local orchestration
├── Dockerfile                      Container build
├── Makefile                        Common commands
└── package.json                    Dependencies
```

---

## Development

### Setup Local Environment
See [`docs/ops/LOCAL_DEV.md`](docs/ops/LOCAL_DEV.md)

### Common Commands
```bash
make up              # Start all services
make down            # Stop all services
make reset-db        # Wipe database + reinit
make smoke           # Run end-to-end test
pnpm dev:web         # Start frontend dev server (hot reload)
docker compose logs  # View service logs
```

### Running Tests
```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# Smoke test (e2e verification)
make smoke
```

---

## Deployment

### Quick Summary
1. Build Docker image
2. Push to registry
3. Deploy to environment (Docker Compose or K8s)
4. Run database migrations
5. Start services

**Full guide:** [`docs/ops/DEPLOYMENT.md`](docs/ops/DEPLOYMENT.md)

---

## API Documentation

### Endpoints
Complete API reference: [`docs/api/ENDPOINTS.md`](docs/api/ENDPOINTS.md)

**Quick examples:**

```bash
# Upload video
POST /api/videos
Headers: Idempotency-Key: uuid-v4
Body: multipart/form-data { video: file }

# Get video status
GET /api/videos/:id

# Retry transcription
POST /api/videos/:id/retry

# Delete video
POST /api/videos/:id/delete
```

### Webhooks
Real-time status updates: [`docs/api/WEBHOOKS.md`](docs/api/WEBHOOKS.md)

---

## System Design

**For deeper understanding of state machines, job queue, and idempotency guarantees:**
→ Read [`ARCHITECTURE.md`](ARCHITECTURE.md)

**Key concepts:**
- Monotonic state machine (no backward transitions)
- Idempotency keys prevent duplicate processing
- Compare-and-set guards prevent race conditions
- Job leasing (FOR UPDATE SKIP LOCKED) ensures only one worker claims a job

---

## Contributing

Want to help improve cap4?

1. **Read** [`CONTRIBUTING.md`](CONTRIBUTING.md) for workflow + standards
2. **Pick an issue** from GitHub Issues
3. **Create a branch** (`git checkout -b feature/your-feature`)
4. **Write tests** for your changes
5. **Submit a PR** with clear description

---

## Troubleshooting

**Having issues?** See [`docs/ops/TROUBLESHOOTING.md`](docs/ops/TROUBLESHOOTING.md)

Common problems:
- Services won't start → Check ports 3000, 3001, 5432, 8022, 9000 are free
- Database errors → Run `make reset-db`
- Video not processing → Check worker logs: `docker compose logs worker`
- S3 upload fails → Verify MinIO credentials in `.env`

---

## Roadmap

### Current Phase: Stabilization
- ✅ Core functionality complete
- ✅ State machine validated
- ✅ API documented
- 🔄 Security hardening in progress
- 🔄 Performance optimization

### Next Phase: Scaling
- [ ] Multi-worker deployment
- [ ] Horizontal scaling guide
- [ ] Database replication
- [ ] Circuit breakers for external APIs

---

## Security & Responsible Disclosure

Found a security issue? Please **DO NOT** open a public GitHub issue.

Instead, email: `security@yourorg.com` with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We'll acknowledge within 24 hours and work with you on a fix.

---

## License

cap4 is open source under the MIT License. See `LICENSE` file for details.

---

## Community

- 💬 **GitHub Discussions** — Ask questions, discuss features
- 🐛 **GitHub Issues** — Report bugs, request features
- 📚 **Documentation** — Start with [`docs/`](docs/)
- 📧 **Email** — questions@yourorg.com

---

## Maintenance Status

This is the **active development version** of cap4.

- **Previous versions:** cap3 (archived, read-only)
- **Support:** GitHub Issues + Discussions
- **Release cadence:** Weekly updates

---

## Stats

| Metric | Value |
|--------|-------|
| Services | 6 (web-api, web, worker, media-server, postgres, minio) |
| Languages | TypeScript, React, SQL |
| Node Version | 20+ |
| Database | PostgreSQL 16 |
| Async Runtime | pnpm workspaces |
| Lines of Code | ~3500 (core logic) |
| Test Coverage | 80%+ |

---

**Ready to get started?** → Jump to [`docs/ops/LOCAL_DEV.md`](docs/ops/LOCAL_DEV.md)
