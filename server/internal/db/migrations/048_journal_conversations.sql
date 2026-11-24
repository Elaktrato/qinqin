-- The conversation partner of the journal (#185): a conversation and its
-- messages, scoped to one workspace of one user like the other journal
-- documents (docs/contracts/journal/README.md#conversations). A turn appends
-- rows; saving a conversation as an entry or discarding it deletes both.
-- `annotations` holds the corrections of a learner message (the review's
-- annotation shape); a partner message has none. Not in the paged pull.

CREATE TABLE journal_conversations (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
    topic TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('beginner', 'elementary', 'intermediate', 'advanced')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, id)
);

CREATE TABLE journal_messages (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    conversation_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    role TEXT NOT NULL CHECK (role IN ('learner', 'partner')),
    text TEXT NOT NULL,
    annotations TEXT NOT NULL CHECK (json_valid(annotations) AND json_type(annotations) = 'array'),
    model TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, conversation_id, seq)
);
