# Lookup history with add-to-deck (issue #72) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent read-only review on the strongest model, one fix wave). Steps use
> checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, SEE IT FAIL, implement, see it pass.

**Goal:** A per-workspace lookup history (newest first, count, where), add to deck per word and in bulk,
remove, clear (including old `lookup` search events), a user-global recording switch, and a "no card yet"
prompt on the history page and in the reader popup.

**Architecture:** One `qinqin-core` plugin data row `lookups` per workspace (capped item list, overwritten
by read-merge-write flushes, so Clear really erases) and a user-global `lookupcfg` row. Pure rules in
`apps/web/src/lib/lookups/lookups.ts`, a per-tab in-memory `LookupRecorder`, a thin `/lookups` page. Server:
one new route `DELETE /api/events/lookups?workspace=` and the backup export refs / restore remap of the row.
No migration.

**Tech stack:** Go 1.26 (via `GOTOOLCHAIN=auto`), SvelteKit 2 / Svelte 5, vitest (unit + jsdom). No new
dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-16-v030s-lookup-history-design.md`.

**Branch / worktree:** `feature/v030s-lookup-history` in `/home/user/qinqin/.claude/worktrees/lookup-history`
(`<wt>`). Before Task 1, merge (or rebase onto) the collection branch `feature/v0.3.0-stretch` with #67,
#75, #77 and #68 merged: this plan uses #77's `backup.CorePlugin` / `CORE_PLUGIN_ID` and core remap branch,
and #68's `familiarity`/`KnownIndex` (`lib/study/known.ts`) and its "I know this" toggle in
`AddToStudyButtons.svelte`. If either is missing when the build starts, stop and report (do not fork them).

## Gates

- Go (targeted per task; proxy variables unset; under the shared lock):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./internal/events ./internal/backup ./internal/api && go test -count=1 -p 2 -timeout 30m ./internal/events ./internal/backup ./internal/api'`
  — `gofmt -l` prints nothing. ONE full `./...` run before the branch's last commit; the only accepted
  failure is `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 sockets here).
- Web: `npm --prefix <wt>/apps/web ci` once; per task `cd <wt>/apps/web && npx vitest run <paths>`; before
  the last commit `npm --prefix <wt>/apps/web run check`, `test`, `run build` (read exit codes, no `| tail`),
  and once the full vitest with Node 26:
  `cd <wt>/apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- One commit per task, explicit `git add <files>`, conventional message ending with a blank line and
  exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, merge to other branches, tag.
- `git status` clean after every task.

## Global constraints

- Plugin `qinqin-core`. Key `lookups`, always `?workspace=<ws>`; key `lookupcfg`, always user-global (no
  `workspace`). Never per-word keys, never `DELETE` of `lookups` (Clear is a `PUT`).
- Row valid only when live, an object, `version === 1`; item rules, cap `LOOKUP_CAP = 500`, dedupe window
  `LOOKUP_DEDUPE_MS = 600_000`, `clearedAt` rule: exactly as the fixtures say (`docs/contracts/lookups/`).
- `lookupcfg` missing/unreadable → `record: true`. The recorder checks it at start and before every flush.
- A flush always reads the row in the same flush before writing it. The buffer (≤ 200) is memory only:
  nothing about lookups in `localStorage`, `sessionStorage`, IndexedDB, URLs or console logs.
- Counted: root hover popup with ≥ 1 result after `HOVER_DWELL_MS = 1000` or on pointer entering it;
  selection popup on non-empty results; search on opening a hit. Nested popups never.
- Text interpolation only for words and book titles; no `{@html}` in `lib/lookups/**` or `routes/lookups/**`.
- The web app never posts `lookup` events again; `EventType` and `core.json` keep the type.

## Review Focus

1. **Privacy:** Clear = `PUT {version:1, clearedAt, items: []}` then `DELETE /api/events/lookups`; no
   tombstone with data; no write from a stale copy (a flush without a read in the same flush is a must-fix);
   a buffered lookup ≤ `clearedAt` never revives; switch off stops all writes and discards buffers;
   nothing in browser storage; recorder dropped on sign-out (Tasks 3, 4, 10).
2. **User and workspace isolation:** user B cannot read or write A's `lookups`/`lookupcfg`; `DELETE
   /api/events/lookups` with A's workspace as B → 404 and A's events intact; A's call deletes only A's
   `lookup` events of that workspace (not `review`/`view`/`read`, not other workspaces, not B's) (Tasks 5, 6).
3. **Route hygiene:** `route{}` row with `accUser`; route-walk and PWA fixture regenerated, classified
   not cacheable; `docs/wiki/API-Routes.md` regenerated; restricted sessions get 403 like every user route
   (Task 6).
4. **Restore correctness:** items follow entries to shifted ids, unresolved dropped, duplicates merged,
   book ids remapped, unparseable row dropped; every other row byte-identical to before; existing
   `remap.json` cases unchanged (Task 7).
5. **Counting rule:** passing the mouse over words records nothing; dwell and enter record once; dedupe
   window holds across two tabs (merge) (Tasks 3, 8).
6. **No regression:** search still searches; no `lookup` event posted; popup "+" and #68's toggle unchanged
   (Tasks 9, 11).

---

### Task 1: Contract fixtures and READMEs

**Files:** Create `docs/contracts/lookups/README.md`, `lookup-rows.json`, `lookup-merge.json`,
`lookup-prompt.json`; modify `docs/contracts/README.md` (folder row), `docs/contracts/overview.md`
(row-key table rows `lookups` and `lookupcfg` with plugin `qinqin-core`; events bullet: "append-only,
except that the owner can delete their `lookup` events (`DELETE /api/events/lookups`); the web app no
longer emits them"; Gaps: `lookup` payload note updated).

- [ ] **Step 1:** README: plugin, keys and scopes, shape, validity, cap and eviction order, dedupe window,
  `clearedAt`, read-merge-write rule, Clear sequence, switch default, counting rules (informative: UI
  clients), the delete route, backup remap (pointer to `backup/`).
- [ ] **Step 2:** `lookup-rows.json` (`{"version":1,"rule":"lookups/rows","cases":[{name, op:"rows"|"cfg",
  input:{data, deletedAt}, expect}]}`): valid row; tombstone → empty; `version` 2 → empty; data a JSON
  string of a valid row; item with `entryId` 0 / string / 1.5 skipped; duplicate `entryId` (second
  skipped); `count` 0 skipped, 2e6 clamped; `firstAt` after `lastAt`; bad timestamp skipped; unknown source
  key kept; `books` with 5 ids, duplicates, a negative → 3 distinct positive; unknown top-level member kept;
  items unsorted → sorted newest first; cfg missing → true; `{version:1, record:false}` → false;
  `record:"no"` → true.
- [ ] **Step 3:** `lookup-merge.json` (`rule: "lookups/merge"`, ops `merge`, `remove`, `clear`,
  `staleAfterClear`): new word; second lookup 11 min later (count 2, sources +1, lastAt); 9 min later
  (count unchanged, lastAt and books updated); same book again moves to front; fourth book drops the oldest;
  lookup at/before `clearedAt` dropped; 501st item evicts least recent (tie: smaller count, larger id);
  remove two ids; clear keeps unknown top-level members; a 500-item row with realistic values serialises
  under 80 000 bytes (`expectMaxBytes`).
- [ ] **Step 4:** `lookup-prompt.json` (`rule: "lookups/prompt"`): count 2 excluded; count 3 with no card
  included; with a card excluded; marked known excluded; order by count then lastAt; 12 candidates → 10.
  Familiarity is given per case as input (`states: {entryId: "new"|"learning"|"known"}`).
- [ ] **Step 5:** Commit `docs(contracts): lookup history rows and rules`.

### Task 2: `lib/lookups/lookups.ts` — pure rules

**Files:** Create `apps/web/src/lib/lookups/lookups.ts`, `lookups.test.ts`.

```ts
export const LOOKUPS_KEY = 'lookups';
export const LOOKUP_CFG_KEY = 'lookupcfg';
export const LOOKUP_CAP = 500;
export const LOOKUP_DEDUPE_MS = 600_000;
export const PROMPT_MIN_COUNT = 3;
export const PROMPT_MAX = 10;
export type LookupSource = 'reader' | 'lesson' | 'search';
export interface LookupItem { entryId: number; count: number; firstAt: string; lastAt: string;
  sources: Record<string, number>; books: number[] }
export interface LookupHistory { clearedAt: string | null; items: LookupItem[]; extra: Record<string, unknown> }
export interface LookupHit { entryId: number; at: string; source: LookupSource; bookId?: number }
export function parseLookups(data: unknown, deletedAt?: string | null): LookupHistory;
export function serializeLookups(h: LookupHistory): Record<string, unknown>;
export function mergeLookups(h: LookupHistory, hits: readonly LookupHit[]): LookupHistory;
export function removeLookups(h: LookupHistory, entryIds: readonly number[]): LookupHistory;
export function clearedLookups(h: LookupHistory, now: Date): LookupHistory;
export function staleAfterClear(h: LookupHistory): boolean;   // any item.lastAt <= clearedAt
export function promptItems(h: LookupHistory, stateOf: (entryId: number) => 'new' | 'learning' | 'known'): LookupItem[];
export function parseLookupCfg(data: unknown): { record: boolean; extra: Record<string, unknown> };
export function serializeLookupCfg(record: boolean, previous?: { extra: Record<string, unknown> }): Record<string, unknown>;
```
- [ ] **Step 1:** Test decodes all three fixtures, every case. Run → fails (module missing).
- [ ] **Step 2:** Implement; run → passes. Commit `feat(lookups): lookup history rules`.

### Task 3: `LookupRecorder` and the dwell rule

**Files:** Create `apps/web/src/lib/lookups/recorder.ts`, `recorder.test.ts`, `dwell.ts`, `dwell.test.ts`.

```ts
export interface RecorderIO { readRow(ws: number): Promise<unknown | null>; writeRow(ws: number, data: unknown): Promise<void>;
  readCfg(): Promise<unknown | null> }
export class LookupRecorder {
  constructor(io: RecorderIO, clock?: { now(): number; setTimeout; clearTimeout });
  note(ws: number, hit: Omit<LookupHit, 'at'>): void;     // buffers; schedules flush (5 s idle, 30 s max)
  flush(): Promise<void>;                                  // per ws: readCfg, readRow, merge, writeRow
  countOf(ws: number, entryId: number): number;            // from the last read copy + buffer
  load(ws: number): Promise<void>;                         // one read for the popup hint
  reset(): void;                                           // sign-out: drop buffers and copies
}
export function lookupRecorder(): LookupRecorder;          // per-tab singleton over lookups/store.ts
// dwell.ts
export const HOVER_DWELL_MS = 1000;
export class DwellCounter { shown(entryId: number | null): void; entered(): void; closed(): void }  // calls onCount once
```
- [ ] **Step 1:** Failing tests (fake timers): flush only after 5 s idle, forced at 30 s; a failed write keeps
  the buffer, next flush retries; buffer capped at 200 (oldest dropped); a flush ALWAYS calls `readRow`
  before `writeRow` (spy order); cfg `record:false` → no `writeRow`, buffer discarded, later `note` ignored
  until cfg re-reads true; a hit at or before a remote `clearedAt` does not reappear; `reset()` empties;
  no `localStorage` access (spy on `Storage.prototype`); `visibilitychange` hidden triggers a flush.
  Dwell: shown + 999 ms + closed → no count; shown + 1000 ms → one count; shown + entered at 200 ms → one
  count, no second at 1000 ms; a new `shown` restarts; `shown(null)` (no result) never counts.
- [ ] **Step 2:** Implement; run → passes. Commit `feat(lookups): buffered recorder and hover dwell`.

### Task 4: `lib/lookups/store.ts` — I/O

**Files:** Create `apps/web/src/lib/lookups/store.ts`, `store.test.ts`.

```ts
export function loadHistory(ws: number): Promise<LookupHistory>;               // sdk.data.workspace(ws).find
export function removeFromHistory(ws: number, entryIds: number[]): Promise<LookupHistory>;  // read, remove, put
export function clearHistory(ws: number, now?: Date): Promise<{ eventsDeleted: number }>;   // put cleared, then DELETE events route, invalidateWorkspaceEvents(ws)
export function loadLookupCfg(): Promise<{ record: boolean }>;
export function saveLookupCfg(record: boolean): Promise<void>;                 // keeps extra members
```
- [ ] **Step 1:** Failing tests with a mocked `api`: request paths and methods (`/api/plugins/qinqin-core/
  data/lookups?workspace=3`, `.../lookupcfg` without `workspace`, `DELETE /api/events/lookups?workspace=3`);
  Clear never sends `DELETE` to plugin data; Clear's event delete failing after the row put rejects with a
  message that says the history is cleared but old search records remain; `invalidateWorkspaceEvents` called.
- [ ] **Step 2:** Implement; run → passes. Commit `feat(lookups): history store`.

### Task 5: Go — `events.DeleteLookups`

**Files:** Modify `server/internal/events/events.go`, `events_test.go`.

```go
// DeleteLookups deletes the user's events of type "lookup" in one workspace; the only deletion of
// events (privacy, #72): nothing derives from lookup events. Returns the rows deleted.
func DeleteLookups(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64) (int64, error)
```
- [ ] **Step 1:** Failing test: alice has `lookup`, `review`, `view` events in ws1 and a `lookup` in ws2; bob a
  `lookup` in his ws; `DeleteLookups(alice, ws1)` returns 1 and leaves everything else (`Since` checks).
  Update the `Append` comment ("Events are immutable…") to name the one exception.
- [ ] **Step 2:** Implement; run the Go gate for `./internal/events`. Commit `feat(events): delete a workspace's lookup events`.

### Task 6: Go — route `DELETE /api/events/lookups`

**Files:** Modify `server/internal/api/api.go` (`{"DELETE /api/events/lookups", s.handleDeleteLookupEvents,
accUser, nil}`), `handlers_events.go`; create `handlers_events_lookups_test.go`; regenerate
`apps/web/src/lib/pwa/sw/routes.fixture.json` (`UPDATE_ROUTES_FIXTURE=1`), update
`apps/web/src/lib/pwa/sw/classify.ts` only if the fixture test demands a class (network-only, never cached),
regenerate `docs/wiki/API-Routes.md` (`node scripts/gen-api-docs.mjs`).

- [ ] **Step 1:** Failing tests: unauthenticated 401; no `workspace` 400; `workspace=abc` 400; bob with
  alice's workspace 404 and alice's events unchanged; alice → 200 `{"deleted":2}` and only her lookup
  events of that workspace gone; repeated call → `{"deleted":0}`; a password-change-restricted session 403.
  Route-walk and PWA fixture tests fail until regenerated.
- [ ] **Step 2:** Implement (`workspaceOwned` check as `handleEventBatch`), regenerate fixture and wiki
  page, run the Go gate (`./internal/api`) and `npx vitest run src/lib/pwa src/lib/wikiDocs.test.ts`.
  Commit `feat(api): delete lookup events of a workspace`.

### Task 7: Go — backup export refs and restore remap of `lookups`

**Files:** Modify `server/internal/backup/remap.go` (`PluginRow`: `CorePlugin` + key `lookups`), `export.go`
(`writePluginData`: refs from items), `remap_test.go`, `export_test.go`, `docs/contracts/backup/remap.json`,
`docs/contracts/backup/README.md` (remap paragraph), `docs/contracts/backup/sample-v1/plugin-data/000001.jsonl`
(+ `manifest.json` counts and SHA-256).

- [ ] **Step 1:** Failing `remap.json` cases (decoded by the Go remap test): shifted entries and books;
  unresolved entry dropped; unresolved book id dropped from `books`; two items to one target merged (sum,
  min/max, books ≤ 3); merged list sorted and capped; unknown top-level member and `clearedAt` kept;
  unparseable data → row dropped; `qinqin-flashcards` row named `lookups` untouched; `lookupcfg` untouched.
  Export test: a `lookups` row's entry ids appear in `refs/entries.json`; tombstoned row not exported.
  Sample archive restore test still passes with the new row.
- [ ] **Step 2:** Implement (reuse `parseObject`/`buildObject`; a Go mirror of the merge rule used only
  here, kept to the fields above). Run the Go gate (`./internal/backup ./internal/api`). Commit
  `feat(backup): remap lookup history on restore`.

### Task 8: Record in the reader and lessons

**Files:** Modify `apps/web/src/lib/plugins/reader/useLookup.svelte.ts` (option
`onLookup?: (entryId: number, mode: 'hover' | 'selection') => void`, a `DwellCounter` on the root hover
frame, `popups.entered` → `entered()`, selection results → immediate), `BookView.svelte` (source `reader`,
`bookId`, `workspaceForBook`; `lookupRecorder().load(ws)` on open), `plugins/grammar/LessonView.svelte`
(source `lesson`, `studyWorkspaceId`); tests in a new `useLookup.lookups.dom.test.ts` (or the closest
existing DOM test).

- [ ] **Step 1:** Failing tests: hover passing over three words (each < 1 s) → no `onLookup`; hover resting
  1 s → one call with `results[0].entryId`; entering the popup → one call; selection with results → one
  call, without results → none; nested popup → none; BookView passes `reader` + book id; no workspace → no
  call.
- [ ] **Step 2:** Implement; run the reader and grammar tests. Commit `feat(reader): record lookups in the history`.

### Task 9: Search records on open; no more `lookup` events

**Files:** Modify `apps/web/src/routes/search/+page.svelte` (remove `recordedLookups`/`recordLookup`; hit
link `onclick` → `lookupRecorder().note(ws, {entryId: hit.id, source: 'search'})`; a "Lookup history" link
to `/lookups`); its DOM test (create `routes/search/page.dom.test.ts` if none).

- [ ] **Step 1:** Failing tests: running a search posts no `/api/events/batch`; clicking a hit notes it once
  with source `search`; the history link exists.
- [ ] **Step 2:** Implement; run. Commit `feat(search): record opened results instead of queries`.

### Task 10: History page model and `/lookups` page

**Files:** Create `apps/web/src/lib/lookups/historyView.ts` (+ `historyView.test.ts`),
`apps/web/src/routes/lookups/+page.svelte`, `apps/web/src/routes/lookups/page.dom.test.ts`; modify
`apps/web/src/lib/account/YourData.svelte` (one line: "Lookup history" link) and its test if any; hook
`lookupRecorder().reset()` into the sign-out path (where `clearEntryBasesCache` is called).

```ts
export interface HistoryRow { entryId: number; written: string | null; reading: string; count: number;
  lastDay: string; where: string; state: 'new' | 'learning' | 'known'; missing: boolean }
export function historyRows(h: LookupHistory, bases: Map<number, EntryBase>, books: Map<number, string>,
  stateOf: (id: number) => 'new' | 'learning' | 'known', dayOf: (iso: string) => string,
  filter: 'all' | 'nocard'): HistoryRow[];
export function whereText(item: LookupItem, books: Map<number, string>): string;  // 《A》, 《B》, lessons, search; "a removed book"
```
- [ ] **Step 1:** Failing tests. Model: order, filter, where text, missing entries, learner's day. DOM:
  list of 50 + "Show 50 more"; per-row Add creates one card in the chosen deck, a second Add creates nothing
  (plan says skip); bulk Add selected; prompt box shows only `new` items with count ≥ 3 and its bulk add;
  Remove selected rewrites the row without them (read before write); Clear asks inline, Keep does nothing,
  Delete calls `clearHistory` and shows the empty state; the switch writes `lookupcfg` and, when turned off,
  offers "Clear history too"; failed load shows Try again; a word `<img src=x onerror=alert(1)>` and a book
  title with markup render as text; no `{@html}` in the page source (guard test).
- [ ] **Step 2:** Implement (thin page; `loadHistory`, `loadEntryBases`, `loadRawStudyData`,
  `familiarity` from #68 with `MASTERY_THRESHOLD`, library list for titles, `planAddToDeck` +
  `pushStudyRows`). Run. Commit `feat(lookups): lookup history page`.

### Task 11: "You've looked this up N times" in the popup

**Files:** Modify `apps/web/src/lib/plugins/reader/AddToStudyButtons.svelte`, `AddToStudyButtons.dom.test.ts`.

- [ ] **Step 1:** Failing tests: count 3, no card, not marked known, root popup → hint text; count 2 → none;
  with a card → none; #68 toggle pressed → none; nested popup → none; recording off → none.
- [ ] **Step 2:** Implement (count from `lookupRecorder().countOf`); run. Commit `feat(reader): prompt to add often looked-up words`.

### Task 12: Wiki, README, gates and real-app check (no browser)

**Files:** Modify `docs/wiki/Searching-and-entries.md` (section "Lookup history": what counts, where,
add, remove, clear, switch), `docs/wiki/Reader.md` (one paragraph + link), `docs/wiki/Your-data.md`
(the history is in the backup; what Clear deletes and what it cannot: downloaded archives, safety exports
≤ 7 days, administrator backups, database free pages), `docs/wiki/Settings-tour.md` (Your data link),
`README.md` (feature line); this plan's Execution record.

- [ ] **Step 1:** Wiki and README edits; `npx vitest run src/lib/wikiDocs.test.ts`. Commit
  `docs(lookups): wiki and README for lookup history`.
- [ ] **Step 2:** Full Go gate (`./...`), web `check`, `test`, `build`, full vitest on Node 26. Read every
  exit code.
- [ ] **Step 3:** Real app, API only: copy `<wt>` to the scratchpad, `go build -o qq ./cmd/qinqin`, two data
  dirs A and B; seed both (B with a different pack first so entry ids differ); `qq adduser` per user
  (password via stdin, never logged); `qq serve --addr 127.0.0.1:<free>` (check `ss -ltn`; never 8080, 8085,
  8300). With `python3 -I`:
  1. User alice, zh workspace; post an old-style `lookup` event and a `review` event; PUT `lookups` with
     three items (one with a book id of an imported book) and `lookupcfg {record:false}` (global).
  2. User bob: GET/PUT `lookups` with alice's workspace → 404; `DELETE /api/events/lookups?workspace=<alice ws>`
     → 404; alice's events unchanged.
  3. Alice exports: the row in `plugin-data`, its entries in `refs/entries.json`, manifest SHA-256 ok.
  4. Restore onto B: items carry B's entry ids (looked up on B), book id remapped to the new book.
  5. Alice on A: PUT the cleared row, `DELETE /api/events/lookups?workspace=` → `{"deleted":1}`; the review
     event remains; `GET .../data/lookups` holds no item; the pull shows no tombstone for `lookups`.
- [ ] **Step 4:** Kill servers, delete scratch copy and data dirs; `git status` clean. Fill the Execution
  record (not verified: real hover dwell feel, visibilitychange flush in real browsers, two real devices).
  Commit `docs(lookups): execution record` (plan file only).

## Task dependencies

1 → 2 → 3 → 4 → 8, 9, 10 → 11 → 12; 5 → 6; 1 → 7. Go (5–7) and web (2–4, 8–11) can run with two
implementers in parallel; never two full suites at once.

## Contract notes

- New: `docs/contracts/lookups/` (rows, merge, prompt), decoded by `lib/lookups/lookups.test.ts`; Go decodes
  only `backup/remap.json`'s `lookups` cases.
- Android: same row and rules; read-merge-write per flush, never from a stale copy; respect `lookupcfg`;
  never emit `lookup` events; offer Clear (PUT + delete route).

## Execution record

Built 2026-11-16 by one implementer, inline (no subagents, no independent review wave yet).

**Start.** `feature/v0.3.0-stretch` merged into the branch (`4c9bb32`, no conflicts): #77 notes
(`backup.CorePlugin` branch, invalid `note:` rows dropped and counted), #68 unknown words
(`familiarity`/`KnownIndex`, "I know this", `known:` rows, null-workspace marks dropped), #67, #75, #71.
`npm ci` once. The route table has no `token` field (personal access tokens #83 not merged when the build
started), so nothing to do for tokens; the new route is a plain `accUser` row.

**Adaptations to the merged code (Rulings).**

- Ruling: an unparseable `lookups` row (not a version 1 object, a JSON string holding one is decoded first)
  **and a `lookups` row without a workspace** are dropped on restore and counted in `droppedRows` — the same
  strictness #77/#68 got after review (invalid `note:` / null-workspace `known:` dropped) — cost: a corrupt
  or misplaced history is lost.
- Ruling: the restore branch sits before the `CorePlugin` note branch (`isLookupsRow`), so `note:` handling
  is untouched; the sample archive's note test now selects `key LIKE 'note:%'` because the sample carries a
  `lookups` row too.
- Ruling: the page's "No card / In study / Known" and the prompt use #68's `familiarity` with the full
  `KnownIndex` (cards replayed as the reader does, `loadStudyHistory` + `scheduleIndex`), not just "has a
  card"; add uses #68's `addWords` (the decks view's idempotent `planAddToDeck`).
- Ruling: **the service worker never saves the lookup rows** (`classify.ts`: `qinqin-core` key routes
  `lookup*` and list reads whose prefix can match them are `bypass`), and Clear/Remove delete the current
  credential's saved copies that can still hold them (whole-account pulls, event logs, `qinqin-core` data)
  — "nothing in browser storage" covers Cache Storage too — cost: those offline copies are fetched again on
  the next page that needs them.
- Ruling: timestamps are case-sensitive RFC 3339 with a real calendar date on the web as in Go (fixture
  cases "a lowercase t", "30 February"); the web checks days per month without `Date.UTC` (UTC guard).
- Ruling: source counts are clamped to 1 000 000 like `count` (fixture cases), so a merge can never grow a
  member without bound.
- Ruling: the realistic 500-item row is 78.5 KB (limit 80 000 in the fixture); 500 items at the field maxima
  are about 103 KB (limit 110 000), both well inside the 256 KiB value cap. The spec's "about 65 KB" was low.
- Ruling: the dedupe compares `|at − lastAt| < 10 min` (a hit older than the stored `lastAt` outside the
  window counts but does not move `lastAt`; its book is appended), exactly 10 minutes counts again.
- The recorder's per-tab singleton `lookupRecorder()` lives in `store.ts` (not `recorder.ts`) so the
  recorder class stays free of I/O imports; sign-out and a 401 call `resetLookupRecorder()` (`auth.ts`).
- `recorder.test.ts` is `recorder.dom.test.ts` (it needs `document` and `Storage`).
- The popup hint reads `lookupRecorder().countOf` for the root popup's first result (`first` prop through
  `EntryCard`); the book loads the copy once (`load(ws)` on open).

**Commits (one per task, plus one fix).**

| Task | Commit |
| --- | --- |
| merge | `4c9bb32` Merge feature/v0.3.0-stretch |
| 1 | `27d98c4` docs(contracts): lookup history rows and rules |
| 2 | `b2e724d` feat(lookups): lookup history rules |
| 3 | `93e2bec` feat(lookups): buffered recorder and hover dwell |
| 4 | `adacd14` feat(lookups): history store (also the `classify.ts` bypass) |
| 5 | `71fa74b` feat(events): delete a workspace's lookup events |
| 6 | `aa0b61a` feat(api): delete lookup events of a workspace |
| 8 | `192d590` feat(reader): record lookups in the history |
| 7 | `6e95617` feat(backup): remap lookup history on restore |
| 9 | `45e5336` feat(search): record opened results instead of queries |
| 10 | `e7a18c6` feat(lookups): lookup history page (also the case-sensitive timestamp cases, a typed mock in the Task 8 test) |
| 11 | `c84c6d5` feat(reader): prompt to add often looked-up words |
| 12 | `1cf80c9` docs(lookups): wiki and README for lookup history |
| fix | `517aaf1` fix(lookups): calendar check without UTC date calls, hint after its state |
| 12 | this commit: docs(lookups): execution record |

**Test-first.** Every task's tests were run and seen failing first (module missing, 404 for the unrouted
route, remap cases failing, the search/page/popup assertions failing), except: `pageData.test.ts` (Task 10)
was written in the same step as `pageData.ts` and only seen passing; the `sink.test.ts` source guards and
`sink.ts` failed first, then passed. The fix commit came from the full gates (`svelte-check`: the hint's
`$derived` read `inStudy`/`marked` before their declaration; the UTC guard test flagged `Date.UTC` in
`lookups.ts`); both were invisible to the targeted vitest runs. No separate mutation runs were made beyond
watching the new assertions fail before the code existed.

**Gates (final tree).**

- Web: `npm run check` exit 0 (1205 files, 0 errors, 0 warnings); `npm test` exit 0 (357 files, 5609 tests);
  `npm run build` exit 0; Node 26.13.1 `npx vitest run` exit 0 (357 files, 5609 tests).
- Go, one full run (proxy variables unset, under the lock): `gofmt -l` printed nothing, `go vet ./...` clean,
  `go test ./...`: 37 packages ok, 1 FAIL `internal/ai` with exactly `TestHostnameResolvingToEmbeddedFormIsRefused`
  (no IPv6 sockets here, the known environment failure). Targeted gates per Go task (`./internal/events`,
  `./internal/backup`, `./internal/api`) were green.

**Real-app check (API only, no browser).** Scratch copy built with `go build ./cmd/qinqin`; server A seeded
with cedict, server B with es-demo first (4 entries) then cedict, so B's ids differ (马 117113 → 117117);
users via `adduser` with the password from the environment; served on 127.0.0.1:18731 and :18732. A Python
script (`python3 -I`, 45 checks, all passed): alice's zh workspace, an uploaded EPUB, an old-style `lookup`
and a `review` event, a 3-item `lookups` row (one with the book) and a user-global `lookupcfg
{record:false}`; bob: GET/PUT of alice's `lookups` → 404, `DELETE /api/events/lookups` with her workspace →
404, no token → 401, alice's events unchanged; export: the row in `plugin-data`, its three entries in
`refs/entries.json`, every manifest SHA-256 correct; restore onto B (a book uploaded on B first): items carry
B's entry ids in order, the book id follows the restored book (1 → 2); clear on A: PUT of the cleared row,
`DELETE` → `{"deleted":1}`, the review event remains, the row holds no item, the pull has the live cleared row
with none of the old ids, and the SQLite file has one live cleared row and no `lookup` event. Both servers
were killed and the scratch copy and data directories deleted.

**Not verified.** The hover dwell's feel and the popup flows in a real browser (jsdom only); the
`visibilitychange` flush in real browsers; two real devices racing a flush against a Clear (only the pure
`staleAfterClear` and the recorder's read-before-write are tested); the service worker's actual Cache
Storage contents in a browser (the classify rule and `forgetOfflineLookups` are unit-tested with fakes);
Android. (An independent privacy review ran afterwards; see Review fixes.)

## Review fixes (the one fix wave, after the independent privacy review)

**Start.** `feature/v0.3.0-stretch` merged again (`e0eb179`: #83 personal access tokens, #81 weekly summary).
Conflicts: the route table (taken from the collection branch with its token column, then
`{"DELETE /api/events/lookups", s.handleDeleteLookupEvents, accUser, nil, noTok}` added: token-forbidden, not
in the tokengate allow map), `classify.test.ts` and `Settings-tour.md` (both sides kept);
`docs/wiki/API-Routes.md` and the PWA route fixture regenerated. `npm ci` again.

| Finding | Commit | What changed (test first, each seen failing) |
| --- | --- | --- |
| MUST 2 same-tab race | `a1425ab` | `LookupRecorder.exclusive(fn)` runs Clear and Remove in the flush chain (waits for a flush in flight, blocks new ones, bumps the generation). Recorder test with a held `writeRow`: the old words never come back. |
| MUST 1 + NIT 6 real race, server clock | `681a23e` | The store keeps the clearedAt it wrote; it is the server's `updatedAt` of the PUT (the row is written once more with it when it differs from the client clock). `staleAfterClear(row, mine)`: the row's clearedAt missing or earlier than mine, or an item `lastAt <= mine`; a later clearedAt (cleared again elsewhere) with newer items only is not stale. The 30 s check runs from a store-level timer (leaving the page does not cancel it; sign-out does) and re-clears with mine and no items. Fixture cases and README updated. Store test with a fake server: B reads, A clears, B writes back its old row, 30 s later the row is the clear again, once. |
| SHOULD 3 cached pulls and event logs | `13172e4` | `pwa/sw/scrub.ts`: before `cache.put` a saved pull loses its `qinqin-core` `lookup*` rows and a saved event log its `lookup` events (an unreadable body of those paths is not saved); `classify.ts` compares decoded paths (`qinqin%2Dcore`, `%6Cookups`). Strategy test: the live answers are whole, the saved ones hold neither. PWA and lookups READMEs and the wiki corrected. |
| SHOULD 4 offline study stays ready | `13172e4` | `forgetOfflineLookups` became `scrubOfflineLookups`: copies saved earlier are filtered in place (save time kept); only an unreadable copy or a saved read of the lookup rows is deleted, and then the prepared receipts are cleared. |
| SHOULD 5 user change | `4c2e341` | `auth.subscribe`: the recorder is reset whenever `auth.user?.id` changes (other tab, token swap), not only on logout/401. |
| NIT 7 other tabs | `1ba3f74` | `visibilitychange` to visible re-reads the switch and every held copy before the popup hint is shown again. |
| Minors | `e92db9b` | Source keys: known keys always stay, at most 13 others of at most 32 characters (web parse, Go restore merge; fixture cases, Go test). A 413 on a flush drops those lookups instead of retrying forever. Search records a middle-click open (`auxclick`, button 1); a context-menu "open in new tab" is not seen (wiki says so). |
| Wiki: tokens | `29ef2d2` | Read tokens can read notes and the lookup history through plugin data and the pull; the delete route needs the app. |

Rulings: re-clearing keeps no items of a stale write-back (its counts include the erased past) — cost: up to
30 s of new lookups on other devices are lost. The second write for the server clearedAt is accepted (one
extra PUT per Clear). Source key length is UTF-16 units on the web and bytes in Go (the same for the ASCII
keys clients write).

**Gates after the fixes.** Targeted Go (`./internal/events ./internal/backup ./internal/api`) ok, `gofmt -l`
empty. Web `check` exit 0 (1241 files, 0 errors, 0 warnings), `test` exit 0 (372 files, 5852 tests), `build`
exit 0; Node 26.13.1 vitest exit 0 (372 files, 5852 tests). One full Go run: `go vet ./...` clean, 37 packages
ok, 1 FAIL `internal/ai` with only `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here).

**Not verified in the fix wave.** No new real-app run (the API behaviour of the server did not change apart
from the token column); the worker's filtering in a real browser's Cache Storage; the server-time clearedAt
against devices with skewed clocks (unit-tested only).

