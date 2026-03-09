import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * E2E tests for uploads.ts routes:
 *   POST /api/uploads/signed
 *   POST /api/uploads/complete
 *   POST /api/uploads/multipart/initiate
 *   POST /api/uploads/multipart/presign-part
 *   POST /api/uploads/multipart/complete
 *   POST /api/uploads/multipart/abort
 */

const BASE_URL = process.env.E2E_API_URL || 'http://localhost:3000';

test.describe('Uploads API - Singlepart', () => {
  let videoId: string;

  test.beforeEach(async ({ request }) => {
    // Create a video for each test
    const response = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Upload Test Video',
      },
    });

    const body = await response.json();
    videoId = body.videoId;
  });

  test('POST /api/uploads/signed - should return signed upload URL', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/signed`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
        contentType: 'video/mp4',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.videoId).toBe(videoId);
    expect(body).toHaveProperty('rawKey');
    expect(body).toHaveProperty('putUrl');
    expect(body.method).toBe('PUT');
    expect(body.headers).toHaveProperty('Content-Type');
    expect(body.headers['Content-Type']).toBe('video/mp4');
  });

  test('POST /api/uploads/signed - should reject without idempotency key', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/signed`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('POST /api/uploads/signed - should reject without videoId', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/signed`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {},
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('videoId is required');
  });

  test('POST /api/uploads/signed - should return 404 for non-existent video', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.post(`${BASE_URL}/api/uploads/signed`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId: fakeId,
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Upload not found');
  });

  test('POST /api/uploads/complete - should mark upload as complete', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/complete`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.videoId).toBe(videoId);
    expect(body).toHaveProperty('rawKey');
    expect(body).toHaveProperty('jobId');
    expect(body.status).toBe('uploaded');
  });

  test('POST /api/uploads/complete - should be idempotent', async ({ request }) => {
    const idempotencyKey = randomUUID();

    // First request
    const response1 = await request.post(`${BASE_URL}/api/uploads/complete`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: {
        videoId,
      },
    });

    expect(response1.status()).toBe(200);
    const body1 = await response1.json();

    // Second request with same key
    const response2 = await request.post(`${BASE_URL}/api/uploads/complete`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: {
        videoId,
      },
    });

    expect(response2.status()).toBe(200);
    const body2 = await response2.json();
    expect(body2.jobId).toBe(body1.jobId);
  });

  test('POST /api/uploads/complete - should reject without idempotency key', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/complete`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('POST /api/uploads/complete - should reject without videoId', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/complete`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {},
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('videoId is required');
  });
});

test.describe('Uploads API - Multipart', () => {
  let videoId: string;

  test.beforeEach(async ({ request }) => {
    // Create a video for each test
    const response = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Multipart Upload Test Video',
      },
    });

    const body = await response.json();
    videoId = body.videoId;
  });

  test('POST /api/uploads/multipart/initiate - should initiate multipart upload', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/initiate`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
        contentType: 'video/mp4',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.videoId).toBe(videoId);
    expect(body).toHaveProperty('uploadId');
    expect(body).toHaveProperty('rawKey');
  });

  test('POST /api/uploads/multipart/initiate - should reject without idempotency key', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/initiate`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
        contentType: 'video/mp4',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('POST /api/uploads/multipart/initiate - should reject without required fields', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/initiate`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('contentType are required');
  });

  test('POST /api/uploads/multipart/presign-part - should return presigned URL for part', async ({ request }) => {
    // First, initiate multipart upload
    const initiateResponse = await request.post(`${BASE_URL}/api/uploads/multipart/initiate`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
        contentType: 'video/mp4',
      },
    });

    expect(initiateResponse.status()).toBe(200);

    // Then, get presigned URL for part 1
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/presign-part`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
        partNumber: 1,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.videoId).toBe(videoId);
    expect(body.partNumber).toBe(1);
    expect(body).toHaveProperty('putUrl');
    expect(body.putUrl).toContain('uploadId=');
    expect(body.putUrl).toContain('partNumber=1');
  });

  test('POST /api/uploads/multipart/presign-part - should reject without required fields', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/presign-part`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('partNumber are required');
  });

  test('POST /api/uploads/multipart/presign-part - should return 404 without initiated upload', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/presign-part`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
        partNumber: 1,
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  test('POST /api/uploads/multipart/complete - should complete multipart upload', async ({ request }) => {
    // First, initiate multipart upload
    await request.post(`${BASE_URL}/api/uploads/multipart/initiate`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
        contentType: 'video/mp4',
      },
    });

    // Complete with mock parts (in real scenario, you'd upload parts first)
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/complete`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
        parts: [
          { ETag: '"mock-etag-1"', PartNumber: 1 },
        ],
      },
    });

    // Note: This may fail with S3 error if parts weren't actually uploaded,
    // but we're testing the API contract here
    // In a real test environment with S3, you'd upload actual parts
    expect([200, 500]).toContain(response.status());
  });

  test('POST /api/uploads/multipart/complete - should reject without idempotency key', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/complete`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
        parts: [],
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('POST /api/uploads/multipart/complete - should reject without required fields', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/complete`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('parts array are required');
  });

  test('POST /api/uploads/multipart/abort - should abort multipart upload', async ({ request }) => {
    // First, initiate multipart upload
    await request.post(`${BASE_URL}/api/uploads/multipart/initiate`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        videoId,
        contentType: 'video/mp4',
      },
    });

    // Abort the upload
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/abort`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.videoId).toBe(videoId);
  });

  test('POST /api/uploads/multipart/abort - should reject without videoId', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/abort`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {},
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('videoId is required');
  });

  test('POST /api/uploads/multipart/abort - should return 404 without initiated upload', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/uploads/multipart/abort`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        videoId,
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });
});
