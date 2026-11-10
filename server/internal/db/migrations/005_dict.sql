-- Dictionaries and their senses. A dictionary is the registry row one
-- imported dictionary pack creates, keyed by the pack's manifest id;
-- re-imports upsert the row (an uninstalled, soft-deleted row revives).
-- Senses are a dictionary's glosses: one row per (dictionary, entry,
-- gloss), ord the gloss's position among the entry's senses. Imports
-- replace a dictionary's senses wholesale — superseded rows are
-- soft-deleted and the new list inserted, the same discipline readings
-- follow — so a re-import never touches entries or user data. Uninstall
-- soft-deletes the dictionary and its senses; entries survive, other
-- dictionaries and user data may reference them.

CREATE TABLE dictionaries (
    id INTEGER PRIMARY KEY,
    pack_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE senses (
    id INTEGER PRIMARY KEY,
    dictionary_id INTEGER NOT NULL REFERENCES dictionaries(id),
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    gloss TEXT NOT NULL,
    ord INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- Sense replacement and uninstall scan a dictionary's rows; gloss
-- lookup (search) scans an entry's.
CREATE INDEX idx_senses_dictionary ON senses (dictionary_id);
CREATE INDEX idx_senses_entry ON senses (entry_id);
