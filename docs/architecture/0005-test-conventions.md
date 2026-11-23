# 0005. Test conventions

## Status

Accepted, being implemented by #197

Touched by: #197. A merge from one of these issues that changes what this record names updates the record.

## Context

#197 found three kinds of drift in the test code:

- **Go databases.** Every Go test database runs all migrations from scratch. There are `openDB` /
  `openTestDB` / `newTestDB` copies in at least nine packages, and 66 test files call
  `db.Open(filepath.Join(t.TempDir()…))` themselves.
- **Web builders.** About 30 web test files define their own `card()`, `review()` and `history()` builders;
  `lib/testing/reviews.ts` is used by three, and `lib/study/testing/` sits apart from `lib/testing/`.
- **Wall-clock checks.** Timing-sensitive tests fail on a loaded machine: the weekly and milestones perf tests,
  the reader readings test, the study-day perf test, the PWA icons test and the schedule timeline test.

## Decision

- **Go test databases** come from one package, `internal/dbtest`: `Open(t)` copies a template database that
  is migrated once per test process. Shared fixtures live there too: a user, a workspace, a tiny dictionary
  pack.
- **Web study builders** live in one module, `lib/testing/study.ts` (cards, reviews, histories). The legacy
  codec moves under `lib/testing`, so study test support no longer sits apart in `lib/study/testing/`.
- **No wall-clock assertions in unit tests.** A performance test keeps its operation-count assertions and drops
  its time limit, or moves to a separate perf project that CI runs serially.
- #197 measures the suite times before and after and records them in the issue.

## Consequences

- A new Go test gets a migrated database in the time of a file copy, and a new migration is run once per test
  process, not once per test.
- A change to a study row shape changes one builder module, not thirty files.
- A loaded CI machine no longer fails a unit test on time; a real slowdown shows as more operations, or in the
  perf project.

## Allowed / Not allowed

Allowed:

- `dbtest.Open(t)` and its fixtures in any Go test.
- Builders from `lib/testing/study.ts`, extended there when a test needs a new variant.
- Counting operations (calls, rows, comparisons) in a performance test.

Not allowed:

- A new `openDB` / `openTestDB` / `newTestDB` copy, or a new test opening and migrating its own database file.
- A new local `card()` / `review()` / `history()` builder in a web test file.
- A time limit (`performance.now()`, `Date.now()` differences, elapsed milliseconds) asserted in a unit test.

## Enforcement

#197 plans no automated check; it records the conventions here. Until a check exists: review.

## Open questions

- Whether the timing tests keep only operation counts or move to a separate serial perf project. #197 leaves
  both open.
- Whether the web builders are migrated in one pass or as files are touched. #197 leaves both open.
- Which tests keep opening and migrating their own database (the migration tests of `internal/db` have to).
  Decided in #197.
- Whether a lint or test should guard the conventions (a local builder, a wall-clock assertion, a Go test that
  migrates its own database). Not decided in #197.
- Whether the legacy codec (`lib/study/testing/legacyCodec.ts`) still has users after the v0.3 compatibility
  layer is removed (#198), or goes instead of moving.
