-- Workspaces gain a name and may repeat a language: a user can keep
-- several workspaces of one language told apart by name. The first of a
-- language keeps the empty name. The unique key becomes
-- (user_id, language, name), so SQLite needs the table rebuilt.
--
-- The rebuild follows SQLite's create-copy-drop-rename procedure. Ids
-- are copied verbatim, so study_events.workspace_id and
-- plugin_data.workspace_id keep pointing at the same rows. Their
-- REFERENCES workspaces(id) clauses name the table, not the old table
-- object, so they resolve to the rebuilt table once it is renamed. The
-- runner applies migrations with foreign_keys OFF (SQLite's default; the
-- DSN never turns it on), so dropping the old table does not touch the
-- children. workspaces has no explicit indexes or triggers to recreate.

CREATE TABLE workspaces_new (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    language TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    settings TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, language, name)
);

INSERT INTO workspaces_new (id, user_id, language, name, settings, updated_at)
SELECT id, user_id, language, '', settings, updated_at FROM workspaces;

DROP TABLE workspaces;

ALTER TABLE workspaces_new RENAME TO workspaces;
