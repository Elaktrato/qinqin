# #294 — switching off Scripts answers 500 (2026-11-27)

Milestone v0.9.0, phase 1 (foundations and bugs). Branch `feature/v090-294-feature-check`.

## What

`feature_switches` (migration 047) carries `CHECK (feature IN ('flashcards', 'reader', 'journal', 'grammar'))`.
v0.8.0 added `scripts` to `features.IDs` without widening it, so `PUT /api/features/scripts {"enabled":false}`
inserts a row SQLite rejects and the handler answers 500. Switching on never inserted a row before the first
switch-off, so only switching off failed.

Fix the root cause: migration 055 rebuilds `feature_switches` without the list of feature ids in the CHECK. The
list lives in one place, `features.IDs` in Go, and every writer already checks it (`features.Set` → `ErrUnknown`
→ 404; the backup restore skips unknown ids). The next feature then needs no migration.

## Tasks

1. This plan.
2. Tests first: an API test that switches every id of `features.IDs` off and on again (each 200, the list shows
   the state); a migration test on a populated database (rows of several users and every feature survive 055, the
   index is back, `enabled` is still checked, an id the database never knew is accepted at the database level).
   See both fail.
3. Migration `055_feature_switches_check.sql`: create the new table, copy every row, drop the old one, rename,
   recreate `idx_feature_switches_updated`. Docs: the wiki (Development: a feature no longer needs a migration),
   record 0006's table, `docs/releases/NEXT.md`.

## Rulings

- Ruling: drop the feature-id list from the CHECK instead of rebuilding it with `scripts` added — the Go list
  `features.IDs` is the only list a writer consults (`features.Set`, backup restore), so the database and the
  code cannot drift again, and the next feature needs no migration — cost if wrong: a future writer that skips
  `features.IDs` could store a row for an unknown id; `GET /api/features`
  never answers it (`List` only answers ids in `features.IDs`), the paged pull would carry it, and a later migration can add a CHECK back.
- Ruling: keep `CHECK (enabled IN (0, 1))`, the primary key and the `users(id)` reference as they were — only
  the feature list caused the bug — cost if wrong: none.
- Ruling: copy the rows with their `rowid` — the paged pull's keyset is `(updated_at, rowid)`
  (`internal/sync/page.go`), so keeping the rowids keeps a client's cursor in the middle of a pull valid — cost if
  wrong: a client re-pulls or skips at most a few switches once.
- Ruling: copy every row as it is (no filter) — every row already passed the old CHECK, so all are valid
  features — cost if wrong: none.
- Ruling: number 055, the next after 054 on the base — the orchestrator renumbers if a parallel branch took it.
- Ruling: no contract change and no ContractVersion bump — the routes, payloads and the fixture
  (`docs/contracts/features/switches.json`) stay as they are; the fix makes the server honour them.

## Execution record

- Tasks 2 and 3 are one commit (the suites stay green at each commit). Test-first: the new tests
  (`TestEveryFeatureSwitchesOffAndOn` in `internal/api`, `TestMigration055FeatureSwitchesCheck` and
  `TestMigration055EmptyDatabase` in `internal/db`) were written and run before the migration existed and failed for
  the reason of the bug: `PUT /api/features/scripts {"enabled":false}` answered 500, and SQLite refused `scripts`
  with `CHECK constraint failed: feature IN ('flashcards', 'reader', 'journal', 'grammar')`. With
  `055_feature_switches_check.sql` they pass.
- The migration test also guards itself: it asserts `scripts` is refused before 055, so it cannot pass vacuously.
- Docs: wiki Development (a feature no longer needs a migration), record 0006's table, `docs/releases/NEXT.md`
  (Upgrading and Fixed).
- Gates: see the commit of this record (targeted packages, then one full `./...`).
