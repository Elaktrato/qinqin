-- AI keys (encrypted with QINQIN_SECRET), the AI call log the rate limit
-- counts, and temporary journal photos (deleted on save or discard, swept
-- by the janitor). Additive: three new tables, nothing existing changes.

-- One key per user. ciphertext and nonce are AES-256-GCM; secret_fp tells a
-- changed QINQIN_SECRET apart from corruption; hint is the last 4 characters.
CREATE TABLE ai_keys (
    user_id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    nonce BLOB NOT NULL,
    secret_fp TEXT NOT NULL,
    hint TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);

-- Every provider call, for the rolling-hour limit and the usage shown in
-- Settings. Rows older than 7 days are pruned.
CREATE TABLE ai_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    ok INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL
);
CREATE INDEX ai_calls_user_at ON ai_calls (user_id, at);

-- Photos pending transcription; the file lives at
-- <data>/journal/<userId>/<photoId>.jpg.
CREATE TABLE journal_photos (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    workspace_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
CREATE INDEX journal_photos_user ON journal_photos (user_id);
CREATE INDEX journal_photos_seen ON journal_photos (last_seen_at);
