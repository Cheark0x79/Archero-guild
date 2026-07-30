# Storage

`schema.sql` is the current PostgreSQL source of truth for the application data model.
When a database URL is configured, the dashboard and public API export their
runtime data from PostgreSQL. `web/sample-data.js` is used only for the explicit
local demonstration mode where no database URL is configured.

Main tables:

- `guild_members`, `member_names`: guild roster, searchable aliases stored in
  `guild_members.metadata.searchAliases`, and name history;
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
