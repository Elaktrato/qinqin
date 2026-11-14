-- Bookmarks: several per library book, kept on the server with the book
-- (books are not synced). position uses the reading-position format
-- ("<chapter>:<paragraph>"); label is a short, editable text snippet.
-- One bookmark per (book, position): adding at a bookmarked position
-- returns the existing one. Deleting a book deletes its bookmarks
-- (library.Store.Delete; foreign keys are not enforced).

CREATE TABLE library_bookmarks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    book_id INTEGER NOT NULL REFERENCES library_books(id),
    position TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_library_bookmarks_position ON library_bookmarks (book_id, position);
