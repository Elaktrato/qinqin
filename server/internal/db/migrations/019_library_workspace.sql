-- Library books belong to a workspace: each workspace has its own
-- library, and the dedupe key becomes (workspace_id, source, source_id),
-- so the same work may sit in two workspaces of one language.
--
-- Backfill: every existing book goes to the lowest-id workspace of its
-- (user, language). A user without a workspace of a book's language
-- first gets one (unnamed, empty settings), so no book is orphaned.
-- (Books are zh or ja, both code packs, so no languages row is needed.)
--
-- workspace_id is NOT NULL, which ALTER TABLE ADD COLUMN cannot add, so
-- the table is rebuilt with SQLite's create-copy-drop-rename procedure.
-- Ids are copied verbatim; nothing references library_books yet. The
-- runner applies migrations with foreign_keys OFF (see 018).

INSERT INTO workspaces (user_id, language, name, settings, updated_at)
SELECT DISTINCT b.user_id, b.language, '', '{}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM library_books b
WHERE NOT EXISTS (
    SELECT 1 FROM workspaces w WHERE w.user_id = b.user_id AND w.language = b.language
)
ORDER BY b.user_id, b.language;

CREATE TABLE library_books_new (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    language TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    attribution TEXT NOT NULL DEFAULT '',
    license_note TEXT NOT NULL DEFAULT '',
    chapter_count INTEGER NOT NULL DEFAULT 0,
    position TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

INSERT INTO library_books_new (id, user_id, workspace_id, language, title, author, source,
    source_id, source_url, attribution, license_note, chapter_count, position, created_at)
SELECT b.id, b.user_id,
    (SELECT MIN(w.id) FROM workspaces w WHERE w.user_id = b.user_id AND w.language = b.language),
    b.language, b.title, b.author, b.source, b.source_id, b.source_url, b.attribution,
    b.license_note, b.chapter_count, b.position, b.created_at
FROM library_books b;

DROP TABLE library_books;

ALTER TABLE library_books_new RENAME TO library_books;

CREATE UNIQUE INDEX idx_library_books_source ON library_books (workspace_id, source, source_id) WHERE source_id <> '';
CREATE INDEX idx_library_books_user ON library_books (user_id, id);
CREATE INDEX idx_library_books_workspace ON library_books (user_id, workspace_id, id);
