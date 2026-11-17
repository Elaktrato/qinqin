-- Flashcards and the reader become core features (#85, v0.4.0 prep item 4).
--
-- Study state: until now cards, decks, deck settings, daily limits, FSRS
-- parameter sets and the active set were keyed JSON rows of plugin
-- qinqin-flashcards in plugin_data. Each key family gets a typed table,
-- one row per legacy key (identity, version, stamps and tombstone kept),
-- with plugin_data's sync columns: version (bumped per write), updated_at
-- (the server's write stamp, the pull cursor), modified_at (the edit time
-- last-write-wins compares), deleted_at (tombstone) and extra (every member
-- the typed shape does not carry, verbatim, as a JSON object). Times are
-- RFC 3339 UTC seconds. The Go step of this migration (gosteps.go) moves
-- the readable rows; rows no client could read stay in plugin_data.
-- Shapes and the legacy codec: docs/contracts/study/.
--
-- Library: books and bookmarks gain updated_at (backfilled from
-- created_at), bookmarks and highlights get AUTOINCREMENT ids (as 023 did
-- for books: a deleted id that came back would make a delta client apply
-- "deleted 5" and "created 5" in the wrong order), and deletions of books,
-- bookmarks and highlights are logged in library_deletions for the paged
-- library sync. The rebuilds copy every column and id verbatim; the
-- indexes of 020 and 021 are recreated as written there. The runner
-- applies migrations with foreign_keys OFF, so the drops cascade nowhere.

CREATE TABLE study_cards (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('vocab', 'sentence', 'writing', 'tone', 'reverse', 'cloze')),
    entry_id INTEGER NOT NULL,
    written TEXT,
    entry_kind TEXT CHECK (entry_kind IS NULL OR entry_kind = 'character'),
    sentence_id INTEGER,
    skip_kinds TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skip_kinds) AND json_type(skip_kinds) = 'array'),
    deck_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(deck_ids) AND json_type(deck_ids) = 'array'),
    created_at TEXT NOT NULL,
    extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object'),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, workspace_id, id)
);
CREATE INDEX idx_study_cards_updated ON study_cards (user_id, updated_at);
CREATE INDEX idx_study_cards_entry ON study_cards (user_id, workspace_id, entry_id);

CREATE TABLE study_decks (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source TEXT CHECK (source IS NULL OR (json_valid(source) AND json_type(source) = 'object')),
    extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object'),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, workspace_id, id)
);
CREATE INDEX idx_study_decks_updated ON study_decks (user_id, updated_at);

CREATE TABLE study_deck_settings (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    deck_id TEXT NOT NULL CHECK (deck_id <> ''),
    card_types TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(card_types) AND json_type(card_types) = 'array'),
    new_order TEXT CHECK (new_order IS NULL OR (json_valid(new_order) AND json_type(new_order) = 'object')),
    extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object'),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, workspace_id, deck_id)
);
CREATE INDEX idx_study_deck_settings_updated ON study_deck_settings (user_id, updated_at);

-- deck_id '' is the workspace row (limits:workspace); new_set/reviews_set
-- say whether the field is present (absent = inherit), new_limit NULL with
-- new_set 1 is "unlimited".
CREATE TABLE study_limits (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    deck_id TEXT NOT NULL,
    new_set INTEGER NOT NULL CHECK (new_set IN (0, 1)),
    new_limit INTEGER CHECK (new_limit IS NULL OR (new_limit BETWEEN 0 AND 9999 AND new_set = 1)),
    reviews_set INTEGER NOT NULL CHECK (reviews_set IN (0, 1)),
    reviews_limit INTEGER CHECK (reviews_limit IS NULL OR (reviews_limit BETWEEN 0 AND 9999 AND reviews_set = 1)),
    extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object'),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, workspace_id, deck_id)
);
CREATE INDEX idx_study_limits_updated ON study_limits (user_id, updated_at);

CREATE TABLE study_fsrs_sets (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL,
    w TEXT NOT NULL CHECK (json_valid(w) AND json_type(w) = 'array' AND json_array_length(w) = 21),
    created_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('optimized', 'imported')),
    labelled REAL,
    log_loss REAL,
    baseline_log_loss REAL,
    extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object'),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, workspace_id, id)
);
CREATE INDEX idx_study_fsrs_sets_updated ON study_fsrs_sets (user_id, updated_at);

CREATE TABLE study_fsrs_active (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    set_id TEXT,
    changed_at TEXT,
    extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object'),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, workspace_id)
);
CREATE INDEX idx_study_fsrs_active_updated ON study_fsrs_active (user_id, updated_at);

-- Library row stamps. '' only until the backfill below; every write sets it.
ALTER TABLE library_books ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE library_books SET updated_at = created_at;

CREATE TABLE library_bookmarks_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    book_id INTEGER NOT NULL REFERENCES library_books(id),
    position TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);
INSERT INTO library_bookmarks_new (id, user_id, book_id, position, label, created_at, updated_at)
SELECT id, user_id, book_id, position, label, created_at, created_at FROM library_bookmarks;
DROP TABLE library_bookmarks;
ALTER TABLE library_bookmarks_new RENAME TO library_bookmarks;
CREATE UNIQUE INDEX idx_library_bookmarks_position ON library_bookmarks (book_id, position);

CREATE TABLE library_highlights_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    book_id INTEGER NOT NULL REFERENCES library_books(id),
    chapter INTEGER NOT NULL,
    paragraph INTEGER NOT NULL,
    start_cp INTEGER NOT NULL,
    end_cp INTEGER NOT NULL,
    text TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'yellow',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO library_highlights_new (id, user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
SELECT id, user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at FROM library_highlights;
DROP TABLE library_highlights;
ALTER TABLE library_highlights_new RENAME TO library_highlights;
CREATE INDEX idx_library_highlights_position ON library_highlights (book_id, chapter, paragraph, start_cp);

-- One row per deleted library row (books, bookmarks, highlights), written in
-- the transaction of the delete; workspace_id is the workspace the row was in
-- (it may be gone). Never exported; removed with the user and on a restore.
CREATE TABLE library_deletions (
    user_id INTEGER NOT NULL REFERENCES users(id),
    collection TEXT NOT NULL CHECK (collection IN ('books', 'bookmarks', 'highlights')),
    row_id INTEGER NOT NULL,
    workspace_id INTEGER NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (collection, row_id)
);
CREATE INDEX idx_library_deletions_user ON library_deletions (user_id, deleted_at);
