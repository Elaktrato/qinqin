# Reader library rows

The reader's library: books, bookmarks, highlights and the reading position, as the library routes serve
them (`/api/library/books...`, see `docs/wiki/API-Routes.md`). Spec:
`docs/superpowers/specs/2026-11-16-v040p-core-features-design.md` (Q5, issue #85). Server:
`server/internal/library/{library,bookmarks,highlights}.go`, handlers in
`server/internal/api/handlers_{library,bookmarks,highlights}.go`. Fixture: `rows.json`, driven against the
handlers with two users by `server/internal/api/contract_library_test.go`.

## Rows (every key always present)

| Row | Keys |
| --- | --- |
| book | `id`, `workspaceId`, `language`, `title`, `author`, `source`, `sourceId`, `sourceUrl`, `attribution`, `licenseNote`, `chapterCount`, `position`, `createdAt`, `updatedAt` |
| bookmark | `id`, `bookId`, `position`, `label`, `createdAt`, `updatedAt` |
| highlight | `id`, `bookId`, `chapter`, `paragraph`, `start`, `end`, `text`, `color`, `note`, `createdAt`, `updatedAt` |

- Times are RFC 3339 UTC seconds. `updatedAt` is the row's write stamp: creation, then a position `PUT`
  (book), a relabel (bookmark), a colour or note edit (highlight). A request that changes nothing (an
  existing bookmark at the same position, a highlight edit with no field) leaves it.
- Ids are never reused (`AUTOINCREMENT` on all three tables since migration 038).
- Every row belongs to one user; another user's ids are 404 on every route (never 403), exactly like ids
  that do not exist.

## Rules

- **Position** (book `position`, bookmark `position`): `<chapter>:<paragraph>`, both zero-based decimal
  integers, written by clients. The server stores any string of at most 1024 bytes (413 above) and never
  parses it; an empty book position means "the beginning". A bookmark needs a non-empty position (422);
  one bookmark per position (a second `POST` at the same position answers the existing one with 200).
- **Label**: whitespace runs collapse to one space, trimmed; control and bidi-control characters dropped;
  at most 120 code points (422).
- **Highlight range**: `start`/`end` are code-point offsets into the paragraph's plain text, `end`
  exclusive; `text` must be exactly those code points (not empty, no leading or trailing whitespace) —
  UTF-16 offsets are refused (422). The chapter must exist (422). Ranges of one paragraph may touch but not
  overlap: 409 `{"error": ..., "existingId": <id>}`.
- **Colour**: `yellow` (default), `green`, `blue`, `pink`; anything else 422.
- **Note**: CR LF and CR become LF, control and bidi-control characters dropped, at most 2000 code points
  (422). A highlight's text is at most 500 code points; a book holds at most 2000 highlights and 200
  bookmarks (409).

## Deletions

Books, bookmarks and highlights are hard-deleted. Every deletion (one bookmark, one highlight, a book with
its bookmarks and highlights, a workspace with its books) also writes one `library_deletions` row
`(user_id, collection ∈ books|bookmarks|highlights, row_id, workspace_id, deleted_at)` in the same
transaction (a failing log write rolls the deletion back). The log is sync bookkeeping for the paged
library sync of item 5: it is never exported in a backup, deleted with the user and cleared by a restore
(every client pulls in full after a restore). No route serves it yet.
