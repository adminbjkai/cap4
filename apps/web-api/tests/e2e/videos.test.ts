import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * E2E tests for videos.ts routes:
 *   POST  /api/videos
 *   GET   /api/videos/:id/status
 *   PATCH /api/videos/:id/watch-edits
 *   POST  /api/videos/:id/delete
 *   POST  /api/videos/:id/retry
 */

const BASE_URL = process.env.E2E_API_URL || 'http://localhost:3000';

test.use({
  extraHTTPHeaders: {
    Accept: 'application/json',
    'x-real-ip': '10.20.0.14',
  },
});

test.describe('Videos API', () => {
  test('POST /api/videos - should create a new video', async ({ request }) => {
    const idempotencyKey = randomUUID();

    const response = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: {
        name: 'Test Video E2E',
        webhookUrl: 'https://example.com/webhook',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('videoId');
    expect(body).toHaveProperty('rawKey');
    expect(body.rawKey).toContain('videos/');
    expect(body.rawKey).toContain('/raw/source.mp4');

  });

  test('POST /api/videos - should be idempotent', async ({ request }) => {
    const idempotencyKey = randomUUID();
    const videoData = {
      name: 'Idempotent Test Video',
      webhookUrl: 'https://example.com/webhook',
    };

    // First request
    const response1 = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: videoData,
    });

    expect(response1.status()).toBe(200);
    const body1 = await response1.json();

    // Second request with same idempotency key
    const response2 = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: videoData,
    });

    expect(response2.status()).toBe(200);
    const body2 = await response2.json();

    // Should return same video ID
    expect(body2.videoId).toBe(body1.videoId);
  });

  test('POST /api/videos - should reject without idempotency key', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Test Video',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('POST /api/videos - should reject idempotency key reuse with different payload', async ({ request }) => {
    const idempotencyKey = randomUUID();

    // First request
    await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: {
        name: 'Original Video',
      },
    });

    // Second request with same key but different data
    const response2 = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      data: {
        name: 'Different Video',
      },
    });

    expect(response2.status()).toBe(409);
    const body = await response2.json();
    expect(body.ok).toBe(false);
  });

  test('GET /api/videos/:id/status - should return video status', async ({ request }) => {
    // Create a video first
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Status Test Video',
      },
    });

    const { videoId } = await createResponse.json();

    // Get status
    const response = await request.get(`${BASE_URL}/api/videos/${videoId}/status`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.videoId).toBe(videoId);
    expect(body).toHaveProperty('processingPhase');
    expect(body).toHaveProperty('processingProgress');
    expect(body).toHaveProperty('transcriptionStatus');
    expect(body).toHaveProperty('aiStatus');
  });

  test('GET /api/videos/:id/status - should return 404 for non-existent video', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.get(`${BASE_URL}/api/videos/${fakeId}/status`);

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('not found');
  });

  test('PATCH /api/videos/:id/watch-edits - should update video title', async ({ request }) => {
    // Create a video first
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Edit Test Video',
      },
    });

    const { videoId } = await createResponse.json();

    // Update title (note: this will only work if ai_outputs exists for the video)
    const response = await request.patch(`${BASE_URL}/api/videos/${videoId}/watch-edits`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        title: 'Updated Title',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.videoId).toBe(videoId);
    expect(body).toHaveProperty('updated');
  });

  test('PATCH /api/videos/:id/watch-edits - should reject without idempotency key', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.patch(`${BASE_URL}/api/videos/${fakeId}/watch-edits`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        title: 'New Title',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('PATCH /api/videos/:id/watch-edits - should reject without fields', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.patch(`${BASE_URL}/api/videos/${fakeId}/watch-edits`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {},
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('At least one field');
  });

  test('PATCH /api/videos/:id/watch-edits - should return 404 for non-existent video', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.patch(`${BASE_URL}/api/videos/${fakeId}/watch-edits`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        title: 'New Title',
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('not found');
  });

  test('POST /api/videos/:id/delete - should soft delete a video', async ({ request }) => {
    // Create a video first
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Delete Test Video',
      },
    });

    const { videoId } = await createResponse.json();

    // Delete the video
    const response = await request.post(`${BASE_URL}/api/videos/${videoId}/delete`, {
      headers: {
        'Idempotency-Key': randomUUID(),
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.videoId).toBe(videoId);
    expect(body).toHaveProperty('deletedAt');
    expect(body.deletedAt).toBeTruthy();

    // Verify video is no longer accessible
    const statusResponse = await request.get(`${BASE_URL}/api/videos/${videoId}/status`);
    expect(statusResponse.status()).toBe(404);
  });

  test('POST /api/videos/:id/delete - should be idempotent', async ({ request }) => {
    // Create a video first
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Idempotent Delete Test',
      },
    });

    const { videoId } = await createResponse.json();
    const idempotencyKey = randomUUID();

    // First delete
    const response1 = await request.post(`${BASE_URL}/api/videos/${videoId}/delete`, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });

    expect(response1.status()).toBe(200);
    const body1 = await response1.json();

    // Second delete with same key
    const response2 = await request.post(`${BASE_URL}/api/videos/${videoId}/delete`, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });

    expect(response2.status()).toBe(200);
    const body2 = await response2.json();
    expect(body2.deletedAt).toBe(body1.deletedAt);
  });

  test('POST /api/videos/:id/delete - should reject without idempotency key', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.post(`${BASE_URL}/api/videos/${fakeId}/delete`);

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('POST /api/videos/:id/delete - should return 404 for non-existent video', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.post(`${BASE_URL}/api/videos/${fakeId}/delete`, {
      headers: {
        'Idempotency-Key': randomUUID(),
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('not found');
  });

  test('POST /api/videos/:id/retry - should retry failed jobs', async ({ request }) => {
    // Create a video first
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Retry Test Video',
      },
    });

    const { videoId } = await createResponse.json();

    // Retry (may not reset anything if no jobs failed)
    const response = await request.post(`${BASE_URL}/api/videos/${videoId}/retry`, {
      headers: {
        'Idempotency-Key': randomUUID(),
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.videoId).toBe(videoId);
    expect(body).toHaveProperty('jobsReset');
    expect(Array.isArray(body.jobsReset)).toBe(true);
  });

  test('POST /api/videos/:id/retry - should reject without idempotency key', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.post(`${BASE_URL}/api/videos/${fakeId}/retry`);

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Idempotency-Key');
  });

  test('POST /api/videos/:id/retry - should return 404 for non-existent video', async ({ request }) => {
    const fakeId = randomUUID();

    const response = await request.post(`${BASE_URL}/api/videos/${fakeId}/retry`, {
      headers: {
        'Idempotency-Key': randomUUID(),
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('not found');
  });
});
