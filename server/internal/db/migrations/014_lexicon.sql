-- The lexicon: the dictionary store the Yomitan-style lookup reads, built
-- beside the legacy entries tables until the cutover. An lx_entries row
-- is one dictionary headword (a JMdict sequence, a CEDICT line, a Unihan
-- character), identified by its source's external key ext_key within
-- (language, kind). Its written forms, readings and senses are child
-- rows; slice-valued columns (flags, pos, tags, glosses, xrefs) and attrs
-- hold JSON text. pri is a ranking score (higher first), uk marks a word
-- usually written in kana. Every table soft-deletes via deleted_at and
-- stamps updated_at (RFC 3339); a Put that changes nothing writes nothing.
-- Senses belong to a dictionaries row, so several dictionaries can gloss
-- one entry and each replaces only its own senses.

CREATE TABLE lx_entries (
    id INTEGER PRIMARY KEY,
    language TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('word', 'character')),
    ext_key TEXT NOT NULL,
    pri INTEGER NOT NULL DEFAULT 0,
    uk INTEGER NOT NULL DEFAULT 0,
    attrs TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (language, kind, ext_key)
);

CREATE TABLE lx_forms (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES lx_entries(id),
    text TEXT NOT NULL,
    ord INTEGER NOT NULL,
    flags TEXT NOT NULL DEFAULT '[]',
    pri INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- Lookup matches surface text against forms; loading scans an entry's.
CREATE INDEX idx_lx_forms_text ON lx_forms (text);
CREATE INDEX idx_lx_forms_entry ON lx_forms (entry_id, ord);

CREATE TABLE lx_readings (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES lx_entries(id),
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    plain TEXT NOT NULL,
    ord INTEGER NOT NULL,
    flags TEXT NOT NULL DEFAULT '[]',
    pri INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- Lookup matches kana/pinyin text against readings.plain.
CREATE INDEX idx_lx_readings_plain ON lx_readings (plain, entry_id);
CREATE INDEX idx_lx_readings_entry ON lx_readings (entry_id, ord);

CREATE TABLE lx_senses (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES lx_entries(id),
    dictionary_id INTEGER NOT NULL REFERENCES dictionaries(id),
    ord INTEGER NOT NULL,
    pos TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    glosses TEXT NOT NULL DEFAULT '[]',
    xrefs TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX idx_lx_senses_entry ON lx_senses (entry_id, dictionary_id, ord);
CREATE INDEX idx_lx_senses_dictionary ON lx_senses (dictionary_id);

-- Variant links are stored in both directions; radical links point from a
-- character to its radical.
CREATE TABLE lx_links (
    from_id INTEGER NOT NULL REFERENCES lx_entries(id),
    to_id INTEGER NOT NULL REFERENCES lx_entries(id),
    type TEXT NOT NULL CHECK (type IN ('variant', 'radical')),
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (from_id, to_id, type)
);

CREATE INDEX idx_lx_links_to ON lx_links (to_id, type);
