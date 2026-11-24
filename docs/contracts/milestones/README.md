# Milestones contract: catalogue, reached rule, seen rows, card plan

Issue #94 (weekly milestones, from #81). Design: `docs/superpowers/specs/2026-11-16-v040p-milestones-design.md`.
Every client (web, Android) implements these rules and runs the fixtures in this folder. Fixtures win over code.
Fixture format: see `docs/contracts/README.md`.

Milestones ("1,000 reviews", "a 7-day streak", "HSK 1 complete") are **derived** from the event log and the
schedule replay of one workspace, every time they are shown. Nothing about them is computed on the server or
stored as a statistic. The only stored state is the fact "the learner has seen milestone X": one keyed row per
seen milestone. **The summary card stores nothing; the seen rows are the only state.**

Builds on: the learner's day (`study-day/`), review validity and order (`events/review-parse.json`), the `read`
and `journal` payloads (`events/payloads.json`), vacation runs and the streak rule (`scheduler/`), mature
(`decks/`, stability ≥ 21 in review), character mastery and cells over variant glyphs (`decks/char-mastery.json`),
the level deck ids (`decks/system-deck-ids.json`), the weekly summary's replay timelines (`weekly/`).

Owner code (web): `apps/web/src/lib/milestones/` (`catalogue.ts`, `reached.ts`, `replayReached.ts`, `seen.ts`,
`plan.ts`, `milestoneText.ts`, `loadMilestones.ts`), `apps/web/src/lib/study/readModel.ts` and `apps/web/src/lib/study/commands/keyed.ts` (row parse,
`saveSeenMilestones`). No server code: the rows are ordinary keyed rows (`keyed/`).

## Fixtures

- `catalogue.json` — families in order with thresholds, unit, required feature, Han-only flag and source, the id
  grammar, English titles (`{n}`, `{level}`; interface-string keys come with item 8), and cases: `id` (build an
  id), `parse` (an id or `null` = unknown to this client), `enabled` (families per feature switches), `order`
  (list order), `title`. Decoded by `apps/web/src/lib/milestones/catalogue.test.ts` and `milestoneText.test.ts`.
- `reached.json` — cases `{name, note, history, now, language, vacation, enabled, reviews, events, cards, decks,
  timelines, chars, levels, expect}`: the zone history, `now`, the vacation runs of the workspace, the feature
  switches (`{flashcards, reader, journal}`), the review events (after the canonical merge), the other events,
  the live cards and the existing deck ids (`general` always exists), each card's replayed schedule after each
  of its reviews (`{ts, state, stability}`, so FSRS parameters do not matter), the character universe (`null` =
  none) and the levels (`{packId, level, unit, entryIds | cells, deckId}`; `cells` = each cell's glyph forms).
  `expect` lists **every** reached id of the enabled families with `reachedAt` (RFC 3339 UTC) and `reachedDay`,
  by `reachedAt`, ties in catalogue order; a missing or an extra id is a failure. Decoded by `reached.test.ts` (log families) and `replayReached.test.ts`
  (replay families).
- `seen-rows.json` — pulled rows and what is seen (`seen`: id → `{seenAt, reachedDay}`) and listed. Decoded by
  `seen.test.ts`.
- `seen-merge.json` — two devices (`union`), the write plan of a dismiss (`writePlan`), seen = live ∪ pending
  (`seen`), the push answer (`push`), pruning the pending list (`prune`). Decoded by `seen.test.ts`.
- `show-plan.json` — the card plan (`card`), the history list (`history`) and the week's items (`week`).
  Decoded by `plan.test.ts`.
- `backup/remap.json` — two `row` cases (`milestone:reviews:1000`, `milestone:level-complete:<id>`):
  restored with the workspace remapped, key and data unchanged. Decoded by `server/internal/backup/remap_test.go`;
  `server/internal/backup/milestones_test.go` exports and restores a seen row end to end.

## The catalogue

Families in this fixed order (the order breaks ties in lists):

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
| `level-complete` | `level-complete:<levelDeckId>` | one per level of each installed scheme of the workspace language | every member learned at one instant (below) |

`<n>` is decimal without sign or leading zeros and must be one of the family's thresholds; `<levelDeckId>` is the
decks contract's `ownedLevelDeckId(packId, level)` (`d-lvl-<slug(packId)>-<fnv1a32(packId NUL level)>`), pinned by
`decks/system-deck-ids.json`. Anything else parses as unknown (`null`).

- Ruling: ids are `<family>:<threshold>` and are never renamed or removed; a later release may only append
  families or thresholds — a seen row is keyed by the id, so a renamed id would show a milestone twice — cost: a
  threshold we regret stays for ever (it can be hidden from lists, never re-used).
- Ruling: the level id reuses the level deck id instead of `packId:levelName` — a stable, server-independent,
  fixture-pinned function that both clients already implement; no free text in a key — cost: the id is opaque in
  the database.
- Ruling: no `reviews:1` / "first review" milestone, but `journal-entries:1` exists — a first review happens in
  the first minute of using the app (a card for it is noise), a first journal entry is a deliberate act — cost:
  none.
- Ruling: a `read` event counts by its seconds alone, also when `bookId` is missing — a restore drops `bookId` when
  the book is not in the backup (`backup/remap.go`, `remap.json` "unknown book removed"), and the heatmap and the
  reading totals still count that time — cost: none (the book is never named by a milestone).
- Ruling: a `journal` event whose `entryId` is not a string (number, missing, empty) counts for nothing, neither
  for `journal-entries` nor for `days-active` — the heatmap's `distinctBy: "entryId"` rule counts text values
  only (`stats/activity.go`), so a numeric id would make "days active" disagree with the heatmap — cost: an old
  client that posted numeric ids gets no milestone for those entries.
- Ruling: families follow the feature switches: with flashcards switched off the review, word, character,
  streak and level families are neither computed nor shown; with the reader off `reading-hours`; with the
  journal off `journal-entries`; `days-active` always (and it still counts reviews) — a milestone for a
  feature the learner switched off is noise; their seen rows stay untouched — cost: switching a feature back on
  can surface a catch-up card (below).
- Ruling: milestones are computed only when the feature switches are loaded (web: `features.status ===
  'ready'`); before that no card is shown and the history lists only seen rows — a missing state row reads as
  "on", so computing early would flash a card of a switched-off feature — cost: no card while the states are
  unavailable (offline start without a cached answer).
- Ruling: other activity types never form or feed families, also not `days-active` — a client cannot
  compute arbitrary rules from the log, and the activity route (366-day cap) cannot give all-time totals —
  cost: grammar practice does not move "days active" here although it does in the week's "Days active" line.

## When is a milestone reached?

At the first event at which its quantity, applied in event order, reaches the threshold.

- Events (reviews, `read`, `journal`) are ordered by instant (`ts`), ties by event id; events with `ts > now`
  (a fast device clock) are ignored. Other event types are never read. For counts (reviews, words studied,
  reading, journal, days active) the quantity only grows.
- For states (mature words, characters learned, level complete) the running value is replayed from each card's
  timeline (its schedule after each of its valid reviews; a card's state changes only at its reviews). All
  points at one instant are applied together, then the thresholds are checked: the running value at instant
  `t` equals a snapshot of every card's last point with `ts ≤ t`. The milestone is reached at the first such
  instant at which the value reaches the threshold.
- `reachedAt` = that event's instant; `reachedDay` = `dayOf(reachedAt)` (the learner's zone history).
- `streak:<n>`: the review dates (learner days with a valid review, vacation dates left out) form runs; a run
  continues from date `d` to the next review date `e` when the nearest non-vacation date before `e` is `d`
  (`dailyStreak`). The reached day is the date on which a run first reached `n` days; `reachedAt` is the first
  valid review of that date.
- `days-active`: a date counts once, when it is not a vacation date and has a valid review, a `read` event with
  `readSeconds > 0` or a `journal` event with a non-empty string `entryId`.
- `reading-hours:<n>`: reached when the running sum of `readSeconds` is at least `n × 3600`.
- Mature: `classifySchedule` = review state (2) and stability ≥ 21 days. Scope: live vocab cards with at least one
  existing deck (a card in no existing deck, a reverse card, a deleted card never count).
- Characters: the universe cells of the workspace language (`chars`); a glyph's score is the rounded mean of the
  per-card strength (`decks/char-mastery.json`) over the cards of the mastery kinds (vocab, sentence, writing,
  tone; never reverse or cloze) whose written form contains it and that have a schedule; a cell's score is the
  maximum over its glyph and its variant forms; learned = score ≥ 80. All live cards count, as on the character
  map (no deck scope).

- Ruling: "ever reached" (historical maximum), not "currently true" — a word level completed in March and one
  word lapsed in April was still completed; the history must not flicker — cost: a milestone can show while the
  decks view currently shows 499 mature words.
- Ruling: the scopes are today's live cards and decks (as the weekly summary and the decks view); a deleted
  card's contribution vanishes from the derivation — one definition of "word" everywhere — cost: deleting cards
  can un-reach an **unseen** milestone (it is simply not shown); a seen one keeps its stored row and date.
- Ruling: reviews count every valid review (deleted cards included), unlike the word families — a review happened
  whatever became of its card, as on the heatmap — cost: none.
- Ruling: days active leaves vacation dates out, like the week's "Days active" — one meaning across the app;
  vacation is neutral — cost: reviews done on vacation do not move the milestone.

## What counts as "learned" for a level?

Every member, at the same instant.

- Character scheme (`unit: "character"`): every cell of the level's section is learned — the levels' "L of N
  learned" (`levelMastery`: `buildSections`, `cellStates`, variants included) reaches N with N > 0.
- Word scheme (any other unit): every member entry (`levelItems`) has a live vocab card in an existing deck whose
  schedule is mature — the level deck's word states all "Mature". A level with no members is never complete.

- Ruling: complete means learned, not studied — reviewing every word once is a weekend of clicking; the level
  views already define and show "learned" / "Mature", so the milestone agrees with what the learner sees — cost:
  large word levels (HSK 6) complete rarely; a "studied every word" tier can be appended later as a new family.
- Ruling: manual known marks (`known:*`) never count — milestones celebrate study; a learner could otherwise mark
  a level known in one click — cost: a learner who knew the words before qinqin does not get the level.
- Ruling: the level members are today's (installed pack, current members); a pack update that adds members can
  make an unseen completion disappear — cost: as the weekly "today's cards" ruling; a seen one stays in history.

## The seen rows

Row: keyed row (`keyed/`), workspace `w`, key `milestone:<id>`, data
`{version: 1, id: "<id>", seenAt: RFC 3339, reachedDay: "YYYY-MM-DD", ...unknown kept}`.

- **Seen is decided by the key alone**: a live row `milestone:<id>` means seen, whatever its data (another
  version, a mismatching `id`, a missing `reachedDay`); data is only read for the history date (`seenAt` a
  non-empty string, `reachedDay` a real date, else `null`). A tombstone (`deletedAt` set) is not seen.
- A dismiss writes the rows of every covered milestone whose key is not already live (`writePlan`), never a
  tombstone, never a rewrite of a live row. No client deletes a `milestone:` row. A key the pull showed as a
  tombstone is written with that tombstone's newest stamp (`knownAt`, as for known marks) and stamped after it,
  so last-write-wins does not skip it.
- Rows of ids this client does not know (a newer catalogue) are kept and counted as seen but not listed.

- Ruling: one row per milestone, not one row holding a set — two devices writing different keys never conflict
  under the existing LWW (overview "Sync model"), so the union is the storage itself; writing the same key twice
  only changes `seenAt`; no read-merge-write, no server merge rule, nothing new for Android's sync engine — cost:
  up to ~80 small rows per workspace instead of one (negligible for pull pages and backups).
- Ruling: a keyed row, not a typed core table — the study keeps the rows that
  have a contract and a fixture (`goals:workspace`, `known:*`, `vacation:*`) keyed; a typed table would need a
  migration, a pull collection, a push array and a round-order change for a write-once flag — cost: the server
  does not validate the shape (as for goals).
- Ruling: **seen is decided by the key alone**; a row is never rewritten once live and never deleted by any client
  — the only way to "unsee" is a tombstone, which no client writes — cost: a corrupt row cannot be repaired from
  the UI (it still means "seen", the safe side).
- Ruling: `reachedDay` is a snapshot taken when the milestone is marked seen and the history shows it — the
  history stays stable when cards are deleted or packs change — cost: a day derived from a since-changed log can
  be stale.
- Ruling: rows of ids this client does not know are kept and counted as seen but not listed — a client cannot
  title them — cost: the history differs between an old and a new client.
- Ruling: milestones are per workspace, stored per user — every milestone belongs to one workspace (its reviews,
  cards, levels, reading and journal events) and its seen rows are workspace rows, deleted with the workspace and
  remapped by the backup — cost: a learner with two workspaces sees "1,000 reviews" twice and never a combined
  total.

## Sync, offline and "never unsee"

- Rows travel as ordinary keyed rows: push `rows` items (`POST /api/sync/push`), pull v2 `rows`
  pages (`tombstones=1`: a tombstone arrives and reads as "not seen"). Last write wins per key by `updatedAt`:
  a second device pushing the same key later is accepted (the later writer wins, only `seenAt` changes); the
  server skips a push (`dataSkipped`) only when it holds a newer row for the key — a tombstone the client had not
  pulled, or a client clock behind the server's.
- The web sends every row of one dismiss in one push. Every row accepted: done, the ids leave the pending list.
  `dataSkipped` or `dataRefused` > 0, or a failed request (offline, 5xx): the ids stay pending (still seen
  here) and leave only once their row is live in a pull; the next flush tries again.
- Pending list (web): `localStorage` key `qinqin:milestones-pending:<userId>:<workspaceId>`, every access in
  `try/catch`. Seen = live rows ∪ pending. The list is flushed on the next load (at most once per 30 s) and on
  `online`; an id leaves it once its row is live in a pull. Android's local database plays this role.

- Ruling: the push sends every row in one chunk (the catalogue plus the level ids stay far below the 256 KiB item
  and body limits); only a fully accepted push drops the pending ids, a skipped, refused or failed one keeps them
  until a pull shows the row live — a skip means the server holds a newer row for the key (a tombstone this
  client had not pulled), which the next flush overwrites with the tombstone's stamp — cost: a refused row is
  retried at every flush (at most every 30 s while the page is open).
- Ruling: a local pending list instead of an outbox — keyed rows have no outbox, the seen flag is idempotent and
  harmless to lose (the worst case is the card shown once more on that device) — cost: in a private window that
  blocks storage an offline dismiss is forgotten on reload.
- Ruling: "shown once" is per account eventually, not instantly — a second device that loads before the first
  device's push arrives may show the same card; whoever dismisses second writes the same key again, which is
  accepted (the later writer wins) and still means seen — cost: the same milestone can be shown once per device in
  a race.

## What is shown

`unseen` = reached milestones of enabled families whose id is not seen, newest first (`reachedAt` descending,
ties in catalogue order: family order, then the higher threshold first, level ids by id).

- `none`: nothing unseen — no card.
- `recent`: at most three unseen, each with `reachedDay ≥ today − 6` — one card naming each with its day.
- `summary`: otherwise (a first run with history, a long offline stretch, a newly added catalogue entry, a
  feature switched back on) — one card "You have reached 14 milestones" naming the three newest and "and 11
  more", linking to the history.
- **A dismiss marks every milestone the card covered** (all unseen at render time, `ids`), never only the named
  ones. Following the card's link marks them too. Nothing else marks.
- Home computes the log families only (reviews, words studied, streak, days active, reading, journal); Stats →
  Week computes every family (it already has the replay and the character universe).
- History (Stats → Week, `#milestones`): every seen milestone (stored `reachedDay`, else the derived day, else
  `seenAt`'s learner day, else left out) plus every unseen reached one (derived day, marked "New"), newest day
  first, then catalogue order; unknown ids left out. The week's summary lists the history items whose day lies
  in the shown week.

- Ruling (backfill): an existing user's first load shows one `summary` card, not silence and not twenty cards —
  the learner discovers the feature and their record in one glance and one dismiss — cost: every existing user
  sees one card per workspace once.
- Ruling: one card at a time, never a toast — a toast that disappears by itself fails WCAG 2.2.1 for slow readers
  and cannot be "seen" reliably — cost: an ignored card stays on top of home.
- Ruling: replay families (mature, characters, levels) are detected on Stats → Week only — home must not add the
  character universe and a second replay to every load — cost: a "500 mature words" card first appears on Stats →
  Week, not on home.

## Backup and restore

Keyed rows are exported generically (`rows/NNNNNN.jsonl`, one `{workspaceId|null, key, data,
version, updatedAt, modifiedAt|null}` per line) and restored with their workspace remapped; a milestone id holds
no entry, card or workspace id, so key and data are restored unchanged. Tombstones are not exported.

## Android

Reads and writes `milestone:*` keyed rows (`rows`; never through a typed collection),
implements the catalogue, the reached rule (fixtures give timelines as schedules), the seen rule (key alone, never
delete, write only absent keys, stamp a write over a tombstone after it, keep an id pending until its row is live)
and the card plan. Its local database replaces the
pending list. It reads the level members from the `levels.<packId>` data packages (`packages/README.md`); the
`packId` there is the one `ownedLevelDeckId` hashes. It reads `rows` from pull v2.
