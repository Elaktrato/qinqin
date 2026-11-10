-- Languages, workspaces, and the entry child rows for readings and
-- attributes. languages records data-only registrations: codes without a
-- compile-time pack, auto-registered when a pack or workspace references
-- them. Code packs (zh, ja) register in code instead and get no row.

CREATE TABLE languages (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- A workspace is one user's per-language study container with its own
-- settings, a JSON object. Users never see each other's workspaces.
CREATE TABLE workspaces (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    language TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, language)
);

-- Readings are entry pronunciations: type is pack-defined (pinyin,
-- bopomofo, kana, on, kun, romaji, ...), plain is the normalized search
-- form, ord is the reading's position among the entry's readings. Upserts
-- replace an entry's reading list; superseded rows are soft-deleted.
CREATE TABLE readings (
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    plain TEXT NOT NULL,
    ord INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (entry_id, ord)
);

-- Entry attributes carry per-entry metadata such as stroke counts. Keys
-- upsert in place.
CREATE TABLE entry_attrs (
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (entry_id, key)
);
