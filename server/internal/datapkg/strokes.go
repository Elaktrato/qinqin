package datapkg

// strokesDef is a strokes pack (arg: its pack id): one stroke JSON per
// character, byte for byte as stored.
var strokesDef = typeDef{
	tables: []tableDef{{
		Name:  "strokes",
		SQL:   "CREATE TABLE strokes (char TEXT PRIMARY KEY, data TEXT NOT NULL)",
		Order: []string{"char"},
		cols:  []string{"char", "data"},
		query: `SELECT s.char, s.data FROM strokes s JOIN stroke_packs p ON p.pack_id = s.pack_id
			WHERE s.pack_id = ? AND p.deleted_at IS NULL ORDER BY s.char`,
	}},
}
