# Troubleshooting Guide

Common issues and how to fix them.

---

## Service Won't Start

### Docker containers not starting

```bash
# Check status
docker compose ps

# View logs
docker compose logs

# Common issues:
# 1. Port already in use
lsof -i :3000
kill -9 <PID>

# 2. Out of disk space
docker system prune -a

# 3. Image pull failure
docker compose pull
docker compose up -d
```

### PostgreSQL won't connect

```bash
# Is postgres running?
docker compose ps postgres

# Check logs
docker compose logs postgres

# Common issues:
# - Wrong password in .env
# - Database doesn't exist
# - Port 5432 in use

# Reset and retry
docker compose down
docker volume rm cap4_postgres_data
docker compose up -d postgres
```

---

## Video Processing Fails

### "Processing timed out"

Likely video format or size issue.

```bash
# Check file format
ffprobe -v error sample.mp4

# Supported: MP4 with H.264 video + AAC audio
ffmpeg -i sample.mp4 -c:v libx264 -c:a aac output.mp4

# Check worker logs
docker compose logs worker
```

### "Transcription failed"

Deepgram API issue.

```bash
# Verify API key is set
echo $DEEPGRAM_API_KEY

# Test API
curl -X POST https://api.deepgram.com/v1/listen \
  -H "Authorization: Token ${DEEPGRAM_API_KEY}" \
  --data-binary @audio.wav

# If error: check Deepgram account + quota
```

### "AI generation failed"

Groq API issue.

```bash
# Verify API key
echo $GROQ_API_KEY

# Check Groq account
# - Valid API key?
# - Sufficient credits?
# - Rate limited?
```

---

## Upload Failures

### "413 Payload Too Large"

File exceeds 2GB limit.

```bash
# Check file size
ls -lh video.mp4

# For large files, use multipart upload endpoint:
# POST /api/videos/upload/init
# POST /api/videos/upload/{id}/part
# POST /api/videos/upload/{id}/complete
```

### "400 Bad Request"

Missing or invalid header.

```bash
# Must include Idempotency-Key
curl -X POST /api/videos \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "video=@file.mp4"
```

### "409 Conflict - Duplicate request"

Same Idempotency-Key used twice (this is OK).

```bash
# If intentional, use the video ID from first response
# If error: retry with new Idempotency-Key
curl -X POST /api/videos \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "video=@file.mp4"
```

---

## Database Issues

### "Database connection pool exhausted"

Too many concurrent connections.

```bash
# Check connections
docker compose exec postgres psql -U cap4 -d cap4 -c \
  "SELECT count(*) FROM pg_stat_activity;"

# Increase pool size in .env
DB_POOL_SIZE=30

# Restart services
docker compose restart web-api worker
```

### "Unique constraint violation"

Duplicate data being inserted.

```bash
# Check for duplicate videos
docker compose exec postgres psql -U cap4 -d cap4 -c \
  "SELECT id, uploadedAt FROM videos ORDER BY uploadedAt;"

# If corrupted, remove duplicates
docker compose exec postgres psql -U cap4 -d cap4 -c \
  "DELETE FROM videos WHERE id IN (SELECT id FROM videos WHERE id NOT IN (SELECT DISTINCT(id) FROM videos));"
```

### "Migration failed"

Database schema issue.

```bash
# Check migration status
docker compose exec web-api npm run migrate:status

# Rollback last migration
docker compose exec web-api npm run migrate:rollback

# Apply again
docker compose exec web-api npm run migrate
```

---

## API Issues

### "500 Internal Server Error"

Server-side error. Check logs.

```bash
# View API logs
docker compose logs web-api

# Common issues:
# - Database connection failed
# - External API timeout
# - Unhandled exception

# If persistent, restart service
docker compose restart web-api
```

### "401 Unauthorized"

Authentication failed (shouldn't happen in single-tenant).

```bash
# Check if API requires auth (it shouldn't)
# If seeing auth error, API configuration is wrong
```

### "503 Service Unavailable"

Service is down or overloaded.

```bash
# Check service status
docker compose ps

# Restart unhealthy services
docker compose restart web-api worker

# If still down, check logs and disk space
docker system df
```

---

## Worker Issues

### Worker won't claim jobs

```bash
# Check worker is running
docker compose ps worker

# View logs
docker compose logs -f worker

# Check for errors
docker compose logs worker | grep -i error

# Restart worker
docker compose restart worker
```

### Worker crashes immediately

```bash
# Check logs for error
docker compose logs worker

# Common issues:
# - Invalid environment variable
# - Database connection failed
# - Out of memory

# Fix .env and restart
docker compose down
docker compose up -d worker
```

### Jobs stuck in "claimed" state

```bash
# Check database
docker compose exec postgres psql -U cap4 -d cap4 -c \
  "SELECT * FROM jobs WHERE status = 'claimed';"

# If lease has expired, reset
docker compose exec postgres psql -U cap4 -d cap4 -c \
  "UPDATE jobs SET status = 'pending', leaseExpiry = NULL WHERE status = 'claimed' AND leaseExpiry < NOW();"

# Restart worker
docker compose restart worker
```

---

## S3/MinIO Issues

### "Access Denied" uploading to S3

Wrong credentials.

```bash
# Verify credentials in .env
# MINIO_ROOT_USER=minioadmin
# MINIO_ROOT_PASSWORD=minioadmin

# Check MinIO is running
docker compose ps minio

# Test access
curl http://localhost:9000/minio/health/live

# View MinIO logs
docker compose logs minio
```

### MinIO storage full

```bash
# Check disk usage
docker system df

# Clean up volumes
docker volume rm cap4_minio_data

# WARNING: This deletes all S3 data
# Only do if acceptable to lose uploaded videos
```

### Signed URLs don't work

```bash
# Check MINIO_HOST is set correctly
# Must match actual network location (not localhost in production)

# Test signed URL generation
curl -X POST http://localhost:3000/api/videos/upload/init \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.mp4","size":1000000,"contentType":"video/mp4"}'
```

---

## Performance Issues

### Slow video uploads

```bash
# Check network
iperf3 -c server

# Check disk I/O
iostat -x 1 5

# Increase timeout in .env
UPLOAD_TIMEOUT=300000

# Restart
docker compose restart web-api
```

### Slow transcription/AI generation

```bash
# These are external API dependent
# Check Deepgram/Groq API status
# - Rate limiting?
# - Quota exceeded?
# - Network latency?

# Monitor request times
docker compose logs worker | grep duration
```

### High memory usage

```bash
# Check which service is consuming memory
docker stats

# Increase container limits in docker-compose.yml
# Services > {service} > deploy > resources > limits > memory

# Restart docker-compose
docker compose down
docker compose up -d
```

---

## Networking Issues

### "Cannot connect to host"

Host firewall or network issue.

```bash
# Test connectivity
telnet localhost 3000
curl http://localhost:3000/api/health

# If working locally but not from another machine:
# - Check firewall rules
# - Verify external IP/DNS
# - Check Docker network settings
```

### Webhook not reaching web-api

media-server can't call back.

```bash
# Check Docker network
docker network ls
docker network inspect cap4_default

# All services must be on same network
# Check docker-compose.yml networking section

# Test from media-server container
docker compose exec media-server curl http://web-api:3000/api/health
```

---

## Reset Everything

If all else fails:

```bash
# WARNING: This deletes all data
make down
docker system prune -a
docker volume rm cap4_postgres_data cap4_minio_data
make up
make smoke
```

---

## Getting Help

1. Check logs: `docker compose logs -f {service}`
2. Review [ARCHITECTURE.md](../../ARCHITECTURE.md)
3. Check [../api/ENDPOINTS.md](../api/ENDPOINTS.md) for API issues
4. Ask on GitHub Discussions
5. Open GitHub Issue with logs

---

## Monitoring for Issues

```bash
# Watch logs in real-time
docker compose logs -f

# Monitor resource usage
docker stats

# Check database queries
docker compose exec postgres \
  psql -U cap4 -d cap4 -c \
  "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Monitor job queue
docker compose exec postgres \
  psql -U cap4 -d cap4 -c \
  "SELECT status, count(*) FROM jobs GROUP BY status;"
```

