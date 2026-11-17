-- Data packages and the paged sync pull (#93, v0.4.0 prep item 5).
--
-- server_meta holds server-wide values; the Go step of this migration
-- (gosteps.go) inserts instance_id, a random ULID that names this database:
-- clients compare it to tell a reinstalled server from the one they synced
-- with (docs/contracts/packages/).
--
-- pack_texts keeps each installed pack's licence files (LICENSE*,
-- ATTRIBUTION*, NOTICE*, COPYING*) verbatim, so packages carry them.
--
-- packages is the registry of server-built data packages (one row per
-- package id, tombstones kept for good); package_files the files on disk per
-- revision, with retire_after once a newer revision replaced it.
--
-- stroke_packs and strokes are the stroke-order store of installed strokes
-- packs (one row per pack and character).
--
-- The indexes on (user_id, updated_at) let the paged pull walk each user
-- table by (updated_at, rowid) without a scan or a sort.

CREATE TABLE server_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE pack_texts (
    pack_type TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (pack_type, pack_id, name)
);

CREATE TABLE packages (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    languages TEXT NOT NULL,
    format_version INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    built_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('building', 'ready', 'failed', 'deleted')),
    error TEXT NOT NULL DEFAULT '',
    requires TEXT NOT NULL DEFAULT '[]',
    optional INTEGER NOT NULL DEFAULT 0,
    sources TEXT NOT NULL DEFAULT '[]',
    license_texts INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE package_files (
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    retire_after TEXT,
    PRIMARY KEY (id, revision)
);

CREATE TABLE stroke_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    languages TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    ord INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE strokes (
    pack_id TEXT NOT NULL,
    char TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (char, pack_id)
);

CREATE INDEX idx_workspaces_user_updated ON workspaces (user_id, updated_at);
CREATE INDEX idx_plugin_states_user_updated ON plugin_states (user_id, updated_at);
CREATE INDEX idx_library_books_user_updated ON library_books (user_id, updated_at);
CREATE INDEX idx_library_bookmarks_user_updated ON library_bookmarks (user_id, updated_at);
CREATE INDEX idx_library_highlights_user_updated ON library_highlights (user_id, updated_at);
CREATE INDEX idx_user_edits_user_updated ON user_edits (user_id, updated_at);
CREATE INDEX idx_sentences_user_updated ON sentences (user_id, updated_at) WHERE user_id IS NOT NULL;
CREATE INDEX idx_study_events_user_updated ON study_events (user_id, updated_at);
