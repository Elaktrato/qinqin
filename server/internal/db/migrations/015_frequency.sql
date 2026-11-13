-- Frequency packs: word-frequency lists the lookup shows next to a hit.
-- A pack is a lx_freq_packs row of its own (not a dictionaries row);
-- ord is the pack's priority — the first pack with data for a word wins —
-- assigned in import order when the pack first registers and kept on
-- re-import. content_hash fingerprints the pack's rows so an identical
-- re-import writes nothing. A lx_frequency row is one term (optionally
-- tied to one reading; '' matches any) with its rank (1 = most frequent)
-- and the pack's own display text for it ('' when it gave none).

CREATE TABLE lx_freq_packs (
    id INTEGER PRIMARY KEY,
    pack_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    language TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    ord INTEGER NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE lx_frequency (
    pack_id INTEGER NOT NULL REFERENCES lx_freq_packs(id),
    term TEXT NOT NULL,
    reading TEXT NOT NULL DEFAULT '',
    rank INTEGER NOT NULL,
    display TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_lx_frequency_term ON lx_frequency (term);
CREATE INDEX idx_lx_frequency_pack_term ON lx_frequency (pack_id, term, reading);
