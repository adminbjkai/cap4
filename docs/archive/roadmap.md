> **ARCHIVED** — This document is from the cap3 era and is superseded by [master-plan.md](../master-plan.md). Preserved for historical reference only.

# Cap3 Historical Roadmap (P0 Stabilization)

This was the stabilization roadmap for cap3. It is **no longer the source of truth** — see [master-plan.md](../master-plan.md) for the authoritative plan.

## Goal: Truth + Correctness
The immediate objective is to ensure the repository documentation, infrastructure (Docker), and code (API/Worker) are in perfect alignment and operationally robust before adding any new features.

---

## 1. Phase 0: Infrastructure & Naming (Status: DONE/CLEANUP)
- [x] Rename project to `cap3` (Docs, Compose, ENV, Scripts).
- [x] Align container names (`cap3-web-api`, etc.).
- [x] Document canonical commands: `docker compose -p cap3-dev up`.
- [ ] **Final Sweep:** Ensure no "Cap v2" strings remain in user-facing docs.

## 2. Phase 1: Functional Correctness (Status: DONE)
### 2.1 Fix /debug/smoke
- **Problem:** Smoke test calls wrong endpoint/payload.
- **Action:** Patch `apps/web-api/src/index.ts` to call `POST /process` with `{ videoId, rawKey, jobId, webhookUrl }`.
- **Validation:** `make smoke` or hitting `/debug/smoke` finishes with `processingPhase=complete`.

### 2.2 Align Local Dev Experience
- **Ports:** API at `3000`, UI at `8022` (Docker Nginx) or `5173` (Host Vite).
- **Docs:** Update `README.md` and `docs/ops/LOCAL_DEV.md` to match these ports.

### 2.3 Idempotency Enforcement
- **Requirement:** `POST /api/videos`, `POST /api/uploads/signed`, `POST /api/uploads/complete` must require `Idempotency-Key`.
- **Logic:** Save request hash/response in `idempotency_keys` table. Handle 409 conflicts.

### 2.4 Monotonic Processing Guards
- **Logic:** Ensure `processing_phase` can only move forward (based on `processing_phase_rank`).
- **Action:** Update `apps/web-api/src/index.ts` and worker status updates to include rank checks.

---

## 3. Phase 2: Functional Enhancements & UX (Status: COMPLETE)
... (omitted summary) ...

---

## 4. Phase 2.1: Audit Hardening (Status: COMPLETE)
*Based on Kimi K2 External Audit feedback*

### 4.1 Security & Example Scrub
- [x] Remove hardcoded API keys from `.env.example`.
- [x] Fix inconsistent S3 bucket fallback (`cap-v2` -> `cap3`) in `web-api`.

### 4.2 Worker Resilience
- [x] **Error Classification:** Update worker to classify errors (Auth vs Transient). Stop retrying immediately on 401/403 (Auth) errors.
- [x] **Health Check:** Worker should check media-server health before claiming `process_video` jobs.

### 4.3 Maintenance Jobs
- [x] Implement background cleanup for old `idempotency_keys` and `webhook_events`.

---

## Operating Rules
1. **Docker is Truth:** If it doesn't work in `docker-compose`, it's broken.
2. **Linear Priority:** Tickets follow this roadmap order.
3. **Weekly Releases:** Verify in Staging (Linux) before Promoting to Prod.
