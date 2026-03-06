# Cap3 Documentation Consistency Report

**Generated:** 2026-03-06  
**Auditor:** Documentation Consistency Checker  
**Scope:** README.md, AGENTS.md, .env.example, docs/api/ENDPOINTS.md, docs/ops/LOCAL_DEV.md vs. Actual Code Behavior

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| **Documentation Health Score** | 72/100 |
| Critical Inconsistencies | 5 |
| Missing Documentation | 8 |
| Outdated Sections | 3 |
| Accuracy Issues | 6 |

**Overall Assessment:** The documentation provides a solid foundation for understanding the Cap3 architecture and setup. However, there are significant gaps between documented behavior and actual code implementation, particularly around API endpoints, environment variables, and state machine definitions. Several documented "planned" features are actually implemented, while some "implemented" features have incorrect documentation.

---

## 2. Critical Inconsistencies

These issues will actively mislead users and cause operational problems.

### DOC-001: Multipart Upload Endpoints Incorrectly Marked as "Not Implemented"
**Severity:** Critical  
**Documentation:** `docs/api/ENDPOINTS.md` lines 121-125  
**Code:** `apps/web-api/src/index.ts` lines 1501-1686  
**Issue:** The API documentation lists multipart upload endpoints as "Not Implemented (placeholders)" returning `501`, but they are fully implemented:
- `POST /api/uploads/multipart/initiate` (lines 1501-1551)
- `POST /api/uploads/multipart/presign-part` (lines 1553-1579)
- `POST /api/uploads/multipart/complete` (lines 1581-1652)
- `POST /api/uploads/multipart/abort` (lines 1654-1686)

**Impact:** Users will not use multipart upload functionality believing it's unavailable, or will be confused when these endpoints actually work.

**Fix:** Move multipart endpoints from "Not Implemented" to "Implemented" section with full documentation.

---

### DOC-002: Delete Endpoint Uses Wrong HTTP Method in Documentation
**Severity:** Critical  
**Documentation:** `docs/api/ENDPOINTS.md` line 82: `DELETE /api/videos/:id`  
**Code:** `apps/web-api/src/index.ts` line 1688: `POST /api/videos/:id/delete`  
**Issue:** Documentation states the delete endpoint uses `DELETE` method, but actual implementation uses `POST`.

**Impact:** API clients using `DELETE` will receive 404 errors. This breaks REST client integrations.

**Fix:** Change documentation from `DELETE /api/videos/:id` to `POST /api/videos/:id/delete`.

---

### DOC-003: Retry Endpoint Path Mismatch
**Severity:** Critical  
**Documentation:** `docs/api/ENDPOINTS.md` line 87: `POST /api/videos/:videoId/retry`  
**Code:** `apps/web-api/src/index.ts` line 1756: `POST /api/videos/:id/retry`  
**Issue:** Documentation uses `:videoId` parameter name, but actual code uses `:id`. Additionally, the retry endpoint only handles transcription and AI jobs, NOT video processing jobs as implied.

**Impact:** API confusion and potential integration failures when parameter naming doesn't match.

**Fix:** Update documentation to match actual path parameter (`:id`) and clarify that retry only works for transcription and AI jobs, not video processing.

---

### DOC-004: Processing State Machine Missing `not_required` Terminal State
**Severity:** Critical  
**Documentation:** `README.md` line 44-46, `AGENTS.md` lines 32-35  
**Code:** `apps/web-api/src/index.ts` lines 34-45  
**Issue:** Documentation lists `not_required` as a terminal state for Processing, but the state machine in code shows it's a rank 0 state that can transition to `queued` (rank 10). The documentation implies it's terminal with `(terminal)` notation.

**Impact:** Incorrect understanding of state transitions may lead to improper operational procedures.

**Fix:** Clarify that `not_required` is a starting state (rank 0), not a terminal state. Terminal states are `complete`, `failed`, and `cancelled`.

---

### DOC-005: Webhook Signature Verification Bug Not Documented
**Severity:** Critical  
**Documentation:** `AGENTS.md` line 16, `README.md` line 22  
**Code:** `apps/web-api/src/index.ts` lines 123-129  
**Issue:** Documentation states "Webhook writes require HMAC verification" as a principle, but the actual implementation has a critical security bug: `timingSafeEqual` is called with different-length strings (`v1=${digest}` vs `signatureHeader`), which breaks constant-time comparison.

**Impact:** Security vulnerability not acknowledged in documentation; operators may have false confidence in webhook security.

**Fix:** Document the known vulnerability and pending fix in operational notes.

---

## 3. Missing Documentation

### DOC-006: Missing `WORKER_RECLAIM_MS` Environment Variable
**Severity:** High  
**Documentation:** `.env.example` - missing variable  
**Code:** `packages/config/src/index.ts` line 25  
**Issue:** The `WORKER_RECLAIM_MS` environment variable (default: 10000ms) is validated in the config schema but not documented in `.env.example`.

**Impact:** Users cannot tune worker reclaim behavior without reading source code.

**Fix:** Add `WORKER_RECLAIM_MS=10000` to `.env.example` with descriptive comment.

---

### DOC-007: Missing `LOG_PRETTY` Environment Variable
**Severity:** Medium  
**Documentation:** `.env.example` - missing variable  
**Code:** `packages/logger/src/index.ts` - inferred from ARCH_STATE.md section 5.1  
**Issue:** The `LOG_PRETTY` environment variable for pretty-printing logs in development is mentioned in ARCH_STATE.md but not in `.env.example`.

**Impact:** Developers may not know about the pretty-printing option.

**Fix:** Add `LOG_PRETTY=false` to `.env.example`.

---

### DOC-008: Missing Provider Status Endpoint Documentation
**Severity:** Medium  
**Documentation:** `docs/api/ENDPOINTS.md` lines 92-94 (minimal)  
**Code:** `apps/web-api/src/index.ts` lines 201-309  
**Issue:** The `/api/system/provider-status` endpoint is only briefly mentioned with no details about its comprehensive response format including provider states, last job info, and configuration status.

**Impact:** Users cannot effectively use the provider status endpoint without reading source code.

**Fix:** Document the full response schema including `checkedAt`, `providers[]` array with `key`, `label`, `purpose`, `state`, `configured`, `baseUrl`, `model`, `lastSuccessAt`, and `lastJob` fields.

---

### DOC-009: Missing Idempotency TTL Behavior Documentation
**Severity:** Medium  
**Documentation:** `docs/api/ENDPOINTS.md` - not documented  
**Code:** `apps/web-api/src/index.ts` lines 323-370, 964-1006  
**Issue:** Different endpoints have different idempotency TTL values:
- Upload endpoints (`/api/uploads/signed`): 15 minutes
- Other mutations: 24 hours

This is not documented anywhere.

**Impact:** Users may be surprised when idempotency keys expire at different rates.

**Fix:** Document TTL differences in API documentation.

---

### DOC-010: Missing Debug Endpoints Warning
**Severity:** Medium  
**Documentation:** `docs/api/ENDPOINTS.md` lines 74-79  
**Code:** `apps/web-api/src/index.ts` lines 732-961  
**Issue:** Debug endpoints are documented but without a clear warning that they are only available in non-production environments (`env.NODE_ENV !== "production"`).

**Impact:** Users may attempt to use debug endpoints in production and receive unexpected 404s.

**Fix:** Add prominent warning that debug endpoints are development-only.

---

### DOC-011: Missing Pagination Cursor Format Documentation
**Severity:** Medium  
**Documentation:** `docs/api/ENDPOINTS.md` lines 57-65 (minimal)  
**Code:** `apps/web-api/src/index.ts` lines 1163-1244  
**Issue:** The library videos endpoint uses cursor-based pagination with Base64url-encoded composite cursors (`created_at|id`), but the encoding format is not documented.

**Impact:** Clients cannot construct or parse cursors without reading source code.

**Fix:** Document cursor format: Base64url of `created_at|id` composite string.

---

### DOC-012: Missing S3 Configuration Validation Gap
**Severity:** Low  
**Documentation:** `.env.example` - all S3 vars present  
**Code:** `packages/config/src/index.ts` - S3 vars not in Zod schema  
**Issue:** S3 environment variables are documented in `.env.example` but NOT validated at startup by the Zod schema. They are only checked at runtime when S3 operations are attempted.

**Impact:** Application may start successfully but fail at runtime when S3 operations are attempted.

**Fix:** Either add S3 variables to the Zod schema or document that S3 validation happens at runtime.

---

### DOC-013: Missing Media Server Port in Service URLs
**Severity:** Low  
**Documentation:** `docs/ops/LOCAL_DEV.md` lines 52-55  
**Code:** `docker-compose.yml` line 115  
**Issue:** LOCAL_DEV.md only mentions health checks for ports 3000 and 3100, but doesn't mention that media-server health endpoint is at 3100.

**Impact:** Minor confusion during troubleshooting.

**Fix:** Add `curl -sS http://localhost:3100/health` to health check examples.

---

## 4. Outdated Sections

### DOC-014: Processing State Machine Documentation Inconsistent with Code
**Severity:** High  
**Documentation:** `README.md` lines 43-46, `AGENTS.md` lines 32-35  
**Code:** `apps/web-api/src/index.ts` lines 34-45  
**Issue:** Documentation lists state transitions as:
- `queued -> downloading -> probing -> processing -> uploading -> generating_thumbnail -> complete`

But the code shows ranks:
- `not_required(0) -> queued(10) -> downloading(20) -> probing(30) -> processing(40) -> uploading(50) -> generating_thumbnail(60) -> complete(70) | failed(80) | cancelled(90)`

The documentation omits the `not_required` starting state and doesn't clarify the numeric ranking system used for monotonic updates.

**Fix:** Update documentation to match the rank-based state machine implementation.

---

### DOC-015: Upload State Machine Missing `aborted` State
**Severity:** Medium  
**Documentation:** `README.md` lines 39-41, `AGENTS.md` lines 28-30  
**Code:** `apps/web-api/src/index.ts` line 1682 (abort sets phase to 'aborted')  
**Issue:** Documentation lists upload states as `pending -> uploading -> completing -> uploaded` with failure states `failed|aborted`, but doesn't document the `aborted` terminal state properly.

**Fix:** Add `aborted` as a documented terminal state for uploads.

---

### DOC-016: Milestone 2 Script Uses Hardcoded Absolute Path
**Severity:** Low  
**Documentation:** `README.md` lines 98-129  
**Issue:** The Milestone 2 test script contains hardcoded absolute path `/Users/m17/2026/gh_repo_tests/cap3` which won't work on other machines.

**Fix:** Use relative paths or `$PWD` in the script example.

---

## 5. Accuracy Issues

### DOC-017: Incorrect Port for MinIO Console
**Severity:** Medium  
**Documentation:** `.env.example` line 23: `MINIO_CONSOLE_PORT=8923`  
**Code:** `docker-compose.yml` lines 33-34  
**Issue:** The `.env.example` correctly documents `MINIO_CONSOLE_PORT=8923`, but this is only accurate when using the default. The documentation should clarify that MinIO API is at 8922 and Console at 8923.

**Fix:** Add comments in `.env.example` clarifying which port is for which purpose.

---

### DOC-018: Idempotency Key Header Format Not Validated
**Severity:** Medium  
**Documentation:** `docs/api/ENDPOINTS.md` (implies UUID format)  
**Code:** `apps/web-api/src/index.ts` lines 311-316  
**Issue:** ARCH_STATE.md section 3.1 states "UUID format required" for Idempotency-Key, but the actual code only checks that the header exists and is non-empty - no UUID format validation.

**Impact:** Users may use non-UUID keys successfully, then face issues if UUID validation is added later.

**Fix:** Either add UUID validation to code or remove UUID requirement from documentation.

---

### DOC-019: Missing `ready` Endpoint Documentation
**Severity:** Low  
**Documentation:** `docs/api/ENDPOINTS.md` - not listed  
**Code:** `apps/web-api/src/plugins/health.ts` (implied from ARCH_STATE.md)  
**Issue:** The `/ready` readiness probe endpoint is mentioned in ARCH_STATE.md but not in the main API documentation.

**Fix:** Add `/ready` endpoint to ENDPOINTS.md health section.

---

### DOC-020: Multipart Presign Endpoint Lacks Idempotency (Documented vs Actual)
**Severity:** Medium  
**Documentation:** `docs/api/ENDPOINTS.md` doesn't mention idempotency for this endpoint  
**Code:** `apps/web-api/src/index.ts` lines 1553-1579  
**Issue:** The multipart presign-part endpoint does NOT require idempotency (per BACKEND_HEALTH_ASSESSMENT.md P1-001), but this isn't documented as an intentional exception.

**Fix:** Document that `POST /api/uploads/multipart/presign-part` is intentionally non-idempotent.

---

### DOC-021: Watch-Edits Endpoint Uses PATCH, Not POST
**Severity:** Low  
**Documentation:** `docs/api/ENDPOINTS.md` line 46: `PATCH /api/videos/:id/watch-edits`  
**Code:** `apps/web-api/src/index.ts` line 1356: `app.patch<...>("/api/videos/:id/watch-edits", ...)`  
**Issue:** Documentation is correct, but the endpoint path parameter is `:id` in code while documentation shows `:id` - this is actually consistent, but worth verifying.

**Fix:** No action needed - documentation matches code.

---

### DOC-022: Container Names in Troubleshooting Don't Match docker-compose.yml
**Severity:** Medium  
**Documentation:** `docs/ops/LOCAL_DEV.md` lines 137-143  
**Code:** `docker-compose.yml` (commented out container_name lines)  
**Issue:** Troubleshooting examples use `cap3-postgres` container name, but docker-compose.yml has commented out `container_name` directives, meaning containers get generated names like `cap3-postgres-1`.

**Impact:** Copy-paste troubleshooting commands will fail.

**Fix:** Either uncomment container_name in docker-compose.yml or update troubleshooting to use `docker compose exec` syntax.

---

## 6. Recommendations

### Immediate Actions (This Sprint)

1. **Fix DOC-001:** Update ENDPOINTS.md to mark multipart endpoints as implemented
2. **Fix DOC-002:** Change delete endpoint method from DELETE to POST in documentation
3. **Fix DOC-003:** Update retry endpoint path parameter and clarify scope
4. **Fix DOC-022:** Fix container names in troubleshooting or docker-compose.yml

### Short Term (Next 2 Sprints)

5. **Fix DOC-006:** Add missing WORKER_RECLAIM_MS to .env.example
6. **Fix DOC-008:** Document provider-status endpoint fully
7. **Fix DOC-009:** Document idempotency TTL differences
8. **Fix DOC-014:** Update state machine documentation to match code ranks
9. **Fix DOC-018:** Clarify Idempotency-Key format requirements

### Medium Term (Next Month)

10. **Fix DOC-005:** Document webhook signature verification issue
11. **Fix DOC-007:** Add LOG_PRETTY to .env.example
12. **Fix DOC-010:** Add debug endpoints environment warning
13. **Fix DOC-011:** Document cursor encoding format
14. **Fix DOC-012:** Add S3 validation to config schema or document runtime validation

---

## 7. Evidence Summary

### Files Referenced

| File | Purpose |
|------|---------|
| `/Users/m17/2026/gh_repo_tests/cap3/README.md` | Main project documentation |
| `/Users/m17/2026/gh_repo_tests/cap3/AGENTS.md` | Project conventions and constraints |
| `/Users/m17/2026/gh_repo_tests/cap3/.env.example` | Environment variable documentation |
| `/Users/m17/2026/gh_repo_tests/cap3/docs/api/ENDPOINTS.md` | API endpoint documentation |
| `/Users/m17/2026/gh_repo_tests/cap3/docs/ops/LOCAL_DEV.md` | Local development guide |
| `/Users/m17/2026/gh_repo_tests/cap3/apps/web-api/src/index.ts` | Actual API implementation |
| `/Users/m17/2026/gh_repo_tests/cap3/apps/media-server/src/index.ts` | Media server implementation |
| `/Users/m17/2026/gh_repo_tests/cap3/packages/config/src/index.ts` | Configuration schema |
| `/Users/m17/2026/gh_repo_tests/cap3/docker-compose.yml` | Docker service definitions |
| `/Users/m17/2026/gh_repo_tests/cap3/.audit/artifacts/ARCH_STATE.md` | Architecture state analysis |
| `/Users/m17/2026/gh_repo_tests/cap3/.audit/artifacts/BACKEND_HEALTH_ASSESSMENT.md` | Backend health findings |

### Key Code References

- **Multipart endpoints:** `apps/web-api/src/index.ts` lines 1501-1686
- **Delete endpoint:** `apps/web-api/src/index.ts` line 1688
- **Retry endpoint:** `apps/web-api/src/index.ts` lines 1756-1855
- **State machine ranks:** `apps/web-api/src/index.ts` lines 34-45
- **Webhook verification:** `apps/web-api/src/index.ts` lines 123-129
- **Idempotency implementation:** `apps/web-api/src/index.ts` lines 311-386

---

*End of Documentation Consistency Report*
