# Phase 1 — Go Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete phase-1 backend from the design: schema, auth, entry/variant model, dictionary/level/sentence data-plugin import (JSON + CC-CEDICT + Unihan), user edit overlays, study events, plugin registry/state/data store, search, sync API, seed CLI, and the Docker/Portainer deployment — "done = seeded API, curl-able."

**Architecture:** One Go binary, pure-Go SQLite, stdlib HTTP. Domain packages under `server/internal` share one `*sql.DB` opened by `internal/db` with embedded ordered migrations. All content flows through one upsert pipeline (`internal/dict`) so re-imports replace pack-owned rows and never touch entries or user overlays. Every write sets server UTC `updated_at`; deletions are soft (`deleted_at`) so the sync pull can ship tombstones.

**Tech Stack:** Go ≥ 1.23; `modernc.org/sqlite` (no CGO); `golang.org/x/crypto` (argon2id); `github.com/oklog/ulid/v2`; stdlib `net/http` pattern routing.

**Spec:** `docs/superpowers/specs/2026-11-10-chinese-learning-platform-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- Go module named `qinqin`; all code under `server/`.
- SQLite via `modernc.org/sqlite` only — no CGO anywhere (static distro build).
- Routing: stdlib `net/http` patterns (`mux.HandleFunc("GET /api/entries/{id}", ...)`). No router frameworks.
- Allowed deps: the three above plus their transitive deps. Anything else: note it in the task's commit message.
- Passwords: argon2id (`x/crypto/argon2`), per-user random salt.
- Sessions: 32-byte random hex token in `sessions` table, sent as `Authorization: Bearer <token>`.
- Timestamps: server clock, UTC, RFC 3339. Every write updates `updated_at`.
- No hard `DELETE`s on entries/senses/members/sentences/plugin_data — soft-delete via `deleted_at`.
- Study events: append-only, immutable, idempotent by their ULID `id`.
- Every pack manifest MUST carry `license` + `attribution`; importers reject packs without them.
- Data layout on disk: `<data>/qinqin.db`, `<data>/packs/` (installed packs).
- Commits: conventional (`feat:`, `test:`, `chore:`), at least one per task.

## File Structure

```
server/
  cmd/qinqin/main.go        serve (default), seed, adduser subcommands
  internal/db/db.go           Open(path), Migrate (embedded, ordered)
  internal/db/migrations/00N_*.sql
  internal/model/model.go     Entry, User, Sense, Dictionary, Badge, Sentence,
                              StudyEvent, PluginState, PluginData
  internal/pinyin/pinyin.go   ToBopomofo, ToMarked, Plain
  internal/auth/auth.go       hashing, users, sessions, UserFromRequest
  internal/entries/store.go   entry CRUD, variants, radical links, word-char links
  internal/entries/search.go  Search
  internal/dict/manifest.go   Manifest type + validation
  internal/dict/pack.go       LoadPack(dir-or-zip) → Pack
  internal/dict/import.go     Import (the upsert pipeline)
  internal/dict/cedict.go     CC-CEDICT native-format source
  internal/dict/unihan.go     Unihan source
  internal/levels/levels.go   scheme import, derived char levels, badges
  internal/overlay/overlay.go per-user edit patches
  internal/sentences/sentences.go
  internal/events/events.go   append-only study events
  internal/plugins/plugins.go registry, per-user state, plugin data store
  internal/api/api.go         New(db) http.Handler; handler files per domain
Dockerfile, docker-compose.yml, .github/workflows/build.yml   (repo root)
plugins/data/                 seed packs (small ones committed; large fetched)
scripts/fetch-seeds.sh
```

## Review Focus

1. **Pack re-import with overlays present** — re-import must replace that pack's senses but leave per-user edits intact. Test: `TestReimportPreservesOverlay` (Task 8).
2. **One simplified form, several traditional variants** (发 ↔ 發/髮) — separate per-form entries, multiple variant links, no merging. Test: `TestManyToManyVariants` (Task 7).
3. **Duplicate study-event push** (same ULID retried after a flaky connection) — stored once, reported as duplicate, not an error. Test: `TestEventBatchIdempotent` (Task 11).
4. **Pack uninstall / changed re-import** — deletions must reach clients as tombstones; entries stay. Test: `TestPullShipsTombstones` (Task 14).
5. **Pinyin edge cases** — ü (nǚ → ㄋㄩˇ), tone numbers (ni3 → nǐ), toneless search (nihao matches nǐ hǎo). Tests: `TestBopomofoTable`, `TestSearchToneInsensitive` (Tasks 2, 13).

---

### Task 1: Scaffold, DB, health endpoint

**Files:**
- Create: `server/go.mod`, `server/cmd/qinqin/main.go`, `server/internal/db/db.go`, `server/internal/db/migrations/001_init.sql`, `server/internal/api/api.go`
- Test: `server/internal/api/api_test.go`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `db.Open(path string) (*sql.DB, error)` (creates file, applies embedded migrations in order, tracks in `schema_migrations`); `api.New(db *sql.DB) http.Handler` mounting `GET /healthz`; `main.go` flags `--addr` (default `:8080`) and `--data` (default `./data`).

- [ ] **Step 1: Write failing test** — `TestHealthz`: `db.Open(t.TempDir()+"/test.db")`, `api.New(sqlDB)`, `GET /healthz` → 200, body `ok`.

- [ ] **Step 2: Run** `go test ./internal/api/` — FAIL (packages don't exist).

- [ ] **Step 3: Implement** — `go mod init qinqin`; `db.Open` with `embed.FS` migration runner (each `00N_*.sql` applied once, in filename order); empty `001_init.sql` placeholder; `api.New` with a `*http.ServeMux`; `main.go` `http.ListenAndServe`.

- [ ] **Step 4: Run** `go test ./... && go vet ./...` — PASS.

- [ ] **Step 5: Commit** — `chore: scaffold server, db migrations, health endpoint`

### Task 2: Pinyin → bopomofo / marked / plain

**Files:**
- Create: `server/internal/pinyin/pinyin.go`
- Test: `server/internal/pinyin/pinyin_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `pinyin.ToBopomofo(s string) (string, error)`, `pinyin.ToMarked(s string) (string, error)` (both accept tone-number (`ni3 hao3`) and tone-mark (`nǐ hǎo`) input), `pinyin.Plain(s string) string` (lowercase, tones/spaces/apostrophes stripped: `"Nǐ hǎo"` → `"nihao"`). Syllable-per-syllable, space-separated output.

- [ ] **Step 1: Write failing test** — `TestBopomofoTable` (table-driven; these exact rows):

```go
{"nǐ hǎo", "ㄋㄧˇ ㄏㄠˇ"},
{"ni3 hao3", "ㄋㄧˇ ㄏㄠˇ"},
{"nǚ", "ㄋㄩˇ"},          // ü, not u
{"zhōng wén", "ㄓㄨㄥ ㄨㄣˊ"},
{"ma", "ㄇㄚ"},           // neutral tone: no mark
{"lǜ", "ㄌㄩˋ"},
```
plus `TestMarkedAndPlain`: `ToMarked("ni3 hao3") == "nǐ hǎo"`, `Plain("Nǐ hǎo") == "nihao"`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — initial-consonant and final mapping tables + tone-digit/mark → bopomofo tone mark (˙ ˊ ˇ ˋ none); `ü` from `v`/`ü`/`u:`. Non-pinyin input → error from the two converters; `Plain` never errors.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: pinyin to bopomofo/marked/plain conversion`

### Task 3: Users, argon2id, sessions, auth endpoints

**Files:**
- Create: `server/internal/db/migrations/002_auth.sql`, `server/internal/auth/auth.go`, `server/internal/api/handlers_auth.go`
- Modify: `server/internal/model/model.go` (create; add `User{ID int64, Username string, Admin bool}`)
- Test: `server/internal/auth/auth_test.go`

**Interfaces:**
- Consumes: `db.Open`.
- Produces: `auth.Hash(password string) string` (argon2id, encoded salt+params), `auth.Verify(hash, password) bool`, `auth.CreateUser(ctx, *sql.DB, username, password string, admin bool) (model.User, error)`, `auth.Login(ctx, *sql.DB, username, password) (token string, err)` ( ErrBadCredentials), `auth.UserFromRequest(*http.Request, *sql.DB) (*model.User, error)` (nil user → not authed). Routes: `POST /api/auth/register` (allowed with no auth when zero users exist → that user becomes admin; otherwise requires an admin token), `POST /api/auth/login`, `GET /api/auth/me`.

- [ ] **Step 1: Write failing tests** — `TestFirstUserBecomesAdminNoAuth`; `TestSecondRegisterRejectedWithoutAdmin` (403); `TestRegisterLoginMe` (login returns token; `me` with `Authorization: Bearer` returns the user); `TestLoginWrongPassword` (401). Table `users(id, username unique, hash, admin, updated_at)`, `sessions(token, user_id, updated_at)`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — migration + auth package + handlers; `requireAdmin` / `requireUser` helpers in `internal/api` for later tasks.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: users, argon2id passwords, sessions, auth endpoints`

### Task 4: Entries, variants, entry endpoint

**Files:**
- Create: `server/internal/db/migrations/003_entries.sql`, `server/internal/entries/store.go`, `server/internal/api/handlers_entries.go`
- Modify: `server/internal/model/model.go` (`Entry`)
- Test: `server/internal/entries/store_test.go`

**Interfaces:**
- Consumes: `db.Open`, `pinyin.*`.
- Produces — `model.Entry{ID int64; Kind string; Written, Pinyin, PinyinPlain, Bopomofo string; Strokes int; RadicalID *int64; UpdatedAt time.Time; DeletedAt *time.Time}` (`Kind` ∈ `"hanzi"`, `"word"`); `entries.Store{DB *sql.DB}` with:
  - `Upsert(ctx, *model.Entry) (int64, error)` — keyed by `(written, kind)`; fills `PinyinPlain` via `pinyin.Plain`, `Bopomofo` via `pinyin.ToBopomofo` (empty on error)
  - `GetByID(ctx, int64) (*model.Entry, error)` / `GetByWritten(ctx, written, kind) (*model.Entry, error)` — `entries.ErrNotFound`; soft-deleted rows not returned
  - `LinkVariant(ctx, idA, idB int64) error` (symmetric, idempotent)
  - `Variants(ctx, id) ([]model.Entry, error)`
  - `SetRadical(ctx, charID, radicalID int64) error`, `CharsUnder(ctx, radicalID) ([]model.Entry, error)`
  - `LinkWordChar(ctx, wordID, charID) error`, `WordsContaining(ctx, charID) ([]model.Entry, error)`
- Route: `GET /api/entries/{id}` → entry JSON + `variants`. 404 on `ErrNotFound`.

- [ ] **Step 1: Write failing test** — `TestUpsertGetRoundtrip` (upsert 好 hanzi with `"hǎo"` → stored Bopomofo `ㄏㄠˇ`, PinyinPlain `hao`); `TestVariantLinks` (link 发↔發, 发↔髮; `Variants(发)` returns both, symmetric); `TestGetByWrittenNotFound`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — migration tables `entries`, `entry_links(from_id, to_id, type ∈ variant|radical|wordchar)`; store methods; handler. Variant symmetry = insert both directions.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: entries, variants, radical and word-char links`

### Task 5: Dictionary packs — manifest, JSON import, registry endpoints

**Files:**
- Create: `server/internal/db/migrations/004_dict.sql`, `server/internal/dict/manifest.go`, `server/internal/dict/pack.go`, `server/internal/dict/import.go`, `server/internal/api/handlers_dict.go`
- Modify: `server/internal/model/model.go` (`Dictionary`, `Sense`)
- Test: `server/internal/dict/import_test.go`, fixture pack `server/internal/dict/testdata/mkgloss/`

**Interfaces:**
- Consumes: `entries.Store`, `pinyin.*`.
- Produces:
  - `dict.Manifest{ID, Name, Version, Type, License, Attribution, Format string}` — `Type` ∈ `dictionary|levels|sentences`; `Format` ∈ `json|cedict|unihan`; `Validate() error` rejects missing license/attribution and bad enums.
  - `dict.LoadPack(path string) (dict.Pack, error)` — a directory or `.zip`; `Pack{Manifest; Dir string}`.
  - `dict.Import(ctx, *sql.DB, pack dict.Pack) (dict.Result, error)` — `Result{Entries, Senses int}`. Import semantics: upsert entries; senses keyed `(dictionary_id, entry_id)` — a re-import **replaces that dictionary's senses** (soft-delete removed, insert new) and never modifies `entries.updated_at`-owned overlay data or user edits.
  - JSON dictionary format (`format: "json"`), file `dictionary.json`:

```json
{"entries": [
  {"written": "你好", "trad": "你好", "kind": "word", "pinyin": "nǐ hǎo",
   "glosses": ["hello", "hi"]}]}
```
  `trad` optional; when present and different, a second entry + `LinkVariant` (both forms get the sense).
  - Routes: `GET /api/dictionaries` (id, name, version, license, attribution); `POST /api/admin/dictionaries` (admin, multipart zip → saved to `<data>/packs/<id>-<version>/` → imported); `DELETE /api/admin/dictionaries/{id}` (admin, uninstall: soft-deletes that dictionary's senses).

- [ ] **Step 1: Write failing tests** — `TestManifestRequiresLicense` (reject `{...no license...}`); `TestImportJsonPack` (fixture pack with 好/你好: 3 entries incl. trad pair, senses under dictionary id, bopomofo derived); `TestReimportReplacesSenses` (re-import with changed gloss → new gloss, old sense tombstoned, `entries` rows untouched); `TestUninstallSoftDeletesSenses`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — migration tables `dictionaries(id, pack_id, name, version, license, attribution, updated_at, deleted_at)`, `senses(dictionary_id, entry_id, gloss, ord, updated_at, deleted_at)`; manifest/pack/import; handlers. Import registers the `dictionaries` row keyed by `pack_id` (manifest `id`).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: dictionary packs, manifest validation, JSON import`

### Task 6: CC-CEDICT importer + word→char links

**Files:**
- Create: `server/internal/dict/cedict.go`
- Test: `server/internal/dict/cedict_test.go` with fixture `testdata/cedict-sample.txt`

**Interfaces:**
- Consumes: `dict.Import` pipeline, `entries.Store`.
- Produces: `cedict.Parse(r io.Reader) ([]dict.RawEntry, error)` where `RawEntry{Written, Trad, Pinyin, Glosses []string}`; `dict.Import` dispatches on manifest `Format == "cedict"` to read `dictionary.txt` via the parser. After importing word entries, the importer computes `LinkWordChar` for every distinct CJK char in each word's `Written`.

- [ ] **Step 1: Write failing test** — fixture lines (exact):

```text
頭髮 头发 [tou2 fa5] /hair/CL:根|gen1/
你好 你好 [ni3 hao3] /hello/hi/
發展 发展 [fa1 zhan3] /to develop/development/
```
`TestCedictParse`: 3 entries parsed, pinyin tone-numbered, glosses split on `/`, `CL:` measure-word glosses kept as-is. `TestCedictImport`: 发 hanzi entry ends up with variant links to both 頭髮's 髮-form entries? — assert: entry 头发 linked variant 頭髮; entry 发展 linked variant 發展; `WordsContaining(发)` contains 头发 and 发展 (word→char links).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — line regex `^(\S+) (\S+) \[([^\]]+)\] /(.*)/$`; `trad == simp` → no second entry; pinyin kept as tone numbers in `Pinyin`, `PinyinPlain`/`Bopomofo` derived by existing code paths.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: cc-cedict importer and word-character links`

### Task 7: Unihan importer — variants, radicals, character glosses

**Files:**
- Create: `server/internal/dict/unihan.go`, `server/internal/dict/kangxi.go` (the 214 Kangxi radical number→char table)
- Test: `server/internal/dict/unihan_test.go` with fixture `testdata/unihan-sample.txt`

**Interfaces:**
- Consumes: `dict.Import`, `entries.Store`.
- Produces: `unihan.Parse(r io.Reader) (unihan.Data, error)`, `Data{Radicals map[string]int; TradVariants, SimpVariants map[string][]string; Definitions map[string]string}` — parses `kRSUnicode`, `kSimplifiedVariant`, `kTraditionalVariant`, `kDefinition` lines (`U+597D\tkDefinition\t"good, excellent, fine; well"`). `dict.Import` with `Format == "unihan"`: creates/updates hanzi entries for every codepoint seen; `LinkVariant` both directions for all variant pairs; `SetRadical` from `kRSUnicode` (left of `.`); registers a built-in dictionary `pack_id: "unihan"` (license: "Unicode License", attribution: "Unicode Common Locale Data Repository / Unihan database") and adds kDefinition strings as its senses. Radical chars themselves are entries (via the Kangxi table) so `GET /api/entries/{id}` on a radical works.

- [ ] **Step 1: Write failing test** — `TestManyToManyVariants`: fixture with `U+590D kSimplifiedVariant 复` mapping 复→復,複 → three entries, `Variants(复)` = {復, 複}. `TestUnihanDefinitions`: 好's kDefinition becomes a sense under the `unihan` dictionary. `TestRadicalAssignment`: `U+597D kRSUnicode 38.6` → 好's `RadicalID` is the entry for 女.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — parser (skip comments/blank lines; U+ codepoints decoded to chars), Kangxi table, import wiring.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: unihan importer — variants, radicals, character glosses`

### Task 8: Per-user edit overlays

**Files:**
- Create: `server/internal/db/migrations/005_overlay.sql`, `server/internal/overlay/overlay.go`
- Modify: `server/internal/api/handlers_entries.go`
- Test: `server/internal/overlay/overlay_test.go`

**Interfaces:**
- Consumes: `entries.Store`, `dict` import, auth.
- Produces: `model.EntryPatch{Written, Pinyin *string; Strokes *int}`; `overlay.Put(ctx, db, userID, entryID int64, patch model.EntryPatch) error` (upsert, `updated_at` = now — the LWW timestamp); `overlay.Apply(ctx, db, userID, entry) error` (mutates entry fields in place; user with no patch → no-op). Route: `PUT /api/entries/{id}` (auth; body = patch) — applies to entry + that user's view of its senses? No: **sense-level edits are out of scope this phase**; entry fields only. `GET /api/entries/{id}` applies the caller's patch when authed.

- [ ] **Step 1: Write failing tests** — `TestPatchMergesForOwnerOnly` (user A patches pinyin → A's GET shows it, B's doesn't); `TestReimportPreservesOverlay` (import pack, patch entry, re-import same pack with changed glosses → patch intact, glosses replaced) — Review Focus #1.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — table `user_edits(user_id, entry_id, written, pinyin, strokes, updated_at, PRIMARY KEY(user_id, entry_id))` (nullable columns = untouched fields); Put/Apply; handler wiring.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: per-user entry overlays surviving re-imports`

### Task 9: Level schemes + derived character levels

**Files:**
- Create: `server/internal/db/migrations/006_levels.sql`, `server/internal/levels/levels.go`, `server/internal/api/handlers_levels.go`
- Modify: `server/internal/model/model.go` (`Scheme`, `Level`, `Badge`), `server/internal/api/handlers_entries.go` (badges in GET)
- Test: `server/internal/levels/levels_test.go`, fixture pack `server/internal/levels/testdata/hsk-mini/`

**Interfaces:**
- Consumes: `dict.LoadPack`/`dict.Import` dispatch (`Type == "levels"`), `entries.Store`.
- Produces: `levels.Import(ctx, *sql.DB, pack dict.Pack) (levels.Result, error)`; pack format `levels.json`:

```json
{"unit": "word", "levels": [
  {"name": "1", "entries": ["你好", "谢谢"]},
  {"name": "2", "entries": ["银行"]}]}
```
  `unit` ∈ `word|hanzi` (word-based ⇒ derive). Import: upsert scheme + ordered levels; membership by `written` match against existing entries (unknown forms: skip, collect in `Result.Skipped` — do not create entries). **Derivation** (word unit only): each distinct char of each member word joins the word's level unless it's already in an equal-or-lower level of the same scheme — stored with `derived = true`. Queries: `levels.ForEntry(ctx, entryID) ([]model.Badge{SchemeID, SchemeName, LevelName, Derived bool}, error)`, `levels.List(ctx) ([]model.Scheme, ...)`; `levels.EntryIDs(ctx, schemeID, levelName) ([]int64, error)`. Routes: `GET /api/schemes`; `DELETE /api/admin/schemes/{id}` (admin, uninstall: soft-deletes scheme + its members); `GET /api/entries/{id}` now includes `badges`.

- [ ] **Step 1: Write failing tests** — `TestSchemeImportAndBadges` (HSK-mini: scheme listed; 你好 word badge HSK 1; 好 char badge HSK 1 `derived`); `TestDerivedLevelKeepsLowest` (char in level-1 word and level-2 word → badge level 1 only); `TestSkippedUnknownForms` (unknown form counted, no entry created).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — tables `schemes(pack_id, name, unit, ...)`, `levels(scheme_id, ord, name)`, `level_members(level_id, entry_id, derived, updated_at, deleted_at)`; import, derivation, queries, handlers.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: level schemes with derived character levels`

### Task 10: Sentences — packs + user-added

**Files:**
- Create: `server/internal/db/migrations/007_sentences.sql`, `server/internal/sentences/sentences.go`, `server/internal/api/handlers_sentences.go`
- Modify: `server/internal/api/handlers_entries.go` (sentences in word GET)
- Test: `server/internal/sentences/sentences_test.go`

**Interfaces:**
- Consumes: `dict.LoadPack`/`Import` (`Type == "sentences"`), auth.
- Produces: `sentences.ImportPack(ctx, db, pack dict.Pack) (sentences.Result, error)` — pack format `sentences.json`: `{"entries": [{"word": "你好", "sentences": [{"hanzi": "你好，世界。", "pinyin": "nǐ hǎo, shì jiè.", "translation": "Hello, world."}]}]}` — linked to the word entry by written match (unknown words → `Result.Skipped`).   `sentences.AddUser(ctx, db, userID, entryID, model.Sentence) (id int64, err)` (user-owned, survives pack re-import); `sentences.ForEntry(ctx, entryID) ([]model.Sentence, error)`. Routes: `POST /api/entries/{id}/sentences` (auth); `DELETE /api/admin/sentences/{pack}` (admin, uninstall: soft-deletes that pack's sentences); word GET includes `sentences` (pack + user rows, pack ones labeled with source name).

- [ ] **Step 1: Write failing tests** — `TestSentencePackImport` (sentence linked to 你好; unknown word skipped); `TestUserSentenceAdded` (POST → appears in `ForEntry`, marked user-owned); `TestReimportKeepsUserSentences`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — table `sentences(id, entry_id, source_pack, user_id nullable, hanzi, pinyin, translation, updated_at, deleted_at)`; import, queries, routes.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: example sentences from packs and users`

### Task 11: Study events — append-only, idempotent

**Files:**
- Create: `server/internal/db/migrations/008_events.sql`, `server/internal/events/events.go`, `server/internal/api/handlers_events.go`
- Modify: `server/internal/model/model.go` (`StudyEvent`)
- Test: `server/internal/events/events_test.go`

**Interfaces:**
- Consumes: auth.
- Produces: `model.StudyEvent{ID string; UserID int64; Device string; TS time.Time; Type string; Payload json.RawMessage}`; `events.Append(ctx, db, evts []model.StudyEvent) (accepted, duplicates int, err)` (INSERT, on ULID conflict count duplicate — never an error); `events.Since(ctx, db, userID int64, since time.Time) ([]model.StudyEvent, error)`. Route: `POST /api/events/batch` (auth; events' `UserID` forced from token, client `TS` kept) → `{"accepted": n, "duplicates": m}`; `GET /api/events?since=` (auth, own events only).

- [ ] **Step 1: Write failing tests** — `TestEventAppendAndSince`; `TestEventBatchIdempotent` (same 2-event batch twice → second: accepted 0, duplicates 2; rows still 2) — Review Focus #3.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — table `study_events(id TEXT PRIMARY KEY, user_id, device, ts, type, payload, updated_at)`; Append/Since; routes.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: append-only idempotent study events`

### Task 12: Plugin registry, per-user state, plugin data store

**Files:**
- Create: `server/internal/db/migrations/009_plugins.sql`, `server/internal/plugins/plugins.go`, `server/internal/api/handlers_plugins.go`
- Modify: `server/internal/model/model.go` (`PluginState`, `PluginData`)
- Test: `server/internal/plugins/plugins_test.go`

**Interfaces:**
- Consumes: auth.
- Produces:
  - `plugins.Register(ctx, db, m dict.Manifest) error` (upsert into registry; data-plugin imports register themselves)
  - `plugins.ListFor(ctx, db, userID) ([]model.PluginInfo{Manifest, Enabled bool, Order int}, ...)` (data + feature plugins; default enabled = true)
  - `plugins.SetState(ctx, db, userID, pluginID string, enabled bool, order int) error`
  - `plugins.PutData(ctx, db, userID, pluginID, key string, val json.RawMessage) (version int, err)` — increments `version`, sets `updated_at`
  - `plugins.GetData(ctx, db, userID, pluginID, key) (*model.PluginData, error)`; `plugins.PullData(ctx, db, userID, since time.Time) ([]model.PluginData, ...)` (includes tombstones)
  - `plugins.DeleteData(ctx, db, userID, pluginID, key) error` (soft)
  - Routes: `POST /api/admin/plugins` (admin; registers a feature-plugin manifest JSON), `GET /api/plugins` (caller's list+states), `PUT /api/plugins/{id}/state`, `GET|PUT /api/plugins/{id}/data/{key}`, `DELETE /api/plugins/{id}/data/{key}`.
- `model.PluginData{PluginID, Key string; UserID int64; Data json.RawMessage; Version int; UpdatedAt; DeletedAt *time}`.

- [ ] **Step 1: Write failing tests** — `TestRegisterListState` (register heatmap manifest; user disables + reorders; `ListFor` reflects); `TestPluginDataVersioning` (put, put → version 2); `TestPluginDataTombstone` (delete → `PullData` since-before-delete returns it with `DeletedAt` set); `TestPluginDataIsolatedBetweenUsers`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — tables `plugin_registry(pack_id, manifest_json, ...)`, `plugin_states(user_id, pack_id, enabled, ord, updated_at)`, `plugin_data(pack_id, user_id, key, data, version, updated_at, deleted_at)`; package + routes.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: plugin registry, per-user states, versioned data store`

### Task 13: Search

**Files:**
- Create: `server/internal/entries/search.go`, `server/internal/api/handlers_search.go`
- Test: `server/internal/entries/search_test.go` (seeded via a test helper that imports the Task 5/6 fixtures)

**Interfaces:**
- Consumes: `entries.Store`, `levels.EntryIDs`, senses tables.
- Produces: `entries.Search(ctx, q entries.SearchQuery) ([]model.SearchHit, error)`; `SearchQuery{Text, Kind, SchemeID, LevelName string; Limit int}` (0 → 50); `model.SearchHit{Entry; Source string}` (why it matched: `"written"|"pinyin"|"bopomofo"|"gloss"`). Matching, in rank order: exact `written`; `PinyinPlain` exact; `PinyinPlain` prefix; `bopomofo` prefix; gloss substring across active senses. `Kind` and scheme+level (via `levels.EntryIDs`) narrow the candidate set before text match.

- [ ] **Step 1: Write failing tests** — `TestSearchToneInsensitive` (`"nihao"` and `"ni hao"` both find 你好) — Review Focus #5; `TestSearchExactWrittenRanksFirst` (query 好 → hanzi 好 before words containing 好); `TestSearchByGloss` (`"hello"` finds 你好, source `gloss`); `TestSearchKindAndLevelFilter` (`kind=hanzi, scheme=hsk-mini, level=1` → hanzi members only, incl. derived 好).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — single SQL query per rank tier over `entries` (join `senses` for gloss tier; `PinyinPlain LIKE prefix` for prefix tiers), union in code, cap at limit. Route `GET /api/search?q=&kind=&scheme=&level=`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: ranked search across written, pinyin, bopomofo, glosses`

### Task 14: Sync API — pull with tombstones, push with LWW

**Files:**
- Create: `server/internal/api/handlers_sync.go`, `server/internal/sync/sync.go`
- Test: `server/internal/sync/sync_test.go`

**Interfaces:**
- Consumes: `events`, `plugins`, all domain tables (`updated_at` on every row; tombstones = `deleted_at`).
- Produces:
  - `sync.Pull(ctx, db, userID, cursor time.Time) (sync.Delta, error)` — `Delta{Cursor time.Time; Entries, Senses, LevelMembers, Sentences, PluginData []any-row-with-updated_at+deleted_at; PluginStates []model.PluginState}`; every row with `updated_at > cursor`, tombstoned rows included with `DeletedAt` set; `Cursor` = server now.
  - `sync.Push(ctx, db, userID, body sync.PushBody) (sync.PushResult, error)` — `PushBody{Events []model.StudyEvent; PluginData []model.PluginData}`; events → `events.Append`; plugin data → LWW: server row `updated_at` ≤ incoming → accept (write + bump version), newer → skip; `PushResult{EventsAccepted, EventDuplicates, DataAccepted, DataSkipped int}`.
  - Routes: `GET /api/sync/pull?cursor=`, `POST /api/sync/push` (both auth).

- [ ] **Step 1: Write failing tests** — `TestPullAll` (fresh cursor returns imported world); `TestPullShipsTombstones` (import dict, pull, uninstall dict, pull again → senses tombstoned, entries still present, not re-sent) — Review Focus #4; `TestPushEventsAndLWW` (push events once, retry → duplicates; push plugin data with older `updated_at` than server → skipped; newer → accepted).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — one query per collection (`WHERE updated_at > ?`), shared row-JSON marshaling; push wiring; routes.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `feat: delta sync with tombstones and last-write-wins push`

### Task 15: Seed CLI, pack layout, admin bootstrap

**Files:**
- Create: `server/cmd/qinqin/seed.go`, `server/cmd/qinqin/adduser.go`, `scripts/fetch-seeds.sh`, `plugins/data/hsk-mini/manifest.json` + `levels.json` (committed example), `plugins/data/README.md`
- Test: `server/cmd/qinqin/seed_test.go`

**Interfaces:**
- Consumes: `dict.LoadPack/Import`, `levels`, `sentences`, `auth.CreateUser`.
- Produces: `qinqin seed --data <dir> --packs <dir>` (walks pack dirs, dispatches on manifest `Type`: dictionary→`dict.Import`, levels→`levels.Import`, sentences→`sentences.ImportPack`; registers each in the plugin registry; idempotent — re-running re-imports safely); `qinqin adduser --data <dir> --admin --username U` (prompts password); `fetch-seeds.sh` downloads CC-CEDICT `.gz` + Unihan `.txt` files into `plugins/data/cedict/` and `plugins/data/unihan/` (gitignored — large).

- [ ] **Step 1: Write failing test** — `TestSeedIdempotent`: temp data dir, run seed twice over a fixture pack dir (hsk-mini + a small dictionary pack) → no error, entry/sense counts identical after second run.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — cobra-free stdlib `flag` subcommands; pack walker; scripts; commit the small packs.

- [ ] **Step 4: Manual verification** — `go run ./cmd/qinqin seed --data /tmp/opencode/seedtest --packs plugins/data` (with fixtures) then `curl 'localhost:8080/api/search?q=nihao'` returns 你好. Expected: JSON hit.

- [ ] **Step 5: Commit** — `feat: seed and adduser commands, seed pack layout`

### Task 16: Docker, compose, CI to GHCR

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/build.yml`

**Interfaces:**
- Consumes: the built binary + `/healthz`.
- Produces: multi-stage Dockerfile (golang builder, `CGO_ENABLED=0`, final `alpine:3.x` with the binary); `docker-compose.yml` — service `qinqin`, image `ghcr.io/qinqin/qinqin`, port 8080, volume `./data:/data`, env `QINQIN_DATA=/data`, healthcheck `wget -qO- http://localhost:8080/healthz`; workflow builds and pushes on main + tags.

- [ ] **Step 1: Implement** — Dockerfile + compose + workflow as above; `.dockerignore` (`.git`, `apps/`, `plugins/data/cedict`, `plugins/data/unihan`, `data/`).

- [ ] **Step 2: Verify** — `docker build -t qinqin:test .` then `docker compose up -d` then `curl -f localhost:8080/healthz` → `ok`, then `docker compose down`. Expected: all succeed.

- [ ] **Step 3: Commit** — `chore: docker image, compose stack for portainer, ghcr workflow`

---

## Notes for the Web/Mobile plans (not in this plan)

- `GET /api/entries/{id}` response shape (entry + variants + badges + sentences) is the contract both clients render; keep handler JSON stable.
- The heatmap plugin (first feature plugin) consumes only `GET /api/events?since=`; both client plans implement the grid from that.
- Stroke-order data (Make Me a Hanzi) is *served* by the backend in the web/mobile phase (static assets route) — deliberately not in phase 1's import pipeline.
