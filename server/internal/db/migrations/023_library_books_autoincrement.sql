-- Book ids are never reused. Books are deleted one by one and, since
-- workspace deletion, in bulk with their workspace, and a plain INTEGER
-- PRIMARY KEY hands the highest deleted id to the next insert: a reader
-- tab still open on a deleted book would then save its position, its
-- bookmarks and its highlights into an unrelated new book, and the
-- content file of the deleted book (removed after the commit) could be
-- the new book's. AUTOINCREMENT keeps the high-water mark in
-- sqlite_sequence, so a deleted id stays dead.
--
-- The table is rebuilt exactly as in 019 (create, copy, drop, rename;
-- ids and every column copied verbatim, the copy seeds sqlite_sequence
-- with the largest id), and its three indexes, dropped with the old
-- table, are recreated as 019 wrote them. The children
-- (library_bookmarks, library_highlights) name the table in their
-- REFERENCES clauses and resolve to the rebuilt one; the runner applies
-- migrations with foreign_keys OFF, so the drop does not touch them.
-- library_books has no triggers.

CREATE TABLE library_books_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
SELECT id, user_id, workspace_id, language, title, author, source,
    source_id, source_url, attribution, license_note, chapter_count, position, created_at
FROM library_books;

DROP TABLE library_books;

ALTER TABLE library_books_new RENAME TO library_books;

CREATE UNIQUE INDEX idx_library_books_source ON library_books (workspace_id, source, source_id) WHERE source_id <> '';
CREATE INDEX idx_library_books_user ON library_books (user_id, id);
CREATE INDEX idx_library_books_workspace ON library_books (user_id, workspace_id, id);
