-- Pack management: sentence packs get a registry like every other pack
-- type (so they can be listed, credited on the Sources page and shown to
-- an admin with the licence they were installed under), and dictionaries
-- record their language.
--
-- Sentence packs imported before this migration have no row; the admin
-- list shows them as "Licence not recorded" until they are reinstalled.
--
-- dictionaries.language is backfilled from the entry of one live sense;
-- a dictionary without live senses keeps '' until it is imported again.

CREATE TABLE sentence_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    language TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

ALTER TABLE dictionaries ADD COLUMN language TEXT NOT NULL DEFAULT '';

UPDATE dictionaries SET language = COALESCE((
    SELECT e.language FROM senses s JOIN entries e ON e.id = s.entry_id
    WHERE s.dictionary_id = dictionaries.id AND s.deleted_at IS NULL LIMIT 1), '');
