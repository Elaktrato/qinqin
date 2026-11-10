-- Per-user edit overlays. A user's edits of a shared dictionary entry
-- live in one row beside it, keyed by (user, entry), layered on the
-- shared rows at read time and never written back to them — a
-- re-import of the underlying dictionary pack never clobbers a user's
-- edits. written is NULL when the user's view shows the shared written
-- form. readings holds the user's saved reading list as JSON — a TEXT
-- column like workspaces.settings, storing exactly what the user saved
-- and served verbatim, never re-derived through a language pack — or
-- NULL when the view shows the shared readings. Each Put replaces the
-- row wholesale and stamps updated_at, the LWW timestamp; rows are
-- never deleted.

CREATE TABLE user_edits (
    user_id INTEGER NOT NULL REFERENCES users(id),
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    written TEXT,
    readings TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, entry_id)
);
