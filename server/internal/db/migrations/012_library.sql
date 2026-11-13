-- Library: books a user keeps for reading. The row holds the metadata
-- and the reading position; the content (chapters) lives in a file
-- <books dir>/<user_id>/<id>.json, never in plugin_data. Storage is
-- per user. source/source_id identify where a book came from (an
-- upload uses a content hash as source_id) so importing the same
-- book twice is rejected; books without a source_id never clash.

CREATE TABLE library_books (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
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

CREATE UNIQUE INDEX idx_library_books_source ON library_books (user_id, source, source_id) WHERE source_id <> '';
CREATE INDEX idx_library_books_user ON library_books (user_id, id);
