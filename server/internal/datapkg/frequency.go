package datapkg

// frequencyDef is a frequency pack (arg: its pack id): its rows.
var frequencyDef = typeDef{
	tables: []tableDef{{
		Name:  "frequency",
		SQL:   "CREATE TABLE frequency (term TEXT NOT NULL, reading TEXT NOT NULL, rank INTEGER NOT NULL, display TEXT NOT NULL)",
		Order: []string{"rank", "term", "reading", "display"},
		cols:  []string{"term", "reading", "rank", "display"},
		query: `SELECT f.term, f.reading, f.rank, f.display FROM frequency f JOIN frequency_packs p ON p.id = f.pack_id
			WHERE p.pack_id = ? AND p.deleted_at IS NULL ORDER BY f.rowid`,
	}},
	indexes: []string{"CREATE INDEX frequency_term ON frequency (term, reading)"},
}
