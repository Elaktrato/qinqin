-- Sentence sources (#280, docs/contracts/reader/sentence-sources.json): an
-- own sentence saved from the reader keeps where it was read. source_kind is
-- '' (no source) or 'book'; source_book_id is the library book, NULL when the
-- sentence has no source or the book was deleted (the delete sets it NULL,
-- so the title and the place stay as text); source_title is the book's title
-- when the sentence was saved; the place follows the highlights' model
-- (library_highlights): chapter, paragraph and the word's code-point range
-- [source_start, source_end) of the paragraph's plain text. Pack sentences
-- never carry a source. Existing rows get none.
ALTER TABLE sentences ADD COLUMN source_kind TEXT NOT NULL DEFAULT '' CHECK (source_kind IN ('', 'book'));
ALTER TABLE sentences ADD COLUMN source_book_id INTEGER;
ALTER TABLE sentences ADD COLUMN source_title TEXT NOT NULL DEFAULT '';
ALTER TABLE sentences ADD COLUMN source_chapter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentences ADD COLUMN source_paragraph INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentences ADD COLUMN source_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentences ADD COLUMN source_end INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_sentences_source_book ON sentences (user_id, source_book_id) WHERE source_book_id IS NOT NULL;
