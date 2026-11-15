# Feature Plugin SDK (issue #39) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** A checked, single-sourced feature-plugin contract (`sdk`, `surfaces`, `permissions`, `hooks`, `events`), server validation on registration, write enforcement of `owns-data`, a web SDK over plugin data and events, one `study-event` hook, and permission lines in Settings.

**Architecture:** Built-in manifests become JSON files in `server/internal/plugins/builtin/`, embedded by Go and imported by the web through a `$builtin` alias. `plugins.ParseManifest` validates strictly; `Register` adds an event-type ownership check. The web gets `lib/plugins/contract.ts`, `sdk.ts` and `hooks.ts`; the journal and the home layout move onto the SDK.

**Tech Stack:** Go 1.26 (stdlib, modernc SQLite, `embed`), SvelteKit 2 + Svelte 5 runes, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-plugin-sdk-design.md` (read it whole; its Rulings bind). The core-stats plan (`2026-11-15-core-stats.md`) runs after this one on the same branch.

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/plugin-sdk`, branch `feature/plugin-sdk` from `develop` (`git worktree add -b feature/plugin-sdk .claude/worktrees/plugin-sdk develop`). Ledger (git-ignored): `<wt>/.superpowers/sdd/2026-11-15-plugin-sdk/progress.md`. Run `npm --prefix <wt>/apps/web ci` once before the first web gate.

## Gates

- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`.
- Go (own user, scratch caches, so no root-owned files appear in the tree): `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOPATH=/tmp/gopath -e GOCACHE=/tmp/gocache -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."`.
- Go race for touched packages: the same with `sh -c "go test -race ./internal/plugins/... ./internal/api/... ./internal/sync/..."`.
- Every task ends with all gates green and one commit (conventional message, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Explicit `git add <paths>`. Never merge or push.

## Global Constraints

- Contract values (verbatim from the spec): `SDKMin = SDKMax = 1`; surfaces `home-widget`, `page`, `hook`; permissions `owns-data`, `read:entries`, `read:study-events`, `write:study-events`; hooks `study-event`; id `^[a-z0-9]+(-[a-z0-9]+)*$` ≤ 64; name 1..80; version `^\d+\.\d+(\.\d+)?$`; type `feature`; description ≤ 200; event type `^[a-z][a-z0-9-]*$`.
- A manifest without `sdk` already stored is grandfathered: served and written as before. New registrations must pass `ParseManifest`.
- Event batch and sync push keep accepting every event type (spec ruling). No user data may be refused that is accepted today, except plugin-data writes of an sdk ≥ 1 plugin without `owns-data`.
- The four built-in manifests and their fields are the spec's table; versions `1.1`. `activity` in an `events` entry is accepted as any JSON object in this plan (the core-stats plan types and validates it).
- Web style: tabs, single quotes, Svelte 5 runes, 44 px targets, keyboard operable. No `{@html}`.

## Review Focus

1. **An upgrade must not lock anyone out of their data or stop the server.** A database with admin-registered legacy rows and existing plugin-data rows must start, list, read and write as before. Pinned in Task 2 (`TestRegisterBuiltinOverLegacyDB`, `TestRegisterBuiltinWinsConflict`) and Task 3 (`TestCanWriteDataGrandfathered`).
2. **Offline sync losing a batch to one row.** An `owns-data` refusal skips only that row; events still land, and every id the web writes (`qinqin-flashcards`, `qinqin-journal`, `qinqin-core`) is accepted. Pinned in Task 3 (`TestPushSkipsUndeclaredWriter`, `TestPushAcceptsBuiltinWriters`).
3. **The Docker build and `npm run dev` resolving `$builtin`.** The web stage only copies `apps/web` today. Pinned in Task 4 Step 6 (`docker build` succeeds) and Step 5 (dev server loads `/` without an fs.allow error).
4. **A throwing hook handler breaking event recording.** `postEvents` must still resolve and invalidate caches. Pinned in Task 5 (`hooks isolate a throwing handler`).
5. **Journal behaviour drift during the SDK migration** (keepalive on leave, 404 → null, string data decoding, prefix encoding). Pinned in Task 6 by keeping `journal/store.test.ts` unchanged and green.

---

### Task 1: `ParseManifest` — the strict, checked contract

**Files:**
- Create: `server/internal/plugins/manifest.go`, `server/internal/plugins/manifest_test.go`

**Interfaces:**
- Produces:
  ```go
  const SDKMin, SDKMax = 1, 1
  type EventDecl struct { Type string `json:"type"`; Activity json.RawMessage `json:"activity,omitempty"` }
  type Manifest struct {
      ID, Name, Version, Type, Description string // json tags id,name,version,type,description
      SDK int `json:"sdk"`
      Surfaces, Permissions, Hooks []string
      Events []EventDecl
  }
  func ParseManifest(raw []byte) (Manifest, error)   // errors wrap ErrInvalidManifest
  func (m Manifest) Has(permission string) bool
  ```
- `ErrInvalidManifest` stays the sentinel; its message changes to `plugins: invalid manifest`. The wrapped error text is `plugins: invalid manifest: <problem>; <problem>` with problems in field order.

- [ ] **Step 1: Write the failing table test** `TestParseManifest`: a valid base manifest (the journal row from the spec, `activity` omitted) parses; each case mutates one field and asserts `errors.Is(err, ErrInvalidManifest)` and that the message contains the named fragment:
  - `id: "Qinqin_X"` → `id "Qinqin_X" must match`; 65-char id → `id must be at most 64`; `name: ""` → `name is required`; `version: "v1"` → `version "v1" must look like 1.0 or 1.0.0`; `type: "data"` → `type must be "feature"`; `sdk` missing → `sdk 0 is not supported (1..1)`; `sdk: 2` → `sdk 2 is not supported`.
  - `surfaces: ["widget"]` → `surfaces[0] "widget" is unknown`; duplicate surface → `surfaces[1] "page" is repeated`; same two checks for `permissions` and `hooks`.
  - `surfaces: ["hook"], hooks: []` → `hooks must not be empty with the "hook" surface`; `hooks: ["study-event"]` without the surface → `hooks must be empty without the "hook" surface`.
  - `events: [{"type":"Bad"}]` → `events[0].type "Bad" must match`; repeated event type → `events[1].type "journal" is repeated`; events without `write:study-events` → `events need the write:study-events permission`; `activity: 3` → `events[0].activity must be an object`.
  - unknown field `permision` → `unknown field "permision"`; not an object → error wraps the decoder message.
  - two problems at once (bad id and bad sdk) → both fragments, `; `-joined.
  Also `TestManifestHas`.
- [ ] **Step 2: Run the Go gate**: FAIL (`ParseManifest` undefined).
- [ ] **Step 3: Implement** in `manifest.go` with `json.Decoder.DisallowUnknownFields`; collect problems in a slice, return `fmt.Errorf("%w: %s", ErrInvalidManifest, strings.Join(problems, "; "))`. `manifestID` in `plugins.go` stays for grandfathered reads.
- [ ] **Step 4: Run the Go gate**: PASS.
- [ ] **Step 5: Commit** `feat(plugins): strict feature-plugin manifest contract (sdk 1)`.

### Task 2: Embedded built-in manifests, checked registration, ownership of event types

**Files:**
- Create: `server/internal/plugins/builtin/{core,flashcards,reader,journal}.json`, `server/internal/plugins/builtin.go`, `server/internal/plugins/builtin_test.go`
- Modify: `server/internal/plugins/plugins.go` (`Register`), `server/cmd/qinqin/main.go` (drop the four constants; `registerBuiltinPlugins` loops over `plugins.Builtin()`), `server/internal/api/handlers_plugins.go` (400 body = error text), and every test that registers a manifest: `server/cmd/qinqin/main_test.go`, `server/cmd/qinqin/ai_env_test.go`, `server/internal/plugins/plugins_test.go`, `server/internal/sync/sync_test.go`, `server/internal/sync/sync_review_test.go`, `server/internal/api/handlers_body_limits_test.go`, `server/internal/api/handlers_plugins_test.go`, `server/internal/api/handlers_journal_test.go`

**Interfaces:**
- Consumes: `ParseManifest`, `Manifest` (Task 1).
- Produces: `func Builtin() [][]byte` (order core, flashcards, reader, journal); `func BuiltinIDs() []string` (same order); `Register` now returns `ErrInvalidManifest`-wrapped errors for contract failures and for `event type "<t>" is already owned by <id>`; `func RegisterBuiltin(ctx context.Context, sqlDB *sql.DB, raw []byte) (conflicts []string, err error)` parses (error on failure) and upserts without the ownership check, returning the sorted ids of other parsable rows claiming one of its event types.
- JSON contents: the spec's table, `"version":"1.1"`, `"sdk":1`, `"type":"feature"`, a one-line `description` each, `events` as `[{"type":"review"}]` etc. (no `activity` yet), `hooks: []`.

- [ ] **Step 1: Write failing tests:**
  - `TestBuiltinManifestsValid`: every `Builtin()` file passes `ParseManifest`; ids are exactly `qinqin-core, qinqin-flashcards, qinqin-reader, qinqin-journal`; the surfaces/permissions/events equal the spec's table.
  - `TestRegisterRejectsOwnedEventType`: register flashcards, then a manifest `qinqin-other` declaring `review` → `errors.Is(err, ErrInvalidManifest)` and the message contains `event type "review" is already owned by qinqin-flashcards`; re-registering flashcards itself succeeds.
  - `TestRegisterIgnoresUnparsableRowsForOwnership`: insert a legacy row `{"id":"legacy","events":"x"}` directly with SQL; registering flashcards succeeds.
  - `TestRegisterBuiltinWinsConflict`: an admin sdk-1 row `qinqin-other` declaring `read` exists; `RegisterBuiltin(reader)` succeeds and returns `["qinqin-other"]`; `registerBuiltinPlugins` logs `plugin qinqin-other also claims event types of qinqin-reader; the built-in wins` (capture with the existing log hook in `main_test.go`, or pass a `logf`).
  - `TestRegisterBuiltinOverLegacyDB` (in `server/cmd/qinqin/main_test.go`): a DB holding the old 1.0 rows of all four plugins and a legacy `qinqin-heatmap` row → `registerBuiltinPlugins` succeeds, rows carry `"sdk":1`, heatmap is gone.
  - In `handlers_plugins_test.go`: `POST /api/admin/plugins` with `{"id":"x","name":"X","version":"1","type":"feature","sdk":1,"surfaces":[],"permissions":[]}` → 400 and the body contains `version "1" must look like`.
- [ ] **Step 2: Run the Go gate**: FAIL.
- [ ] **Step 3: Implement.** `Register`: `ParseManifest`, then in one `BeginTx`: read every other registry row, `ParseManifest` each (skip errors), conflict check on `Events[].Type`, then the existing upsert. Update the listed test fixtures to valid sdk-1 manifests (add a test helper `validManifest(id string, extra string) string` per package where it is used more than twice). The `language` field in the `plugins_test.go` heatmap fixture goes.
- [ ] **Step 4: Run the Go gate and the race gate**: PASS.
- [ ] **Step 5: Commit** `feat(plugins): embedded built-in manifests, checked registration and event-type ownership`.
- Ruling: the one-line `description` of each built-in is plain user-facing prose (core: "The core app: home layout and study session, view and lookup activity."); the `validManifest(id, extra)` helper repeats a key to override a default (Go's decoder keeps the last), so a fixture states only what differs. `handlers_body_limits_test.go` needs no change: its manifest is oversized and refused with 413 before parsing. No migration is needed by tasks 1-4 (the "next free number" note applies to the sibling plans; develop ends at 025).

### Task 3: `owns-data` enforced on plugin-data writes

**Files:**
- Modify: `server/internal/plugins/plugins.go`, `server/internal/api/handlers_plugins.go` (PUT and DELETE data), `server/internal/sync/sync.go` (`Push`)
- Test: `server/internal/plugins/plugins_test.go`, `server/internal/api/handlers_plugins_test.go`, `server/internal/sync/sync_test.go`

**Interfaces:**
- Produces: `func CanWriteData(ctx context.Context, sqlDB *sql.DB, pluginID string) (exists, allowed bool, err error)`. Data plugins and grandfathered rows (no `sdk`, or unparsable) → `(true, true)`; sdk-1 rows → `allowed = Has("owns-data")`; unknown → `(false, false)`.

- [ ] **Step 1: Write failing tests:** `TestCanWriteData` matrix (data plugin dictionary pack; sdk-1 with and without `owns-data`; unknown id); `TestCanWriteDataGrandfathered` (row `{"id":"legacy","name":"L"}` → allowed); handler tests: PUT and DELETE `/api/plugins/qinqin-reader/data/k` → 403 `plugin does not declare owns-data`, GET still 404/200 as before; `TestPushSkipsUndeclaredWriter` (a push of 2 events, one `qinqin-reader` row and one `qinqin-flashcards` row → no error, `eventsAccepted 2`, `dataAccepted 1`, `dataRefused 1`, the reader row absent) and `TestPushAcceptsBuiltinWriters` (rows for `qinqin-flashcards`, `qinqin-journal`, `qinqin-core` all applied).
- [ ] **Step 2: Run the Go gate**: FAIL.
- [ ] **Step 3: Implement** `CanWriteData` (reuse `Exists` for data plugins; read `manifest_json` for registry rows). Handlers: 404 when `!exists` (unchanged text), 403 when `!allowed`. `Push`: replace the `Exists` call with `CanWriteData`; `!exists` keeps `ErrNotFound` (whole push fails, as today); `!allowed` marks the plugin refused: its rows are not applied and are counted in the new `PushResult.DataRefused int` (`json:"dataRefused"`), while events and other rows apply.
- [ ] **Step 4: Run the Go gate and the race gate**: PASS.
- [ ] **Step 5: Commit** `feat(plugins): plugin-data writes need owns-data`.
- Ruling: `DELETE /api/plugins/{id}/data/{key}` for an unknown plugin answers 404 with its old text `plugin data not found` (PUT keeps `plugin not found`); `GET` is unchanged. A registry row whose manifest does not parse for any reason (not only a missing `sdk`) counts as grandfathered, so a malformed legacy row never locks its owner out of data.

### Task 4: Web contract, `$builtin` manifests, Docker and dev wiring

**Files:**
- Create: `apps/web/src/lib/plugins/contract.ts`, `apps/web/src/lib/plugins/contract.test.ts`, `apps/web/src/lib/plugins/manifests.test.ts`, `apps/web/src/lib/plugins/core/manifest.ts`
- Modify: `apps/web/svelte.config.js` (`kit.alias: { $builtin: '../../server/internal/plugins/builtin' }`), `apps/web/vite.config.ts` (`server.fs.allow: [searchForWorkspaceRoot(process.cwd()), '../../server/internal/plugins/builtin']`, import from `vite`), `Dockerfile` (web stage: `COPY server/internal/plugins/builtin /src/server/internal/plugins/builtin` before `npm run build`), `apps/web/src/lib/plugins/index.ts` (`PluginManifest = ContractManifest & { sources?; widgets? }`; `CORE_PLUGIN_ID` re-exported from `core/manifest.ts`), the three `manifest.ts` files (spread their JSON)

**Interfaces:**
- Produces (in `contract.ts`):
  ```ts
  export const SDK_VERSION = 1;
  export const SURFACES = ['home-widget', 'page', 'hook'] as const;
  export const PERMISSIONS = ['owns-data', 'read:entries', 'read:study-events', 'write:study-events'] as const;
  export const HOOKS = ['study-event'] as const;
  export type Permission = (typeof PERMISSIONS)[number]; // likewise Surface, Hook
  export interface EventDecl { type: string; activity?: Record<string, unknown> }
  export interface ContractManifest { id: string; name: string; version: string; type: 'feature'; sdk: number;
    description?: string; surfaces: Surface[]; permissions: Permission[]; hooks: Hook[]; events: EventDecl[] }
  export const PERMISSION_LABELS: Record<Permission, string>; // 'Stores its own data', 'Reads dictionary entries', 'Reads your study history', 'Records study activity'
  export function sdkSupported(manifest: unknown): boolean;   // object with integer sdk === SDK_VERSION
  export function builtinManifests(): ContractManifest[];     // core, flashcards, reader, journal JSON
  export function logChangingTypes(): ReadonlySet<string>;    // event types of every non-core built-in
  ```
  `coreManifest: PluginManifest` in `core/manifest.ts`.

- [ ] **Step 1: Write failing tests.** `contract.test.ts`: `sdkSupported` true for `{sdk:1}`, false for `{}`, `{sdk:'1'}`, `{sdk:2}`, `null`; `logChangingTypes()` equals `{'review','read','journal'}`; `PERMISSION_LABELS` has a non-empty string per permission. `manifests.test.ts`: for each `webPlugins` entry, `'page' ∈ surfaces ⇔ pages?.length`, `'home-widget' ∈ surfaces ⇔ widgets?.length`; every literal of `EventType` in `lib/events.ts` (list them in the test as a `satisfies readonly EventType[]` tuple) is declared by exactly one built-in; each web manifest's `id/name/version/surfaces` equals its JSON.
- [ ] **Step 2: Run `npm --prefix <wt>/apps/web test`**: FAIL.
- [ ] **Step 3: Implement** the alias, `fs.allow`, Dockerfile line, `contract.ts`, `core/manifest.ts`, and the manifest spreads (`{ ...(json as ContractManifest), widgets: [...], sources: [...] }`). `lib/events.ts` replaces `LOG_CHANGING_TYPES` with `logChangingTypes()`.
- [ ] **Step 4: Run the three web gates**: PASS.
- [ ] **Step 5: Dev check:** `npm --prefix <wt>/apps/web run dev -- --port 5199 --host 127.0.0.1` in the background, `curl -s http://127.0.0.1:5199/src/lib/plugins/journal/manifest.ts | head -5` returns JS (no 403 "outside of Vite serving allow list"); stop it.
- [ ] **Step 6: Docker check:** `docker build -t qinqin:plugin-sdk --build-arg WITH_OCR=0 <wt>` succeeds.
- [ ] **Step 7: Commit** `feat(web): plugin contract and manifests from the server's built-in JSON`.
- Ruling: `server.fs.allow` uses `searchForWorkspaceRoot('.')` (not `process.cwd()`), because the web package has no `@types/node` and svelte-check rejects `process`; vite runs from `apps/web`, so the result is the same. Test files that built a `PluginManifest` literal use a new `lib/plugins/fixtures.ts` `fixtureManifest()` instead of repeating the six contract fields. JSON imports are cast `as unknown as ContractManifest` because TypeScript infers `string`/`string[]` for the literal unions.

### Task 5: The SDK and the `study-event` hook

**Files:**
- Create: `apps/web/src/lib/plugins/sdk.ts`, `apps/web/src/lib/plugins/sdk.test.ts`, `apps/web/src/lib/plugins/hooks.ts`, `apps/web/src/lib/plugins/hooks.test.ts`
- Modify: `apps/web/src/lib/events.ts` (`postEvents` calls `emitStudyEvents(events)` after a successful POST), `apps/web/src/routes/+layout.svelte` (call `setHookStates(list)` whenever plugin states become ready)

**Interfaces:**
- Consumes: `ContractManifest`, `PluginInfo`, `api`/`ApiError` (`$lib/api/client`), `postEvents`, `newUlid`.
- Produces: the spec's `PermissionError`, `DataRow`, `DataScope`, `PluginSdk`, `createPluginSdk(manifest)` exactly; `hooks.ts`: `registerStudyEventHandler(pluginId: string, handler): () => void`, `emitStudyEvents(events: StudyEventBody[]): void`, `setHookStates(states: PluginInfo[]): void` (before the first call, every plugin counts as enabled — the server default).

- [ ] **Step 1: Write failing tests** (`fetch` stubbed with `vi.stubGlobal`, as in `journal/store.test.ts`):
  - permissions: `createPluginSdk(noData).data.user()` throws `PermissionError` with a message containing the plugin id and `owns-data`; same for `events.list` (`read:study-events`), `events.record` (`write:study-events`), `onStudyEvent` without the hook.
  - `events.record('other', 3)` for a manifest declaring only `journal` → rejects with `PermissionError` naming `other`.
  - data: `workspace(3).get('k')` → GET `/api/plugins/<id>/data/k?workspace=3`; 404 → `null`; `data: '{"a":1}'` → `{a:1}`; unparsable string → `null`; `user().get` has no `workspace=`; `list('entry:')` → `?workspace=3&prefix=entry%3A`, rows mapped to `DataRow`; `delete` on 404 resolves; `put(k, v, {keepalive:true})` passes `keepalive: true`; keys are `encodeURIComponent`-ed.
  - events: `list({ types: ['read'] })` → GET `/api/events?since=1970-01-01T00:00:00Z` without workspace, filtered to `read`; `record` posts one ULID event with `device: 'web'` and the given `at`, and rejects when the POST fails.
  - hooks: a registered handler receives the posted batch; a disabled plugin's handler (via `setHookStates`) is not called; `hooks isolate a throwing handler` — the next handler still runs, `postEvents` resolves, `console.error` was called once.
- [ ] **Step 2: Run web tests**: FAIL.
- [ ] **Step 3: Implement** `sdk.ts` and `hooks.ts`; `sdk.onStudyEvent` delegates to `registerStudyEventHandler(manifest.id, …)`.
- [ ] **Step 4: Run the three web gates**: PASS.
- [ ] **Step 5: Commit** `feat(web): plugin SDK over plugin data and events, and the study-event hook`.

### Task 6: Journal and home layout on the SDK

**Files:**
- Modify: `apps/web/src/lib/plugins/journal/store.ts` (all data access through `createPluginSdk(journalManifest).data.workspace(ws)`), `apps/web/src/lib/plugins/journal/EntryEditor.svelte`, `PhotoImport.svelte` (post the journal event through `sdk.events.record('journal', ws, { entryId }, now)`; keep `journalEventDue`), `apps/web/src/lib/plugins/journal/entryDraft.ts` (drop `journalEvent` if unused), `apps/web/src/lib/widgets/layout.ts` (through `createPluginSdk(coreManifest).data.user()`)
- Delete: `apps/web/src/lib/api/pluginData.ts`, `apps/web/src/lib/api/pluginData.test.ts` (move any case not covered by `sdk.test.ts` there first)

**Interfaces:** Consumes `createPluginSdk`, `journalManifest`, `coreManifest`. Public functions of `journal/store.ts` and `widgets/layout.ts` keep their signatures.

- [ ] **Step 1: Run `journal/store.test.ts`, `entryDraft.test.ts` and `widgets/layout.test.ts`**: PASS (baseline). Adjust only tests of `journalEvent` if it is removed.
- [ ] **Step 2: Refactor** the files listed; `JOURNAL_PLUGIN_ID` stays exported (`= journalManifest.id`).
- [ ] **Step 3: Run the three web gates**: PASS with the store and layout tests unchanged.
- [ ] **Step 4: Commit** `refactor(journal): data and events through the plugin SDK`.

### Task 7: Settings → Plugins shows permissions and "Needs an app update"

**Files:**
- Create: `apps/web/src/lib/settings/pluginRows.ts`, `apps/web/src/lib/settings/pluginRows.test.ts`
- Modify: `apps/web/src/routes/settings/+page.svelte` (Plugins tab rows)

**Interfaces:** Produces `pluginRowInfo(plugin: PluginInfo, web: WebPlugin[]): { permissions: string; needsUpdate: boolean }` — `permissions` is the labels joined with ` · ` (empty for data plugins); `needsUpdate` is true for a `type: 'feature'` manifest with no web module (`pluginState` id matching) or `!sdkSupported(manifest)`.

- [ ] **Step 1: Failing tests:** journal row → `'Stores its own data · Records study activity'`, `needsUpdate` false; a registry-only feature plugin → true; a feature manifest with `sdk: 2` → true; a dictionary pack → `''`, false.
- [ ] **Step 2: Run web tests**: FAIL. **Step 3: Implement** and render a muted second line plus a "Needs an app update" badge (text, not colour only); the toggle stays enabled.
- [ ] **Step 4: Run the three web gates**: PASS. **Step 5: Commit** `feat(settings): plugin permissions and app-update notice`.

### Task 8: Real-app check and docs

**Files:** Modify `docs/ROADMAP.md` (#39 line: "in progress on `feature/plugin-sdk`"), `README.md` (a short "Feature plugins" paragraph: manifests in `server/internal/plugins/builtin/`, the four permissions, the SDK), fixes found (each with its own test and commit).

- [ ] **Step 1:** `docker run -d --name qinqin-plugin-sdk -p 127.0.0.1:8087:8080 -v <scratch>/sdk-data:/data qinqin:plugin-sdk` (rebuilt from the tip), `docker exec qinqin-plugin-sdk qinqin seed --packs /opt/qinqin/packs`, `docker exec -e QINQIN_PASSWORD=sdk-test-123 qinqin-plugin-sdk qinqin adduser --username tester --admin` (only if Step 2 did not already create the tester on this volume). Port 8085 is the owner's container; leave it alone.
- [ ] **Step 2: Upgrade path** (do this before Step 1's `docker run`): build `qinqin:develop-base` from a `develop` checkout (`git worktree add <scratch>/base develop`), run it on `<scratch>/sdk-data` at the same port, create the tester, write a journal entry and change the home layout, stop it; then run Step 1 on the same volume. Expected: starts cleanly, the log has no conflict warning, the entry and layout are still there. Never touch the owner's data in `/home/user/qinqin-integration-data`.
- [ ] **Step 3: Browser (the `run` skill), 1280 and 390 px, light and dark:** journal create/edit/delete and its heatmap point; home layout edit survives reload; Settings → Plugins shows the permission lines; keyboard reaches every toggle.
- [ ] **Step 4: API:** with the admin token, `POST /api/admin/plugins` a manifest with `"permision":[]` → 400 naming `unknown field "permision"`; `PUT /api/plugins/qinqin-reader/data/x?workspace=<id>` → 403.
- [ ] **Step 5:** `docker rm -f` the containers; all gates on the tip; commit `docs: plugin SDK in the README and roadmap`. Hand over with the finishing-a-development-branch menu; do not merge or push.
