# API field reference

This document describes the fields returned by the public `/api/v1` API. The
canonical machine-readable contract remains [`openapi.yaml`](openapi.yaml).

## Compatibility rules

- Existing endpoint paths, HTTP methods, parameter names, and response fields
  are not removed or renamed within API v1.
- New fields may be added. Consumers must ignore fields they do not recognize.
- Unknown measurements use `null`. They are never converted to a misleading
  numeric zero.
- Empty arrays are valid and mean that no matching records are available.
- Dates use `YYYY-MM-DD`. Timestamps use ISO 8601.
- Player IDs are strings and must not be parsed as numbers.
- Evaluation flags are extensible strings. Consumers must handle unknown flags
  gracefully.

## Response envelopes

Successful responses use:

```json
{
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "generatedAt": "2026-07-28T12:00:00.000Z"
  }
}
```

Errors use:

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

### `meta`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `apiVersion` | string | Yes | Always `v1` for these endpoints |
| `generatedAt` | ISO timestamp | Yes | Time when the HTTP envelope was generated |
| `source` | `database \| local` | Data routes | Physical source selected by the server |
| `dataMode` | `live \| demo \| unavailable` | Data routes | Trust and availability state of the payload |
| `partial` | boolean | Data routes | `true` when at least one expected data domain is unavailable |
| `missingDomains` | string[] | When non-empty | Names of missing data domains |
| `warning` | string | No | Human-readable availability warning |
| `pagination` | object | Paginated routes | `limit`, `offset`, `total`, and `hasMore` |

### Source and data mode combinations

| `source` | `dataMode` | Interpretation |
| --- | --- | --- |
| `database` | `live` | Data was exported from PostgreSQL |
| `database` | `unavailable` | PostgreSQL was configured but could not produce a valid export |
| `local` | `demo` | No database URL was configured; local demonstration data is explicit |

A PostgreSQL failure never falls back to demonstration members, rules, or boss
scores.

## Member

Returned by member list and detail endpoints.

| Field | Type | Nullable | Meaning |
| --- | --- | ---: | --- |
| `playerId` | string | Yes | Stable Archero Player ID |
| `name` | string | No | Current in-game name |
| `role` | string | No | Current guild role |
| `guildStatus` | string | No | Active or former membership state |
| `discordLinked` | boolean | No | Whether a Discord association is recorded; no Discord identity is exposed |
| `joinedAt` | date | Yes | Known guild join date |
| `leftAt` | date | Yes | Known guild departure date |
| `lastSeenAt` | date or timestamp | Yes | Date of the latest member metrics |
| `metrics` | object | No | Latest public measurements |
| `evaluation` | object | No | Rule-based status, severity, and flags |
| `links` | object | Yes | Absolute API and dashboard URLs when `playerId` exists |

Private fields such as officer notes, absence reasons, raw OCR payloads, and
Discord names are not included.

## Member metrics

| Field | Type | Nullable | Provenance |
| --- | --- | ---: | --- |
| `power` | integer | Yes | Latest verified PostgreSQL snapshot |
| `powerDelta` | integer | Yes | Difference from the previous snapshot |
| `contribution7d` | integer | Yes | Latest seven-day contribution counter |
| `contributionDelta` | integer | Yes | Difference from the previous snapshot in the same weekly counter period |
| `bossAttacks` | integer | Yes | Latest recorded boss attempt count |
| `lastActivityDays` | integer | Yes | Days since last activity |
| `captured` | boolean | No | Whether metrics were captured |
| `verified` | boolean | No | Whether captured metrics are trusted for evaluation |

A delta is `null` when there is no usable previous snapshot, when a counter
reset is detected, or when either source value is unknown.

## Evaluation

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | Human-readable evaluation label |
| `severity` | `positive \| neutral \| warning \| danger` | Display and alert priority |
| `flags` | string[] | Reasons that produced the evaluation |

See [`member-evaluation-flags.md`](member-evaluation-flags.md) for the current
flag catalog.

## Member resolution

`GET /api/v1/members/resolve` returns:

| Field | Type | Meaning |
| --- | --- | --- |
| `query` | string | Original query |
| `match` | `MemberMatch \| null` | Unambiguous best match |
| `suggestions` | `MemberMatch[]` | Alternative or ambiguous matches |

`MemberMatch` fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `playerId` | string | Matched member ID |
| `name` | string | Current member name |
| `confidence` | number from 0 to 1 | Match confidence |
| `matchedBy` | string | `playerId`, `name`, `discordName`, `previousName`, or `alias` |
| `webUrl` | string | Compact `/s/<signed-code>` read-only member URL generated from `ARCHERO_PUBLIC_ORIGIN`, reusable for 12 hours |

Previous names come from `member_names`. Search aliases come from
`guild_members.metadata.searchAliases`; the legacy metadata key `aliases` is
also accepted. These lookup values are not exposed in member detail responses.

## Guild rules

| Field | Type | Meaning |
| --- | --- | --- |
| `maxInactiveDays` | number or `null` | Inactivity threshold |
| `minContribution7d` | number or `null` | Minimum seven-day contribution |
| `minPowerGrowth14dPercent` | number or `null` | Minimum 14-day power growth |
| `minBossTries` | number or `null` | Minimum recorded boss attempts |
| `newMemberGraceDays` | number or `null` | Rule suppression period after joining |
| `memberCapacity` | number or `null` | Guild capacity used for free-slot calculations |

When PostgreSQL is configured, rules are read from and written to
`rule_settings`. If the table is empty and a valid legacy `data/rules.json`
exists, the values are migrated once.

## Guild summary

The guild summary includes counts and aggregates such as:

| Field | Type | Nullable | Meaning |
| --- | --- | ---: | --- |
| `members` | string | No | Current count and configured capacity, for example `38/40` |
| `currentMembers` | integer | No | Current guild members |
| `formerMembers` | integer | No | Historical members |
| `activeToday` | integer | No | Verified members active today |
| `totalContribution` | number | Yes | Sum of known seven-day contributions |
| `totalContributionDelta` | number | Yes | Sum of known contribution deltas |
| `bossDamage` | number | Yes | Sum of known daily boss damage |
| `bossAttacks` | number | Yes | Sum of known boss attempts |
| `bossAttacksDelta` | number | Yes | Sum of known boss-attempt deltas |
| `watchCount` | integer | No | Verified current members evaluated as warning or danger |
| `knownIds` | integer | No | Current members with a Player ID |
| `unresolvedIds` | integer | No | Current members without a Player ID |
| `capturedMetrics` | integer | No | Current members with captured metrics |
| `verifiedMetrics` | integer | No | Current members with verified metrics |
| `reviewRequired` | integer | No | Captured metric sets still awaiting verification |
| `discordLinked` | integer | No | Current members linked to Discord |
| `discordMissing` | integer | No | Current members without a Discord link |
| `freeSlots` | integer | Yes | Capacity minus current members |
| `availability` | object | No | Number of known values contributing to each nullable aggregate |
| `lastCapturedAt` | timestamp | Yes | Latest capture time |
| `lastImportedAt` | timestamp | Yes | Latest import time |

If no member has a known value for an aggregate, the aggregate is `null` and
its availability count is `0`.

## Boss definition

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `key` | string | Yes | Stable boss key, for example `fire-dragon` |
| `name` | string | Yes | Display name |
| `weekday` | integer from 0 to 6 or `null` | Yes | Configured rotation day |
| `dayLabel` | string or `null` | Yes | Short day label when available |
| `imagePath` | string or `null` | Database catalog only | Dashboard image path |
| `atk` | integer | Database catalog only | Configured attack stat |
| `def` | integer | Database catalog only | Configured defense stat |
| `spd` | integer | Database catalog only | Configured speed stat |
| `sortOrder` | integer | Database catalog only | Display order |

Boss identity comes from `boss_key` and `boss_definitions` in PostgreSQL. Date
inference remains only as a compatibility fallback for older local payloads.

## Boss result

| Field | Type | Nullable | Meaning |
| --- | --- | ---: | --- |
| `rank` | integer | Yes | Recorded daily guild rank |
| `playerId` | string | Yes | Matched member ID |
| `name` | string | Yes | Recorded player name |
| `damage` | integer | No | Numeric normalized damage |
| `damageText` | string | Yes | Original game-style damage label |

Boss result groups also include the result `date` and their `boss` definition.

## Errors and retry behavior

| Status | Typical code | Consumer action |
| ---: | --- | --- |
| `400` | `invalid_*` | Correct the request parameter |
| `401` | `missing_api_key`, `invalid_api_key` | Supply or rotate a valid key |
| `404` | `member_not_found` | Treat the requested resource as absent |
| `429` | `rate_limited` | Wait for the `Retry-After` duration |
| `503` | `api_not_configured` | Alert the server administrator |

Consumers should use the HTTP status for control flow and retain `error.code`
for diagnostics.
