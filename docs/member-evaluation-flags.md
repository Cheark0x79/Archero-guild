# Member evaluation flags

The `evaluation` field returned for a member contains:

```json
{
  "status": "Watch",
  "severity": "warning",
  "flags": ["Low contribution", "Missed boss"]
}
```

Flags are calculated from the latest verified member metrics and the current
guild rules.

| Flag | Meaning |
| --- | --- |
| `Game absence` | The member's inactivity reached the configured `maxInactiveDays` threshold. |
| `Low contribution` | The member's seven-day contribution is below `minContribution7d`. |
| `Low progression` | The member's 14-day power growth is below `minPowerGrowth14dPercent`. |
| `Missed boss` | The recorded boss attempts are below `minBossTries`. |
| `Metrics not recorded` | The member is known, but no metrics have been captured yet. |
| `Metrics need verification` | Metrics were captured but have not been verified. Rule-based flags are not applied yet. |
| `Missing player ID` | The roster entry could not be associated with an Archero Player ID. |
| `New member grace period` | The member is still within `newMemberGraceDays`; normal rule alerts are temporarily suppressed. |
| `Excused absence` | The member has an active excused absence and no other applicable alert. |
| `Not in current guild` | The member is a former, left, or kicked guild member. |

## Status and severity

Typical severities are:

- `positive`: active, compliant, excused, or covered by the new-member grace period;
- `warning`: a rule is not met, metrics need verification, or the Player ID is missing;
- `danger`: the inactivity threshold is reached;
- `neutral`: former members or members whose metrics have not been recorded.

Consumers should rely on the flag strings for the reason and on `severity` for
display priority. New flags may be added in the future, so unknown flag strings
should be displayed or ignored gracefully rather than treated as an error.
