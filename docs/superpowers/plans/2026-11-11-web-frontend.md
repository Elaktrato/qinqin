# Web Frontend (Phase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SvelteKit SPA (served by the Go binary) that makes the platform usable in a browser: login/register, workspace + language switching, search, full entry pages (readings, meanings with source tags, badges, variants, radical characters, example sentences, stroke-order animation), user edits, study-event recording, and the home heatmap as the first web feature plugin — plus a README and a sources/licenses page.

**Architecture:** `apps/web` (SvelteKit 2, Svelte 5 runes, TypeScript strict, adapter-static SPA) talks to the same-origin REST API. The Go server embeds the built SPA (`server/internal/webdist`, `go:embed all:dist`) and serves it as the catch-all; `/api/` and `/healthz` stay on the API mux. Docker builds the SPA in a Node stage and copies it into the Go build; CI builds/tests it too. The heatmap is registered in a compile-time plugin registry (`src/lib/plugins/index.ts`) and rendered in the home slot.

**Tech Stack:** SvelteKit + adapter-static, Svelte 5, TypeScript, Vitest, `hanzi-writer` + `hanzi-writer-data` (stroke animation, Arphic-licensed data), Go `embed`.

**Spec:** `docs/superpowers/specs/2026-11-10-chinese-learning-platform-design.md` (Clients, feature plugins, deployment).

## Global Constraints

- Node 24 / npm; all web code under `apps/web/`; Go changes under `server/`.
- Web deps whitelist: `svelte`, `@sveltejs/kit`, `@sveltejs/adapter-static`, `vite`, `typescript`, `svelte-check`, `vitest`, `hanzi-writer`, `hanzi-writer-data`. Anything else needs a note in the commit message.
- SPA: `ssr = false`, adapter-static with `fallback: 'index.html'`; dev proxy forwards `/api` to `http://127.0.0.1:8080`.
- Token storage: `localStorage` key `qinqin.token`; current workspace: `qinqin.workspace`. All API calls same-origin.
- Go: module `qinqin`, stdlib only, no new deps; embeds `dist/` (a committed `.gitkeep` keeps an empty dist embeddable).
- Tests: Go `go test ./...`; web `npm run check` (svelte-check) and `npm test` (vitest) and `npm run build` must pass. No component-test framework; unit-test lib logic.
- Conventional commits, one or more per task.

## Review Focus

1. **Routing order** — `/api/*` and `/healthz` must reach the API mux even when the SPA build has no matching file; the SPA fallback must never shadow them (Go handler test).
2. **Auth handling** — 401 on any call clears the token and redirects to `/login` without redirect loops on the login/register pages; tokens never rendered into HTML.
3. **Language scoping** — search and views use the selected workspace's language; switching workspaces refetches; no mixed-language results surface.
4. **Event recording is fire-and-forget** — a failed event POST never breaks a page, and the per-day session event is recorded at most once per workspace per day.
5. **Contract drift** — TypeScript types mirror the live JSON (senses, chars, badges, sentences); `svelte-check` + the API shape test pin it.

---

### Task 1: Backend — entry senses and radical characters

**Files:**
- Modify: `server/internal/model/model.go` (`SenseView`)
- Modify: `server/internal/entries/store.go` (`Store.Senses`, typed return)
- Modify: `server/internal/api/handlers_entries.go` (response fields), `server/internal/api/api.go` (chars route)
- Test: `server/internal/entries/store_test.go`, `server/internal/api/handlers_entries_test.go`

**Interfaces:**
- Produces: `model.SenseView{DictionaryID int64; DictionaryName, PackID, License, Attribution, Gloss string}` (JSON: `dictionaryId`, `dictionaryName`, `packId`, `license`, `attribution`, `gloss`).
- `Store.Senses(ctx, entryID int64) ([]model.SenseView, error)` — active senses joined with their dictionaries, ordered by dictionary id then `ord`.
- `GET /api/entries/{id}` response gains `senses` (always `[]`, never null).
- New route `GET /api/entries/{id}/chars` → JSON array of `model.Entry` for characters under that radical (`CharsUnder`), `[]` when none; 404 for unknown entry.

- [ ] **Step 1: Write failing tests** — `TestEntryReturnsSenses` (import two dictionaries giving 好 two glosses; GET shows both with correct `dictionaryName`/`license`; order stable); `TestEntriesNeverNull` (fresh entry returns `"senses":[]`, `"variants":[]`, `"badges":[]`, `"sentences":[]`); `TestCharsUnderRadical` (import the Unihan fixture; `GET /api/entries/{女 id}/chars` contains 好; unknown id → 404).
- [ ] **Step 2: Run** `go test ./internal/entries/ ./internal/api/ -run 'Senses|Chars|NeverNull'` — FAIL.
- [ ] **Step 3: Implement** `Senses` query (join `dictionaries`, filter both `deleted_at IS NULL`), response wiring, route.
- [ ] **Step 4: Run** `go test ./... && go vet ./...` — PASS.
- [ ] **Step 5: Commit** — `feat: entry senses and radical characters endpoints`

### Task 2: Web scaffold, embed, Docker/CI

**Files:**
- Create: `apps/web/package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.html`, `src/app.css`, `src/routes/+layout.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `apps/web/.gitignore`
- Create: `server/internal/webdist/webdist.go` (`Dist`, `Handler`), `server/internal/webdist/dist/.gitkeep`
- Modify: `server/cmd/qinqin/main.go` (root mux), `Dockerfile` (node stage), `.dockerignore`, `.github/workflows/build.yml`
- Test: `server/internal/webdist/webdist_test.go`

**Interfaces:**
- `webdist.Handler(fsys fs.FS) http.Handler` — serves `index.html` for `/`, a file when it exists, `index.html` for unknown paths (SPA fallback), and a 200 `text/html` placeholder ("web build not bundled") when `index.html` is absent. `webdist.Dist` is the embedded FS (sub of `dist`).
- `main.go` root mux: `/api/` and `/healthz` → `api.New(...)`; `/` → webdist handler.
- Web build: `npm run build` → `apps/web/build/`. Docker golang stage copies it to `server/internal/webdist/dist`.
- SvelteKit config: adapter-static, fallback `index.html`; `+layout.ts` exports `ssr = false`, `prerender = false`; vite proxy `/api` → 8080.

- [ ] **Step 1: Write failing test** — `TestHandler` (fstest.MapFS with `index.html`, `assets/app.js`: `/` → index; `/assets/app.js` → JS with correct content-type; `/entry/5` → index; empty FS → placeholder 200); `TestRootMuxKeepsAPI` (mount API + webdist; `POST /api/auth/login` reaches the API, unknown SPA path returns index).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Scaffold app + implement handler + mux + Docker/CI.**
- [ ] **Step 4: Run** `npm --prefix apps/web run build && npm --prefix apps/web run check && go test ./... && go vet ./...` — PASS. Also `docker build -t qinqin:web .` succeeds and `docker run --rm --entrypoint sh qinqin:web -c 'ls /usr/local/bin/qinqin'` shows the binary.
- [ ] **Step 5: Commit** — `feat(web): scaffold sveltekit spa with go embed and docker/ci wiring`

### Task 3: API client, auth, login/register

**Files:**
- Create: `apps/web/src/lib/api/types.ts`, `apps/web/src/lib/api/client.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/routes/login/+page.svelte`, `apps/web/src/routes/register/+page.svelte`
- Modify: `apps/web/src/routes/+layout.svelte` (guard + init), `apps/web/src/routes/+layout.ts`
- Test: `apps/web/src/lib/api/client.test.ts`, `apps/web/src/lib/auth.test.ts`

**Interfaces:**
- Types mirroring the API: `Entry` (id, language, kind, written, readings[], attrs, radicalId, badges[], variants[], sentences[], senses[]), `Reading`, `Badge`, `SenseView`, `Dictionary`, `Workspace`, `StudyEventBody`.
- `api<T>(path, {method, body, auth}): Promise<T>` — JSON, `Authorization: Bearer` when token present, throws `ApiError{status, message}`; 401 clears token and `goto('/login')`.
- Auth store: `token`, `user`; `login(username, password)`, `register(username, password)`, `loadMe()`, `logout()`; token persisted under `qinqin.token`.
- Guard in layout: unauthenticated → `/login` (login/register exempt).

- [ ] **Step 1: Write failing tests** — client adds bearer header, parses JSON, throws ApiError on 401 and clears token; auth.login stores token + calls me; auth.logout clears storage.
- [ ] **Step 2: Run** `npm --prefix apps/web test` — FAIL.
- [ ] **Step 3: Implement** client/types/stores/pages.
- [ ] **Step 4: Run** `npm --prefix apps/web test && npm --prefix apps/web run check` — PASS.
- [ ] **Step 5: Commit** — `feat(web): api client and auth flow`

### Task 4: Shell, workspaces, settings

**Files:**
- Create: `apps/web/src/lib/workspaces.ts`, `apps/web/src/routes/settings/+page.svelte`
- Modify: `apps/web/src/routes/+layout.svelte` (nav, workspace switcher), `apps/web/src/routes/+page.svelte` (home stub with search box + plugin slot placeholder)
- Test: `apps/web/src/lib/workspaces.test.ts`

**Interfaces:**
- Workspace store: `list`, `current` (persisted `qinqin.workspace`), `load()`, `create(language: string)`, `select(id)`; a language label shown in the switcher.
- Settings: workspaces list + create form; plugins list (`GET /api/plugins`) with enable/disable + order (`PUT /api/plugins/{id}/state`).
- Nav: Home, Search, Settings, Sources.

- [ ] **Step 1: Write failing tests** — load parses workspaces and keeps the persisted selection when it still exists; create posts `{language}` and selects the result; select persists.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm --prefix apps/web test && npm --prefix apps/web run check && npm --prefix apps/web run build` — PASS.
- [ ] **Step 5: Commit** — `feat(web): app shell, workspace switcher, settings`

### Task 5: Search page

**Files:**
- Create: `apps/web/src/lib/api/search.ts`, `apps/web/src/routes/search/+page.svelte`
- Test: `apps/web/src/lib/api/search.test.ts`

**Interfaces:**
- `search(lang, q, opts)` → `GET /api/search?q=&lang=` + optional `kind/scheme/level`; returns hits (entry fields + `source`).
- Page: query box, language from current workspace, result rows (written, readings, source label), link to `/entry/{id}`; empty/error states.

- [ ] **Step 1: Write failing test** — URL building includes lang, encodes query, passes kind/scheme/level.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run tests/check/build** — PASS.
- [ ] **Step 5: Commit** — `feat(web): search page`

### Task 6: Entry view

**Files:**
- Create: `apps/web/src/routes/entry/[id]/+page.svelte`, `apps/web/src/lib/components/Readings.svelte`, `Senses.svelte`, `Badges.svelte`, `Sentences.svelte`
- Modify: `apps/web/src/lib/api/types.ts` if needed
- Test: none beyond `check` (render-only), plus one vitest for the readings formatter.

**Interfaces:**
- Page loads `GET /api/entries/{id}`; sections: readings (type/value), badges (scheme + level + derived marker), senses grouped by dictionary with license/attribution link, variants (links), radical (link to its entry), characters under radical (`/api/entries/{id}/chars`, rendered as a link list when non-empty), sentences (pack/user labelled), edit affordance.
- `formatReading(type, value)` displays pinyin/bopomofo/kana/romaji; unknown types render as-is.

- [ ] **Step 1: Write failing test** — `formatReading` mapping (pinyin/bopomofo/on/kun/romaji/unknown).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run tests/check/build** — PASS.
- [ ] **Step 5: Commit** — `feat(web): entry view`

### Task 7: Stroke-order animation

**Files:**
- Create: `apps/web/src/lib/components/StrokePlayer.svelte`
- Modify: `apps/web/src/routes/entry/[id]/+page.svelte` (mount for `kind === 'character'` and zh)
- Test: none (canvas); `check`/`build` gate. Manual: 好 shows strokes.

**Interfaces:**
- Lazily `import('hanzi-writer')` and `import('hanzi-writer-data/' + char + '.json')`; on data absence render nothing (graceful); Play/Loop buttons; fixed size 160; transparent background.

- [ ] **Step 1: Implement** component + mount. **Step 2: Run** `npm run check && npm run build` — PASS.
- [ ] **Step 3: Commit** — `feat(web): stroke-order animation for characters`

### Task 8: Entry editing

**Files:**
- Create: `apps/web/src/lib/components/EntryEditor.svelte`
- Modify: `apps/web/src/routes/entry/[id]/+page.svelte`
- Test: `apps/web/src/lib/api/edit.test.ts`

**Interfaces:**
- `updateEntry(id, patch)` → `PUT /api/entries/{id}` with `{written?, readings?}` (readings `[{type, value}]`; nil = untouched).
- Editor: written field + readings rows (add/remove), Save → PUT → refetch entry; error message on failure; "saved" state.

- [ ] **Step 1: Write failing test** — patch builder omits untouched fields, sends readings only when edited.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run tests/check/build** — PASS.
- [ ] **Step 5: Commit** — `feat(web): entry editing via overlays`

### Task 9: Study events + heatmap plugin

**Files:**
- Create: `apps/web/src/lib/ulid.ts`, `apps/web/src/lib/events.ts`, `apps/web/src/lib/heatmap/aggregate.ts`, `apps/web/src/lib/plugins/index.ts`, `apps/web/src/lib/plugins/heatmap/manifest.ts`, `apps/web/src/lib/plugins/heatmap/Heatmap.svelte`
- Modify: `apps/web/src/routes/+layout.svelte` (session event), `apps/web/src/routes/entry/[id]/+page.svelte` (view event), `apps/web/src/routes/search/+page.svelte` (lookup event), `apps/web/src/routes/+page.svelte` (render plugin slots)
- Test: `ulid.test.ts`, `heatmap/aggregate.test.ts`, `events.test.ts`

**Interfaces:**
- `newUlid(now?: number): string` — 26-char Crockford; `record(type, workspaceId, payload)` → `POST /api/events/batch` with `{events:[{id, workspaceId, device:'web', ts, type, payload}]}`; fire-and-forget (errors logged to console). Session event at most once per workspace per UTC day (localStorage `qinqin.session.<ws>.<date>`).
- Plugin registry: `webPlugins: [{manifest: {id, name, surfaces:['home-widget']}, component}]`; home renders each enabled plugin's component (plugin states from `GET /api/plugins`).
- `aggregateByDay(events, now)`: map of `YYYY-MM-DD` → count, UTC; heatmap grid covers the last 91 days; toggle workspace/combined (`GET /api/events?since=&workspace=`).

- [ ] **Step 1: Write failing tests** — ULID length/alphabet/order; aggregate counts + sparse days; event body shape (ULID, ts, type, workspaceId).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run tests/check/build** — PASS.
- [ ] **Step 5: Commit** — `feat(web): study events and heatmap home plugin`

### Task 10: Sources page + README

**Files:**
- Create: `apps/web/src/routes/sources/+page.svelte`, `README.md` (repo root)
- Test: `check` only.

**Interfaces:**
- Sources page: `GET /api/dictionaries` table (name, license, attribution), plus static notice: stroke data (`hanzi-writer-data`, derived from Make Me a Hanzi) is Arphic Public License; bundled dictionaries are unmodified upstream files.
- README: what it is, features, quick start (`docker compose up -d`, `docker compose exec qinqin qinqin seed`, `qinqin adduser --admin`), dev setup (server + `npm --prefix apps/web run dev`), bundled data credits (link `docs/sources.md`), git-flow pointer.

- [ ] **Step 1: Implement page + README.**
- [ ] **Step 2: Run** `npm run check && npm run build` — PASS.
- [ ] **Step 3: Commit** — `docs: readme and sources page`
