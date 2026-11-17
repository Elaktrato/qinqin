package datapkg

// sentencesDef is a sentence pack (arg: its pack id): its live pack
// sentences whose entry is live; never a user's own sentence.
var sentencesDef = typeDef{
	tables: []tableDef{{
		Name:  "sentences",
		SQL:   "CREATE TABLE sentences (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, hanzi TEXT NOT NULL, pinyin TEXT NOT NULL, translation TEXT NOT NULL)",
		Order: []string{"id"},
		cols:  []string{"id", "entry_id", "hanzi", "pinyin", "translation"},
		query: `SELECT s.id, s.entry_id, s.hanzi, s.pinyin, s.translation FROM sentences s
			JOIN sentence_packs p ON p.pack_id = s.source_pack JOIN entries e ON e.id = s.entry_id
			WHERE s.source_pack = ? AND p.deleted_at IS NULL AND s.user_id IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL
			ORDER BY s.id`,
	}},
	indexes: []string{"CREATE INDEX sentences_entry ON sentences (entry_id)"},
}
