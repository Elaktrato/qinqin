-- One generic store of the core's keyed settings rows (#199, record 0006):
-- the plugin data store goes with the code plugins. keyed_rows has
-- plugin_data's sync columns and rules (version per write, updated_at the
-- server's write stamp and the pull cursor, modified_at the edit time last
-- write wins compares, deleted_at the tombstone) and no namespace: the
-- former qinqin-core and qinqin-flashcards key spaces are disjoint. The
-- server accepts only the families of docs/contracts/keyed/families.json,
-- each in its scope (internal/keyed); the copy below keeps exactly those
-- rows. Everything else in plugin_data (rows of admin-registered plugins,
-- unknown keys, a row in the wrong scope, leftovers of typed study families)
-- is dropped with the table (the owner allows a clean start, NEXT.md).

CREATE TABLE keyed_rows (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER REFERENCES workspaces(id),
    key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 512),
    data TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    deleted_at TEXT
);
-- One row per (user, workspace, key); a NULL workspace_id is the user-global
-- row and coalesces to 0, an id no workspace can have.
CREATE UNIQUE INDEX idx_keyed_rows_key ON keyed_rows (user_id, IFNULL(workspace_id, 0), key);
CREATE INDEX idx_keyed_rows_updated ON keyed_rows (user_id, updated_at);

INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
SELECT user_id, workspace_id, key, data, version, updated_at, COALESCE(modified_at, updated_at), deleted_at
FROM plugin_data
WHERE pack_id IN ('qinqin-core', 'qinqin-flashcards') AND length(key) <= 512 AND (
    (workspace_id IS NOT NULL AND (key IN ('notecfg', 'lookups', 'goals:workspace')
        OR (substr(key, 1, 5) = 'note:' AND length(key) > 5)
        OR (substr(key, 1, 6) = 'known:' AND length(key) > 6)
        OR (substr(key, 1, 10) = 'milestone:' AND length(key) > 10)))
    OR (workspace_id IS NULL AND (key IN ('lookupcfg', 'home-layout', 'activity-view', 'widget-options', 'nav-layout', 'appearance')
        OR (substr(key, 1, 9) = 'vacation:' AND length(key) > 9))));

DROP TABLE plugin_data;
