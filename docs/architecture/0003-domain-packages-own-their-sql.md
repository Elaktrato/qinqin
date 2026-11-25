# 0003. Server: domain packages own their SQL

## Status

Accepted

Touched by: #199. A merge from one of these issues that changes what this record names updates the record.

## Context

Handlers in `server/internal/api` held domain logic and SQL directly (#194): the workspace handlers (the whole
workspace-delete transaction among them), the language registry and its usage counts in the admin language
handlers, audio credits paging, the dictionary handlers, and smaller lookups in about fifteen other handlers.
That logic could not be tested or reused (for example by the CLI) without the HTTP layer, and nothing guarded
that a workspace delete reaches every table that has a `workspace_id`. #194 moved all of it; at b1ccaae6 the
package had 48 calls of a `database/sql` query, exec or begin method in 20 files, and has none since. The plan
with its Rulings is `docs/superpowers/plans/2026-11-24-domain-packages.md`.

## Decision

- **Domain packages own their SQL and their rules.** Business logic lives in a package under
  `server/internal/` whose functions take a `*sql.DB` or `*sql.Tx` (or a small interface of their methods)
  and never an HTTP request or response:
  - `server/internal/workspaces`: `ValidName`, `Create`, `List` (with `EnsureDefaults`), `Update`, `Delete`,
    `Owned`, `Language`, `Languages`, and the delete rules (`Rules`): one rule per table with a
    `workspace_id`, which empties it or keeps it for a stated reason (`library_deletions`, the sync log that
    tells other devices the workspace's books are gone).
  - `server/internal/lang` (`server/internal/lang/registry.go`): the language registry next to the language
    rules: `Installed`, `Known`, `Exists`, `AddData`, `AddDataRow`, `Use` with `Usage`, `Remove`,
    `WorkspaceCounts`.
  - `server/internal/audio`: `ClipActive`, `Packs`, `Credits`; `server/internal/dict`: `List`, `ByPack`,
    `PackOf`, `Credits`; `server/internal/auth`: `CountUsers`, `ActiveUser`, `Username`, `Disabled`,
    `AuditPage`, `DisableTOTP`; `server/internal/ai`: `DeleteUserKey`, `DeleteCustomProvider`;
    `server/internal/levels`: `PackOf`; `server/internal/sentences`: `ListPacks`.
- **The `api` package only decodes, authorises, calls the domain function and responds.** It holds the
  `*sql.DB` and passes it on; it writes no SQL. A domain package returns typed errors (`workspaces.ErrNotFound`,
  `workspaces.NameError`, `lang.BuiltInError`, `lang.InUseError`, ...), which the handler maps to coded answers
  as [0001](0001-error-handling.md) says (`writeWorkspaceError`). The wire shapes (JSON tags) stay in `api`; the
  domain types have none.
- **Serialisation that spans requests stays in the server.** Creating a workspace and removing a language hold
  the server's language lock (`langMu`), packs hold `packMu`; the domain functions document that their caller
  serialises them.
- **Tests at the domain level.** The domain function is tested without HTTP (`dbtest`, record
  [0005](0005-test-conventions.md)); the handler tests check decoding, authorisation and the answer.
- **Same responses when logic moves**: status, body and error codes. #194 pinned them before moving anything
  (`TestMovedRoutesAnswerAsBefore`).

## Consequences

- Domain logic is reusable by the CLI and other packages and testable without a server.
- A handler change and a domain change are reviewed separately; a handler stays short.
- A handler that needs one more column asks its domain package for it; a one-line lookup still gets a
  function (`auth.Username`), which costs a little ceremony.
- A new table with a `workspace_id` fails the workspace schema guard until `Delete` has a rule for it; a new
  table that references a user fails the user deletion guard until the deletion registry
  (`server/internal/auth/delete.go`) lists it.

## Allowed / Not allowed

Allowed:

- In `api`: decoding the request, the access check, calling the domain function, mapping its errors to coded
  answers, writing the response; passing `s.db` to a domain function.
- In a domain package: SQL, transactions, validation and rules; returning typed errors the handler maps; a
  validation message of its own that the handler passes through (`workspaces.NameError`).

Not allowed:

- SQL in `server/internal/api`: a call or method value of `QueryContext`, `QueryRowContext`, `ExecContext`,
  `PrepareContext` or `BeginTx` (or a call of their non-context forms), or a string that starts like an SQL
  statement, whatever its letter case, comments or parentheses in front, or the `+` chain it is split over.
- A domain function that needs an HTTP request or response to be called.
- A new table with a `workspace_id` that the workspace delete has no rule for.

## Enforcement

- `TestNoSQLInAPI` (`server/internal/api/sql_static_test.go`): an AST scan of every non-test file of `api`. It
  flags every use of `QueryContext`, `QueryRowContext`, `ExecContext`, `PrepareContext` and `BeginTx`, called
  or taken as a method value (`q := s.db.QueryRowContext`); a call of `Query`, `QueryRow` or `Exec` with
  arguments, of `Prepare` with a string, of `Begin()`; and every string, a literal or a `+` chain of
  literals read as one text (other operands as `?`), that starts like an SQL statement once leading white
  space, comments and parentheses are stripped (`sqlLead`), in any letter case, with what the statement needs
  next (`sqlStatement`: `SELECT` a column list or value, `DELETE FROM`, `INSERT INTO`, `UPDATE ... SET`, `WITH
  name AS (`, `CREATE TABLE`, ...), so prose such as "Select a language first." passes. A finding is allowed
  only when `sqlAllowed` names its file and function with a reason; the list is empty, and a stale entry fails
  too. `TestSQLFindings` pins what the scan does and does not flag (a route pattern such as `DELETE /api/...`,
  `r.URL.Query()`, a rate limiter's `Begin`, the mail store's `Prepare`, prose). On the code before #194 it
  reports 92 findings in 37 functions (48 calls, 44 statements).
- `TestEveryWorkspaceTableHasADeleteRule` (`server/internal/workspaces/delete_test.go`): lists every table with a
  `workspace_id` column from the migrated schema and fails on a table without a rule, or a rule without a
  table. `TestDeleteEmptiesEveryWorkspaceTable` seeds a row in each of them and in each child table (`childTables`:
  a table without a `workspace_id` that points at one of them by a foreign key or a `book_id` column, today
  `library_bookmarks` and `library_highlights`), failing on a table without a seed row, for two workspaces of
  one user and one of another; deletes one, and checks that nothing of it is left outside a kept table, no
  child row of its deleted rows remains, and the others keep every row. A child table that points at its
  parent by another column name and without a foreign key is not found; review catches that.
- `TestSchemaGuardEveryUserTableIsListed` (`server/internal/auth/delete_test.go`) does the same for the
  account deletion: every table with a user reference column, `workspace_id` included, must be in the deletion
  registry.
- `TestMovedRoutesAnswerAsBefore` (`server/internal/api/domain_pins_test.go`) compares the answers of the moved
  routes with `server/internal/api/testdata/domain_routes.golden`, written on the code before the move.
- Review, since no check sees these: business rules in a handler without SQL (a decision on data the handler
  got from a domain function); SQL that reaches `api` through a helper of another package written only for it
  (a query runner taking the statement text, a `*sql.Tx` handed back to the handler); a statement built at
  run time from parts the scan cannot fold (`fmt.Sprintf`, `strings.Join`, a named constant of another
  package, bytes); a database method reached through reflection or an interface method of another name.

## Open questions

- Which check guards the `api` layer: an import rule, a scan for SQL in `api`, or both. Decided in #194: the
  SQL scan only. `api` must hold and pass the `*sql.DB`, so an import rule on `database/sql` cannot tell
  passing a handle from querying, and a list of the domain packages `api` may import would only grow.
- Which handlers move beyond the four #194 names, and whether #194 does the whole package or those families
  first. Decided in #194: the whole package; the allowlist of the scan is empty.
