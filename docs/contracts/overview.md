# Contracts overview (read this first, Android)

Everything a second client must do the same way as the web app and the server. (Under the approved Android
shell design, `docs/superpowers/specs/2026-11-23-android-shell-design.md`, the Android app runs the web app itself;
these contracts stay the source of truth for the server and the web app.) This page
is the **single entry point**: start here, follow the read order, and build from `docs/contracts/` alone,
without reading TypeScript or Go. The folders next to this file hold the rules (README) and JSON fixtures;
this page says how they fit together, lists every stored row convention, what is device-local and what is
deliberately not specified. Where this page and a fixture disagree, the fixture wins; the code is not the
source of a rule (`docs/contracts/README.md`). Derived from the code on `develop`; each owner path below is
where the rule is implemented today.

## How the folders fit

| Layer | Folders |
| --- | --- |
| Identity and transport | `auth/` (token, restrictions, errors, two-step sign-in), `pwa/` (outbox, cache rules) |
| Shared data | `packages/` (data packages: the catalogue, downloads, the zip and `data.sqlite` of every type, versioning and the client rule) |
| User data in transit | `sync/` (the paged pull `v=2`, the push answer), `keyed/` (the keyed rows store: families and scopes) |
| Languages | `languages/` (the language profiles: what each language has, the fallback, how to add one) |
| Time | `study-day/` (the learner's day, zone history) is the base of everything below |
| Study events | `events/` (the envelope and how the server stores it, the payload of every type and when it is written, review parsing and replay order, heatmap activity scoring) |
| Typed study data | `study/` (cards, decks, deck settings, limits, FSRS sets, the active set: wire shapes, last-write-wins, tombstones; the duplicate-card merge), `library/` (reader books, bookmarks, highlights, positions, the deletion log) |
| Cards and study | `cards/` (ids, kinds, burying, cloze, the deck session plan, the session queue shared by deck and level sessions, the session mix of card types, hints), `levels/` (level sessions), `scheduler/` (the FSRS pin, XP and levels, vacation, study clock, due, streak, daily limits), `decks/` (deck numbers, system deck ids, add-to-deck, character mastery), `frequency/` (frequency order of new cards, starter decks, the known-word predicate, the display form of an entry), `senses/` (the display order of an entry's senses: slang, vulgar and derogatory senses last and folded), `goals/` (daily goal, day status, goal streak), `weekly/` (weekly summary; nothing stored), `stats/` (the Overview's four summary numbers and reviews per day; nothing stored), `milestones/` (weekly milestones: catalogue, reached rule, the `milestone:<id>` seen rows, card plan) |
| Tones | `tones/` (citation and spoken tones: the tone sandhi rules of 不, 一 and third tones, and how a tone answer is graded; the `tones` workspace setting is in `settings/`) |
| Reader | `lemma/` (rule tables of the lemmatizer: deinflection, ranking keys, token boundaries), `segment/` (whole-sentence segmentation, function words), `reader/` (display settings, furigana, smart readings, word states, coverage) |
| Personal data on entries | `notes/` (notes and the answer-side switch), `lookups/` (lookup history and its switch), `overlays/` (a user's edits of a shared entry), `examples/` (AI example sentences: drafts, kept examples marked `ai`, reports), `journal/` (the journal's entries, reviews, topic ideas, settings and the conversation partner's conversations; the mistake/suggestion kind), `grammar/` (lesson and review runs, as events) |
| Lookup | `radicals/` (Kangxi table, `k` in the character universe, components index, radical and part lookup) |
| Features | `features/` (the per-user switches of the four core features) |
| Version | `version/` (`GET /api/version`, the contract version, the native bridge level and features, the administrator's release check) |
| Settings | `settings/` (workspace settings keys and their merge; the user-global keyed rows `home-layout`, `activity-view`, `widget-options` and `nav-layout`) |
| Reminders | `reminders/` (the opt-in `reminders` row, the client's facts, the plan the shell schedules local notifications from, web push routes, the email unsubscribe link) |
| Data safety | `backup/` (archive format 2, id remapping) |
| Starter mode | `starter/` (the stage of a word from its own review history, what the front shows at each stage, the `starter` workspace setting, the Starter set format and its routes; builds on `cards/` hints and `images/`) |
| Courses (data) | `topics/` (the topic list and the topic labels of words that fill course units by theme; nothing stored per user), `courses/` (the course pack, the fill rule and `GET /api/courses/{id}`, the `course` progress events and the path-state derivation) |
| Pictures | `images/` (images packs: the pack format, the word → picture mapping, the picture of an entry `GET /api/images/entries/{id}`, the images package for offline pictures, picture reports, the picture vocabulary, theming and credits) |
| Visual aids | `aids/` (the `visualAids` workspace setting; pictures on entries and cards, tone colours and contours, character anatomy) |
| Stroke order | `strokes/` (`GET /hanzi/U<HEX>.json`, the optional `?lang=` and which strokes pack answers for it) |
| Look | `themes/` (theme files and packs, contrast, derived tokens, the `appearance` row, `GET /api/themes`), `fonts/` (font packs, `faces.json`, `GET /api/fonts`, the slice files) |
| Interface text | `i18n/` (catalogue format, key scheme, message syntax, Android conversion, interface-language negotiation, formatting locale) |

## Read order

Every folder, in dependency order (this page's sync model and Events sections after `sync/`):

`auth/` → `languages/` → `study-day/` → `packages/` → `sync/` → `keyed/` → `features/` → `version/` → `events/` → `study/` → `cards/` → `tones/` → `scheduler/` → `decks/` →
`levels/` → `frequency/` → `senses/` → `goals/` → `weekly/` → `stats/` → `milestones/` → `lemma/` → `segment/` → `reader/` → `library/` → `notes/` → `lookups/` →
`radicals/` → `strokes/` → `images/` → `aids/` → `starter/` → `topics/` → `journal/` → `grammar/` → `courses/` → `drills/` → `conjugation/` → `settings/` → `reminders/` → `themes/` → `fonts/` → `overlays/` → `examples/` → `backup/` → `pwa/` → `i18n/`

## Sync model

- First copy by packages (`packages/`): shared data (the lexicon per language, level lists, pack sentences,
  frequency, components, audio, grammar, stroke data) never travels in a pull. A client reads the catalogue
  `GET /api/packages` (its workspace languages by default; `ETag`/`If-None-Match`), downloads each package it
  needs (`GET /api/packages/{id}/{revision}`, resumable with `Range`; 429 `download_busy` is retried after
  `Retry-After`), verifies it (`packages/README.md`, "Verification") and swaps the file in. The client rule
  (`packageAction`, `packages/versioning.json` `client` cases) decides keep, download, delete, wait,
  unsupported or reset per row. Package files are replaced, never merged into the client's own data.
- User data by the paged pull (`sync/`): `GET /api/sync/pull?v=2` pages the caller's own rows in a **round**:
  the round fixes `until` at its first page and ships, collection by collection in a fixed order
  (`workspaces, features, rows, cards, decks, deckSettings, limits, fsrsSets, fsrsActive, books,
  bookmarks, highlights, overlays, sentences, events`), every row with `since <= updatedAt < until`, at most
  `limit` rows (default 500, 1..2000) and 4 MiB of rows per page (a larger row alone). A page names the next
  one (`next`, `p2.…`, sent alone as `page=`); the last page has `more: false` and a **cursor** (`c2.…`,
  `until − 30 s`): the `since` of the next round with the same `collections` and `workspace` (one cursor per
  filter set; rows of the last 30 s may come twice, upsert by key). From no `since` a round ships live rows
  only; with one it ships tombstones too. Within a library collection tombstones follow the live rows.
- Reading rows (`sync/README.md`, `sync/unreadable-rows.json`, #167): a client checks the page envelope only
  and decodes each row itself; a row it cannot read (damaged, or from a newer client) is skipped and counted,
  never blocks the round, and is never rewritten or deleted: a write to its identity is refused and a new card
  never takes its id.
- Scope: the first page of a round carries `scope` — every workspace of the caller (a workspace not listed
  is deleted: drop its local data), the round's language set and `catalogue`, the ETag `GET /api/packages`
  gives the same caller by default (a change means "re-read the catalogue"). `workspace=<id>` narrows a round
  to one workspace plus user-global rows. `overlays` and own `sentences` ship only for the round's languages;
  when the language set differs from the one inside `since`, they ship from scratch and `restarted` names them.
- `instanceId` (in every page, the catalogue and every package manifest) names the server database; a
  different value means another database (a restore from elsewhere, a new server): discard packages and
  local user data and start over.
- Errors are JSON `{error, message}`: 400 `sync_page_invalid` (bad `limit`, unknown collection, a garbled or
  foreign token, a `page=` that repeats a filter: start the round again), 400 `sync_collection_moved` (a
  lexicon collection: read packages), 404 `not_found` (a `workspace=` the caller does not own), 410
  `sync_cursor_expired` (defined, not sent yet: discard local user data, pull without `since`).
- There is no other pull form: a pull without `v=2` (the v0.3.x streaming form) is 404 `not_found` since #198.
- Push: `POST /api/sync/push {events: [...], rows: [...], cards: [...], decks: [...], deckSettings: [...],
  limits: [...], fsrsSets: [...], fsrsActive: [...]}` (`server/internal/sync/sync.go`, `sync/push-result.json`). The whole
  body is validated first; an unknown or foreign workspace is 404 and nothing is applied; a bad
  item is 400. Answer: `{eventsAccepted, eventDuplicates, dataAccepted, dataSkipped, dataRefused}`.
  `dataRefused` counts keyed rows of a key no family accepts or in the wrong scope (`keyed/families.json`;
  a typed family's key among them; the rest still applies). A value is at
  most 256 KiB (413); so is each typed item. `dataAccepted` and `dataSkipped` count typed items too.
- Keyed row (wire shape, `model.KeyedRow`, `keyed/`): `{key, userId, workspaceId|null, data, version,
  updatedAt, deletedAt|null}`. The identity of a row is `(workspaceId, key)`; the server accepts only the
  families of `keyed/families.json`, each in its scope.
- Last write wins by `updatedAt`: the server keeps its row when it is newer than the pushed one (counted
  `dataSkipped`); otherwise it writes the row and stamps its own `updatedAt` and bumps `version`. Two
  devices writing different keys never conflict; writing the same key is decided by `updatedAt`.
- Tombstones: a deleted row stays in the pull with `deletedAt` set and its last `data`. A client treats
  `deletedAt != null` as absent. Deleting an absent or already deleted row counts as skipped.
- `workspaceId: null` rows are user-global (apply to every workspace). Examples: `vacation:*`, `lookupcfg` and the UI rows (`home-layout`, `appearance`, ...).
  Everything else is per workspace; a write needs a current workspace and never falls back to another.
- Events: study events, idempotent by client-generated ULID `id`, append-only. Via the push body or
  `POST /api/events/batch`; the server forces `userId` to the caller, stores `ts` as **UTC whole seconds**
  (fraction truncated) and never validates `type` or `payload`. A card's schedule is never stored: it is
  derived by replaying `review` events (`scheduler/`). Details in the Events section below and `events/`.
- Typed study rows (v0.4.0, `study/`): cards, decks, deck settings, limits, FSRS parameter sets and the
  active set travel as the six typed collections above, with fixed shapes (`study/rows.json`), an `extra`
  object for members the shape does not carry, the keyed-row last-write-wins and tombstone rules
  (`study/lww.json`) and one extra rule: an item equal to the stored live row is written nowhere and counted `dataAccepted` (`unchanged`). Every typed row is
  a workspace row. Owner code: `server/internal/study/rows`, `server/internal/study`; web:
  `apps/web/src/lib/studycore/rows.ts`, `store.ts`.
- **The typed families are never keyed rows.** A key of a typed family (`card:`, `deck:`,
  `deckcfg:`, `limits:workspace`, `limits:deck:`, `fsrs:set:`, `fsrs:active`) is 404 on `/api/rows`,
  refused alone in a push and never shipped in `rows` (#198, #199). Pull and push the six typed collections;
  use `rows` only for the keyed rows below.
- The keyed study rows (`goals:workspace`, `study-setup`, `known:*`, `vacation:*`, `milestone:*`), the personal notes (`note:*`,
  `notecfg`), the lookup history (`lookups`, `lookupcfg`) and the user-global UI rows (`home-layout`,
  `activity-view`, `widget-options`, `nav-layout`, `appearance`) are keyed rows (`keyed/`).
- There are no code plugins (#199, record 0006). Flashcards, the reader, the journal and grammar are core
  features with a per-user switch (`features/`: `GET /api/features`, `PUT /api/features/{id} {enabled}`; the
  pull collection `features`). Switching off only hides the feature in the client; the server never refuses
  or hides its data or events.

## Events (`events/`)

- Envelope `{id (ULID), workspaceId, device, ts (RFC 3339), type, payload}`. The server stores `ts` as UTC
  whole seconds (`10:00:00.789+01:00` → `09:00:00Z`), any `type` and any JSON `payload` (absent = `null`,
  returned compact); a repeated id is a duplicate, never an error, and the first copy stays. Batch errors are
  400 `bad_request` (`id` not a ULID, `ts` or `workspaceId` missing; the message names the check) and 404
  `workspace_not_found` (foreign workspace), and store nothing of the batch. `envelope.json`.
- Order everything by `(ts, id)`. **Android sends `ts` already truncated to whole seconds (UTC)** so its local
  copy equals the server copy byte for byte (Ruling in `events/README.md`).
- Reading events: the paged pull's `events` collection (every type except `lookup`, with a delta cursor), or
  `GET /api/events?limit=` in pages (`(ts, id)` order, every type, no cursor; `events/page.json`, #110).
- Types and payloads (`payloads.json`): `session` `null` (once per workspace per learner day; optional for
  Android), `view` `{entryId}` (once per entry page visit; optional), `lookup` never written (legacy
  `{query}`), `review` `{cardId, mode, grade, meta?, replaces?}` (`review-parse.json`: parse, validity, order;
  `review-replace.json`: a changed grade names the review it replaces and only one review of such a family counts,
  everywhere), `read`
  `{bookId, seconds}` (one per reading-timer flush of ≥ 30 whole seconds; consumers ignore `seconds` under 30 (it counts 0),
  cap it at 7200, and count a `read` without `bookId`), `journal` `{entryId: string}` (once per journal entry per learner day
  when its text changed). `read` and `journal` are written exactly so by every client.
- Types: `session`, `view`, `lookup`, `review`, `read` and `journal` are the core's; nothing declares more (the
  plugin manifests are gone, #199). The activity sources (`activity.json` `rules`, `GET /api/stats/activity`
  `sources: [{type, feature, unit}]`) are `review` (flashcards), `read` (the reader) and `journal`; a client
  words them from its own catalogue.
- Heatmap scoring (`activity.json`): per learner day, workspace and type: `review` counts events; `read`
  sums `ceil(min(seconds, 7200) / 300)` per event with `seconds` a number ≥ 30 (raw = the seconds); `journal`
  counts distinct string `entryId`s. Goals and the weekly summary read `raw`.

## Row-key conventions

### Typed study rows (`study/`)

| Collection | Keyed form (backups only) | Identity | Wire shape | Owner code path | Pinned by |
| --- | --- | --- | --- | --- | --- |
| `cards` | `card:<cardId>` | `id` (`c-<kind>-<entryId>` or a ULID) | `{id, kind: vocab\|sentence\|writing\|tone\|reverse\|cloze, entryId: int, written: string\|null, entryKind: "character"\|null, sentenceId: int\|null, skipKinds: kind[] (vocab only), deckIds: string[], createdAt, extra}`; a card may be in several decks | `studycore/rows.ts`, `studycore/readModel.ts`, `features/flashcards/commands/cards.ts`, `studycore/canonical.ts` (`newCardId`); Go `study/rows` | `study/rows.json`, `backup/study-rows.json`, `cards/card-ids.json` |
| `decks` | `deck:<deckId>` | `id` (ULID, or `d-lvl-…`/`d-frq-…` for copies; `general` has no row) | `{id, name, createdAt, source: null \| {type:"level", packId, level} \| {type:"frequency", packId, size}, extra}` | same | `study/rows.json`, `decks/system-deck-ids.json`, `frequency/starter-deck-ids.json` |
| `deckSettings` | `deckcfg:<deckId>` | `deckId` (also `general`) | `{deckId, cardTypes: ("reverse"\|"cloze")[], newOrder: null \| {by:"added"} \| {by:"frequency"} \| {by:"level", packId}, extra}` | `studycore/rows.ts`, `studycore/deckSettings.ts`, `studycore/newOrder.ts` | `study/rows.json`, `frequency/deckcfg-new-order.json` |
| `limits` | `limits:workspace`, `limits:deck:<deckId>` | `deckId` (`null` = the workspace row) | `{deckId, new: null \| {limit: 0..9999 \| null}, reviews: same, extra}`; `null` = not set (deck, then workspace, then 20 new / 200 reviews), `{limit: null}` = unlimited | `studycore/rows.ts`, `studycore/limits.ts` | `study/rows.json`, `scheduler/limits-rows.json`, `scheduler/daily-limits.json` |
| `fsrsSets` | `fsrs:set:<setId>` | `id` | `{id, w: 21 numbers, createdAt, source: "optimized"\|"imported", labelled, logLoss, baselineLogLoss: number\|null, extra}`; weights outside the ts-fsrs ranges make the set unusable (default weights) | `studycore/rows.ts`, `studycore/fsrsParams.ts` | `study/rows.json`, `scheduler/optimizer-steps*.json` |
| `fsrsActive` | `fsrs:active` | one per workspace | `{setId: string\|null, changedAt: string\|null, extra}`; null or dangling = default weights | `studycore/fsrsParams.ts` `resolveState` | `study/rows.json` |

Every typed row also carries `workspaceId`, `version`, `updatedAt` (server write stamp; on push the edit
time) and `deletedAt`.

### Keyed rows

Every row here is a keyed row (`keyed/`; `apps/web/src/lib/sync/keyed.ts`, `server/internal/keyed`): one store,
no namespace, only the families of `keyed/families.json`. "Pinned by" names the fixture or the contract text that
fixes the shape.

| Key | Scope | JSON shape | Owner code path | Pinned by |
| --- | --- | --- | --- | --- |
| `goals:workspace` | workspace | `{version:1, showStreak: bool, history: [{from: "YYYY-MM-DD", metric: "activity:<type>"\|"flashcards:new"\|"flashcards:studyTime"\|null, target: int\|null}]}`; the goal of day D is the last entry with `from <= D`; a version above 1 is never overwritten; unknown keys kept; at most 400 entries; progress is never stored | `goals/goals.ts` | `goals/goal-rows.json` |
| `study-setup` | workspace | `{version: 1, decks: "all" \| [deck id], mode: "decks"\|"levels", schemeId: int\|null, levelName: string\|null, cardTypes: [non-opt-in kind], unchecked: ["reverse"\|"cloze"], newLimit: 1..999, reviewLimit: 1..999, newOrder, typeOrder: "mixed"\|"grouped", grammar: bool}`; the setup the study modal starts; read member by member (a bad member is its default, `"all"` stays live so a new deck joins); repaired member by member (a gone level is decks mode, an explicit list with no deck left is `"all"`, kinds the language lacks are dropped); written only when the learner changes something, unknown members kept, a newer version kept | `features/flashcards/setup/setup.ts`, `features/flashcards/setup/setupStore.svelte.ts` | `study/setup.json` |
| `vacation:<ULID>` | **user-global** (`workspaceId: null`; written without `workspace`) | `{version:1, id, start: "YYYY-MM-DD", end: day \| null, scope: "all" \| {workspaces: int[]}, createdDay, createdAt}` | `studycore/vacation.ts`, `studycore/readModel.ts` (reads rows with no workspace) | `scheduler/vacation-days.json`, `scheduler/vacation-schedule.json` |
| `note:<entryId>` | workspace (the current one, even for an entry of another language) | `{version:1, entryId: int (= the key's number), text: string (plain text, non-empty after trim), ...unknown kept}`; key decimal, positive, no leading zero; absent unless all hold; editor cap 2000 code points; delete = tombstone; restore rewrites key and `entryId` to the target entry, drops it when unresolved | `notes/notes.ts`, `notes/store.ts`; restore: `server/internal/backup/remap.go` | `notes/note-rows.json`, `notes/note-text.json`, `backup/remap.json` |
| `known:<entryId>` | workspace (the book's workspace when written from the reader) | `{version:1, entryId: int (= the key's number), createdAt: RFC 3339, batch?, source?, scope?, ...unknown kept}` (`batch`/`source`/`scope`: the declaration the mark belongs to, #74, `reader/README.md`); key decimal, positive, no leading zero; anything else is ignored; unmark = tombstone, mark again revives the same key; the learner's manual "I know this word" (a known entry for the reader, smart readings and starter decks; creates no card); restore rewrites key and `entryId` to the target entry, drops it when invalid or unresolved | `studycore/knownMarks.ts`, `studycore/commands/keyed.ts` (`setKnownMark`, `setKnownMarks`), `studycore/known.ts`; restore: `server/internal/backup/remap.go` | `reader/word-states.json`, `frequency/known.json`, `backup/remap.json` |
| `milestone:<id>` | workspace | `{version:1, id, seenAt: RFC 3339, reachedDay: "YYYY-MM-DD", ...unknown kept}`; `<id>` is a catalogue id (`reviews:1000`, `level-complete:d-lvl-…`); **seen is decided by the key alone** (a live row = seen whatever its data; a tombstone = not seen); written only when the key is not live, never rewritten, never deleted by any client; unknown ids are kept and count as seen; restore remaps only the workspace | `milestones/seen.ts`, `studycore/commands/keyed.ts` (`saveSeenMilestones`) | `milestones/seen-rows.json`, `milestones/seen-merge.json`, `backup/remap.json` |
| `notecfg` | workspace | `{version:1, onAnswer: bool, ...unknown kept}`; missing, deleted, other version or non-boolean = on | `notes/notes.ts` | `notes/note-rows.json` |
| `lookups` | workspace | `{version:1, clearedAt: RFC 3339 \| null, items: [{entryId: int, count: int 1..1000000, firstAt, lastAt, sources: {reader?, lesson?, search?: int}, books: int[≤3]}], ...unknown kept}`; one row per workspace, at most 500 items newest first; written only by read-merge-write in one flush (10-minute dedupe); Clear = `PUT` with `items: []` and `clearedAt` (never a `DELETE`); restore remaps item entries and books, merges duplicates, drops a row that is not version 1 | `lookups/lookups.ts`, `lookups/recorder.ts`, `lookups/store.ts`; restore: `server/internal/backup/remap.go` | `lookups/lookup-rows.json`, `lookups/lookup-merge.json`, `lookups/lookup-prompt.json`, `backup/remap.json` |
| `lookupcfg` | **user-global** (`workspaceId: null`) | `{version:1, record: bool, ...unknown kept}`; missing, deleted, other version or non-boolean = recording on | `lookups/lookups.ts` | `lookups/lookup-rows.json` |
| `review` event | workspace (events table, not a row) | `payload {cardId, mode: card kind, grade 1..4, meta?: {tier?: 0\|1\|2, mistakes?, hints?, durationMs?}, replaces?: <review id>}`; an unknown `mode` reads as `vocab`; `replaces` (a changed grade, #131) copies the target's `cardId`, `mode`, `meta` and `ts`, and a family of linked reviews counts only its greatest id, before the duplicate-card merge and before anything counts | `studycore/types.ts` `ReviewPayload`, `studycore/reviewParse.ts`, `studycore/replaced.ts`, `server/internal/events` (`Replaced`), `server/internal/stats`, `server/internal/backup` (restore relinks) | `events/review-parse.json`, `events/review-replace.json`, `events/activity.json`, `pwa/outbox-v3.json`, `scheduler/*`, `decks/deck-stats.json` |
| workspace settings key `reader` | workspace row of `workspaces.settings` (not a keyed row) | `{version:1, bookRuby: bool, readings: never\|always\|smart, smartThreshold: 10..100, rubyScale: 0.45\|0.55\|0.65\|0.75, font: default\|sans\|serif\|kai, highlightWords: bool}`; written via `PUT /api/workspaces/{id}` with `settings` merged as RFC 7396 (merged object ≤ 64 KiB); unknown keys kept | `features/reader/displaySettings.ts` | `reader/display-settings.json`, `settings/workspace-settings.json` |
| workspace settings keys `hiddenDictionaries`, `audioAutoplay`, `audioDeviceVoice` | workspace row of `workspaces.settings` | `hiddenDictionaries`: positive integer dictionary ids (others ignored); `audioAutoplay`: bool, default false; `audioDeviceVoice`: bool, default true; same merge | `dictionaryVisibility.ts`, `audio/settings.ts` | `settings/workspace-settings.json` |
| `home-layout` | **user-global** | `{version: 1, widgets: [widget id]}`; a newer version is read leniently; unknown ids are kept stored, in place; no row = the default layout | `widgets/layout.ts` | `settings/core-rows.json` |
| `activity-view` | **user-global** | `{version: 1, scope: "workspace"\|"all", hidden: [activity type]}`; any other version reads as the default | `activity/viewPrefs.ts` | `settings/core-rows.json` |
| `widget-options` | **user-global** | `{version: 1, "activity-heatmap": {layout: "garden"\|"month"\|"week"}}`; no row, a bad version or an unknown layout = `garden`; a newer version is read leniently; every other key kept on write (top-level and inner); re-read before write | `widgets/options.ts` | `settings/widget-options.json` |
| `appearance` | **user-global** | `{version: 1, mode: "system"\|"light"\|"dark", light: {theme, accent}, dark: {theme, accent}, corners: "sharp"\|"soft"\|"round", spacing: "compact"\|"comfortable", hanziFont: "sans"\|"serif"\|"kai"}`; no row = the defaults (qinqin Day / Night, azure / cyan); each member falls back on its own; a newer version is read leniently; unknown members kept on write; never validated by the server, never remapped on restore | `theme/appearance.ts` (next run) | `themes/appearance.json` |
| Overlays (entry edits) | per user and entry (`user_edits`, not a keyed row); pulled as `overlays` | `{entryId, written: string\|null, readings: [{type, value}]\|null, updatedAt}`; `null` = untouched; server-stamped, last arrival wins | `server/internal/overlay` | `overlays/overlay.json` |
| Reader library, bookmarks, highlights, book position | written through `/api/library/books/{id}[/bookmarks\|/highlights\|/position]`; pulled as the `books`, `bookmarks`, `highlights` collections of the paged pull (`sync/`), deletions as tombstones from `library_deletions` | see `library/README.md`, `apps/web/src/lib/api/types.ts` (`Bookmark`, `Highlight`) and `server/internal/library` | `features/reader/bookmarks.ts`, `highlights.ts` | `library/rows.json` |
| `read`, `journal`, `session`, `view` events | workspace (events table, not rows) | see the Events section | `lib/events/eventPayloads.ts` | `events/payloads.json`, `events/activity.json` |
| Grammar lesson and review runs | workspace; study events (`grammar`, #277, #181), in the event log and the pull like reviews | `{point: "<packId>:<lessonId>", mode: "lesson"\|"review", score, total}`; progress (best score, last run) and each learned point's review schedule are replayed by the client | `studycore/grammarRuns.ts`, `studycore/grammarReview.ts`, `features/grammar/progress.ts`, `features/grammar/review/`; server `internal/grammar/events.go` | `grammar/runs.json`, `grammar/review.json` |
| Course progress | workspace; study events (`course`, #221), in the event log, the pull and backups like reviews | `{kind, course, …}`: lesson started/finished (with its words), unit test, section exam, placement; the path state is derived by the client over the filled course | `studycore/courseProgress.ts`, `events/eventPayloads.ts`; server `internal/courses/progress.go` | `courses/derive.json`, `courses/changes.json` |
| Drill answers | workspace; study events (`drill.<id>`, one type per drill), in the event log and the pull like reviews | `{item, mode, grade}`; each item's schedule is replayed by the client (FSRS, default weights) | `studycore/drills.ts`, `features/practice/`; server `internal/drills/`, `stats/rules.go` | `drills/` |
| Journal entries, reviews, topic ideas, settings | workspace (`journal_*` tables, not rows); not in the pull: `/api/journal/*` | see `journal/README.md` | `features/journal/store.ts`; server `internal/journal/store.go` | `journal/entries.json`, `journal/review-docs.json`, `journal/kind-resolve.json` |
| AI examples (#186) | user and entry: kept ones are own sentences (`sentences` with `ai_provider`/`ai_model`; pull `sentences` with `ai`; backup `sentences/` line with `ai`); drafts and reports in their own tables, not in the pull or a backup | see `examples/README.md` | `entry/examples/examples.ts`; server `internal/sentences/examples.go` | `examples/examples.json` |
| Journal conversations (the partner, #185) | workspace (`journal_conversations`, `journal_messages`); not in the pull: `/api/journal/conversations*`; backup key `journal:conversation:<id>` | see `journal/README.md#conversations` | `features/journal/conversation/conversations.ts`; server `internal/journal/conversation.go` | `journal/conversations.json` |

Study-day inputs are not rows: the learner's zone history is `GET/PUT /api/me/time-zone` (`study-day/`).

## Auth and session summary (`auth/`)

- Bearer token: 64 hex characters, returned once by login; send `Authorization: Bearer <token>`; store in
  secure storage. The server keeps only its SHA-256; idle 90 days ends a session. `POST /api/auth/logout`
  ends that session.
- 401 `unauthorized` = session gone (drop the token). 403 never means that; branch on the `error` code in
  `{error, message}` bodies, never the message. Every route answers every error in this shape (no text bodies
  since #168; unknown paths 404 `not_found`); the one catalogue for all routes: `auth/errors.json`, and its
  changelog in `auth/README.md`.
- Restricted sessions: `GET /api/auth/me` returns `restriction` `""|"password_change"|"mfa_enrollment"`. A
  restricted token may call only `me`, `logout` and the route that lifts the restriction; all else is 403
  `password_change_required` / `mfa_enrollment_required` and the token stays valid.
- Two-step sign-in state machine: `auth/mfa-login.json` (`mfa_required` -> `POST /api/auth/login/mfa`,
  `mfa_enrollment_required`, sign-in by emailed code); setup: `auth/mfa-setup.json`; throttling
  (429 `Retry-After`, never retry automatically): `auth/throttling.md`, `auth/throttle-responses.json`.
- Send `deviceName` on login; never log tokens, passwords or one-time codes.
- Personal access tokens (scripts, not the app): `qq_pat_` + 64 hex, created in Settings, shown once, read or
  write, optionally one workspace, always expiring; refused with 403 `token_not_allowed` on every route
  that does not declare token use. A client app signs in with a session, never with an access token.
  `auth/tokens.json`, `auth/tokens-format.json`, `auth/README.md` (Personal access tokens).

## Interface language

- Every user-visible string comes from a catalogue (`i18n/README.md`): the web's
  `apps/web/src/lib/i18n/messages/en.json` is the source of every client key; Android converts it to
  `values/strings.xml` with the reference converter (`apps/web/scripts/i18n-android.mjs`) and keeps Android-only
  keys under `android.*`. Plurals, arguments and rich-text tags follow the shared ICU subset; `messages.json` and
  `android-convert.json` pin both sides.
- The setting: `GET /api/auth/me` carries `interfaceLanguage` (`''` = follow the device); `PUT
  /api/me/interface-language {language}` stores it (422 `invalid_language`; sessions only, never access tokens).
  Resolve with `negotiate.json` (the setting if non-empty, else the device list; `en` today). Formatting uses the
  interface language plus the device region (`negotiate.json` `formatLocale`; English without a region → `en-GB`).
- Show API errors by `error` code from the catalogue (`apiError.*`), never the English `message`. The activity
  sources' labels come from `activity.source.<type>.*`. Study text carries the study language, interface text
  none of its own (`i18n/README.md`, "`lang` and `dir` attributes").
- Android checklist: convert the catalogue, implement `negotiate.json` (both lists), read and write the setting,
  and decode `messages.json`, `plural-categories.json` and `language-tags.json` in the Android tests.

## Study rules (links)

- Day: `study-day/` (`dayOf`, `dayStart`, zone history, `GET/PUT /api/me/time-zone`).
- FSRS: `scheduler/fsrs.json` (ts-fsrs 5.4.2, every parameter, weight validation and migration, the active
  set, a replay oracle with every intermediate card state). Port ts-fsrs against it.
- Duplicate cards are merged at read time before anything counts: `study/canonical.json`.
- Clock, vacation, due, streak, limits: `scheduler/` (vacation shifts the study clock by whole days;
  limits count by the learner's day). XP and levels: `scheduler/xp.json`. Level sessions: `levels/`. Deck
  numbers and system deck ids: `decks/`; character mastery and the map: `decks/char-mastery.json`.
- Reverse and cloze cards, sibling burying, the deck session plan (order, companions, budget, reserve,
  eligibility): `cards/` (`deck-session.json`). Hints on a card (#215): `cards/` (`hints.json`); the setting is the workspace-settings key `hints`. Starter mode (#214): `starter/` (`stages.json`: the stage of a word, what its front shows and the hints it forces; `set.json`); the setting is the workspace-settings key `starter`.
- Daily goal, its amounts (activity cells of the workspace, new cards and capped answer time from the review
  log), day status and goal streak (vacation days neutral): `goals/`.
- Display form of an entry (the headword lists, cards and the reader show, and the `written` snapshot of
  added cards; also what a client builds from the synced lexicon: forms and readings with flags, senses
  with tags): `frequency/display-form.json` (`uk` on the first live sense of an installed dictionary by
  `(dictionaryId, ord, id)` → kana, search-only `sK` never shown, a
  starter deck's kana row shown as written). Reader popup snapshot: `reader/popup-written.json`.
- Weekly summary (Monday to Sunday learner dates, rows, days, comparison, mature and character crossings;
  computed from events, nothing stored, no row key): `weekly/`.
- Stats summary numbers (Stats → Overview; streak, words known, recall over the last 30 days, study time this
  month and the reviews-per-day series — every figure reuses the rules above, computed on the client, nothing
  stored): `stats/`.
- Milestones (catalogue, the first event that reaches a threshold, ever reached, levels complete when every
  member is learned, the `milestone:<id>` seen rows, the card plan and history): `milestones/`.

## Backup archive (`backup/`)

Zip of JSON, `formatVersion` 2 (the only compatibility key; any other version is rejected). Entry names,
row shapes, caps and the remapping of entry, card, workspace and book ids on restore are in
`backup/README.md`; `backup/sample-v2/` is a valid unpacked archive. `workspaceId: null` keyed rows are
exported and restored as global rows. Never in an archive: password hash, email, sessions, TOTP secrets,
AI keys, SMTP settings, QINQIN_SECRET.

## PWA outbox v3 (`pwa/`)

Web-specific storage, binding semantics: a review recorded offline is the ordinary `review` event with its
client ULID, retried safely because the server counts an id once. Outbox items are per user; only the
signed-in user's are flushed, oldest first; a 401 or a restriction 403 stops the flush and keeps items;
other permanent 4xx drop the item; 5xx, 408, 429 and network errors keep it; foreign items expire after
30 days. Offline sessions create no cards. The web keeps the queue in IndexedDB, one record per review,
committed before the POST (write-ahead; a kill right after grading loses nothing), with localStorage as the fallback.

## Device-local state (not shared)

The web keeps these on the device only (`localStorage`, IndexedDB); they are not synced and not part of any
contract, so Android is free to keep its own: the session setup of the study page (`qinqin.study.session`,
card-type memory `qinqin.study.cardTypes`, `qinqin.study.extraTypes`), companions found ineligible
(`qinqin.study.ineligible`, the `skip` set of `cards/deck-session.json`), recently shown sentences
(`qinqin.study.sent.v1`), the review outbox (IndexedDB `qinqin-outbox`; `qinqin.study.pending.v2` is its migrated-away predecessor and fallback, `pwa/`), the `session` event receipt
(`qinqin.session.<ws>.<day>`), the cached zone history (`qinqin.studyDay.<user>`), reader preferences and rail
(`qinqin.reader.prefs`, `qinqin.reader.rail`), the highlight colour (`qinqin.reader.highlightColor`), the
character map grouping (`qinqin.map.groupBy.*`), grammar reading toggles, the journal photo draft, offline
preparation marks (`qinqin.pwa.*`), the current workspace and the session token.

## What the Android client must not cache or store

- Download tickets (`/api/account/export/{ticket}`, `/api/admin/backup/{ticket}`, safety export): single-use,
  60 s, in server memory; a ticket in a path is the credential. Fetch right after issue; never store or log.
- Tokens only in the platform secure store; never in backups, logs or crash reports.
- Never persist passwords, authenticator secrets or recovery codes (shown once), email one-time codes,
  reset links, MFA challenge ids beyond the step in progress, AI provider keys.
- Do not cache other users' data: key every cache and outbox by user (see `pwa/` partition rule).
- Do not cache admin, account, AI, journal photo, audio, search or lookup responses as truth.
- Package files are verified before use, never partially (`packages/README.md`, "Verification"): a download
  that fails a check is discarded, and a package database is opened read-only and replaced as a whole.
- A data pack has no switch: an installed pack is always shown (packs are managed in Settings → Data); only
  the four core features have switches (`features/`).

## Not specified (on purpose)

Nothing Android needs for #34–#38 that today's code defines is missing above. These are left out deliberately,
each with its owner:

- **Grade suggestions** (writing, tone, reverse, word salad), **tone gestures and the writing engine** — the
  learner confirms every grade, so a different suggestion never changes stored data; the native engines are
  #38's own work.
- **Offline search normalisation** (tone- and romaji-insensitive search) — pinned when #36 decides to search
  offline (#36).
- **Journal photos** — the OCR import is online only. The entries, reviews (a client that shows one must show
  the same mistake/suggestion split), topic ideas and settings are pinned (`journal/`), and so are the `journal` and `grammar` event payloads
  (`events/`, `grammar/`).
- **The FSRS optimizer** (training, evaluation) — Android reads `fsrsSets`, it does not optimise; its step input
  is pinned (`scheduler/optimizer-steps.json`).
- **Interface strings and their key scheme** — v0.4.0 prep item 8 (#73).
