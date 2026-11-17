-- Theme packs (#96): packs of type theme (format themes-json). theme_packs is
-- the registry row of a pack, like stroke_packs; themes holds one validated
-- theme per row (data = its canonical JSON, ord = its position in the pack's
-- themes.json). A theme id is unique across every installed pack; the
-- built-in themes live in the binary, never in these tables.
CREATE TABLE theme_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE themes (
    theme_id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE INDEX idx_themes_pack ON themes (pack_id, ord);
