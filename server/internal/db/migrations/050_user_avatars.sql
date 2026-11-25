-- Profile pictures (#189, docs/contracts/auth/avatar.json). One row per user
-- who has a picture: the content hash names the two files
-- <data>/avatars/<user_id>/<hash>-256.jpg and -64.jpg (internal/avatar), so a
-- new picture has a new URL. Removed with the account and replaced by a
-- restore (the deletion registry, internal/auth/delete.go).

CREATE TABLE user_avatars (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    hash TEXT NOT NULL CHECK (length(hash) = 32),
    updated_at TEXT NOT NULL
);
