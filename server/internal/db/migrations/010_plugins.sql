-- Plugin platform: the feature-plugin registry, per-user plugin
-- state, and the plugin-owned data store. Feature plugins (heatmap,
-- flashcards, ...) ship no content of their own: the admin registers
-- each one's manifest — any JSON object keyed by its id — and it is
-- stored verbatim. Data plugins (dictionary, levels, sentences packs)
-- register themselves through their pack registries and need no row
-- here. plugin_states is one user's view of one plugin: whether it is
-- enabled on their home and where it sits in the home order — no row
-- means enabled at order 0. plugin_data is what a plugin stores per
-- key (settings, decks): scoped to one workspace, or user-global when
-- workspace_id is NULL. Every write bumps version and updated_at, so
-- clients sync by pulling rows changed since a timestamp; deletions
-- are tombstones in deleted_at, never hard deletes.

CREATE TABLE plugin_registry (
    pack_id TEXT PRIMARY KEY,
    manifest_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE plugin_states (
    user_id INTEGER NOT NULL REFERENCES users(id),
    pack_id TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    ord INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (pack_id, user_id)
);

CREATE TABLE plugin_data (
    pack_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER REFERENCES workspaces(id),
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- One data row per (plugin, user, workspace, key). A NULL workspace_id
-- is the user-global row, and SQLite unique keys treat NULLs as
-- distinct — so the key coalesces NULL to 0, an id no workspace can
-- have, keeping the user-global row and every workspace's row apart.
CREATE UNIQUE INDEX idx_plugin_data_key ON plugin_data (pack_id, user_id, IFNULL(workspace_id, 0), key);
-- Client sync scans the owner's rows by recency.
CREATE INDEX idx_plugin_data_user_updated ON plugin_data (user_id, updated_at);
