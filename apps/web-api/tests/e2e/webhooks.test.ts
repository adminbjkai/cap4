import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';

/**
 * E2E tests for webhooks.ts routes:
 *   POST /api/webhooks/media-server/progress
 *
 * Tests HMAC signature verification and webhook processing.
 */

const BASE_URL = process.env.E2E_API_URL || 'http://localhost:3000';

// This should match MEDIA_SERVER_WEBHOOK_SECRET from your env
// In a real test environment, you'd load this from the same source as the API
const WEBHOOK_SECRET = process.env.MEDIA_SERVER_WEBHOOK_SECRET || 'change-me-in-real-env';

/**
 * Generate HMAC signature for webhook payload
 */
function generateWebhookSignature(payload: string, timestamp: string): string {
  const message = `${timestamp}.${payload}`;
  const digest = createHmac('sha256', WEBHOOK_SECRET)
    .update(message)
    .digest('hex');
  return `v1=${digest}`;
}

test.describe('Webhooks API', () => {
  let videoId: string;
  let jobId: number;

  test.beforeEach(async ({ request }) => {
    // Create a video for testing
    const createResponse = await request.post(`${BASE_URL}/api/videos`, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      data: {
        name: 'Webhook Test Video',
      },
    });

    const body = await createResponse.json();
    videoId = body.videoId;

    // Complete upload to create a job
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

  test('POST /api/webhooks/media-server/progress - should accept valid webhook', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 50,
      metadata: {
        duration: 120.5,
        width: 1920,
        height: 1080,
        fps: 30,
      },
    };

    const payloadString = JSON.stringify(payload);
    const signature = generateWebhookSignature(payloadString, timestamp);

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-signature': signature,
        'x-cap-delivery-id': deliveryId,
      },
      data: payloadString,
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body).toHaveProperty('duplicate');
    expect(body).toHaveProperty('applied');
  });

  test('POST /api/webhooks/media-server/progress - should reject invalid signature', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 50,
    };

    const payloadString = JSON.stringify(payload);

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-signature': 'v1=invalid-signature-hash',
        'x-cap-delivery-id': deliveryId,
      },
      data: payloadString,
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid signature');
  });

  test('POST /api/webhooks/media-server/progress - should reject missing timestamp', async ({ request }) => {
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 50,
    };

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-signature': 'v1=some-signature',
        'x-cap-delivery-id': deliveryId,
      },
      data: JSON.stringify(payload),
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('timestamp');
  });

  test('POST /api/webhooks/media-server/progress - should reject missing signature', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 50,
    };

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-delivery-id': deliveryId,
      },
      data: JSON.stringify(payload),
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('signature');
  });

  test('POST /api/webhooks/media-server/progress - should reject missing delivery-id', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 50,
    };

    const payloadString = JSON.stringify(payload);
    const signature = generateWebhookSignature(payloadString, timestamp);

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-signature': signature,
      },
      data: payloadString,
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('delivery-id');
  });

  test('POST /api/webhooks/media-server/progress - should reject timestamp outside skew window', async ({ request }) => {
    // Timestamp from 1 hour ago
    const timestamp = (Math.floor(Date.now() / 1000) - 3600).toString();
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 50,
    };

    const payloadString = JSON.stringify(payload);
    const signature = generateWebhookSignature(payloadString, timestamp);

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-signature': signature,
        'x-cap-delivery-id': deliveryId,
      },
      data: payloadString,
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('skew');
  });

  test('POST /api/webhooks/media-server/progress - should reject invalid JSON', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = randomUUID();

    // Send raw invalid JSON (not a JSON-encoded string)
    const invalidPayload = 'not-valid-json{';
    const signature = generateWebhookSignature(invalidPayload, timestamp);

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-signature': signature,
        'x-cap-delivery-id': deliveryId,
      },
      // Use raw data as a Buffer to avoid JSON encoding by Playwright
      data: Buffer.from(invalidPayload),
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid JSON');
  });

  test('POST /api/webhooks/media-server/progress - should reject invalid phase', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'invalid-phase',
      progress: 50,
    };

    const payloadString = JSON.stringify(payload);
    const signature = generateWebhookSignature(payloadString, timestamp);

    const response = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-signature': signature,
        'x-cap-delivery-id': deliveryId,
      },
      data: payloadString,
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid phase');
  });

  test('POST /api/webhooks/media-server/progress - should be idempotent with same delivery-id', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 75,
    };

    const payloadString = JSON.stringify(payload);
    const signature = generateWebhookSignature(payloadString, timestamp);

    const headers = {
      'Content-Type': 'application/cap4-webhook+json',
      'x-cap-timestamp': timestamp,
      'x-cap-signature': signature,
      'x-cap-delivery-id': deliveryId,
    };

    // First request
    const response1 = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers,
      data: payloadString,
    });

    expect(response1.status()).toBe(200);
    const body1 = await response1.json();

    // Second request with same delivery-id
    const response2 = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers,
      data: payloadString,
    });

    expect(response2.status()).toBe(200);
    const body2 = await response2.json();
    expect(body2.duplicate).toBe(true);
  });

  test('POST /api/webhooks/media-server/progress - should update video progress', async ({ request }) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = randomUUID();

    const payload = {
      jobId,
      videoId,
      phase: 'processing',
      progress: 80,
      metadata: {
        duration: 150.3,
        width: 1280,
        height: 720,
        fps: 24,
      },
    };

    const payloadString = JSON.stringify(payload);
    const signature = generateWebhookSignature(payloadString, timestamp);

    const webhookResponse = await request.post(`${BASE_URL}/api/webhooks/media-server/progress`, {
      headers: {
        'Content-Type': 'application/cap4-webhook+json',
        'x-cap-timestamp': timestamp,
        'x-cap-signature': signature,
        'x-cap-delivery-id': deliveryId,
      },
      data: payloadString,
    });

    expect(webhookResponse.status()).toBe(200);

    // Verify the video status was updated
    const statusResponse = await request.get(`${BASE_URL}/api/videos/${videoId}/status`);
    expect(statusResponse.status()).toBe(200);

    const statusBody = await statusResponse.json();
    expect(statusBody.processingPhase).toBe('processing');
    expect(statusBody.processingProgress).toBe(80);
  });
});
