-- The code plugins are retired (#199, record 0006): flashcards, the reader,
-- the journal and grammar are core features, each with a per-user switch.
-- feature_switches replaces plugin_states (no order: the navigation has its
-- own layout row); no row is "on". The switches of the four features are
-- copied; the plugin registry (manifests of the built-in and admin-registered
-- plugins) and every other plugin state are dropped (NEXT.md).

CREATE TABLE feature_switches (
    user_id INTEGER NOT NULL REFERENCES users(id),
    feature TEXT NOT NULL CHECK (feature IN ('flashcards', 'reader', 'journal', 'grammar')),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, feature)
);
CREATE INDEX idx_feature_switches_updated ON feature_switches (user_id, updated_at);

INSERT INTO feature_switches (user_id, feature, enabled, updated_at)
SELECT user_id, substr(pack_id, 8), enabled, updated_at FROM plugin_states
WHERE pack_id IN ('qinqin-flashcards', 'qinqin-reader', 'qinqin-journal', 'qinqin-grammar');

DROP TABLE plugin_states;
DROP TABLE plugin_registry;

-- A deck copied from a plugin's deck becomes a plain deck: the source variant
-- {type:"plugin"} went with the plugins (docs/contracts/study/).
UPDATE study_decks SET source = NULL WHERE json_extract(source, '$.type') = 'plugin';
