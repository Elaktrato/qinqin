-- Highlights: marked ranges of a library book's text with an optional
-- note, kept on the server with the book (books are not synced). A
-- highlight lies inside one paragraph: (chapter, paragraph) plus the
-- code-point range [start_cp, end_cp) of the paragraph's plain text
-- (ruby excluded). text is a snapshot of the highlighted text, so the
-- reader can tell when the paragraph no longer matches. color is one of
-- yellow, green, blue, pink. Highlights of one paragraph do not overlap
-- (library.Store.AddHighlight). Deleting a book deletes its highlights
-- (library.Store.Delete; foreign keys are not enforced).

CREATE TABLE library_highlights (
    id INTEGER PRIMARY KEY,
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

CREATE INDEX idx_library_highlights_position ON library_highlights (book_id, chapter, paragraph, start_cp);
