-- Personal access tokens (v0.3.0 stretch, #83). Only hex(sha256(token))
-- is stored; the token itself is shown once, on create. hint is the 6 hex
-- characters after the "qq_pat_" prefix (24 of 256 bits) for the list.
-- workspace_id NULL: every workspace of the owner. No admin scope exists.
-- (036 is held by the radicals work; the runner applies any missing version
-- by name, so the gap is harmless.)
CREATE TABLE access_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
    workspace_id INTEGER REFERENCES workspaces(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT
);
CREATE INDEX idx_access_tokens_user ON access_tokens (user_id);
CREATE INDEX idx_access_tokens_workspace ON access_tokens (workspace_id);
