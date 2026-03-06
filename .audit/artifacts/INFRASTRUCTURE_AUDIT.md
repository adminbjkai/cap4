# Cap3 Video Processing Platform - Infrastructure Security Audit

**Audit Date:** 2026-03-06  
**Auditor:** Configuration Auditor  
**Scope:** Docker security, environment variables, secrets handling, network configuration, CI/CD security

---

## 1. Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| **P0 - Critical** | 5 | Immediate action required |
| **P1 - High** | 8 | Address in next sprint |
| **P2 - Medium** | 6 | Address in next quarter |
| **P3 - Low** | 4 | Nice to have |

### Critical Issues Overview
- **5 hardcoded secrets** exposed in `.env` file including production API keys
- **No resource limits** defined for any Docker service
- **Overly permissive CORS** configuration allowing all origins
- **Weak default credentials** across multiple services
- **Missing network isolation** - all services on default bridge network

---

## 2. Critical Findings (P0)

### FIND-001: Hardcoded Production API Keys in .env File
**Severity:** P0 - Critical  
**File:** `.env` lines 38-39, 54  
**Evidence:**
```bash
# AI + transcription providers (backend-only) - REAL SECRETS EXPOSED
DEEPGRAM_API_KEY=REDACTED
GROQ_API_KEY=gsk_REDACTED
...
GEMINI_API_KEY=REDACTED
```
**Impact:** Production API keys are committed to repository, exposing services to unauthorized access, potential quota abuse, and financial liability. Anyone with repository access can use these keys.  
**Remediation:**
1. Immediately rotate all exposed API keys at provider dashboards
2. Verify `.env` is in `.gitignore` (present but verify effectiveness)
3. Use Docker secrets or external secret management (AWS Secrets Manager, HashiCorp Vault)
4. Scan git history and scrub secrets using `git-filter-repo` or BFG Repo-Cleaner
5. Implement pre-commit hooks (git-secrets, detect-secrets) to prevent future commits

---

### FIND-002: Weak Default Credentials for Database and MinIO
**Severity:** P0 - Critical  
**File:** `docker-compose.yml` lines 6-8, 20-21  
**Evidence:**
```yaml
# PostgreSQL
environment:
  POSTGRES_USER: ${POSTGRES_USER:-app}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-app}
...
# MinIO
environment:
  MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minio}
  MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minio123}
```
**Impact:** Default credentials (`app`/`app`, `minio`/`minio123`) allow trivial unauthorized access if environment variables are not explicitly set. Common attack vector for automated scanners.  
**Remediation:**
1. Remove default values for all credentials - require explicit configuration
2. Generate strong random passwords during initial setup
3. Document secure password generation in deployment guide
4. Add validation to ensure passwords meet complexity requirements

---

### FIND-003: No Resource Limits on Any Docker Services
**Severity:** P0 - Critical  
**File:** `docker-compose.yml` (all services)  
**Evidence:**
```yaml
services:
  postgres:
    image: postgres:16-alpine
    # No deploy.resources.limits defined
  minio:
    image: minio/minio:RELEASE.2025-01-20T14-49-07Z
    # No deploy.resources.limits defined
  web-api:
    # No deploy.resources.limits defined
  worker:
    # No deploy.resources.limits defined
```
**Impact:** Services can consume unlimited CPU/memory, leading to resource exhaustion attacks, noisy neighbor problems, and potential host instability. Video processing (FFmpeg) is particularly resource-intensive.  
**Remediation:**
1. Add resource limits to all services:
```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 1G
    reservations:
      cpus: '0.5'
      memory: 512M
```
2. Set stricter limits for worker (video processing) based on workload analysis
3. Monitor actual usage and adjust limits accordingly

---

### FIND-004: Overly Permissive CORS Configuration
**Severity:** P0 - Critical  
**File:** `docker/minio/cors.json`  
**Evidence:**
```json
[{
  "AllowedOrigins": ["*"],
  "AllowedMethods": ["GET", "PUT", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```
**Impact:** Wildcard CORS allows any website to make requests to MinIO storage, enabling cross-origin attacks, data exfiltration, and potential unauthorized uploads if PUT is exploited.  
**Remediation:**
1. Restrict `AllowedOrigins` to specific domains:
```json
{
  "AllowedOrigins": ["https://cap3.example.com", "https://admin.cap3.example.com"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["Authorization", "Content-Type"],
  "MaxAgeSeconds": 3600
}
```
2. Remove PUT from allowed methods unless absolutely necessary
3. Implement origin validation at application level as defense in depth

---

### FIND-005: Database Connection String with Hardcoded Credentials
**Severity:** P0 - Critical  
**File:** `docker-compose.yml` lines 33, 50, 64  
**Evidence:**
```yaml
web-api:
  environment:
    DATABASE_URL: ${DATABASE_URL:-postgres://app:app@postgres:5432/cap3}

worker:
  environment:
    DATABASE_URL: ${DATABASE_URL:-postgres://app:app@postgres:5432/cap3}
```
**Impact:** Default connection string contains plaintext credentials. If environment variable is not set, services connect with weak credentials (`app`/`app`).  
**Remediation:**
1. Remove default DATABASE_URL - require explicit configuration
2. Use Docker secrets for credential injection:
```yaml
secrets:
  db_password:
    external: true
environment:
  DATABASE_URL_FILE: /run/secrets/db_url
```
3. Implement connection string validation at startup

---

## 3. High Findings (P1)

### FIND-006: Services Run as Root in Containers
**Severity:** P1 - High  
**File:** `Dockerfile` (entire file)  
**Evidence:**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /workspace
# No USER directive - runs as root
...
FROM node:20-alpine AS runtime
WORKDIR /workspace
# No USER directive - runs as root
RUN apk add --no-cache ffmpeg
```
**Impact:** Container processes run as root. If container is compromised, attacker has root access within container and potentially host (if Docker socket mounted or privileged).  
**Remediation:**
1. Create non-root user in Dockerfile:
```dockerfile
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs
```
2. Ensure file permissions allow non-root access
3. Use `securityContext` in Kubernetes if applicable

---

### FIND-007: No Network Isolation Between Services
**Severity:** P1 - High  
**File:** `docker-compose.yml` (all services)  
**Evidence:**
```yaml
services:
  postgres:
    # No networks defined - uses default bridge
  minio:
    # No networks defined - uses default bridge
  web-api:
    # No networks defined - uses default bridge
```
**Impact:** All services on same network can communicate freely. Database and internal services exposed to unnecessary access. Violates principle of least privilege.  
**Remediation:**
1. Define isolated networks:
```yaml
networks:
  frontend:
  backend:
  storage:

services:
  postgres:
    networks:
      - backend
  minio:
    networks:
      - storage
      - backend
  web-api:
    networks:
      - frontend
      - backend
      - storage
```

---

### FIND-008: MinIO Console Exposed Without Authentication
**Severity:** P1 - High  
**File:** `docker-compose.yml` lines 16-17  
**Evidence:**
```yaml
minio:
  ports:
    - "${MINIO_PORT:-8922}:9000"
    - "${MINIO_CONSOLE_PORT:-8923}:9001"
```
**Impact:** MinIO console (port 8923) exposed to host network. With default credentials, provides full object storage administration.  
**Remediation:**
1. Remove console port exposure in production:
```yaml
ports:
  - "${MINIO_PORT:-8922}:9000"
  # Remove or restrict: - "${MINIO_CONSOLE_PORT:-8923}:9001"
```
2. If console needed, restrict to localhost or VPN:
```yaml
ports:
  - "127.0.0.1:8923:9001"
```
3. Implement strong authentication before exposing console

---

### FIND-009: CI Workflow Uses Deprecated Actions
**Severity:** P1 - High  
**File:** `.github/workflows/ci.yml` lines 28, 40  
**Evidence:**
```yaml
- uses: actions/cache@v3
# v3 is deprecated, v4 is current
```
**Impact:** Deprecated actions may have unpatched vulnerabilities, lack support, or be removed causing build failures.  
**Remediation:**
1. Update to `actions/cache@v4`
2. Review all action versions:
   - `actions/checkout@v4` ✓ current
   - `actions/setup-node@v4` ✓ current
   - `pnpm/action-setup@v2` - check for v3
3. Pin to specific SHA for supply chain security:
```yaml
- uses: actions/cache@<commit-sha> # v4.0.0
```

---

### FIND-010: No Health Check for MinIO Service
**Severity:** P1 - High  
**File:** `docker-compose.yml` (minio service)  
**Evidence:**
```yaml
minio:
  image: minio/minio:RELEASE.2025-01-20T14-49-07Z
  # No healthcheck defined
```
**Impact:** Docker cannot determine MinIO health. Dependent services may start before MinIO is ready, causing startup failures or cascading errors.  
**Remediation:**
1. Add health check:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```
2. Update dependent services to use `condition: service_healthy`

---

### FIND-011: Webhook Secret Uses Weak Default
**Severity:** P1 - High  
**File:** `.env` line 32  
**Evidence:**
```bash
MEDIA_SERVER_WEBHOOK_SECRET=change-me-in-real-env
```
**Impact:** Default webhook secret is predictable and documented as needing change. If not changed, attackers can forge webhook requests.  
**Remediation:**
1. Remove default value - require explicit configuration
2. Generate cryptographically secure random secret:
```bash
openssl rand -base64 32
```
3. Add validation at startup to reject weak secrets

---

### FIND-012: Nginx Configuration Missing Security Headers
**Severity:** P1 - High  
**File:** `docker/nginx/default.conf`  
**Evidence:**
```nginx
server {
    listen 80;
    location / { 
        root /usr/share/nginx/html;
        # No security headers
    }
    location /api {
        proxy_pass http://web-api:3000;
        # No security headers
    }
}
```
**Impact:** Missing security headers (HSTS, CSP, X-Frame-Options, etc.) leave application vulnerable to XSS, clickjacking, and other attacks.  
**Remediation:**
1. Add security headers:
```nginx
server {
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

---

### FIND-013: CI Workflow Missing Security Scans
**Severity:** P1 - High  
**File:** `.github/workflows/ci.yml`  
**Evidence:**
```yaml
jobs:
  lint-and-typecheck:
    # No security scanning steps
  test:
    # No security scanning steps
  build:
    # No security scanning steps
```
**Impact:** No automated detection of vulnerabilities in dependencies, secrets, or container images. Issues discovered only after deployment or security incident.  
**Remediation:**
1. Add dependency vulnerability scanning:
```yaml
- name: Audit dependencies
  run: pnpm audit --audit-level high
```
2. Add secret scanning:
```yaml
- name: Secret detection
  uses: trufflesecurity/trufflehog@main
```
3. Add container image scanning with Trivy or Snyk

---

## 4. Medium Findings (P2)

### FIND-014: Postgres Port Exposed to Host
**Severity:** P2 - Medium  
**File:** `docker-compose.yml` line 9  
**Evidence:**
```yaml
postgres:
  ports:
    - "${POSTGRES_PORT:-5432}:5432"
```
**Impact:** Database port exposed to host network. Increases attack surface if host firewall misconfigured.  
**Remediation:**
1. Remove port exposure for internal services:
```yaml
# Remove unless external access required
# ports:
#   - "${POSTGRES_PORT:-5432}:5432"
```
2. If needed for debugging, bind to localhost only:
```yaml
ports:
  - "127.0.0.1:5432:5432"
```

---

### FIND-015: MinIO Setup Uses Overly Permissive Bucket Policy
**Severity:** P2 - Medium  
**File:** `docker-compose.yml` lines 26-32  
**Evidence:**
```yaml
entrypoint: >
  /bin/sh -c "
    ...
    mc anonymous set public local/${S3_BUCKET:-cap3} || true &&
    ...
  "
```
**Impact:** Bucket set to public read access. All objects readable without authentication.  
**Remediation:**
1. Remove `mc anonymous set public` command
2. Implement signed URL generation for authorized access
3. Use bucket policies with explicit principals

---

### FIND-016: Dockerfile Uses apk Without Version Pinning
**Severity:** P2 - Medium  
**File:** `Dockerfile` line 17  
**Evidence:**
```dockerfile
RUN apk add --no-cache ffmpeg
```
**Impact:** FFmpeg version not pinned. Builds may use different versions, causing non-deterministic behavior or unexpected vulnerabilities.  
**Remediation:**
1. Pin to specific version:
```dockerfile
RUN apk add --no-cache ffmpeg=6.1.1-r0
```
2. Consider using specific Alpine version tag that includes required FFmpeg

---

### FIND-017: No Log Rotation Configuration
**Severity:** P2 - Medium  
**File:** `docker-compose.yml` (all services)  
**Evidence:**
```yaml
services:
  web-api:
    # No logging options defined
  worker:
    # No logging options defined
```
**Impact:** Container logs grow unbounded, potentially filling disk space. No centralized logging for security analysis.  
**Remediation:**
1. Add log rotation:
```yaml
logging:
  driver: "json-file"
  options:
    max-size: "100m"
    max-file: "5"
```
2. Consider centralized logging (ELK, Fluentd, cloud provider)

---

### FIND-018: CI Uses Different Postgres Version Than Production
**Severity:** P2 - Medium  
**File:** `.github/workflows/ci.yml` line 25, `docker-compose.yml` line 4  
**Evidence:**
```yaml
# CI: postgres:15-alpine
services:
  postgres:
    image: postgres:15-alpine

# Production: postgres:16-alpine
services:
  postgres:
    image: postgres:16-alpine
```
**Impact:** Version mismatch between CI and production may mask compatibility issues or behavior differences.  
**Remediation:**
1. Align CI with production version:
```yaml
services:
  postgres:
    image: postgres:16-alpine
```

---

### FIND-019: No Readiness Probe for Worker Service
**Severity:** P2 - Medium  
**File:** `docker-compose.yml` (worker service)  
**Evidence:**
```yaml
worker:
  # No healthcheck defined
```
**Impact:** Cannot determine if worker is healthy and processing jobs. Failed workers may go undetected.  
**Remediation:**
1. Add health check endpoint to worker
2. Configure Docker health check:
```yaml
healthcheck:
  test: ["CMD-SHELL", "node -e \"require('./healthcheck.js')\""]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

## 5. Low Findings (P3)

### FIND-020: .env.example Missing Critical Variables
**Severity:** P3 - Low  
**File:** `.env.example`  
**Evidence:**
```bash
# File described as having placeholder values but not all variables documented
```
**Impact:** Incomplete documentation may lead to misconfiguration or missing required variables during deployment.  
**Remediation:**
1. Ensure all variables from `.env` are documented in `.env.example`
2. Add comments explaining each variable's purpose
3. Mark required vs optional variables

---

### FIND-021: Restart Policy Not Optimal for All Services
**Severity:** P3 - Low  
**File:** `docker-compose.yml`  
**Evidence:**
```yaml
services:
  minio-setup:
    # No restart policy - one-time job
```
**Impact:** `minio-setup` is a one-time job but has no explicit restart policy. May restart unexpectedly on failure.  
**Remediation:**
1. Add explicit restart policy for one-time jobs:
```yaml
minio-setup:
  restart: "no"
```

---

### FIND-022: Nginx Location Block Missing Trailing Slash Consistency
**Severity:** P3 - Low  
**File:** `docker/nginx/default.conf`  
**Evidence:**
```nginx
location /cap3/ { proxy_pass http://minio:9000/cap3/; }
location /api { proxy_pass http://web-api:3000; }
```
**Impact:** Inconsistent trailing slashes may cause unexpected routing behavior or redirect loops.  
**Remediation:**
1. Standardize trailing slashes:
```nginx
location /api/ { proxy_pass http://web-api:3000/; }
```

---

### FIND-023: No Container Read-Only Filesystem
**Severity:** P3 - Low  
**File:** `docker-compose.yml` (all services)  
**Evidence:**
```yaml
services:
  web-api:
    # No read_only: true
```
**Impact:** Containers can write to filesystem, allowing attackers to modify application or install malware.  
**Remediation:**
1. Enable read-only filesystem where possible:
```yaml
services:
  web-api:
    read_only: true
    tmpfs:
      - /tmp
```

---

## 6. Recommendations - Prioritized Remediation Plan

### Immediate (24-48 hours)
1. **Rotate all exposed API keys** (FIND-001)
2. **Remove default credentials** from docker-compose.yml (FIND-002)
3. **Add resource limits** to all services (FIND-003)
4. **Restrict CORS configuration** (FIND-004)

### Short-term (Next Sprint - 1-2 weeks)
5. **Implement non-root containers** (FIND-006)
6. **Add network isolation** (FIND-007)
7. **Restrict MinIO console access** (FIND-008)
8. **Update CI actions** (FIND-009)
9. **Add health checks** for all services (FIND-010, FIND-019)
10. **Add security headers** to Nginx (FIND-012)
11. **Implement CI security scanning** (FIND-013)

### Medium-term (Next Quarter)
12. **Remove database port exposure** (FIND-014)
13. **Fix MinIO bucket permissions** (FIND-015)
14. **Pin dependency versions** (FIND-016)
15. **Add log rotation** (FIND-017)
16. **Align CI and production versions** (FIND-018)

### Long-term (Ongoing)
17. **Complete .env.example documentation** (FIND-020)
18. **Standardize Nginx configuration** (FIND-022)
19. **Enable read-only filesystems** where possible (FIND-023)
20. **Implement secret management solution** (Vault, AWS Secrets Manager)
21. **Add runtime security monitoring** (Falco, etc.)

---

## Appendix A: Secrets Rotation Checklist

- [ ] **Deepgram API Key** - Regenerate at https://console.deepgram.com
- [ ] **Groq API Key** - Regenerate at https://console.groq.com
- [ ] **Gemini API Key** - Regenerate at https://ai.google.dev
- [ ] **Database Password** - Update PostgreSQL credentials
- [ ] **MinIO Root Password** - Update MinIO credentials
- [ ] **Webhook Secret** - Generate new cryptographically secure secret

## Appendix B: Security Tooling Recommendations

| Category | Tool | Purpose |
|----------|------|---------|
| Secret Detection | TruffleHog, git-secrets | Prevent secret commits |
| Dependency Scanning | Snyk, npm audit | Find vulnerable dependencies |
| Container Scanning | Trivy, Grype | Scan images for CVEs |
| Runtime Security | Falco | Detect anomalous behavior |
| Network Policy | Calico, Cilium | Kubernetes network policies |

---

*End of Infrastructure Security Audit Report*
