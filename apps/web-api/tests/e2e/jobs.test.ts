import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * E2E tests for jobs.ts routes:
 *   GET /api/jobs/:id
 */

const BASE_URL = process.env.E2E_API_URL || 'http://localhost:3000';

test.use({
  extraHTTPHeaders: {
    Accept: 'application/json',
    'x-real-ip': '10.20.0.11',
  },
});

test.describe('Jobs API', () => {
  let jobId: number;

  test.beforeAll(async ({ request }) => {
    // Create a video and complete upload to generate a job
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Job Test Video',
      },
    });

    const { videoId } = await createResponse.json();

    const completeResponse = await request.post(`${BASE_URL}/api/uploads/complete`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
      },
    });

    const completeBody = await completeResponse.json();
    jobId = completeBody.jobId;
  });

  test('GET /api/jobs/:id - should return job details', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/jobs/${jobId}`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(jobId);
    expect(body).toHaveProperty('video_id');
    expect(body).toHaveProperty('job_type');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('attempts');
    expect(body).toHaveProperty('run_after');
    expect(body).toHaveProperty('updated_at');
  });

  test('GET /api/jobs/:id - should return 404 for non-existent job', async ({ request }) => {
    const fakeJobId = 999999999;

    const response = await request.get(`${BASE_URL}/api/jobs/${fakeJobId}`);

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('not found');
  });

  test('GET /api/jobs/:id - should reject invalid job id', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/jobs/invalid-id`);

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid job id');
  });

  test('GET /api/jobs/:id - should reject non-numeric job id', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/jobs/abc123`);

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid job id');
  });
});
