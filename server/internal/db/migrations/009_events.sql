-- Study events: one immutable, append-only row per recorded study
-- action. The id is the client-generated ULID pushed with the batch, so
-- a retried push conflicts on the primary key and counts as a duplicate
-- rather than an error — rows are never updated or deleted. ts is the
-- client's event time; workspace_id scopes the event to one of the
-- owner's workspaces, enabling per-workspace heatmaps and the combined
-- cross-language view over the same rows.

CREATE TABLE study_events (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    device TEXT NOT NULL,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Combined-history reads scan the owner's rows; per-workspace reads
-- scan one workspace's.
CREATE INDEX idx_study_events_user_ts ON study_events (user_id, ts);
CREATE INDEX idx_study_events_workspace_ts ON study_events (workspace_id, ts);
