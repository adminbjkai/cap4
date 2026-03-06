# Deployment Guide

How to deploy cap4 to production.

---

## Quick Summary

1. Build Docker image
2. Push to registry
3. Deploy services (Docker Compose or Kubernetes)
4. Run database migrations
5. Start services
6. Verify health checks

---

## Prerequisites

- Docker registry (Docker Hub, ECR, private registry, etc.)
- Production database (PostgreSQL 16+)
- Production S3 storage (AWS S3, MinIO, etc.)
- CI/CD pipeline (GitHub Actions, GitLab CI, etc.)

---

## Build & Push Docker Image

### Using Docker Compose

```bash
# Build image
docker build -t yourregistry/cap4:latest .

# Tag with version
docker tag yourregistry/cap4:latest yourregistry/cap4:v1.0.0

# Push to registry
docker push yourregistry/cap4:latest
docker push yourregistry/cap4:v1.0.0
```

### Using CI/CD (Recommended)

GitHub Actions automatically builds and pushes on release:
- See `.github/workflows/` for configuration
- Triggered on git tags: `git tag v1.0.0 && git push origin v1.0.0`

---

## Environment Configuration

### Production .env

Create `.env.production`:

```bash
# API
API_PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Database (must be external)
DB_HOST=prod-db.example.com
DB_PORT=5432
DB_USER=cap4
DB_PASSWORD=strong_password_here
DB_NAME=cap4
DB_POOL_SIZE=20

# MinIO / S3
MINIO_HOST=prod-s3.example.com
MINIO_PORT=9000
MINIO_BUCKET=cap4-prod
MINIO_USE_SSL=true
MINIO_ROOT_USER=xxx
MINIO_ROOT_PASSWORD=xxx

# Or use AWS S3 (no MinIO)
AWS_REGION=us-east-1
AWS_BUCKET=cap4-prod
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx

# External APIs
DEEPGRAM_API_KEY=xxx
GROQ_API_KEY=xxx

# Webhook
WEBHOOK_SECRET=generate_strong_secret
WEBHOOK_TIMEOUT=30000

# Security
CORS_ORIGIN=https://yourapp.com
```

### Secrets Management

Never commit `.env.production`. Use:
- **AWS Secrets Manager** (if on AWS)
- **HashiCorp Vault** (general purpose)
- **GitHub Secrets** (if using Actions)
- **Docker Secrets** (if using Docker Swarm)

---

## Deployment Models

### Option 1: Docker Compose (Single Server)

```bash
# On production server
git clone https://github.com/yourorg/cap4
cd cap4

# Copy production config
cp .env.production .env

# Pull latest image
docker compose pull

# Start services
docker compose up -d

# Run migrations
docker compose exec web-api npm run migrate

# Verify health
curl http://localhost:3000/api/health
```

**Pros:**
- Simple setup
- No Kubernetes complexity
- Good for small/medium scale

**Cons:**
- Single point of failure
- Limited horizontal scaling

### Option 2: Kubernetes

See `k8s/` directory for Kubernetes manifests (if included).

```bash
# Apply Kubernetes config
kubectl apply -f k8s/

# Check deployment
kubectl get pods
kubectl logs -f pod/cap4-xxx
```

### Option 3: Cloud Platforms

#### AWS (Elastic Container Service)

1. Push image to ECR
2. Create ECS task definition
3. Create ECS service
4. Configure load balancer
5. Deploy and monitor

#### Heroku

```bash
# Enable Heroku container registry
heroku container:login

# Push image
heroku container:push web

# Release
heroku container:release web
```

---

## Database Migrations

Run migrations before starting services:

```bash
# Using Docker Compose
docker compose exec web-api npm run migrate

# Using kubectl (Kubernetes)
kubectl run migration --image=yourregistry/cap4:latest \
  -- npm run migrate

# Using raw command
DATABASE_URL="postgresql://user:pass@host:5432/cap4" npm run migrate
```

### Rollback

If migration fails:

```bash
# View migration history
npm run migrate:status

# Rollback last migration
npm run migrate:rollback
```

---

## Health Checks

### Endpoint

`GET /api/health`

```bash
curl https://yourapp.com/api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-03-06T14:30:00Z",
  "services": {
    "database": "connected",
    "storage": "connected",
    "worker": "active"
  }
}
```

### Liveness Probe (Kubernetes)

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
```

---

## Scaling to Multiple Workers

```bash
# With Docker Compose
docker compose up -d --scale worker=5

# With Kubernetes
kubectl scale deployment cap4-worker --replicas=5

# Monitor
docker compose ps | grep worker
kubectl get pods | grep worker
```

---

## Backup & Recovery

### Database Backup

```bash
# Manual backup
pg_dump -h prod-db.example.com -U cap4 cap4 > backup.sql

# Restore from backup
psql -h prod-db.example.com -U cap4 cap4 < backup.sql

# Automated backups (set up with cron or cloud provider)
0 2 * * * pg_dump -h prod-db.example.com -U cap4 cap4 | gzip > /backups/cap4-$(date +\%Y\%m\%d).sql.gz
```

### S3 Bucket Backup

```bash
# Enable S3 versioning
aws s3api put-bucket-versioning \
  --bucket cap4-prod \
  --versioning-configuration Status=Enabled

# Periodic sync to backup bucket
aws s3 sync s3://cap4-prod s3://cap4-prod-backup
```

---

## Monitoring

### Key Metrics to Monitor

```
- Video processing time (per phase)
- Error rate (by type)
- Worker utilization
- Database connection pool usage
- S3 API latency
- External API response times
```

### Using Prometheus

Add to `docker-compose.yml`:

```yaml
prometheus:
  image: prom/prometheus
  ports:
    - "9090:9090"
  volumes:
    - ./docker/prometheus.yml:/etc/prometheus/prometheus.yml
```

### Logging

Send logs to:
- **CloudWatch** (AWS)
- **ELK Stack** (open source)
- **Datadog** (SaaS)
- **Papertrail** (SaaS)

---

## Security Hardening

- [ ] Enable HTTPS/TLS
- [ ] Set strong database passwords
- [ ] Use VPC/security groups
- [ ] Enable database encryption
- [ ] Rotate API keys regularly
- [ ] Set rate limiting
- [ ] Enable audit logging

---

## Rollback Plan

If deployment fails:

```bash
# Docker Compose
docker compose down
docker pull yourregistry/cap4:v1.0.0-previous
docker compose up -d

# Kubernetes
kubectl rollout undo deployment/cap4
kubectl rollout history deployment/cap4
```

---

## Release Checklist

Before deploying to production:

- [ ] All tests pass
- [ ] Code reviewed and approved
- [ ] Database migration tested in staging
- [ ] Performance testing completed
- [ ] Security audit passed
- [ ] Rollback plan documented
- [ ] Team notified of deployment
- [ ] Monitoring is active
- [ ] Backup is current

---

## Incident Response

If production issue occurs:

1. **Assess impact** — How many users affected?
2. **Roll back if critical** — Use rollback procedure
3. **Investigate** — Check logs, metrics
4. **Fix** — Update code, database, or config
5. **Test in staging** — Verify fix works
6. **Deploy carefully** — Monitor health
7. **Post-mortem** — Document what happened

---

**Need help?** See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) or [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
