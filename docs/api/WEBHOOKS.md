# Webhooks

Current webhook contract for the incoming media-server callback handled by `apps/web-api`.

- Route: `POST /api/webhooks/media-server/progress`
- Purpose: update `videos.processing_phase` and `processing_progress`
- Auth: HMAC verification plus timestamp skew validation
- Rate limit: excluded from the global API limiter
- Content type: `application/cap4-webhook+json`

## What This Route Does

The media-server posts progress and completion updates back to the API. The API:

1. Verifies required headers.
2. Verifies the HMAC signature against the raw request body.
3. Rejects stale timestamps outside `WEBHOOK_MAX_SKEW_SECONDS`.
4. Deduplicates deliveries by `source + delivery_id`.
5. Applies the update only if it moves the video state forward or increases progress at the same rank.
6. Optionally enqueues an outbound `deliver_webhook` job when the video has a user-configured `webhook_url`.

## Required Headers

```http
Content-Type: application/cap4-webhook+json
x-cap-timestamp: 1710806400
x-cap-signature: <hex hmac signature>
x-cap-delivery-id: 550e8400-e29b-41d4-a716-446655440000
```

- `x-cap-timestamp`: Unix timestamp in seconds
- `x-cap-signature`: HMAC-SHA256 signature derived from `timestamp + "." + rawBody`
- `x-cap-delivery-id`: unique delivery identifier used for deduplication

## Request Body

```json
{
  "jobId": "4f857d7f-1187-4ee4-9934-8c3879dfab06",
  "videoId": "550e8400-e29b-41d4-a716-446655440000",
  "phase": "processing",
  "progress": 75,
  "message": "ffmpeg pass running",
  "metadata": {
    "duration": 930,
    "width": 1920,
    "height": 1080,
    "fps": 30
  }
}
```

Fields:

- `jobId`: media-server job identifier
- `videoId`: target video UUID
- `phase`: processing phase accepted by the API state machine
- `progress`: integer percentage, clamped to `0..100`
- `message`: optional status detail
- `error`: optional error text
- `metadata`: optional duration/size/fps values to persist

## Accepted Processing Phases

- `not_required`
- `queued`
- `downloading`
- `probing`
- `processing`
- `uploading`
- `generating_thumbnail`
- `complete`
- `failed`
- `cancelled`

## Example Request

```bash
curl -X POST http://localhost:3000/api/webhooks/media-server/progress \
  -H "Content-Type: application/cap4-webhook+json" \
  -H "x-cap-timestamp: 1710806400" \
  -H "x-cap-signature: <computed-hmac>" \
  -H "x-cap-delivery-id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "jobId": "4f857d7f-1187-4ee4-9934-8c3879dfab06",
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "phase": "processing",
    "progress": 75
  }'
```

## Success Response

```json
{
  "accepted": true,
  "duplicate": false,
  "applied": true
}
```

- `accepted`: request authenticated and parsed successfully
- `duplicate`: `delivery_id` was already seen
- `applied`: update passed the monotonic/progress guard and changed video state

## Failure Cases

- `400`: malformed JSON, missing raw body, or invalid phase
- `401`: missing auth headers, invalid timestamp, stale timestamp, or invalid signature
- `500`: webhook processing failed after authentication

Common error shape:

```json
{
  "ok": false,
  "error": "Invalid signature"
}
```

## Signature Verification

The API verifies the signature against the raw request body, not parsed JSON. The current verifier signs:

```text
timestamp + "." + rawBody
```

using `MEDIA_SERVER_WEBHOOK_SECRET` and HMAC-SHA256.

## Notes

- This document only covers the incoming media-server callback route.
- Outbound user webhooks are separate `deliver_webhook` jobs queued by the API and worker when `videos.webhook_url` is set.
