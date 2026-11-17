# Weekly milestones with a stored seen state — design (issue #94, from #81)

Status: Draft (2026-11-16), v0.4.0 prep item 7. Written unattended; every non-obvious call is a **Ruling**
(`what — why — cost if wrong`). Nothing is built. **Depends on** item 4 (flashcards and reader are core;
`qinqin-flashcards` stays the plugin-data namespace of the keyed study rows), item 5 (pull v2 pages
`pluginData`), item 6 (the `read` and `journal` event payload contracts), the weekly summary
(`docs/contracts/weekly/`, `lib/weekly/replay.ts` timelines), the learner's day (`study-day/`), vacation and the
streak (`scheduler/`), mature (`decks/`), character mastery (Stats → Characters) and the level deck ids
(`decks/system-deck-ids.json`).

**Re-read 2026-11-17 against the built items 4 and 5** (collection branch `feature/v0.4.0-prep-2`, migrations up to
`039_packages.sql`). The design stands; what changed is recorded inline as **Adaptation** notes and in the plan's
Execution record. Summary: item 4 kept `goals:workspace`, `known:*` and `vacation:*` as keyed `qinqin-flashcards`
plugin rows and typed only the six study collections, so the storage ruling below holds unchanged; the push helper is
`pushKeyedRows` (private in `study/store.ts`), not `pushStudyRows`; the study pull is item 5's paged pull v2
(`V2_STUDY_COLLECTIONS` includes `pluginData`, `tombstones=1`); the level helpers live in
`lib/features/flashcards/decks/systemDecks.ts`; the journal is the plugin `qinqin-journal` (not a core feature).
Item 6 pins the payloads this design reads: `read` = `{bookId, seconds}`, `journal` = `{entryId: string}`.

## Intent

The weekly summary (#81) deferred milestones by ruling: "first 100 words", "1,000 reviews", streak lengths and
level completions, shown once and then kept in a history list, need a stored per-user seen state. This item adds
exactly that: milestones are **derived from the event log and the replay** (nothing about them is computed on the
server or stored as a statistic); only the fact "the learner has seen milestone X" is stored, as synced, backed-up
plugin rows with a contract Android can follow.

## Goals and non-goals

- A fixed, versioned **catalogue** of milestone ids, stable across clients and releases.
- A **reached rule**: for each id, whether and when (instant and learner day) the learner crossed it.
- A **seen state** that syncs, backs up, restores with remapped workspaces and can never "unsee" across devices.
- A **shown-once card** on home and on Stats → Week; a **history list** on Stats → Week; the week's own milestones
  in the week's summary.
- Contract `docs/contracts/milestones/` (README + fixtures) decoded by web tests; one backup remap case decoded
  by the existing Go test.
- **No server production change, no new route, no migration, no token rule change.**
- Non-goals: notifications, email, sounds or confetti, sharing, "next milestone" progress bars, account-wide
  (all-workspace) milestones, a reset/"unsee" action, milestones for plugin activity types other than journal.

## Questions and answers

**Per workspace or per user?** Per workspace, stored per user.

Ruling: every milestone belongs to one workspace (its reviews, cards, levels, reading and journal events) and its
seen rows are workspace rows — the summary, the decks view and the goals are per workspace; "100 Chinese words" and
"100 Japanese words" are different achievements; workspace rows are deleted with the workspace and remapped by the
backup for free — cost: a learner with two workspaces sees "1,000 reviews" twice (once per language) and never a
combined total.

**The catalogue.** Families in this fixed order (the order breaks ties in lists):

| Family | Id | Thresholds | Quantity (all over workspace `w`, events with `ts ≤ now`) |
| --- | --- | --- | --- |
| `reviews` | `reviews:<n>` | 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000 | valid reviews (`isValidReview`) of the local log (outbox included), any card, deleted cards included |
| `words-studied` | `words-studied:<n>` | 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000 | distinct entries of live vocab cards in an existing deck with at least one valid review |
| `words-mature` | `words-mature:<n>` | 10, 50, 100, 250, 500, 1000, 2500, 5000 | live vocab cards in an existing deck whose replayed schedule is mature (`classifySchedule`) |
| `characters-learned` | `characters-learned:<n>` | 10, 50, 100, 250, 500, 1000, 2000, 3000, 5000 | Han languages only: universe cells learned (`cellStates`, score ≥ `MASTERY_THRESHOLD`) |
| `streak` | `streak:<n>` | 3, 7, 14, 30, 60, 100, 180, 365, 500, 730, 1000 | the vacation-neutral daily review streak (`dailyStreak` rule), any run |
| `days-active` | `days-active:<n>` | 10, 30, 50, 100, 200, 365, 500, 1000 | non-vacation learner dates with a valid review, a counted `read` event (`readSeconds > 0`) or a counted `journal` event (string `entryId`) |
| `reading-hours` | `reading-hours:<n>` | 1, 5, 10, 25, 50, 100, 250, 500, 1000 | `readSeconds` of `read` events summed (the heatmap's clamping: < 30 s is 0, at most 2 h per event); `bookId` is not read |
| `journal-entries` | `journal-entries:<n>` | 1, 10, 25, 50, 100, 250, 365, 500 | distinct **string** `entryId` of `journal` events |

Adaptation (item 6 payloads): `read` is `{bookId, seconds}` and `journal` is `{entryId: string}`; the payloads are
read through item 6's `lib/eventPayloads.ts` parsers, the seconds clamped by `readSeconds`
(`lib/stats/readingTime.ts`).
Ruling: a `read` event counts by its seconds alone, also when `bookId` is missing — a restore drops `bookId` when
the book is not in the backup (`backup/remap.go`, `remap.json` "unknown book removed"), and the heatmap and the
reading totals still count that time — cost: none (the book is never named by a milestone).
Ruling: a `journal` event whose `entryId` is not a string (number, missing, empty) counts for nothing, neither for
`journal-entries` nor for `days-active` — the heatmap's `distinctBy: "entryId"` rule counts text values only
(`stats/activity.go`), so a numeric id would make "days active" disagree with the heatmap — cost: an old client
that posted numeric ids gets no milestone for those entries.
| `level-complete` | `level-complete:<levelDeckId>` | one per level of each installed scheme of the workspace language | every member learned at one instant (below) |

`<n>` is decimal without leading zeros; `<levelDeckId>` is the decks contract's `ownedLevelDeckId(packId, level)`
(`d-lvl-<slug(packId)>-<fnv1a32(packId NUL level)>`), already pinned by `decks/system-deck-ids.json`.

Ruling: ids are `<family>:<threshold>` and are never renamed or removed; a later release may only append
families or thresholds — a seen row is keyed by the id, so a renamed id would show a milestone twice — cost: a
threshold we regret stays for ever (it can be hidden from lists, never re-used).
Ruling: the level id reuses the level deck id instead of `packId:levelName` — a stable, server-independent,
fixture-pinned function that both clients already implement; no free text in a key — cost: the id is opaque in
the database.
Ruling: no `reviews:1` / "first review" milestone, but `journal-entries:1` exists — a first review happens in
the first minute of using the app (a card for it is noise), a first journal entry is a deliberate act — cost: none.
Ruling: families follow the feature switches: with flashcards switched off (item 4) the review, word, character,
streak and level families are neither computed nor shown; with the reader off `reading-hours`; with the journal
plugin off `journal-entries`; `days-active` always — a milestone for a feature the learner switched off is
noise; their seen rows stay untouched — cost: switching a feature back on can surface a catch-up card (below).
Adaptation (item 4): the switches are read from the `pluginStates` store — flashcards and the reader with
`featureEnabled(FLASHCARDS_ID | READER_ID, list)` (`lib/features/index.ts`), the journal, which stays a plugin
(`qinqin-journal`), with `pluginEnabled('qinqin-journal', list)` (`lib/plugins/index.ts`).
Ruling: milestones are computed only when the plugin states are `ready`; while `idle`, `loading` or `error` no card
is shown and the history lists only seen rows — a missing state row reads as "on", so computing early would flash a
card of a switched-off feature (the same reason `featureWidgets` shows nothing before the states load) — cost: no
card while the states are unavailable (offline start without a cached answer).
Ruling: other plugin activity types never form or feed families, also not `days-active` — Android cannot
compute arbitrary plugin rules from the log, and the activity route (366-day cap) cannot give all-time totals —
cost: grammar practice does not move "days active" here although it does in the week's "Days active" line.

**What counts as "learned" for a level?** Every member, at the same instant.

- Character scheme (`unit: "character"`): every cell of the level's section is learned — the levels' "L of N
  learned" (`levelMastery`: `buildSections`, `cellStates`, variants included) reaches N with N > 0.
- Word scheme (`unit: "word"`): every member entry (`levelItems`) has a live vocab card whose schedule is mature —
  the level deck's word states all "Mature".

Ruling: complete means learned, not studied — reviewing every word once is a weekend of clicking; the level views
already define and show "learned" / "Mature", so the milestone agrees with what the learner sees — cost: large
word levels (HSK 6) complete rarely; a "studied every word" tier can be appended later as a new family.
Ruling: manual known marks (`known:*`) never count — milestones celebrate study; a learner could otherwise mark a
level known in one click — cost: a learner who knew the words before qinqin does not get the level.
Ruling: the level members are today's (installed pack, current members); a pack update that adds members can make
an unseen completion disappear — cost: as the weekly "today's cards" ruling; a seen one stays in history.

**When is a milestone reached?** At the first event at which its quantity, applied in event order, reaches
the threshold.

- Events are ordered by instant (`ts`), ties by event id. For counts (reviews, words studied, reading, journal,
  days active) the quantity only grows; for states (mature words, characters learned, level complete) the
  running value is replayed from each card's timeline (`scheduleTimeline` points; a card's state changes only at
  its reviews) and the milestone is reached the first time the running value reaches the threshold.
- `reachedAt` = that event's instant; `reachedDay` = `dayOf(reachedAt)` (the learner's zone history). For
  `streak:<n>` the reached day is the date on which a run first reached `n` days and `reachedAt` is the first
  counting review of that date. Events after `now` (a fast device clock) are ignored, as `dailyStreak` does.

Ruling: "ever reached" (historical maximum), not "currently true" — a word level completed in March and one word
lapsed in April was still completed; the history must not flicker — cost: a milestone can show while the decks
view currently shows 499 mature words.
Ruling: the scopes are today's live cards and decks (as the weekly summary and the decks view); a deleted card's
contribution vanishes from the derivation — one definition of "word" everywhere — cost: deleting cards can
un-reach an **unseen** milestone (it is simply not shown); a seen one keeps its stored row and date.
Ruling: reviews count every valid review (deleted cards included), unlike the word families — a review happened
whatever became of its card, as on the heatmap — cost: none.
Ruling: days active leaves vacation dates out, like the week's "Days active" — one meaning across the app; vacation
is neutral — cost: reviews done on vacation do not move the milestone.

**Where is the seen state stored?** One keyed plugin row per seen milestone, in the study namespace.

Row: plugin `qinqin-flashcards`, workspace `w`, key `milestone:<id>`, data
`{version: 1, id: "<id>", seenAt: RFC 3339, reachedDay: "YYYY-MM-DD", ...unknown kept}`.

Ruling: one row per milestone, not one row holding a set — two devices writing different keys never conflict
under the existing LWW (overview "Sync model"), so the union is the storage itself; writing the same key twice
only changes `seenAt`; no read-merge-write, no server merge rule, nothing new for Android's sync engine — cost:
up to ~80 small rows per workspace instead of one (negligible for pull pages and backups).
Ruling: a keyed row under `qinqin-flashcards`, not a typed core table — item 4 typed exactly the six families the
owner named and kept rows that have a contract and a fixture (`goals:workspace`, `known:*`, `vacation:*`) keyed
in the study namespace; a typed table would need a migration, a pull collection, a push array and a round-order
change in item 5 for a write-once flag — cost: the server does not validate the shape (as for goals).
Adaptation (items 4 and 5, checked): the built code matches this ruling — `docs/contracts/overview.md` "Keyed
rows" lists `goals:workspace`, `known:*` and `vacation:*` as `qinqin-flashcards` plugin data, `study/store.ts`
parses them from the pull's `pluginData` and writes them with `pushKeyedRows` / `putData`; `milestone:` is no
`legacyFamily` prefix (`card:`, `deck:`, `deckcfg:`, `limits:*`, `fsrs:*`), so the server's legacy view never
routes it to a typed table and `assertKeyedRow` accepts it. No migration (the next free number, 040, stays unused),
no pull collection, no change to item 5's round order.
Ruling: **seen is decided by the key alone**: a live row `milestone:<id>` means seen, whatever its data (another
version, a mismatching `id`, a missing `reachedDay`); data is only read for the history date; a row is never
rewritten once live and never deleted by any client — the only way to "unsee" is a tombstone, which no client
writes — cost: a corrupt row cannot be repaired from the UI (it still means "seen", the safe side).
Ruling: `reachedDay` is a snapshot taken when the milestone is marked seen and the history shows it — the history
stays stable when cards are deleted or packs change — cost: a day derived from a since-changed log can be stale.
Ruling: rows of ids this client does not know (a newer Android catalogue) are kept and counted as seen but not
listed — a client cannot title them — cost: the history differs between an old and a new client.

**Sync, offline and "never unsee".** Rows travel as ordinary plugin data: push `pluginData` items
(`POST /api/sync/push` through `study/store.ts`'s `pushKeyedRows`, which known marks use), pull v2 `pluginData`
pages (item 5's `pullStudy`: `V2_STUDY_COLLECTIONS`, `tombstones=1`, so a tombstone arrives and reads as "not
seen"), the legacy pull for old shells. Dismissing writes the rows of every listed milestone whose key is not
already live; `dataSkipped` for a row means another device wrote it first and counts as success.
Adaptation (item 4 push): `pushChunks` reports a skipped or refused item, and also a network failure, as
`PartialPushError` (`skipped` = `dataSkipped + dataRefused`, 0 for a failed request) and stops after the first
partial chunk.
Ruling: `saveSeenMilestones` sends every row in one chunk (`chunk: rows.length`; the catalogue plus the level ids
stay far below the 256 KiB item and body limits); `PartialPushError` with `skipped > 0` is success (skipped: written
elsewhere; refused: retrying cannot help, the flashcards namespace is always known), with `skipped === 0` it is a
failure and the ids stay pending — cost: a refused row is lost for other devices (the card may show there once). Offline (or a failed push) the ids go into a per-user, per-workspace pending list in
`localStorage` (`qinqin:milestones-pending:<userId>:<workspaceId>`, read and written in `try/catch`); seen =
live rows ∪ pending; the pending list is flushed on the next load and on `online`, and an id leaves it once its row
is live in a pull.
Ruling: a local pending list instead of an outbox v3 — plugin rows have no outbox today, the seen flag is
idempotent and harmless to lose (the worst case is the card shown once more on that device) — cost: in a private
window that blocks storage an offline dismiss is forgotten on reload.
Ruling: "shown once" is per account eventually, not instantly — a second device that loads before the first device's
push arrives may show the same card; whoever dismisses second writes a key that is already live (skipped) — cost:
the same milestone can be shown once per device in a race.

**What is shown, and when?** `unseen` = reached milestones of enabled families whose id is not seen, newest first.

- `none`: nothing unseen — no card.
- `recent`: at most three unseen, each with `reachedDay ≥ today − 6` — one card "Milestone reached" (or "3
  milestones reached") naming each with its day.
- `summary`: otherwise (a first run with history, a long offline stretch, a newly added catalogue entry, a feature
  switched back on) — one card "You have reached 14 milestones" naming the three newest and "and 11 more", with a
  link "See all milestones" to `/stats/week#milestones`.
- **Dismiss marks every milestone the card covered** (all unseen at render time), never only the named ones.
  Following the card's link marks them too. Nothing else marks: not scrolling past, not opening the tab.

Ruling (backfill): an existing user's first load shows one `summary` card, not silence and not twenty cards — the
learner discovers the feature and their record in one glance and one dismiss; marking silently would hide earned
achievements, one card each would be a wall — cost: every existing user sees one card per workspace once.
Ruling: one card at a time, never a toast — a toast that disappears by itself fails WCAG 2.2.1 for slow readers and
cannot be "seen" reliably; the card waits until dismissed — cost: an ignored card stays on top of home.
Ruling: the card is not a home widget — a stored layout would hide it for every learner who arranged home
(`DEFAULT_LAYOUT` ruling of #67) — cost: it pushes the widgets down while it is there.

**Where does the card appear, and what does each place compute?**

- Home (current workspace, above the widgets): the **log families** only (reviews, words studied, streak, days
  active, reading, journal) — one pass over the cached study history and event log, no replay.
- Stats → Week (above the summary): every family — the replay families reuse the week tab's timelines
  (`timelinesFor`, memoised by `reviewsKey`), the characters and levels use the universe the tab already loads.

Adaptation (built Week tab): the tab loads the timelines in `loadWeek({detail: true})` and the character universe in
`loadWeekCharacters` (`loadCharacterMapData`, cards resolved by `withLegacyWritten`); both call `timelinesFor`,
memoised by `reviewsKey`. It does **not** load levels: the Week scope of `loadMilestones` adds `getSchemes()`,
`levelDecks(schemes, language)` and the members (`getSchemeEntries` for word levels, `fetchSchemeCharacters` for
character schemes, both cached in `lib/api/schemes.ts`).
Ruling: replay families (mature, characters, levels) are detected on Stats → Week only — home already pays the
due-count replay and must not add the 13 000-row character universe and a second replay to every load — cost: a
"500 mature words" card first appears when the learner opens Stats → Week, not on home.

**The history list** (Stats → Week, section `#milestones`, heading "Milestones"): every seen milestone (stored
`reachedDay`, falling back to the derived day, then to `seenAt`'s learner day) plus every unseen reached one
(derived day, marked "New"), newest day first, ties by catalogue family order, then higher threshold first. The
week's summary gains a "Milestones" line listing the history items whose day lies in the shown week (browsable
with the week links). Empty state: "No milestones yet."

**Accessibility.** The card is a `<section aria-labelledby>` with an `h2`, inside a `role="status"` container so a
card that appears after loading is announced politely once; the decorative icon is `aria-hidden`; the dismiss
button reads "Dismiss" with `aria-describedby` on the card heading; after dismiss focus moves to the page's main
heading (`h1`), never to `<body>`. No animation, no sound, no colour-only meaning. The history is an `<ol>`; each
item's text is the title and the date ("1,000 reviews, reached 3 November 2026"), "New" is text, not a colour.
Dates use `Intl.DateTimeFormat` with `timeZone: 'UTC'` on the civil date (the weekly ruling). Every string lives in
one pure module (`milestoneText.ts`) so item 8's catalogues pick them up.

**Performance.** The log pass is one walk over the reviews and the events (memoised per `reviewsKey` and the
event log array, four entries). The replay sweep merges the timeline points of the workspace's cards in instant
order once per timelines object and updates only the cards' own entries and glyphs (incremental counters per
family, per level and per cell), O(points × levels containing the entry). Perf guard: 5 000 cards and 50 000 reviews,
the Week tab's milestones add no `scheduleTimeline` call after `loadWeek({detail: true})` and the sweep stays under
2 s locally.

**Backup and restore.** Plugin rows are exported generically (`plugin-data/NNNNNN.jsonl`, one
`{pluginId, workspaceId|null, key, data, version, updatedAt, modifiedAt|null}` per line) and restored with their
workspace remapped (`backup/remap.go` "every other row is restored as it is"); milestone ids contain no entry,
card or workspace id, so nothing else needs remapping. A `pluginRow` case in `backup/remap.json` pins this
(`{name, op: "pluginRow", maps: {workspaces}, input: {pluginId, workspaceId, key, data}, expect: {drop,
workspaceId, key, data}, note}`; Go `backup/remap_test.go` already decodes it). Tombstones are not exported (as for
every plugin row). A restored `read` event of an unknown book loses `bookId` and keeps its seconds (counted, above).

**Android.** Reads and writes `milestone:*` rows in `pluginData` of `qinqin-flashcards` (never through a typed
collection), implements the catalogue, the reached rule (fixtures give timelines as schedules, so FSRS parameters
do not matter), the seen rule (key alone, never delete, write only absent keys, `dataSkipped` is success) and the
card plan. Its local database plays the role of the pending list. Adaptation (item 5): Android reads the level
members from the `levels.<packId>` data packages (`packages/README.md`); the `packId` there is the one
`ownedLevelDeckId` hashes. It reads `pluginData` from pull v2 and never uses the legacy view.

## The pure interface

`apps/web/src/lib/milestones/`: `catalogue.ts` (families, ids, parse), `reached.ts` (log families),
`replayReached.ts` (sweeps over `Timelines`), `seen.ts` (row parse, write plan, pending list), `plan.ts` (card plan,
history, week items), `milestoneText.ts` (strings), `loadMilestones.ts` (the only I/O). `study/store.ts` gains the
`milestone:` row parse in `fetchStudyData` (beside `GOALS_KEY` and `KNOWN_PREFIX`) into `StudyData.seenMilestones`,
passed through `loadStudyDataWith` into `StudyHistory`, and the exported `saveSeenMilestones` (on `pushKeyedRows`).
Thin components: `MilestoneCard.svelte`, `MilestoneHistory.svelte`; the home page (`routes/+page.svelte`), the Week
page (`routes/stats/week/+page.svelte`) and `lib/weekly/WeekSummary.svelte` render them. Reused helpers and their
real homes: `isValidReview`, `scheduleTimeline`, `scheduleAt` (`study/scheduler.ts`); `classifySchedule`
(`stats/wordStates.ts`); `MASTERY_THRESHOLD`, `masteryFromSchedules` (`study/mastery.ts`); `cellStates`,
`buildSections`, `masteryGlyphs` (`study/charGroups.ts`); `levelMastery` (`study/levelMastery.ts`); `readSeconds`
(`stats/readingTime.ts`); `vacationRuns`, `isVacationDay` (`study/vacation.ts`); `dailyStreak` (`study/exp.ts`);
`levelDecks`, `levelItems`, `ownedLevelDeckId` (`features/flashcards/decks/systemDecks.ts`); `timelinesFor`,
`reviewsKey`, `givenTimelines`, `replayStats` (`weekly/replay.ts`); `loadStudyHistory` (`study/history.ts`);
`loadWorkspaceEvents` (`lib/events.ts`).

## Contract fixtures (`docs/contracts/milestones/`)

- `catalogue.json` — families in order, thresholds, units, required feature, Han-only flag, id grammar, the level
  id example (`ownedLevelDeckId`) and English titles (`{n}` placeholders; item 8 replaces them with keys).
- `reached.json` — inputs (zone history, now, vacation runs, reviews, events, cards, decks, timelines as
  `{ts, state, stability}`, chars, levels, enabled families), expect `[{id, reachedAt, reachedDay}]`; cases for each
  family's exact crossing, a crossing at a zone change, tie `ts`, a fast-clock event, a vacation gap in a streak, a
  vacation day not counted as active, read clamping, a `read` event without `bookId` (restored, unknown book)
  that still counts, distinct journal entries, a numeric `entryId` that counts for nothing (neither journal nor
  days active), a mature lapse that stays reached,
  a deleted card, a card in no deck, a word level and a character level (variant cell), a non-Han language.
- `seen-rows.json` — row parse: live = seen, tombstone = not seen, other version / mismatched id still seen, unknown
  id kept and unlisted, invalid `reachedDay` falls back.
- `seen-merge.json` — two devices: union of keys, the same key twice, the write plan (only absent keys), pending ∪
  live, `dataSkipped` as success, pending pruned when live.
- `show-plan.json` — `none` / `recent` / `summary` cases (backfill of 20, one old milestone, four recent), the ids
  marked, the history ordering and the week's items.

Decoded by `lib/milestones/*.test.ts`; `docs/contracts/README.md` gains the folder row; `overview.md` gains the
`milestone:<id>` row in "Row-key conventions → Keyed rows", the `milestones/` folder in "How the folders fit" and a
"Study rules (links)" line; the "Keyed rows" sentence in "Sync model" (`goals:workspace`, `known:*`, `vacation:*`)
gains `milestone:*`. `contractsDocs.test.ts` checks the folder rows.

## Risks

- A catalogue mistake is permanent (ids never change); review the table before Task 1 is committed.
- The incremental character sweep is the most error-prone part; it is tested for equality with a snapshot
  recomputation at every point (Task 4).
- A learner who never opens Stats → Week never sees replay-family cards (the history still lists them there).
