-- Grammar becomes a core feature (#199, record 0006): lesson progress moves
-- from plugin_data rows of qinqin-grammar (lesson:<packId>:<lessonId>) into a
-- typed table, one row per lesson of a workspace. The lessons themselves stay
-- in the grammar packs (grammar_packs, grammar_lessons). Shapes:
-- docs/contracts/grammar/. Not in the paged pull; clients read and write it
-- through /api/grammar/progress.
--
-- Rows the progress rules accept are copied (a missing or unreadable
-- completedAt becomes the row's write time); anything else of qinqin-grammar
-- is dropped (the owner allows a clean start, NEXT.md), so a personal backup
-- of the result restores without loss.

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

-- The copy is the Go step of this migration (step045.go): it applies the
-- progress rules as of #199 (pack and lesson ids, whole numbers, RFC 3339
-- stamps), which SQL cannot.
