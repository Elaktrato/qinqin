-- Accounts, part 2 (#64): invite links and admin-issued password reset links.
-- Both keep only the SHA-256 of the token; the token itself is shown once.
-- (Numbered 033 as planned; 034 is reserved for plan 3's MFA tables, the
-- runner applies any missing version by name.)
CREATE TABLE invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',
    max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id);
