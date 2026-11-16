-- Character components packs (v0.3.0 stretch, #71): which parts each
-- character contains, for the radical and part lookup. Shared lookup data
-- keyed by glyph, not per-user data. content_hash fingerprints a pack's
-- rows so the lookup's validator changes on every re-import that changes
-- them.
CREATE TABLE component_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    language TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX idx_component_packs_language ON component_packs (language);

CREATE TABLE components (
    pack_id TEXT NOT NULL,
    char TEXT NOT NULL,
    parts TEXT NOT NULL, -- JSON array of part strings, in pack order
    PRIMARY KEY (pack_id, char)
);

CREATE TABLE component_parts (
    pack_id TEXT NOT NULL,
    part TEXT NOT NULL,
    strokes INTEGER NOT NULL,
    PRIMARY KEY (pack_id, part)
);
