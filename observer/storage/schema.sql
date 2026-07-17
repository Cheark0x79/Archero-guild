CREATE TABLE IF NOT EXISTS guild_members (
    user_id          TEXT PRIMARY KEY,
    current_name     TEXT NOT NULL,
    first_seen_at    TIMESTAMPTZ NOT NULL,
    last_seen_at     TIMESTAMPTZ NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS member_names (
    id               BIGSERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES guild_members(user_id),
    name             TEXT NOT NULL,
    first_seen_at    TIMESTAMPTZ NOT NULL,
    last_seen_at     TIMESTAMPTZ NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS guild_snapshots (
    id               BIGSERIAL PRIMARY KEY,
    captured_at      TIMESTAMPTZ NOT NULL,
    source           TEXT NOT NULL,
    screenshot_path  TEXT
);

CREATE TABLE IF NOT EXISTS member_metrics (
    snapshot_id      BIGINT NOT NULL REFERENCES guild_snapshots(id),
    user_id          TEXT NOT NULL REFERENCES guild_members(user_id),
    contribution     BIGINT,
    boss_damage      BIGINT,
    guild_rank       INTEGER,
    power            BIGINT,
    PRIMARY KEY (snapshot_id, user_id)
);

CREATE TABLE IF NOT EXISTS ocr_failures (
    id               BIGSERIAL PRIMARY KEY,
    snapshot_id      BIGINT REFERENCES guild_snapshots(id),
    field_name       TEXT NOT NULL,
    raw_value        TEXT NOT NULL,
    confidence       INTEGER NOT NULL,
    screenshot_path  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_runs (
    id               TEXT PRIMARY KEY,
    started_at       TIMESTAMPTZ NOT NULL,
    finished_at      TIMESTAMPTZ,
    status           TEXT NOT NULL,
    summary          JSONB NOT NULL DEFAULT '{}'::jsonb
);

