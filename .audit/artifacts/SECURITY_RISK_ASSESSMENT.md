# Cap3 Security Risk Assessment

**Generated:** 2026-03-06  
**Auditor:** Operational Risk Assessor  
**Scope:** Synthesis of all audit findings to identify systemic security vulnerabilities and operational risks

---

## 1. Executive Summary

### Overall Risk Score: HIGH (7.2/10)

| Category | Score | Status |
|----------|-------|--------|
| Security Posture | 6.5/10 | ⚠️ Vulnerable |
| Operational Resilience | 7.0/10 | ⚠️ Moderate Risk |
| Compliance Readiness | 6.0/10 | ⚠️ Non-Compliant |
| Documentation Accuracy | 7.5/10 | ✅ Adequate |

### Top 5 Critical Concerns

1. **Defense in Depth Gaps** - No network isolation, rate limiting, or input validation
2. **Secret Management Flaws** - API keys exposed in git history, no secret rotation mechanism
3. **Single Point of Failure** - Worker singleton, single database instance
4. **Supply Chain Vulnerabilities** - Known CVEs in dependencies, CI version mismatches
5. **Cascade Failure Risk** - Provider failures can overwhelm job queue

### P0 Fixes Verified

| Fix | Status | Date |
|-----|--------|------|
| timingSafeEqual vulnerability | ✅ Fixed | 2026-03-06 |
| Webhook transaction error handling | ✅ Fixed | 2026-03-06 |
| Job acknowledgment in worker | ✅ Fixed | 2026-03-06 |
| Hardcoded API keys removed | ✅ Fixed | 2026-03-06 |
| Default credentials removed | ✅ Fixed | 2026-03-06 |
| Docker resource limits added | ✅ Fixed | 2026-03-06 |
| CORS configuration restricted | ✅ Fixed | 2026-03-06 |

---

## 2. Systemic Security Issues

### SYS-001: Defense in Depth Gaps

**Risk Level:** Critical  
**Sources:** INFRASTRUCTURE_AUDIT.md FIND-007, BACKEND_HEALTH_ASSESSMENT.md P1-003

**Findings:**
- No network isolation between services (all on default bridge)
- No rate limiting on API endpoints
- Missing input validation on webhook payloads
- No WAF or API gateway protection

**Attack Scenario:**
1. Attacker discovers webhook endpoint via reconnaissance
2. Floods endpoint with invalid payloads (no rate limiting)
3. Database connection pool exhausted
4. Legitimate webhook deliveries fail
5. Processing pipeline stalls

**Mitigation:**
- Implement network segmentation (frontend/backend/storage networks)
- Add rate limiting middleware (e.g., `@fastify/rate-limit`)
- Implement strict input validation schemas (Zod)
- Deploy API gateway with WAF rules

---

### SYS-002: Secret Management Architecture Flaws

**Risk Level:** Critical  
**Sources:** INFRASTRUCTURE_AUDIT.md FIND-001, FIND-002

**Findings:**
- API keys were committed to git history (Deepgram, Groq, Gemini)
- No secret rotation mechanism
- No runtime secret injection (Docker secrets, Vault)
- Database credentials in environment variables

**Attack Scenario:**
1. Attacker scans public git history for secrets
2. Finds exposed API keys in old commits
3. Uses keys to access Deepgram/Groq APIs
4. Financial liability from API usage
5. Potential data exfiltration via transcription

**Mitigation:**
- Rotate all exposed keys immediately
- Scrub git history using git-filter-repo
- Implement Docker secrets or HashiCorp Vault
- Add pre-commit hooks (git-secrets, detect-secrets)

---

### SYS-003: Supply Chain Vulnerabilities

**Risk Level:** High  
**Sources:** DEPENDENCY_ANALYSIS.md DEPS-001, DEPS-002, DEPS-008

**Findings:**
- Fastify CVE-2025-32442 (content-type validation bypass)
- Zod CVE-2023-4316 (ReDoS in email validation)
- pnpm version mismatch between CI (8.x) and local (9.12.3)
- No dependency vulnerability scanning in CI

**Attack Scenario:**
1. Attacker identifies Fastify version via error messages
2. Crafts malicious Content-Type header to bypass validation
3. Injects unexpected payload structure
4. Exploits downstream code assumptions
5. Achieves RCE or data exfiltration

**Mitigation:**
- Update Fastify to patched version
- Pin Zod to `^3.22.4` minimum
- Align CI pnpm version with packageManager field
- Add `pnpm audit` to CI pipeline

---

## 3. Operational Risk Matrix

### Single Points of Failure (SPOF)

| Component | SPOF? | Impact | Mitigation Priority |
|-----------|-------|--------|---------------------|
| PostgreSQL | Yes | Complete system outage | High - Add read replica |
| Worker (singleton) | Yes | Processing backlog | High - Scale horizontally |
| MinIO | Yes | Storage unavailable | Medium - Multi-node setup |
| web-api | No | Partial outage | Low - Can restart quickly |

### Cascade Failure Scenarios

#### Scenario 1: Provider Failure Cascade

**Trigger:** Deepgram API outage

**Chain:**
1. Transcription jobs fail repeatedly
2. Worker lease timeouts accumulate
3. Dead letter queue fills
4. Database disk space consumed by error logs
5. API responses slow due to DB load
6. User experience degrades

**Mitigation:**
- Implement circuit breaker pattern
- Add provider health checks
- Implement exponential backoff with jitter
- Set dead letter retention limits

#### Scenario 2: Resource Exhaustion Cascade

**Trigger:** Large video upload (4K, 2 hours)

**Chain:**
1. FFmpeg consumes all worker CPU/memory
2. Resource limits now prevent OOM (fixed)
3. But job remains in processing state
4. Lease expires, job reclaimed
5. Another worker picks up same job
6. Infinite loop of failed processing

**Mitigation:**
- Implement job size limits
- Add processing timeout per video duration
- Implement job "poison pill" detection

#### Scenario 3: Database Connection Pool Exhaustion

**Trigger:** Webhook flood + Slow DB queries

**Chain:**
1. Webhook handler opens DB connections
2. Slow queries hold connections
3. Pool exhausted
4. New webhooks rejected
5. Media server retries amplify load
6. Complete API outage

**Mitigation:**
- Implement connection pool monitoring
- Add query timeout limits
- Implement webhook queue (async processing)
- Add circuit breaker for DB operations

---

## 4. Blast Radius Analysis

### Component Failure Impact

#### PostgreSQL Failure

**Impact:** Catastrophic
- All API operations fail
- Job queue inaccessible
- No video uploads possible
- No status queries possible

**Recovery Time:** 5-30 minutes (depending on backup)

**Data Loss Risk:** Low (with proper backups)

#### Worker Failure

**Impact:** High
- New jobs not processed
- Existing jobs may stall
- Uploads still accepted
- API remains operational

**Recovery Time:** 1-5 minutes (container restart)

**Data Loss Risk:** None (jobs persist in queue)

#### Media Server Failure

**Impact:** Medium
- Video processing stalls
- Transcription may continue
- API remains operational
- Uploads still accepted

**Recovery Time:** 1-2 minutes

**Data Loss Risk:** None (can retry processing)

#### MinIO Failure

**Impact:** High
- Uploads fail
- Video playback fails
- Processing fails (needs S3 access)

**Recovery Time:** 1-5 minutes

**Data Loss Risk:** Medium (if data not replicated)

#### Web API Failure

**Impact:** Medium
- Uploads not possible
- Status queries fail
- Processing continues in background

**Recovery Time:** 30 seconds - 2 minutes

**Data Loss Risk:** None

---

## 5. Attack Scenarios

### Scenario 1: Webhook Replay Attack

**Prerequisites:**
- Attacker intercepts valid webhook payload
- Attacker knows webhook secret (from git history)

**Attack:**
1. Attacker captures webhook from media-server
2. Replays webhook to `/api/webhooks/media-server/progress`
3. Signature verification passes (if timingSafeEqual fixed)
4. Duplicate processing triggered
5. Video state corrupted

**Mitigation:**
- Webhook deduplication (already implemented)
- Timestamp validation (max skew: 300s)
- IP allowlisting for media-server

### Scenario 2: Job Queue Poisoning

**Prerequisites:**
- Attacker has API access (no auth required by design)

**Attack:**
1. Attacker uploads many small videos
2. Each upload enqueues processing job
3. Queue fills with attacker jobs
4. Legitimate user jobs delayed
5. Worker capacity exhausted

**Mitigation:**
- Implement per-IP rate limiting
- Add job priority levels
- Implement queue depth monitoring/alerts

### Scenario 3: Resource Exhaustion Attack

**Prerequisites:**
- Docker resource limits not enforced (FIXED)

**Attack:**
1. Attacker uploads extremely large video
2. FFmpeg consumes all resources
3. Other services starved
4. System becomes unresponsive

**Mitigation:**
- Resource limits now enforced (FIXED)
- Add video size limits
- Implement processing quotas

### Scenario 4: Provider API Abuse

**Prerequisites:**
- Attacker obtains API keys from git history

**Attack:**
1. Attacker uses exposed Deepgram key
2. Makes unauthorized transcription requests
3. Accrues charges on owner's account
4. Potential data exfiltration

**Mitigation:**
- Rotate all exposed keys (ACTION REQUIRED)
- Implement API key usage monitoring
- Set provider spending limits

### Scenario 5: SQL Injection via Webhook

**Prerequisites:**
- Dynamic query construction vulnerability

**Attack:**
1. Attacker crafts malicious webhook payload
2. Payload contains SQL injection
3. Database compromised
4. Data exfiltration or corruption

**Mitigation:**
- Use parameterized queries (mostly implemented)
- Add strict input validation
- Implement WAF rules

---

## 6. Risk Prioritization

| Risk ID | Description | Impact | Likelihood | Risk Score | Priority |
|---------|-------------|--------|------------|------------|----------|
| R-001 | Exposed API keys in git history | 9 | 8 | 72 | P0 |
| R-002 | No network isolation | 8 | 6 | 48 | P1 |
| R-003 | Worker singleton SPOF | 8 | 5 | 40 | P1 |
| R-004 | Fastify CVE-2025-32442 | 7 | 6 | 42 | P1 |
| R-005 | No rate limiting | 7 | 7 | 49 | P1 |
| R-006 | Database SPOF | 9 | 4 | 36 | P1 |
| R-007 | Provider failure cascade | 6 | 7 | 42 | P1 |
| R-008 | Secret management gaps | 8 | 5 | 40 | P1 |
| R-009 | CI version mismatch | 5 | 8 | 40 | P2 |
| R-010 | Missing input validation | 6 | 6 | 36 | P2 |
| R-011 | No circuit breaker | 5 | 7 | 35 | P2 |
| R-012 | Zod CVE-2023-4316 | 5 | 5 | 25 | P2 |
| R-013 | Documentation inaccuracies | 4 | 6 | 24 | P3 |
| R-014 | Deprecated CI actions | 3 | 7 | 21 | P3 |

---

## 7. Mitigation Roadmap

### Phase 1: Immediate (0-2 weeks)

1. **Rotate Exposed API Keys**
   - Deepgram: https://console.deepgram.com
   - Groq: https://console.groq.com
   - Gemini: https://ai.google.dev

2. **Scrub Git History**
   ```bash
   pip install git-filter-repo
   git filter-repo --replace-text <(echo 'DEEPGRAM_API_KEY=xxx==>DEARTED')
   ```

3. **Fix SQL Injection Risk**
   - Audit all dynamic query construction
   - Add parameterized query enforcement

4. **Add Connection Pool Limits**
   ```typescript
   const pool = new Pool({
     max: 20,
     idleTimeoutMillis: 30000,
     connectionTimeoutMillis: 2000
   });
   ```

### Phase 2: Short-term (2-4 weeks)

5. **Implement Rate Limiting**
   ```typescript
   import rateLimit from '@fastify/rate-limit'
   app.register(rateLimit, {
     max: 100,
     timeWindow: '1 minute'
   })
   ```

6. **Add Input Validation**
   - Implement Zod schemas for all inputs
   - Add strict payload size limits

7. **Implement Circuit Breaker**
   ```typescript
   import CircuitBreaker from 'opossum'
   const breaker = new CircuitBreaker(providerCall, {
     timeout: 3000,
     errorThresholdPercentage: 50,
     resetTimeout: 30000
   })
   ```

8. **Add Health Monitoring**
   - Provider health checks
   - Database connection monitoring
   - Queue depth alerts

### Phase 3: Medium-term (1-2 months)

9. **Database Replication**
   - Add read replica for queries
   - Implement failover mechanism

10. **Worker Horizontal Scaling**
    - Make worker stateless
    - Support multiple worker instances

11. **Multi-region S3**
    - Configure cross-region replication
    - Implement failover logic

12. **Provider Fallback**
    - Secondary STT provider
    - Secondary LLM provider

### Phase 4: Ongoing

13. **Security Monitoring**
    - Deploy Falco for runtime security
    - Implement SIEM integration

14. **Compliance Automation**
    - Automated secret scanning
    - Dependency vulnerability scanning
    - Container image scanning

---

## 8. Compliance & Audit

### Data Handling Practices

| Data Type | Storage | Encryption | Retention |
|-----------|---------|------------|-----------|
| Video files | MinIO/S3 | At-rest (server-side) | Until deleted |
| Transcripts | PostgreSQL | Database-level | Until video deleted |
| API keys | Environment | None (in transit only) | N/A |
| Job metadata | PostgreSQL | Database-level | 30 days |

**Gaps:**
- No encryption at rest for database
- No field-level encryption for sensitive data
- No data classification policy

### Audit Trail Completeness

| Event | Logged | Structured | Retention |
|-------|--------|------------|-----------|
| Video upload | ✅ | ✅ | 30 days |
| Processing state change | ✅ | ✅ | 30 days |
| Webhook delivery | ✅ | ✅ | 30 days |
| API errors | ✅ | ✅ | 30 days |
| Authentication | N/A | N/A | N/A |

**Gaps:**
- No centralized audit log
- No tamper-proof logging
- No audit log access controls

### Retention Policy Gaps

- No formal data retention policy documented
- No automated data purging
- No legal hold mechanism

---

## 9. Evidence Contract

### Files Referenced

| File | Purpose |
|------|---------|
| `apps/web-api/src/index.ts` | API endpoints, webhook handling |
| `apps/worker/src/index.ts` | Job processing logic |
| `docker-compose.yml` | Service topology |
| `.github/workflows/ci.yml` | CI/CD pipeline |
| `INFRASTRUCTURE_AUDIT.md` | Infrastructure findings |
| `DEPENDENCY_ANALYSIS.md` | Dependency vulnerabilities |
| `BACKEND_HEALTH_ASSESSMENT.md` | Code security findings |
| `QUEUE_LOGIC_AUDIT.md` | Worker/queue findings |

### Key Code References

- **Webhook verification:** `apps/web-api/src/index.ts` lines 110-130
- **Transaction handling:** `apps/web-api/src/index.ts` lines 1851-1987
- **Job acknowledgment:** `apps/worker/src/index.ts` lines 765-770
- **Rate limiting:** Not implemented
- **Input validation:** Partial implementation

---

*End of Security Risk Assessment*
