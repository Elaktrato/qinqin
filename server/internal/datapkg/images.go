package datapkg

// imagesDef is an images pack (#216, #274; arg: its pack id): the word ->
// picture map as stored, and the pictures a map row uses in their stored
// canonical form (images.CanonicalSVG), so a client resolves a picture
// offline with the server's rule (docs/contracts/images/README.md).
var imagesDef = typeDef{
	tables: []tableDef{{
		Name:  "pictures",
		SQL:   "CREATE TABLE pictures (concept TEXT PRIMARY KEY, label TEXT NOT NULL, credit TEXT NOT NULL, svg TEXT NOT NULL)",
		Order: []string{"concept"},
		cols:  []string{"concept", "label", "credit", "svg"},
		query: `SELECT s.concept, s.label, s.credit, s.svg FROM image_pictures s JOIN image_packs p ON p.pack_id = s.pack_id
			WHERE s.pack_id = ? AND p.deleted_at IS NULL
			AND EXISTS (SELECT 1 FROM image_map m WHERE m.pack_id = s.pack_id AND m.concept = s.concept)
			ORDER BY s.concept`,
	}, {
		Name:  "map",
		SQL:   "CREATE TABLE map (language TEXT NOT NULL, target TEXT NOT NULL, sense INTEGER NOT NULL, concept TEXT NOT NULL, score INTEGER NOT NULL, basis TEXT NOT NULL, PRIMARY KEY (language, target, sense, concept))",
		Order: []string{"language", "target", "sense", "concept"},
		cols:  []string{"language", "target", "sense", "concept", "score", "basis"},
		query: `SELECT m.language, m.target, m.sense, m.concept, m.score, m.basis FROM image_map m JOIN image_packs p ON p.pack_id = m.pack_id
			WHERE m.pack_id = ? AND p.deleted_at IS NULL ORDER BY m.language, m.target, m.sense, m.concept`,
	}},
}
