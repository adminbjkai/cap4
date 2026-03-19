import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * E2E tests for library.ts routes:
 *   GET /api/library/videos
 *
 * Tests cursor-based pagination and sorting.
 */

const BASE_URL = process.env.E2E_API_URL || 'http://localhost:3000';

test.describe('Library API', () => {
  // Create multiple videos for pagination testing
  test.beforeAll(async ({ request }) => {
    const videoNames = ['Video 1', 'Video 2', 'Video 3'];

    for (const name of videoNames) {
      await request.post(`${BASE_URL}/api/videos`, {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        data: {
          name,
        },
      });
    }
  });

  test('GET /api/library/videos - should return paginated video list', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/library/videos`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(Array.isArray(body.items)).toBe(true);
    expect(body).toHaveProperty('sort');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('nextCursor');

    // Verify item structure
    if (body.items.length > 0) {
      const item = body.items[0];
      expect(item).toHaveProperty('videoId');
      expect(item).toHaveProperty('displayTitle');
      expect(item).toHaveProperty('processingPhase');
      expect(item).toHaveProperty('transcriptionStatus');
      expect(item).toHaveProperty('aiStatus');
      expect(item).toHaveProperty('createdAt');
    }
  });

  test('GET /api/library/videos - should respect limit parameter', async ({ request }) => {
    const limit = 2;
    const response = await request.get(`${BASE_URL}/api/library/videos?limit=${limit}`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.limit).toBe(limit);
    expect(body.items.length).toBeLessThanOrEqual(limit);
  });

  test('GET /api/library/videos - should cap limit at 50', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/library/videos?limit=100`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.limit).toBe(50);
  });

  test('GET /api/library/videos - should enforce minimum limit of 1', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/library/videos?limit=0`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.limit).toBe(1);
  });

  test('GET /api/library/videos - should support created_desc sort (default)', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/library/videos?limit=5`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.sort).toBe('created_desc');

    // Verify descending order
    if (body.items.length >= 2) {
      const first = new Date(body.items[0].createdAt).getTime();
      const second = new Date(body.items[1].createdAt).getTime();
      expect(first).toBeGreaterThanOrEqual(second);
    }
  });

  test('GET /api/library/videos - should support created_asc sort', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/library/videos?sort=created_asc&limit=5`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.sort).toBe('created_asc');

    // Verify ascending order
    if (body.items.length >= 2) {
      const first = new Date(body.items[0].createdAt).getTime();
      const second = new Date(body.items[1].createdAt).getTime();
      expect(first).toBeLessThanOrEqual(second);
    }
  });

  test('GET /api/library/videos - should support cursor-based pagination', async ({ request }) => {
    // Get first page
    const response1 = await request.get(`${BASE_URL}/api/library/videos?limit=2`);
    expect(response1.status()).toBe(200);
    const body1 = await response1.json();

    if (!body1.nextCursor) {
      // Not enough items to paginate
      test.skip();
      return;
    }

    // Get second page using cursor
    const response2 = await request.get(
      `${BASE_URL}/api/library/videos?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`
    );
    expect(response2.status()).toBe(200);
    const body2 = await response2.json();

    // Second page should have different items
    expect(body2.items.length).toBeGreaterThan(0);
    if (body1.items.length > 0 && body2.items.length > 0) {
      expect(body2.items[0].videoId).not.toBe(body1.items[0].videoId);
    }
  });

  test('GET /api/library/videos - should reject invalid cursor', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/api/library/videos?cursor=invalid-cursor-format`
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid cursor');
  });

  test('GET /api/library/videos - should return null nextCursor when no more items', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/library/videos?limit=1000`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    // If all items fit in one page, nextCursor should be null
    if (body.items.length < body.limit) {
      expect(body.nextCursor).toBeNull();
    }
  });

  test('GET /api/library/videos - should not return deleted videos', async ({ request }) => {
    // Create and delete a video
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Video to Delete',
      },
    });

    const { videoId } = await createResponse.json();

    await request.post(`${BASE_URL}/api/videos/${videoId}/delete`, {
      headers: {
        'Idempotency-Key': randomUUID(),
      },
    });

    // Get library
    const libraryResponse = await request.get(`${BASE_URL}/api/library/videos?limit=100`);
    expect(libraryResponse.status()).toBe(200);
    const libraryBody = await libraryResponse.json();

    // Deleted video should not appear in the list
    const deletedVideoInList = libraryBody.items.some(
      (item: { videoId?: string }) => item.videoId === videoId
    );
    expect(deletedVideoInList).toBe(false);
  });

  test('GET /api/library/videos - should include video metadata in items', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/library/videos?limit=1`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    if (body.items.length > 0) {
      const item = body.items[0];

      // Required fields
      expect(typeof item.videoId).toBe('string');
      expect(typeof item.displayTitle).toBe('string');
      expect(typeof item.hasThumbnail).toBe('boolean');
      expect(typeof item.hasResult).toBe('boolean');
      expect(typeof item.processingPhase).toBe('string');
      expect(typeof item.transcriptionStatus).toBe('string');
      expect(typeof item.aiStatus).toBe('string');
      expect(typeof item.createdAt).toBe('string');

      // Nullable fields
      expect(['string', 'object']).toContain(typeof item.thumbnailKey); // null or string
      expect(['number', 'object']).toContain(typeof item.durationSeconds); // null or number
    }
  });
});
