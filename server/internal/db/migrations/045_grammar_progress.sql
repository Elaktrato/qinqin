-- Grammar becomes a core feature (#199, record 0006): lesson progress moves
-- from plugin_data rows of qinqin-grammar (lesson:<packId>:<lessonId>) into a
-- typed table, one row per lesson of a workspace. The lessons themselves stay
-- in the grammar packs (grammar_packs, grammar_lessons). Shapes:
-- docs/contracts/grammar/. Not in the paged pull; clients read and write it
-- through /api/grammar/progress.
--
-- Rows whose key and JSON decode are copied; anything else of qinqin-grammar
-- is dropped (the owner allows a clean start, NEXT.md).

CREATE TABLE grammar_progress (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    pack_id TEXT NOT NULL CHECK (length(pack_id) BETWEEN 1 AND 128),
    lesson_id TEXT NOT NULL CHECK (length(lesson_id) BETWEEN 1 AND 128),
    completed_at TEXT NOT NULL,
    best INTEGER NOT NULL CHECK (best >= 0 AND best <= total),
    total INTEGER NOT NULL CHECK (total BETWEEN 0 AND 1000),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, pack_id, lesson_id)
);

INSERT OR IGNORE INTO grammar_progress (user_id, workspace_id, pack_id, lesson_id, completed_at, best, total, updated_at)
SELECT user_id, workspace_id,
    substr(rest, 1, instr(rest, ':') - 1), substr(rest, instr(rest, ':') + 1),
    json_extract(data, '$.completedAt'), json_extract(data, '$.best'), json_extract(data, '$.total'), updated_at
FROM (SELECT *, substr(key, 8) AS rest FROM plugin_data
    WHERE pack_id = 'qinqin-grammar' AND deleted_at IS NULL AND workspace_id IS NOT NULL AND substr(key, 1, 7) = 'lesson:')
WHERE instr(rest, ':') > 1 AND instr(rest, ':') < length(rest)
    AND json_valid(data) AND json_type(data) = 'object'
    AND json_type(data, '$.completedAt') = 'text'
    AND json_type(data, '$.best') = 'integer' AND json_type(data, '$.total') = 'integer'
    AND json_extract(data, '$.best') BETWEEN 0 AND json_extract(data, '$.total')
    AND json_extract(data, '$.total') <= 1000;

DELETE FROM plugin_data WHERE pack_id = 'qinqin-grammar';
