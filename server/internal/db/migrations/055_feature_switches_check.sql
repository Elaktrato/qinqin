-- #294: migration 047 listed the four first features in a CHECK on
-- feature_switches, and v0.8.0's fifth (scripts) was never added, so
-- switching it off failed with a CHECK error. The list of feature ids now
-- lives in Go only (features.IDs; features.Set refuses an unknown id, the
-- backup restore skips one), so a new feature needs no migration. SQLite
-- cannot change a CHECK in place: create, copy every row with its rowid (the
-- paged pull's keyset is updated_at, rowid), drop, rename, re-index.

CREATE TABLE feature_switches_new (
    user_id INTEGER NOT NULL REFERENCES users(id),
    feature TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, feature)
);

INSERT INTO feature_switches_new (rowid, user_id, feature, enabled, updated_at)
SELECT rowid, user_id, feature, enabled, updated_at FROM feature_switches;

DROP TABLE feature_switches;
ALTER TABLE feature_switches_new RENAME TO feature_switches;
CREATE INDEX idx_feature_switches_updated ON feature_switches (user_id, updated_at);
