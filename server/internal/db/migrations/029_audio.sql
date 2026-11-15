-- Audio packs: pronunciation clips imported from an audio pack's
-- index.tsv (qinqin seed). The clip files themselves live outside the
-- database, content-addressed under <data>/audio/<sha[:2]>/<sha>.<ext>;
-- a row names its blob by hash and extension. A pack's rows are replaced
-- on every import.

CREATE TABLE audio_packs (
    id INTEGER PRIMARY KEY,
    pack_id TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE audio_clips (
    id INTEGER PRIMARY KEY,
    pack_id INTEGER NOT NULL REFERENCES audio_packs(id),
    kind TEXT NOT NULL CHECK (kind IN ('term', 'syllable')),
    form TEXT NOT NULL,
    reading_key TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    ext TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT ''
);

CREATE INDEX audio_clips_lookup ON audio_clips (kind, form, reading_key);
CREATE INDEX audio_clips_sha ON audio_clips (sha256);
CREATE INDEX audio_clips_pack ON audio_clips (pack_id, id);
