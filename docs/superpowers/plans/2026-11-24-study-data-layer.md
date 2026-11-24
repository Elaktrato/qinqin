# Plan — the web study data layer (#193)

Issue #193 (phase 3 of #190). Branch `feature/193-study-data` from `develop` at 61fd5675, worktree
`.claude/worktrees/193-study`. A refactor with two deliberate behaviour changes: writes no longer pull the
whole study state first, and the study page picks up a row written in the same second as its load. Owner
direction (2026-11-24): no backwards compatibility, so `store.ts`, `history.ts` and `studyData.ts` go and every
import is rewritten; stored user data and the e2e suite stay as they are. The contracts (`docs/contracts/study`,
`sync`) do not change.

## Where it starts (61fd5675)

- `lib/study/store.ts`, 1,578 lines: the paged pull, the row decode, the unreadable-row bookkeeping, the LWW write
  planning, the typed and keyed push, the outbox merge, the duplicate-card merge and 25 commands. Every command
  starts with a full study pull.
- Two caches of nearly the same data: `lib/study/history.ts` (8 s, merged, for widgets) and
  `lib/study/studyData.ts` (30 s, raw, for "is this word studied"). `loadStudyData` (pages) is uncached.
- Keyed plugin-data rows have two paths: `store.ts` (`dataPath`, `pushKeyedRows`, a `decodeData` that turns a
  non-JSON string into null) and the plugin SDK (`plugins/sdk.ts`, a `decodeData` that keeps such a string). The
  core rows (notes, lookups, layout, widget options, theme, navigation layout, activity view) go through the SDK
  with the core manifest.
- `GENERAL_DECK_ID` is defined in `types.ts` (#175) but 24 modules still import it from the store;
  `STUDY_ALL_LIMIT` is gone from `session.ts` (#175 already did that one).
- `cardFlow.ts` holds the tone and writing checks (`toneVerdict`, `tonePadLabels`, `toneCandidates`,
  `maskWritten`) and re-exports two `sessionQueue.ts` names "so existing imports keep working".
- `V2_STUDY_COLLECTIONS` (`lib/sync/pager.ts`) is a hand-written copy of the study collections.

Request counts measured before the change (fake server `lib/testing/studyServer.ts`, 2,000 cards and 5 decks,
100 rows per page, so a round is 21 pages):

| Flow | Before |
|---|---|
| `addCard` on a cold tab | 21 pull pages + 1 push |
| Reader: "is this studied" check, then add | 42 pull pages + 1 push |
| Rename a deck after the study page loaded | 21 pull pages + 1 push |
| Delete 3 cards after the study page loaded | 21 pull pages + 3 pushes |
| Known mark after the home widgets loaded | 1 PUT |
| Study page load / a second load right after | 21 pull pages + 1 log read, each |

## Module map (target)

`lib/sync/` (shared with non-study rows):
- `pager.ts`: the envelope pager; `V2_STUDY_COLLECTIONS` = the switches and plugin rows plus `STUDY_COLLECTIONS`.
- `push.ts` (new): `POST /api/sync/push` in chunks with last-write-wins stamps (`stampOf`), `PartialPushError`.
- `keyed.ts` (new): keyed plugin-data rows of any namespace: route building, the one data decode, the decode of
  a pulled row, the key-route scope (`get/put/find/list/delete`) and the LWW batch push.

`lib/study/`:
- `sync/pull.ts`: one study round of a workspace (full, or a delta from a cursor).
- `sync/push.ts`: typed study writes (`StudyWrite` → push body), returning the stamps written.
- `plan.ts`: pure planning against a snapshot (`studyWrite`, `studyDelete`, `extraOf`, `freshCardId`,
  `StudySnapshot`).
- `cache.ts`: `StudyCache`, one per session, a slot per workspace with the raw rows and their LWW stamps.
- `readModel.ts`: pure views of a slot: `StudyData` (raw), the snapshot, the unreadable report, the merged history.
- `data.ts`: the session's cache instance and the reads (`loadStudyData`, `loadStudyHistory`, `getStudyData`,
  `loadRawStudyData`, `onStudyChange`).
- `commands/{write,decks,cards,settings,keyed}.ts`: the writes.
- `tones.ts`, `writing.ts`: the card checks moved out of `cardFlow.ts`.

## Tasks

1. **This plan**, plus the fake server `lib/testing/studyServer.ts` the measurements use.
2. **Constants and helpers out of heavy modules**: `GENERAL_DECK_ID` from `types.ts` everywhere; `activeWeights`
   and `cardsInDecks` to `readModel.ts`; the tone and writing checks to `tones.ts` / `writing.ts`; the
   `cardFlow.ts` re-exports removed; `pureImports.test.ts` widened.
3. **`V2_STUDY_COLLECTIONS` derived** from `STUDY_COLLECTIONS` (test first).
4. **`lib/sync/keyed.ts`** test-first (routes, decode, scope, LWW push); the SDK's data scope and the store's keyed
   writes go through it; the core rows use it directly instead of the SDK.
5. **Split `store.ts`** along its seams (`sync/pull.ts`, `sync/push.ts`, `lib/sync/push.ts`, `plan.ts`,
   `readModel.ts`, `commands/*`), `store.ts` a re-export shell for this commit only; `store.test.ts` unchanged
   and green.
6. **`StudyCache`** test-first (`cache.test.ts` on the fake server): full round, delta merge by key and stamp,
   in-place writes, a write landing during a round, unreadable rows across rounds, session end, the follow-up
   round, the full-round period.
7. **Wire the cache**: `data.ts` replaces `history.ts` and `studyData.ts`; commands plan against the cache, update
   it in place, and re-plan once after a skip; `store.ts` deleted; every import and mock rewritten;
   `store.test.ts` split along the code.
8. **The same-second row** (acceptance): the study page listens to `onStudyChange`, which a follow-up round fires.
9. **Request counts** pinned in `requestCounts.test.ts`; the records (0002, 0007), the contracts' "Owner code"
   lines and the wiki; the Execution record; the gates.

## Rulings

- Ruling: the cache refreshes a slot older than 8 s with a delta round (`since` = the slot's cursor), and with a
  full round when its last full round is older than 5 min — a delta is one page in the usual case, and the
  periodic full round keeps the service worker's offline copy of the round fresh (it saves full rounds only,
  `v2PullAllowed`) — cost if wrong: a page shows another device's change up to 8 s late (as the 8 s history cache
  did), and an offline reload may miss up to 5 min of online edits made in a long-lived tab.
- Ruling: writes plan against the cache under the same 8 s rule and never pull a full round first; a write the
  server skips (it holds a newer row) refreshes the slot with a delta round and plans once more; a second skip is
  the `PartialPushError` it was — cost if wrong: a write planned from an 8 s old copy can overwrite another
  device's edit of the same row made in those 8 s (last write wins, as before when two devices race).
- Ruling: after a write the cache holds the written row with the stamp it was sent with (typed rows, keyed batch
  rows) or the server's answer (`PUT` of a keyed row returns the stored row); a `DELETE` of a keyed row keeps the
  local time — the next write is stamped after it either way, and a skip re-reads — cost if wrong: one extra
  delta round when the device clock is behind the server.
- Ruling: a full round replaces the slot, except keys written locally while it ran (kept when newer) — the round
  started before those writes landed — cost if wrong: none known; a delta merges by key and stamp in any case.
- Ruling: a failed refresh of a loaded slot serves the rows it holds (reads and writes; offline the delta URL is
  not in the worker's copy), unless the caller forced the read (a widget's "Try again") — cost if wrong: a page
  online with a failing pull shows rows up to the last good round instead of an error.
- Ruling: the same-second row — a round's `until` is the server clock truncated to the second, so a row stamped
  in that second comes in the next round only. While anything listens to `onStudyChange`, the cache runs one
  follow-up delta round 1.25 s after each round a reader or writer caused (never after a follow-up), and a
  follow-up that changed rows fires `onStudyChange`; the study page reloads on it — cost if wrong: one extra
  pull request per round while a page listens.
- Ruling: one keyed-data decode for every namespace: a string that is JSON text is decoded, any other string is
  kept as it is (the SDK's round-trip rule, which the core rows rely on); a study keyed row whose family parser
  then refuses it is unreadable and protected (record 0002), as it was under the store's rule (which turned such
  a string into null, refused the same way) — cost if wrong: none for stored data.
- Ruling: listed rows (the key routes' prefix list) decode by the pull's strict shape (`keyedRowOf` over
  `readableRow`): a row off the contract shape is skipped and logged, never the answer; a single-row `get`
  decodes only its data — the server always sends the full shape, so this only made test fixtures honest
  (`lib/testing/keyed.ts`) — cost if wrong: a server answering partial rows would hide them (none does).
- Ruling: deleting a keyed row the server does not hold (a vacation deleted in another tab) succeeds instead of
  failing with 404, as unmarking a known mark already did — cost if wrong: none; the row is gone either way.
- Ruling: the commands that write row by row and report what landed with `PartialCardsError` (delete, restore,
  move, the skip-kind switches) do not re-plan after a skip: the skip marks the workspace stale, so a retry
  plans from fresh rows; every other command re-plans once (`replanned`) — cost if wrong: one extra click after
  a clock-skew skip in those flows.
- Ruling: the core rows (notes, lookups, layout, widget options, theme, navigation layout, activity view) use
  `lib/sync/keyed.ts` directly, not the plugin SDK; the SDK keeps only the permission checks for the journal and
  grammar until #199 removes it — so this branch does not deepen the SDK dependency #199 retires.
- Ruling: `loadStudyData` (pages that schedule or write) reads the event log fresh, `loadStudyHistory` (widgets)
  through the 8 s log cache, both over the one row cache; `loadStudyData` and `loadRawStudyData` hand out fresh
  objects, `loadStudyHistory` and `getStudyData` share one per slot version (do not mutate) — the pages keep
  their data in `$state`.
- Ruling: no client-side stored data is migrated or read in an old form (owner update 2026-11-24: a clean start
  is fine, also for browser storage). This branch changes no stored client format: the study cache lives in
  memory only, the outbox, the offline receipts and the service worker's saved pages keep their keys, so there
  was nothing to drop — cost if wrong: none.
- Ruling: the cache is a plain class (`StudyCache`) with its dependencies injected (pull, clock, session epoch,
  timers); `data.ts` creates the session's one instance with `createStudyCache` and clears it at the session end
  (#173's registry and lint) — #196 moves that instance into the per-session app context.

## Execution record

Commits (one per task, the suite green at each; full vitest under Node 26 at tasks 2, 4, 5 and 7):

1. `2e4caa95` the plan and the fake study server (`lib/testing/studyServer.ts`, with its own test).
2. `4fa55f3e` constants and card checks out of heavy modules; `pureImports.test.ts` widened to the data layer.
3. `5d88c22c` `STUDY_PULL_COLLECTIONS` from `STUDY_COLLECTIONS` (test first; seen failing by a mutation that
   dropped `fsrsActive`); record 0002's open question closed.
4. `30d90838` `lib/sync/keyed.ts` and `lib/sync/push.ts` (tests first: `keyed.test.ts`, `push.test.ts` failed on the
   missing modules); the SDK and the core rows on it.
5. `7a223295` `store.ts` split; `store.ts` a re-export shell; `store.test.ts` unchanged and green.
6. `a2649edd` `StudyCache`, test first (`cache.test.ts` failed on the missing module, then on three test
   mistakes of my own: page counts, a gate that also held the first load, the vacation shape). Mutation checks:
   without `keepLocalWrites`, without the follow-up and without the stamp check of the merge, a test fails each
   time (the stamp check only after the test was fixed to send the older copy inside the delta window).
7. `c204a595` the cache wired; `store.ts`, `history.ts`, `studyData.ts` gone; tests split. `replanned` seen
   failing by a mutation (no second plan: 2 of 3 tests fail).
8. `84aaf17a` the study page reloads on `onStudyChange`; its dom test fails without the wiring.
9. Docs, records and this record (the last commit).

Test changes on purpose: the skip-kind test ends the session between its two steps (the second step used to see
the server's changed row through a new full pull; the cache plans from its own write now); the sign-out isolation
test holds six requests instead of seven (the widgets' history and the raw data share one round); the store
workspace guard checks every data-layer file. The 149 tests of `store.test.ts` all survive in the split files.

Request counts after (`requestCounts.test.ts`, same seed as above):

| Flow | Before | After |
|---|---|---|
| `addCard` on a cold tab | 21 pulls + 1 push | 21 pulls + 1 push |
| Reader: "is this studied" check, then add | 42 pulls + 1 push | 21 pulls + 1 push |
| Rename a deck after the study page loaded | 21 pulls + 1 push | 1 push |
| Delete 3 cards after the study page loaded | 21 pulls + 3 pushes | 3 pushes |
| Known mark after the home widgets | 1 PUT | 1 PUT |
| Study page load / a second load right after | 21 pulls + 1 log, each | 21 pulls + 1 log, then 1 log |

A write more than 8 s after the last round costs one delta page first (usually one request); a skipped write
costs one delta page and one more push. While a page listens, each round is followed by one delta page 1.25 s
later.

Not migrated / not done:
- The service-worker list `CACHEABLE_PULL_COLLECTIONS` stays its own list (pinned by its test, record 0002): deriving
  it would pull the study row code into the worker bundle.
- The e2e helper `settled()` (waits until a pull round ships pushed cards) stays: other specs start a session at
  once, before the follow-up round could add the late cards.
- The journal and grammar keep the SDK (#199 retires it); the cache instance is a module singleton in `data.ts`
  until #196 moves it into the app context.

Not verified: real devices and browsers other than Chromium; the follow-up round against a real server's
second boundary (checked on the fake server and by reasoning about `until`); offline after a long online session
(the five-minute full round is unit-tested, not driven in a browser).


Gates on the last code commit (`84aaf17a`, plus these docs): `npm run check` 0 errors; `npm run build` ok; full
vitest under Node 26: 598 files, 12,640 passed, 2 skipped; e2e (`npm run e2e -- --trace off`) five runs green, 13
passed each (one after task 7, four at the end); `node --test scripts/*.test.mjs` 156 passed;
`gen-api-docs --check` ok. Go not touched, so no Go gate. Under Node 22 locally, `BookView.dom.test.ts` and
`AccountSettings.dom.test.ts` fail five tests on the untouched base too (they pass under Node 26, as in CI).
