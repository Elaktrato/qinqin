-- Grammar packs: lessons by level with examples, imported from a
-- grammar pack's lessons.json (qinqin seed). A pack row carries the
-- manifest terms the Sources page shows plus its ordered levels as JSON;
-- a lesson row keeps its full content as JSON and the few columns the
-- browse list needs. Packs and lessons are soft-deleted: a re-import
-- tombstones what the pack dropped and revives what returns. Practice
-- progress is not stored here (workspace plugin data).

CREATE TABLE grammar_packs (
    id INTEGER PRIMARY KEY,
    pack_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    language TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    levels_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE grammar_lessons (
    id INTEGER PRIMARY KEY,
    pack_id INTEGER NOT NULL REFERENCES grammar_packs(id),
    lesson_id TEXT NOT NULL,
    level_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    content_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (pack_id, lesson_id)
);

CREATE INDEX grammar_lessons_pack ON grammar_lessons (pack_id, ord);
