-- AI providers: one key per (user, provider), the user's active provider,
-- admin-registered OpenAI-compatible endpoints, and the provider of each call.
--
-- ai_keys is rebuilt because its primary key changes from user_id to
-- (user_id, provider). Every column is copied verbatim, so existing
-- ciphertexts stay valid: the AES-GCM additional data is
-- "qinqin/ai_keys/v1|user=<id>|provider=<provider>" and neither the user nor
-- the provider of an existing row changes.
CREATE TABLE ai_keys_new (
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    nonce BLOB NOT NULL,
    secret_fp TEXT NOT NULL,
    hint TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    PRIMARY KEY (user_id, provider)
);
INSERT INTO ai_keys_new (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at, last_used_at)
    SELECT user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at, last_used_at FROM ai_keys;
DROP TABLE ai_keys;
ALTER TABLE ai_keys_new RENAME TO ai_keys;

-- The provider each user sends text to. Existing keys become the selection,
-- so nothing changes for people who already use AI.
CREATE TABLE ai_selection (
    user_id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO ai_selection (user_id, provider, updated_at) SELECT user_id, provider, created_at FROM ai_keys;

-- OpenAI-compatible endpoints an admin registered. id is "custom-" plus 10
-- random base32 characters and is never reused.
CREATE TABLE ai_custom_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    default_model TEXT NOT NULL,
    vision INTEGER NOT NULL,
    structured TEXT NOT NULL,
    max_output_tokens INTEGER,
    key_required INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

ALTER TABLE ai_calls ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';
