-- Accounts, part 1 (#64): users gain the account columns, sessions hold only
-- a hash of the bearer token, plus the instance auth settings and the audit
-- log. Rebuilds follow 022 (create, copy, drop, rename; ids copied verbatim;
-- the runner applies migrations with foreign_keys OFF, so the drops do not
-- cascade into the children). The Go step of this version (gosteps.go)
-- replaces every copied token_hash with hex(sha256(token)) in this
-- transaction, so existing logins survive the upgrade.

-- AUTOINCREMENT: a deleted user's id (audit links, data directories) is
-- never handed to a new account.
CREATE TABLE users_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    hash TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    email TEXT,
    email_norm TEXT,
    email_verified_at TEXT,
    disabled_at TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    -- Session-id watermark: sessions with an id above it were created after the
    -- forced change was set (the temporary-password login). Ids only grow, so no
    -- clock precision or step-back can confuse it. NULL: unknown, ask for the password.
    must_change_after INTEGER,
    created_at TEXT NOT NULL DEFAULT '',
    password_changed_at TEXT,
    -- NFKC + case fold of username; unique. NULL only for a legacy name that
    -- collided (the Go step of this migration fills it in).
    username_key TEXT
);

INSERT INTO users_new (id, username, hash, admin, updated_at, created_at)
SELECT id, username, hash, admin, updated_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX idx_users_username_key ON users (username_key) WHERE username_key IS NOT NULL;
CREATE UNIQUE INDEX idx_users_email_norm ON users (email_norm) WHERE email_norm IS NOT NULL;

CREATE TABLE sessions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    level TEXT NOT NULL DEFAULT 'full' CHECK (level IN ('full','enroll')),
    device TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);

-- token_hash holds the plaintext token until the Go step hashes it. The
-- upgrade moment counts as the last use, so a session idle before the upgrade
-- is not cut off 90 days after it (the old table had no use column).
INSERT INTO sessions_new (token_hash, user_id, created_at, last_used_at, device)
SELECT token, user_id, updated_at,
       CASE WHEN updated_at > strftime('%Y-%m-%dT%H:%M:%SZ','now') THEN updated_at
            ELSE strftime('%Y-%m-%dT%H:%M:%SZ','now') END, ''
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE auth_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    registration TEXT NOT NULL DEFAULT 'closed' CHECK (registration IN ('closed','invite','open')),
    email_policy TEXT NOT NULL DEFAULT 'off' CHECK (email_policy IN ('off','optional','required')),
    mfa_enforced INTEGER NOT NULL DEFAULT 0,
    email_code_login INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by INTEGER
);
INSERT INTO auth_settings (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));

CREATE TABLE auth_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_id INTEGER,
    actor_name TEXT NOT NULL DEFAULT '',
    target_id INTEGER,
    target_name TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_auth_audit_at ON auth_audit (at);
