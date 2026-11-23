# 0003. Server: domain packages own their SQL

## Status

Accepted, being implemented by #194

## Context

Several handlers in `server/internal/api` hold domain logic and SQL directly (#194): the workspace handlers
(13 queries, including the whole workspace-delete transaction), language usage counts in the admin language
handlers, audio credits paging, and the dictionary handlers. That logic cannot be tested or reused (for
example by the CLI) without the HTTP layer, and nothing guards that a workspace delete reaches every table that
has a `workspace_id`.

## Decision

- **Domain packages own their SQL and their rules.** Business logic lives in a package under
  `server/internal/` whose functions take a `*sql.Tx` or `*sql.DB`; #194 names for example
  `internal/workspaces` (create, update, delete with every `workspace_id` table covered), language usage in
  `internal/lang` and audio credits in `internal/audio`.
- **The `api` package only decodes, authorises, calls the domain function and responds.** Errors are answered
  as [0001](0001-error-handling.md) says.
- **Tests at the domain level.** The domain function is tested without HTTP; the handler tests check decoding,
  authorisation and the answer.
- **Same responses as today** when logic moves, except where the error contract changes the error body.

## Consequences

- Domain logic becomes reusable by the CLI and other packages and testable without a server.
- A handler change and a domain change are reviewed separately; a handler stays short.
- Until #194 lands, the handlers named above still hold SQL; that is the debt this record removes, not a
  pattern to copy.

## Allowed / Not allowed

Allowed:

- In `api`: decoding the request, the access check, calling the domain function, mapping its errors to coded
  answers, writing the response.
- In a domain package: SQL, transactions, validation and rules; returning typed errors the handler maps.

Not allowed:

- New SQL or new business rules in `server/internal/api` handlers.
- A domain function that needs an HTTP request or response to be called: the point of #194 is reuse and tests
  without the HTTP layer.
- A new table with a `workspace_id` that the workspace delete does not cover.

## Enforcement

Planned by #194:

- A domain-level test that the workspace delete covers every table with a `workspace_id`, failing when a new
  table is added without a delete rule.
- An import check or a "no SQL in `api`" check, if practical (#194 leaves the form open).

Until then: review.

## Open questions

- Which check guards the `api` layer: an import rule, a scan for SQL in `api`, or both. Decided in #194.
- Which handlers move beyond the four #194 names, and whether #194 does the whole package or those families
  first. Decided in #194.
