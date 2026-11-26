-- Images packs (#216): packs of type images (format images-svg) give a word a
-- picture. image_packs is the registry row of a pack, like stroke_packs
-- (languages is a JSON array: the languages the pack maps). image_pictures
-- holds one SVG per concept of a pack, exactly the bytes of the pack file
-- (concept is the picture's id in the pack, label its English name, credit
-- its author line). image_map is the word -> picture mapping: target is a
-- dictionary entry's key or one of its written forms, sense the 1-based
-- number of the sense the picture shows (0: the whole entry), score 0-100
-- how sure the mapping is, basis how it was found. The picture shown for an
-- entry is the best-scoring mapped one (internal/images). A pack's rows are
-- replaced on a changed import; an uninstall keeps nothing but the registry
-- row. The files are never embedded in the binary: they come from the pack.
CREATE TABLE image_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    languages TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE image_pictures (
    pack_id TEXT NOT NULL,
    concept TEXT NOT NULL,
    label TEXT NOT NULL,
    credit TEXT NOT NULL,
    svg TEXT NOT NULL,
    PRIMARY KEY (pack_id, concept)
);

CREATE TABLE image_map (
    pack_id TEXT NOT NULL,
    language TEXT NOT NULL,
    target TEXT NOT NULL,
    sense INTEGER NOT NULL,
    concept TEXT NOT NULL,
    score INTEGER NOT NULL,
    basis TEXT NOT NULL,
    PRIMARY KEY (pack_id, language, target, sense, concept)
);

CREATE INDEX idx_image_map_lookup ON image_map (language, target);
