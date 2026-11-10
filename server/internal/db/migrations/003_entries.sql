-- Entries hold one written form each in one language: a single character
-- or a multi-character word. The same written form in two languages is two
-- entries. Pronunciations and attributes live in child rows (readings,
-- entry_attrs, created in 004_lang.sql); links carry the relations between
-- entries: variant pairs (stored in both directions), radical
-- classification, and word-character composition. Rows are soft-deleted
-- via deleted_at; queries never return soft-deleted rows and rows are
-- never hard-deleted.

CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    language TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('character', 'word')),
    written TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (written, kind, language)
);

CREATE TABLE entry_links (
    from_id INTEGER NOT NULL REFERENCES entries(id),
    to_id INTEGER NOT NULL REFERENCES entries(id),
    type TEXT NOT NULL CHECK (type IN ('variant', 'radical', 'wordchar')),
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (from_id, to_id, type)
);

-- Variant and word-char lookups scan from_id (covered by the primary key);
-- radical and containment lookups scan to_id.
CREATE INDEX idx_entry_links_to ON entry_links (to_id, type);
