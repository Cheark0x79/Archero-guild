# Storage

`schema.sql` is the current PostgreSQL source of truth for the application data model.

The first migration target is intentionally conservative:

- keep `web/sample-data.js` and `data/imports/*.json` as the current runtime source;
- store imported screenshots and parsed rows in PostgreSQL next;
- move the dashboard reads to API-backed DB queries only after the import path is stable.

Main tables:

- `guild_members`, `member_names`: guild roster and name history;
- `boss_definitions`: weekly boss rotation and UI metadata;
- `capture_batches`, `screenshots`, `import_reports`: manual ADB/upload import traceability;
- `guild_snapshots`, `member_metrics`: guild member metrics by capture;
- `boss_daily_results`: one row per player score, boss, and day;
- `rule_settings`, `app_users`: future admin rules and login structure.

Ranking views:

- `v_boss_daily_leaderboard`: cleaned boss score rows;
- `v_boss_personal_bests_global`: best single-day score per player;
- `v_boss_personal_bests_by_boss`: best score per player for each boss;
- `v_boss_weekly_totals`: weekly global totals per player.
