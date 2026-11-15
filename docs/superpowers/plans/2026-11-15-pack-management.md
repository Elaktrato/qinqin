# Data-Pack Management UI (issue #40) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** Admins list, upload (with progress and a licence review step) and uninstall data packs of every type from a new Settings → Data tab.

**Architecture:** A new `internal/packs` package owns import/uninstall/list for all four pack types (moved out of the seed CLI). New `/api/admin/packs` routes stage an upload (extract + validate into `<data>/packs/.stage-<token>/`), import it only after the client echoes the pack's licence string, and uninstall by type and pack id. Migration 026 adds a sentence-pack registry and `dictionaries.language`. The web adds an XHR upload helper, pure view helpers, and `PackManager.svelte` in an admin-only Data tab.

**Tech Stack:** Go 1.26 (stdlib mux, modernc SQLite), SvelteKit 2 + Svelte 5 (runes), vitest (node environment). No new Go or npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-pack-management-design.md`. Read it first; its Rulings are binding.

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/pack-management`, branch `feature/pack-management` from `develop`. Ledger (git-ignored): `<wt>/.superpowers/sdd/2026-11-15-pack-management/progress.md`. Run `npm --prefix <wt>/apps/web ci` once before the first web gate. The language-management plan (`2026-11-15-language-management.md`) is stacked on this branch.

## Gates

- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`.
- Go (as your own user, scratch caches): `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOMODCACHE=/tmp/gomod -e GOPATH=/tmp/gopath -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."`.
- Go race for Tasks 5–7: same command with `sh -c "go test -race ./internal/api/... ./internal/packs/..."`.
- Every task ends with all gates green and one commit on `feature/pack-management` (conventional message, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never merge or push.

## Global Constraints

- Migration file: `server/internal/db/migrations/026_pack_registry.sql`.
- Limits: upload body 128 MiB + 1 MiB multipart overhead (`413` "pack zip larger than 128 MiB — use qinqin seed for larger packs"); at most 2,000 zip entries; at most 512 MiB uncompressed, counted on bytes written.
- Stage: token 128-bit random hex; expiry 30 min; at most 3 live stages (`429` "finish or discard a staged pack first"); `.stage-*` dirs older than 1 h swept on each stage call; tokens bound to the uploading admin (other admin → `404`).
- Install body `{"license": "<string>"}` must equal the staged manifest's `License` exactly, else `409` "confirm the pack's licence".
- All new routes use `requireAdmin` (403). Errors are plain text (`http.Error`) like the existing admin routes; no message ever contains a filesystem path.
- UI copy: licence label "Licence (as stated by the pack)"; empty licence → "Licence not recorded — reinstall the pack to record it"; confirmation "I have read the licence and attribution above and this server may use the data under these terms"; caution "This licence may restrict use or redistribution — check it before installing". No tick icons or words like verified/approved/cleared/safe anywhere near a licence.
- Tests never commit third-party data: fixtures are written from strings in the test (`buildPackDir`/`zipDirToBytes` in `server/internal/api/handlers_dict_test.go`, `writePack`/`zipDir` in `server/internal/dict/import_test.go`).
- Web style: tabs and single quotes, Svelte 5 runes, 44 px targets, everything by keyboard; status via `role="status"`, errors via `role="alert"`.

## Review Focus

1. **Proxy timeout or closed tab during a long import:** must not abort or half-apply the import. Pinned in Task 7 (job finishes after the request context is cancelled) and Task 8 (`waitForImport`).
2. **Zip bomb / lying headers:** a zip whose declared sizes are small but whose entries inflate past 512 MiB must fail while extracting and leave no stage dir. Pinned in Task 1 (`TestExtractZipAtStopsAtWrittenLimit`).
3. **Licence shown ≠ licence stored:** a stale review card (pack re-staged with a new licence) must not install with the old string. Pinned in Task 7 (`TestStagedInstallRequiresExactLicence`).
4. **Concurrent installs:** two staged installs of the same pack id at once must not corrupt `<data>/packs/<id>-<ver>` or the registry. Pinned in Task 7 (`TestStagedInstallsSerialize`, `-race`).
5. **Session drop during a long upload:** a 401 mid-upload must log out like `api()`, and Cancel must abort without leaving a stuck progress bar. Pinned in Task 8 (fake XHR tests).
6. **Legacy sentence packs without a registry row** must list as "Licence not recorded", never as a blank or "unknown" that reads as fine. Pinned in Tasks 2, 5 and 9.

---

### Task 1: Bounded zip extraction with single-folder unwrap

**Files:**
- Modify: `server/internal/dict/pack.go` (ExtractZip, zipTarget, extractFile)
- Test: `server/internal/dict/pack_limits_test.go` (new)

**Interfaces:**
- Produces: `type ZipLimits struct { MaxFiles int; MaxBytes int64 }`; `var DefaultZipLimits = ZipLimits{MaxFiles: 2000, MaxBytes: 512 << 20}`; `func ExtractZipAt(r io.ReaderAt, size int64, dir string, lim ZipLimits) error`; `func PackRoot(dir string) (string, error)` — returns `dir` when `dir/manifest.json` exists, else the single subdirectory holding one, else `ErrInvalidPack` "manifest.json not found at the top of the zip". `ExtractZip(r, dir)` keeps its signature and calls `ExtractZipAt` with `DefaultZipLimits`. Limit errors wrap `ErrInvalidPack` and read `zip has more than 2000 files` / `zip unpacks to more than 512 MiB`.

- [ ] **Step 1: Write failing tests** (build zips in memory with `archive/zip`, small limits passed explicitly):
  - `TestExtractZipAtRejectsTooManyFiles`: 4 files, `ZipLimits{MaxFiles: 3, MaxBytes: 1<<20}` → `errors.Is(err, ErrInvalidPack)` and message contains `more than 3 files`.
  - `TestExtractZipAtStopsAtWrittenLimit`: one deflated entry of 2 MiB zeros with `MaxBytes: 1<<20` → error contains `more than`; also a variant whose header `UncompressedSize64` is patched to 10 (write with `CreateRaw` and a hand-set header) still fails — the cap counts written bytes.
  - `TestExtractZipAtKeepsTraversalRules`: `../x`, `/abs`, a symlink entry → `ErrInvalidPack` (same as today).
  - `TestPackRootUnwrapsSingleFolder`: `es-demo/manifest.json` → returns `<dir>/es-demo`; two top-level folders → error `manifest.json not found at the top of the zip`; root manifest → `<dir>`.
- [ ] **Step 2: Run** `go test ./internal/dict -run 'ExtractZipAt|PackRoot'` (Go gate command with `-run`): FAIL (undefined).
- [ ] **Step 3: Implement.** Count entries before extracting; wrap each entry reader in a counter shared across entries that errors once the running total exceeds `MaxBytes`. `loadZip` and `LoadPack` use `PackRoot` after extraction.
- [ ] **Step 4: Run** the Go gate: PASS (existing seed and dict tests unchanged).
- [ ] **Step 5: Commit** `feat(dict): bounded zip extraction and single-folder packs`.

### Task 2: Migration 026 — sentence-pack registry and dictionary language

**Files:**
- Create: `server/internal/db/migrations/026_pack_registry.sql`, `server/internal/db/migrate_026_test.go`
- Modify: `server/internal/dict/import.go` (`upsertDictionary` gains a `language` argument), `server/internal/sentences/sentences.go` (`writePack`, `Uninstall`)
- Test: `server/internal/sentences/registry_test.go` (new), `server/internal/dict/import_test.go`

**Interfaces:**
- Produces: table `sentence_packs (pack_id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, language TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, notice TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, deleted_at TEXT)`; column `dictionaries.language TEXT NOT NULL DEFAULT ''`.

- [ ] **Step 1: Failing tests.** `TestMigration026BackfillsDictionaryLanguage` (follow `migrate_025_test.go`: apply up to 025, insert a dictionary with one live sense on a `zh` entry and one with no senses, apply 026 → `zh` and `''`). `TestImportSetsDictionaryLanguage` (import fixture `es` pack → `language = 'es'`). `TestSentencePackRegistry`: `ImportPack` writes the row with the manifest's fields (notice included); re-import updates; `Uninstall` sets `deleted_at`; a re-import after uninstall clears it.
- [ ] **Step 2: Run**: FAIL.
- [ ] **Step 3: Implement.** Backfill: `UPDATE dictionaries SET language = COALESCE((SELECT e.language FROM senses s JOIN entries e ON e.id = s.entry_id WHERE s.dictionary_id = dictionaries.id AND s.deleted_at IS NULL LIMIT 1), '')`. Registry writes happen in the same transaction as the sentences.
- [ ] **Step 4: Run** the Go gate: PASS.
- [ ] **Step 5: Commit** `feat(db): sentence-pack registry and dictionary language (026)`.

### Task 3: Frequency-pack uninstall

**Files:**
- Modify: `server/internal/freq/freq.go`
- Test: `server/internal/freq/uninstall_test.go` (new)

**Interfaces:**
- Produces: `var ErrNotFound = errors.New("freq: pack not found")`; `func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error` — soft-deletes the `frequency_packs` row (`deleted_at`, `updated_at`) and deletes its `frequency` rows in one transaction; unknown or already-uninstalled → `ErrNotFound`.

- [ ] **Step 1: Failing test** `TestUninstallFrequencyPack`: import a 3-row csv pack; `Uninstall` → `Store.Packs` omits it, `Store.Rows` returns none for its terms; second `Uninstall` → `ErrNotFound`; re-`Import` revives it with its original `ord` and 3 rows.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement.** **Step 4: Run** the Go gate: PASS.
- [ ] **Step 5: Commit** `feat(freq): uninstall frequency packs`.

### Task 4: `internal/packs` — one import, uninstall and list for every type

**Files:**
- Create: `server/internal/packs/packs.go`, `server/internal/packs/packs_test.go`
- Modify: `server/cmd/qinqin/seed.go` (`importPack` → `packs.Import`)

**Interfaces:**
- Consumes: `freq.Uninstall` (Task 3), the 026 columns (Task 2).
- Produces:
  ```go
  type Installed struct {
      Type, PackID, Name, Version, Language, License, Attribution, Notice string
      UpdatedAt string // RFC 3339; "" for a legacy sentence pack
  }
  var ErrNotFound = errors.New("packs: not found")
  var ErrUnknownType = errors.New("packs: unknown type")
  func Import(ctx context.Context, db *sql.DB, p dict.Pack) (summary string, err error)
  func Uninstall(ctx context.Context, db *sql.DB, typ, packID string) error
  func List(ctx context.Context, db *sql.DB) ([]Installed, error)
  func Find(ctx context.Context, db *sql.DB, typ, packID string) (Installed, error)
  ```
  JSON tags (used by Task 5): `type, packId, name, version, language, license, attribution, notice, updatedAt`. `List` returns live packs sorted by type order dictionary, frequency, levels, sentences, then name, then pack id. Legacy sentence packs (distinct live `sentences.source_pack` with `user_id IS NULL` and no live registry row) appear with only `Type` and `PackID` set. `Uninstall` dispatches to `dict.Uninstall` (by the row id looked up from `pack_id`), `freq.Uninstall`, `levels.Uninstall` (by id), `sentences.Uninstall` (also soft-deletes the registry row); missing → `ErrNotFound`.
- [ ] **Step 1: Failing tests:** `TestImportDispatchesByType` (one fixture per type written from strings, summaries equal today's seed lines, e.g. `"4 entries, 4 senses"`); `TestListAllTypes` (fields and order; a legacy sentence row inserted by SQL lists with empty licence); `TestUninstallEachType` + `ErrNotFound` + `ErrUnknownType` for `"audio"`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; `seed.go` keeps its output format (existing `seed_test.go` stays green).
- [ ] **Step 4: Run** the Go gate: PASS.
- [ ] **Step 5: Commit** `refactor(packs): shared import, uninstall and list for every pack type`.

### Task 5: `GET /api/admin/packs`, `DELETE /api/admin/packs/{type}/{packId}`, public `GET /api/sentence-packs`

**Files:**
- Create: `server/internal/api/handlers_packs.go`, `server/internal/api/handlers_packs_test.go`
- Modify: `server/internal/api/api.go` (routes; add `packMu sync.Mutex` to `server`)

**Interfaces:**
- Consumes: `packs.List`, `packs.Uninstall` (Task 4).
- Produces: routes above; `GET /api/sentence-packs` (public, no auth) → `[{packId, name, version, language, license, attribution, notice}]` of live `sentence_packs` rows sorted by name; `s.packMu` held around every import/uninstall (also taken by the legacy `handleInstallDictionary` and the three legacy uninstall handlers).
- [ ] **Step 1: Failing tests** (`registerUser(t, ts.URL, "admin", "")` makes the first user admin; a second user is not): anonymous and non-admin → 403 on both routes; list after importing a dictionary and a sentence pack through `packs.Import` shows both with the JSON fields of Task 4; DELETE `dictionary/<packId>` → 204 and the list drops it; unknown pack → 404; unknown type → 404 "unknown pack type"; `GET /api/sentence-packs` without a token lists the registered sentence pack and omits legacy ones.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement.** **Step 4: Run** the Go gate: PASS.
- [ ] **Step 5: Commit** `feat(api): admin pack list and uninstall for every type`.

### Task 6: Staged upload — `POST /api/admin/packs` and `DELETE /api/admin/packs/staged/{token}`

**Files:**
- Create: `server/internal/api/pack_stage.go` (stage store), `server/internal/api/pack_stage_test.go`
- Modify: `server/internal/api/handlers_packs.go`, `server/internal/api/handlers_dict.go` (legacy install uses `ExtractZipAt` + `MaxBytesReader` too)

**Interfaces:**
- Consumes: `dict.ExtractZipAt`, `dict.PackRoot`, `dict.DefaultZipLimits` (Task 1), `packs.Find` (Task 4).
- Produces: `type stagedPack struct { token string; dir string; root string; userID int64; pack dict.Pack; expires time.Time }`; `func (s *server) stages() *stageStore` with `put`, `take(token, userID) (stagedPack, bool)` (removes it), `get`, `discard`, `sweep(now)`; response `{token, expiresAt, manifest: {id,name,version,type,language,license,attribution,notice,format}, replaces: null | {version, license, attribution}, files, bytes}` with status 201. Constants `maxPackUpload = 128 << 20`, `stageTTL = 30 * time.Minute`, `maxStages = 3`.
- [ ] **Step 1: Failing tests:** upload es-style dictionary zip → 201, manifest fields equal the manifest written, `replaces` null; upload again after installing → `replaces.version` is the installed version; a 129 MiB body (stream zeros via `io.MultiReader`, don't allocate) → 413 with the exact message; manifest without licence → 400 body containing `license is required` and **not** containing the test's data dir path; 4th live stage → 429; `DELETE staged/<token>` → 204 and the stage dir is gone; other admin's token → 404; `sweep` with a clock 31 min later drops the stage and its dir; a `.stage-old` dir with mtime 2 h ago is removed on the next upload.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** (read the multipart file through `io.ReaderAt` with `header.Size`; never `io.ReadAll`).
- [ ] **Step 4: Run** the Go gate and race: PASS.
- [ ] **Step 5: Commit** `feat(api): staged pack upload with limits and expiry`.

### Task 7: Install a staged pack in the background — `POST` and `GET /api/admin/packs/staged/{token}`

**Files:**
- Modify: `server/internal/api/handlers_packs.go`, `server/internal/api/pack_stage.go`
- Test: `server/internal/api/handlers_packs_test.go`

**Interfaces:**
- Consumes: the stage store (Task 6), `packs.Import`, `packs.Find`.
- Produces: `POST` body `{"license": string}` → `202 {"status":"importing"}`; `GET` → `{"status": "staged"|"importing"|"done"|"failed", "pack"?: <Installed JSON>, "summary"?: string, "error"?: string}`. The stage gains `status string; result *packs.Installed; summary, errMsg string`. The import goroutine uses `context.WithoutCancel(r.Context())`, takes `s.packMu`, imports, moves `root` to `<data>/packs/<id>-<version>` (as `packDir` today), removes the stage dir, and keeps the finished status readable until `expires` (reset to now + 30 min on finish). A test hook `s.importDone chan string` (nil in production) receives the token when a job ends, so tests never sleep.
- [ ] **Step 1: Failing tests:** `TestStagedInstallRequiresExactLicence` (body licence `"CC0-1.0 "` or missing → 409 "confirm the pack's licence" and `GET` still says `staged`; exact string → 202, then after `importDone` `GET` → `done`, `summary` = `"4 entries, 4 senses"` for a 4-entry fixture, list contains the pack); a second `POST` while importing → 409 "already importing" (hold `packMu` in the test to keep the job waiting); expired/unknown token → 404 on both; levels and sentences packs install through the same route; `TestStagedInstallsSerialize`: two stages of the same id started together → both `done`, one pack directory, one list row (`-race`); a dictionary whose `dictionary.json` is malformed behind a valid manifest → `failed` with `error` starting `invalid pack`, nothing listed, stage dir removed; the job finishes even when the client's request context is cancelled right after the 202.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement.** **Step 4: Run** Go gate and race: PASS.
- [ ] **Step 5: Commit** `feat(api): background install of staged packs after licence confirmation`.

### Task 8: Web API — XHR upload with progress and pack calls

**Files:**
- Create: `apps/web/src/lib/api/upload.ts`, `apps/web/src/lib/api/upload.test.ts`, `apps/web/src/lib/api/packs.ts`
- Modify: `apps/web/src/lib/api/client.ts` (export `notifyUnauthorized(): void` that runs the registered handler; `api()` uses it)

**Interfaces:**
- Produces:
  ```ts
  export interface UploadProgress { loaded: number; total: number }
  export function uploadWithProgress<T>(path: string, form: FormData, opts?: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal; xhr?: () => XMLHttpRequest }): Promise<T>;
  // packs.ts
  export interface InstalledPack { type: PackType; packId: string; name: string; version: string; language: string; license: string; attribution: string; notice: string; updatedAt: string }
  export type PackType = 'dictionary' | 'frequency' | 'levels' | 'sentences';
  export interface StagedPack { token: string; expiresAt: string; manifest: { id: string; name: string; version: string; type: PackType; language: string; license: string; attribution: string; notice: string; format: string }; replaces: { version: string; license: string; attribution: string } | null; files: number; bytes: number }
  export function listPacks(): Promise<InstalledPack[]>;
  export function stagePack(file: File, opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal }): Promise<StagedPack>;
  export interface StagedStatus { status: 'staged' | 'importing' | 'done' | 'failed'; pack?: InstalledPack; summary?: string; error?: string }
  export function installStaged(token: string, license: string): Promise<void>; // resolves on 202
  export function stagedStatus(token: string): Promise<StagedStatus>;
  export function waitForImport(token: string, opts?: { intervalMs?: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> }): Promise<StagedStatus>; // polls every 2000 ms until done or failed
  export interface SentencePack { packId: string; name: string; version: string; language: string; license: string; attribution: string; notice: string }
  export function listSentencePacks(): Promise<SentencePack[]>; // public, auth: false
  export function discardStaged(token: string): Promise<void>;
  export function uninstallPack(type: PackType, packId: string): Promise<void>;
  ```
- [ ] **Step 1: Failing tests** with a fake XHR class passed via `opts.xhr`: sets `Authorization: Bearer <token>` from `localStorage`-less `getToken` stub; forwards `upload.onprogress` as `{loaded,total}`; 201 JSON resolves; 400 text rejects `ApiError(400, text)`; 401 rejects and calls the unauthorized handler once; `signal.abort()` calls `xhr.abort()` and rejects with `DOMException` name `AbortError`; `waitForImport` with an injected `sleep` and a stubbed status sequence `importing, importing, done` resolves with `done` after 2 sleeps of 2000 ms, and rejects with `AbortError` when aborted.
- [ ] **Step 2: Run** `npm --prefix <wt>/apps/web test -- upload`: FAIL. **Step 3: Implement.** **Step 4: Run** web gates: PASS.
- [ ] **Step 5: Commit** `feat(web): XHR upload with progress and admin pack API`.

### Task 9: Web view helpers for packs

**Files:**
- Create: `apps/web/src/lib/settings/packsView.ts`, `apps/web/src/lib/settings/packsView.test.ts`

**Interfaces:**
- Produces: `PACK_TYPE_LABELS: Record<PackType,string>` (Dictionaries, Frequency lists, Level lists, Sentences); `groupPacks(list): { type: PackType; label: string; packs: InstalledPack[] }[]` (empty groups dropped); `licenceLine(license: string): { text: string; recorded: boolean }`; `licenceCaution(license: string): string | null`; `replaceLines(staged: StagedPack): { text: string; licenceChanged: boolean }[]`; `progressText(p: UploadProgress): string` (e.g. `"3.2 of 10.6 MB (30 %)"`); `uninstallWarning(type: PackType): string`.
- [ ] **Step 1: Failing tests** with the exact copy from Global Constraints: `licenceLine('')` → `{text: 'Licence not recorded — reinstall the pack to record it', recorded: false}`; `licenceLine('CC BY-SA 4.0').text` → `'CC BY-SA 4.0'`; `licenceCaution` returns the caution for `'unknown'`, `'Proprietary'`, `'CC BY-NC 4.0'`, `'research use only'`, `'All rights reserved'`, `'no redistribution'` and `null` for `'CC0-1.0'`, `'CC BY-SA 4.0'`, `'MIT'`; `replaceLines` marks a licence change; dictionary `uninstallWarning` equals the spec's sentence; no returned string matches `/verified|approved|cleared|safe|✓|✔/i` (loop over all outputs).
- [ ] **Step 2–4:** run FAIL, implement, run web gates PASS.
- [ ] **Step 5: Commit** `feat(web): pack view helpers with licence wording`.

### Task 10: Settings → Data tab and PackManager

**Files:**
- Create: `apps/web/src/lib/settings/PackManager.svelte`
- Modify: `apps/web/src/lib/settings/tabs.ts`, `apps/web/src/lib/settings/tabs.test.ts`, `apps/web/src/routes/settings/+page.svelte`, `apps/web/src/routes/sources/+page.svelte` and `apps/web/src/lib/sources/sections.ts` (+ its test: a Sentences section from `listSentencePacks`, same credit layout as frequency packs, omitted when empty), `plugins/data/README.md` (the sentences-notice sentence: now stored and shown)
- Create: `apps/web/src/lib/plugins/dataPacks.ts` + test (`isDataPackPlugin(p: PluginInfo): boolean` — manifest `type` in the four pack types)

**Interfaces:**
- Consumes: Tasks 8 and 9.
- Produces: `SETTINGS_TABS` gains `'data'` (label `'Data'`); `visibleSettingsTabs(admin: boolean): SettingsTab[]`; `parseSettingsTab(value, admin = false)` falls back to `'workspaces'` for `data` when not admin. The Data panel renders `<PackManager />` followed by a slot point the language plan fills (leave an `<!-- languages -->` comment).
- [ ] **Step 1: Failing tests:** `visibleSettingsTabs(false)` excludes `data`, `(true)` ends with `data`; `parseSettingsTab('data', false)` → `'workspaces'`; `isDataPackPlugin` true for a synthesized dictionary manifest, false for `qinqin-flashcards`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** the tab gating (read `$auth.user?.admin`), the Plugins tab filter (`!isDataPackPlugin`), and `PackManager.svelte` per the spec's Web section: list by `groupPacks`; file input `accept=".zip,application/zip"`; Upload → progress bar (`<progress max={total} value={loaded}>` + `progressText`) with Cancel; "Uploaded, checking the pack…"; review card (every manifest field, caution, replace lines with licence change emphasised, the confirmation checkbox, Install disabled until ticked, Discard calls `discardStaged`); Install → "Importing… large dictionaries can take a minute" + indeterminate `<progress>` while `waitForImport` polls; `done` shows `summary` in `role="status"` and reloads the list, `failed` shows `error` in `role="alert"`; uninstall opens a confirm dialog with `uninstallWarning(type)`; link "See all credits on the Sources page" to `/sources`. Leaving the page with a staged (not importing) pack calls `discardStaged` (best effort, `keepalive` not needed).
- [ ] **Step 4: Run** web gates: PASS.
- [ ] **Step 5: Commit** `feat(web): admin Data tab with pack install, review and uninstall`.

### Task 11: Real-app check, docs

**Files:**
- Modify: `plugins/data/README.md` (a short "Installing from the web app" paragraph: Settings → Data, zip layout, the limits), `docs/ROADMAP.md` (#40 in progress on `feature/pack-management`), plus fixes found (each with its own test and commit).

- [ ] **Step 1: Build and start** (port 8085 is the owner's container — leave it alone):
  ```bash
  docker build -t qinqin:packs <wt>
  mkdir -p <scratch>/packs-data
  docker run -d --name qinqin-packs -p 127.0.0.1:8087:8080 -v <scratch>/packs-data:/data qinqin:packs
  docker exec -e QINQIN_PASSWORD=packs-test-123 qinqin-packs qinqin adduser --username admin --admin
  docker exec -e QINQIN_PASSWORD=packs-test-123 qinqin-packs qinqin adduser --username learner
  (cd <wt>/plugins/data/es-demo && python3 -I -m zipfile -c <scratch>/es-demo.zip manifest.json dictionary.json)
  mkdir -p <scratch>/wrapped/es-demo && cp <wt>/plugins/data/es-demo/* <scratch>/wrapped/es-demo/ && (cd <scratch>/wrapped && python3 -I -m zipfile -c <scratch>/es-demo-folder.zip es-demo)
  ```
  `<scratch>` is the session scratchpad. Do not seed: the database starts empty.
- [ ] **Step 2: Drive the browser** (`run` skill) at `http://127.0.0.1:8087`:
  1. As `learner`: no Data tab; `/settings?tab=data` shows Workspaces; `curl` `GET /api/admin/packs` with the learner token → 403.
  2. As `admin`, Settings → Data: "no packs" state. Upload `es-demo.zip`: progress reaches 100 %, review shows `Spanish–English demo dictionary`, `es-demo`, `1.0`, dictionary, Spanish, licence `CC0-1.0`, attribution `Qinqin project — hand-written sample data`, no caution; Install disabled until ticked; Install → "Importing…", then summary `4 entries, 4 senses`; list shows it under Dictionaries; the Sources page credits it. On a second run, reload the tab right after Install: the list shows the pack once the import is done.
  3. Upload `es-demo-folder.zip` → review shows `replaces: version 1.0` and no licence change; Discard → `docker exec qinqin-packs ls -a /data/packs` has no `.stage-*`.
  4. Make a copy of the manifest with `"license": "unknown"` and zip it → the caution line appears and nothing claims the licence is fine; Discard.
  5. A 130 MiB zip (`head -c 136314880 /dev/urandom > big.bin`, zipped) → 413 message shown; a zip with a symlink entry → readable error, no path in it.
  6. Uninstall es-demo → confirm dialog text, list empty, search for `hola` in an `es` workspace finds nothing.
  7. Re-run step 2 (the language plan's demo continues from here). Settings → Plugins shows only feature plugins.
  8. Throttle the network in DevTools to "Slow 3G", upload, Cancel mid-way → bar disappears, no stage dir.
- [ ] **Step 3: Seed the bundle** (`docker exec qinqin-packs qinqin seed --packs /opt/qinqin/packs`) and check the Data tab lists CC-CEDICT, Unihan, JMdict, KANJIDIC2, Jiten frequency, the level lists, each with its stated licence verbatim.
- [ ] **Step 4: Stop** (`docker rm -f qinqin-packs`), run all gates on the tip.
- [ ] **Step 5: Commit** `docs: pack management in the README and roadmap`. Do not merge or push.

---

## Risks and notes for the owner

- A reverse proxy in front of qinqin may cap request bodies below 128 MiB (nginx defaults to 1 MiB) or time out a long JMdict import; the UI shows the proxy's error. Documented in `plugins/data/README.md`.
- Pack files under `<data>/packs/` stay after uninstall (unchanged behaviour).
- Sentence packs imported before migration 026 show "Licence not recorded" until reinstalled; none are bundled today.
- The licence caution is a word heuristic; it can miss restrictive terms written in other words.
