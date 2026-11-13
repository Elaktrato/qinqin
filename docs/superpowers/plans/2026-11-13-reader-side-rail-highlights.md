# Reader Side Rail and Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the bookmark controls out of the reading toolbar into a side rail beside the text, and add a highlighter with optional comments on selected text.

**Architecture:** A side rail (right edge) with a tab strip — Bookmarks and Highlights — replaces the bookmark button/panel in the toolbar; the toolbar returns to a normal (non-sticky) strip and the rail itself is sticky/fixed so adding a bookmark or reading a note never scrolls the page. Highlights are server-side per book (`library_highlights`, migration 021) anchored by `(chapter, paragraph, start, end)` in code points of the paragraph's plain text (the same coordinates the selection lookup already uses), with a text snapshot to detect drift. The reader renders them as `<mark>` segments by splitting runs at highlight boundaries; creating one happens from the selection popup's action bar (four colours + Note) or the `h` key; clicking a highlight opens a small editor (colour, note, delete).

**Tech Stack:** Go 1.26 (`net/http`, `modernc.org/sqlite`), SvelteKit 2 / Svelte 5, vitest. No new dependencies.

**Branch:** continue on `feature/reader-feedback` (the owner wants one branch to test).

## Rulings (decided with the owner's request as the spec)

- **Rail, not toolbar:** bookmark add/list/jump/rename/delete move into the rail's Bookmarks tab; the `b` key stays; the toolbar loses its bookmark button and its sticky behaviour (the `scroll-margin-top`/IntersectionObserver strip logic added for the sticky toolbar is removed again; the rail does not overlay text: on viewports >= 1000 px the rail is a column beside the text (collapsible to a thin tab strip, state remembered in localStorage), below 1000 px it is a right-edge drawer opened from a floating tab button and closing on outside click/Escape).
- **Highlights are single-paragraph:** a selection spanning paragraphs is clamped to the paragraph where it starts (a short inline note says so). Highlights may not overlap each other: creating over an existing highlight returns 409 with the existing highlight's id and the client opens its editor instead.
- **Colours:** `yellow | green | blue | pink` (enum, default `yellow`; last used colour remembered per browser). **Note:** optional text ≤ 2000 runes. **Snapshot:** the highlighted text (≤ 500 runes) is stored; if the paragraph slice at load time differs from the snapshot (for example because the reader variant converter changed text length), that highlight is not drawn, still listed in the panel marked "text changed", and never deleted automatically.
- **Limits:** 2000 highlights per book; bodies 8 KiB; unknown JSON keys rejected; ownership as with bookmarks (another user's book/highlight → 404).
- **Interaction with dictionary lookup:** selecting text keeps opening the lookup popup; the popup gains a compact action bar (swatches + "Note"), so highlighting is one extra click after selecting. `h` highlights the current selection with the last colour; `Esc` order: editor, then popup. Highlights never block hover/selection lookups inside them.
- **Privacy:** highlights and notes are private to the user (library data is per user).

## Global Constraints

- No new dependencies. Migration 021 only; tested on a populated DB (books + bookmarks present).
- Server gates `cd server && go vet ./... && go test ./...` and `go test -race ./internal/library/... ./internal/api ./internal/db`; web gates `check`, `test`, `build` (absolute `npm --prefix /home/user/www/github/qinqin/.claude/worktrees/feature-reader/apps/web`; run builds one at a time). UI has no component tests: pure modules for logic.
- Commit only your own files with explicit `git add <paths>`; never merge or push.
- Keep existing behaviours: reading-position saving and restore are exact (no drift), reading-time tracking, hover/selection lookup, popup stack, bookmark semantics (toggle at same position, 200 cap).

## Review Focus

- Offsets: highlights on text containing ruby (furigana) runs, astral characters, mixed scripts and after the variant (simplified/traditional) switch must land on the right characters; restore after reload must be identical (Task 2, 3).
- Selecting text across runs/ruby/paragraphs and across an existing highlight: no wrong spans, no crashes, clamp note (Task 2, 3).
- The sticky-toolbar revert must not reintroduce the original bug (bookmark/highlight actions scrolling the page to the top) and must keep position round-trip exact (Task 3).
- Rail on a 390 px phone and at 1000–1400 px: no horizontal scroll, text column still readable, drawer focus management and Escape (Task 3).
- Notes with newlines, long text, HTML-looking text: rendered as text only (no `{@html}`) (Task 3, 4).

---

### Task 1: Highlights (server)

**Files:**
- Create: `server/internal/db/migrations/021_library_highlights.sql`, `server/internal/library/highlights.go`, `highlights_test.go`, `server/internal/api/handlers_highlights.go` (+ test)
- Modify: `server/internal/library/library.go` (book delete removes highlights in the same tx), `server/internal/api/api.go`

**Interfaces:**
- Produces:
  ```go
  type Highlight struct { ID, BookID int64; Chapter, Paragraph, Start, End int; Text, Color, Note string; CreatedAt, UpdatedAt time.Time }
  // JSON: id, bookId, chapter, paragraph, start, end, text, color, note, createdAt, updatedAt
  func (s *Store) ListHighlights(ctx, userID, bookID int64) ([]Highlight, error)                      // ordered by chapter, paragraph, start
  func (s *Store) AddHighlight(ctx, userID, bookID int64, h Highlight) (Highlight, error)               // validates ranges (chapter < chapter_count, paragraph >= 0, 0 <= start < end <= 100000), color enum, text trimmed ≤ 500 runes, note ≤ 2000 runes; overlapping an existing highlight in the same (chapter, paragraph) → ErrOverlap carrying the existing id; > 2000 per book → ErrTooMany
  func (s *Store) UpdateHighlight(ctx, userID, bookID, highlightID int64, color *string, note *string) (Highlight, error)   // only color/note mutable
  func (s *Store) DeleteHighlight(ctx, userID, bookID, highlightID int64) error
  // GET/POST /api/library/books/{id}/highlights ; PUT/DELETE /api/library/books/{id}/highlights/{hid}
  // POST: 201 new; 409 {error, existingId} on overlap or {error} on cap; 422 invalid; 404 other user's book. PUT body {color?, note?}
  ```
- [ ] **Step 1:** Failing tests: CRUD; ordering; overlap (adjacent ranges allowed, overlapping 409 with the existing id, same range elsewhere in another paragraph/chapter fine); validation (range, color enum, text/note limits in runes, chapter beyond count); cap; cascade on book delete; authorization (other user → 404, mismatched book/highlight pair → 404); body cap/unknown keys/trailing JSON rejected (reuse the bookmark strict decoder); migration 021 on a populated DB.
- [ ] **Step 2:** `cd server && go test ./internal/library/... ./internal/api ./internal/db` — FAIL. **Step 3:** implement. **Step 4:** gates + race — PASS. **Commit** `feat(library): highlights with notes`.

### Task 2: Highlight logic and API client (web, pure)

**Files:**
- Create: `apps/web/src/lib/plugins/reader/highlights.ts` (+ test), `highlightList.svelte.ts` (+ test; same optimistic/rollback/stale-guard pattern as `bookmarkList.svelte.ts`)
- Modify: `apps/web/src/lib/api/library.ts` (+ test), `types.ts`, `errors.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'
  export interface Highlight { id: number; bookId: number; chapter: number; paragraph: number; start: number; end: number; text: string; color: HighlightColor; note: string; createdAt: string; updatedAt: string }
  export function clampToParagraph(selection: { startParagraph: number; startOffset: number; endParagraph: number; endOffset: number }, paragraphLength: (p: number) => number): { paragraph: number; start: number; end: number; clamped: boolean } | null   // null when empty
  export function visibleHighlights(highlights: Highlight[], chapter: number, paragraphText: (p: number) => string | null): { drawn: Map<number, Highlight[]>; changed: Highlight[] }   // snapshot check; drawn sorted by start per paragraph; changed = snapshot mismatch
  export function splitRunsByHighlights(runs: Run[], highlights: Highlight[]): Seg[]   // Seg = { run: number; text: string; startInRun: number; ruby?: string; highlight: Highlight | null }; splits runs at highlight boundaries (code points), ruby text stays with the FIRST segment of its run and is never inside a highlight offset count; concatenated Seg texts equal the runs' plain text
  export function overlaps(highlights: Highlight[], paragraph: number, start: number, end: number): Highlight | null
  export function nextColor(last: HighlightColor | null): HighlightColor
  // library.ts: listHighlights(bookId), addHighlight(bookId, body), updateHighlight(bookId, id, {color?, note?}), deleteHighlight(bookId, id); addHighlight surfaces 409 overlap with existingId (typed error)
  ```
  Read `paragraphText.ts`, `dom.ts`, `ChapterText.svelte`, `useLookup.svelte.ts` first to match how paragraph plain text, runs and selection offsets are defined (ruby is not part of plain text offsets).
- [ ] **Step 1:** Failing tests for all helpers (ruby runs, astral characters, multi-run highlights, adjacent/overlapping highlights, clamp across paragraphs, snapshot mismatch), the list store (optimistic add, rollback, stale responses after a book switch, 409 overlap handling, cap message) and request shapes.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** web gates — PASS. **Commit** `feat(reader): highlight logic and client`.

### Task 3: Side rail (web UI): bookmarks move, toolbar reverts

**Files:**
- Create: `apps/web/src/lib/plugins/reader/ReaderRail.svelte`, `railState.ts` (+ test)
- Modify: `BookView.svelte`, `BookmarksPanel.svelte` (becomes the rail's Bookmarks tab content), `ChapterText.svelte` (only if needed), `restore.ts`/position-observer code touched by the sticky toolbar

**Interfaces:**
- Produces: `ReaderRail.svelte` props `{ tabs, active, onSelect, open, onToggle }` with slots/snippets for tab content; tab strip is a `role="tablist"` (vertical), roving tabindex, arrow keys; Bookmarks tab (existing panel content plus an "Add bookmark here" button and the toggle state), Highlights tab (placeholder list until Task 4 fills it: an empty-state text); `railState.ts`: `loadRailState()/saveRailState()` (open + active tab, localStorage in try/catch), `railMode(width): 'column' | 'drawer'` (>= 1000 px column).
- Behaviour: remove the bookmark button and panel from the toolbar; toolbar is no longer sticky and its measured-height/`scroll-margin-top`/rootMargin logic is removed (position saver/restore stay exact: verify by test and in the browser); the rail is `position: sticky; top: 1rem` (column) or fixed drawer (below 1000 px) so actions never scroll the page; `b` still toggles a bookmark; margin markers stay; Escape closes the drawer; focus returns to the opener.
- [ ] **Step 1:** Failing tests for `railState` (defaults, corrupted storage, mode thresholds). **Step 2:** FAIL. **Step 3:** implement and wire. **Step 4:** web gates — PASS; real-app check with playwright-core 1.52 (scratchpad `pw`, Chromium headless shell 1161, build the server from a scratchpad copy with the web build embedded, 127.0.0.1:8099 only, never 8080): add/jump/delete a bookmark from the rail at 1280 px and 390 px, reload restores position exactly (open at paragraph N, scroll, reload → same N), no horizontal scroll, screenshots read. **Commit** `feat(reader): side rail for bookmarks, plain toolbar`.

### Task 4: Highlights UI (web)

**Files:**
- Create: `apps/web/src/lib/plugins/reader/HighlightsPanel.svelte`, `HighlightEditor.svelte`, `HighlightBar.svelte`
- Modify: `ChapterText.svelte` (render `<mark>` segments via `splitRunsByHighlights`, keeping `data-p`/`data-r` contracts so `dom.ts` selection→offset mapping still works inside marks), `PopupFrameView.svelte` (action bar in selection popups), `BookView.svelte`, `dom.ts` if needed, `ReaderRail.svelte` (Highlights tab)

**Interfaces:**
- Consumes: Task 1 API, Task 2 helpers and `highlightList` store, Task 3 rail.
- Behaviour: marks styled per colour with dark-mode variants (readable contrast for text on the tint), a small note indicator on highlights that have a note; selection popup action bar: four colour swatches (aria-labelled) + "Note" (adds the highlight in the last colour and opens the editor focused on the note field); `h` key highlights the current selection with the last colour (guards as for `b`); clicking a highlight (or pressing Enter on a focused one; marks are focusable via the panel, not tab-stops in text) opens `HighlightEditor` anchored near it: colour swatches, note textarea (saves on blur and with Ctrl/Cmd+Enter, shows saving/error state), Delete (with confirm), "Look up" untouched; Highlights tab lists chapter-ordered items with colour bar, snippet, note, "text changed" badge, jump (uses `jumpPlan`), edit, delete; overlap 409 opens the existing highlight's editor; cross-paragraph selections clamp with a short note; text only, never `{@html}`; hover/selection lookup inside highlighted text still works and its offsets are unchanged.
- [ ] **Step 1:** Failing tests for any new pure glue (e.g. selection → highlight body builder, key guard reuse). **Step 2:** FAIL. **Step 3:** implement. **Step 4:** web gates — PASS; real-app check (as in Task 3): create each colour from the popup bar, add a note, reload (highlights + notes persist, drawn on the right characters incl. a ruby paragraph), click to edit/delete, overlap handling, jump from the panel, lookup inside a highlight, `h` key, dark mode screenshot, 390 px; report pass/fail/not-run honestly. **Commit** `feat(reader): highlighter with notes`.

### Task 5: Docs and container rebuild

- [ ] Update README (Reader section: side rail, highlights/notes, keys `b` and `h`, API rows for highlights, migration 021), spec notes where the sticky toolbar was documented. **Commit** `docs: reader side rail and highlights`.
- [ ] Rebuild the image `docker build -t qinqin:integration .` from the worktree root, back up `/home/user/qinqin-integration-data` (use a root-capable container copy: files are root-owned) to `/home/user/qinqin-integration-data.bak-before-021`, restart `qinqin-integration` on 127.0.0.1:8085 with the same volume, verify `/healthz` and that the existing user, workspaces, books and bookmarks survived migration 021.
