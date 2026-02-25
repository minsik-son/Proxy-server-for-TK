# Correction API (`/api/correct`)

## Overview

Typo/grammar correction endpoint for the iOS keyboard extension's correction mode.

## Request

```
POST /api/correct
Content-Type: application/json
```

```json
{
  "text": "안녕하세요 반갑스니다",
  "language": "ko",
  "tier": "free",
  "deviceId": "device-uuid"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Text to correct (max 200 chars) |
| `language` | string | Language code (`ko`, `en`, `ja`, `zh`, `es`, `fr`, `de`, `pt`, `ru`, `it`) |
| `tier` | string | `"free"` or `"pro"` |
| `deviceId` | string | Device identifier for rate limiting and usage tracking |

## Response

```json
{
  "correctedText": "안녕하세요 반갑습니다"
}
```

## Error Responses

| Status | Body | Description |
|--------|------|-------------|
| 400 | `{ "error": "..." }` | Validation error |
| 405 | `{ "error": "Method not allowed" }` | Non-POST request |
| 429 | `{ "error": "Rate limit exceeded", "retryAfter": N }` | Rate limited (seconds) |
| 500 | `{ "error": "Internal server error" }` | Server error |

## Implementation Details

- **AI Engine**: GPT-4o-mini (fixed, no engine routing)
- **Temperature**: 0.1 (near-deterministic for correction)
- **Max tokens**: 500
- **Rate limiting**: Shared with translation (`lib/rateLimiter.ts`)
- **Usage tracking**: Shared with translation (`lib/usageTracker.ts`)
