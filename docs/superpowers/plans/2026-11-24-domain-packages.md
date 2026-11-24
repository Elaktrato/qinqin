# Plan — domain packages own their SQL (#194)

Issue #194 (phase 2 of #190), record [0003](../../architecture/0003-domain-packages-own-their-sql.md). Branch
`feature/194-domain-packages` from `develop` at b1ccaae6, worktree `.claude/worktrees/194-domain`. A refactor:
no change for users, administrators or clients (same routes, statuses, bodies and error codes). The suite stays
green after every commit; new domain functions are test-first; one commit per task. Go gates under
`flock /tmp/qinqin-go.lock`; the e2e suite (record 0007) at the end.

## The places of the issue, today

The issue predates #168 (error contract) and #192 (pack system). Checked in the code at b1ccaae6, counting
calls of `QueryContext`, `QueryRowContext`, `ExecContext` and `BeginTx` in the non-test files of
`server/internal/api` (48 in all, in 20 files; with the 45 string literals that start like an SQL statement,
93 findings of the guard in 37 functions):

| Place | SQL calls at b1ccaae6 | This branch |
|---|---|---|
| `handlers_workspaces.go`: create, list with the default workspaces, update, delete transaction, `languageKnown` | 12 | `internal/workspaces` (and the language check in `internal/lang`) |
| `handlers_admin_languages.go`: register, usage counts and blockers, delete, workspaces per language | 6 | `internal/lang` |
| `handlers_languages.go`: installed and known languages | 2 | `internal/lang` |
| `handlers_audio.go`: clip check, pack list, credits paging | 5 | `internal/audio` |
| `handlers_dict.go`: list, the installed row, the pack id of a row id | 3 | `internal/dict` |
| `entry_view.go`: the dictionaries credited by an entry | 1 | `internal/dict` |
| `handlers_events.go` `workspaceOwned` (events, plugins, stats), `handlers_journal.go` `journalTarget`, `handlers_packages.go` `workspaceLanguages` | 3 | `internal/workspaces` |
| `handlers_auth.go` (user count, twice), `handlers_login_mfa.go` (disabled check, twice), `handlers_admin_backup.go`, `handlers_backup.go`, `handlers_backup_restore.go` (the user's name), `handlers_admin_audit.go` (the audit page), `handlers_mfa.go` (remove the authenticator with its audit row) | 9 | `internal/auth` |
| `handlers_ai.go` (delete a key), `handlers_ai_custom.go` (delete a custom provider) | 5 | `internal/ai` |
| `handlers_levels.go` (the pack of a scheme row) | 1 | `internal/levels` |
| `handlers_packs.go` (the sentence pack list) | 1 | `internal/sentences` |

## Tasks

1. **This plan.**
2. **Pins first** (no code change): `TestMovedRoutesAnswerAsBefore` (`server/internal/api/domain_pins_test.go`)
   drives every route whose SQL moves through a fixed script of requests (good and bad inputs, two users and
   an administrator) and compares status and body, line by line, with
   `server/internal/api/testdata/domain_routes.golden` (timestamps normalised). It is written and its golden
   file generated on b1ccaae6; the file is never regenerated on this branch.
3. **The guard**: `TestNoSQLInAPI` (`server/internal/api/sql_static_test.go`), an AST scan of every non-test
   file of `api`: a call of `QueryContext`, `QueryRowContext`, `ExecContext`, `PrepareContext` or `BeginTx`, or
   a string literal that starts like an SQL statement, is a finding. Findings are matched against an allowlist
   by file and function, each with its reason; a stale allowlist entry fails too. It lands with today's
   findings listed by function as "moves in task N"; every later task removes its entries.
4. **`internal/lang`**: the language registry (installed, known, a code's existence, adding a data-only
   language, usage and blockers, removal, workspaces per language), test-first.
5. **`internal/workspaces`**: name rule, create, list with the defaults, update, delete with one rule per
   `workspace_id` table, owned, language, languages; the delete-coverage guards, test-first.
6. **`internal/audio`**: clip check, pack list, credits page, test-first.
7. **`internal/dict`**: installed dictionaries, the row of a pack, the pack of a row, the credits of senses,
   test-first.
8. **`internal/auth`**: user count, active user, user name, disabled check, the audit page, removing the
   authenticator with its audit row, test-first.
9. **`internal/ai`, `internal/levels`, `internal/sentences`**: deleting a key and a custom provider, the pack of
   a scheme row, the sentence pack list, test-first. The allowlist is empty.
10. **Records and docs**: 0003 to `Accepted` (Rulings into its open questions), 0001's paths, the README
    index; this plan's Execution record; the real-app check.

## Rulings

- Ruling: the whole `api` package moves now, not only the four families the issue names — the other sites
  were small lookups (a user's name, a count, a pack id), so moving them cost little, and an empty allowlist
  makes the rule one sentence a reviewer can check — cost if wrong: a larger diff to review once; the pins and
  the existing handler tests guard it.
- Ruling: the language registry goes into `internal/lang` (a new file, `registry.go`), as the issue says — no
  import cycle: `lang` imports only `lemma`, `model` and `pinyin`, none of which imports `lang`, and `pack`, which
  imports `lang`, still imports nothing else of ours; `lang` gains only `database/sql` — cost if wrong: the rule
  package now carries SQL; a later split into a `languages` package is a rename of eight functions.
- Ruling: the `api` rule is enforced by an SQL scan only, no import rule — `api` must hold and pass the
  `*sql.DB`, so a ban on `database/sql` cannot tell passing from querying, and a list of the domain packages
  `api` may import would only grow. The scan (AST) flags the `database/sql` method names (`QueryContext`,
  `QueryRowContext`, `ExecContext`, `PrepareContext`, `BeginTx`; `Query`/`QueryRow`/`Exec` with arguments,
  `Prepare` of a string, `Begin()`) and string literals that start like an SQL statement, matched against an
  allowlist by file and function with a reason — cost if wrong: SQL that reaches `api` through a helper
  written for it in another package passes; review catches that.
- Ruling: domain types carry no JSON tags; `api` keeps the wire structs and converts (`toWorkspace`,
  `toLanguageInfo`, `toDictionaryBody`) — the wire shape is the handler's contract, the domain type is what
  the CLI and other packages use — cost if wrong: a few lines of copying per type.
- Ruling: the cross-request locks stay in the server (`langMu` around `workspaces.Create` and `lang.Remove`,
  `packMu` around the pack routes); the domain functions say that their caller serialises them — the locks are
  process state of the server and the CLI does not create workspaces or remove languages today — cost if
  wrong: a future CLI caller must take its own lock.
- Ruling: the workspace delete keeps the workspace's `library_deletions` rows (a `Keep` rule with the reason) —
  the delete of the books writes them so a device that pulls every workspace learns that the books, bookmarks
  and highlights are gone (`TestDeletedWorkspaceSync` pulls across workspaces); they go with the user and on a
  restore — cost if wrong: three small rows per deleted book stay until the user is deleted.
- Ruling: no new guard for the account deletion — `TestSchemaGuardEveryUserTableIsListed`
  (`server/internal/auth/delete_test.go`) already lists every table with a user reference column
  (`workspace_id` included) from the migrated schema and fails on one missing from the deletion registry, and
  the deletion test seeds and checks every listed table; no gap found — cost if wrong: none found.
- Ruling: the pins are one golden transcript (`testdata/domain_routes.golden`) of status, content type and
  body, timestamps and the random instance id normalised, written on b1ccaae6 and not regenerated — one file
  shows any changed answer line by line — cost if wrong: an unrelated change to a pinned answer (the AI
  model list in the journal capabilities body) needs a deliberate regeneration.
- Ruling: answers stay byte for byte, including the "a audio pack" of the language blockers (the plural helper
  writes "a" before every singular) — a refactor does not reword; a follow-up may fix it with its catalogue
  test — cost if wrong: none.
- Ruling: `PUT /api/workspaces/{id}` checks the name in the handler before the settings (and
  `workspaces.Update` checks it again) — the answer order (422 for a bad name before 400 for bad settings) is
  pinned, and the domain function must refuse a bad name for any caller — cost if wrong: a name is trimmed and
  checked twice.
- Ruling: lookups that ignored a missing row keep doing so (`levels.PackOf` and `dict.PackOf` return empty
  values, `auth.Username` is used without its error for the safety-export file name, `auth.Disabled` without it
  in the MFA challenge after `LoadUser`) — same answers — cost if wrong: none.

## Execution record

- Task 1 (4321e849): this plan.
- Task 2 (896e38e1): `TestMovedRoutesAnswerAsBefore` and its golden file, generated on the unchanged code
  (b1ccaae6 plus the test) with `UPDATE_DOMAIN_PINS=1`, then run twice more there without a difference. It
  passes unchanged after every later commit; the golden file was never regenerated. It drives about 150
  requests: the workspace routes (create, list with the defaults, update incl. the 413 and the answer order,
  delete incl. the last-workspace 409), the workspace checks of events, plugin data, stats, journal and the
  package catalogue, the admin language routes and `GET /api/languages`, the audio pack list, credits and
  clips, the dictionary list, install, entry credits and uninstall, the auth options, the audit page, the AI
  key and custom endpoint deletes, the scheme uninstall and the sentence pack list. Not in the transcript (the
  setup is long; existing handler tests cover them and passed after every commit): the server and personal
  backup downloads (`TestAdminServerBackup`, `TestExportTicketOfADisabledUserIsDead`, the restore tests), the
  disabled-user checks of the MFA and email sign-in (`handlers_login_mfa_test.go`,
  `handlers_email_login_test.go`), removing the authenticator (`TestTOTPDisableRegenerateAndRecovery`). The
  custom endpoint delete is pinned only on its refusals (custom endpoints are off in the pinned server);
  `TestDeleteCustomProviderTakesKeysAndSelections` (c1c301a6, written after the move) covers the happy path
  over HTTP and was run green on b1ccaae6 as well (a scratch worktree, removed).
- Task 3 (dcb2a9e8): `TestNoSQLInAPI` and `TestSQLFindings`. With an empty allowlist the scan failed on b1ccaae6
  with 93 findings (48 calls, 45 literals) in 37 functions; the commit lists the 37 functions with their task.
  The first scan by method name alone also matched `r.URL.Query()`, a rate limiter's `Begin` and the mail
  store's `Prepare`; the non-context forms are matched by shape since (cases in `TestSQLFindings`).
- Task 4 (0226016c): `internal/lang` registry, tests first (`registry_test.go` failed to build, then passed;
  one expectation of mine was wrong, not the code: a stored `ES` is not found by `es`, as before). The
  installed-languages plan test moved from `api` to `lang`.
- Task 5 (c3534a26): `internal/workspaces`, tests first (the package did not exist). Mutation check: with the
  `access_tokens` rule removed, both delete guards failed (no rule; one row left; no audit row); restored.
- Task 6 (19ac5a69) audio, task 7 (b9fac4ac) dict, task 8 (c101fdd1) auth, task 9 (62dcecc5) ai, levels,
  sentences: each test first (undefined functions), then the handlers; the api suite and the pins green after
  each. After task 9 the allowlist is empty: 0 SQL calls and 0 SQL literals in the non-test files of `api`
  (from 48 and 45).
- Task 10: records 0003 (`Accepted`, Rulings in its open questions), 0001 (the domain error mapping, Touched
  by), 0008 (`dict` reads the installed dictionaries, Touched by), the README index, the wiki project layout.
- Real-app check (this branch, `git archive` of 62dcecc5 into a scratch dir, built there): seeded cedict,
  es-demo and a generated three-clip zh audio pack; served on a random free 127.0.0.1 port above 20000; driven
  with Python. Bob's workspace "Doomed" got settings, six typed study rows, a review and a lookup event,
  three plugin data rows (two journal notes, a flashcards row), an uploaded epub with a bookmark and a
  highlight, a journal photo draft and an access token limited to it; the kept workspace got study rows and
  events too. After `DELETE /api/workspaces/{id}` (204, then 404): 0 rows of it in every table with a
  `workspace_id` except `library_deletions` (3 rows: the book, the bookmark and the highlight, the kept sync
  log), 0 bookmarks and highlights of its book, no workspaces row, the token revocation audited, no book or
  photo file left on disk; the kept workspace kept its rows. Language usage, add/delete language (201, 409 in
  use with the counts, 409 built in, 204), audio packs and credits (page, cap at 500, 400, 404), the dictionary
  list and uninstall (404, 204, 404) and the audit page answered as pinned. My first lookup request had wrong
  parameters (400 from the unchanged lookup route); with `lang`, `text`, `offset` it is 200. The server was
  stopped and the scratch copy and data deleted.
- Final gates: `gofmt -l` empty; `go mod tidy -diff` clean; full Go `./...` under the flock: 52 packages ok,
  only the known `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` failing (no IPv6 sockets here);
  web `check` 0 errors and `build` ok; full vitest under Node 26: 588 files, 12605 passed, 2 skipped; e2e
  (`npm run e2e -- --trace off`): 13 passed; `node --test scripts/*.test.mjs`: 156 passed; `node
  scripts/gen-api-docs.mjs --check` ok (no route changed).
- Not verified: the CLI does not call the new domain functions yet (reuse is possible, not exercised); the
  backup download and MFA sign-in paths were checked only by their existing tests, not in the real app; no
  measurement of speed (none of the moved queries changed).
