package datapkg

// componentsDef is a components pack (arg: its pack id): its characters and
// part stroke counts.
var componentsDef = typeDef{
	tables: []tableDef{
		{
			Name:  "components",
			SQL:   "CREATE TABLE components (char TEXT PRIMARY KEY, parts TEXT NOT NULL)",
			Order: []string{"char"},
			cols:  []string{"char", "parts"},
			query: `SELECT c.char, c.parts FROM components c JOIN component_packs p ON p.pack_id = c.pack_id
				WHERE c.pack_id = ? AND p.deleted_at IS NULL ORDER BY c.char`,
		},
		{
			Name:  "component_parts",
			SQL:   "CREATE TABLE component_parts (part TEXT PRIMARY KEY, strokes INTEGER NOT NULL)",
			Order: []string{"part"},
			cols:  []string{"part", "strokes"},
			query: `SELECT c.part, c.strokes FROM component_parts c JOIN component_packs p ON p.pack_id = c.pack_id
				WHERE c.pack_id = ? AND p.deleted_at IS NULL ORDER BY c.part`,
		},
	},
}
