# Remaining contract gaps; `overview.md` as the single Android entry point — design (v0.4.0 prep item 6)

Status: Draft (2026-11-17), v0.4.0 prep item 6. No issue yet: the issue text is Appendix A (the orchestrator
creates it before the build and puts its number in the plan). Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Nothing is built. **Depends on** item 4 (typed study rows,
`docs/contracts/study/`, `library/`) and item 5 (packages, pull v2, `docs/contracts/packages/`, `sync/`), both on
`feature/v040p-packages`, from which this branch starts. **Item 7** (milestones) depends on this item for the
`read` and `journal` payload contracts.

## Intent

A second client (Kotlin, #34–#38) must be able to build everything it shares with the web app and the server
from `docs/contracts/` alone, starting at `docs/contracts/overview.md`, without reading TypeScript or Go. Today
the overview's own "Gaps" section admits that study event payloads other than `review` are unspecified, and an
audit (below) finds further rules that live only in code: how the server stores an event's `ts`, the FSRS
parameters beyond "the defaults", the duplicate-card merge, the deck session plan, XP, character mastery, the
heatmap scoring rule, the workspace settings keys, the `qinqin-core` UI rows and the overlay (entry edit) rules.
This item pins each of them with a README rule and JSON fixtures **extracted from the existing behaviour**
(decoded by Go and web tests wherever both implement the rule), corrects the overview where it is wrong, and
makes the overview the one page Android reads first.

## Goals and non-goals

- Every rule a second client needs for #34–#38 that is derivable from today's code is in a contract folder
  with fixtures; the overview links it from one place. Prioritised list below (P0–P2), all in scope.
- Every statement in `overview.md` and `docs/contracts/README.md` re-checked against the code; wrong ones
  corrected (audit table in Appendix B; the builder re-runs it line by line in the last task).
- Item 7's assumptions verified and pinned: `read` = `{bookId, seconds}`, `journal` = `{entryId: string}`
  (reconciliation below).
- A guard test: every fixture file is decoded by at least one test; every contract folder is listed in the
  README table and the overview.
- **No behaviour change.** No route, no migration, no token rule, no pull collection, no stored shape changes.
  Production code changes only where a rule is inlined in a component and must become a named pure function so
  a fixture can pin it (payload builders, Ruling below). Fixtures are derived from the code as it is; a
  disagreement found while extracting is recorded (Ruling) and fixed only if it is a bug both clients would
  otherwise copy (then it is a separate, named commit).
- Non-goals (deferred, with reasons, in "Deferred" below): paging `GET /api/events`, grade suggestions and
  the writing/tone engines, offline search normalisation, journal and grammar plugin rows, the optimizer,
  plugin manifest format for Kotlin plugins, interface strings (item 8).

## What is there today (audit; read before deciding)

Checked on `feature/v040p-packages` (item 5 built). Owner paths are relative to `apps/web/src/lib` and
`server/internal`.

**Events.** `POST /api/events/batch` (`api/handlers_events.go`) and the `events` array of `POST /api/sync/push`
(`sync/sync.go`) accept `{id, workspaceId, device, ts, type, payload}`: the id must be a ULID
(`ulid.ParseStrict`), `ts` non-zero, `workspaceId > 0` and owned (else 404); `userId` is forced to the caller.
**The server never looks at `type` or `payload`**: any string type and any JSON payload is stored (absent payload
= `null`). `events.Append` stores `ts` as `ev.TS.UTC().Format(time.RFC3339)`: **UTC, whole seconds, fraction
truncated** — the web sends `toISOString()` with milliseconds, so a stored event's `ts` differs from what the
client sent. Duplicates by id are counted, never errors. Validation errors of the batch route are **plain-text
400s**, not JSON. Body cap 4 MiB (`maxBatchBody`); no per-event or per-payload cap. `GET /api/events` returns
`ts >= since` (since compared at whole seconds), ordered by `ts`, then `id`; unpaged. Pull v2 ships every type
except `lookup` (`sync/page_collections.go`); `DELETE /api/events/lookups` is the only deletion.

Types and their writers (web):

| Type | Declared by | Written by | Payload as written | Readers |
| --- | --- | --- | --- | --- |
| `session` | `qinqin-core` manifest | `events.ts` `recordSessionOnce` (once per workspace per learner day, `localStorage` receipt `qinqin.session.<ws>.<day>` written before the POST) | `null` | none (no activity rule) |
| `view` | `qinqin-core` | `routes/entry/[id]/+page.svelte` (once per entry page visit, current workspace) | `{entryId: int}` | backup export (`refs.entries`), restore remap (`entryId` remapped or removed) |
| `lookup` | `qinqin-core` | nobody since #72 (older web: `{query: string}`) | `{query}` (legacy) | none; never in pull v2; deletable |
| `review` | `qinqin-core` | `study/events.ts` | `{cardId, mode, grade, meta?}` (pinned) | replay, XP, streak, heatmap, limits, … |
| `read` | `qinqin-core` (activity `measure` seconds, min 30, max 7200, `pointsPer` 300) | `features/reader/BookView.svelte` (a flush of `readingTimer.ts`: whole seconds ≥ 30, idle gaps capped at 120 s, flushed every 5 min of accrued time, on hide, `pagehide` and leaving; credited to the book's workspace) | `{bookId: int, seconds: int}` | heatmap (server), `stats/readingTime.ts` (`readingPoints`, `readSeconds`), weekly, goals; restore remaps `bookId` or **removes it** when the book is unknown |
| `journal` | `qinqin-journal` manifest (activity `distinctBy: entryId`) | `plugins/journal/store.ts` via the plugin SDK, gated by `entryDraft.ts` `journalEventDue` (only when the text changed, once per entry per learner day per editor instance) | `{entryId: string}` (the journal entry's ULID) | heatmap (server counts distinct **text** values per day), weekly, goals |

The web plugin SDK refuses to record a type the plugin's manifest does not declare; the server does not check.

**Activity scoring** (`stats/activity.go`, rules from the embedded manifests `plugins/builtin/*.json`): per
learner day and workspace, a plain rule counts events; a `measure` rule takes the JSON **number** at the field,
drops it below `min`, caps it at `max`, sums it as `raw` and scores `ceil(r / pointsPer)` per event; a
`distinctBy` rule counts distinct JSON **string** values (`json_type = 'text'`). Pinned only indirectly
(`study-day/activity-days.json` pins the day bucketing; goals reads `raw` from the route).

**Reviews.** `study/reviewParse.ts` `parseReview` (grade integer 1..4, non-empty `cardId`, unknown/missing `mode`
→ `vocab`, `meta` kept only when every present member is valid, else dropped whole) and `scheduler.ts`
`isValidReview`/`sortedReviews` (order by instant, then id) — the overview names the payload; the parse and
order rules have no fixture.

**FSRS.** `scheduler.ts` builds `fsrs({w})` with every other option at the ts-fsrs default. The scheduler
fixtures record `tsFsrs: "5.4.2"` and the words "default parameters, short-term on, fuzz off", but not the
numbers: `request_retention 0.9`, `maximum_interval 36500`, `enable_fuzz false`, `enable_short_term true`,
`learning_steps ["1m","10m"]`, `relearning_steps ["10m"]`, `default_w` (21 numbers). The replay oracle has 8
cases, all with default weights; none exercises the sub-day learning steps, a custom weight set, or two reviews
in the same second. Weight validation (`study/fsrs/params.ts` `checkWeights`: 17, 19 or 21 finite numbers inside
`CLAMP_PARAMETERS(2, true)`, `migrateParameters` to 21; `parseParamSet`; `resolveState` newest-first) is stated
as "a client rule" in `study/README.md` with no fixture.

**Cards.** `study/canonical.ts` `canonicalCards` (duplicates by `cardKey`; earliest `createdAt` survives, ties
lowest id, unparsable time loses; survivor gains the union of decks, missing `written`/`entryKind`/`sentenceId`
from the oldest duplicate that has one, union of `skipKinds`; reviews re-pointed) is referenced by
`scheduler/README.md` ("after the canonical merge") but unpinned. The deck session (`study/cardFlow.ts`
`deckSessionPlan`, `study/companions.ts` `planCompanions`, `scheduler.ts` `queueCandidates`): due cards earliest
due first (ties id), never-reviewed cards by `createdAt` (ties id) or `orderNew`; burying and kind switches before
limits; virtual companions round-robin over `sentence, writing, tone, reverse, cloze`, opt-in kinds only where a
session deck enables them, at most one opt-in per word (reverse preferred), budget = `newLimit` minus new real
cards, the rest a reserve, `backfillLimit = max(30, 2·newLimit)`; eligibility (`isEligible`: writing needs a Han
character with stroke data, tone a Chinese workspace and a pinyin reading); offline: real cards only. Level
sessions are pinned (`levels/`); deck sessions are not.

**Progress.** `study/exp.ts`: XP per valid review `BASE_XP[kind] + GRADE_BONUS[grade]` (vocab 10, sentence 15,
writing 20, tone 8, reverse 10, cloze 15; grade 3 +5, 4 +10), +10 per distinct learner day with a review; level
L→L+1 costs `100·L`. Unpinned (the streak is pinned). `study/mastery.ts`: `cardScore` is pinned (`decks/`), but
the character score (mean card strength over `MASTERY_KINDS` cards whose `written` contains the glyph, once per
card), the stage bands (`0` unknown, `<25` fresh, `<50` learning, `<80` mature, else learned) and `cellStates`
over variant glyphs (`study/charGroups.ts`) are not.

**Settings and UI rows.** Workspace `settings` (merged with SQLite `json_patch` = RFC 7396, merged object ≤ 64 KiB
else 413): `reader` (pinned), `hiddenDictionaries` (positive integers; `dictionaryVisibility.ts`; remapped on
restore), `audioAutoplay` (bool, default false), `audioDeviceVoice` (bool, default true; `audio/settings.ts`).
User-global `qinqin-core` rows: `home-layout` `{version ≥ 1, widgets: string[]}` (`widgets/layout.ts`: newer
versions read leniently, unknown ids kept stored, default layout when absent) and `activity-view`
`{version: 1, scope: "workspace"|"all", hidden: string[]}` (`activity/viewPrefs.ts`). Only `reader` is in the
overview.

**Overlays** (#37). `PUT /api/entries/{id}` `{written: string|null, readings: [{type, value}]|null}`
(`api/handlers_entries.go`, `overlay/overlay.go`): 404 before 400; a blank `written` or a reading with a blank
type or value is 400; the patch replaces the previous one wholesale; `null` = untouched (shared value); an
all-null patch is a revert that **keeps** its row with a fresh stamp so other devices learn of it; `readings: []`
stores an empty list (the entry then shows **no** readings); the row is stamped with the **server clock**
(last arrival wins, not the client's edit time); apply replaces `written` and `readings` only. Pull row shape is
pinned (`sync/`), the rules are not.

**Overview errors found** (details in Appendix B): "keeps `ts` verbatim" (it is truncated to whole seconds and
converted to UTC); "`type` one of …" (any type is stored; `journal` belongs to `qinqin-journal`; plugins may
declare more); the `read` row ("free payload", owner `readingTimer.ts`, no fixture); the folder table misses
`frequency/` and `lookups/`; the read order names 10 of 19 folders; the "Gaps" section; `README.md`'s fixture
format line (auth fixtures are named-example maps; several files carry extra top-level members);
`scheduler/optimizer-steps.inside.json` is generator input, decoded by no test.

## Gap inventory (prioritised)

| # | Gap | Why Android needs it | Prio | In this item |
| --- | --- | --- | --- | --- |
| G1 | Event envelope and server behaviour (types, ULID, `ts` normalisation, payload not validated, duplicates, order, errors, caps, lookup never pulled) | #35 outbox and log merge | P0 | yes — `events/envelope.json` |
| G2 | Payloads and emit rules of `session`, `view`, `lookup`, `read`, `journal` | #35/#38 write them; item 7 reads them | P0 | yes — `events/payloads.json` |
| G3 | Review parse and replay order | every derived number | P0 | yes — `events/review-parse.json` |
| G4 | FSRS pin: version, every parameter, `default_w`, weight validation and migration, active-set resolution, replay incl. learning steps, custom weights, same-second ties | "a Kotlin FSRS pinned against ts-fsrs" (#35) | P0 | yes — `scheduler/fsrs.json` (generated) |
| G5 | Duplicate-card merge (`canonicalCards`) | limits, queues and stats count after it | P0 | yes — `study/canonical.json` |
| G6 | Deck session plan (order, companions, budget, reserve, burying, eligibility, offline) | #38 study flow | P1 | yes — `cards/deck-session.json` |
| G7 | XP and level curve | #38 home widget | P1 | yes — `scheduler/xp.json` |
| G8 | Character mastery, stages, cells with variants | #38 map; item 7 | P1 | yes — `decks/char-mastery.json` |
| G9 | Activity scoring (heatmap cells) | #38 heatmap offline, goals | P1 | yes — `events/activity.json` |
| G10 | Workspace settings keys and merge | #36 hidden dictionaries, audio | P2 | yes — `settings/workspace-settings.json` |
| G11 | `qinqin-core` user-global rows `home-layout`, `activity-view` | #38 home must not corrupt the web's layout | P2 | yes — `settings/core-rows.json` |
| G12 | Overlay rules | #37 | P2 | yes — `overlays/overlay.json` |
| G13 | Overview corrections, device-local list, complete read order | single entry point | P0 | yes |
| G14 | Fixture coverage guard | keeps G1–G13 true | P1 | yes — web test |

Deferred (each with its reason; listed in the issue and in the overview's new "Not specified (on purpose)"):

- **D1 Paging `GET /api/events`** — a route change (item 5 left it open); Android reads events from pull v2's
  `events` collection, which is paged. Separate issue (Appendix A names it as a follow-up to open).
- **D2 Grade suggestions** (writing, tone, reverse, word salad: `suggest*Grade`), **tone gestures and the
  writing engine** — the learner confirms the grade, so a different suggestion never changes stored data; the
  native writing engine is #38's own work.
- **D3 Offline search normalisation** (Go `lexicon` search, tone/romaji-insensitive) — a large rule set that
  #36 may keep server-side; pin it when #36 decides to search offline.
- **D4 Journal and grammar plugin rows** (`qinqin-journal` entries, reviews, settings, photos; grammar runs) —
  not in Android's first plugin set (#38 names flashcards and the heatmap). Only their event payloads are pinned.
- **D5 The optimizer** (training, evaluation; `optimizer-steps.json` already pins its step input) — Android
  reads `fsrsSets`, it does not optimise.
- **D6 Plugin manifest format for Kotlin plugins** — `docs/wiki/Plugin-format.md` describes it; a contract
  folder belongs to #38's host design.
- **D7 Interface strings and the key scheme** — item 8.
- **D8 Device-local state** (session setup, ineligible companions, card-type memory, recent sentences, reader
  prefs and rail, highlight colour, outbox storage, milestone pending list) — not shared, so not a contract; the
  overview lists them so Android knows it is free there.

## Questions and answers

**Q1. Where do event rules live?** In a new folder `docs/contracts/events/` (README + `envelope.json`,
`payloads.json`, `review-parse.json`, `activity.json`), linked from the overview's sync model and a new
"Events" section that replaces the Gaps bullets.

Ruling: one `events/` folder rather than a payload row per type in the overview table — the envelope, the
payloads, the parse rules and the heatmap scoring are one subject a sync engine implements together — cost:
`review` is described in two places (overview row stays, pointing at the folder).

**Q2. What does the envelope fixture pin?** Server behaviour, decoded by a Go API test that posts each case's
batch to a test server and reads it back: accepted/duplicates counts; `ts` with offset and milliseconds stored as
UTC whole seconds (`2026-11-17T10:00:00.789+01:00` → `2026-11-17T09:00:00Z`); `payload` absent → `null`; any
type and any payload accepted; non-ULID id, zero `ts`, `workspaceId ≤ 0` → 400 (plain text); foreign workspace →
404 and nothing stored; `GET` order `ts`, then id; `since` inclusive at seconds; pull v2 never ships `lookup`.

Ruling: clients must treat the stored `ts` (whole-second UTC) as the event's time and order by `(ts, id)` —
the web replays its local outbox copy (milliseconds) and the server copy (seconds) through the same order and
ULIDs are monotonic in milliseconds, so two reviews in one second still replay in creation order — cost: a
client that orders by its own millisecond `ts` and a tie-break other than the id disagrees for same-second
reviews. Android should send `ts` already truncated to whole seconds (UTC) so its local copy equals the server
copy byte for byte; the server accepts either.
Ruling: the overview's "keeps `ts` verbatim" is corrected, not the server — changing storage would alter every
stored log and the pull's string comparison — cost: none.

**Q3. Which payload shapes are pinned, and what may Android write?**

| Type | Shape (written) | Emit rule | Consumers must |
| --- | --- | --- | --- |
| `session` | `null` | at most once per workspace per learner day (per device), when that workspace becomes the current one in the app shell (`routes/+layout.svelte`; the comment there still says "UTC day": stale, the receipt is keyed by the learner day) | ignore it (nothing derives from it) |
| `view` | `{entryId: int > 0}` | once per entry page visit (current workspace) | ignore it except backup remap |
| `lookup` | (legacy `{query: string}`) | **never** (#72: the history is the `lookups` row) | ignore it; never ship or cache it |
| `read` | `{bookId: int > 0, seconds: int ≥ 30}` | one event per flush of the reading timer when it holds ≥ 30 whole seconds (time accrues between activity pings while visible; a gap over 120 s counts 120 s; flushed every 5 minutes of accrued time, on page hide, `pagehide` and leaving the book; under 30 s is kept for the next flush of the same book and workspace and dropped on a book or workspace switch), in the **book's** workspace | count `readSeconds(payload)`: 0 unless `seconds` is a finite number ≥ 30, else `min(seconds, 7200)`; points `min(ceil(seconds/300), 24)`; `bookId` may be **absent** (restore of an unknown book) — the time still counts, book unknown |
| `journal` | `{entryId: string}` (the journal entry's ULID) | when a save changed the text, at most once per entry per learner day | count distinct `entryId` **strings** per learner day; a non-string `entryId` never counts |

Ruling: Android **may** omit `session` and `view` (telemetry nothing derives from) but, if it writes them, uses
exactly these shapes — the backup remap reads `view.entryId`, and an incompatible shape would be silently kept
unremapped — cost: none for the learner.
Ruling: `read` and `journal` are written exactly as above by every client — the heatmap, the weekly summary,
goals and item 7 count them — cost if wrong: reading time or journal days differ per device.
Ruling: the web's four call sites get named payload builders in a new pure module `lib/eventPayloads.ts`
(`sessionPayload()`, `viewPayload(entryId)`, `readPayload(bookId, seconds)`, `journalPayload(entryId)`), each
call site uses them, and `payloads.json` is decoded against the builders and against the consumers
(`readingPoints`, `readSeconds`, `journalEventDue`, and the reading timer's flush) — the payload of `read` is
built inline in a Svelte component today, which no fixture can reach — cost: a four-line refactor touching
`BookView.svelte`, the entry page, `events.ts` and the journal store; behaviour identical (asserted by the
builders' tests and the existing component tests).

**Q4. Item 7 reconciliation.** Verified: `read` = `{bookId, seconds}` and `journal` = `{entryId: string}` are
what the web writes and what the server's activity rules read. Two refinements item 7 must follow, recorded in
its spec by the item 7 builder (an Adaptation line), not edited here: (a) "`reading-hours` sums `readSeconds`"
already matches the clamping; a `read` without `bookId` still counts; (b) "distinct `entryId` of `journal`
events" means distinct **strings**, matching the server's `distinctBy`. Nothing in item 7 needs to change.

Ruling: item 6 does not edit item 7's spec — the item 7 plan already stops when item 6's fixtures are missing
and records adaptations itself — cost: none.

**Q5. How exactly is FSRS pinned?** A generated fixture `scheduler/fsrs.json` from plain ts-fsrs by extending
`scripts/contracts/gen-scheduler-fixtures.mjs` (same `--check`): `tsFsrs` (5.4.2, read from the installed
package), `parameters` (the full `generatorParameters()` object with `w` = `default_w`), `clampRanges`
(`CLAMP_PARAMETERS(2, true)`), and cases: `weights` (17/19/21 numbers, a non-finite value, out-of-range values at
both ends, wrong lengths → `{ok, migrated | error}` as `checkWeights`/`validWeights` give), `paramSet`
(`parseParamSet` accept/reject incl. key mismatch and optional numbers), `resolve` (`resolveState`: newest-first
order, dangling pointer = default weights), `replay` (≥ 20 grade sequences with real instants and expected
`{due, stability, difficulty, state, reps, lapses, scheduled_days, learning_steps}` after **every** review: a new
card through both learning steps, Again in learning and in relearning, Hard/Easy from new, a lapse after months,
sub-day reviews, two reviews in the same second ordered by id, a custom 21-weight set, a migrated 17-weight set).

Ruling: generated from plain ts-fsrs, not from `scheduler.ts` — the oracle must be the library Android ports
against (the vacation fixture's precedent); the web test then proves `scheduler.ts` equals it — cost: if ts-fsrs
is upgraded the fixture is regenerated and Android must follow (a version bump is a contract change; the
README says so).
Ruling: the expected values carry every member of the ts-fsrs card a port needs to step forward
(`reps`, `lapses`, `learning_steps`, `scheduled_days`), not only the four the web stores — a port that only
matches the final schedule can hide a wrong intermediate state — cost: a larger file (tens of KB).

**Q6. Duplicate-card merge.** `study/canonical.json`: cases `{cards, reviews, expect: {cards, reviews, merged}}`
from `canonicalCards` (survivor choice, unparsable `createdAt`, deck union order, field fill-ins, `skipKinds`
union in kind order, re-pointed reviews keep their event ids, idempotence, a sentence pair with different
`sentenceId` is two cards). Web decodes; Go has no implementation (Ruling: no Go test — the server never merges
cards; adding one would be a second implementation nobody runs — cost: none).

**Q7. Deck sessions.** `cards/deck-session.json` decoded by `cardFlow.test.ts`: inputs as `levels/` (zone history,
`now`, cards, reviews, decks, deck settings, kinds, limits, language, offline, `weights: "default"`), expect
`{queue: [id], reserve: [id], backfillLeft}` plus `drop` and `buryAfterAnswer` steps; and `isEligible` cases
(writing without Han or stroke data, tone outside Chinese or without pinyin). Due order, new order (`createdAt`
and `orderNew`), burying before limits, a vacation day (empty), companions round-robin, the opt-in rule, budget
and reserve, offline (real cards only).

Ruling: the fixture pins the **plan** and eligibility, not which sentence a sentence card shows or how a
virtual item is graded — sentence choice and cloze are already pinned (`cards/cloze.json`), grade suggestions
are deferred (D2) — cost: none.

**Q8. XP, character mastery.** `scheduler/xp.json` (per-kind base, grade bonus, daily bonus per learner day,
unknown mode as vocab, invalid reviews ignored, `levelProgress` boundaries 0, 99, 100, 299, 300, huge, negative,
NaN). `decks/char-mastery.json` (`masteryFromSchedules` with schedules given, so no FSRS: the mean, once per
card, only `MASTERY_KINDS`, empty glyph never matched, stages at 0/1/24/25/49/50/79/80/100; `cellStates` with
variant glyphs). Web decodes both; no Go implementation.

**Q9. Activity scoring.** `events/activity.json`: zone history, events, the rules of the built-in manifests,
expect cells `{day, workspaceId, type, points, raw}`. Go decodes in `stats` (insert events into a test database,
call `Activity` with the built-in rules — the existing oracle test's pattern); web decodes the `read` cases
through `readingPoints`/`readSeconds`. Cases: a `read` of 29/30/300/301/7200/7201 s, a non-number `seconds`, a
real number, a missing field; `journal` with the same `entryId` twice in a day, on two days, a numeric `entryId`;
`review` counting; a `session`/`view` that scores nothing; a day boundary in a non-UTC zone.

**Q10. Settings and UI rows.** New folder `docs/contracts/settings/`: `workspace-settings.json` (each key's parse
and default; the RFC 7396 merge: update, add, `null` deletes, nested objects merged; the 64 KiB 413) decoded by
web (`readAudioSettings`, `hiddenDictionaries`, `parseDisplay`) and by a Go API test for the merge cases;
`core-rows.json` (`parseLayout`, `resolveLayout` with unknown and unavailable ids, `serializeLayout`,
`parseActivityView`; the widget id catalogue `activity-heatmap, flashcards-summary, daily-goal, weekly-summary,
character-map-summary, reading-time, word-states` as the registry lists them) decoded by web.

Ruling: Android shares `home-layout` with the web (one per user) and keeps every widget id it does not know
stored, in place — a per-platform key would be a new row type and the web already keeps unknown ids — cost: a
widget only one platform has occupies a slot the other skips.
Ruling: Android writes `activity-view` with `version: 1` only — cost: none.

**Q11. Overlays.** New folder `docs/contracts/overlays/` (README + `overlay.json`): PUT bodies and their answers
(404 before 400, blank checks), the stored patch (`null` untouched, `[]` empty readings), revert keeps the row,
server-stamped last-arrival-wins, the apply rule for an offline client (pull row → entry view: replace
`written` when non-null, replace `readings` when non-null, nothing else). Go decodes (API test + `overlay`
package); the web has no apply code (it reads applied entries), so no web test (Ruling: same reason as Q6).

Ruling: the contract states that overlay edits are **server-stamped** and that a queued offline edit therefore
wins over a newer edit another device made while it was offline — this is today's behaviour and #37's queue must
know it; changing it (client stamps) is a route change for #37 to decide — cost: a stale offline edit can
overwrite a newer one.

**Q12. The overview as the single entry point.** Restructured (same file, same tone) as:

1. Purpose and the precedence rule (fixture wins; code is not the source).
2. **Read order** — every folder, in dependency order: `auth/` → `study-day/` → `packages/` → `sync/` →
   `events/` → `study/` → `cards/` → `scheduler/` (FSRS, vacation, limits, XP) → `decks/` (numbers, mastery) →
   `levels/` → `frequency/` → `goals/` → `weekly/` → `reader/` → `library/` → `notes/` → `lookups/` →
   `radicals/` → `settings/` → `overlays/` → `backup/` → `pwa/`.
3. How the folders fit (table, every folder, including `frequency/`, `lookups/`, `events/`, `settings/`,
   `overlays/`).
4. Sync model (as now, corrected).
5. **Events** (new: envelope, the type table of Q3, the heatmap rule, links).
6. Row-key conventions (typed rows; keyed rows incl. `home-layout`, `activity-view`; the `read`/`journal` rows
   replaced by a pointer to `events/`; workspace settings keys).
7. Auth summary; Study rules (links, plus FSRS, XP, mastery, deck sessions); Backup; PWA.
8. **Device-local state (not shared)** — D8's list, so Android knows it is free there.
9. What Android must not cache or store (as now).
10. **Not specified (on purpose)** — D1–D7 with the issue or item that owns each; replaces "Gaps". It must be
    empty of anything Android needs for #34–#38 that is derivable from the code.

Ruling: one page, not a separate "Android guide" — two entry points drift — cost: the overview grows to about
300 lines.
Ruling: `docs/contracts/README.md` keeps its folder table (the doc test reads it) but its fixture-format line
says what is true: case-list files `{version, rule, cases}` (plus named members some rules need), named-example
files (auth) and generated files (`generator`, `--check`) — cost: none.

**Q13. Coverage guard.** `apps/web/src/lib/contractsDocs.test.ts` gains: every `docs/contracts/**/*.json` file
name occurs in at least one `*.test.ts` under `apps/web/src` or `*_test.go` under `server/` (allowlist: generator
inputs named by a generator, i.e. `scheduler/optimizer-steps.inside.json`, and `backup/sample-v1/**`, decoded as
an archive by `api/contract_backup_test.go`); every folder appears in the README table **and** in the overview's
read order.

Ruling: a file-name reference check, not an import graph — cheap, catches the realistic failure (a fixture
nobody runs) — cost: a test that names a file without decoding it passes; review focus covers that.

## Contract fixtures (summary)

| File | Decoded by (web) | Decoded by (Go) |
| --- | --- | --- |
| `events/envelope.json` | `lib/sync/pullPage.contract.test.ts` (lookup filter), `study/scheduler.test.ts` (order) | `api/contract_events_test.go` (new) |
| `events/payloads.json` | `lib/eventPayloads.test.ts` (new), `stats/readingTime.test.ts`, `plugins/journal/entryDraft.test.ts`, `features/reader/readingTimer.test.ts` | — (the restore remap of `view`/`read` payloads is already pinned by `backup/remap.json`, decoded by `backup/remap_test.go`) |
| `events/review-parse.json` | `study/reviewParse.test.ts`, `study/scheduler.test.ts` (`isValidReview`, `sortedReviews`), `study/exp.test.ts` (same validity) | — (Ruling Q6) |
| `events/activity.json` | `stats/readingTime.test.ts` (read cases) | `stats/contract_activity_test.go` (new) |
| `scheduler/fsrs.json` (generated) | `study/scheduler.test.ts`, `study/fsrs/params.test.ts` | — |
| `scheduler/xp.json` | `study/exp.test.ts` | — |
| `study/canonical.json` | `study/canonical.test.ts` | — |
| `cards/deck-session.json` | `study/cardFlow.test.ts` | — |
| `decks/char-mastery.json` | `study/mastery.test.ts`, `study/charGroups.test.ts` | — |
| `settings/workspace-settings.json` | `audio/settings.test.ts`, `dictionaryVisibility.test.ts`, `features/reader/displaySettings.test.ts` | `api/contract_settings_test.go` (new; merge cases) |
| `settings/core-rows.json` | `widgets/layout.test.ts`, `activity/viewPrefs.test.ts` | — |
| `overlays/overlay.json` | — | `api/contract_overlays_test.go` (new), `overlay/overlay_test.go` |

Test file names are the existing ones where they exist; the plan names the real file after a `ls` and records a
different name as an Adaptation.

## Risks

- A fixture extracted from code can pin a bug. Mitigation: each case's `note` states the rule in words; a case
  whose value surprises the builder is raised as a Ruling (keep, or fix as a separate commit before pinning).
- The FSRS fixture ties Android to ts-fsrs 5.4.2. Mitigation: the README states the upgrade procedure
  (regenerate, Android follows in the same release).
- Doc drift between the overview and folders. Mitigation: the coverage guard and the line-by-line audit in the
  last task.

## Left to the builder

Exact case lists beyond the minimums named above; test helper names; whether the Go events test lives in `api`
or `events` (it needs the HTTP layer for the 400/404 answers, so `api` is expected).

## Appendix A — GitHub issue (draft; the orchestrator creates it)

**Title:** contracts: remaining gaps for Android — event payloads, FSRS pin, card merge, deck sessions, XP,
mastery, heatmap scoring, settings, overlays

**Body:**

> v0.4.0 prep item 6. Goal: Android (#34–#38) can implement everything it shares with the web app and server from
> `docs/contracts/` alone, starting at `docs/contracts/overview.md`, without reading TypeScript or Go.
>
> Spec: `docs/superpowers/specs/2026-11-17-v040p-contract-gaps-design.md`; plan:
> `docs/superpowers/plans/2026-11-17-v040p-contract-gaps.md`.
>
> In scope (README rule + JSON fixtures decoded by Go and/or web tests, extracted from today's behaviour; no
> behaviour change):
> - [ ] `events/`: envelope and server behaviour (ULID ids, `ts` stored as whole-second UTC, payloads not
>   validated, duplicates, order, plain-text 400s, `lookup` never pulled); payloads and emit rules of `session`,
>   `view`, `lookup` (legacy), `read` `{bookId, seconds}`, `journal` `{entryId: string}`; review parse and replay
>   order; heatmap scoring (count, measure, distinct)
> - [ ] `scheduler/fsrs.json`: ts-fsrs 5.4.2 with every parameter, default weights, weight validation and
>   migration, active set, a replay oracle with learning steps, custom weights and same-second ties
> - [ ] `study/canonical.json`: duplicate-card merge
> - [ ] `cards/deck-session.json`: deck session plan (order, companions, budget, reserve, burying, eligibility)
> - [ ] `scheduler/xp.json`, `decks/char-mastery.json`: XP and levels, character mastery and stages
> - [ ] `settings/`: workspace settings keys and their merge; `qinqin-core` rows `home-layout`, `activity-view`
> - [ ] `overlays/`: entry edit rules (#37)
> - [ ] `overview.md` corrected and restructured as the single entry point (complete read order, events
>   section, device-local list, "not specified on purpose" list); coverage guard test
>
> Deferred on purpose: paging `GET /api/events` (follow-up issue: "events: page GET /api/events" — Android uses
> pull v2's `events` collection meanwhile), grade suggestions and the writing/tone engines (#38), offline
> search normalisation (#36), journal and grammar plugin rows, the optimizer, the Kotlin plugin manifest (#38),
> interface strings (#73).
>
> Item 7 (#94) depends on the `read` and `journal` payload fixtures.

## Appendix B — audit of `overview.md` and `README.md` (2026-11-17, `feature/v040p-packages`)

| Statement | Code | Verdict |
| --- | --- | --- |
| Events: "the server … keeps `ts` verbatim" | `events.Append`: `ev.TS.UTC().Format(time.RFC3339)` | **wrong**: UTC, whole seconds, fraction truncated |
| Events: "`type` one of `session\|view\|lookup\|review\|read\|journal`" | handlers never check `type`; `journal` declared by `qinqin-journal` | **incomplete** |
| Events: idempotent by ULID, `userId` forced, workspace owned else 404 | `handlers_events.go`, `sync.go` | correct (400s are plain text: add) |
| Events: owner can delete `lookup` events; web no longer emits them | `events.DeleteLookups`; no `record('lookup')` call | correct |
| Row `read` events: "free `payload`", owner `readingTimer.ts`, "no fixture" | payload `{bookId, seconds}` built in `BookView.svelte` | **wrong** (fixed by `events/`) |
| Row `review` event: payload, unknown `mode` reads as `vocab` | `reviewParse.ts` | correct; parse rules unpinned (G3) |
| Row workspace settings key `reader` | `displaySettings.ts`; server `json_patch` | correct; other keys missing (G10) |
| `workspaceId: null` rows: `vacation:*`, `lookupcfg`, `qinqin-core` UI rows | `widgets/layout.ts`, `activity/viewPrefs.ts` (`data.user()`) | correct; UI rows' shapes missing (G11) |
| Auth: 64-hex bearer, SHA-256 kept, idle 90 days | `auth/session.go` `SessionIdle` | correct |
| PAT `qq_pat_` + 64 hex | `auth/tokens.go` | correct |
| Push: value ≤ 256 KiB (413) | `api.go` `maxPluginDataValue` | correct |
| "How the folders fit" | folders on disk | **incomplete**: `frequency/`, `lookups/` missing |
| Read order | folders on disk | **incomplete**: 10 of 19 |
| Gaps: `read` payload, `GET /api/events` unpaged, other payloads | — | replaced (G1–G2; D1) |
| README: fixture format `{version, rule, cases}` | `auth/*.json` named examples; several files with other members | **inaccurate** |
| README: "a Go or web test must decode each fixture" | `scheduler/optimizer-steps.inside.json` decoded only by the generator | **one exception** (allowlisted, G14) |

The plan's last task re-runs this audit for every line of both files and records the table in the Execution
record; the rows above are the minimum.
