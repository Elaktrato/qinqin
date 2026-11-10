-- Level schemes and their members. A scheme is the registry row one
-- imported levels pack creates, keyed by the pack's manifest id;
-- re-imports upsert the row and replace its levels and memberships —
-- superseded rows are soft-deleted and the new list upserted, the same
-- discipline readings and senses follow — so a re-import never touches
-- entries or user data. unit is what the levels rank, words or
-- characters (the pack spelling "hanzi" normalizes to "character").
-- level_members joins an entry to a level; derived marks a character
-- membership computed from the words of a word-based scheme — a
-- character joins the lowest level whose member words are written with
-- it, at import, never silently at query time. Uninstall soft-deletes
-- the scheme, its levels, and its memberships; entries survive.

CREATE TABLE schemes (
    id INTEGER PRIMARY KEY,
    pack_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('word', 'character')),
    language TEXT NOT NULL,
    version TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE levels (
    id INTEGER PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES schemes(id),
    ord INTEGER NOT NULL,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (scheme_id, name)
);

CREATE TABLE level_members (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES levels(id),
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    derived INTEGER NOT NULL DEFAULT 0 CHECK (derived IN (0, 1)),
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (level_id, entry_id)
);

-- Badge lookup scans an entry's memberships; the level and scheme sides
-- are reached by primary key. Level and member listing scan scheme_id
-- and level_id, covered by the unique indexes' leading columns.
CREATE INDEX idx_level_members_entry ON level_members (entry_id);
