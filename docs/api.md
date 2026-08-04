# Archero Observer API

The public API is a stable, read-only JSON interface intended for Discord bots
and other server-side integrations. All versioned routes use the `/api/v1`
prefix.

- Interactive documentation: `/api-docs`
- Served OpenAPI document: `/openapi.yaml`
- Canonical contract: [`openapi.yaml`](openapi.yaml)
- Field dictionary: [`api-fields.md`](api-fields.md)

## Exposure policy

| Data | Exposed in v1 | Notes |
| --- | --- | --- |
| Collection health and freshness | Yes | Allows consumers to detect stale or unavailable data |
| Guild summary | Yes | Suitable for `/guild` commands |
| Members and verified metrics | Yes | Supports search, detail, and rankings |
| Rule-based evaluations | Yes | Supports alerts and assisted moderation |
| Boss catalog, results, and rankings | Yes | Includes stored PostgreSQL boss identity |
| Discord association | Boolean only | Discord identity is not exposed |
| Officer notes and absence reasons | No | Private dashboard data |
| Raw screenshots and OCR payloads | No | Internal diagnostic data |
| Import, upload, capture, and discard actions | No | Reserved for authenticated dashboard administrators |

The public API must not proxy or expose the mutation routes under `/api/data`.

## Authentication

Configure one or more comma-separated keys:

```env
ARCHERO_API_KEYS=replace-with-a-long-random-secret,rotation-key
```

Send either header:

```http
Authorization: Bearer replace-with-a-long-random-secret
```

```http
X-API-Key: replace-with-a-long-random-secret
```

`GET /api/v1/health` is always public. In local development, authentication is
disabled when `ARCHERO_API_KEYS` is empty. In production, the API fails closed:
protected routes return `503 api_not_configured` until at least one key is
configured.

Keys must remain server-side and must only be transmitted over HTTPS.

## Public URLs

Configure the browser-facing origin in every environment:

```env
ARCHERO_PUBLIC_ORIGIN=https://archero.example.com
```

Local development uses `http://127.0.0.1:5181`. Member `links.api`,
`links.web`, and resolver `webUrl` values are returned as absolute URLs built
from this origin. `links.api` is permanent. `links.web` and resolver `webUrl`
use compact `/s/<signed-code>` URLs that can be opened repeatedly for 12 hours.
Opening one validates the signed grant, stores an expiring member-scoped cookie,
and redirects to a clean read-only profile URL without requiring login. The bot
can send the URL from its existing member response without a second API call.
Changing the domain requires only an environment update.

These URLs are bearer grants: do not log, expand, or publish them outside the
intended Discord conversation. Rotating `ARCHERO_SHARE_LINK_SECRET`
invalidates every outstanding share link.

## Endpoint reference

| Method and path | Parameters | Purpose |
| --- | --- | --- |
| `GET /api/v1/health` | None | Public process health |
| `GET /api/v1/guild` | None | Guild counts, availability, evaluations, and collection timestamps |
| `GET /api/v1/rules` | None | Public evaluation rules |
| `GET /api/v1/members` | `q`, `status`, `limit`, `offset` | Search and paginate members |
| `GET /api/v1/members/resolve` | `q`, `limit` | Resolve an ID, normalized name, previous name, alias, or typo |
| `GET /api/v1/members/{playerId}` | `playerId` | Public member detail |
| `GET /api/v1/members/{playerId}/history` | `playerId`, `from`, `to` | Daily metric history |
| `GET /api/v1/members/{playerId}/bosses` | `playerId` | Global, weekly, and per-boss records |
| `GET /api/v1/warnings` | `type`, `flag`, `playerId` | Members with current warnings |
| `GET /api/v1/rankings/members` | `metric`, `order`, `limit` | Member metric ranking |
| `GET /api/v1/rankings/warnings` | `type`, `scope`, `from`, `to`, `order`, `limit` | Members ranked by accumulated warnings |
| `GET /api/v1/members/{playerId}/warnings` | `playerId`, `type`, `scope`, `from`, `to`, `limit` | Filtered warning history for one member |
| `GET /api/v1/bosses` | None | Boss catalog and records |
| `GET /api/v1/boss-results` | `date`, `boss`, `playerId`, `limit` | Daily boss results |
| `GET /api/v1/rankings/boss/all-time` | `limit` | Best historical score per member |
| `GET /api/v1/rankings/boss/weekly` | `week`, `limit` | Weekly totals; `week` must be a Monday |
| `GET /api/v1/rankings/boss/by-boss` | `boss`, `limit` | Best score per boss |

### Member list parameters

| Parameter | Type | Default | Constraints |
| --- | --- | --- | --- |
| `q` | string | Empty | Case- and accent-insensitive name or Player ID search |
| `status` | string | `active` | `active`, `former`, or `all` |
| `limit` | integer | `25` | 1 to 100 |
| `offset` | integer | `0` | 0 to 100000 |

### Member resolution parameters

| Parameter | Type | Default | Constraints |
| --- | --- | --- | --- |
| `q` | string | None | Required |
| `limit` | integer | `5` | 1 to 10 |

Previous names are loaded from PostgreSQL `member_names`. Search aliases are
loaded from `guild_members.metadata.searchAliases`; the legacy `aliases` key is
also accepted. These lookup values are not exposed in member details.

### Member ranking parameters

| Parameter | Values | Default |
| --- | --- | --- |
| `metric` | `power`, `contribution7d`, `powerDelta`, `contributionDelta`, `bossAttacks`, `activity` | `power` |
| `order` | `asc`, `desc` | `desc`, except `activity` uses `asc` |
| `limit` | Integer from 1 to 100 | `10` |

`GET /api/v1/violations` remains available as a deprecated compatibility alias.
New integrations should use the warning routes above.

### Date parameters

Dates use the strict `YYYY-MM-DD` format and must exist in the calendar.
Impossible dates such as `2026-02-31` return `400`.

For weekly boss rankings, `week` must identify a Monday. If it is omitted, the
latest recorded week is returned.

## Response format

Success:

```json
{
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "generatedAt": "2026-07-28T12:00:00.000Z",
    "source": "database",
    "dataMode": "live",
    "partial": false
  }
}
```

Error:

```json
{
  "error": {
    "code": "member_not_found",
    "message": "No member matches this player ID."
  },
  "meta": {
    "apiVersion": "v1",
    "generatedAt": "2026-07-28T12:00:00.000Z"
  }
}
```

See [`api-fields.md`](api-fields.md) for every shared field, its type,
nullability, provenance, and compatibility requirements.

## Data integrity and provenance

- `source: database` means PostgreSQL was selected.
- `dataMode: live` means PostgreSQL produced a valid payload.
- `dataMode: unavailable` means PostgreSQL was configured but unavailable or
  invalid. Collections remain empty.
- `source: local` with `dataMode: demo` is explicit demonstration mode and is
  only used when no database URL is configured.
- `partial` and `missingDomains` identify incomplete exports.
- Unknown numeric metrics are `null`, not fabricated zeros.

PostgreSQL data is cached for 15 seconds by default. Concurrent requests share
one export process. Successful imports and rule updates invalidate the cache.

Configuration:

```env
ARCHERO_DATA_CACHE_TTL_MS=15000
ARCHERO_DATA_ERROR_CACHE_TTL_MS=2000
ARCHERO_API_RATE_LIMIT_PER_MINUTE=120
```

Set the rate limit to `0` only when another trusted layer provides equivalent
protection.

## HTTP status codes

| Status | Meaning |
| ---: | --- |
| `200` | Successful request |
| `400` | Invalid parameter or date |
| `401` | Missing or invalid API key |
| `404` | Requested member or resource does not exist |
| `429` | Per-key rate limit exceeded; inspect `Retry-After` |
| `503` | API authentication is not configured in production |

## Discord bot guidance

- Keep the API key in server-side secret storage.
- Call the API only while processing an interaction.
- Never include the key in a command, embed, error message, or public log.
- Cache rankings for 15 to 60 seconds on the bot side.
- Surface `meta.warning` to administrators.
- Accept `null` for unknown metrics.
- Retry `429` only after the `Retry-After` delay.
- Treat unknown evaluation flags as forward-compatible values.
- Send the API-provided `links.web` value unchanged; do not construct a member
  URL or expose its signed code in logs.

Suggested mapping:

| Discord command | API request |
| --- | --- |
| `/guild` | `GET /api/v1/guild` |
| `/member player_id:123` | `GET /api/v1/members/123` |
| `/member-search name:alice` | `GET /api/v1/members?q=alice` |
| `/boss mode:weekly` | `GET /api/v1/rankings/boss/weekly` |
| `/boss boss:fire-dragon` | `GET /api/v1/rankings/boss/by-boss?boss=fire-dragon` |

## Verification status

The API reliability plan is complete:

1. PostgreSQL responses never contain demonstration fallback data.
2. Provenance, partial data, and unavailable metrics are explicit.
3. Rules, derived metrics, boss identity, previous names, and aliases come from
   PostgreSQL.
4. Snapshot caching, fail-closed production authentication, and rate limiting
   are enabled.
5. One canonical OpenAPI document is synchronized and checked in CI.
6. Public and internal date inputs use calendar validation.
7. The database contract is tested against a real PostgreSQL 16 instance.

Potential future product work includes an administrable Discord user ID,
paginated member history, access audit logs, and signed webhook notifications.
