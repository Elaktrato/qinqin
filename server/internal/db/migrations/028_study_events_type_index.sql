-- Serves GET /api/stats/activity: every activity rule counts one event
-- type of one user over a time window, so (user_id, type, ts) answers the
-- range scan and workspace_id makes count rules a covering-index read.
CREATE INDEX IF NOT EXISTS idx_study_events_user_type_ts ON study_events (user_id, type, ts, workspace_id);
