# Backend hardening: API and data (issues #1, #3, #9, #10, #11, #51, #52)

Branch `feature/backend-hardening-api` from develop 3245730. One task and one
commit per issue, test first. Every bullet below was re-checked against the
current code; struck/obsolete items from the issue notes stay out.

## Task 1 - #1 auth (`auth/auth.go`, `api/handlers_auth.go`, tests)
- Bootstrap race: new `auth.CreateFirstUser` does one
  `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM users)`; the handler
  tries it when the count read says zero and falls back to the admin-required
  path when it lost the race (`ErrNotFirst`).
  Ruling: single atomic statement — no transaction needed, SQLite serialises writers — a lost race becomes 403 instead of a second admin.
- Login timing: unknown username verifies against a package-level dummy
  argon2 hash. Ruling: do it — cost is one hash per failed login, same as a
  wrong password — none. A test pins that the unknown-user path runs Verify (via a timing-free seam: `dummyHash` is a valid PHC hash).
- FK pragma: `PRAGMA foreign_keys` is OFF by design (migrations rebuild
  referenced tables; `db.go`, `migrate_018_test.go` pin it). Ruling: keep OFF,
  document in `db.go`/issue; no user deletion exists; orphan sessions are
  harmless (the session JOIN finds no user) — enabling it would need every
  migration rewritten; cost if wrong: dangling session rows only.
- Tests: `TestRegisterDuplicateUsername` (409), concurrent first-register race
  (exactly one 201 admin), assert 201 on the admin register in the one setup
  that discards it.

## Task 2 - #3 entries/links/overlay (`lexicon/lexicon.go`, `api/handlers_entries.go`, `api/handlers_workspaces.go`, `overlay`)
- `LinkTx`: reject self-links (any type) and links whose ids do not both
  exist; `Link` inherits. (`LinkWordChar`/`SetRadical` no longer exist; `Link`/`LinkTx` is the one writer.)
- Language codes: `lexicon.put` lowercases `e.Language` (lowercase only, no
  trim; existing rows untouched). Language-management validation stays in its
  handlers; not touched here.
- `PUT /api/entries/{id}`: Ruling: 404 (entry existence) before 400 (body) —
  an unknown resource is the first fact a caller needs, and it avoids probing
  validation via missing ids — cost if wrong: clients see 404 not 400 for a bad body on a missing id.
- All-nil overlay PUT: Ruling: keep the row — sync pull ships `user_edits`
  rows, so the all-nil row with a fresh `updated_at` is the LWW revert marker
  that tells other devices to drop the patch; deleting would lose that — cost
  if wrong: one inert row per reverted entry. Pinned by a test, documented in `overlay.Put`.
- Workspace settings `PUT`: document and test RFC 7396 (null deletes a key).
- `updated_at` second truncation: tracked in #11 (documented, not changed).

## Task 3 - #9 events (`api/handlers_events.go`, tests)
- Missing/zero `workspaceId` -> 400 `workspaceId is required` (ids are >= 1).
- Test: duplicate ids inside one batch count once (accepted 1, duplicates 1).

## Task 4 - #10 plugin data (`plugins/plugins.go`, `api/handlers_plugins.go`)
- PUT state response returns the stored row (`SetState` returns the
  `PluginState` via `RETURNING updated_at`), second-truncated like storage.
- PUT data returns the row written by the same statement (`RETURNING`), no
  write-then-read; new `PutDataRow`, `PutData*` wrap it.
- IFNULL sentinel: named constant + `PutDataAt` rejects workspace id <= 0.
- `dataPlugin` returns an error instead of panicking; callers propagate.

## Task 5 - #11 sync (`sync/`)
- Add the explicit same-second pull test (write, then pull with cursor = the
  write's second: returned); sync.go comment already documents `>=`.

## Task 6 - #51 home layout 404 (web)
- Ruling: web `loadLayout` uses the existing user-global list route
  (`data.user().list('home-layout')`, exact key match) — a missing row is an
  empty 200, no server change, no 404 in the network log — cost if wrong: the
  list returns rows with the prefix `home-layout...`, filtered by exact key.
  Web test updated.

## Task 7 - #52 hide core (server + web)
- Ruling: flag, do not omit: `PluginInfo.hidden` is true for built-in feature
  plugins with no surfaces (`qinqin-core`). Omitting would make its
  state/data routes look unknown to a client that reads the list; a flag keeps
  one source of truth for every client. Web settings filters on `hidden`.
  Cost if wrong: Android must read one more field.
