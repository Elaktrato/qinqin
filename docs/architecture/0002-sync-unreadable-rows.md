# 0002. Sync: an unreadable row is skipped, never the page

## Status

Accepted

Touched by: none. A merge from an issue that changes what this record names adds it here and updates the record.

## Context

The web sync pager refused a whole pull page when one typed study row failed its strict parse, so one
malformed row, or one written by a newer client, stopped flashcards from loading at all (#167). A second parse
in the study store had a comment promising to skip bad rows, but never ran. On the server, a stored row it
could not decode made the paged pull answer 500. #167 (merged into `develop` in 72705c92) fixed both sides. The
data rule every client follows is the contract: "Reading rows" in
[`docs/contracts/sync/README.md`](../contracts/sync/README.md#reading-rows-unreadable-rowsjson-167), fixture
`docs/contracts/sync/unreadable-rows.json`. This record says where the code implements it.

## Decision

**Web.**

- The pager (`apps/web/src/lib/sync/pager.ts`) checks the page **envelope only** and never inspects a row; an
  envelope fault refuses the page.
- Each consumer decodes the rows it uses. Typed study rows decode strictly with `parseRow` over
  `STUDY_COLLECTIONS` (`apps/web/src/lib/study/rows.ts`); `readableRow` (`apps/web/src/lib/sync/rows.ts`) does
  the same for them and decodes the other collections by their shape. Keyed plugin-data rows (the study
  namespace's and the core rows) decode through `keyedRowOf` (`apps/web/src/lib/sync/keyed.ts`, #193), which
  uses `readableRow`, for the pull and the list route alike. A row that does not decode is **unreadable**.
- The study read model (`mergeRows` and `viewOf` in `apps/web/src/lib/study/readModel.ts`, held per workspace by
  the study cache `apps/web/src/lib/study/cache.ts` since #193) skips and counts unreadable rows, and remembers
  the identity of each unreadable typed row whose identity member is still readable (`rawIdentity`) and each
  unreadable keyed row (goals, known marks, vacations), across later pull rounds: a readable version of the
  row frees its identity. The session's `UnreadableRows` (`apps/web/src/lib/study/unreadableReport.svelte.ts`,
  record [0009](0009-web-state-model.md)) keeps the count for the study page's notice
  (`UnreadableRowsNotice.svelte`, its text from `apps/web/src/lib/study/unreadable.ts`) and logs one console
  warning with collection, count and identities, never row data.
- A write that would replace a protected identity throws `UnreadableRowError` (a `ShownError`, so
  `errorText` shows its text, [0001](0001-error-handling.md)): `studyWrite` (`apps/web/src/lib/study/plan.ts`)
  for typed rows, `assertReadableKeyed` (`apps/web/src/lib/study/data.ts`) for keyed ones. A new card takes a
  free id (`freshCardId`), add-to-deck skips protected identities, and a deck delete tombstones only rows it
  read.

**Server.** `server/internal/study` reports a stored typed row it cannot decode as `ErrUnreadableStored`
(`UnreadableStoredError` names family, workspace and identity; `LogUnreadable` logs those, never the data). The
paged pull (`server/internal/sync/page.go`) skips the row and still moves the cursor past it; a push onto it
is refused whole (`ErrStoredUnreadable` in `server/internal/sync/sync.go`) and the API answers 409
`study_row_unreadable` (`server/internal/api/handlers_sync.go`). The backup export still fails on such a row.

## Consequences

- One bad row never blocks studying; the learner sees how many items this version could not read.
- A row a newer client wrote survives on the server unchanged, so that client still reads it.
- The notice component is the flashcards feature's (`apps/web/src/lib/features/flashcards/UnreadableRowsNotice.svelte`);
  the detection stays in the logic folder `lib/study/` ([0004](0004-web-folder-rules.md)).
- A change to the rule changes the contract first: the "Reading rows" section and its fixture, with an entry in
  the contract changelog ([`docs/contracts/CHANGELOG.md`](../contracts/CHANGELOG.md)); this record then follows
  the code.
- Every new consumer of pull rows must decode per row; every new write path into typed or keyed study rows must
  check the protected identities.

## Allowed / Not allowed

Allowed:

- Skipping, counting and reporting a row that does not decode, by identity only.
- Refusing a write onto a protected identity with `UnreadableRowError` (web) or 409 `study_row_unreadable`
  (server).

Not allowed:

- Refusing a page, a pull round or a study load because of one row.
- Rewriting, overwriting, tombstoning or reusing the id of an unreadable row.
- Logging or showing an unreadable row's data.
- A second list that decides which rows are typed or how they decode: that is `STUDY_COLLECTIONS` and
  `parseRow`. Two lists name pull collections for another purpose, the scope: `STUDY_PULL_COLLECTIONS`
  (`apps/web/src/lib/study/sync/pull.ts`, what the study pull asks for, built from `STUDY_COLLECTIONS` since #193;
  `apps/web/src/lib/sync/pullPage.contract.test.ts` pins it to the fixture) and `CACHEABLE_PULL_COLLECTIONS`
  (`apps/web/src/lib/pwa/sw/classify.ts`, what an offline copy may hold; `apps/web/src/lib/pwa/sw/classify.test.ts`
  pins it to the plugin collections plus `STUDY_COLLECTIONS`).

## Enforcement

- The contract fixture is decoded by `apps/web/src/lib/study/unreadable.contract.test.ts` (the study load:
  what loads, what is counted, which writes are refused, fresh card ids, deck delete) and by
  `TestUnreadableRowsFixture` (`server/internal/study/rows/unreadable_contract_test.go`: typed rows decode
  exactly when readable).
- `apps/web/src/lib/sync/pullPage.contract.test.ts` (the pager and `readableRow`),
  `apps/web/src/lib/study/unreadable.test.ts`, `apps/web/src/lib/features/flashcards/UnreadableRowsNotice.dom.test.ts` and
  `apps/web/src/routes/study/page.dom.test.ts` (the notice on the study page).
- Server: `TestPullSkipsUnreadableStoredRowsAndAdvances` and `TestPushToAnUnreadableStoredRowIsRefusedWhole`
  (`server/internal/sync/unreadable_stored_test.go`), `TestUnreadableStoredRowOverHTTP`
  (`server/internal/sync/unreadable_http_test.go`).
- Review: a new consumer of pull rows or a new write path; no test finds one that forgets the rule.
