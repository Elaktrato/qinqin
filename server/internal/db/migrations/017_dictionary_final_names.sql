-- The lexicon replaces the legacy dictionary layer. The legacy tables
-- (003_entries, 004_lang, 005_dict, 013) go — their indexes with them —
-- and the lexicon and frequency tables (014, 015, 016) take the final
-- names. No data moves: the legacy tables only ever mirrored what the
-- lexicon import writes, and a database is rebuilt by seeding again.
--
-- The legacy tables drop first so their names are free. level_members,
-- sentences and user_edits reference entries(id) by name; once
-- lx_entries is renamed, that name resolves to the lexicon's entries.
-- RENAME TABLE also rewrites the REFERENCES clauses that name a renamed
-- table (lx_forms -> lx_entries becomes forms -> entries) and the
-- tables' automatic indexes; the explicit indexes are recreated under
-- names that follow the table (idx_<table>_<columns>).

DROP TABLE entry_links;
DROP TABLE entry_attrs;
DROP TABLE senses;
DROP TABLE readings;
DROP TABLE entries;

ALTER TABLE lx_entries RENAME TO entries;
ALTER TABLE lx_forms RENAME TO forms;
ALTER TABLE lx_readings RENAME TO readings;
ALTER TABLE lx_senses RENAME TO senses;
ALTER TABLE lx_links RENAME TO entry_links;
ALTER TABLE lx_freq_packs RENAME TO frequency_packs;
ALTER TABLE lx_frequency RENAME TO frequency;

DROP INDEX idx_lx_entries_updated;
CREATE INDEX idx_entries_updated ON entries (updated_at);

DROP INDEX idx_lx_forms_text;
DROP INDEX idx_lx_forms_entry;
-- Lookup matches surface text against forms; loading scans an entry's.
CREATE INDEX idx_forms_text ON forms (text);
CREATE INDEX idx_forms_entry ON forms (entry_id, ord);

DROP INDEX idx_lx_readings_plain;
DROP INDEX idx_lx_readings_entry;
-- Lookup matches kana/pinyin text against readings.plain.
CREATE INDEX idx_readings_plain ON readings (plain, entry_id);
CREATE INDEX idx_readings_entry ON readings (entry_id, ord);

DROP INDEX idx_lx_senses_entry;
DROP INDEX idx_lx_senses_dictionary;
DROP INDEX idx_lx_senses_updated;
CREATE INDEX idx_senses_entry ON senses (entry_id, dictionary_id, ord);
CREATE INDEX idx_senses_dictionary ON senses (dictionary_id);
CREATE INDEX idx_senses_updated ON senses (updated_at);

DROP INDEX idx_lx_links_to;
DROP INDEX idx_lx_links_updated;
CREATE INDEX idx_entry_links_to ON entry_links (to_id, type);
CREATE INDEX idx_entry_links_updated ON entry_links (updated_at);

DROP INDEX idx_lx_frequency_term;
DROP INDEX idx_lx_frequency_pack_term;
CREATE INDEX idx_frequency_term ON frequency (term);
CREATE INDEX idx_frequency_pack_term ON frequency (pack_id, term, reading);
