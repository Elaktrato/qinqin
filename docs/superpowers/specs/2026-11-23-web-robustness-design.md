# Web robustness before Android (issues #167, #173, #174) — design

**Status:** built on `feature/hb-web-robust` (collection branch `feature/hardening-batch`, part of #166). Plan:
`docs/superpowers/plans/2026-11-23-web-robustness.md`. Contract: `docs/contracts/sync/` (`unreadable-rows.json`,
the "Reading rows" section of the README).

Three web fixes that Android must not inherit as bugs: one unreadable study row blocks every flashcard (#167),
sign-out leaves per-user caches behind (#173), and study writes read the current workspace when they run instead
of when the user acted (#174). #168 (JSON errors) and #169–#172 (server fixes) are built in parallel; this branch
does not restructure error display. #175 (one queue builder) builds on the `study/store.ts` signatures below.

## 1. Unreadable study rows (#167)

### Problem

`parsePullPage` (`apps/web/src/lib/sync/pager.ts`) runs the strict typed decode (`parseRow`) on every row and
refuses the whole page when one row fails; `pullAll` then throws "a page does not match the contract". One
malformed card, or a row written by a newer client (a member outside `extra`, a card kind this version does not
know), stops flashcards from loading at all. `store.ts` parses the rows again and claims a bad row "is skipped",
but that path never runs.

### Rule (written into `docs/contracts/sync/README.md`, "Reading rows")

1. **The pager checks the page envelope only:** the top-level members, `format`, `instanceId`, `until`, `scope`,
   `restarted`, `collections` (an object with exactly the requested keys, each an array), `more`/`next`/`cursor`.
   It never inspects a row. An envelope error still refuses the page (the round cannot be trusted).
2. **The consumer decodes each row** with the collection's decoder (typed rows: `study/rows.json`, strict;
   other collections: the `shapes` of `pull-page.json`). A row that does not decode is **unreadable**: it is
   skipped, counted per collection and reported; the other rows load. One bad row never blocks studying.
3. **An unreadable row is never rewritten or deleted by the client.** The client remembers the identity of every
   unreadable typed row whose identity member it can still read (`id`, `deckId`, the workspace row of `limits`,
   the one `fsrsActive` row). A write to that identity is refused with a message ("saved by a newer version of the
   app"); a new card never takes an id held by an unreadable row (the next free id is used); a deck delete does
   not tombstone an unreadable deck, its unreadable settings or limits (the existing "only tombstone what is
   stored" rule, now explicit). The row stays on the server byte for byte, so a newer client still reads it.
4. **Reporting:** the web counts unreadable rows per collection for each study load, logs one console warning
   (collection, count and identities only — never row data) and shows a notice on the study page: "N saved study
   items could not be read by this version of the app and were left out. They are kept unchanged; updating the
   app should show them."
5. The server still sends only rows that decode strictly (`pull-page.json`'s row cases stay invalid server
   output, checked by the Go page harness). The rule is for readers: a newer server or another client can still
   put a row in front of an older reader.

Ruling: the pager validates the envelope only; rows are the consumer's — why: the issue's recommendation; a row
shape belongs to the feature that reads it, and an envelope check is all a round needs to stay trustworthy —
cost if wrong: a consumer that forgets to decode reads junk; the store is the only consumer and decodes every
collection it uses.

Ruling: the strict decode stays strict (no lenient "best effort" card) — why: a guessed row could be written back
wrong and lose a newer client's data; skipping is reversible, guessing is not — cost if wrong: a row with a
harmless new member is hidden until the app updates (shown in the notice).

Ruling: writes to an unreadable identity are refused, not merged — why: the client cannot echo members it cannot
read; last-write-wins would replace the newer row — cost if wrong: the learner cannot change that deck's switches
or limits on this old app version until it updates (the message says so).

Ruling: a new card whose derived id is held by an unreadable row gets the next id (`<base>-<sentence>` or a ULID)
— why: never overwrite; the read-time duplicate merge (`canonical.json`) joins the two once the app can read both
— cost if wrong: one duplicate card row until then (merged at read time, reviews kept).

Ruling: unreadable keyed plugin rows (`pluginData` failing the row shape) are skipped and counted like typed rows;
keyed rows that decode keep their own contracts (goals keep unknown keys, `goals/`) — why: one rule for every
collection the study load reads — cost if wrong: none beyond the typed-row case.

Ruling: the duplicate parse goes: the pager loses `rowOk`'s typed branch and its own `TYPED` list; row shapes of
the other collections move to `sync/rows.ts` (`readableRow`), which uses `STUDY_COLLECTIONS` from `study/rows.ts`
— why: the issue; one decoder per collection — cost if wrong: none.

Ruling: `pull-page.json` keeps its row cases, marked `"level": "row"`: the Go harness still refuses them as server
output; the web contract test expects the envelope to decode and `readableRow` to refuse the row — why: one
fixture answers both "what may the server send" and "what does a reader do" — cost if wrong: a reader of the
fixture who ignores `level` refuses those pages (the README says what it means).

Fixture `docs/contracts/sync/unreadable-rows.json`: one page of the web's study collections for workspace 7 with,
per typed family, one readable row and one unreadable row, plus a row "from a newer client" (a card with a member
outside `extra` and a card of an unknown kind) and an unreadable `pluginData` row; `expect` lists the readable
identities per collection, the unreadable count per collection and the protected identities. Decoded by
`apps/web/src/lib/study/unreadable.contract.test.ts` (load through the store, writes refused) and by Go
`server/internal/study/rows` (`unreadable_contract_test.go`: each typed row decodes or fails `Decode`+`Validate`
exactly as the fixture says, so "unreadable" means the same thing on both sides).

## 2. Sign-out clears every per-user cache (#173)

### Problem

`auth.ts` `logout()` calls each cache's clear function by name and misses several (entries cache, starter and
level-deck caches, goals in flight, study history and study data caches, the weekly and milestone memos, …). A
load still in flight when the session ends can also store the previous user's answer after the clear. On a shared
device the next account can briefly see the previous one's data.

### Design

`apps/web/src/lib/session/sessionEnd.ts`:

- `onSessionEnd(fn: (reason) => void): () => void` — a module registers its clear function when its cache is
  created (module level). Registration order is call order; a throwing function is logged and the others still run.
- `endSession(reason: 'signOut' | 'expired' | 'switched')` — runs every registered function, then bumps the epoch.
- `sessionEpoch(): number` — a cache that stores after an `await` captures the epoch before and stores only if it
  is unchanged, so a load started by user A never lands in a cache after A's session ended.

Triggers (all in `auth.ts`): `logout()` → `signOut`; the 401 handler → `expired`; the signed-in user changing from
A to anything else without either (another tab signed in as B, a token swap) → `switched`. Every reason clears
every cache; only `signOut` also forgets the persisted workspace choice (unchanged: a mid-session 401 keeps it).

Registered (every module-level cache filled at runtime): `study/entriesCache` (`writtenByEntry`),
`features/flashcards/decks/starterDecks` (`cache`), `features/flashcards/decks/systemDeckItems` (`cache`,
`inflight`), `goals/loadGoal` (`inflight`), `study/history` and `study/studyData` (workspace caches),
`events` (`eventLog`), `weekly/replay` (`memo`), `weekly/summary` (`passes`), `milestones/reached` (`memo`),
`milestones/loadMilestones` (`lastFlush`, `lastPlace`), `plugins/journal/journalEntries` (`cache`),
`plugins/journal/providerNames`, `api/audio`, `audio/source` (clips, object URLs revoked), `api/entryBases`,
`api/schemes`, `api/characters`, `api/components`, `study/strokeData`, `study/frequencyRanks`, `study/scheduler`,
`study/limits` (`memo`), `study/store` (`pulledPages`, the unreadable-rows report), `study/recentSent` (`signOut`
only, as before), `time/zone` and `lookups/store` (the lookup buffer; it replaces auth's own user-change
subscription).

Ruling: register every runtime-filled module cache, content caches (characters, schemes, strokes, ranks)
included — why: "is this per user" is easy to get wrong (pack visibility, overlays applied server-side) and the
cost of clearing a content cache is one re-fetch after the next sign-in — cost if wrong: that re-fetch.

Ruling: in-memory caches register at module creation; persistent per-device state that is not keyed by user (the
workspace choice, Cache Storage API partitions, offline receipts) is cleared by `auth.ts` itself — why: a module
that was never loaded has an empty in-memory cache, but its disk state exists regardless — cost if wrong: none;
user-keyed storage (outbox, recently sent reviews, zone mirror) is never read for another user anyway.

Ruling: `auth.ts` imports no feature cache — only `session/sessionEnd`, the API client, `account/`, `i18n`,
`workspaces` (the device's choice), `pwa` partitions/receipts and `study/outboxUser` (the outbox's user follows
`auth`) — why: the issue; adding a cache must not need an edit in auth — cost if wrong: none.

Ruling: a lint test (`session/sessionCaches.lint.test.ts`) flags a module-level `new Map()`/`new Set()` without
initial values, a `create…Cache(` and a `let cache/memo/inflight/pending/loaded… =` in `src/lib` that is not in a
file calling `onSessionEnd(`, unless the allowlist names it with a reason (i18n/Intl formatter caches, listener
sets, constant tables) — why: the issue; a heuristic that catches the usual shape — cost if wrong: a cache of
another shape slips through (WeakMaps are not flagged: they hold nothing once the keyed arrays, owned by
registered caches, are dropped).

Ruling: the shared FNV-1a helper (optional in the issue) is not part of this change — why: it is a refactor of
pure functions with no user-visible effect and touches the milestone memo keys; it belongs with the
`study/store.ts` split listed after #166 — cost if wrong: three copies stay a while.

Service worker: API responses are cached in per-credential partitions (`qinqin-api-v1-` + SHA-256 of the
Authorization header, `pwa/sw/partition.ts`); sign-out deletes every API partition (`cleanupPartitions(…, null)`)
and a sign-in deletes every partition but its own. Verified by reading and by the existing tests
(`pwa/partitions.test.ts`, `sw/worker.test.ts`); the cross-user test below also asserts sign-out asks Cache
Storage to delete A's partition. Shell, font and stroke caches hold no user data.

Test (`session/signOutIsolation.test.ts`): sign in as A, fill every registered cache through its public reader
(the API answers A's data), start one more load of A that is still in flight, sign out, sign in as B (the API
answers B's data), read every cache again: every answer is B's, no A value is reachable, and the in-flight A
answer did not land.

## 3. The workspace is passed explicitly to every study write (#174)

### Problem

`createDeck`, `renameDeck`, `deleteDeck`, `deleteCards`, `restoreCards`, `moveCards`, `skipKind`, `unskipKind`,
`dropSiblingCards`, `saveDeckCardTypes`, `saveDeckCardTypesForDecks`, `saveDeckNewOrder`, `saveWorkspaceLimits`,
`saveDeckLimits` and `addCard` (optional) read `$workspaces.current` when they run (`requireWorkspaceId()`). A
workspace switch while a save waits for its pull writes the row into the other workspace.

### Design

- Every study write takes `workspaceId: number` as its **first** parameter (as `saveGoals`, `setKnownMark`,
  `saveParamSet` already do); `loadStudyData(workspaceId)` too. A non-positive or non-integer id throws before any
  request. `requireWorkspaceId()` is removed and `store.ts` no longer imports `workspaces` (a test pins that).
- `createCardActions` methods take the workspace first and the undo slot remembers it: an undo after a switch
  restores into the workspace the rows came from.
- Call sites pass the workspace of the data the user is looking at (the page's loaded workspace or
  `data.workspaceId`), captured when the user acts; a result that arrives after a switch does not update the new
  workspace's view.

Ruling: workspace first, required — why: one convention for every study write, a compile error at every call
site that forgot it, and #175 builds on stable signatures — cost if wrong: a large one-time test diff.

Ruling: components capture the workspace of the loaded data, not `$workspaces.current` at click time — why: the
deck or card the user clicked belongs to the data on screen; a switch can land between render and click — cost if
wrong: none (they are equal unless a switch raced).

Test per family (`study/store.workspace.test.ts`): start the write with the pull answer held back, switch the
selected workspace, release the answer: the pull asked for the original workspace and every pushed row carries
it. Families: decks (create, rename, delete), cards (delete, restore, move), word switches (skip, unskip, drop
siblings), deck settings (card types, card types for decks, new order), limits (workspace, deck), `addCard`.

## 4. Review fix wave

Ruling: add to deck (`decks/add-to-deck.json`) plans around unreadable rows instead of failing: a new card whose
derived id an unreadable card holds takes the next free id (`freshCardId`, exported from `study/store.ts`); the deck
row and the settings row of an unreadable identity are not written and are counted in `plan.unreadable`; cards still
join the target (its deck row exists on the server) — why: one unreadable card must not block a starter, level,
reader or lookup add — cost if wrong: words join a deck this version cannot show until it updates.

Ruling: the server-side twin is `study.ErrUnreadableStored` (an `*UnreadableStoredError` naming family, workspace and
identity, never the data). Reads skip and log it: the paged pull still moves its position past the row's rowid (and
reads the segment again when skips used up a query's rows), the legacy pull, `ListCards` and the legacy plugin-data
view skip it (a legacy GET of its key is 404, a leftover plugin row of the key stays hidden). A write onto it is
**409 `study_row_unreadable`** (`{error, message}`, in `auth/errors.json`): for `POST /api/sync/push` a read-only
pre-check refuses the whole push before anything applies, as for a malformed item; a legacy PUT or DELETE of its key
answers the same; an old shell's plugin-data push item of its key is `dataRefused` alone. The backup export still
fails on such a row — why: a reader must never be blocked by one row, a writer must never replace data it cannot
read, and a backup must never silently drop a row — cost if wrong: a backup of an account with such a row needs the
newer server.

Ruling: keyed plugin rows (goals, known marks, vacations) whose row shape or payload does not decode are protected by
key (`pluginData:<key>` in the snapshot); keyed writes check the last study load of their workspace (vacations:
user-global) — why: keyed writes are planned from that load and carry no snapshot — cost if wrong: a keyed write with
no study load before it is not checked.

Ruling: the batch card-type switch skips decks whose stored settings are unreadable, returns them in `unreadable`,
and the study page keeps their old state and says so; the single-deck write still refuses — why: one row must not
fail the Reverse switch for every deck — cost if wrong: none.

Ruling: an unreadable tombstone is protected but not counted (nothing to show); a row of another workspace is neither.

Ruling: the workspace list, the plugin states, the hook states, the shell notice, the offline counts and the
journal editor's sent events reset at the session end, and the loads of the workspace list, the plugin states, the
study data report and the milestones' flush place drop an answer of an ended session (`sessionEpoch`).

Ruling: the cache lint matches each declaration name to a clear inside an `onSessionEnd` callback (following the
same-file functions it calls, two levels), also flags module stores and runes and empty `[]` / `{}` literals, and
scans `<script module>` of Svelte files and `src/routes`; what is not per-user data is allowlisted with a reason.

Ruling: forms save to the workspace they were loaded for (`loadedWorkspace`, set together with the form state) and
drop a late answer of a workspace no longer selected; the deck list reloads the workspace it wrote only while it is
still shown (reloading the old one would put its decks under the new selection).
