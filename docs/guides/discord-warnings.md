# Archero Guild warning API guide

Use this guide to retrieve guild warnings from a Discord bot or another
server-side integration. The canonical contract remains
[`../api.md`](../api.md) and [`../openapi.yaml`](../openapi.yaml).

## API access

Base URL:

```text
https://api.example.com
```

Every route below requires an API key:

```http
Authorization: Bearer YOUR_API_KEY
Accept: application/json
```

Keep the key private and use it only on the server side. Never include it in a
public bot, web page, or Git repository.

## Warning types

| Technical type | Meaning |
| --- | --- |
| `game_absence` | The member has been inactive longer than the allowed period. |
| `low_contribution` | The member's donations are below the configured minimum. |
| `low_progression` | The member's power progression is below the configured minimum. |
| `missed_boss` | The member has fewer boss attempts than required. |

Retrieve the current thresholds with:

```http
GET /api/v1/rules
```

## Current warnings

Returns only members that currently have at least one warning.

```bash
curl \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Accept: application/json" \
  "https://api.example.com/api/v1/warnings"
```

Example response:

```json
{
  "data": {
    "summary": {
      "totalMembers": 2,
      "warningCountsByType": {
        "game_absence": 1,
        "missed_boss": 2
      }
    },
    "members": [
      {
        "playerId": "900000112",
        "name": "ExampleMember",
        "lastSeenAt": "2026-07-29",
        "evaluation": {
          "status": "Absent",
          "warnings": [
            {
              "type": "game_absence",
              "label": "Game absence"
            },
            {
              "type": "missed_boss",
              "label": "Missed boss"
            }
          ]
        }
      }
    ]
  },
  "meta": {
    "apiVersion": "v1",
    "source": "database",
    "dataMode": "live",
    "partial": false
  }
}
```

Filter by type:

```http
GET /api/v1/warnings?type=missed_boss
```

## Warning rankings

Returns members ranked by warning count.

```bash
curl \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Accept: application/json" \
  "https://api.example.com/api/v1/rankings/warnings?scope=history&limit=10"
```

Exemple de réponse :

```json
{
  "data": {
    "totalMembers": 19,
    "rankings": [
      {
        "rank": 1,
        "playerId": "900000113",
        "name": "ExampleMember",
        "totalWarnings": 6,
        "warningCountsByType": {
          "game_absence": 2,
          "low_contribution": 2,
          "missed_boss": 2
        },
        "lastWarningAt": "2026-07-29"
      }
    ]
  }
}
```

Useful parameters:

- `scope=current`: current warnings only;
- `scope=history`: complete history;
- `type=missed_boss`: filter by type;
- `from=2026-07-01&to=2026-07-31`: filter by period;
- `order=desc`: members with the most warnings first;
- `limit=10`: maximum number of returned members.

## Member history

Returns warnings for one member.

```bash
curl \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Accept: application/json" \
  "https://api.example.com/api/v1/members/900000112/warnings?scope=history&limit=100"
```

Exemple de réponse :

```json
{
  "data": {
    "playerId": "900000112",
    "name": "ExampleMember",
    "summary": {
      "totalWarnings": 2,
      "warningCountsByType": {
        "game_absence": 1,
        "missed_boss": 1
      },
      "lastWarningAt": "2026-07-29"
    },
    "warnings": [
      {
        "date": "2026-07-29",
        "type": "game_absence",
        "label": "Game absence",
        "value": 1,
        "threshold": 1
      },
      {
        "date": "2026-07-29",
        "type": "missed_boss",
        "label": "Missed boss",
        "value": 0,
        "threshold": 2
      }
    ],
    "pagination": {
      "limit": 100,
      "totalWarnings": 2,
      "hasMore": false
    }
  }
}
```

## Manually ignore a warning

This action is performed in the site with an administrator account:

1. Open **Members**.
2. Select the member.
3. Scroll to **Automatic warning history**.
4. Select **Ignore warning**.

An ignored warning remains visible in the administrative history, is excluded
from current-warning lists and rankings, and can be reinstated with
**Restore warning**.

## HTTP status codes

| Code | Meaning |
| --- | --- |
| `200` | Successful request |
| `400` | Invalid parameter |
| `401` | Missing or invalid API key |
| `404` | Member not found |
| `429` | Too many requests |
| `503` | API, database, or rules are temporarily unavailable |
