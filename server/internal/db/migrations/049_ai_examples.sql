-- AI example sentences on demand (#186, docs/contracts/examples/). A kept
-- example is a user-owned row of `sentences` (no source pack, never touched
-- by pack imports) marked with the provider and model that wrote it and the
-- level it was written for; every other sentence leaves the three columns
-- empty. The undecided output of the last generation for an entry waits in
-- `example_drafts`; `request_id` is the client's id of the generation, so a
-- retry answers the stored drafts instead of a second AI call. A draft or a
-- kept example deleted with a reason leaves a row in `example_reports`
-- (the user's own feedback on the AI; at most 500 per user). Drafts and
-- reports are per user and entry, not in the paged pull and not in a backup.

ALTER TABLE sentences ADD COLUMN ai_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE sentences ADD COLUMN ai_model TEXT NOT NULL DEFAULT '';
ALTER TABLE sentences ADD COLUMN ai_level TEXT NOT NULL DEFAULT '';

CREATE TABLE example_drafts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    hanzi TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    translation TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('beginner', 'elementary', 'intermediate', 'advanced')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_example_drafts_user_entry ON example_drafts (user_id, entry_id);

CREATE TABLE example_reports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    language TEXT NOT NULL,
    hanzi TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    translation TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('missing_word', 'wrong_translation', 'wrong_reading', 'unnatural', 'too_hard', 'inappropriate', 'other')),
    level TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_example_reports_user ON example_reports (user_id, id);
