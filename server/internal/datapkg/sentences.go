package datapkg

// sentencesDef is a sentence pack (arg: its pack id): its live pack
// sentences whose entry is live; never a user's own sentence. Each row
// carries its credit (format 2): the Tatoeba id and owner of the sentence, and
// of the translation shown with it; 0 and "" for a sentence without one. A
// credit's link is not stored: it is the source's page of the id (Tatoeba:
// https://tatoeba.org/en/sentences/show/<id>).
var sentencesDef = typeDef{
	tables: []tableDef{{
		Name:  "sentences",
		SQL:   "CREATE TABLE sentences (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, hanzi TEXT NOT NULL, pinyin TEXT NOT NULL, translation TEXT NOT NULL, credit_id INTEGER NOT NULL, credit_owner TEXT NOT NULL, credit_tr_id INTEGER NOT NULL, credit_tr_owner TEXT NOT NULL)",
		Order: []string{"id"},
		cols:  []string{"id", "entry_id", "hanzi", "pinyin", "translation", "credit_id", "credit_owner", "credit_tr_id", "credit_tr_owner"},
		query: `SELECT s.id, s.entry_id, s.hanzi, s.pinyin, s.translation, s.credit_id, s.credit_owner, s.credit_tr_id, s.credit_tr_owner FROM sentences s
			JOIN sentence_packs p ON p.pack_id = s.source_pack JOIN entries e ON e.id = s.entry_id
			WHERE s.source_pack = ? AND p.deleted_at IS NULL AND s.user_id IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL
			ORDER BY s.id`,
	}},
	indexes: []string{"CREATE INDEX sentences_entry ON sentences (entry_id)"},
}
