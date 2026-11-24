-- The journal becomes a core feature (#199, record 0006): its documents move
-- from plugin_data rows of qinqin-journal (entry:<id>, review:<id>,
-- suggestions, settings) into typed tables, one per document kind, each
-- scoped to one workspace of one user. Shapes: docs/contracts/journal/.
-- Nothing of the journal is in the paged pull; clients read it through
-- /api/journal/*. JSON columns hold the nested parts of a document (the
-- annotations, the overall review, the drop counts, the suggestion items)
-- and are checked for validity and type.
--
-- What the rules accept is copied, normalised where it can be (control
-- characters stripped, an over-long title, text or guidance cut, a missing or
-- unreadable stamp replaced by the row's write time, an unknown explanation
-- language read as "en"); a document that cannot be (a bad id, an impossible
-- date, JSON that does not decode, a review without its entry) is dropped,
-- and every qinqin-journal row is deleted (the owner allows a clean start,
-- NEXT.md). A personal backup of the result restores without loss.

CREATE TABLE journal_entries (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
    date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('typed', 'photo')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, id)
);

CREATE TABLE journal_reviews (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    entry_id TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    annotations TEXT NOT NULL CHECK (json_valid(annotations) AND json_type(annotations) = 'array'),
    overall TEXT NOT NULL CHECK (json_valid(overall) AND json_type(overall) = 'object'),
    model TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    fallback_from TEXT NOT NULL DEFAULT '',
    dropped TEXT NOT NULL CHECK (json_valid(dropped) AND json_type(dropped) = 'object'),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, entry_id)
);

CREATE TABLE journal_suggestions (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    items TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'),
    model TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE journal_settings (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    guidance TEXT NOT NULL,
    explanation_language TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
);

-- The copy is the Go step of this migration (step044.go): it applies the
-- journal's rules as of #199, which SQL cannot (control characters, code
-- point limits, calendar dates, RFC 3339 stamps, documents that must decode).
