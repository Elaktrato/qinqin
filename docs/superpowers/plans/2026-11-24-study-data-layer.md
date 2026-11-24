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
  kept as it is (the SDK's round-trip rule); a study keyed row whose family parser then refuses it is unreadable
  and protected (record 0002) — the store's old rule (non-JSON string = no data) made such a row look absent, so a
  write could replace it — cost if wrong: none for stored data; a string-valued study row reads as unreadable
  instead of absent.
- Ruling: the core rows (notes, lookups, layout, widget options, theme, navigation layout, activity view) use
  `lib/sync/keyed.ts` directly, not the plugin SDK; the SDK keeps only the permission checks for the journal and
  grammar until #199 removes it — so this branch does not deepen the SDK dependency #199 retires.
- Ruling: `loadStudyData` (pages that schedule or write) reads the event log fresh, `loadStudyHistory` (widgets)
  through the 8 s log cache, both over the one row cache; `loadStudyData` and `loadRawStudyData` hand out fresh
  objects, `loadStudyHistory` and `getStudyData` share one per slot version (do not mutate) — the pages keep
  their data in `$state`.
- Ruling: the cache is a plain class (`StudyCache`) with its dependencies injected (pull, clock, session epoch,
  timers); `data.ts` creates the session's one instance with `createStudyCache` and clears it at the session end
  (#173's registry and lint) — #196 moves that instance into the per-session app context.

## Execution record

(Filled in as the tasks land.)
