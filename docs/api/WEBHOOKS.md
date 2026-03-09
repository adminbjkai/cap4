# Webhook Documentation

How webhooks work and how to integrate with cap4.

---

## Overview

cap4 sends real-time status updates to your application via webhooks.

**Supported events:**
- `video.processing_started`
- `video.processing_progress` (50%, 75%, etc.)
- `video.transcription_complete`
- `video.ai_generation_complete`
- `video.processing_failed`

---

## Receiving Webhooks

### 1. Create Webhook Endpoint

Your server must have an endpoint that accepts HTTP POST:

```typescript
app.post('/webhooks/cap4', (req, res) => {
  const { videoId, event, data } = req.body;

  // Verify signature
  const signature = crypto
    .createHmac('sha256', process.env.CAP4_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest('hex');

  if (signature !== req.headers['x-webhook-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Handle event
  switch(event) {
    case 'video.processing_complete':
      updateVideoStatus(videoId, 'complete');
      break;
    case 'video.processing_failed':
      handleError(videoId, data.error);
      break;
  }

  res.json({ received: true });
});
```

### 2. Register Webhook URL

Tell cap4 where to send webhooks:

```bash
curl -X POST http://cap4-api.example.com/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourapp.com/webhooks/cap4",
    "secret": "your-secret-key"
  }'
```

### 3. Webhook Delivery

cap4 will POST to your endpoint when events occur.

---

## Webhook Format

### Request

```json
{
  "id": "webhook-123",
  "timestamp": "2026-03-06T14:30:00Z",
  "event": "video.transcription_complete",
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "transcript": "Hello everyone...",
    "duration": 930,
    "confidence": 0.95
  }
}
```

### Headers

```
POST /webhooks/cap4 HTTP/1.1
Host: yourapp.com
Content-Type: application/json
X-Webhook-Signature: abc123def456...
X-Webhook-ID: webhook-123
X-Webhook-Timestamp: 2026-03-06T14:30:00Z
```

### Response

cap4 expects a 2xx status code:

```json
{
  "received": true,
  "processed": true
}
```

If you return anything other than 2xx, cap4 will retry with exponential backoff.

---

## Signature Verification

All webhooks are signed with HMAC-SHA256.

**To verify:**

```typescript
function verifyWebhookSignature(body: string, signature: string): boolean {
  const computed = crypto
    .createHmac('sha256', process.env.CAP4_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return computed === signature;
}
```

**Important:** Use the raw body (not parsed JSON) for signature verification.

---

## Event Types

### video.upload_started
When upload begins.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.upload_started",
  "data": {
    "filename": "sample.mp4",
    "size": 524288000
  }
}
```

### video.upload_complete
Upload finished, processing queued.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.upload_complete",
  "data": {
    "uploadedAt": "2026-03-06T14:30:00Z",
    "fileSize": 524288000
  }
}
```

### video.processing_started
FFmpeg encoding begins.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.processing_started",
  "data": {
    "phase": "processing",
    "estimatedDuration": 900
  }
}
```

### video.processing_progress
Progress update during encoding.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.processing_progress",
  "data": {
    "progress": 75,
    "currentSecond": 675,
    "totalSeconds": 900
  }
}
```

### video.processing_complete
Video encoding finished.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.processing_complete",
  "data": {
    "duration": "00:15:00",
    "resultUrl": "https://s3.example.com/videos/xxx/result.mp4",
    "thumbnailUrl": "https://s3.example.com/videos/xxx/thumbnail.jpg"
  }
}
```

### video.transcription_complete
Transcription (speech-to-text) finished.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.transcription_complete",
  "data": {
    "transcript": "Hello everyone, welcome to cap4...",
    "language": "en",
    "confidence": 0.94
  }
}
```

### video.ai_generation_complete
AI metadata (title, summary, chapters) generated.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.ai_generation_complete",
  "data": {
    "title": "How to Use cap4",
    "summary": "In this video, we explore...",
    "chapters": [
      {
        "timestamp": "00:00:00",
        "title": "Introduction",
        "startMs": 0
      },
      {
        "timestamp": "00:02:00",
        "title": "Getting Started",
        "startMs": 120000
      }
    ]
  }
}
```

### video.processing_failed
An error occurred during processing.

```json
{
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "video.processing_failed",
  "data": {
    "phase": "transcription",
    "error": "Deepgram API timeout",
    "retryable": true,
    "retryCount": 1
  }
}
```

---

## Handling Webhooks Reliably

### Idempotency

Webhooks may be delivered multiple times (duplicate protection in progress).

Always use the `X-Webhook-ID` header to deduplicate:

```typescript
app.post('/webhooks/cap4', async (req, res) => {
  const webhookId = req.headers['x-webhook-id'];

  // Check if already processed
  const existing = await db.query(
    'SELECT id FROM webhook_deliveries WHERE id = $1',
    [webhookId]
  );

  if (existing) {
    return res.json({ received: true, duplicate: true });
  }

  // Process webhook
  // ... 

  // Mark as processed
  await db.query(
    'INSERT INTO webhook_deliveries (id, videoId, event, timestamp) VALUES ($1, $2, $3, $4)',
    [webhookId, videoId, event, timestamp]
  );

  res.json({ received: true });
});
```

### Retries

If you return non-2xx status, cap4 retries with exponential backoff:
- 1st retry: 5 seconds
- 2nd retry: 25 seconds (5 × 5)
- 3rd retry: 125 seconds (25 × 5)
- Max 5 retries

### Asynchronous Processing

Don't block on webhook handling. If processing takes time:

```typescript
app.post('/webhooks/cap4', (req, res) => {
  // Return 200 immediately
  res.json({ received: true });

  // Process asynchronously
  setImmediate(() => {
    processWebhook(req.body).catch(err => {
      console.error('Webhook processing failed:', err);
      // Retry later or log for manual review
    });
  });
});
```

---

## Testing Webhooks Locally

### Using ngrok

```bash
# Start ngrok tunnel
ngrok http 3000

# Use ngrok URL in cap4 webhook config
# https://abc-123-def.ngrok.io/webhooks/cap4

# See requests in real-time
# Dashboard: http://localhost:4040
```

### Using RequestBin / Webhook.cool

Free service for testing:

```bash
# Get a URL
# https://webhook.cool/abc-123-def

# Add to cap4 webhook config
# Watch requests in browser
```

### Manual Testing

```bash
# Simulate webhook from curl
curl -X POST http://localhost:3000/webhooks/cap4 \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: signature-here" \
  -d '{
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "event": "video.processing_complete"
  }'
```

---

## Troubleshooting

### Webhook not being delivered

1. Check webhook is registered:
```bash
curl http://cap4-api.example.com/api/webhooks
```

2. Check endpoint is publicly accessible:
```bash
curl https://yourapp.com/webhooks/cap4
# Should respond 400 (bad request) not connection refused
```

3. Check firewall/WAF allows cap4 IP:
```bash
# Whitelist: All cap4 server IPs
```

### Signature verification failing

1. Use raw body (not parsed JSON)
2. Use exact webhook secret (check .env)
3. Compare with `constant-time` comparison (timingSafeEqual)

### Too many webhook requests

1. Implement deduplication (use X-Webhook-ID)
2. Batch process if needed
3. Contact support if truly excessive

---

## Webhook Retention

cap4 stores webhook logs for 30 days. View webhook history:

```bash
curl http://cap4-api.example.com/api/videos/{id}/webhooks
```

---

## Best Practices

1. **Verify signatures** — Always authenticate webhooks
2. **Idempotent processing** — Same webhook = same result
3. **Return quickly** — Don't do heavy work in webhook handler
4. **Log everything** — Store webhook payload for debugging
5. **Handle failures gracefully** — Retry on your end if needed
6. **Public URLs** — Webhook endpoint must be accessible from internet

---

## API Reference

### List registered webhooks

```bash
GET /api/webhooks
```

### Register webhook

```bash
POST /api/webhooks
Content-Type: application/json

{
  "url": "https://yourapp.com/webhooks/cap4",
  "secret": "webhook-secret-key",
  "events": ["*"]  // or ["video.processing_complete", ...]
}
```

### Update webhook

```bash
PATCH /api/webhooks/{id}
```

### Delete webhook

```bash
DELETE /api/webhooks/{id}
```

### View webhook history

```bash
GET /api/videos/{id}/webhooks
```

---

**Questions?** See [ENDPOINTS.md](ENDPOINTS.md) or [../../README.md](../../README.md)
