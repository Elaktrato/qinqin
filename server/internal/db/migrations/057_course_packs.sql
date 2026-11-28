-- Course packs (#221): packs of type course (format course-json). course_packs is the registry row of a pack, like
-- lemma_rule_packs, and holds the course's skeleton: course_json is the pack's course.json exactly as imported
-- (validated by internal/courses), content_hash its sha256. The words of a course are not stored: the server fills
-- them from the installed level packs and keeps the result in memory (internal/courses, docs/contracts/courses/).
-- A server table, not a workspace table: a learner's progress is `course` events in the event log.
CREATE TABLE course_packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    language TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT '',
    course_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
