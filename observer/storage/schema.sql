BEGIN;

CREATE TABLE IF NOT EXISTS app_users (
    id                BIGSERIAL PRIMARY KEY,
    username          TEXT NOT NULL UNIQUE,
    password_hash     TEXT,
    role              TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('member', 'admin')),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guild_members (
    user_id           TEXT PRIMARY KEY,
    current_name      TEXT NOT NULL,
    display_name      TEXT,
    discord_name      TEXT,
    discord_linked    BOOLEAN NOT NULL DEFAULT FALSE,
    status            TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'kicked', 'left', 'unknown')),
    joined_on         DATE,
    left_on           DATE,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS member_names (
    id                BIGSERIAL PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES guild_members(user_id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    first_seen_at     TIMESTAMPTZ NOT NULL,
    last_seen_at      TIMESTAMPTZ NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS member_identity_links (
    normalized_name   TEXT PRIMARY KEY,
    observed_name     TEXT NOT NULL,
    user_id           TEXT NOT NULL REFERENCES guild_members(user_id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS boss_definitions (
    boss_key          TEXT PRIMARY KEY,
    weekday           SMALLINT NOT NULL UNIQUE CHECK (weekday BETWEEN 0 AND 6),
    day_label         TEXT NOT NULL,
    name              TEXT NOT NULL,
    image_path        TEXT,
    atk               INTEGER NOT NULL,
    def               INTEGER NOT NULL,
    spd               INTEGER NOT NULL,
    sort_order        SMALLINT NOT NULL UNIQUE CHECK (sort_order BETWEEN 1 AND 7),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO boss_definitions (boss_key, weekday, day_label, name, image_path, atk, def, spd, sort_order)
VALUES
    ('treant-guardian', 1, 'Mon', 'Treant Guardian', '/bosses/treant-guardian.png', 200, 200, 10, 1),
    ('fire-dragon', 2, 'Tue', 'Fire Dragon', '/bosses/fire-dragon.png', 180, 200, 10, 2),
    ('flame-demon', 3, 'Wed', 'Flame Demon', '/bosses/flame-demon.png', 250, 200, 10, 3),
    ('medusa', 4, 'Thu', 'Medusa', '/bosses/medusa.png', 170, 200, 10, 4),
    ('stoneman', 5, 'Fri', 'Stoneman', '/bosses/stoneman.png', 160, 200, 10, 5),
    ('cyclops-mage', 6, 'Sat', 'Cyclops Mage', '/bosses/cyclops-mage.png', 225, 200, 10, 6),
    ('grim-reaper', 0, 'Sun', 'Grim Reaper', '/bosses/grim-reaper.png', 300, 200, 10, 7)
ON CONFLICT (boss_key) DO UPDATE SET
    weekday = EXCLUDED.weekday,
    day_label = EXCLUDED.day_label,
    name = EXCLUDED.name,
    image_path = EXCLUDED.image_path,
    atk = EXCLUDED.atk,
    def = EXCLUDED.def,
    spd = EXCLUDED.spd,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE;

CREATE TABLE IF NOT EXISTS capture_batches (
    id                BIGSERIAL PRIMARY KEY,
    capture_date      DATE NOT NULL,
    captured_at       TIMESTAMPTZ NOT NULL,
    imported_at       TIMESTAMPTZ,
    source            TEXT NOT NULL DEFAULT 'manual',
    status            TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'discarded', 'imported', 'failed')),
    notes             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS screenshots (
    id                BIGSERIAL PRIMARY KEY,
    batch_id          BIGINT REFERENCES capture_batches(id) ON DELETE SET NULL,
    capture_date      DATE NOT NULL,
    kind              TEXT NOT NULL CHECK (kind IN ('guild-members', 'guild-boss')),
    relative_path     TEXT NOT NULL UNIQUE,
    file_sha256       TEXT,
    sequence_no       INTEGER NOT NULL CHECK (sequence_no > 0),
    status            TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'kept', 'discarded', 'imported', 'failed')),
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_reports (
    id                BIGSERIAL PRIMARY KEY,
    capture_date      DATE NOT NULL,
    batch_id          BIGINT REFERENCES capture_batches(id) ON DELETE SET NULL,
    report_path       TEXT,
    report_payload    JSONB NOT NULL,
    front_updated     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (capture_date, report_path)
);

CREATE TABLE IF NOT EXISTS remote_import_batches (
    id                BIGSERIAL PRIMARY KEY,
    idempotency_key   TEXT NOT NULL UNIQUE,
    schema_version    INTEGER NOT NULL,
    capture_date      DATE NOT NULL,
    agent_version     TEXT NOT NULL,
    status            TEXT NOT NULL
        CHECK (status IN ('received', 'published', 'failed')),
    payload           JSONB NOT NULL,
    result            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS remote_import_batches_capture_date_idx
    ON remote_import_batches (capture_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS guild_snapshots (
    id                BIGSERIAL PRIMARY KEY,
    batch_id          BIGINT REFERENCES capture_batches(id) ON DELETE SET NULL,
    capture_date      DATE NOT NULL,
    captured_at       TIMESTAMPTZ NOT NULL,
    source            TEXT NOT NULL,
    screenshot_id     BIGINT REFERENCES screenshots(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_metrics (
    snapshot_id        BIGINT NOT NULL REFERENCES guild_snapshots(id) ON DELETE CASCADE,
    user_id            TEXT NOT NULL REFERENCES guild_members(user_id) ON DELETE CASCADE,
    role               TEXT,
    power              BIGINT,
    contribution_today BIGINT,
    contribution_7d    BIGINT,
    contribution_total BIGINT,
    boss_attacks       INTEGER,
    boss_damage_today  BIGINT,
    boss_damage_total  BIGINT,
    last_activity_days INTEGER,
    guild_rank         INTEGER,
    verification_note  TEXT,
    raw_payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (snapshot_id, user_id)
);

CREATE TABLE IF NOT EXISTS unmatched_member_metrics (
    id                 BIGSERIAL PRIMARY KEY,
    snapshot_id        BIGINT NOT NULL REFERENCES guild_snapshots(id) ON DELETE CASCADE,
    observed_name      TEXT NOT NULL,
    normalized_name    TEXT NOT NULL,
    role               TEXT,
    power              BIGINT,
    contribution_7d    BIGINT,
    boss_attacks       INTEGER,
    last_activity_days INTEGER,
    verification_note  TEXT,
    raw_payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (snapshot_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS boss_daily_results (
    id                BIGSERIAL PRIMARY KEY,
    capture_date      DATE NOT NULL,
    boss_key          TEXT NOT NULL REFERENCES boss_definitions(boss_key),
    user_id           TEXT REFERENCES guild_members(user_id) ON DELETE SET NULL,
    player_name       TEXT NOT NULL,
    raw_name          TEXT,
    boss_rank         INTEGER,
    damage_text       TEXT,
    damage_value      BIGINT,
    screenshot_id     BIGINT REFERENCES screenshots(id) ON DELETE SET NULL,
    row_source        TEXT,
    row_area          TEXT NOT NULL DEFAULT 'list' CHECK (row_area IN ('podium', 'list')),
    row_index         INTEGER NOT NULL DEFAULT 0,
    raw_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS boss_daily_results_rank_uidx
    ON boss_daily_results (capture_date, boss_key, boss_rank)
    WHERE boss_rank IS NOT NULL;

CREATE INDEX IF NOT EXISTS member_metrics_user_idx
    ON member_metrics (user_id);

CREATE INDEX IF NOT EXISTS guild_snapshots_capture_date_idx
    ON guild_snapshots (capture_date DESC);

CREATE INDEX IF NOT EXISTS screenshots_capture_kind_idx
    ON screenshots (capture_date DESC, kind);

CREATE INDEX IF NOT EXISTS boss_daily_results_member_idx
    ON boss_daily_results (user_id, capture_date DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS boss_daily_results_boss_score_idx
    ON boss_daily_results (boss_key, damage_value DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS rule_settings (
    key               TEXT PRIMARY KEY,
    value             JSONB NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ocr_failures (
    id                BIGSERIAL PRIMARY KEY,
    batch_id          BIGINT REFERENCES capture_batches(id) ON DELETE SET NULL,
    snapshot_id       BIGINT REFERENCES guild_snapshots(id) ON DELETE SET NULL,
    screenshot_id     BIGINT REFERENCES screenshots(id) ON DELETE SET NULL,
    field_name        TEXT NOT NULL,
    raw_value         TEXT NOT NULL,
    confidence        INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    screenshot_path   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_runs (
    id                TEXT PRIMARY KEY,
    started_at        TIMESTAMPTZ NOT NULL,
    finished_at       TIMESTAMPTZ,
    status            TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    summary           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE VIEW v_member_latest_metrics AS
SELECT DISTINCT ON (m.user_id)
    m.user_id,
    gm.current_name,
    gs.capture_date,
    gs.captured_at,
    m.role,
    m.power,
    m.contribution_7d,
    m.boss_attacks,
    m.last_activity_days,
    m.guild_rank
FROM member_metrics m
JOIN guild_snapshots gs ON gs.id = m.snapshot_id
JOIN guild_members gm ON gm.user_id = m.user_id
ORDER BY m.user_id, gs.capture_date DESC, gs.captured_at DESC;

CREATE OR REPLACE VIEW v_boss_daily_leaderboard AS
SELECT
    r.capture_date,
    r.boss_key,
    b.name AS boss_name,
    b.weekday,
    r.user_id,
    COALESCE(gm.current_name, r.player_name) AS player_name,
    r.boss_rank,
    r.damage_value,
    r.damage_text,
    r.row_area,
    r.row_index
FROM boss_daily_results r
JOIN boss_definitions b ON b.boss_key = r.boss_key
LEFT JOIN guild_members gm ON gm.user_id = r.user_id
WHERE r.damage_value IS NOT NULL;

CREATE OR REPLACE VIEW v_boss_personal_bests_by_boss AS
SELECT *
FROM (
    SELECT
        r.*,
        row_number() OVER (
            PARTITION BY r.boss_key, COALESCE(r.user_id, r.player_name)
            ORDER BY r.damage_value DESC NULLS LAST, r.capture_date DESC
        ) AS personal_rank
    FROM v_boss_daily_leaderboard r
) ranked
WHERE personal_rank = 1;

CREATE OR REPLACE VIEW v_boss_personal_bests_global AS
SELECT *
FROM (
    SELECT
        r.*,
        row_number() OVER (
            PARTITION BY COALESCE(r.user_id, r.player_name)
            ORDER BY r.damage_value DESC NULLS LAST, r.capture_date DESC
        ) AS personal_rank
    FROM v_boss_daily_leaderboard r
) ranked
WHERE personal_rank = 1;

CREATE OR REPLACE VIEW v_boss_weekly_totals AS
SELECT
    date_trunc('week', capture_date::timestamp)::date AS week_start,
    user_id,
    player_name,
    sum(damage_value) AS damage_total,
    count(*) AS boss_days,
    max(damage_value) AS best_day_damage
FROM v_boss_daily_leaderboard
GROUP BY date_trunc('week', capture_date::timestamp)::date, user_id, player_name;

COMMIT;
