package datapkg

// lexiconDef is a language's lexicon (arg: the language): every live entry
// of the language, its live forms and readings, the links between two live
// entries of the language, and the live senses of the language's live
// dictionaries, with those dictionaries. Senses carry no ids.
var lexiconDef = typeDef{
	tables: []tableDef{
		{
			Name:  "entries",
			SQL:   "CREATE TABLE entries (id INTEGER PRIMARY KEY, language TEXT NOT NULL, kind TEXT NOT NULL, ext_key TEXT NOT NULL, pri INTEGER NOT NULL, uk INTEGER NOT NULL, attrs TEXT NOT NULL)",
			Order: []string{"id"},
			cols:  []string{"id", "language", "kind", "ext_key", "pri", "uk", "attrs"},
			query: `SELECT id, language, kind, ext_key, pri, uk, attrs FROM entries
				WHERE language = ? AND deleted_at IS NULL ORDER BY id`,
		},
		{
			Name:  "forms",
			SQL:   "CREATE TABLE forms (entry_id INTEGER NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL, flags TEXT NOT NULL, pri INTEGER NOT NULL)",
			Order: []string{"entry_id", "ord", "text", "flags", "pri"},
			cols:  []string{"entry_id", "ord", "text", "flags", "pri"},
			query: `SELECT f.entry_id, f.ord, f.text, f.flags, f.pri FROM forms f JOIN entries e ON e.id = f.entry_id
				WHERE e.language = ? AND e.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY f.id`,
		},
		{
			Name:  "readings",
			SQL:   "CREATE TABLE readings (entry_id INTEGER NOT NULL, ord INTEGER NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL, plain TEXT NOT NULL, flags TEXT NOT NULL, pri INTEGER NOT NULL)",
			Order: []string{"entry_id", "ord", "type", "value", "plain", "flags", "pri"},
			cols:  []string{"entry_id", "ord", "type", "value", "plain", "flags", "pri"},
			query: `SELECT r.entry_id, r.ord, r.type, r.value, r.plain, r.flags, r.pri FROM readings r JOIN entries e ON e.id = r.entry_id
				WHERE e.language = ? AND e.deleted_at IS NULL AND r.deleted_at IS NULL ORDER BY r.id`,
		},
		{
			Name:  "senses",
			SQL:   "CREATE TABLE senses (entry_id INTEGER NOT NULL, dictionary_id INTEGER NOT NULL, ord INTEGER NOT NULL, pos TEXT NOT NULL, tags TEXT NOT NULL, glosses TEXT NOT NULL, xrefs TEXT NOT NULL)",
			Order: []string{"entry_id", "dictionary_id", "ord", "pos", "tags", "glosses", "xrefs"},
			cols:  []string{"entry_id", "dictionary_id", "ord", "pos", "tags", "glosses", "xrefs"},
			query: `SELECT s.entry_id, s.dictionary_id, s.ord, s.pos, s.tags, s.glosses, s.xrefs
				FROM senses s JOIN entries e ON e.id = s.entry_id JOIN dictionaries d ON d.id = s.dictionary_id
				WHERE e.language = ?1 AND d.language = ?1 AND e.deleted_at IS NULL AND d.deleted_at IS NULL AND s.deleted_at IS NULL
				ORDER BY s.id`,
		},
		{
			Name:  "links",
			SQL:   "CREATE TABLE links (from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, type TEXT NOT NULL, PRIMARY KEY (from_id, to_id, type))",
			Order: []string{"from_id", "to_id", "type"},
			cols:  []string{"from_id", "to_id", "type"},
			query: `SELECT l.from_id, l.to_id, l.type FROM entry_links l
				JOIN entries a ON a.id = l.from_id JOIN entries b ON b.id = l.to_id
				WHERE a.language = ?1 AND b.language = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND l.deleted_at IS NULL
				ORDER BY l.from_id, l.to_id, l.type`,
		},
		{
			Name:  "dictionaries",
			SQL:   "CREATE TABLE dictionaries (id INTEGER PRIMARY KEY, pack_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, language TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, notice TEXT NOT NULL)",
			Order: []string{"id"},
			cols:  []string{"id", "pack_id", "name", "version", "language", "license", "attribution", "notice"},
			query: `SELECT id, pack_id, name, version, language, license, attribution, notice FROM dictionaries
				WHERE language = ? AND deleted_at IS NULL ORDER BY id`,
		},
	},
	indexes: []string{
		"CREATE INDEX forms_entry ON forms (entry_id, ord)",
		"CREATE INDEX forms_text ON forms (text)",
		"CREATE INDEX readings_entry ON readings (entry_id, ord)",
		"CREATE INDEX readings_plain ON readings (plain)",
		"CREATE INDEX senses_entry ON senses (entry_id, dictionary_id, ord)",
		"CREATE INDEX links_to ON links (to_id, type)",
	},
}
