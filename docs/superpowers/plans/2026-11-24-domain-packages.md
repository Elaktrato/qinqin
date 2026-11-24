# Plan — domain packages own their SQL (#194)

Issue #194 (phase 2 of #190), record [0003](../../architecture/0003-domain-packages-own-their-sql.md). Branch
`feature/194-domain-packages` from `develop` at b1ccaae6, worktree `.claude/worktrees/194-domain`. A refactor:
no change for users, administrators or clients (same routes, statuses, bodies and error codes). The suite stays
green after every commit; new domain functions are test-first; one commit per task. Go gates under
`flock /tmp/qinqin-go.lock`; the e2e suite (record 0007) at the end.

## The places of the issue, today

The issue predates #168 (error contract) and #192 (pack system). Checked in the code at b1ccaae6, counting
calls of `QueryContext`, `QueryRowContext`, `ExecContext` and `BeginTx` in the non-test files of
`server/internal/api` (51 in all, in 20 files):

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
   by file and function, each with its reason; a stale allowlist entry fails too. It lands with today's 51
   sites listed as "moves in task N"; every later task removes its entries.
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

(Filled in as the tasks decide them.)

## Execution record

(Filled in per task.)
