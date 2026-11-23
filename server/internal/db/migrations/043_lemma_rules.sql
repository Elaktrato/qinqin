-- Lemmatizer rule-table packs (#176): packs of type lemma-rules (format
-- rules-json). lemma_rule_packs is the registry row of a pack, like
-- theme_packs, and holds its rule table: rules_json is the pack's rules.json
-- exactly as imported (validated by internal/lemma), content_hash its sha256.
-- At most one live pack per language (enforced by the importer, so an
-- uninstalled row keeps its language).
CREATE TABLE lemma_rule_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    language TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    rules_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX idx_lemma_rule_packs_language ON lemma_rule_packs (language, deleted_at);
