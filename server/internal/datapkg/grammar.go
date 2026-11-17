package datapkg

// grammarDef is a grammar pack (arg: its pack id): its live lessons, and
// its level list as qq_package levels_json.
var grammarDef = typeDef{
	tables: []tableDef{{
		Name:  "lessons",
		SQL:   "CREATE TABLE lessons (lesson_id TEXT PRIMARY KEY, level_id TEXT NOT NULL, ord INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, content TEXT NOT NULL)",
		Order: []string{"lesson_id"},
		cols:  []string{"lesson_id", "level_id", "ord", "title", "summary", "content"},
		query: `SELECT l.lesson_id, l.level_id, l.ord, l.title, l.summary, l.content_json
			FROM grammar_lessons l JOIN grammar_packs p ON p.id = l.pack_id
			WHERE p.pack_id = ? AND p.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY l.ord, l.lesson_id`,
	}},
	indexes: []string{"CREATE INDEX lessons_level ON lessons (level_id, ord)"},
	extraKeys: []extraKey{{
		key:   "levels_json",
		query: `SELECT levels_json FROM grammar_packs WHERE pack_id = ? AND deleted_at IS NULL`,
	}},
}
