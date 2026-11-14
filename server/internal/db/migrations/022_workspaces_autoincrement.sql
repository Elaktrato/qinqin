-- Workspace ids are never reused. Workspaces can be deleted
-- (DELETE /api/workspaces/{id}), and a plain INTEGER PRIMARY KEY hands
-- the highest deleted id to the next insert: a device still holding the
-- deleted workspace's id (its selection, its pending reviews, its
-- localStorage keys) would then write into, or show its data in, an
-- unrelated new workspace. AUTOINCREMENT keeps the high-water mark in
-- sqlite_sequence, so a deleted id stays dead.
--
-- The table is rebuilt exactly as in 018 (create, copy, drop, rename;
-- ids copied verbatim, the copy seeds sqlite_sequence with the largest
-- id). The children (study_events, plugin_data, library_books) name the
-- table in their REFERENCES clauses and resolve to the rebuilt one; the
-- runner applies migrations with foreign_keys OFF, so the drop does not
-- touch them. workspaces has no explicit indexes or triggers.

CREATE TABLE workspaces_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    language TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    settings TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, language, name)
);

INSERT INTO workspaces_new (id, user_id, language, name, settings, updated_at)
SELECT id, user_id, language, name, settings, updated_at FROM workspaces;

DROP TABLE workspaces;

ALTER TABLE workspaces_new RENAME TO workspaces;
