# Contracts overview (read this first, Android)

Everything a second client (Kotlin) must do the same way as the web app. The folders next to this file
hold the rules (README) and JSON fixtures; this page says how they fit together and lists every stored
row convention. Where this page and a fixture disagree, the fixture wins (`docs/contracts/README.md`).
Derived from the code on `develop`; each owner path below is where the rule is implemented today.

## How the folders fit

| Layer | Folders |
| --- | --- |
| Identity and transport | `auth/` (token, restrictions, errors, two-step sign-in), `pwa/` (outbox, cache rules) |
| Time | `study-day/` (the learner's day, zone history) is the base of everything below |
| Cards and study | `cards/` (ids, kinds, burying), `levels/` (level sessions), `decks/` (deck numbers, system deck ids, add-to-deck), `scheduler/` (vacation, study clock, due, streak, daily limits), `goals/` (daily goal, day status, goal streak) |
| Reader | `reader/` (display settings, furigana, smart readings) |
| Data safety | `backup/` (archive format v1, id remapping) |
| Personal data on entries | `notes/` (notes and the answer-side switch) |

Read order: `auth/` -> `study-day/` -> this page's sync model -> `cards/` -> `scheduler/` -> `decks/` -> `levels/`.

## Sync model

- Pull: `GET /api/sync/pull?cursor=<RFC 3339>&collections=a,b` (`server/internal/sync/pull*.go`). No cursor
  means everything. The answer is `{cursor, entries, links, senses, levelMembers, sentences, pluginData,
  pluginStates, overlays, dictionaries, schemes, levels}`; every collection is a non-null array. Valid
  `collections` names are exactly those; an unknown one is 400. The returned cursor lags the server clock
  by 30 s and the cursor second is inclusive, so rows can arrive twice: upsert by key. A cursor is only
  valid for the same `collections` list it came from; do not mix subset pulls with one global cursor.
- Push: `POST /api/sync/push {events: [...], pluginData: [...]}` (`server/internal/sync/sync.go`). The whole
  body is validated first; an unknown or foreign workspace or plugin is 404 and nothing is applied; a bad
  item is 400. Answer: `{eventsAccepted, eventDuplicates, dataAccepted, dataSkipped, dataRefused}`.
  `dataRefused` counts rows of plugins that do not declare owns-data (the rest still applies). A value is at
  most 256 KiB (413).
- Plugin data row (wire shape, `model.PluginData`): `{pluginId, key, userId, workspaceId|null, data,
  version, updatedAt, deletedAt|null}`. The identity of a row is `(pluginId, workspaceId, key)`.
- Last write wins by `updatedAt`: the server keeps its row when it is newer than the pushed one (counted
  `dataSkipped`); otherwise it writes the row and stamps its own `updatedAt` and bumps `version`. Two
  devices writing different keys never conflict; writing the same key is decided by `updatedAt`.
- Tombstones: a deleted row stays in the pull with `deletedAt` set and its last `data`. A client treats
  `deletedAt != null` as absent. Deleting an absent or already deleted row counts as skipped.
- `workspaceId: null` rows are user-global (apply to every workspace). Today only `vacation:*` uses this.
  Everything else is per workspace; a write needs a current workspace and never falls back to another.
- Events: append-only study events, idempotent by client-generated ULID `id`. Via the push body or
  `POST /api/events/batch {events:[...]}` -> `{accepted, duplicates}`; the server forces `userId` to the
  caller and keeps `ts` verbatim; `workspaceId` must be owned (else 404). `GET /api/events?since=&workspace=`
  lists them. Event shape: `{id (ULID), workspaceId, device, ts (RFC 3339), type, payload}`, `type` one of
  `session|view|lookup|review|read|journal` (`apps/web/src/lib/events.ts`). A card's schedule is never
  stored: it is derived by replaying `review` events (`scheduler/`).
- The flashcards rows are plugin data of plugin `qinqin-flashcards` (`FLASHCARDS_PLUGIN_ID`); personal notes (`note:*`, `notecfg`) are plugin data of the built-in plugin `qinqin-core` (`CORE_PLUGIN_ID`, which also holds user-global UI rows such as the home layout and the activity view).

## Row-key conventions

Rows belong to plugin `qinqin-flashcards` (`apps/web/src/lib/study/store.ts`) unless the Key column names `qinqin-core`. "Pinned by" names the
fixture or the contract text that fixes the shape.

| Key | Scope | JSON shape | Owner code path | Pinned by |
| --- | --- | --- | --- | --- |
| `deck:<deckId>` | workspace | `{id: string, name: string, createdAt: string, source?: {type:"level", packId, level} \| {type:"plugin", pluginId, key}}`. User decks use a ULID id; copies of system decks use `d-lvl-...` / `d-plg-...`. The implicit `general` deck has no row. | `study/store.ts` (`createDeck`, `renameDeck`, `deleteDeck`), `study/types.ts` `Deck` | `decks/system-deck-ids.json`, `decks/add-to-deck.json` |
| `card:<cardId>` | workspace | `{id, kind: vocab\|sentence\|writing\|tone\|reverse\|cloze, entryId: int, written?, entryKind?: "character", sentenceId?: int, skipKinds?: kind[], deckIds: string[], createdAt}`. Id `c-<kind>-<entryId>`. A card may be in several decks. | `study/canonical.ts` (`newCardId`), `study/store.ts`, `study/types.ts` `StudyCard` | `cards/card-ids.json`, `cards/burying.json`, `levels/level-card-ids.json` |
| `deckcfg:<deckId>` | workspace (also for `general`) | `{deckId, cardTypes: ("reverse"\|"cloze")[], updatedAt, ...unknown kept verbatim}` | `study/deckSettings.ts` | `cards/README.md` (Data); no JSON fixture |
| `limits:workspace` | workspace | `{version:1, new?: int 0..9999 \| null, reviews?: same}`; null = unlimited | `study/limits.ts` | `scheduler/limits-rows.json`, `scheduler/daily-limits.json` |
| `limits:deck:<deckId>` | workspace (`general` allowed) | same fields; deck field, else workspace, else default 20 new / 200 reviews | `study/limits.ts` | same |
| `goals:workspace` | workspace | `{version:1, showStreak: bool, history: [{from: "YYYY-MM-DD", metric: "activity:<type>"\|"flashcards:new"\|"flashcards:studyTime"\|null, target: int\|null}]}`; the goal of day D is the last entry with `from <= D`; a version above 1 is never overwritten; unknown keys kept; at most 400 entries; progress is never stored | `goals/goals.ts` | `goals/goal-rows.json` |
| `vacation:<ULID>` | **user-global** (`workspaceId: null`; written without `workspace`) | `{version:1, id, start: "YYYY-MM-DD", end: day \| null, scope: "all" \| {workspaces: int[]}, createdDay, createdAt}` | `study/vacation.ts`, `study/store.ts` (reads rows with no workspace) | `scheduler/vacation-days.json`, `scheduler/vacation-schedule.json` |
| `fsrs:set:<setId>` | workspace | `{id, w: 21 numbers, createdAt, source: "optimized"\|"imported", labelled?, logLoss?, baselineLogLoss?}`; weights outside ts-fsrs clamp ranges make the row unusable | `study/fsrs/params.ts`, `study/store.ts` | `scheduler/optimizer-steps*.json` (steps only); the row shape has no fixture |
| `fsrs:active` | workspace | `{setId: string \| null, changedAt}`; missing, null or dangling = default weights | `study/fsrs/params.ts` `resolveState` | no fixture |
| `note:<entryId>` (plugin **`qinqin-core`**) | workspace (the current one, even for an entry of another language) | `{version:1, entryId: int (= the key's number), text: string (plain text, non-empty after trim), ...unknown kept}`; key decimal, positive, no leading zero; absent unless all hold; editor cap 2000 code points; delete = tombstone; restore rewrites key and `entryId` to the target entry, drops it when unresolved | `notes/notes.ts`, `notes/store.ts`; restore: `server/internal/backup/remap.go` | `notes/note-rows.json`, `notes/note-text.json`, `backup/remap.json` |
| `notecfg` (plugin **`qinqin-core`**) | workspace | `{version:1, onAnswer: bool, ...unknown kept}`; missing, deleted, other version or non-boolean = on | `notes/notes.ts` | `notes/note-rows.json` |
| `review` event | workspace (events table, not a row) | `payload {cardId, mode: card kind, grade 1..4, meta?: {tier?: 0\|1\|2, mistakes?, hints?, durationMs?}}`; an unknown `mode` reads as `vocab` | `study/types.ts` `ReviewPayload`, `study/reviewParse.ts`, `server/internal/events` | `pwa/outbox-v2.json`, `scheduler/*`, `decks/deck-stats.json` |
| workspace settings key `reader` | workspace row of `workspaces.settings` (not plugin data) | `{version:1, bookRuby: bool, readings: never\|always\|smart, smartThreshold: 10..100, rubyScale: 0.45\|0.55\|0.65\|0.75, font: default\|sans\|serif\|kai}`; written via `PUT /api/workspaces/{id}` with `settings` merged as RFC 7396; unknown keys kept | `plugins/reader/displaySettings.ts` | `reader/display-settings.json` |
| Reader library, bookmarks, highlights, book position | **not sync rows**: server tables under `/api/library/books/{id}[/bookmarks\|/highlights\|/position]` | see `apps/web/src/lib/api/types.ts` (`Bookmark`, `Highlight`) and `server/internal/api` library handlers | `plugins/reader/bookmarks.ts`, `highlights.ts` | only through `backup/sample-v1/library/*`; no API fixture |
| `read` events (reading time) | workspace (events) | free `payload`, aggregated by `lib/stats/readingTime.ts` | `plugins/reader/readingTimer.ts` | no fixture |

Study-day inputs are not rows: the learner's zone history is `GET/PUT /api/me/time-zone` (`study-day/`).

## Auth and session summary (`auth/`)

- Bearer token: 64 hex characters, returned once by login; send `Authorization: Bearer <token>`; store in
  secure storage. The server keeps only its SHA-256; idle 90 days ends a session. `POST /api/auth/logout`
  ends that session.
- 401 `unauthorized` = session gone (drop the token). 403 never means that; branch on the `error` code in
  `{error, message}` bodies, never the message. The full catalogue: `auth/errors.json`.
- Restricted sessions: `GET /api/auth/me` returns `restriction` `""|"password_change"|"mfa_enrollment"`. A
  restricted token may call only `me`, `logout` and the route that lifts the restriction; all else is 403
  `password_change_required` / `mfa_enrollment_required` and the token stays valid.
- Two-step sign-in state machine: `auth/mfa-login.json` (`mfa_required` -> `POST /api/auth/login/mfa`,
  `mfa_enrollment_required`, sign-in by emailed code); setup: `auth/mfa-setup.json`; throttling
  (429 `Retry-After`, never retry automatically): `auth/throttling.md`, `auth/throttle-responses.json`.
- Send `deviceName` on login; never log tokens, passwords or one-time codes.

## Study rules (links)

- Day: `study-day/` (`dayOf`, `dayStart`, zone history, `GET/PUT /api/me/time-zone`).
- Clock, vacation, due, streak, limits: `scheduler/` (vacation shifts the study clock by whole days;
  limits count by the learner's day). Level sessions: `levels/`. Deck numbers and system deck ids: `decks/`.
- Reverse and cloze cards, sibling burying: `cards/`.
- Daily goal, its amounts (activity cells of the workspace, new cards and capped answer time from the review
  log), day status and goal streak (vacation days neutral): `goals/`.

## Backup archive (`backup/`)

Zip of JSON, `formatVersion` 1 (the only compatibility key; unknown versions are rejected). Entry names,
row shapes, caps and the remapping of entry, card, workspace and book ids on restore are in
`backup/README.md`; `backup/sample-v1/` is a valid unpacked archive. `workspaceId: null` plugin rows are
exported and restored as global rows. Never in an archive: password hash, email, sessions, TOTP secrets,
AI keys, SMTP settings, QINQIN_SECRET.

## PWA outbox v2 (`pwa/`)

Web-specific storage, binding semantics: a review recorded offline is the ordinary `review` event with its
client ULID, retried safely because the server counts an id once. Outbox items are per user; only the
signed-in user's are flushed, oldest first; a 401 or a restriction 403 stops the flush and keeps items;
other permanent 4xx drop the item; 5xx, 408, 429 and network errors keep it; foreign items expire after
30 days. Offline sessions create no cards.

## What the Android client must not cache or store

- Download tickets (`/api/account/export/{ticket}`, `/api/admin/backup/{ticket}`, safety export): single-use,
  60 s, in server memory; a ticket in a path is the credential. Fetch right after issue; never store or log.
- Tokens only in the platform secure store; never in backups, logs or crash reports.
- Never persist passwords, authenticator secrets or recovery codes (shown once), email one-time codes,
  reset links, MFA challenge ids beyond the step in progress, AI provider keys.
- Do not cache other users' data: key every cache and outbox by user (see `pwa/` partition rule).
- Do not cache admin, account, AI, journal photo, audio, search or lookup responses as truth.

## Gaps (no fixture yet)

- No JSON fixture for the shapes of `deck:*`, `card:*` rows, `deckcfg:*`, `fsrs:set:*`, `fsrs:active` (only
  the ids and the derived rules are pinned); the table above is derived from the TypeScript parsers.
- Reader library, bookmarks, highlights, position and `read` event payloads have no contract fixture; they
  are not part of the sync pull (Delta has no library collection).
- `POST /api/sync/push` and `GET /api/sync/pull` response shapes are covered by Go tests in
  `server/internal/sync`, not by a shared JSON fixture.
- Event `payload` shapes of `session`, `view`, `lookup`, `journal` are not specified here.
