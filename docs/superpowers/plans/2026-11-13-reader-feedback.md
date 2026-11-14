# Reader and Workspace Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the owner's feedback after local testing: tab-style source switcher, a browse assortment in the importer, romaji/pinyin search, add-to-study buttons in the reader popup, flag icons and names for workspaces, default workspaces from installed language packs, per-workspace reader libraries, and Settings moved into a footer.

**Architecture:** Workspaces gain an optional `name` and may repeat a language (migration 018 rebuilds the table without `UNIQUE(user_id, language)`); library books gain `workspace_id` and every library/source endpoint takes the workspace. A new `GET /api/languages` reports languages with installed dictionary data; `GET /api/workspaces` lazily creates one default workspace per installed language for a user who has none. Sources gain an optional `Browser` capability (deterministic daily random assortment, no external popularity service) and a phonetic search index (Aozora reading columns + romaji via the `ja` pack; Gutenberg zh titles/authors via lexicon pinyin). The web app gets a language helper with hand-drawn SVG flags (no emoji flags: Windows does not render them; no third-party flag art, so no licensing questions), a footer, and a shared cached study-data store so reader popups can add words without a full sync pull per card.

**Tech Stack:** Go 1.26 (stdlib `net/http`, `modernc.org/sqlite`), SvelteKit 2 / Svelte 5, vitest, existing `ts-fsrs`/`hanzi-writer`. No new dependencies.

**Branch:** `feature/reader-feedback`, cut from `feature/overnight-integration` (contains reader, lookup rebuild, flashcards Round 3, core heatmap).

## Rulings (decided unattended with the owner's feedback as the spec)

- **Multiple workspaces per language:** the feedback ("a name beside them if a user has more than one of the same language") requires it. `workspaces.name` TEXT NOT NULL DEFAULT '' (trimmed, ≤ 40 chars); uniqueness becomes `UNIQUE(user_id, language, name)`. POST with an existing (language, name) pair keeps the 409. The first workspace of a language keeps name `''` and shows only its flag; a name is shown beside the flag only when the user has >= 2 workspaces of that language (or the workspace has a name).
- **Default workspaces:** on `GET /api/workspaces`, a user with zero workspaces gets one per installed language (`GET /api/languages` set), created in one transaction, idempotent, never touching existing users' workspaces. Installed = a language with at least one live (not soft-deleted) sense in a live dictionary (`entries` ⋈ `senses` ⋈ `dictionaries`); `es` data-only demo counts like any other.
- **Libraries per workspace (strict):** `library_books.workspace_id INTEGER REFERENCES workspaces(id)`. Backfill: each existing book goes to the user's lowest-id workspace of the book's language; if the user has none, the migration creates a workspace (`name ''`) for that (user, language) first, so nothing is orphaned. New uploads/imports require a workspace id owned by the caller whose language equals the book's language (409/422 otherwise). List filters by workspace. The dedupe key becomes `(workspace_id, source, source_id)`.
- **Browse assortment:** "random" = a deterministic daily shuffle of the source catalog (seed = UTC date + source id) filtered to the workspace language, 12 entries, "Shuffle" button re-rolls with a client seed. No popularity data (none is available from pg_catalog; Aozora ranking pages and Gutendex are new third-party fetches: out of scope, noted as a follow-up).
- **Phonetic search:** Aozora: keep 作品名読み / 姓読み / 名読み (verify the exact column names against the live CSV once, manually, and make the columns optional so old fixtures/caches still load); the query is matched after `lang.For("ja").SearchPlain` (romaji → hiragana, katakana folded) against the hiragana readings. Gutenberg zh: titles/authors converted once at catalog load to toneless pinyin through the lexicon (longest-match words then per-character readings, first reading), and the query matched via `pinyin.Plain`; the catalog stays kanji-matchable as before. Ranking: exact kanji match first, then phonetic matches.
- **Flags:** language → hand-drawn minimal SVG: `zh` China, `ja` Japan, `es` Spain (simple stripes, no coat of arms), any other code a neutral globe glyph. Always with an accessible text label (Intl.DisplayNames, fallback to the code), so the flag is decoration only.
- **Settings in a footer:** `Settings` link (and anything else non-navigational such as sign-out stays where it is, but Settings leaves the navbar) lives in a `<footer>` on every page.
- **Popup add buttons:** each EntryCard in the reader popup gets a `+` (adds to General) and, only when the workspace has custom decks, a second "deck" button opening a small menu to choose a deck. The card snapshot uses `forms[0]?.text ?? readings[0]?.value ?? term` as `written` (same as the entry page); the popup uses the current workspace (books are now workspace-scoped, so it always matches). A shared cached `studyData` store removes the per-card sync pull.

- **Bookmarks (added later in the session; the toolbar button, panel and sticky toolbar described here were superseded by the side rail, see 2026-11-13-reader-side-rail-highlights.md):** several bookmarks per book, stored on the server in a new table `library_bookmarks` (migration 020: `id, user_id, book_id REFERENCES library_books(id), position TEXT, label TEXT, created_at`), because books themselves live server-side and are not synced; bookmarks are deleted with their book. `position` uses the same format as the existing reading position (`position.ts`), `label` is a ≤ 120-character text snippet taken at the bookmark's location (editable), max 200 bookmarks per book. API: `GET/POST /api/library/books/{id}/bookmarks`, `PUT/DELETE /api/library/books/{id}/bookmarks/{bid}` (rename label). Reader UI: a bookmark button in the book toolbar (adds one at the current position; tapping again at the same spot removes it), a bookmarks panel listing label, chapter and date with jump / rename / delete, and a small marker in the text margin of a bookmarked paragraph. Keyboard: `b` toggles a bookmark at the current position when no popup/input is focused.

## Global Constraints

- No new dependencies. Migration 018 is the only schema change; it must run on a database containing data (rebuild the `workspaces` table preserving ids and every FK; `PRAGMA foreign_keys` handling as the migration runner allows; test on a populated DB).
- All existing server behaviour for single-workspace users stays compatible: a `GET /api/library/books` call without a workspace parameter returns the books of ALL the caller's workspaces (documented), the web app always passes one.
- Tests first (red/green) for every logic change; server gates `cd server && go vet ./... && go test ./...`, race tests for packages touched (`-race ./internal/library/... ./internal/api`), web gates `npm --prefix apps/web run check`, `test`, `build` (use absolute paths or the worktree root; `cd` persists between shell calls). UI has no component tests: pure modules for logic.
- Conventional commits, one per task. Never merge or push.

## Review Focus

- A fresh install (empty DB, bundled packs seeded) → a new user's first login shows workspaces for zh, ja (and es) without manual creation; a user who already has workspaces gets none added; two concurrent first requests create no duplicates (Task 1).
- Migration 018 on a populated database: every workspace id, study event, plugin_data row and library book survives with the same ids and links; books of a language the user had no workspace for are not lost (Task 1, 2).
- Uploading a zh epub while a ja workspace is active is rejected with a clear message or lands in a matching zh workspace — never silently in the wrong one (Task 2, 5).
- Empty browse (catalog not yet downloaded / offline) shows a calm message, not a stack trace; a romaji query with spaces, macrons (`tōkyō`), or uppercase works; a pinyin query with tone marks or numbers works (Task 3, 5).
- Hover popups: opening the deck menu must not close the popup (hover grace) and the add buttons must not steal selection/Escape behaviour; double-clicking `+` adds one card (Task 5).
- The footer never overlaps content on short pages or on a 390 px viewport, and the navbar still wraps properly (Task 4).

---

### Task 1: Workspaces on the server (name, repeats, languages, defaults)

**Files:**
- Create: `server/internal/db/migrations/018_workspaces_name.sql`, `server/internal/api/handlers_languages.go`, tests alongside
- Modify: `server/internal/api/handlers_workspaces.go`, `server/internal/api/api.go`, tests `handlers_workspaces_test.go` etc.

**Interfaces:**
- Produces:
  ```go
  // workspace JSON: {id, language, name, settings, updatedAt}
  // POST /api/workspaces {language, name?}  → 201; 409 on duplicate (language, name)
  // PUT  /api/workspaces/{id} {name?: string, settings?: object}  → rename + settings merge; 409 duplicate name
  // GET  /api/languages → [{code, name, installed: true}]  (installed languages only, sorted by code; name from the languages table else the code)
  // GET  /api/workspaces → when the caller has none, creates one default per installed language first (single tx, idempotent) then lists
  func installedLanguages(ctx, db) ([]languageInfo, error)   // entries ⋈ senses ⋈ dictionaries, all live
  ```
  Migration 018 rebuilds `workspaces` as `(id, user_id, language, name TEXT NOT NULL DEFAULT '', settings, updated_at, UNIQUE(user_id, language, name))` preserving ids and all dependent FKs (study_events, plugin_data, and Task 2's later column).

- [ ] **Step 1:** Write failing tests: migration on a populated DB keeps ids/events/plugin_data; create two zh workspaces with different names OK, same name 409; rename; `GET /api/languages` lists zh/ja after seeding fixtures and omits a language whose dictionary is soft-deleted; a zero-workspace user gets one workspace per installed language on first GET, a second GET adds nothing, a user with an existing workspace gets nothing added, two concurrent first GETs → no duplicates; name trimmed/limited (41 chars → 422).
- [ ] **Step 2:** Run `cd server && go test ./internal/api ./internal/db` — FAIL.
- [ ] **Step 3:** Implement migration + handlers (ensure-defaults inside the list handler, `INSERT OR IGNORE` under the unique key).
- [ ] **Step 4:** Server gates — PASS. **Commit** `feat(workspaces): names, repeated languages, installed languages and default workspaces`.

### Task 2: Libraries scoped to a workspace (server)

**Files:**
- Create: `server/internal/db/migrations/019_library_workspace.sql`
- Modify: `server/internal/library/library.go` (+ tests), `server/internal/api/handlers_library.go`, `handlers_sources.go`, `api.go`, their tests

**Interfaces:**
- Consumes: Task 1 workspace shape.
- Produces:
  ```go
  // Book JSON gains workspaceId. Store.List(ctx, userID int64, workspaceID int64 /*0 = all*/) ; Store.Create(...) takes WorkspaceID
  // GET  /api/library/books?workspace=<id>           (absent → all the caller's workspaces)
  // POST /api/library/upload   form field workspace=<id> (required; language form field/epub language must equal the workspace language else 422 "workspace language is <x>, book is <y>")
  // POST /api/library/sources/{source}/import {sourceId, workspaceId}   (same validation; dedupe on (workspace_id, source, source_id); 409 per workspace)
  ```
  Migration 019: add `workspace_id`, backfill each book to the lowest-id workspace of its (user, language), creating a name-'' workspace first where the user has none, then index `(user_id, workspace_id, id)` and the new unique `(workspace_id, source, source_id) WHERE source_id <> ''` replacing the old user-level one.

- [ ] **Step 1:** Failing tests: backfill (user with a ja workspace and a zh book but no zh workspace → zh workspace created and linked); list filtered by workspace; upload with matching/mismatching workspace language; import into two workspaces of the same language both succeed (different dedupe scope) and a repeat into the same one is 409; books of other users' workspaces are rejected (workspace ownership check); delete/position routes unchanged.
- [ ] **Step 2:** Run `cd server && go test ./internal/library/... ./internal/api` — FAIL. **Step 3:** implement. **Step 4:** gates + `go test -race ./internal/library/... ./internal/api` — PASS. **Commit** `feat(library): scope books to a workspace`.

### Task 2b: Bookmarks (server)

**Files:**
- Create: `server/internal/db/migrations/020_library_bookmarks.sql`, `server/internal/library/bookmarks.go`, `bookmarks_test.go`, `server/internal/api/handlers_bookmarks.go` (+ test)
- Modify: `server/internal/library/library.go` (book delete removes bookmarks), `server/internal/api/api.go`

**Interfaces:**
- Produces:
  ```go
  type Bookmark struct { ID int64; BookID int64; Position string; Label string; CreatedAt time.Time }   // JSON: id, bookId, position, label, createdAt
  func (s *Store) ListBookmarks(ctx, userID, bookID int64) ([]Bookmark, error)        // ordered by id; 404 semantics via ErrNotFound when the book is not the caller's
  func (s *Store) AddBookmark(ctx, userID, bookID int64, position, label string) (Bookmark, error)   // validates position like SetPosition (reuse), label trimmed ≤ 120 runes, max 200 per book (ErrTooMany → 409), an existing bookmark at the identical position is returned instead of duplicated
  func (s *Store) RenameBookmark(ctx, userID, bookID, bookmarkID int64, label string) error
  func (s *Store) DeleteBookmark(ctx, userID, bookID, bookmarkID int64) error
  ```
- [ ] **Step 1:** Failing tests: add/list/rename/delete; duplicate position returns the existing one; 201st bookmark 409; label trimming/length/unicode; another user's book → 404 and nothing leaked; deleting the book deletes its bookmarks; invalid position rejected like SetPosition; request size limits (1 KiB body).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** gates + `go test -race ./internal/library/... ./internal/api` — PASS. **Commit** `feat(library): bookmarks`.

### Task 3: Source browse assortment and phonetic search (server)

**Files:**
- Modify: `server/internal/library/sources/sources.go`, `aozora/aozora.go`, `gutenberg/gutenberg.go`, `server/internal/api/handlers_sources.go`, `api.go`, `server/internal/lang/ja.go` (export a small `PhoneticKey(string) string` or reuse `SearchPlain` through `lang.For`), tests for each; testdata fixtures with reading columns

**Interfaces:**
- Produces:
  ```go
  // optional capability (type-asserted, fakes unaffected)
  type Browser interface { Browse(ctx context.Context, language string, seed string, limit int) ([]Result, error) }
  // GET /api/library/sources/{source}/browse?language=ja&seed=<s>&limit=12 → same Result shape as search; default seed = UTC date; limit 1..50 (default 12)
  // search: the aozora/gutenberg adapters additionally match phonetic keys (see rulings); Result gains optional `Reading string` for display (hiragana for ja, toneless pinyin for zh) when matched phonetically
  // Gutenberg adapter takes an injected `Phonetics func(ctx context.Context, text string) string` (lexicon-backed, zh) wired in main/api setup; nil → no zh phonetic index
  ```
- [ ] **Step 1:** Failing tests: Browse is deterministic per (seed, language), differs across seeds, never repeats a work within one call, respects the language filter and limit, returns an empty list (not an error) when the catalog is empty; Aozora with fixture reading columns: query `tokyo`, `とうきょう`, `トウキョウ`, `Tōkyō`, `ＴＯＫＹＯ` all match 東京…; works without reading columns (old fixtures); copyright filter unchanged (fail closed); Gutenberg zh fixture: query `hong lou meng`, `hónglóumèng`, `hong2lou2meng4` find 红楼梦 via an injected fake Phonetics; ranking: exact kanji match before phonetic matches.
- [ ] **Step 2:** FAIL. **Step 3:** implement; verify the Aozora reading column names against the live CSV once (single manual download into the scratchpad, never in CI) and record them in a code comment; keep columns optional. **Step 4:** gates + race for the packages — PASS. **Commit** `feat(library): browse assortment and romaji/pinyin search for sources`.

### Task 4: Workspace UI, flags, footer (web)

**Files:**
- Create: `apps/web/src/lib/languages.ts`, `languages.test.ts`, `apps/web/src/lib/components/Flag.svelte`, `WorkspaceLabel.svelte`
- Modify: `apps/web/src/lib/api/types.ts` (Workspace.name, Language), `apps/web/src/lib/workspaces.ts` (+ test), `apps/web/src/routes/+layout.svelte` (picker, footer, empty state), `apps/web/src/routes/settings/+page.svelte` (names, rename, create with name, language chooser from `GET /api/languages`), `apps/web/src/lib/api/` helper for languages

**Interfaces:**
- Produces:
  ```ts
  export interface LanguageInfo { code: string; label: string }   // label via Intl.DisplayNames, fallback to the code
  export function languageLabel(code: string, locale?: string): string
  export function flagFor(code: string): 'cn' | 'jp' | 'es' | 'globe'
  export function usesHan(code: string): boolean    // true for zh and ja only (case-insensitive, region suffixes like zh-TW accepted); drives language-specific UI
  export function workspaceDisplay(list: Workspace[], ws: Workspace): { label: string; showName: boolean; name: string }   // name shown when ws.name !== '' OR the user has >= 2 workspaces of that language; unnamed duplicates get "<label> 2", "<label> 3"
  // workspaces.ts: load() unchanged contract; create(language, name?) ; rename(id, name)
  ```
  `Flag.svelte` props `{ code: string; size?: number }`: hand-drawn inline SVGs (zh: red field + one star + four small stars, simple; ja: white field + red disc; es: red-yellow-red 1:2:1 stripes; globe: circle with two meridian arcs), `role="img"` with `aria-label` from `languageLabel`. `WorkspaceLabel.svelte` renders flag + optional name. Header picker becomes a custom listbox (button + menu with keyboard support: arrows/Enter/Esc, closes on outside click) showing flag + name per option so flags render (native `<select>` cannot); "New workspace" opens an inline form with a language `<select>` limited to installed languages (+ the ones already used) and an optional name. The **Map** entry (nav link, and the Study page's link to `/study/map`) is shown only when the current workspace's language `usesHan`; for other languages (e.g. an `es` workspace) the link is hidden and visiting `/study/map` directly shows a short "The character map is for Chinese and Japanese workspaces" note with a link back to Study (no redirect loop). Footer: `<footer>` at the bottom of every page (sticky-to-bottom layout via flex column `min-height: 100vh`), containing a Settings link and the app name/version line; Settings removed from the nav.

- [ ] **Step 1:** Failing tests for `languages.ts` (labels, `flagFor` for zh/ja/es/zh-TW?/unknown → globe, `workspaceDisplay` for 1, 2 same-language, named, many) and `workspaces.ts` create/rename calls.
- [ ] **Step 2:** FAIL. **Step 3:** implement helpers + components + layout/settings. **Step 4:** web gates — PASS. **Commit** `feat(web): workspace flags and names, language chooser, settings in the footer`.

### Task 5: Reader UI (web): workspace library, tabs, browse, search hints, add-to-study

**Files:**
- Create: `apps/web/src/lib/study/studyData.ts` (+ test) shared cache; `apps/web/src/lib/plugins/reader/AddToStudyButtons.svelte`; `apps/web/src/lib/plugins/reader/browse.ts` (+ test) pure helpers
- Modify: `apps/web/src/lib/api/library.ts` (+ test; `listBooks(workspaceId)`, `uploadBook` with workspace, `importFromSource(source, sourceId, workspaceId)`, `browseSource`), `types.ts` (Book.workspaceId, SourceResult.reading), `Library.svelte`, `SourceBrowser.svelte`, `ReaderPage.svelte`, `BookView.svelte` (workspace now from the book), `readingWorkspace.ts` (+ test; simplify: the book's workspace), `EntryCard.svelte`, `PopupFrameView.svelte` if needed, `AddToStudy.svelte` (props refactor to `{ entryId, written, sentenceId? }` + the entry page call site)

**Interfaces:**
- Produces:
  ```ts
  // studyData.ts
  export function getStudyData(workspaceId: number, opts?: { force?: boolean }): Promise<{ decks: StudyDeck[]; cards: StudyCard[] }>   // cached per workspace for 30 s, in-flight de-duplicated; invalidate(workspaceId) after addCard/createDeck
  export function hasCard(cards: StudyCard[], entryId: number): boolean
  // browse.ts
  export function browseSeed(now?: Date): string      // UTC date
  export function popupWritten(r: { forms: {text: string}[]; readings: {value: string}[]; term: string }): string   // forms[0]?.text ?? readings[0]?.value ?? term
  ```
  Behaviour: Library lists only the active workspace's books (re-fetch on workspace change, stale-response guard); upload sends the active workspace and the language select is preselected from the workspace language and locked to it (a different language is not offered); SourceBrowser: tab-style switcher (`role="tablist"` with `role="tab"`, `aria-selected`, roving tabindex, arrow keys, underline/active tab styling, wraps on narrow screens), on open shows a **browse** panel ("Suggestions for today", 12 items via `browseSource` with the daily seed, a Shuffle button re-rolling with a random seed, import buttons identical to search results), the search box placeholder says "Title, author, or romaji / pinyin", results show the matched reading when present; imports pass the active workspace and map 409 to "In library" per workspace. Popup: each EntryCard shows a `+` button (adds to General; `aria-label="Add <term> to study"`), and, only if the workspace has custom decks, a second small "…" button opening a deck menu (clicking a deck adds to it); both disabled while the card already exists ("In study"), the menu stays open while the pointer is inside the popup (no hover-grace close), Escape closes the menu first, then the popup; double clicks are idempotent (`addCard` dedupes). `written` uses `popupWritten`. **Example sentence from the book:** adding a word from the reader also saves the sentence it was found in as a user example sentence for that entry (`POST /api/entries/{id}/sentences`, existing endpoint backed by `sentences.AddUser`; check its body requirements — hanzi text required, reading/translation optional — and send the sentence text only) and uses the returned id as the card's `sentenceId`, so Word Salad can use it. The sentence is cut from the paragraph around the lookup with a pure helper `sentenceAround(paragraph: string, start: number, end: number): string` in `browse.ts` (or a new `sentence.ts`; offsets in code points like the lookup window): boundaries are sentence-final punctuation `。！？．!?…` (also closing quotes/brackets right after it `」』）)”’` stay with the sentence) and paragraph edges, never splitting inside a quoted passage's closing mark; capped at 200 code points (keeping the word inside the window); trimmed. If the same text already exists for that entry (compare via `GET /api/entries/{id}` sentences, normalised whitespace) reuse its id instead of posting a duplicate. A failed sentence POST must not block adding the card (card is added without `sentenceId`, with a quiet inline note). Add tests for `sentenceAround` (Japanese with 「」 dialogue, Chinese, Latin with `Mr.` accepted as a limitation, no punctuation, selection at the end, very long paragraph, astral characters) and for the dedupe/failed-POST behaviour with an injected API. Server side nothing changes unless the endpoint rejects the text (e.g. a length limit: report it).

- [ ] **Step 1:** Failing tests: `studyData` cache/in-flight/invalidate (injected loader), `browse.ts` helpers, `library.ts` request shapes (workspace query/body fields), `readingWorkspace` simplification; existing tests updated where signatures changed.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** web gates — PASS. **Commit** `feat(reader): workspace libraries, tabbed sources, browse suggestions and add-to-study in the popup`.

### Task 5b: Bookmarks UI (web)

**Files:**
- Create: `apps/web/src/lib/plugins/reader/bookmarks.ts` (+ test), `BookmarksPanel.svelte`
- Modify: `apps/web/src/lib/api/library.ts` (+ test), `types.ts`, `BookView.svelte`, `ChapterText.svelte` (margin marker)

**Interfaces:**
- Produces:
  ```ts
  export interface Bookmark { id: number; bookId: number; position: string; label: string; createdAt: string }
  export function snippetAt(text: string, maxRunes?: number): string          // 120-rune whitespace-normalised snippet, ellipsis when cut
  export function bookmarkAt(bookmarks: Bookmark[], position: string): Bookmark | null    // identical position (same chapter/paragraph/offset as position.ts defines)
  export function sortForPanel(bookmarks: Bookmark[]): Bookmark[]              // by chapter then offset
  // library.ts: listBookmarks(bookId), addBookmark(bookId, position, label), renameBookmark(bookId, id, label), deleteBookmark(bookId, id)
  ```
  UI as in the Bookmarks ruling (toolbar toggle, `b` key guarded against inputs/popups, panel with jump/rename/delete, margin marker). Jump uses the existing restore logic (`restore.ts`). All calls fire-and-forget safe with inline error text, optimistic list updates rolled back on failure.
- [ ] **Step 1:** Failing tests for the pure helpers and API request shapes. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** web gates — PASS. **Commit** `feat(reader): bookmarks`.

### Task 6: Docs and real-app verification

**Files:**
- Modify: `README.md` (workspaces: names, flags, defaults, per-workspace libraries; importer: tabs, suggestions, romaji/pinyin; popup add buttons; settings footer; migration notes: old DBs are migrated in place — books keep their language workspace), `docs/superpowers/specs/` reader/workspace notes where they exist (grep for "workspace"), `docs/sources.md` (no new third-party hosts)

- [ ] **Step 1:** Write the docs from the real code.
- [ ] **Step 2:** Real-app verification against a rebuilt container image (`docker build -t qinqin:integration .` from the worktree root, tag unchanged; the owner's data volume `/home/user/qinqin-integration-data` holds a database from the previous build: **copy it to a scratch dir first and test the migration on the copy**; for the user-facing container run `docker rm -f qinqin-integration` then start the same name on 127.0.0.1:8085 with the owner's data volume). Checks: migration of the existing DB (workspace ids unchanged, tester's flashcard data intact); fresh data dir + seed + register → default workspaces zh/ja/es exist; header picker with flags (screenshot), naming a second zh workspace shows names; Settings only in the footer, 390 px layout; reader: library switches per workspace; browse suggestions show; search by `tokyo`/`とうきょう` and a zh pinyin query (needs the Aozora catalog download or a fake catalog URL if offline: report honestly what was reachable); popup `+` adds a card and the deck menu appears only with a custom deck; bookmarks: add via the toolbar and the `b` key, panel jump/rename/delete, margin marker, survives reload, removed with the book. Playwright-core 1.52 lives in the scratchpad (`.../scratchpad/pw`, Chromium headless shell 1161 from `~/.cache/ms-playwright`; earlier scripts under `.../scratchpad/t3` and the smoke dir are reusable). Report pass/fail/not-run per check; never claim an unrun check. **Commit** `docs: reader and workspace feedback`.
