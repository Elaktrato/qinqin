-- Picture reports (#274): a learner reports a wrong picture of an entry
-- (packs of type images, #216). Per user, like example_reports (#186): at
-- most 500 per user (the oldest goes, internal/images), removed with the
-- account, not in a backup. A reported picture of an entry is not answered
-- to its reporter again. pack_id and concept name the picture, not a row:
-- a report outlives a pack reinstall.
CREATE TABLE picture_reports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    language TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    concept TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('wrong', 'unclear', 'offensive', 'other')),
    created_at TEXT NOT NULL
);

CREATE INDEX idx_picture_reports_user ON picture_reports (user_id, entry_id);
