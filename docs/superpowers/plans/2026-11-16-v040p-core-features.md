# Flashcards and the reader as core features (issue #85) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model with a sync/data-safety focus, one
> fix wave, mutation checks of at least three new tests). Steps use checkbox (`- [ ]`) syntax. Strictly
> test-first: write the test, run it, SEE IT FAIL, implement, see it pass.

**Goal:** Cards, decks, deck settings, limits, FSRS sets and the active set move from `qinqin-flashcards`
plugin rows into typed core tables served as typed pull/push collections; the library gains row stamps, a
deletion log and a fixture; flashcards and the reader leave the plugin system on the web (core routes,
Settings → Features, core credits); old shells, outboxes, v1 archives and token scripts keep working.

**Architecture:** `server/internal/study/rows` (typed shapes + legacy codec, no DB) is the one place that
knows the shapes; `server/internal/study` (store: LWW apply, pull, legacy view) uses it; the migration Go
step, `sync`, `api` (plugin-data routes), `backup` (export/restore) and `journal` call it. No new routes.
Web: `lib/study/rows.ts` (typed wire parse/serialize), `lib/study/store.ts` on typed collections,
`lib/features/` (core feature registry), core routes `/flashcards`, `/reader`.

**Tech stack:** Go 1.26 stdlib, SQLite, SvelteKit 2 / Svelte 5, vitest. No new dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-16-v040p-core-features-design.md`.
Background: `docs/contracts/overview.md`, `docs/contracts/backup/README.md`, `docs/contracts/pwa/README.md`,
`docs/superpowers/specs/2026-11-15-plugin-sdk-design.md`.

**Branch / worktree:** `feature/v040p-core-features`, worktree
`/home/user/qinqin/.claude/worktrees/core-features` (`<wt>`). Before Task A1: merge `feature/v0.4.0-prep`
(items 1–3) into this branch (`git merge --no-ff feature/v0.4.0-prep`); never rebase.

**Migration number:** the next free number at build time (`ls server/internal/db/migrations | tail -1` + 1;
`038` today). Write it in the Execution record. Never renumber a merged migration.

## Gates

- Go (under the lock, proxies unset, targeted packages):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet <pkgs> && go test -count=1 -p 2 -timeout 30m <pkgs>'`
  `gofmt -l` prints nothing. ONE full `./...` run before the branch's last commit (known env failure:
  `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` only; `library/sources` waiter flake: rerun
  with `-count=3`). No `-race` needed (no new concurrency) except `./internal/study` once if the builder adds
  any shared state.
- Web: `npm --prefix <wt>/apps/web ci` once; per web task `run check`, `test`, `run build` (read exit codes,
  never `| tail`); targeted `cd apps/web && npx vitest run <paths>`. Before the last commit the full vitest
  once with Node 26: `cd apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- `node scripts/gen-api-docs.mjs --check` exits 0 after every task (no route changes are expected: if it
  fails, a route changed by mistake).
- Route walk, `routes.fixture.json` and `auth/tokens-routes.json` must pass UNCHANGED (no route is added).
- One commit per task, explicit `git add <files>`, message ends with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never merge to anything. `git status` clean.

## Global constraints

- Typed families and keys (exact): `card:<id>` → cards, `deck:<id>` → decks, `deckcfg:<deckId>` →
  deckSettings, `limits:workspace` and `limits:deck:<deckId>` → limits, `fsrs:set:<id>` → fsrsSets,
  `fsrs:active` → fsrsActive; namespace `qinqin-flashcards`. Every other key of that namespace stays a
  `plugin_data` row (`goals:workspace`, `known:*`, `vacation:*`, unknown keys).
- Wire collection names: `cards`, `decks`, `deckSettings`, `limits`, `fsrsSets`, `fsrsActive`.
- Every typed key is always present on the wire; `extra` is always a JSON object; `version` is ignored on
  push; `updatedAt` on push is the edit time.
- No new field caps (spec Q2). Per typed item 256 KiB encoded (413); push body 8 MiB.
- One storage: nothing writes study families to `plugin_data` after the migration (a test greps for it).
- Fixtures: `{"version": 1, "rule": "<name>", "cases": [...]}`; a fixture changes only after re-deriving
  from its source of truth (here: the v0.3.0 TS parsers in `apps/web/src/lib/study/*.ts` at tag `v0.3.0`).

## Review focus (strongest model; must-fix findings block)

1. **No data loss.** Migration moves exactly the readable rows (parity with the v0.3.0 TS parsers), keeps
   version/stamps/tombstones, deletes nothing unreadable, never touches `study_events`; every card id of the
   real-app check survives.
2. **LWW and tombstones** identical to plugin data for typed collections and the legacy view; equal-content
   skip; deleting absent/deleted rows skipped; clamping of future edit times.
3. **Legacy view** exactly as spec Q9: the pull rule (named `pluginData`, no typed collection), push/PUT
   decode with refusal alone, DELETE and GET fallbacks; no dual writes.
4. **Isolation.** `user_id` in every query; foreign workspace 404 with nothing applied; two-user tests for
   every collection and every legacy path; workspace and account deletion complete (schema guard).
5. **Backup.** v1 unchanged; typed rows exported as legacy rows with no duplicate keys; restore remaps then
   decodes; unreadable typed rows dropped and counted; library deletion log and tombstones never exported.
6. **Web.** Offline study still works from the saved pull; no study write path left on plugin-data routes
   for typed families; switch semantics (hide only, never refuse).

---

## Phase A — server storage, migration, typed API

### Task A1: Contract fixtures for typed rows, the codec and LWW

**Files:** Create `docs/contracts/study/README.md`, `docs/contracts/study/rows.json`,
`docs/contracts/study/legacy-codec.json`, `docs/contracts/study/lww.json`.

- [ ] Derive every case from the v0.3.0 TS parsers (`git show v0.3.0:apps/web/src/lib/study/store.ts`,
  `deckSettings.ts`, `limits.ts`, `fsrs/params.ts`, `newOrder.ts`, `canonical.ts`):
  - `rows.json`: per collection, `valid` wire rows (every optional member null/set, every deck source
    variant, every `newOrder` variant, limits `null` / `{"limit": null}` / `{"limit": 0}` / `{"limit": 9999}`,
    fsrsActive with `setId: null`) and `invalid` wire rows with the reason (unknown kind, `entryId` 1.5,
    `w` of 20 numbers, limit 10000, missing key, `extra` not an object, unknown top-level member).
  - `legacy-codec.json`: cases `{key, data, expect: {collection, row} | "unreadable"}` plus `roundTrip`
    (the legacy object `ToLegacy` writes back). Must include: key/id mismatch (unreadable), duplicate and
    non-string `deckIds` (cleaned), `skipKinds` on a vocab and on a sentence card (cleaned / to `extra`),
    `entryKind: "word"` (to `extra`), invalid deck `source` (to `extra`), deckcfg with inner `updatedAt`
    (dropped; written back from `modified_at`), invalid `newOrder` kept in `extra` (same as
    `frequency/deckcfg-new-order.json`), limits version 2 (unreadable), limits with one usable and one
    unusable field, `fsrs:active` with non-object data (unreadable), unknown members (to `extra`).
  - `lww.json`: `{stored: row|null, push: {updatedAt, deletedAt?, row}, now, expect: "applied"|"skipped",
    storedAfter}` — newer wins, older skipped, same second client wins, future clamped to `now`, delete of
    absent/deleted skipped, revival after tombstone, equal content skipped.
- [ ] README: the six collections, identity per collection, the wire shape (spec "Data migration"), the
  `extra` and shadowing rule, LWW, tombstones, the legacy view (spec Q9) and that Android never uses it.
- [ ] No test yet decodes them (A3 Go, B1 web). Commit `docs(contracts): typed study rows, legacy codec and LWW fixtures`.

### Task A2: Migration SQL `NNN_core_study.sql`

**Files:** Create `server/internal/db/migrations/NNN_core_study.sql`, `server/internal/db/migrate_NNN_test.go`.

- [ ] Test first (`migrate_NNN_test.go`): after migrating an empty DB the six `study_*` tables exist with
  the spec's columns, primary keys and `(user_id, updated_at)` indexes; CHECKs refuse `kind='x'`,
  `entry_kind='word'`, `new_limit=10000`, `source='other'`, `extra='[]'`; `library_books.updated_at`
  exists; `library_bookmarks`/`library_highlights` use AUTOINCREMENT (`sqlite_sequence` row after insert,
  deleted max id not reused); their indexes from 020/021 exist; `library_deletions` exists with its CHECK
  and index. A pre-migration DB with books/bookmarks/highlights keeps every id and column (copy verbatim,
  `updated_at = created_at`). FK test with `PRAGMA foreign_keys = ON` passes. Run: fails.
- [ ] Write the SQL (create-copy-drop-rename for the two library tables, as 023). Run: passes.
  Commit `feat(db): typed study tables and library row stamps`.

### Task A3: `study/rows` — typed shapes and the legacy codec

**Files:** Create `server/internal/study/rows/rows.go`, `codec.go`, `rows_test.go`, `codec_test.go`.

```go
package rows
const Namespace = "qinqin-flashcards"
type Family string // "cards","decks","deckSettings","limits","fsrsSets","fsrsActive"
var Families = []Family{Cards, Decks, DeckSettings, Limits, FsrsSets, FsrsActive}
var ErrUnreadable = errors.New("study rows: unreadable legacy row")
var ErrInvalid = errors.New("study rows: invalid row")
type Meta struct { WorkspaceID int64 `json:"workspaceId"`; Version int `json:"version"`; UpdatedAt time.Time `json:"updatedAt"`; DeletedAt *time.Time `json:"deletedAt"` }
type Card struct { ID, Kind string; EntryID int64; Written, EntryKind *string; SentenceID *int64; SkipKinds, DeckIDs []string; CreatedAt string; Extra json.RawMessage; Meta }
type DeckSource struct { Type string; PackID, Level, PluginID, Key string; Size int64 } // tagged union, custom JSON
type Deck struct { ID, Name, CreatedAt string; Source *DeckSource; Extra json.RawMessage; Meta }
type DeckSettings struct { DeckID string; CardTypes []string; NewOrder json.RawMessage /* null or a valid NewOrder */; Extra json.RawMessage; Meta }
type LimitField struct { Limit *int `json:"limit"` }
type Limits struct { DeckID *string; New, Reviews *LimitField; Extra json.RawMessage; Meta }
type FsrsSet struct { ID string; W []float64; CreatedAt, Source string; Labelled, LogLoss, BaselineLogLoss *float64; Extra json.RawMessage; Meta }
type FsrsActive struct { SetID, ChangedAt *string; Extra json.RawMessage; Meta }
type Row interface { Family() Family; Identity() string /* id, deckId, "" */; M() *Meta }
func FamilyOf(key string) (Family, bool)
func FromLegacy(key string, data json.RawMessage) (Row, error)  // ErrUnreadable; Meta left zero
func ToLegacy(r Row) (key string, data json.RawMessage)
func Decode(f Family, raw json.RawMessage) (Row, error)         // strict wire decode (unknown member: ErrInvalid)
func Validate(r Row) error                                       // ErrInvalid with the member named
func Equal(a, b Row) bool                                        // typed members + extra as JSON values
```

- [ ] Tests first: decode `docs/contracts/study/rows.json` (valid decode + encode back equal as JSON values;
  invalid → `ErrInvalid`) and `legacy-codec.json` (expect, unreadable, roundTrip); the shadowing rule
  (`Validate` drops `extra` members named like a set typed member); JSON of every type always has every key.
  Run: fails. Implement. Run: passes. Gate `./internal/study/...`.
  Commit `feat(study): typed study rows and the legacy row codec`.

### Task A4: Migration Go step — move the rows

**Files:** `server/internal/db/gosteps.go` (key `"NNN_core_study"`), `server/internal/db/migrate_NNN_test.go`.

- [ ] Test first: build a v0.3.0-shaped DB (migrate to the previous version, insert with SQL): two users,
  three workspaces; for user 1 every family live, one tombstoned card and one tombstoned deck, a `card:` with
  `entryId` 1.5, a `limits:workspace` with version 2, a `card:` row with `workspace_id` NULL, a `card:` row
  whose workspace belongs to user 2, `goals:workspace`, `known:5`, `vacation:<ULID>` (NULL workspace),
  `qinqin-core` notes; rows with and without `modified_at`; 50 review events. Migrate to `NNN`. Assert: every
  readable row is in its table with the same identity, `version`, `updated_at`, `COALESCE(modified_at,
  updated_at)`, `deleted_at`; its `plugin_data` row is gone; the four unreadable/foreign rows, goals, known,
  vacation and notes rows are byte-identical in `plugin_data`; `study_events` byte-identical; the log line
  counts; `ToLegacy` of every moved row equals the original data as JSON values (modulo codec cleaning, per
  fixture). The go-steps key test passes. Run: fails. Implement (`rows.FromLegacy`, one prepared insert per
  table, delete by rowid). Run: passes. Gate `./internal/db`.
  Commit `feat(db): move flashcards rows into typed study tables`.

### Task A5: `study` store — LWW apply, reads, pull

**Files:** Create `server/internal/study/store.go`, `store_test.go`.

```go
package study
type Querier interface { ExecContext(...); QueryContext(...); QueryRowContext(...) } // *sql.DB or *sql.Tx
type Delta struct { Cards []rows.Card; Decks []rows.Deck; DeckSettings []rows.DeckSettings; Limits []rows.Limits; FsrsSets []rows.FsrsSet; FsrsActive []rows.FsrsActive }
func Apply(ctx context.Context, q Querier, userID int64, r rows.Row, edited time.Time, deleted bool) (applied bool, err error)
func Pull(ctx context.Context, q Querier, userID int64, since time.Time, only map[rows.Family]bool) (Delta, error) // zero since: live only; every slice non-nil
func ListCards(ctx context.Context, q Querier, userID, workspaceID int64) ([]rows.Card, error)            // live
func Get(ctx context.Context, q Querier, userID, workspaceID int64, f rows.Family, identity string) (rows.Row, bool, error)
func InsertRestored(ctx context.Context, tx *sql.Tx, userID int64, r rows.Row, modifiedAt time.Time) error // keeps r.Version, r.UpdatedAt
```

- [ ] Tests first: decode `docs/contracts/study/lww.json` and run each case through `Apply` with an injected
  clock; version bump per applied write; equal content skipped; tombstone keeps the last data; revival;
  `Pull` per family since a cursor (inclusive second), tombstones only for a non-zero cursor, ordering by
  `updated_at` then identity; two users never see each other's rows; `Get`/`ListCards` skip tombstones.
  Run: fails. Implement. Run: passes. Gate `./internal/study/...`.
  Commit `feat(study): last-write-wins store for typed study rows`.

### Task A6: Sync — typed collections in pull and push

**Files:** `server/internal/sync/pull_all.go`, `sync.go`, `wire.go`; tests `sync_study_test.go` (new),
`sync_registry_test.go`, `pull_semantics_test.go`.

```go
// Delta gains:
Cards []rows.Card `json:"cards"`; Decks []rows.Deck `json:"decks"`; DeckSettings []rows.DeckSettings `json:"deckSettings"`
Limits []rows.Limits `json:"limits"`; FsrsSets []rows.FsrsSet `json:"fsrsSets"`; FsrsActive []rows.FsrsActive `json:"fsrsActive"`
// PushBody gains the same six json.RawMessage arrays, decoded per item with rows.Decode.
var Collections = []string{..., "cards", "decks", "deckSettings", "limits", "fsrsSets", "fsrsActive"}
```

- [ ] Tests first: `collections=cards` returns only cards (other arrays `[]`, non-null); every new name is
  valid, `?collections=card` 400; push of each collection applies with LWW and counts in
  `dataAccepted`/`dataSkipped`; a malformed typed item → `ErrInvalid` (400) and nothing applied (events
  included); a foreign or unknown `workspaceId` → 404, nothing applied; a typed item above 256 KiB → 413
  through the handler (`api/handlers_body_limits_test.go`); a push mixing events, pluginData and typed rows
  applies all three; handler JSON shape for pull with every key present. Run: fails. Implement. Run:
  passes. Gate `./internal/sync ./internal/api`.
  Commit `feat(sync): typed study collections in pull and push`.

### Task A7: Legacy view in sync — old-shell pull and push

**Files:** `server/internal/sync/pull_all.go`, `sync.go`; create `server/internal/study/legacy.go`,
`legacy_test.go`; create `docs/contracts/study/legacy-view.json`; test `server/internal/sync/legacy_view_test.go`.

```go
// study
func LegacyRows(ctx context.Context, q Querier, userID int64, since time.Time) ([]model.PluginData, error) // typed rows as legacy rows; zero since: live only
func ApplyLegacy(ctx context.Context, q Querier, userID int64, row model.PluginData, edited time.Time) (applied bool, err error) // rows.ErrUnreadable when the codec refuses
// sync
func legacyView(only map[string]bool) bool // only != nil && only["pluginData"] && no typed name in only
```

- [ ] `legacy-view.json` cases (derived from v0.3.0 `store.ts`: `SYNC_PULL_PATH`, `pushStudyRows`, `putData`,
  `deleteData`, `saveVacation`): request, setup rows, expected response rows/counters.
- [ ] Tests first (decode the fixture): `collections=pluginData,pluginStates` gets every typed row as its
  legacy row (cursor and tombstone rules; leftover unreadable `plugin_data` rows also present, as before);
  `collections=pluginData,cards` and no `collections` get none; a legacy push row of a typed family applies
  to the typed table (LWW against `modified_at`), an unreadable one is `dataRefused` while events and other
  rows apply; a legacy tombstone row tombstones the typed row; `known:`/`goals:`/`vacation:` rows still go
  to `plugin_data`; `qinqin-flashcards` still exists for `CanWriteData` (registry row kept, A9). A static
  test: no code outside `db` migrations and `study` writes `plugin_data` rows of a typed family
  (grep `pack_id` writers / `PutData` callers with typed prefixes). Run: fails. Implement. Run: passes.
  Gate `./internal/study/... ./internal/sync`.
  Commit `feat(sync): legacy view of study rows for old web shells`.

### Task A8: Legacy view on the plugin-data routes

**Files:** `server/internal/api/handlers_plugins.go`; tests `handlers_plugins_legacy_test.go` (new);
`docs/contracts/auth/errors.json` (code `study_row_invalid`, 400) and regenerated `docs/wiki/API-Errors.md`.

- [ ] Tests first: `GET /api/plugins/qinqin-flashcards/data/card:<id>?workspace=` returns the legacy row of
  the typed row (404 when absent in both stores, the `plugin_data` row when only a leftover exists); `GET
  .../data?prefix=card:&workspace=` merges typed legacy rows and leftovers in key order, typed winning a
  shared key; `PUT` of a typed key writes the typed table (server time as edit time, response = legacy row,
  version bumped), unreadable data → 400 `study_row_invalid`; `DELETE` tombstones the typed row, falls back
  to `plugin_data`, 404 when neither; two users (user 2 never reads or writes user 1's rows; foreign
  `workspace` 404); tokens: a read token GETs (200), a read token PUTs (403 `token_read_only`), a token limited
  to workspace A on `?workspace=B` (403 `token_workspace`) — rules unchanged. Run: fails. Implement. Run:
  passes. `node scripts/gen-api-docs.mjs`. Gate `./internal/api`.
  Commit `feat(api): plugin-data routes serve study rows through the legacy view`.

### Task A9: Registry — reserved core rows, events move to core

**Files:** `server/internal/plugins/builtin/{core,flashcards,reader}.json`, `server/internal/plugins/builtin.go`
(order), `builtin_test.go`, `activity_test.go`, `server/cmd/qinqin/main.go` (registration), `api/handlers_stats_test.go`.

- [ ] Tests first: `core.json` (1.2) declares `session`, `view`, `lookup`, `review` (activity "Flashcard
  reviews"), `read` (the reading measure rule) verbatim from the old manifests; `flashcards.json` and
  `reader.json` (2.0) parse with empty surfaces/events (`owns-data` only for flashcards); registering the
  built-ins over a DB holding the v0.3.0 rows logs no conflict (reserved rows registered before core, or
  conflicts filtered); `ActivityRules` lists `review`, `read`, `journal` with plugin `qinqin-core` for the
  first two; `GET /api/stats/activity` sources likewise; admin `POST /api/admin/plugins` with id
  `qinqin-reader` → 409; `GET /api/plugins` still lists both reserved ids with the caller's state; `PUT
  /api/plugins/qinqin-reader/state` works. Run: fails. Implement. Run: passes. Gate `./internal/plugins
  ./internal/api ./cmd/qinqin`. Commit `feat(plugins): flashcards and reader become reserved core rows`.

### Task A10: Other server readers, workspace and account deletion

**Files:** `server/internal/journal/suggest_input.go` (+ test), `server/cmd/qinqin/seed.go` (+ test),
`server/internal/api/handlers_workspaces.go` (+ `handlers_workspaces_delete_test.go`),
`server/internal/auth/delete.go` (+ registry/guard tests), `apps/web/src/lib/account/*` preview text if it
lists counts (+ dom test).

- [ ] Tests first: journal suggestions read cards from `study_cards` (a live typed card appears, a
  tombstoned one does not); `warnEntryIDUsers` counts `study_cards`; deleting workspace A removes A's rows
  from all six tables (B untouched) and records library deletions for A's books, bookmarks, highlights;
  `UserTables()` has an entry for each `study_*` table and `library_deletions` (schema guard test passes:
  every user-reference column named once); `DeleteUser` removes them; `DeletionPreview.cards` counts live
  cards and the account deletion dialog shows it. Run: fails. Implement. Run: passes. Gate `./internal/journal
  ./internal/api ./internal/auth ./cmd/qinqin`; web targeted tests.
  Commit `feat(study): journal, seed, workspace and account deletion use typed study tables`.

### Task A11: Library row stamps, deletion log, library fixture

**Files:** `server/internal/library/{library,bookmarks,highlights}.go` (+ tests),
`server/internal/api/handlers_library.go`, `handlers_bookmarks.go`, `handlers_highlights.go` (+ tests);
create `docs/contracts/library/README.md`, `docs/contracts/library/rows.json`;
`server/internal/api/contract_library_test.go` (new).

- [ ] Tests first: book JSON has `updatedAt` (set on create, position PUT, rename if any); bookmark JSON has
  `updatedAt` (create, relabel); highlight edit stamps `updatedAt`; every delete path (book with its
  bookmarks and highlights, one bookmark, one highlight, workspace, `DeleteWorkspaceBooks`) writes one
  `library_deletions` row per removed row in the same transaction (a failing insert rolls the delete back);
  `contract_library_test.go` decodes `rows.json` (book, bookmark, highlight, position shapes as the routes
  serve them; position `<chapter>:<paragraph>`; colors; code-point ranges; non-overlap; 404 for foreign ids)
  and drives each case against the handlers with two users. Run: fails. Implement. Run: passes. Gate
  `./internal/library/... ./internal/api`. Commit `feat(library): row stamps, deletion log and the library contract`.

### Task A12: Backup export — typed rows as v1 legacy rows

**Files:** `server/internal/backup/export.go`, `export_test.go`, `format.go` (`AppVersion` untouched until release).

- [ ] Tests first: export of a user with typed rows writes them into `plugin-data/NNNNNN.jsonl` through
  `rows.ToLegacy` (`pluginId` `qinqin-flashcards`, key, data, `version`, `updatedAt`, `modifiedAt`), live
  rows only, card entries listed in `refs/entries.json` (and sentences in `refs/sentences.json`) as before;
  no leftover unreadable typed-family `plugin_data` row is written (no duplicate keys: the archive
  validates); `library_deletions` absent; `formatVersion` 1; counts include typed rows under `pluginData`.
  Run: fails. Implement. Run: passes. Gate `./internal/backup ./internal/api`.
  Commit `feat(backup): export typed study rows as v1 plugin rows`.

### Task A13: Backup restore — v1 archives into typed tables

**Files:** `server/internal/backup/restore.go`, `plan.go`, `restore_test.go`, `api/contract_backup_test.go`,
`docs/contracts/backup/sample-v1/plugin-data/000001.jsonl` and `manifest.json` (extended), `docs/contracts/backup/README.md`.

- [ ] Extend `sample-v1` with one row of each missing family (`deck:`, `deckcfg:` with `newOrder`,
  `limits:workspace`, `limits:deck:general`, `fsrs:set:`, `fsrs:active`), shapes copied from the v0.3.0
  parsers; recompute `counts.pluginData`, `bytes`, `sha256` (`sha256sum`, `wc -c`); record the change in the
  Execution record.
- [ ] Tests first: restoring `sample-v1` lands every typed row in its table with remapped workspace ids and
  remapped card ids (`c-<kind>-<entryId>` rewrite as `remap.json`), `version`/`updatedAt`/`modifiedAt` kept;
  review events follow; an unreadable typed row is dropped and counted in `droppedRows` (dry-run report
  too); `remap.json` and `reject.json` pass unchanged; export → restore → export round trip equal modulo
  ids; a restore clears the user's `library_deletions` and typed tombstones. Run: fails. Implement (remap on
  legacy rows as today, then `rows.FromLegacy` + `study.InsertRestored`). Run: passes. Gate `./internal/backup
  ./internal/api`. Commit `feat(backup): restore v1 archives into typed study tables`.

## Phase B — web client on the new API

### Task B1: `lib/study/rows.ts` — typed wire rows

**Files:** Create `apps/web/src/lib/study/rows.ts`, `rows.test.ts`.

```ts
export type StudyCollection = 'cards' | 'decks' | 'deckSettings' | 'limits' | 'fsrsSets' | 'fsrsActive';
export const STUDY_COLLECTIONS: readonly StudyCollection[];
export interface RowMeta { workspaceId: number; version: number; updatedAt: string; deletedAt: string | null }
export interface CardRow extends RowMeta { id: string; kind: StudyCardKind; entryId: number; written: string | null;
  entryKind: 'character' | null; sentenceId: number | null; skipKinds: StudyCardKind[]; deckIds: string[];
  createdAt: string; extra: Record<string, unknown> }
// DeckRow, DeckSettingsRow, LimitsRow ({ deckId: string | null; new: { limit: number | null } | null; reviews: same }),
// FsrsSetRow, FsrsActiveRow likewise (spec "Data migration")
export function parseRow(c: StudyCollection, raw: unknown): StudyRow | null; // strict, mirrors rows.Decode
export function cardOf(r: CardRow): StudyCard;  export function cardRow(c: StudyCard, extra?: Record<string, unknown>): Omit<CardRow, keyof RowMeta>;
export function deckOf / deckRow, settingsOf / settingsRow, limitsOf (-> Partial<LimitPair>) / limitsRow, setOf / setRow;
export function identityOf(c: StudyCollection, r: StudyRow): string;
```

- [ ] Tests first: decode `docs/contracts/study/rows.json` (valid → parse → serialize equal; invalid → null)
  and `lww.json`'s row shapes; `limitsOf` maps `null`/`{limit:null}`/`{limit:n}` to absent/null/n; `extra`
  is passed through unchanged. Run: fails. Implement. Run: passes.
  Commit `feat(study): typed study row parsing on the web`.

### Task B2: Store read path on typed collections

**Files:** `apps/web/src/lib/study/store.ts`, `store.test.ts`, `studyData.test.ts` (if it mocks the pull).

- [ ] Tests first: `SYNC_PULL_PATH` = `/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates,cards,decks,deckSettings,limits,fsrsSets,fsrsActive`;
  `fetchStudyData` builds the same `StudyData` as before from typed rows of the workspace (cards, decks,
  deck settings incl. `newOrder`, limits, FSRS state via `resolveState`) and keeps reading `goals:workspace`,
  `known:*`, `vacation:*` from `pluginData`; `pluginData` rows of typed-family keys are ignored (leftovers);
  `knownAt` is keyed `<collection>:<identity>` from `updatedAt`/`deletedAt`; tombstones skipped; other
  workspaces ignored. Every existing read test still passes after its mock is rewritten to typed rows.
  Run: fails. Implement. Run: passes. Commit `feat(study): read study state from typed collections`.

### Task B3: Store write paths on typed push

**Files:** `apps/web/src/lib/study/store.ts`, `store.test.ts`, callers using `studyRowKey` /
`pushStudyRows` (`lib/plugins/flashcards/decks/*.ts`, `lib/study/cardFlow.ts`, `cardActions.ts`).

```ts
export interface StudyWrite { collection: StudyCollection; row: StudyRowBody; knownAt?: string; deleted?: true }
export async function pushStudy(workspaceId: number, writes: readonly StudyWrite[],
  opts?: { chunk?: number; onProgress?: (done: number, total: number) => void }): Promise<void>; // PartialPushError unchanged
export const studyRowKey: { deck(id: string): string; card(id: string): string }; // now `<collection>:<identity>` for knownAt maps
```

- [ ] Tests first: `createDeck`, `renameDeck`, `deleteDeck`, `saveDeckCardTypes`, `saveDeckNewOrder`,
  `addCard`, `deleteCards`, `restoreCards`, `moveCards`, `skipKind`, `unskipKind`, `dropSiblingCards`,
  `saveWorkspaceLimits`, `saveDeckLimits` (empty = tombstone), `saveParamSet`, `setActiveSet`,
  `deleteParamSet` each send `POST /api/sync/push` with the typed collection (never a plugin-data URL for a
  typed family), the stamp rule `max(now, knownAt + 1 ms)`, `extra` of the stored row echoed back;
  `saveGoals`, `setKnownMark(s)`, `saveVacation`, `deleteVacation` are unchanged; a skipped item raises
  `PartialPushError` as before. A grep test: no `/api/plugins/` path in `lib/study` except the keyed-row
  writers. Run: fails. Implement. Run: passes. Commit `feat(study): write study rows through typed push`.

### Task B4: PWA cache allowlist and offline warm-up

**Files:** `apps/web/src/lib/pwa/sw/classify.ts`, `classify.test.ts`, `apps/web/src/lib/pwa/prepareOffline.ts`,
`prepareOffline.test.ts`, `docs/contracts/pwa/README.md` (allowlist sentence).

- [ ] Tests first: a pull whose `collections` is a non-empty subset of the eight names is cacheable; any other
  name, an empty list or no list is not; the old `pluginData,pluginStates` form stays cacheable;
  `prepareOffline` warms the new `SYNC_PULL_PATH`; `routes.fixture.json` unchanged. Run: fails. Implement.
  Run: passes. Commit `feat(pwa): cache typed study pulls for offline study`.

### Task B5: Core feature registry

**Files:** Create `apps/web/src/lib/features/index.ts`, `index.test.ts`; modify `lib/plugins/index.ts`
(`webPlugins` = journal, grammar), `lib/plugins/contract.ts` (`logChangingTypes`), `contract.test.ts`,
`manifests.test.ts`, `lib/widgets/registry.ts`, `registry.test.ts`, `lib/goals/builtinSources.ts` (+ test),
`lib/settings/pluginRows.ts` (+ test), `routes/+layout.svelte` (nav).

```ts
export const FLASHCARDS_ID = 'qinqin-flashcards'; export const READER_ID = 'qinqin-reader';
export const RESERVED_IDS: ReadonlySet<string>; // qinqin-core, qinqin-flashcards, qinqin-reader
export interface CoreFeature { id: string; title: string; href: string; widgets: WidgetDef[]; sources?: SourceCredit[] }
export const coreFeatures: readonly CoreFeature[]; // Decks (/flashcards), Reader (/reader)
export function featureEnabled(id: string, states: PluginInfo[]): boolean; // no row = enabled
export function navLinks(state: PluginStatesValue): { href: string; title: string }[]; // features first, then plugins in user order; none before ready
```

- [ ] Tests first: nav order (features fixed first, plugins by order, disabled hidden, nothing before
  `ready`); widgets of a disabled feature absent, of an enabled one present; Settings → Plugins rows exclude
  `RESERVED_IDS`; `logChangingTypes()` = every built-in or registered type with an activity rule
  (`review`, `read`, `journal`); `BUILTIN_SOURCES` from `core.json` and `journal.json` (`plugin:
  'qinqin-core'` for review and read); the manifest consistency test now requires each `EventType` literal
  declared once across `core.json`, `journal.json`, `grammar.json`. Run: fails. Implement. Run: passes.
  Commit `feat(web): flashcards and reader as core features`.

### Task B6: Core routes and redirects

**Files:** Create `apps/web/src/routes/flashcards/[...rest]/+page.svelte`, `routes/reader/[...rest]/+page.svelte`,
a shared `lib/features/FeaturePage.svelte` (switched-off notice) with `FeaturePage.dom.test.ts`; modify
`lib/legacyRoutes.ts` (+ test), `lib/plugins/flashcards/route.ts`, `lib/plugins/reader/route.ts` (+ tests),
every `/p/flashcards` / `/p/reader` literal (13 today, `grep -rn "/p/flashcards\|/p/reader" apps/web/src`),
`lib/pageTitle*` / `pageTitles.dom.test.ts` (titles from item 3 for the new routes), `lib/routeAccess.ts` (+ test).

- [ ] Tests first: `legacyRedirect` maps `/p/flashcards[/rest]` → `/flashcards[/rest]` and `/p/reader[/rest]` →
  `/reader[/rest]` keeping query and fragment (and still `/study/map`); route builders emit the new prefixes;
  the new pages render the feature component when enabled and the notice with a Settings → Features link
  when disabled; `/p/journal` still works; page titles for both. Run: fails. Implement. Run: passes.
  Commit `feat(web): core routes for flashcards and the reader`.

### Task B7: Settings → Features and core credits

**Files:** `apps/web/src/routes/settings/+page.svelte`, create `lib/settings/FeatureSettings.svelte` +
`FeatureSettings.dom.test.ts`, `lib/settings/tabs.ts` (+ test), `lib/sources/coreCredits.ts`,
`lib/sources/sections.ts` (+ test), `routes/sources/+page.svelte`, `lib/thirdPartyLicenses.test.ts`.

- [ ] Tests first: Features lists Decks and Reader with switches that `PUT /api/plugins/{id}/state`
  `{enabled, order: 0}` and update `pluginStates`; Plugins lists journal and grammar only; the Sources page
  lists Aozora Bunko, Project Gutenberg and opencc-js under Core with the unchanged notices and both licence
  links; the licence files test still finds both texts. Run: fails. Implement. Run: passes.
  Commit `feat(web): feature switches in Settings and core credits for the reader sources`.

### Task B8: Move the code under `lib/features/`

**Files:** `git mv apps/web/src/lib/plugins/flashcards apps/web/src/lib/features/flashcards`, same for
`reader`; import rewrites; docs that name the old paths (`docs/contracts/**/README.md`, `overview.md`,
`docs/contracts/README.md`) — the contracts docs test checks paths.

- [ ] No behaviour change: `npm run check`, full `npm test`, `npm run build` pass; `git diff -M --stat`
  shows renames plus import lines only. Commit `refactor(web): move flashcards and reader under lib/features`.

## Phase C — compatibility and the real app

### Task C1: Old-shell scenario test

**Files:** Create `server/internal/api/compat_old_shell_test.go`.

- [ ] One test replays, against a server whose DB was migrated from the A4 v0.3.0-shaped fixture, the exact
  request sequence of the v0.3.0 web (from `legacy-view.json` and `git show v0.3.0:apps/web/src/lib/study/store.ts`):
  legacy pull; `PUT card:` (add a word); `pushStudyRows` of a deck delete (deck tombstone + card rewrites);
  `PUT deckcfg:` with `newOrder`; `PUT limits:deck:general`; `DELETE fsrs:active`; a `known:` push; a review
  via `POST /api/events/batch` with a v0.3.0 outbox item (accepted 1, retry duplicate 1). After each step the
  typed pull (new client) and the legacy pull (old client) agree. Write first against the current code;
  it must pass (A6–A8 built the behaviour); if it fails, fix the facade in this task.
  Commit `test(api): an old web shell keeps working on the new server`.

### Task C2: Real-app check, full gates, Execution record

- [ ] Build v0.3.0 from a scratch copy: `mkdir -p $S/v030 && git -C <wt> archive v0.3.0 server | tar -x -C $S/v030`
  then `cd $S/v030/server && go build -o $S/qq030 ./cmd/qinqin` (use the placeholder web dist its build needs);
  build this branch the same way into `$S/qq040`. Free 127.0.0.1 port (never 8080, 8085, 8300); data dir
  `$S/data`; stderr to `$S/*.log`.
- [ ] Step 1 (v0.3.0, curl/Python): register user A (admin) and B; A creates workspaces zh and ja; writes as
  the v0.3.0 web would: 20 cards (vocab, reverse, cloze, sentence with `sentenceId`, a character card), 3
  decks (user, `d-lvl-...`, `d-frq-...`), `deckcfg:` with `newOrder` level and `cardTypes`,
  `limits:workspace`, `limits:deck:general`, two `fsrs:set:` and `fsrs:active`, `goals:workspace`, `known:`,
  a user-global `vacation:`, a note; 100 review events; one deleted card; one unreadable `card:` row; uploads
  a small book, sets a position, adds a bookmark and a highlight; disables the reader for B. Save the legacy
  pull, `GET /api/events`, the library JSON as `before/*.json`; export a backup (ticket) to `$S/a-v1.zip`.
- [ ] Step 2: stop, start `qq040` on the same data dir. The migration log line names the moved and left
  counts (left = 1). Step 3: typed pull holds every card id, deck, setting of step 1 with the same `version`
  and `updatedAt`; the legacy pull equals `before/pull.json` for every typed-family key (JSON values) and
  still holds the unreadable row; events identical; library JSON equal plus `updatedAt`; B's reader switch
  still off; `GET /api/stats/activity` reports review and read under `qinqin-core`.
- [ ] Step 4 (old shell): replay the C1 writes with curl; the typed pull shows them. Step 5: restore
  `$S/a-v1.zip` into user B through the staged restore routes; B's typed pull holds A's cards with new ids
  and workspaces, reviews follow. Step 6: export A on `qq040`; `formatVersion` 1; restore it into a fresh
  `qq030` data dir (downgrade path) and see the cards in its pull. Step 7: outbox flush — `POST
  /api/events/batch` with an outbox-v2 item recorded in step 1's format (new ULID): accepted 1; again:
  duplicates 1. Kill both servers; delete `$S`.
- [ ] One full Go `./...` gate, full web gates, Node 26 vitest, `node scripts/gen-api-docs.mjs --check`;
  `git status` clean. Fill the Execution record honestly (what was not verified, e.g. a real browser with a
  cached old shell). Commit `docs(plan): core features execution record`.

## Phase D — contracts and docs

### Task D1: Contracts overview and READMEs

**Files:** `docs/contracts/overview.md`, `docs/contracts/README.md`, `docs/contracts/backup/README.md`,
`docs/contracts/pwa/README.md`, `docs/contracts/cards/README.md`, `decks/README.md`, `scheduler/README.md`,
`frequency/README.md`, `reader/README.md`; `apps/web/src/lib/contractsDocs.test.ts` if it pins sections.

- [ ] Overview: layer table gains `study/` and `library/`; sync model: typed collections, the legacy view and
  the rule "name a typed collection whenever you pull `pluginData`", reserved registry ids and the feature
  switch; row-key table: the six typed families move to a new "Typed study rows" table (collection,
  identity, wire shape, owner code, pinned by `study/rows.json`, `study/legacy-codec.json`), the keyed rows
  stay with "namespace `qinqin-flashcards` (study namespace, not a plugin)"; library row pinned by
  `library/rows.json` (+ `updatedAt`, `library_deletions` for item 5); Gaps: remove the `deck:*`,
  `card:*`, `deckcfg:*`, `fsrs:*` and library bullets, keep `read` and push/pull response shapes (items 5/6).
  README folder table: `study/`, `library/` rows. Backup README: typed rows are exported as legacy rows,
  unreadable typed rows dropped and counted, deletion log never exported. PWA README: the allowlist. Owner
  paths updated to `lib/features/...`. `contractsDocs.test.ts` passes.
  Commit `docs(contracts): typed study rows and the library in the overview`.

### Task D2: Wiki and README

**Files:** `docs/wiki/Plugin-format.md`, `Plugin-data-api.md`, `Settings-tour.md`, `Reader.md`,
`Flashcards-decks-limits-vacation.md`, `Flashcards-study-sessions.md`, `API-Overview.md`,
`API-Access-tokens.md` (the one documented break), `Your-data.md`, `Stats-and-heatmap.md`, `Home.md` /
`_Sidebar.md` if they say "plugin" for these two; `README.md` (features list, upgrade note: "migration NNN
moves flashcards data into typed tables; nothing is lost; old open tabs keep working until reloaded").

- [ ] `wikiDocs.test.ts` and `gen-api-docs` checks pass; no page calls flashcards or the reader a plugin; URLs
  `/flashcards`, `/reader`. Commit `docs: flashcards and the reader as core features in the wiki and README`.

(D1 and D2 may be written before C2; C2 stays the last commit.)

## Execution record

Filled by the builders (merge commit of items 1–3, migration number, per-task commits and gate results,
deviations with reasons, the `sample-v1` change, what was not verified).

### Phase A

- Merge of `feature/v0.4.0-prep` (items 1–3): `60d18b4`. Migration number: **038** (`038_core_study.sql`,
  Go step `038_core_study`).
- A1–A7 were built by a first builder (stopped by the owner, not resumable): `08fd82f` A1, `c9adb59` A2,
  `4c72ec5` A3, `e7fde74` A4, `06f2a16` A5, `0a8ac2b` A6, `3035232` A7. It left no notes here; its gate
  results are not recorded and were not re-derived beyond the gates the second builder ran on top (below).
- `23758a5` "wip(study): A8 … interrupted mid-task": the first builder's uncommitted edits, saved by the
  orchestrator. Inspected by the second builder: despite its title it holds **no A8 work** (nothing in
  `api/handlers_plugins.go`). It is A12 material (backup export of typed rows as v1 legacy rows:
  `backup/export.go` `writePluginData`, `backup/plan.go` `CurrentCounts`, `study.ForEach`,
  `study.LegacyKeySQL`, `study.ReadableLeftover`, test seeds in `backup/seed_test.go`,
  `export_test.go`, `export_big_test.go`) plus one A13-related leniency (`study/sql.go` `scanRow`: an
  unparseable stored `modified_at` counts as `updated_at` instead of making the row unreadable). History
  is kept as is (no rewrite); the second builder builds on top. State found: `./internal/study/...`,
  `./internal/sync`, `./internal/backup` green, `gofmt -l` listed `backup/export_test.go` (import order),
  and `./internal/api` was **red** on the WIP: `TestRoundTripOnTheSameServer`,
  `TestRestoreOntoAnotherServerWithShiftedEntryIds`, `TestRestoreFlowStageApplyAndIsolation`,
  `TestRestoreUnresolvedNeedsTheAcknowledgement` (the WIP export drops unreadable leftover card rows,
  which those tests seeded with dummy bodies such as `{"id":"keep"}`). The WIP export code is kept and
  verified test-first in A12 (its tests are made to fail against the pre-WIP `writePluginData` there).

#### A8 — legacy view on the plugin-data routes

- Tests first: `api/handlers_plugins_legacy_test.go` (PUT per family to the typed tables, version bump,
  equal content keeps the version, deckcfg `updatedAt` written back, unreadable → 400
  `study_row_invalid`, a typed key without `?workspace=` → 400, keyed rows stay plugin data; GET typed /
  leftover / shadowed / absent / other workspace; prefix lists merged in key order, typed wins, prefixes
  inside a family; DELETE tombstone, re-DELETE 404, leftover fallback, absent 404, revival; two users on
  every verb; read token GET 200, PUT/DELETE 403 `token_read_only`, workspace-bound token 403
  `token_workspace` and 200 in its workspace). Seen failing (16 assertions across 4 tests), then passing.
- Implementation: `api/handlers_plugins_legacy.go` (`legacyGet`, `mergeLegacyList`, `legacyPut`,
  `legacyDelete`), hooks in `handlers_plugins.go`; `study.LegacyGet`, `study.LegacyList`, `study.Now`.
  `docs/contracts/auth/errors.json` gains `study_row_invalid` (400); `docs/wiki/API-Errors.md`
  regenerated; `docs/contracts/study/README.md` states the fallback and shadowing rules.
- Ruling: a typed row (live **or tombstoned**) shadows a leftover `plugin_data` row of the same key on
  GET, list and DELETE (a tombstoned typed key reads 404 even when a leftover exists) — why: the same rule
  the A7 legacy pull applies (`HasTypedRow`), so an old shell sees one row per key on every path and a
  card it deleted does not come back as a stale leftover — cost if wrong: a leftover under a deleted typed
  key is unreachable through the routes (it stays in the database untouched).
- Ruling: `PUT` of a typed key without `?workspace=` is 400 `study_row_invalid` — why: there is no
  user-global typed row (spec Q4) and the push path already refuses it (`dataRefused`); v0.3.0 shells
  never write one — cost if wrong: a token script that stored a user-global `card:` row gets 400.
- Ruling: a `PUT` whose content equals the stored live row answers 200 with the stored row and an
  unchanged `version` (v0.3.0 bumped it) — why: the spec's equal-content skip (Q4) on one write path; the
  v0.3.0 web ignores the `PUT` response — cost if wrong: a script comparing versions sees no bump.
- Existing api tests that wrote dummy, unreadable bodies under typed keys were changed (their subject is
  not the study rows): `populateWorkspace` and `TestDeletedWorkspaceSync` write the keyed row `known:1`
  (typed rows on workspace deletion are A10's), `tokens_routes_test.go` follows it, the body-limit test
  pads a readable card, the restore flow test uses neutral keys `test:*`, the unresolved-restore test
  counts `study_cards` plus leftovers, the round-trip test's cards gained `createdAt`. A10/A13 add the
  typed assertions to these areas. Also `gofmt` of the WIP's `backup/export_test.go`.
- Gate: `gofmt -l .` empty; `go vet` + `go test -count=1 -p 2 ./internal/api ./internal/study/...
  ./internal/sync ./internal/backup` exit 0 (all ok); `node scripts/gen-api-docs.mjs --check` exit 0;
  web `mfaResetView`, `reauth`, `tokensFormat`, `contractsDocs`, `wikiDocs` vitest 5 files / 153 tests
  passed. Route walk, `routes.fixture.json`, `auth/tokens-routes.json` unchanged (in the api run).

#### A9 — registry: reserved core rows, events move to core

- Tests first (seen failing: 9 Go tests in `plugins`, `cmd/qinqin`, `api`): `builtin_test.go` (core 1.2
  with `session`, `view`, `lookup`, `review`, `read`; flashcards 2.0 `owns-data` only; reader 2.0 empty;
  new `TestRegisterBuiltinsOverV030Rows`: the v0.3.0 rows in the registry, all built-ins registered in
  order report no conflict, rules `review`/`read` under `qinqin-core`, an admin `review` claimer is refused
  as owned by `qinqin-core`), `activity_test.go`, `rows_test.go` (hidden flags), `cmd/qinqin/main_test.go`
  (versions, the conflict log names `qinqin-core`), `api/handlers_stats_test.go` (activity sources),
  new `api` `TestReservedFeatureRows` (admin `POST` of `qinqin-reader`/`qinqin-flashcards` 409, `GET
  /api/plugins` lists both with the caller's state, `PUT .../qinqin-reader/state` per user, study
  namespace still owns data).
- Implementation: the three JSON files; `RegisterBuiltin` never reports another built-in's row as a
  conflict (stale v0.3.0 rows are replaced in the same start-up), so the registration order stays core
  first and `ActivityRules` lists `review`, `read` (core), `journal`.
- Ruling: the reserved rows `qinqin-flashcards` / `qinqin-reader` are listed with `hidden: true` (they
  declare no surface, the existing rule) — why: they are not plugins; a client must not show them in a
  plugin list, and their state (the feature switch) is still on the same row — cost if wrong: a client that
  drops hidden rows before reading states would miss the switch (documented on `model.PluginInfo`).
- Ruling: `order` sent to `PUT /api/plugins/{id}/state` for the two ids is stored as sent, not forced to 0
  — why: v0.3.0 shells send their plugin order and must not be refused; "ignored" (spec Q6) means no
  client uses it for these ids — cost if wrong: none.
- Deviation (web, pulled forward from B5 to keep every commit green): the web imports the same JSON files
  (`$builtin`), so moving `review`/`read` into `core.json` broke 12 web tests and, worse, the cache
  invalidation of the event log (`logChangingTypes` skipped the core, so a posted review no longer dropped
  the cached log). In this commit: `lib/plugins/contract.ts` `logChangingTypes` = every built-in or
  registered event type with an activity rule (spec Q7's definition), `lib/goals/builtinSources.ts` reads
  `core.json` and `journal.json` (route order), and the tests that pinned the old shapes
  (`contract.test.ts`, `states.test.ts`, `builtinSources.test.ts`, `manifests.test.ts`: the two reserved
  ids assert `surfaces: []`). B5 keeps the rest (webPlugins, nav, widgets gate, Settings rows).
- Gate: `gofmt -l .` empty; `go vet` + `go test -count=1 -p 2 ./internal/plugins ./internal/api
  ./cmd/qinqin ./internal/model ./internal/sync ./internal/stats ./internal/events` exit 0 (all ok); web
  `npm run check` exit 0 (0 errors, 0 warnings); full vitest (Node 22) exit 0, 381 files / 6041 tests;
  `gen-api-docs --check` exit 0.

#### A10 — other server readers, workspace and account deletion

- Tests first, each seen failing: journal `TestSuggestionInput` (typed cards via `study.Apply`; a
  tombstoned card and a leftover plugin `card:` row are never suggested — failed with `words = [旧]`);
  `cmd/qinqin` `TestSeedWarnsAboutUserDataOnEntryIDs` (a live typed card counts, a tombstone does not, a
  leftover adds: "2 flashcard(s)"); `api` `populateWorkspace` now pushes one typed row of each of the six
  families and `workspaceRows` counts the six study tables, so `TestDeleteWorkspaceCascades`,
  `TestDeleteWorkspaceFailureRollsBack` and `TestDeletedWorkspaceSync` (typed pull lists only the kept
  workspace, a typed push into the deleted one is 404) cover them — failed with one row left per study
  table; `TestAdminDeletesUserEverythingGoes` (preview `cards`, every study table empty after);
  `auth` `TestDeleteUserRemovesEverythingPersonal` (`Cards: 1`); web `deleteView.test.ts` (flashcards
  line, seen failing against the old `deleteView.ts`).
- Implementation: `journal/suggest_input.go` reads `study.ListCards`; `seed.go` counts live
  `study_cards` plus leftover `card:` rows; workspace deletion deletes the workspace's rows of every
  `study.Tables()` table in its transaction; `auth.Preview.Cards` (`cards`, live cards) from the registry;
  `docs/contracts/auth/admin-users.json` `deletion_preview` gains `cards`; web `DeletionPreview` /
  `SelfDeletionPreview` gain optional `cards`, the dialog says "N flashcards, with their decks and study
  settings" and words `pluginData` as "other saved items (journal entries, notes, known words, settings)".
- The registry entries of the six study tables and `library_deletions` were already in `auth.UserTables()`
  (from A2); the schema guard test passes unchanged.
- Deviation: the library deletion log on workspace deletion moved to A11, which owns every library delete
  path (one place for `library_deletions` writes).
- Test changes: `tokens_routes_test.go` and `TestDeletedWorkspaceSync` now expect the legacy view's six
  typed rows in plugin-data lists/pulls of a populated workspace (7 rows, all of the right workspace).
- Gate: `gofmt -l .` empty; `go vet` + `go test -count=1 -p 2 ./internal/journal ./internal/api
  ./internal/auth ./cmd/qinqin ./internal/backup` exit 0 after the `auth` test fix (first run: only
  `TestDeleteUserRemovesEverythingPersonal` failed on the new `Cards` count, fixed in the test, rerun
  `./internal/auth` ok); web `npm run check` exit 0; vitest `src/lib/admin src/lib/settings
  contractsDocs` 35 files / 356 tests passed.

#### A11 — library row stamps, deletion log, library contract

- Tests first: `library/stamps_test.go` (book `updatedAt` = `createdAt` on create, stamped by a position
  write, listed; bookmark stamped by a relabel, an existing bookmark at the same position comes back
  unchanged; highlight edit stamps; every delete path logs one `library_deletions` row per removed row with
  the book's workspace — one bookmark, one highlight, a book with its children, `DeleteWorkspaceBooks`;
  another user's ids log nothing; a failing log insert (trigger) rolls every delete path back) — failed to
  compile (`Book.UpdatedAt` missing), then passing. `api/contract_library_test.go` drives the new
  `docs/contracts/library/rows.json` (32 cases: shapes with every key, `updatedAt`, positions incl. 413,
  bookmarks 201/200/422, highlight code-point ranges, overlap 409 with `existingId`, touching ranges,
  colours, UTF-16 offsets refused, two-user isolation on every verb 404, deletes, 401; then the exact
  deletion log). It was written after the store change, so it was checked to bite by running it against
  the pre-change `library/*.go` (stashed): 9 failures (missing `updatedAt` keys, empty deletion log).
  `TestDeleteWorkspaceCascades` asserts the workspace's book and bookmark in the log.
- Implementation: `Book.UpdatedAt`, `Bookmark.UpdatedAt` (columns read and written; an empty stored stamp
  falls back to `createdAt`), `SetPosition` and `RenameBookmark` stamp; `logDeletions` (one
  `INSERT … SELECT` per collection before the delete, same transaction); `DeleteBookmark` /
  `DeleteHighlight` now run in a transaction (`deleteChild`); `Delete` deletes children through the
  ownership subquery. Contract README `docs/contracts/library/README.md`; folder row in
  `docs/contracts/README.md` (the overview's row-key table is D1's).
- Ruling: a `library_deletions` conflict on `(collection, row_id)` refreshes the row instead of failing —
  why: ids are AUTOINCREMENT and never reused, so a conflict can only come from an id written verbatim
  (none today); failing a user's delete over bookkeeping would be worse — cost if wrong: none known.
- Gate: `gofmt -l .` empty; `go vet` + `go test -count=1 -p 2 ./internal/library/... ./internal/api
  ./internal/backup ./internal/auth` exit 0 (all ok, first run stopped at a vet error in my test, fixed);
  `gen-api-docs --check` exit 0; web `contractsDocs` + `wikiDocs` passed.

#### A12 — backup export: typed rows as v1 legacy rows

- The implementation is the first builder's WIP in `23758a5` (`backup/export.go` `writePluginData`:
  keyed plugin rows, then readable unshadowed leftovers (`study.ReadableLeftover`), then every live typed
  row through `rows.ToLegacy` with its `version`, `updatedAt`, `modifiedAt`, card refs noted;
  `backup/plan.go` `CurrentCounts` counts the same rows; `study.ForEach`, `study.LegacyKeySQL`).
  Verified test-first after the fact: with `export.go` and `plan.go` put back to their `3035232` (pre-WIP)
  versions, the WIP's tests and the new one fail (`TestWriteUserLayoutAndContent`,
  `TestExportTypedFamilyLeftovers`, 7 plan/restore/notes tests whose seeds are typed now, and the new
  `TestExportEveryTypedFamilyAsItsLegacyRow` with all six keys "not exported"); with the WIP code they
  pass. The files were restored byte for byte (`git diff --quiet HEAD` checked).
- New test `TestExportEveryTypedFamilyAsItsLegacyRow`: one row of each non-card family (deck with a
  frequency source, deckcfg with `newOrder` and an unknown member, both limits rows, an FSRS set with
  every optional number, `fsrs:active`) exports as its `ToLegacy` row with version 7 and both stamps;
  deckcfg's inner `updatedAt` = the row's `modified_at`; the archive opens; `formatVersion` 1.
- Ruling (kept from the WIP): a typed-family `plugin_data` row is exported only when it is still a
  readable study row whose key no typed row (live or tombstoned) holds — why: the spec forbids exporting
  unreadable leftovers (duplicate keys would make the archive invalid, and no client reads them), while a
  readable one (only possible from an older server's write) is user data — cost if wrong: such a row is
  restored as a typed row (A13) instead of staying a leftover.
- Gate: `gofmt -l .` empty; `go vet` + `go test -count=1 -p 2 ./internal/backup ./internal/api
  ./internal/study/...` exit 0 (all ok).
- Not verified here: that a v0.4 archive restores on a v0.3.0 server (plan C2, real-app step 6).
