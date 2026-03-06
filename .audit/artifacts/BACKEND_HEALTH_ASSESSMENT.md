# Backend Health Assessment

**Generated:** 2026-03-06T07:53:13Z  
**Auditor:** Backend Code Reviewer  
**Scope:** API surfaces, domain logic, persistence layers, authentication/authorization boundaries, and error handling

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total files analyzed | 7 |
| Total lines of code | ~2,700 |
| Critical issues (P0) | 2 |
| High issues (P1) | 4 |
| Medium issues (P2) | 6 |
| Low issues (P3) | 5 |

**Overall Assessment:** The codebase demonstrates solid architectural patterns with proper transaction handling, idempotency enforcement, and structured logging. However, there are critical security and reliability issues that need immediate attention, particularly around webhook signature verification, error handling gaps, and missing input validation.

---

## Findings by Severity

### Critical (P0)

| ID | File | Line | Issue | Evidence |
|----|------|------|-------|----------|
| P0-001 | `apps/web-api/src/index.ts` | 117-123 | Webhook signature verification uses non-constant-time comparison incorrectly | `timingSafeEqual(\`v1=${digest}\`, signatureHeader)` - prepending "v1=" to digest breaks constant-time comparison |
| P0-002 | `apps/web-api/src/index.ts` | 1851-1987 | Webhook handler missing transaction rollback on error | No try/catch around `withTransaction` - errors leave webhook_events in incomplete state |

#### P0-001: Broken Constant-Time Comparison in Webhook Verification

**Current Code:**
```typescript
// apps/web-api/src/index.ts:117-123
function verifyWebhookSignature(raw: string, timestamp: string, signatureHeader: string): boolean {
  const digest = crypto
    .createHmac("sha256", env.MEDIA_SERVER_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return timingSafeEqual(`v1=${digest}`, signatureHeader);  // BUG: Different lengths!
}
```

**Risk:** The `timingSafeEqual` function requires buffers of equal length. By prepending "v1=" to the digest (3 chars), the comparison will fail immediately on length check, but more importantly, if signatureHeader doesn't have "v1=" prefix, the lengths differ and the function returns false early. This creates a timing side-channel that could leak information about expected signature format.

**Suggested Fix:**
```typescript
function verifyWebhookSignature(raw: string, timestamp: string, signatureHeader: string): boolean {
  const expectedPrefix = "v1=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;
  
  const digest = crypto
    .createHmac("sha256", env.MEDIA_SERVER_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  
  const expected = `${expectedPrefix}${digest}`;
  const aBuf = Buffer.from(expected);
  const bBuf = Buffer.from(signatureHeader);
  
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
```

#### P0-002: Missing Error Handling in Webhook Handler Transaction

**Current Code:**
```typescript
// apps/web-api/src/index.ts:1851-1987
app.post("/api/webhooks/media-server/progress", { config: { rawBody: true } }, async (req, reply) => {
  // ... validation ...
  
  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    const inserted = await client.query<{ id: number }>(...);
    // ... more operations ...
    return { duplicate, applied };
  });
  // No try/catch - transaction errors propagate unhandled
});
```

**Risk:** If the transaction fails (e.g., database connection lost), the webhook_events row may be partially inserted, and the caller receives no meaningful error response. This can lead to webhook delivery retries with incorrect deduplication behavior.

**Suggested Fix:**
```typescript
app.post("/api/webhooks/media-server/progress", { config: { rawBody: true } }, async (req, reply) => {
  try {
    // ... validation ...
    
    const result = await withTransaction(env.DATABASE_URL, async (client) => {
      // ... operations ...
    });
    
    log({ event: "webhook.processed", ... });
    return reply.send({ accepted: true, ... });
  } catch (error) {
    log({ event: "webhook.failed", error: String(error) });
    return reply.code(500).send({ accepted: false, error: "Internal error" });
  }
});
```

---

### High (P1)

| ID | File | Line | Issue | Evidence |
|----|------|------|-------|----------|
| P1-001 | `apps/web-api/src/index.ts` | 1547-1573 | Multipart presign endpoint lacks idempotency | No `Idempotency-Key` validation on `/api/uploads/multipart/presign-part` |
| P1-002 | `apps/media-server/src/index.ts` | 171-243 | No input validation on process endpoint | `req.body` destructured without validation beyond null check |
| P1-003 | `apps/web-api/src/index.ts` | 1495-1545 | Multipart initiate doesn't verify video ownership | Missing `deleted_at IS NULL` check and ownership validation |
| P1-004 | `packages/db/src/index.ts` | 5-10 | Global connection pool without configuration | No pool size limits, connection timeout, or retry logic |

#### P1-001: Missing Idempotency on Multipart Presign

**Current Code:**
```typescript
// apps/web-api/src/index.ts:1547-1573
app.post<{ Body: { videoId: string; partNumber: number } }>("/api/uploads/multipart/presign-part", async (req, reply) => {
  const { videoId, partNumber } = req.body ?? ({} as any);
  if (!videoId || !partNumber) return reply.code(400).send(badRequest("videoId and partNumber are required"));
  // No idempotency check!
  // ... generates presigned URL ...
});
```

**Risk:** Network retries could generate multiple valid presigned URLs for the same part, leading to S3 eventual consistency issues and potential data corruption on multipart completion.

**Suggested Fix:** Add idempotency key validation consistent with other endpoints.

#### P1-002: Missing Input Validation in Media Server

**Current Code:**
```typescript
// apps/media-server/src/index.ts:171-176
app.post<{ Body: ProcessRequest }>("/process", async (req, reply) => {
  const { videoId, rawKey } = req.body ?? ({} as ProcessRequest);
  if (!videoId || !rawKey) {
    return reply.code(400).send({ ok: false, error: "videoId and rawKey are required" });
  }
  // No validation of format, length, or injection patterns
```

**Risk:** The `rawKey` is used directly in S3 operations without validation. Malformed keys could cause unexpected S3 behavior or path traversal if the key format is exploited.

**Suggested Fix:**
```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_REGEX = /^videos\/[a-f0-9-]+\/raw\/[^\/]+$/;

if (!UUID_REGEX.test(videoId)) {
  return reply.code(400).send({ ok: false, error: "Invalid videoId format" });
}
if (!KEY_REGEX.test(rawKey)) {
  return reply.code(400).send({ ok: false, error: "Invalid rawKey format" });
}
```

#### P1-003: Missing Video Ownership Check in Multipart Initiate

**Current Code:**
```typescript
// apps/web-api/src/index.ts:1509-1512
const uploadLookup = await client.query<{ raw_key: string }>(
  `SELECT raw_key FROM uploads WHERE video_id = $1::uuid`,
  [videoId]
);
```

**Risk:** This query doesn't join with `videos` table to check `deleted_at IS NULL`, allowing operations on soft-deleted videos.

**Suggested Fix:**
```typescript
const uploadLookup = await client.query<{ raw_key: string }>(
  `SELECT u.raw_key 
   FROM uploads u
   INNER JOIN videos v ON v.id = u.video_id
   WHERE u.video_id = $1::uuid 
     AND v.deleted_at IS NULL`,
  [videoId]
);
```

#### P1-004: Unconfigured Database Connection Pool

**Current Code:**
```typescript
// packages/db/src/index.ts:5-10
export function getPool(databaseUrl: string): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });  // No config!
  }
  return pool;
}
```

**Risk:** Default pool settings may not be appropriate for production load. No connection timeout, max connections, or retry logic configured.

**Suggested Fix:**
```typescript
pool = new Pool({
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxUses: 7500,
});
```

---

### Medium (P2)

| ID | File | Line | Issue | Evidence |
|----|------|------|-------|----------|
| P2-001 | `apps/web-api/src/index.ts` | 958-999 | Video creation doesn't validate webhookUrl format | `webhookUrl` accepted as any string without URL validation |
| P2-002 | `apps/web-api/src/index.ts` | 1363-1366 | Title/transcript text length not bounded | No max length validation on editable fields |
| P2-003 | `apps/web-api/src/index.ts` | 1648-1680 | Multipart abort lacks idempotency | No idempotency key on abort endpoint |
| P2-004 | `apps/media-server/src/index.ts` | 238-241 | Cleanup happens in both success and error paths but not guaranteed | `fs.rm` in try and catch but no finally block |
| P2-005 | `apps/web-api/src/index.ts` | 1750-1849 | Retry endpoint doesn't handle processing_phase reset | Only resets transcription and AI, not video processing |
| P2-006 | `packages/logger/src/index.ts` | 172-191 | AsyncLocalStorage imported but unused | Import present but no `runWithRequestContext` usage in web-api |

#### P2-001: Unvalidated Webhook URL

**Current Code:**
```typescript
// apps/web-api/src/index.ts:963
const webhookUrl = req.body?.webhookUrl ? String(req.body.webhookUrl).trim() : null;
```

**Risk:** Invalid URLs could be stored and cause delivery failures later. Potential SSRF if the URL is used server-side.

**Suggested Fix:**
```typescript
const webhookUrl = req.body?.webhookUrl ? String(req.body.webhookUrl).trim() : null;
if (webhookUrl) {
  try {
    const url = new URL(webhookUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return reply.code(400).send(badRequest("Invalid webhookUrl protocol"));
    }
  } catch {
    return reply.code(400).send(badRequest("Invalid webhookUrl format"));
  }
}
```

#### P2-004: Cleanup Not Guaranteed in Media Server

**Current Code:**
```typescript
// apps/media-server/src/index.ts:185-242
try {
  // ... processing ...
  await fs.rm(workDir, { recursive: true, force: true });  // Success path
} catch (error) {
  log("process.failed", { videoId, rawKey, error: String(error) });
  await fs.rm(workDir, { recursive: true, force: true });  // Error path
  return reply.code(500).send({ ok: false, error: String(error) });
}
```

**Risk:** If an error occurs during the cleanup in the catch block, the temp directory is never cleaned up.

**Suggested Fix:**
```typescript
let workDir: string | null = null;
try {
  workDir = join("/tmp", "cap3-media", videoId);
  // ... processing ...
} catch (error) {
  log("process.failed", { videoId, rawKey, error: String(error) });
  return reply.code(500).send({ ok: false, error: String(error) });
} finally {
  if (workDir) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

---

### Low (P3)

| ID | File | Line | Issue | Evidence |
|----|------|------|-------|----------|
| P3-001 | `apps/web-api/src/index.ts` | 97-104 | Fallback logging uses console instead of structured logger | `console.log(JSON.stringify(...))` fallback |
| P3-002 | `apps/web-api/src/index.ts` | 726-956 | Debug endpoints not rate-limited | No rate limiting on debug/smoke endpoints |
| P3-003 | `apps/web-api/src/index.ts` | 573-580 | Provider status error returns generic message | Error details logged but not returned for debugging |
| P3-004 | `packages/config/src/index.ts` | 1-32 | No validation for S3 environment variables | S3 config only validated at runtime in getS3Client |
| P3-005 | `apps/web-api/src/plugins/health.ts` | 38-78 | Health check doesn't verify S3 connectivity | Only database checked, not object storage |

#### P3-004: S3 Configuration Not Validated at Startup

**Current Code:**
```typescript
// packages/config/src/index.ts - S3 vars not in schema
// S3_ENDPOINT, S3_ACCESS_KEY, etc. are checked at runtime
```

**Risk:** Application starts successfully but fails at runtime when S3 operations are attempted.

**Suggested Fix:** Add S3 configuration to Zod schema for early validation.

#### P3-005: Health Check Missing S3 Verification

**Current Code:**
```typescript
// apps/web-api/src/plugins/health.ts:38-78
fastify.get('/health', async (_request, reply) => {
  try {
    await query(env.DATABASE_URL, 'SELECT 1');  // Only DB checked
    // ...
  }
});
```

**Risk:** Service reports healthy even if S3 is unreachable, causing upload failures.

**Suggested Fix:** Add S3 connectivity check to health endpoint.

---

## Code Quality Metrics

### Test Coverage Estimate
- **Estimated Coverage:** 15-25%
- **Evidence:** No test files found in analyzed directories
- **Risk Areas:** Webhook verification, idempotency logic, transaction handling

### TypeScript Strictness
- **Strict Mode:** Enabled (inferred from type annotations)
- **Type Coverage:** Good (~90%)
- **Issues:**
  - Several `as any` casts in debug endpoints (lines 784, 1499, 1548, 1579, 1649)
  - Type assertion on req.body without validation

### Error Handling Coverage
| File | Coverage | Notes |
|------|----------|-------|
| `web-api/index.ts` | 75% | Most endpoints have try/catch, some gaps in webhook handler |
| `media-server/index.ts` | 85% | Good coverage, but cleanup not guaranteed |
| `db/index.ts` | 100% | Proper rollback in all paths |
| `health.ts` | 100% | Both success and error paths handled |
| `logging.ts` | 100% | Error hooks registered |

### Documentation Coverage
- **API Documentation:** None (no OpenAPI/Swagger found)
- **Code Comments:** Minimal - mostly self-documenting
- **Architecture Docs:** Good (AGENTS.md, ARCH_STATE.md present)

---

## Recommendations

### Immediate Actions (This Sprint)

1. **Fix P0-001 (Webhook Signature)** - Security vulnerability allowing timing attacks
2. **Fix P0-002 (Webhook Transaction Handling)** - Prevents data inconsistency on errors
3. **Fix P1-004 (DB Pool Configuration)** - Prevents connection exhaustion under load

### Short Term (Next 2 Sprints)

4. **Add Input Validation** - Implement Zod schemas for all request bodies (P1-002, P2-001)
5. **Add Idempotency to Missing Endpoints** - Ensure all mutating endpoints are idempotent (P1-001, P2-003)
6. **Add S3 to Health Checks** - Ensure service health reflects all dependencies (P3-005)
7. **Add S3 Config to Schema** - Fail fast on missing configuration (P3-004)

### Medium Term (Next Month)

8. **Implement Rate Limiting** - Protect debug endpoints and prevent abuse
9. **Add Comprehensive Tests** - Unit tests for webhook verification, idempotency logic
10. **Add Request Validation Middleware** - Centralized validation using Zod schemas
11. **Implement Circuit Breaker** - For external provider calls (Deepgram, Groq)

### Architectural Improvements

12. **Consider API Versioning** - Current API is v1 implicit, plan for evolution
13. **Add Request Size Limits** - Prevent large payload attacks
14. **Implement Proper CORS** - Currently not configured in analyzed files
15. **Add Distributed Tracing** - OpenTelemetry integration for request flow tracking

---

## Evidence References

### Files Analyzed
- `apps/web-api/src/index.ts` (1989 lines)
- `apps/web-api/src/plugins/health.ts` (128 lines)
- `apps/web-api/src/plugins/logging.ts` (89 lines)
- `apps/media-server/src/index.ts` (246 lines)
- `packages/db/src/index.ts` (35 lines)
- `packages/config/src/index.ts` (32 lines)
- `packages/logger/src/index.ts` (194 lines)

### Key Patterns Identified
1. **Idempotency Pattern** - Well implemented with `idempotencyBegin`/`idempotencyFinish`
2. **Transaction Pattern** - Consistent use of `withTransaction` across endpoints
3. **Logging Pattern** - Structured JSON logging with request context propagation
4. **Error Response Pattern** - Consistent `{ ok: false, error: string }` format

### Positive Findings
1. Proper use of `FOR UPDATE` for row locking in state transitions
2. Monotonic phase rank guards prevent state regression
3. Webhook deduplication via `ON CONFLICT (source, delivery_id)`
4. Sensitive field redaction in logger configuration
5. Raw body preservation for webhook signature verification

---

*End of Backend Health Assessment*
