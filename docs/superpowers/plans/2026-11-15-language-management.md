# Language and Workspace Management (issue #41) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** Admins see and manage languages (built-in and data-only) in Settings → Data; learners hide dictionaries per workspace and get clear hints when a language has no dictionary or level lists; the Spanish–English demo works end to end from the UI.

**Architecture:** Small server changes: language-code validation and code-pack listing in `internal/lang`, a richer public `GET /api/languages`, `packId`/`language` on `GET /api/dictionaries`, and admin language routes. The web filters senses client-side from `workspace.settings.hiddenDictionaries` (dictionary ids), adds coverage hints from pure helpers, and a `LanguageManager.svelte` under the pack manager in the Data tab.

**Tech Stack:** Go 1.26 (stdlib mux, modernc SQLite), SvelteKit 2 + Svelte 5 (runes), vitest (node environment). No new dependencies; no migration.

**Spec:** `docs/superpowers/specs/2026-11-15-language-management-design.md` (and its dependency `2026-11-15-pack-management-design.md`). Its Rulings are binding.

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/language-management`, branch `feature/language-management` **from the tip of `feature/pack-management`** (needs migration 026, `GET /api/admin/packs`, the Data tab). Ledger (git-ignored): `<wt>/.superpowers/sdd/2026-11-15-language-management/progress.md`. Run `npm --prefix <wt>/apps/web ci` once before the first web gate.

## Gates

- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`.
- Go (own user, scratch caches): `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOMODCACHE=/tmp/gomod -e GOPATH=/tmp/gopath -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."`.
- Every task ends with all gates green and one commit on `feature/language-management` (conventional message, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never merge or push.

## Global Constraints

- Code pattern after normalisation (trim, lowercase, `_`→`-`): `^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$`.
- Messages: invalid code `422` "language must be a code like es or pt-br"; non-admin unknown code `422` "unknown language — ask the administrator to add it"; register code pack `409` "<code> is built in"; delete in use `409` "still used by packs or workspaces".
- `hiddenDictionaries` is an array of dictionary ids (numbers) in `workspace.settings`; malformed values are ignored, never an error.
- Hint copy: no dictionary — admin "No dictionary is installed for <Label>. Install one in Settings → Data." / others "No dictionary is installed for <Label>. Ask the administrator of this server to install one."; no levels — "No level lists for <Label>: level badges and filters are unavailable."; all hidden — "Shown although its dictionaries are hidden in this workspace"; reveal button "Show <n> from hidden dictionaries"; registration note "Adds the language to the workspace list. It has no dictionary until you install a pack for it."
- Labels always from `languageLabel(code)`, never from the server's `name`.
- No new migration (026 comes from the pack plan). Web style: tabs, single quotes, runes, 44 px targets, keyboard reachable.

## Review Focus

1. **Every dictionary hidden:** an entry must still show its senses with the "Shown although…" note, never an empty card. Pinned in Task 5 (`partitionSenses` all-hidden test) and checked in Task 8.
2. **Stale hidden ids** (a dictionary uninstalled, ids from another language, strings in the array) must be ignored without errors. Pinned in Task 5.
3. **Legacy odd codes** already stored (`pt_BR`, `Hello`) must list, be flagged and stay removable. Pinned in Task 3 (`TestDeleteLanguageExactStoredCode`) and Task 7.
4. **Language still referenced after a pack uninstall:** orphaned glossless entries must not block removal, but a workspace must. Pinned in Task 3.
5. **Reader in a book of a non-current workspace** uses the book's workspace hidden list. Pinned in Task 5 (`hiddenFor` test).

---

### Task 1: Code validation and the code-pack list

**Files:**
- Modify: `server/internal/lang/lang.go`, `server/internal/api/handlers_workspaces.go` (`handleCreateWorkspace`)
- Test: `server/internal/lang/lang_test.go`, `server/internal/api/handlers_workspaces_test.go`

**Interfaces:**
- Produces: `func Codes() []string` (sorted registered code-pack codes); `func ValidCode(raw string) (code string, ok bool)`.
- [ ] **Step 1: Failing tests:** `ValidCode` — `"ES"`→`es`, `" pt_BR "`→`pt-br`, `"zh-hant-tw"` ok, `"e"`, `"spanish"`, `"es-"`, `"es-x-very-long-tag"`, `""`, `"Hello!"` not ok; `Codes()` = `["ja","zh"]` after the test init registers both. Workspace API: admin `POST {language:"pt"}` → 201 and a `languages` row; non-admin `POST {language:"pt"}` (unknown) → 422 "unknown language — ask the administrator to add it"; non-admin `"es"` after a `languages` row exists → 201; `"Hello!"` → 422 "language must be a code like es or pt-br"; non-admin `"zh"` → 201 (code pack).
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** (`u.Admin` decides auto-registration). **Step 4: Run** the Go gate: PASS.
- [ ] **Step 5: Commit** `feat(lang): validate language codes; only admins register new ones`.

### Task 2: `GET /api/languages` lists every known language; dictionaries carry pack id and language

**Files:**
- Modify: `server/internal/api/handlers_languages.go`, `server/internal/api/handlers_dict.go` (`dictionaryBody`, its queries)
- Test: `server/internal/api/handlers_languages_test.go`, `server/internal/api/handlers_dict_test.go`

**Interfaces:**
- Produces: `languageInfo` gains `Kind string \`json:"kind"\`` (`"code"` or `"data"`); the handler returns the union of `lang.Codes()`, `languages` rows and `installedLanguages`, sorted by code, `installed` true only for installed ones. `installedLanguages` and `ensureDefaultWorkspaces` are unchanged. `dictionaryBody` gains `PackID string \`json:"packId"\`` and `Language string \`json:"language"\``.
- [ ] **Step 1: Failing tests:** empty DB → `[{ja,ja,false,code},{zh,zh,false,code}]`; after importing an `es` dictionary → `es` `installed:true kind:"data"`; a bare `languages` row `pt` → `installed:false kind:"data"`; after uninstalling the `es` dictionary → `es` `installed:false`; `GET /api/dictionaries` rows carry `packId` and `language`. Existing `languages_plan_test.go` (query plan) stays green.
- [ ] **Step 2–4:** FAIL, implement, Go gate PASS.
- [ ] **Step 5: Commit** `feat(api): list all known languages and dictionary language`.

### Task 3: Admin language routes

**Files:**
- Create: `server/internal/api/handlers_admin_languages.go`, `server/internal/api/handlers_admin_languages_test.go`
- Modify: `server/internal/api/api.go` (routes)

**Interfaces:**
- Produces: `POST /api/admin/languages {code}` (body cap 4 KiB) → 201/200 `languageInfo`; `DELETE /api/admin/languages/{code}` → 204; `GET /api/admin/languages/usage` → `[{"code": string, "workspaces": number}]` (all users, grouped by language, sorted by code). All `requireAdmin`.
- [ ] **Step 1: Failing tests:** non-admin → 403 on all three; POST `"PT_br"` → 201 code `pt-br`, again → 200; POST `"zh"` → 409 "zh is built in"; POST `"x"` → 422; DELETE `zh` → 409; DELETE unknown → 404; DELETE `es` while an `es` dictionary is installed → 409 "still used by packs or workspaces"; after uninstalling that dictionary (entries stay, senses soft-deleted) and with no `es` workspace → 204; DELETE blocked by one other user's `es` workspace, by a live `es` scheme, by a live `es` frequency pack, by a live `sentence_packs` row with `language='es'`, and by a legacy sentence (no registry row) on an `es` entry; `TestDeleteLanguageExactStoredCode`: a row inserted by SQL as `pt_br` (legacy, fails the pattern), DELETE `/api/admin/languages/pt_br` → 204 (no rewriting to `pt-br`); usage counts two users' workspaces.
- [ ] **Step 2–4:** FAIL, implement, Go gate PASS.
- [ ] **Step 5: Commit** `feat(api): admin language registration, removal and usage`.

### Task 4: Web language data and the create form

**Files:**
- Modify: `apps/web/src/lib/api/types.ts` (`Language.kind: 'code' | 'data'`; `Dictionary.packId: string; Dictionary.language: string`), `apps/web/src/lib/languages.ts`, `apps/web/src/lib/languages.test.ts`, `apps/web/src/lib/components/WorkspaceCreateForm.svelte`
- Create: `apps/web/src/lib/api/adminLanguages.ts` (`registerLanguage(code): Promise<Language>`, `removeLanguage(code): Promise<void>`, `languageUsage(): Promise<{ code: string; workspaces: number }[]>`)

**Interfaces:**
- Produces: `LanguageInfo` gains `hasDictionary: boolean`; `languageOptions(installed, list)` sets it from the `installed` flag (codes only in the user's workspaces: `false` unless listed as installed). Sort unchanged (by label). The form shows `label + ' (no dictionary installed)'` when `!hasDictionary`.
- [ ] **Step 1: Failing tests:** `languageOptions` with `[{code:'zh',installed:true},{code:'pt',installed:false}]` → zh `hasDictionary:true`, pt `false`; still sorted by label; codes from workspaces only → `false`.
- [ ] **Step 2–4:** FAIL, implement, web gates PASS.
- [ ] **Step 5: Commit** `feat(web): known languages with dictionary flag in the create form`.

### Task 5: Hidden dictionaries — helpers, store, and the two sense views

**Files:**
- Create: `apps/web/src/lib/dictionaryVisibility.ts`, `apps/web/src/lib/dictionaryVisibility.test.ts`
- Modify: `apps/web/src/lib/workspaces.ts` (+ `workspaces.test.ts`), `apps/web/src/lib/components/Senses.svelte`, `apps/web/src/lib/plugins/reader/EntryCard.svelte`, `apps/web/src/lib/plugins/reader/PopupFrameView.svelte`

**Interfaces:**
- Produces:
  ```ts
  export const HIDDEN_DICTIONARIES_KEY = 'hiddenDictionaries';
  export function hiddenDictionaries(ws: Workspace | null | undefined): Set<number>;
  export function hiddenFor(list: readonly Workspace[], workspaceId: number | null, current: Workspace | null): Set<number>;
  export function partitionSenses<T extends { dictionaryId: number }>(senses: readonly T[], hidden: ReadonlySet<number>): { shown: T[]; hidden: T[]; allHidden: boolean };
  // workspaces.ts
  export async function updateSettings(id: number, patch: Record<string, unknown>): Promise<Workspace>;
  ```
  `EntryCard` gets prop `hidden: ReadonlySet<number>` (default empty set); `PopupFrameView` passes `hiddenFor($workspaces.list, studyWorkspaceId, $workspaces.current)`. `Senses.svelte` reads the current workspace. Both render the reveal button and the all-hidden note (copy in Global Constraints); in `EntryCard` partition before `shownSenses` and the existing cap.
- [ ] **Step 1: Failing tests:** `hiddenDictionaries` of `{hiddenDictionaries:[3,'x',4.5,-1,7]}` → `{3,7}`; missing/non-array → empty; `partitionSenses` keeps order, counts hidden, all hidden → `shown` = all and `allHidden: true`, empty hidden set → everything shown; `hiddenFor` picks the book's workspace when found, else `current`; `updateSettings` PUTs `{settings: patch}` and replaces the store entry (mock `api`).
- [ ] **Step 2–4:** FAIL, implement, web gates PASS.
- [ ] **Step 5: Commit** `feat(web): hide dictionaries per workspace in entries and lookups`.

### Task 6: Coverage hints and the workspace Dictionaries panel

**Files:**
- Create: `apps/web/src/lib/coverage.ts`, `apps/web/src/lib/coverage.test.ts`, `apps/web/src/lib/settings/WorkspaceDictionaries.svelte`
- Modify: `apps/web/src/routes/settings/+page.svelte` (workspace rows), `apps/web/src/routes/search/+page.svelte`

**Interfaces:**
- Consumes: `Dictionary.language` (Task 2/4), `getSchemes()` (`lib/api/schemes.ts`), `updateSettings`, `hiddenDictionaries` (Task 5), `$auth.user?.admin`.
- Produces: `coverage(language: string, dictionaries: readonly Dictionary[], schemes: readonly Scheme[]): { dictionaries: Dictionary[]; levels: number }` (case-insensitive primary match on the full code); `dictionaryHint(label: string, admin: boolean): string`; `levelsHint(label: string): string`. `WorkspaceDictionaries.svelte` props `{ workspace: Workspace; dictionaries: Dictionary[]; admin: boolean; onclose: () => void }`: one checkbox per dictionary of the language ("Show in entries and lookups", name, version), Save → `updateSettings(id, { hiddenDictionaries: [...] })`, Cancel, hint when none.
- [ ] **Step 1: Failing tests:** `coverage('es', [cedict(zh), esDemo(es)], [hsk(zh)])` → one dictionary, 0 levels; `dictionaryHint('Spanish', true/false)` and `levelsHint('Spanish')` equal the Global Constraints copy exactly.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**: Settings loads `/api/dictionaries` and `getSchemes()` once; each workspace row shows chips "No dictionary" / "No level lists" (only for zero) and a **Dictionaries** button opening the panel inline (focus moves into it, Escape/Cancel returns focus to the button). The Search page shows `dictionaryHint` in `role="status"` above the results when the current workspace's language has no installed dictionary (from `listLanguages()`).
- [ ] **Step 4: Run** web gates: PASS.
- [ ] **Step 5: Commit** `feat(web): coverage hints and per-workspace dictionary choice`.

### Task 7: Languages section in Settings → Data

**Files:**
- Create: `apps/web/src/lib/settings/LanguageManager.svelte`, `apps/web/src/lib/settings/languagesView.ts`, `apps/web/src/lib/settings/languagesView.test.ts`
- Modify: `apps/web/src/routes/settings/+page.svelte` (replace the `<!-- languages -->` marker from the pack plan)

**Interfaces:**
- Consumes: `listLanguages`, `listPacks` (pack plan Task 8), `registerLanguage`, `removeLanguage`, `languageUsage` (Task 4), `lang`-style validation mirrored client-side.
- Produces: `languageRows(langs: Language[], packs: InstalledPack[], usage: {code:string;workspaces:number}[]): { code: string; label: string; kind: 'code'|'data'; valid: boolean; packs: string[]; workspaces: number; removable: boolean }[]` — `packs` as `"<name or packId> (<type label>)"`, `removable` = data kind, no packs, no workspaces, not installed; `normalizeCode(raw: string): string | null` (same pattern as the server).
- [ ] **Step 1: Failing tests:** rows for zh (code, CC-CEDICT + Unihan, not removable), es (data, es-demo, 1 workspace), `pt_br` legacy (valid false, removable); `normalizeCode(' PT_br ')` → `pt-br`, `'x'` → null.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** the section: table (label, code, "built-in"/"data only", packs, workspaces, Remove with a confirm), "not a valid code" flag, the add form (input, live `languageLabel` preview, the registration note, 422/409 messages in `role="alert"`), refresh after Packs changes (PackManager fires an `onchange` callback; add it there).
- [ ] **Step 4: Run** web gates: PASS.
- [ ] **Step 5: Commit** `feat(web): Languages section in Settings → Data`.

### Task 8: Spanish–English demo end to end, docs

**Files:**
- Modify: `docs/ROADMAP.md` (#41 in progress on `feature/language-management`), `plugins/data/README.md` (the `es-demo` row: "install it from Settings → Data to try a data-only language"), plus fixes found (each with its test and commit).

- [ ] **Step 1: Build and start** (leave port 8085 alone):
  ```bash
  docker build -t qinqin:langs <wt>
  mkdir -p <scratch>/langs-data
  docker run -d --name qinqin-langs -p 127.0.0.1:8088:8080 -v <scratch>/langs-data:/data qinqin:langs
  docker exec qinqin-langs qinqin seed --packs /opt/qinqin/packs
  docker exec -e QINQIN_PASSWORD=langs-test-123 qinqin-langs qinqin adduser --username admin --admin
  docker exec -e QINQIN_PASSWORD=langs-test-123 qinqin-langs qinqin adduser --username learner
  (cd <wt>/plugins/data/es-demo && python3 -I -m zipfile -c <scratch>/es-demo.zip manifest.json dictionary.json)
  ```
  The image ships `es-demo` in `/opt/qinqin/packs`, so the seed installs it. Before step 2, as `admin`, uninstall es-demo in Settings → Data (this also checks that a seeded pack uninstalls), delete the admin's own default Spanish workspace (created at first login, since es was installed) in Settings → Workspaces, then remove the language `es` in Languages: it must now succeed. This starts the demo from a server without Spanish. Do not log in as `learner` before this, or the learner also gets a default Spanish workspace.
- [ ] **Step 2: Drive the browser** (`run` skill) at `http://127.0.0.1:8088`:
  1. `learner`: the create form lists Chinese and Japanese, no Spanish; `curl -X POST /api/workspaces {"language":"es"}` with the learner token → 422 "unknown language…".
  2. `admin` → Data → Packs: upload `es-demo.zip`, review (licence `CC0-1.0`, attribution), tick, Install, `4 entries, 4 senses`. Languages: Spanish `es`, "data only", packs "Spanish–English demo dictionary (Dictionaries)", 0 workspaces, no Remove.
  3. `learner`: create a Spanish workspace; Settings row shows "No level lists", no "No dictionary"; Search `hola` → entry with "hello", "hi"; `gracias` → "thank you"; add `agua` to flashcards and review it once.
  4. Workspace **Dictionaries** → untick the demo dictionary → Save; the `hola` entry shows its glosses with "Shown although its dictionaries are hidden in this workspace". In a zh workspace hide Unihan: a character entry shows CC-CEDICT senses and "Show 1 from hidden dictionaries" (count per entry); the reader popup in a zh book hides them too; reveal works by keyboard.
  5. `admin`: uninstall es-demo → learner's Search shows the no-dictionary hint ("Ask the administrator…"), Settings row shows "No dictionary"; Languages: es installed false, 1 workspace, no Remove. Reinstall → glosses back, the hidden setting still applies (same dictionary id).
  6. `admin` registers `PT_br` → shown as `pt-br` "Brazilian Portuguese"; the learner's create form lists it with " (no dictionary installed)"; admin removes it → gone. Register `zh` → "zh is built in".
- [ ] **Step 3: Stop** (`docker rm -f qinqin-langs`); run all gates on the tip.
- [ ] **Step 4: Commit** `docs: language management and the Spanish demo`. Do not merge or push.

---

## Risks and notes for the owner

- Hidden dictionaries are filtered in the browser: they still influence lookup ranking, and the Android client ignores the setting until it implements it.
- Non-admin API clients (future Android) can no longer create a workspace for a language the admin has not added.
- The reader cannot read Spanish (lookup and segmentation are code-pack-only); the demo covers search, entries and flashcards.
- Stored names in `languages` stay pack titles for auto-registered codes; nothing shows them.
