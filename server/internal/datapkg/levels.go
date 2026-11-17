package datapkg

// levelsDef is one level scheme (arg: its pack id) with its live levels and
// the live members whose entry is live.
var levelsDef = typeDef{
	tables: []tableDef{
		{
			Name:  "schemes",
			SQL:   "CREATE TABLE schemes (id INTEGER PRIMARY KEY, pack_id TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL, language TEXT NOT NULL, version TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, notice TEXT NOT NULL)",
			Order: []string{"id"},
			cols:  []string{"id", "pack_id", "name", "unit", "language", "version", "license", "attribution", "notice"},
			query: `SELECT id, pack_id, name, unit, language, version, license, attribution, notice FROM schemes
				WHERE pack_id = ? AND deleted_at IS NULL ORDER BY id`,
		},
		{
			Name:  "levels",
			SQL:   "CREATE TABLE levels (id INTEGER PRIMARY KEY, scheme_id INTEGER NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL)",
			Order: []string{"id"},
			cols:  []string{"id", "scheme_id", "ord", "name"},
			query: `SELECT l.id, l.scheme_id, l.ord, l.name FROM levels l JOIN schemes s ON s.id = l.scheme_id
				WHERE s.pack_id = ? AND s.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY l.id`,
		},
		{
			Name:  "level_members",
			SQL:   "CREATE TABLE level_members (level_id INTEGER NOT NULL, entry_id INTEGER NOT NULL, derived INTEGER NOT NULL, PRIMARY KEY (level_id, entry_id))",
			Order: []string{"level_id", "entry_id"},
			cols:  []string{"level_id", "entry_id", "derived"},
			query: `SELECT m.level_id, m.entry_id, m.derived FROM level_members m
				JOIN levels l ON l.id = m.level_id JOIN schemes s ON s.id = l.scheme_id JOIN entries e ON e.id = m.entry_id
				WHERE s.pack_id = ? AND s.deleted_at IS NULL AND l.deleted_at IS NULL AND m.deleted_at IS NULL AND e.deleted_at IS NULL
				ORDER BY m.level_id, m.entry_id`,
		},
	},
	indexes: []string{"CREATE INDEX level_members_entry ON level_members (entry_id)"},
}
