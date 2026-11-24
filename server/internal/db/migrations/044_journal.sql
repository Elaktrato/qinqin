-- The journal becomes a core feature (#199, record 0006): its documents move
-- from plugin_data rows of qinqin-journal (entry:<id>, review:<id>,
-- suggestions, settings) into typed tables, one per document kind, each
-- scoped to one workspace of one user. Shapes: docs/contracts/journal/.
-- Nothing of the journal is in the paged pull; clients read it through
-- /api/journal/*. JSON columns hold the nested parts of a document (the
-- annotations, the overall review, the drop counts, the suggestion items)
-- and are checked for validity and type.
--
-- Rows that map one to one are copied (entries with an id and a text, their
-- reviews, the settings and the topic ideas); anything else of
-- qinqin-journal is dropped (the owner allows a clean start, NEXT.md).

CREATE TABLE journal_entries (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
    date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('typed', 'photo')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, id)
);

CREATE TABLE journal_reviews (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    entry_id TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    annotations TEXT NOT NULL CHECK (json_valid(annotations) AND json_type(annotations) = 'array'),
    overall TEXT NOT NULL CHECK (json_valid(overall) AND json_type(overall) = 'object'),
    model TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    fallback_from TEXT NOT NULL DEFAULT '',
    dropped TEXT NOT NULL CHECK (json_valid(dropped) AND json_type(dropped) = 'object'),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, entry_id)
);

CREATE TABLE journal_suggestions (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    items TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'),
    model TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE journal_settings (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    guidance TEXT NOT NULL,
    explanation_language TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
);

INSERT OR IGNORE INTO journal_entries (user_id, workspace_id, id, date, title, text, source, created_at, updated_at)
SELECT user_id, workspace_id, json_extract(data, '$.id'), json_extract(data, '$.date'),
    CASE WHEN json_type(data, '$.title') = 'text' THEN json_extract(data, '$.title') ELSE '' END,
    json_extract(data, '$.text'),
    CASE WHEN json_extract(data, '$.source') = 'photo' THEN 'photo' ELSE 'typed' END,
    CASE WHEN json_type(data, '$.createdAt') = 'text' THEN json_extract(data, '$.createdAt') ELSE updated_at END,
    updated_at
FROM plugin_data
WHERE pack_id = 'qinqin-journal' AND deleted_at IS NULL AND workspace_id IS NOT NULL
    AND json_valid(data) AND json_type(data) = 'object'
    AND json_type(data, '$.id') = 'text' AND json_type(data, '$.text') = 'text'
    AND length(json_extract(data, '$.id')) BETWEEN 1 AND 64
    AND key = 'entry:' || json_extract(data, '$.id')
    AND json_type(data, '$.date') = 'text'
    AND json_extract(data, '$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';

INSERT OR IGNORE INTO journal_reviews (user_id, workspace_id, entry_id, text_hash, annotations, overall, model, provider, fallback_from, dropped, created_at)
SELECT p.user_id, p.workspace_id, substr(p.key, 8),
    CASE WHEN json_type(p.data, '$.textHash') = 'text' THEN json_extract(p.data, '$.textHash') ELSE '' END,
    json_extract(p.data, '$.annotations'),
    json_extract(p.data, '$.overall'),
    CASE WHEN json_type(p.data, '$.model') = 'text' THEN json_extract(p.data, '$.model') ELSE '' END,
    CASE WHEN json_type(p.data, '$.provider') = 'text' THEN json_extract(p.data, '$.provider') ELSE '' END,
    CASE WHEN json_type(p.data, '$.fallbackFrom') = 'text' THEN json_extract(p.data, '$.fallbackFrom') ELSE '' END,
    CASE WHEN json_type(p.data, '$.dropped') = 'object' THEN json_extract(p.data, '$.dropped') ELSE '{}' END,
    CASE WHEN json_type(p.data, '$.createdAt') = 'text' THEN json_extract(p.data, '$.createdAt') ELSE p.updated_at END
FROM plugin_data p
WHERE p.pack_id = 'qinqin-journal' AND p.deleted_at IS NULL AND p.workspace_id IS NOT NULL
    AND substr(p.key, 1, 7) = 'review:'
    AND json_valid(p.data) AND json_type(p.data) = 'object'
    AND json_type(p.data, '$.annotations') = 'array' AND json_type(p.data, '$.overall') = 'object'
    AND EXISTS (SELECT 1 FROM journal_entries e
        WHERE e.user_id = p.user_id AND e.workspace_id = p.workspace_id AND e.id = substr(p.key, 8));

INSERT OR IGNORE INTO journal_suggestions (user_id, workspace_id, items, model, provider, created_at)
SELECT user_id, workspace_id, json_extract(data, '$.items'),
    CASE WHEN json_type(data, '$.model') = 'text' THEN json_extract(data, '$.model') ELSE '' END,
    CASE WHEN json_type(data, '$.provider') = 'text' THEN json_extract(data, '$.provider') ELSE '' END,
    CASE WHEN json_type(data, '$.createdAt') = 'text' THEN json_extract(data, '$.createdAt') ELSE updated_at END
FROM plugin_data
WHERE pack_id = 'qinqin-journal' AND deleted_at IS NULL AND workspace_id IS NOT NULL AND key = 'suggestions'
    AND json_valid(data) AND json_type(data) = 'object' AND json_type(data, '$.items') = 'array';

-- Settings are read leniently (an unknown language reads as "en", the
-- guidance is cut when read), so every readable row is copied as it is.
INSERT OR IGNORE INTO journal_settings (user_id, workspace_id, guidance, explanation_language, updated_at)
SELECT user_id, workspace_id,
    CASE WHEN json_type(data, '$.guidance') = 'text' THEN json_extract(data, '$.guidance') ELSE '' END,
    CASE WHEN json_type(data, '$.explanationLanguage') = 'text' THEN json_extract(data, '$.explanationLanguage') ELSE 'en' END,
    updated_at
FROM plugin_data
WHERE pack_id = 'qinqin-journal' AND deleted_at IS NULL AND workspace_id IS NOT NULL AND key = 'settings'
    AND json_valid(data) AND json_type(data) = 'object';

DELETE FROM plugin_data WHERE pack_id = 'qinqin-journal';
