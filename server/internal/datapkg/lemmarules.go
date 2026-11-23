package datapkg

// lemmaRulesDef is a lemma-rules pack (arg: its pack id): its language and
// its rules.json exactly as imported (docs/contracts/lemma/).
var lemmaRulesDef = typeDef{
	tables: []tableDef{{
		Name:  "lemma_rules",
		SQL:   "CREATE TABLE lemma_rules (language TEXT PRIMARY KEY, rules_json TEXT NOT NULL)",
		Order: []string{"language"},
		cols:  []string{"language", "rules_json"},
		query: `SELECT language, rules_json FROM lemma_rule_packs WHERE pack_id = ? AND deleted_at IS NULL`,
	}},
}
