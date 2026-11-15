-- Accounts, part 3 (#64): SMTP settings, two-factor data and one-time-code
-- challenges. Secrets (the SMTP password, TOTP secrets) are sealed with the
-- QINQIN_SECRET mechanism of the AI keys: ciphertext, nonce and the
-- fingerprint of the secret that sealed them; never stored in clear.

CREATE TABLE smtp_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    tls_mode TEXT NOT NULL CHECK (tls_mode IN ('starttls','tls','none')),
    username TEXT NOT NULL DEFAULT '',
    password_ct BLOB,
    password_nonce BLOB,
    secret_fp TEXT,
    from_address TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT '',
    public_url TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by INTEGER
);

-- One row per user. The confirmed secret and a pending (not yet confirmed)
-- one are separate: starting a new setup never touches a working secret.
-- last_step is the highest TOTP time step already accepted (replay guard).
CREATE TABLE mfa_totp (
    user_id INTEGER PRIMARY KEY,
    secret_ct BLOB,
    secret_nonce BLOB,
    secret_fp TEXT,
    confirmed_at TEXT,
    last_step INTEGER NOT NULL DEFAULT 0,
    pending_ct BLOB,
    pending_nonce BLOB,
    pending_fp TEXT,
    pending_at TEXT,
    created_at TEXT NOT NULL
);

-- SHA-256 of the normalised code; a used code keeps its row (used_at).
CREATE TABLE mfa_recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    used_at TEXT
);
CREATE INDEX idx_mfa_recovery_user ON mfa_recovery_codes (user_id);

-- Short-lived challenges: a login second step (mfa), an emailed sign-in code
-- (email_login; user_id NULL for an unknown identifier so the answer looks the
-- same) and an email verification (email_verify). token_hash is SHA-256 of
-- the challenge token; code_hash is SHA-256(id || ':' || code).
CREATE TABLE auth_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('mfa','email_login','email_verify')),
    user_id INTEGER,
    email_norm TEXT NOT NULL DEFAULT '',
    code_hash TEXT NOT NULL DEFAULT '',
    sends INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_auth_challenges_user ON auth_challenges (user_id);
CREATE INDEX idx_auth_challenges_expires ON auth_challenges (expires_at);

ALTER TABLE users ADD COLUMN mfa_email INTEGER NOT NULL DEFAULT 0;
