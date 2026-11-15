-- The learner's time zone history (v0.3.0, #84): every "day" is computed
-- from an event's UTC ts with the zone in effect at that instant.
-- (032-034 are held by the accounts work; the runner applies any missing
-- version by name, so the gap is harmless.)
CREATE TABLE user_time_zones (
    user_id INTEGER NOT NULL REFERENCES users(id),
    seq INTEGER NOT NULL,            -- 0, 1, 2 ... in effect order
    zone TEXT NOT NULL,              -- IANA name as validated by Go
    effective_from TEXT,             -- NULL for seq 0; UTC RFC 3339 seconds otherwise
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, seq)
);
