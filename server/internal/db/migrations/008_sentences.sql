-- Example sentences on dictionary entries. A pack-provided sentence
-- carries its source pack — the manifest id of the sentences pack that
-- shipped it — and no owner; a user-added sentence carries the owning
-- user and no pack. Imports replace a pack's sentences wholesale —
-- superseded rows are soft-deleted and the new list inserted, the same
-- discipline readings and senses follow — scoping every write to that
-- pack's rows alone, so a re-import never leaves stale sentences and
-- never touches user-owned rows. Uninstall soft-deletes a pack's
-- sentences; entries and user sentences survive.

CREATE TABLE sentences (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    source_pack TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    hanzi TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    translation TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- Sentence lookup scans an entry's rows; pack replacement and
-- uninstall scan a pack's.
CREATE INDEX idx_sentences_entry ON sentences (entry_id);
CREATE INDEX idx_sentences_pack ON sentences (source_pack);
