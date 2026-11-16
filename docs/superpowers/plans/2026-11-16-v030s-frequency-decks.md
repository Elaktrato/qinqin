# Frequency-Ordered New Words and Starter Decks (issue #75) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model, one fix wave, whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, SEE IT FAIL, implement,
> see it pass.

**Goal:** A per-deck and per-session order for new cards (added, most frequent first, by level) that also
works in word-level sessions, and "Top 500 / 1000 / 2000" starter decks computed from the installed
frequency packs as system decks in the decks view, skipping known words; hidden with a hint when the
workspace language has no frequency pack. No new data is bundled.

**Architecture:** Server: id-only word resolution in `lexicon`, starter resolution + cache in `freq`,
fixed-pack entry ranks in `lookup`, two `accUser` routes and `packId` on `GET /api/frequency-packs`. Web:
pure modules `study/newOrder.ts` (shapes, `orderNew`, session resolution), `study/known.ts`,
`study/frequencyRanks.ts` and `study/levelKeys.ts` (loaders with cache), `decks/starterDecks.ts`; an
optional `newKey` in the deck and level queues; thin UI in the study setup, deck settings and the system
section. Rows: only a new optional field `newOrder` in `deckcfg:*`. No migration.

**Tech stack:** Go 1.26 (`GOTOOLCHAIN=auto`), SQLite; SvelteKit 2 / Svelte 5, vitest (unit + jsdom). No new
dependencies.

**Spec (binding, incl. Rulings and the licence table):**
`docs/superpowers/specs/2026-11-16-v030s-frequency-decks-design.md`.

**Branch / worktree:** `feature/v030s-frequency-decks` at `.claude/worktrees/frequency-decks` (`<wt>`), cut
from `feature/v0.3.0-stretch`. Independent of #67 (daily goals, parallel branch): no shared files except
possibly `docs/contracts/README.md`, `docs/contracts/overview.md`, README and the wiki sidebar (merge
conflicts there are textual only).

## Gates

- Go (per task, targeted packages, under the shared lock):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./<pkgs> && go test -count=1 -p 2 -timeout 30m ./<pkgs>'`;
  `gofmt -l` prints nothing. ONE full `./...` run before the branch's last commit. No `-race` (no
  concurrency change except the cache in Task 6: `-race` on `./internal/freq` only).
- Web: `npm --prefix <wt>/apps/web ci` once; per task `run check`, targeted `npx vitest run <paths>`, and
  `test` + `run build` on UI tasks; read the exit codes (never behind `| tail`). Before the last commit the
  full vitest once with Node 26: `cd <wt>/apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- `node scripts/check-sources.mjs` and `node scripts/gen-api-docs.mjs --check` (or the test that checks
  `docs/wiki/API-Routes.md`) after route or docs changes.
- One commit per task, explicit `git add`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, merge or tag. `git status` clean.

## Global constraints

- `NewOrder = {by:'added'} | {by:'frequency'} | {by:'level', packId:string}`; absent/malformed = added.
- `orderNew`: stable sort by key ascending, `null` keys after all keyed items in their incoming order.
- Ranking pack = first installed frequency pack of the language by `ord, id`; fixed per request.
- Known = live vocab card with `cardScore(stability) >= MASTERY_THRESHOLD` (80).
- Starter sizes exactly 500, 1000, 2000; id `d-frq-<slug(packId)>-<fnv1a32(packId + "\0" + "top-" + size)>`.
- New routes: `POST /api/entries/frequency-ranks`, `GET /api/frequency-packs/{id}/top`, both `accUser`,
  neither cacheable by the service worker. 1–500 ids, body ≤ 16 KiB.
- No data file is added under `plugins/`; nothing from local-only sources in tests or fixtures (fixtures use
  hand-written toy rows).

## Review Focus

1. **No change for anyone who does not choose an order:** every existing scheduler, cardFlow, levelQueue
   and decks test passes unchanged; `newKey` absent = today's order (Tasks 10, 11).
2. **Determinism and batching:** ranks do not depend on how ids are chunked (fixed pack); starter membership
   is identical across calls and after a cache rebuild; ids match the fixture (Tasks 6–8, 13).
3. **Licence:** no bundled data added, attribution line on every starter deck, the hint never points to a
   download of unclear data (Tasks 12, 14, 15).
4. **Route security:** 401 without a session, bad bodies 400/413, no per-user data in answers, route walk and
   PWA fixture updated, `routes()` rows only (Task 8).
5. **Known skip and idempotent add:** known items never written; a second add writes nothing; `deckcfg`
   written only when none is live (Task 13).

---

### Task 1: Contract fixtures `docs/contracts/frequency/`

**Files:** Create `docs/contracts/frequency/README.md`, `new-order.json`, `deckcfg-new-order.json`,
`known.json`, `starter-deck-ids.json`, `starter-resolution.json`; modify `docs/contracts/README.md`
(folder row), `docs/contracts/overview.md` (`deckcfg:<deckId>` row gains `newOrder?`; the "no JSON fixture"
note now points to `deckcfg-new-order.json` for that field).

- [ ] **Step 1:** Hand-write `new-order.json` (cases: no keys = unchanged; ranks reorder; ties keep
  order; nulls after keyed in incoming order; duplicate entries share a key; level keys by `ord`),
  `deckcfg-new-order.json` (row → parsed order: absent, each shape, unknown `by`, `level` without
  `packId`, extra fields kept), `known.json` (no card, unreviewed, score 79, 80, a non-vocab card at 90,
  tombstoned card; schedules given as `stability`), `starter-resolution.json` (a toy lexicon of word
  entries with forms/readings incl. a homograph, a usually-kana word, a kana-only word, plus toy frequency
  rows with a reading, without one, unresolvable, two rows resolving to one entry; expected entry ids for
  size 3 and the 4×size row cap — use `size` override `3` documented as test-only).
- [ ] **Step 2:** Derive `starter-deck-ids.json` (jiten-frequency 500/1000/2000, a pack id with upper case,
  underscore and non-ASCII) with an implementation independent of the web code (a throwaway Python
  `-I` one-liner in the scratchpad: NFC, UTF-8 FNV-1a 32), and check the three spec examples. Record the
  derivation in the README. Commit `docs(contracts): frequency order and starter deck fixtures`.

### Task 2: `study/newOrder.ts` — shapes, parse, `orderNew`, session resolution

**Files:** Create `apps/web/src/lib/study/newOrder.ts`, `newOrder.test.ts`.

**Interfaces:**
```ts
export type NewOrder = { by: 'added' } | { by: 'frequency' } | { by: 'level'; packId: string };
export type SessionNewOrder = 'deck' | NewOrder;
export function parseNewOrder(raw: unknown): NewOrder | null; // null = absent/malformed (= added)
export function orderNew<T>(items: readonly T[], keyOf: (item: T) => number | null): T[];
export function resolveSessionOrder(session: SessionNewOrder, deckOrders: readonly (NewOrder | null)[]):
  { order: NewOrder; mixed: boolean };
```

- [ ] **Step 1: Failing tests:** `new-order.json`, the parse cases of `deckcfg-new-order.json`; resolution:
  explicit wins; `'deck'` with equal orders → that order; differing → added + `mixed: true`; all null → added.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): new-card order rule`.

### Task 3: `deckcfg:` rows carry `newOrder`

**Files:** Modify `apps/web/src/lib/study/deckSettings.ts`, `deckSettings.test.ts`; `store.ts` save helper
if `saveDeckSettings` takes fields (keep its signature additive).

- [ ] **Step 1: Failing tests:** a row with `newOrder` parses into `DeckSettings.newOrder` and is NOT in
  `extra`; serialize writes it only when set; a malformed `newOrder` is dropped (not kept in `extra`);
  `cardTypes` behaviour unchanged; the round trip keeps unknown fields (existing tests untouched).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): deck setting for the new-card order`.

### Task 4: `study/known.ts`

**Files:** Create `apps/web/src/lib/study/known.ts`, `known.test.ts`.

**Interface:** `export function knownEntries(cards: readonly StudyCard[], scheduleOf: (cardId: string) =>
Schedule | null): Set<number>` (vocab cards only, best card per entry, `cardScore >= MASTERY_THRESHOLD`);
header comment: "#68 adds a manual mark; extend this predicate, never fork it".

- [ ] **Step 1: Failing test:** `known.json`. **Step 2:** FAIL. **Step 3:** Implement (reuse `cardScore`).
  **Step 4:** gates PASS. **Step 5:** Commit `feat(study): known words predicate`.

### Task 5: Go — id-only word resolution in `lexicon`

**Files:** Modify `server/internal/lexicon/lexicon.go`; test `lexicon_best_test.go` (or the existing Best
tests' file).

**Interface:** `func (s Store) BestWordReadingID(ctx, language, form, reading string) (int64, error)`
(`ErrNotFound` as today); `Best`, `BestWord`, `BestWordReading` become thin wrappers that `Get` the id.

- [ ] **Step 1: Failing test:** for each existing Best/BestWord/BestWordReading case the ID variant returns
  the same entry's id (table reused), and `ErrNotFound` for the unresolved ones.
- [ ] **Step 2:** FAIL (undefined). **Step 3:** Refactor. **Step 4:** Go gate on `./internal/lexicon
  ./internal/levels ./internal/sentences` PASS (existing tests unchanged). **Step 5:** Commit
  `refactor(lexicon): resolve best words by id`.

### Task 6: Go — starter resolution and cache in `freq`

**Files:** Create `server/internal/freq/top.go`, `top_test.go`; modify `freq.go` (`PackInfo` gains
`ContentHash`; `Packs` selects it).

**Interfaces:**
```go
type Resolver interface { BestWordReadingID(ctx context.Context, language, form, reading string) (int64, error) }
type TopEntry struct { EntryID int64; Rank int }
// Top resolves the pack's first size distinct word entries by rank, then row position, stopping after
// 4*size rows; unresolved rows and already-taken entries are skipped.
func (s Store) Top(ctx context.Context, r Resolver, pack PackInfo, size int) ([]TopEntry, error)
// TopCache memoises Top(…, 2000) per (pack id, content hash) and slices it; safe for concurrent use.
type TopCache struct { /* mu, entries */ }
func (c *TopCache) Get(ctx context.Context, s Store, r Resolver, pack PackInfo, size int) ([]TopEntry, error)
```

- [ ] **Step 1: Failing tests:** `starter-resolution.json` (toy lexicon seeded through the existing
  importer helpers, toy freq rows through `Import` of a `freq-csv` testdata pack written to `t.TempDir()`);
  the row cap; cache: second call does not hit the resolver (counting fake), a re-import with changed rows
  (new content hash) recomputes; concurrent `Get` (`-race`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (`SELECT term, reading, rank FROM frequency WHERE pack_id = ?
  ORDER BY rank, rowid LIMIT ?` with the 4×size cap). **Step 4:** Go gate `./internal/freq` (+ `-race` on
  it) PASS. **Step 5:** Commit `feat(freq): starter deck resolution`.

### Task 7: Go — fixed-pack entry ranks in `lookup`

**Files:** Modify `server/internal/lookup/frequency.go`; test `frequency_ranks_test.go`.

**Interface:** `func (s Service) EntryRanks(ctx context.Context, language string, es []lexicon.Entry)
(pack *freq.PackInfo, ranks []int, err error)` — the first pack of `language` by priority; `ranks[i]` =
entry i's rank there (0 = none), using `frequencies` (same `freqGroups`/`BestHits` semantics).

- [ ] **Step 1: Failing tests:** two packs of one language, entries with data only in the second → rank 0
  (the pack is fixed, unlike `rankingRanks`); same answer when the entries are split in two calls; ja
  character entry → 0; no pack → nil pack; a usually-kana word ranked by its kana row.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (unlike lookups, errors are returned). **Step 4:** Go gate
  `./internal/lookup` PASS. **Step 5:** Commit `feat(lookup): entry ranks in the ranking pack`.

### Task 8: Go — routes and `packId` on frequency packs

**Files:** Create `server/internal/api/handlers_freq_ranks.go`, `handlers_freq_ranks_test.go`; modify
`handlers_freq.go` (+`packId`), `handlers_freq_test.go`, `api.go` (`routes()` rows; one `freq.TopCache` on
`server`), `apps/web/src/lib/pwa/sw/routes.fixture.json` (regenerate with `UPDATE_ROUTES_FIXTURE=1`;
both routes not cacheable), `docs/wiki/API-Routes.md` (`node scripts/gen-api-docs.mjs`),
`apps/web/src/lib/api/types.ts` (`FrequencyPack.packId`).

- [ ] **Step 1: Failing tests:** `GET /api/frequency-packs` has `packId`; ranks: 401 without token; 400 for
  0 and 501 ids and a missing language; 413 over 16 KiB; request order, unknown and other-language ids
  omitted, `pack: null` + `[]` without a pack; two users get byte-identical answers. Top: 401; 404 unknown
  and uninstalled pack; 400 `size=3`/missing; 200 entries in rank order with `rank` and EntryBase fields;
  second user identical. Route walk and PWA fixture tests fail until updated.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (`{"GET /api/frequency-packs/{id}/top", …, accUser, nil}`,
  `{"POST /api/entries/frequency-ranks", …, accUser, nil}`; body cap like `entries/bases`). **Step 4:** Go
  gate `./internal/api ./internal/freq ./internal/lookup` and the web route-fixture test PASS; API docs
  check PASS. **Step 5:** Commit `feat(api): frequency ranks and starter deck routes`.

### Task 9: Web loaders — ranks and level keys

**Files:** Create `apps/web/src/lib/api/frequency.ts` (`getFrequencyPacks()`, `getEntryRanks(language,
ids)`, `getStarterEntries(packId, size)`), `apps/web/src/lib/study/frequencyRanks.ts`,
`frequencyRanks.test.ts`, `apps/web/src/lib/study/levelKeys.ts`, `levelKeys.test.ts`.

**Interfaces:**
```ts
export function loadRanks(language: string, entryIds: readonly number[]):
  Promise<{ pack: { id: number; packId: string; name: string } | null; rankOf: (entryId: number) => number | null }>;
export function loadLevelKeys(scheme: Scheme): Promise<(entryId: number) => number | null>; // via loadLevelItems
export function clearFrequencyCaches(): void;
```

- [ ] **Step 1: Failing tests** (fetch mocked): chunks of 500, at most 2 in flight, only unknown ids
  requested again, `rank` absent → null, failure rejects (not cached); level keys: first level wins for an
  entry in two levels, uses the cached level items.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(web): frequency rank and level key loaders`.

### Task 10: Order in the deck and level queues

**Files:** Modify `apps/web/src/lib/study/scheduler.ts` (`BuildQueueOptions.newKey?: (card) => number |
null`, applied to `fresh` via `orderNew` after the existing sort), `cardFlow.ts` (`DeckSessionOptions.newKey`
passed through), `levelQueue.ts` (`BuildLevelQueueOptions.newKey?: (entryId) => number | null`: word plan
orders `[...fresh, ...virtual]`, character plan orders inside `freshWriting` and `freshVocab`), tests.

- [ ] **Step 1: Failing tests:** deck queue with ranks takes the best-ranked new cards under `newLimit` 2;
  reviews and due order unchanged; daily limit admission still per deck; without `newKey` every existing
  test passes unchanged (run them first, untouched); level word plan: virtual and real interleaved by rank;
  character plan: writing group still before recognition.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** targeted vitest + full `npm test` PASS.
  **Step 5:** Commit `feat(study): order new cards by a key`.

### Task 11: Session setup and session page

**Files:** Modify `apps/web/src/lib/study/session.ts` (+test: `newOrder` field, default `'deck'`, an old
stored setup without it still loads), create `apps/web/src/lib/study/newOrderView.ts` (+test: the options
for a mode/language/packs/schemes, the hint text, the "mixed" and "needs a connection" notes), modify
`apps/web/src/routes/study/+page.svelte` (select + hint), `apps/web/src/routes/study/session/+page.svelte`
(resolve the order, load ranks or level keys, pass `newKey`, fall back to added with the note on failure or
offline).

- [ ] **Step 1: Failing tests:** `newOrderView` options: no pack → no frequency option + hint "No frequency
  list is installed for Japanese. …"; level mode: only "Level order"/"Most frequent first", the latter only
  for word-unit schemes; schemes listed by name with `packId` values; a stored frequency order without a
  pack → added + note. `session.ts` round trip. A dom test of the setup select if the page has a dom test
  harness; otherwise the pure module carries the logic (component stays thin).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `check`, `test`, `build` PASS. **Step 5:** Commit `feat(web): choose the new-card order for a session`.

### Task 12: Deck settings — "New cards" select

**Files:** Modify `apps/web/src/lib/plugins/flashcards/decks/DeckSettingsView.svelte`,
`DeckSettingsView.dom.test.ts`; reuse `newOrderView.ts`.

- [ ] **Step 1: Failing dom tests:** choosing "Most frequent first" writes `deckcfg:<id>` with `newOrder:
  {by:'frequency'}` and keeps `cardTypes` and unknown fields; "By level: HSK 3.0 (words)" writes `{by:'level',
  packId:'hsk-words'}`; without a pack the option is absent and the hint shown; General works.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(web): new-card order in deck settings`.

### Task 13: Starter decks — pure modules and add with known skip

**Files:** Create `apps/web/src/lib/plugins/flashcards/decks/starterDecks.ts`, `starterDecks.test.ts`; modify
`systemDecks.ts` (`ownedStarterDeckId`), `types.ts` (`DeckSource` gains `{type:'frequency'; packId; size}`),
`store.ts` (`parseSource` accepts it), `addToDeck.ts` (+test: `exclude?: ReadonlySet<number>` → `known`
count; optional `deckSettingsRow` written only when no live `deckcfg:<id>` exists), `addToDeck.test.ts`.

**Interfaces:**
```ts
export const STARTER_SIZES = [500, 1000, 2000] as const;
export interface StarterDeck { kind: 'frequency'; packNumId: number; packId: string; packName: string;
  license: string; attribution: string; size: 500 | 1000 | 2000 }
export function starterDecks(packs: readonly FrequencyPack[], language: string): StarterDeck[];
export function ownedStarterDeckId(packId: string, size: number): string;
```

- [ ] **Step 1: Failing tests:** `starter-deck-ids.json`; decks only for the workspace language, pack
  priority order, three sizes each; `parseSource` keeps the frequency source and drops a bad one; add plan:
  known entries never written and counted, re-add writes nothing, the `deckcfg` row with `newOrder
  frequency` only when absent, existing `add-to-deck.json` cases unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(decks): starter deck ids and add with known words skipped`.

### Task 14: Starter decks in the decks view

**Files:** Create `apps/web/src/lib/plugins/flashcards/decks/StarterDecks.svelte`,
`StarterDecks.dom.test.ts`; modify `route.ts` (+test: `system/frequency/<packId>/<size>`),
`DeckList.svelte` (section above level decks), `SystemDeckDetail.svelte` (+dom test: frequency variant —
items with state, "N known words skipped", licence line with `/sources` link, Add to my decks, no Study
before adding, "Open my copy" after).

- [ ] **Step 1: Failing dom tests:** no pack for the language → the hint, no group; with Jiten → "Starter
  decks · Jiten frequency list" with three decks and "From Jiten frequency list · CC BY-SA 4.0"; expanding
  loads one size (mocked `getStarterEntries`); add pushes rows (mocked push) and reports "Added 3 words; 1
  you know was skipped"; a second add reports nothing new.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (components thin; logic in Tasks 9 and 13). **Step 4:**
  `check`, `test`, `build` PASS. **Step 5:** Commit `feat(web): starter decks in the decks view`.

### Task 15: Docs, wiki, README, sources and the real-app check

**Files:** Modify `docs/wiki/Flashcards-decks-limits-vacation.md` ("Starter decks", "New-card order" in
deck settings, client-implementer note on `deckcfg.newOrder` and `docs/contracts/frequency/`),
`docs/wiki/Flashcards-study-sessions.md` (session order, level sessions, offline fallback),
`docs/wiki/Data-and-licences.md` (starter decks are computed from installed packs; nothing extra bundled; the
licence verdicts in one paragraph), `docs/sources.md` ("Frequency data": starter decks and order use the
installed packs; wordfreq re-checked 2026-11-16, still local only), `README.md` (flashcards feature list),
`docs/contracts/frequency/README.md` (real-app check results), `docs/contracts/backup/README.md` only if
the check below finds plugin rows are not exported generically.

- [ ] **Step 1: Backup check:** confirm with an existing backup test or by reading `server/internal/backup`
  that every `qinqin-flashcards` row (incl. `deckcfg:*`) is exported; note the result in the Execution record.
- [ ] **Step 2: Real-app check (no browser):** scratch copy in the scratchpad, `go build` the server with the
  embedded web build, seed `jmdict` + `jiten-frequency` (+ `cedict`, `hsk-words` for zh), run on a free
  127.0.0.1 port (not 8080/8085/8300). curl/Python: register two users; `GET /api/frequency-packs` shows
  `packId`; `GET /api/frequency-packs/<jiten>/top?size=2000` timed (first call ≤ 2 s budget, second from
  cache) and its first 20 entries plausible (の, に, … resolved to JMdict entries); `size=500` is the prefix of
  `size=1000`; both users identical; ranks for 600 ids in two calls equal one-by-one answers; zh workspace:
  `pack: null`. Push the add plan of Top 500 for user A through `POST /api/sync/push` from a temporary
  vitest file in the scratch copy only (never committed), then a second plan is empty; user B sees no rows.
  Kill the server, delete the scratch copy.
- [ ] **Step 3:** Full Go gate `./...`, web `check`/`test`/`build`, Node 26 full vitest, `check-sources`,
  API docs check, `git status` clean. **Step 4:** Commit `docs: frequency order and starter decks`.

## Task dependencies

1 → 2 → 3; 1 → 4; 5 → 6 → 8; 7 → 8; 8 → 9 → 10 → 11 → 12; 4, 9, 13 → 14; all → 15. Tasks 2–4 (web) and
5–7 (Go) can run in parallel with two implementers.

## Contract notes (for `docs/contracts/`)

- `frequency/README.md` — `NewOrder` shapes in `deckcfg:*`, `orderNew`, session resolution, ranking pack,
  the two routes, known predicate, starter ids and resolution (Task 1, 15).
- `new-order.json` (Tasks 2, 10), `deckcfg-new-order.json` (Tasks 2, 3), `known.json` (Task 4),
  `starter-deck-ids.json` (Task 13), `starter-resolution.json` (Go, Task 6).
- `overview.md`: the `deckcfg:<deckId>` row gains `newOrder?`; `decks/README.md` links the frequency folder
  for the third system deck kind (`d-frq-…`).
- Android: read `deckcfg.newOrder`; call the two routes; apply `orderNew` only to new items; known = the
  same score rule (extended by #68's mark).

## Execution record

Built 2026-11-16 by one implementer, inline, task by task, in the order 1–15 (no parallel implementers, no
independent per-task reviewer: the orchestrator reviews the branch). One commit per task. Every task was
test-first: the test was written and run and seen failing (missing module/function, or the asserted
behaviour) before the implementation; failures seen were the expected ones.

**Rulings made while building**

- Ruling: `parseNewOrder` normalises a stored order to its shape (fields beyond `by`/`packId` dropped); a
  malformed `newOrder` is dropped, not kept in `extra` — one shape for every reader — cost if wrong: a newer
  client's extra field inside `newOrder` is lost on a read-modify-write by this version.
- Ruling: `added` is stored as no `newOrder` field (`saveDeckNewOrder`) and `null` compares equal to added in
  the `'deck'` resolution — absent = added everywhere — cost if wrong: none.
- Ruling: `StudySessionConfig.newOrder` is optional (absent = `'deck'`), and an unreadable stored order
  loads as `'deck'` instead of discarding the whole setup — old tabs keep their setup, existing session
  tests unchanged — cost if wrong: none.
- Ruling: the deck-settings "New cards" select is labelled "Order of new cards" under the heading "New
  cards" (the daily-limits editor already has a "New cards" field) — cost if wrong: wording.
- Ruling: decks-mode "By level" offers every installed scheme of the language, character schemes too (as
  the spec says); a word deck ordered by a character scheme gets no keys and stays in the order added —
  cost if wrong: one filter.
- Ruling: `TopCache.Get` answers a smaller size from the cached Top 2000 **exactly** as `Top(size)` would (it
  keeps each entry's row position and applies the `4 × size` row cap per size), so the contract fixture holds
  for the cache too; the first computation runs with `context.WithoutCancel` and is shared by concurrent
  callers; a failure is not cached — cost if wrong: none (tested with `-race`).
- Ruling: the session's ranks are asked only for "candidate new" entries (`candidateNewEntries`: never-reviewed
  cards of the selected decks; level entries lacking a reviewed card of a selected kind) — cost if wrong: a
  few ranks too many, never a wrong order.
- Ruling: a level order offline or failing uses a connection note too (`OFFLINE_NOTE`, the frequency text)
  — one note — cost if wrong: wording.
- Ruling: the decks list's starter group loads Top 2000 once per pack on expand and shows "N of M in your
  decks" for 500/1000 from its prefix (the sizes are nested); the detail page loads the exact size — cost if
  wrong: the list count can differ from the detail count only for a pack where fewer than 500 (1000) of the
  first 2000 (4000) rows resolve.
- Ruling: a failed frequency-pack list on the decks page is a quiet hint, not an alert — starter decks are
  an extra and an alert would compete with the page's real errors — cost if wrong: none.
- Ruling: `loadRawStudyData` also returns the live `deckSettings` (optional field, additive) so the add knows
  whether a live `deckcfg` row exists — cost if wrong: none.

**Deviations from the plan**

- Task 11: the async part of the session order (resolve against decks/installed data, load ranks or level
  keys, notes) is a new tested module `study/sessionOrder.ts` (+ `candidateNewEntries`) so the session page
  stays thin; the setup page has a dom test (the harness existed).
- Task 13/14: the starter detail is its own component `decks/StarterDeckDetail.svelte` (+ dom test) instead
  of a variant inside `SystemDeckDetail.svelte`, routed as `system-frequency` from `FlashcardsPage.svelte`;
  `SystemDeckDetail` and its tests are untouched. Its add has no target picker (always the owned copy) and a
  simple retry. `DeckDetail.svelte`'s "Copied from" moved into a tested `copiedFrom()` in `systemDecks.ts`
  (it had to learn the third source kind).
- Task 8: the Top route checks the size before the pack (an unknown pack with a bad size is 400); a
  non-numeric pack id is 404. `language` is lowercased and trimmed.
- Task 1: the overview's `deck:*` row also names `source: {type:"frequency", packId, size}` and `d-frq-…`;
  `decks/README.md` links the frequency folder.

**Backup check (Task 15 step 1):** `server/internal/backup/export.go` `writePluginData` exports every live
`plugin_data` row of the user (`WHERE user_id = ? AND deleted_at IS NULL`), so `deckcfg:*` (with `newOrder`),
the `d-frq-*` deck rows and their cards are in the archive; no contract change needed. Entry ids inside
cards are remapped on restore as before; `newOrder.packId` and `source.packId` are manifest ids and need no
remap.

**Real-app check (Task 15 step 2):** done as planned, results in `docs/contracts/frequency/README.md`
("Real-app check"): first Top 2000 1.46 s (1.26 s after a restart) within the 2 s budget, 0.10 s cached;
nested sizes; identical answers for two users and after a cache rebuild; 600 ranks batched = one-by-one; zh
`pack: null`; Top 500 add pushed (502 rows, 3 requests), second plan empty, other user sees nothing. The
push was driven by a temporary vitest file in a scratch copy of `apps/web` (never in the worktree). Server
killed, scratch copy deleted. **Finding:** the shared word resolution maps the kana rows `の` and `で` to the
usually-kana homographs 乃 and 出 (kana fallback ranks by priority), so the particles themselves are not in
the starter decks; this is the spec's homograph risk of reusing the level-word rule and is left as a
follow-up (a kana-only preference for kana rows would change level imports too).

**Gates (final):** full Go `./...` (proxy variables unset): gofmt clean, vet clean, 35 packages ok, only
`internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` failed (the known no-IPv6 sandbox failure);
`-race` on `./internal/freq` ok. Web: `npm run check` 0 errors, `npm test` 313 files / 4920 tests passed,
`npm run build` ok; Node 26 full vitest 313 files / 4920 tests passed; `node --test scripts/*.test.mjs`
91 passed; `check-sources` and `gen-api-docs --check` ok.

**Not verified:** no browser was used (by rule): the setup select, the deck-settings select, the starter
group and detail were checked with jsdom tests and the server routes with the real-app check, not by
looking at the pages; layout at phone width is not checked. A Chinese frequency order/starter deck was not
exercised end to end (no Chinese pack is installable here without unclear-licence data); the zh path is
covered by `pack: null` and the hint. Level-order sessions were tested in unit tests only, not against a
real HSK level. Performance of a ranks load for a very large deck (5,000 new cards) was not measured.


**Review fixes** (one fix wave after the independent review; test-first per finding, failures seen first):

1. Starter cache ignored dictionary installs: `TopCache` keys on (pack id, content hash, lexicon version =
   `lexicon.Store.CharactersVersion`); tests: a word installed after the first `Get` (freq) and a JMdict
   pack installed after the first GET (api) appear. Seen failing: the api test with an empty version.
2. Kana rows resolved to usually-kana homographs: `freq.StarterResolver` tries, for a kana row (no reading or
   reading = term, term all kana), `lexicon.Store.KanaOnlyWordID` (no written form, first reading exactly
   the term, priority > 0, highest priority) before `BestWordReadingID`; levels untouched (test asserts
   both rules). Ruling: priority > 0 is required — the real JMdict has kana-only, priority-less entries for
   こと (particle), なる, た, よう, れる that would otherwise displace 事, 成る, … — cost if wrong: a rare
   kana-only word without priority stays behind its kanji homograph. Fixture `starter-resolution.json`
   re-derived by hand with toy の/乃 and こと/事 entries; contract README and wiki updated. Real-data recheck:
   `で` is now the particle; `の` was already the particle entry (JMdict 1469800), whose search-only forms
   乃/之 make the entry base show 乃 — a display follow-up, not fixed here.
3. A panicking resolution left waiters hanging: the computation runs in `compute` with a deferred
   `close(done)` and delete-on-failure; a panic still reaches its caller, waiters get an error, the next
   `Get` recomputes (test with a panicking resolver; seen hanging first). `-race` ok.
4. Deck settings could show and save "added" while lists loaded or failed: `deckOrderControl` (pure, tested)
   keeps the select disabled on the stored order until packs and schemes are in, disables it with a hint
   when one failed, and shows an unavailable stored order as a disabled "(not available)" choice; dom tests.
5. Known words could be added with no study data: the add reloads the study history itself and computes the
   known words from it, and refuses with an error when that load fails; dom tests (failed first load, and a
   load that keeps failing: nothing pushed).
6. A ranking-pack switch mid-load wiped loaded chunks: `loadRanks` asks the dropped ids again (at most three
   rounds) and otherwise rejects "The frequency list changed while loading; try again."
8. Done: the route keeps its marshalled answer per (pack, size) under the full key (pack hash, lexicon
   version, size); a cached Top 2000 now answers in about 2 ms.
9. An unreadable `newOrder` (a newer client's) is kept verbatim in `extra` and survives a save; choosing an
   order (including added) replaces it. Fixture `deckcfg-new-order.json` malformed cases re-derived; README.
10. `deckOrdersOf` (tested) gives both the setup and the session page the orders of the selected decks that
   still exist. The new setup dom test passed before the change (the setup already prunes deleted decks
   from its selection); the unit test failed first.

Gates after the fixes: targeted Go (`freq`, `lexicon`, `levels`, `lookup`, `api`) ok, `-race ./internal/freq`
ok; full Go `./...` 35 ok, only the known `TestHostnameResolvingToEmbeddedFormIsRefused` failed; web check 0
errors, `npm test` 313 files / 4934 tests, build ok; Node 26 vitest 313 / 4934; `check-sources` and
`gen-api-docs --check` ok. Real-app recheck on a scratch server (jmdict + jiten-frequency, free port,
killed and deleted): first Top 2000 1.23 s, cached 0.002 s, Top 500 the prefix of Top 2000.

### Mutation check (orchestrator, after the fix wave)

Four mutants, each killed (then reverted):
- `orderNew` puts unranked items first: 4 tests fail.
- known predicate `>=` → `>` threshold: 1 test fails.
- starter deck id seed `top-N` → `topN`: 14 tests fail (fixture ids).
- session order never reports mixed decks: 2 tests fail.
