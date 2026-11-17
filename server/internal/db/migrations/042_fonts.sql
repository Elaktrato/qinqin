-- Font packs (#97): packs of type font (format font-slices). font_packs is
-- the registry row of a pack, like theme_packs; font_slices holds one row
-- per WOFF2 slice of a face (ord = its position in the face's slices in
-- faces.json). The slice files live at <data>/fonts/<sha[:2]>/<sha>.woff2,
-- named by their sha256; a file no row references is removed.
CREATE TABLE font_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE font_slices (
    pack_id TEXT NOT NULL,
    face TEXT NOT NULL,
    script TEXT NOT NULL,
    weight TEXT NOT NULL,
    style TEXT NOT NULL,
    original TEXT NOT NULL,
    sha TEXT NOT NULL,
    unicode_range TEXT NOT NULL,
    ord INTEGER NOT NULL,
    PRIMARY KEY (pack_id, face, script, weight, style, ord)
);

CREATE INDEX idx_font_slices_sha ON font_slices (sha);
