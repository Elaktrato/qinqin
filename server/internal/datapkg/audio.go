package datapkg

// audioDef is an audio pack (arg: its pack id): its clips, each with its own
// licence and attribution. The clip files go into the zip (zip.go).
var audioDef = typeDef{
	tables: []tableDef{{
		Name:  "clips",
		SQL:   "CREATE TABLE clips (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, form TEXT NOT NULL, reading_key TEXT NOT NULL, sha256 TEXT NOT NULL, ext TEXT NOT NULL, bytes INTEGER NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, source TEXT NOT NULL)",
		Order: []string{"id"},
		cols:  []string{"id", "kind", "form", "reading_key", "sha256", "ext", "bytes", "license", "attribution", "source"},
		query: `SELECT c.id, c.kind, c.form, c.reading_key, c.sha256, c.ext, c.bytes, c.license, c.attribution, c.source
			FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id
			WHERE p.pack_id = ? AND p.deleted_at IS NULL ORDER BY c.id`,
	}},
	indexes: []string{"CREATE INDEX clips_lookup ON clips (kind, form, reading_key)"},
}
