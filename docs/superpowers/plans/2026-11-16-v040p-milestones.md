# Weekly Milestones (issue #94) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model, one fix wave, whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it FAIL, implement,
> see it PASS.

**Goal:** Milestones (reviews, words studied, mature words, characters learned, streaks, days active, reading
hours, journal entries, level completions) derived from the event log and the replay of one workspace, shown once
in a card on home and Stats → Week, then listed in a history on Stats → Week; the seen state is one
`qinqin-flashcards` plugin row `milestone:<id>` per seen milestone (workspace row), synced, backed up, never
"unseen".

**Architecture:** Pure modules in `apps/web/src/lib/milestones/` — `catalogue.ts` (families, ids), `reached.ts`
(log families: one pass over reviews and events), `replayReached.ts` (mature, characters, levels: one sweep over
the weekly `Timelines`), `seen.ts` (row parse, write plan, pending list), `plan.ts` (card plan, history, week
items), `milestoneText.ts` (every string), `loadMilestones.ts` (the only I/O). `study/store.ts` parses `milestone:`
rows into the study data and gains `saveSeenMilestones`. Thin Svelte: `MilestoneCard.svelte`,
`MilestoneHistory.svelte`; `routes/+page.svelte` (home), `routes/stats/week/+page.svelte`,
`lib/weekly/WeekSummary.svelte` render them. **No server production change, no new route, no migration, no new
token rule, no new pull collection.**

**Tech stack:** SvelteKit 2 / Svelte 5, vitest (unit + jsdom). No new dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-16-v040p-milestones-design.md`.

**Branch / worktree:** `feature/v040p-milestones` at `/home/user/www/github/qinqin/.claude/worktrees/milestones`
(`<wt>`), cut from the collection branch `feature/v0.4.0-prep-2` (= `develop` after items 4 and 5 and the
provisional logo). Items 4 and 5 are already in the branch (re-read 2026-11-17, see the Execution record).
**Before Task 1** item 6 must be merged in too (the orchestrator merges the collection branch in). Check:
`git -C <wt> log --oneline` shows the item 6 merge; `apps/web/src/lib/eventPayloads.ts` exists and its `read` parser
gives `{bookId?, seconds}` and its `journal` parser `{entryId: string}`; item 6's `read` / `journal` payload
fixtures exist under `docs/contracts/` and `overview.md` "Gaps" no longer lists them; `study/store.ts` still parses
`goals:workspace` / `known:*` from `pluginData` and writes keyed rows with `pushKeyedRows`. If any is missing or
item 6 pinned a different shape, stop and report (Tasks 1 and 3 depend on it). Paths below are the built layout
(`lib/features/flashcards/...`). The orchestrator merges and pushes; never push.

## Gates

- Web (read exit codes, never behind `| tail`): `npm --prefix <wt>/apps/web ci` once; per task the targeted
  `cd <wt>/apps/web && npx vitest run <paths>` (fail first, then pass), then `npm --prefix <wt>/apps/web run check`
  and `npm --prefix <wt>/apps/web test`; `run build` in Tasks 8–10 and 12.
- Go: no production change. Task 1 runs `go test ./internal/backup` (the new remap case); ONE full Go gate before
  the last commit (the web build is embedded):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./... && go test -count=1 -p 2 -timeout 30m ./...'`
  (`gofmt -l` prints nothing; only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` may fail, IPv6).
- Node 26 full vitest once before the last commit:
  `cd <wt>/apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- No new route, no migration: the route walk (`route{}` rows), the PWA route fixture (no
  `UPDATE_ROUTES_FIXTURE=1` run), `auth/tokens-routes.json` (no token rule), `node scripts/gen-api-docs.mjs` output
  and `docs/wiki/API-Routes.md` stay as they are (their tests confirm); the migrations end at `039_packages.sql`.
  If a reviewer asks for a route or a typed collection (which would need migration 040, a pull collection in item
  5's round order, a `route{}` row with an access value, 401 and two-user isolation tests), stop and re-plan.
- One commit per task, explicit `git add <files>`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git status` clean after each commit.

## Global constraints

- Ids `<family>:<threshold>` and `level-complete:<ownedLevelDeckId(packId, level)>`; never renamed or removed.
- Reached = the first event (by `ts`, ties by id, `ts ≤ now`) at which the quantity reaches the threshold;
  "ever reached"; `reachedDay = dayOf(reachedAt)`; streak by date (the `dailyStreak` rule, vacation neutral).
- Scopes reused, never copied (homes: spec "The pure interface"): `isValidReview`, `classifySchedule`,
  `MASTERY_THRESHOLD`, `cellStates`, `buildSections`, `masteryGlyphs`, `readSeconds`, `vacationRuns` /
  `isVacationDay`, `ownedLevelDeckId`, `levelDecks`, `levelItems`, `timelinesFor` / `reviewsKey`, and item 6's
  `lib/eventPayloads.ts` parsers for `read` / `journal`.
- `read` counts by seconds alone (`bookId` may be missing after a restore); `journal` counts only a string `entryId`
  (the heatmap's `distinctBy` counts text values only), for `journal-entries` and for `days-active`.
- Feature switches from the `pluginStates` store when `status === 'ready'`: `featureEnabled(FLASHCARDS_ID |
  READER_ID)`, `pluginEnabled('qinqin-journal')`; otherwise no card.
- Seen = a live `milestone:<id>` row (key alone) ∪ the pending list. No client ever deletes or rewrites a live row.
- Home computes log families only; Stats → Week computes all families. Feature switches gate families.
- Per workspace. Strings only in `milestoneText.ts`. No toast, no animation, no sound.
- `localStorage` only for the pending list, every access in `try/catch`, keyed by user and workspace.

## Review Focus

1. **Never unsee**: seen by key alone, write only absent keys, `dataSkipped` as success, pending ∪ live, no
   delete path anywhere — Tasks 5, 7.
2. **Reached rule**: exact crossings, ties, fast clock, zone change, vacation, "ever reached" — Tasks 3, 4.
3. **Sweep equivalence**: the incremental mature / character / level sweep equals a snapshot recomputation
   (`masteryFromSchedules`, `classifySchedule`) at every point — Task 4.
4. **Backfill and card plan**: one `summary` card for a long history; dismiss marks every covered id — Task 6.
5. **Isolation**: rows of another workspace or user never read; pending list keyed by user and workspace; stale
   loads dropped on workspace switch — Tasks 5, 7, 9.
6. **Accessibility**: status container, heading, dismiss focus to `h1`, `<ol>` history, text not colour — Task 8.
7. **Performance**: no extra replay on the Week tab, no replay on home — Task 10.

---

### Task 1: Milestones contract fixtures

**Files:** Create `docs/contracts/milestones/README.md`, `catalogue.json`, `reached.json`, `seen-rows.json`,
`seen-merge.json`, `show-plan.json`; modify `docs/contracts/README.md` (folder row; web tests
`lib/milestones/{catalogue,reached,replayReached,seen,plan}.test.ts`; Go: the `backup/remap.json` case),
`docs/contracts/overview.md` ("Row-key conventions → Keyed rows" table row `milestone:<id>` — scope workspace,
shape `{version:1, id, seenAt, reachedDay, ...unknown kept}`, seen by key alone, never deleted, owner
`lib/milestones/seen.ts`, `study/store.ts`, pinned by `milestones/seen-rows.json`, `seen-merge.json`; the "Sync
model" sentence "The keyed study rows (`goals:workspace`, `known:*`, `vacation:*`)" gains `milestone:*`; "How the
folders fit" gains `milestones/`; "Study rules (links)" gains a line), `docs/contracts/backup/remap.json` (two
cases in the existing shape `{name, op: "pluginRow", maps: {workspaces: {"7": 12}}, input: {pluginId:
"qinqin-flashcards", workspaceId: 7, key, data}, expect: {drop: false, workspaceId: 12, key, data}, note}`: a
`milestone:reviews:1000` row and a `milestone:level-complete:<id>` row, key and data unchanged). No new `events`
case: the existing "read event: bookId through the book map, unknown book removed" case already pins the restored
shape this item counts.

- [ ] **Step 1:** README: copy the spec's catalogue table, the reached rule, the level rule, the seen rule and every
  Ruling verbatim; sync, offline and Android notes; "the summary stores nothing, the seen rows are the only state".
- [ ] **Step 2:** `catalogue.json` `{version:1, rule:"milestones/catalogue", families:[{family, thresholds, unit,
  requires, hanOnly}], idGrammar, cases:[{op:"id", family, threshold|packId+level, expect}, {op:"parse", id,
  expect}]}`; titles `{family: {one, other}}` with `{n}` / `{level}`. Derive a level id example by running
  `ownedLevelDeckId` from the web code in a scratch script (not committed) and cross-check it against
  `decks/system-deck-ids.json`.
- [ ] **Step 3:** `reached.json` cases `{name, note, history, now, language, vacation, enabled, reviews, events,
  cards, decks, timelines, chars?, levels?, expect:[{id, reachedAt, reachedDay}]}` (the spec's list). Derive every
  instant and day with Python `zoneinfo` and the study-day rule in a scratch script; state one hand check per case
  in its `note`. `expect` lists every reached id of the case (a missing id is a failure, an extra id too).
- [ ] **Step 4:** `seen-rows.json`, `seen-merge.json`, `show-plan.json` (shapes as in Tasks 5 and 6; `today`
  given; the backfill case has 20 reached ids over three years).
- [ ] **Step 5:** `python3 -m json.tool` each file (exit 0); `npx vitest run src/lib/contractsDocs.test.ts` PASS.
  Run the backup Go test under the lock (the Go gate's `flock … env -u … GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false`
  prefix, `go test -count=1 ./internal/backup`): it must PASS with the new cases (generic path; no Go code changes —
  this is a pinning test, record it as such). Commit `docs(contracts): milestones fixtures`.

### Task 2: `catalogue.ts`

**Files:** Create `apps/web/src/lib/milestones/catalogue.ts`, `catalogue.test.ts`.

**Interfaces:**
```ts
export const MILESTONE_KEY_PREFIX = 'milestone:';
export type MilestoneFamily = 'reviews' | 'words-studied' | 'words-mature' | 'characters-learned' | 'streak'
  | 'days-active' | 'reading-hours' | 'journal-entries' | 'level-complete';
export type Feature = 'flashcards' | 'reader' | 'journal' | null;
export interface FamilyDef { family: MilestoneFamily; thresholds: readonly number[]; unit: 'count' | 'days' | 'hours';
  requires: Feature; hanOnly: boolean; source: 'log' | 'replay' }
export const FAMILIES: readonly FamilyDef[];                 // catalogue order
export function milestoneId(family: Exclude<MilestoneFamily, 'level-complete'>, threshold: number): string
export function levelMilestoneId(packId: string, level: string): string   // via ownedLevelDeckId
export type ParsedId = { family: Exclude<MilestoneFamily, 'level-complete'>; threshold: number }
  | { family: 'level-complete'; deckId: string };
export function parseMilestoneId(id: string): ParsedId | null           // null = unknown to this client
export function enabledFamilies(opts: { flashcards: boolean; reader: boolean; journal: boolean; han: boolean }): Set<MilestoneFamily>
export function compareIds(a: string, b: string): number     // family order, then higher threshold first
```

- [ ] **Step 1: Failing tests:** `FAMILIES` equals `catalogue.json` (order, thresholds, flags); every id/parse case;
  `parseMilestoneId('reviews:0100')`, `'reviews:7'` (not a threshold), `'nope:1'` → null; level ids equal the decks
  fixture's; `enabledFamilies` per switch and `han`.
- [ ] **Step 2:** `npx vitest run src/lib/milestones/catalogue.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement. **Step 4:** PASS; `run check`, `test`. **Step 5:** Commit `feat(milestones): catalogue and ids`.

### Task 3: `reached.ts` — log families

**Files:** Create `apps/web/src/lib/milestones/reached.ts`, `reached.test.ts`.

**Interfaces:**
```ts
export interface Reached { id: string; at: number; day: string }       // at: epoch ms
export interface LogInputs {
  reviews: readonly ReviewEvent[];            // the study history's (canonical merge, outbox included)
  events: readonly StudyEvent[];              // the workspace's full event log (read, journal)
  cards: readonly StudyCard[]; deckIds: ReadonlySet<string>;
  day: StudyDay; vacation: readonly Run[]; now: number; families: ReadonlySet<MilestoneFamily>;
}
/** reviews, words-studied, streak, days-active, reading-hours, journal-entries; memoised per (reviewsKey, events array, now's day). */
export function reachedFromLog(input: LogInputs): Reached[]
```

- [ ] **Step 1: Failing tests:** every log-family case of `reached.json`; property test (seeded): for each count
  family the reached instant is the earliest event whose prefix count reaches the threshold (brute force over
  prefixes); the streak family agrees with `dailyStreak(prefix…).best` at the reached day and the day before;
  disabled families yield nothing; a review after `now` is ignored; memo returns the same array for an equal
  reloaded log (`reviewsKey`); a `read` event with no `bookId` counts its seconds; a `journal` event with a numeric,
  empty or missing `entryId` moves neither `journal-entries` nor `days-active`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (item 6's `lib/eventPayloads.ts` parsers, `isValidReview`,
  `readSeconds`, `isVacationDay`, the `dailyStreak`
  run rule — extract a shared `streakRuns(days, vacation)` helper from `study/exp.ts` if needed, with its existing
  tests unchanged). **Step 4:** PASS + gates. **Step 5:** Commit `feat(milestones): milestones reached in the event log`.

### Task 4: `replayReached.ts` — mature, characters, levels

**Files:** Create `apps/web/src/lib/milestones/replayReached.ts`, `replayReached.test.ts`.

**Interfaces:**
```ts
export interface LevelInput { packId: string; level: string; unit: 'word' | 'character';
  entryIds: readonly number[];                 // word levels (levelItems)
  cells?: readonly string[][] }               // character levels: each cell = its glyph forms (variants), as levelMastery
export interface ReplayInputs {
  cards: readonly StudyCard[]; deckIds: ReadonlySet<string>; timelines: Timelines;
  day: StudyDay; now: number; families: ReadonlySet<MilestoneFamily>;
  chars: readonly CharRow[] | null;            // Han universe; null = no characters family
  levels: readonly LevelInput[];
}
/** words-mature, characters-learned, level-complete; one merged sweep per timelines object. */
export function reachedFromReplay(input: ReplayInputs): Reached[]
```

- [ ] **Step 1: Failing tests:** every replay case of `reached.json` through `givenTimelines`; equivalence property
  (seeded, 200 cards, 3 000 reviews, variant glyphs): after each sweep point the running mature count equals
  `classifySchedule` over `scheduleAt(timeline, t + 1)` of every scoped card, the learned-cell count equals
  `cellStates(masteryFromSchedules(...))`, and a level's learned members equal a snapshot count; a lapse after a
  crossing keeps the milestone; a card in no deck, a reverse card and a tombstoned card never count; no new
  `replayStats.timelines` for an already built timelines object.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates (full web suite). **Step 5:** Commit
  `feat(milestones): mature words, characters and levels reached in the replay`.

### Task 5: `seen.ts` and the study store

**Files:** Create `apps/web/src/lib/milestones/seen.ts`, `seen.test.ts`; modify `apps/web/src/lib/study/store.ts`
(in `fetchStudyData`'s `pluginData` loop, beside `GOALS_KEY` / `KNOWN_PREFIX`: parse live and tombstoned
`milestone:` rows of the workspace into `StudyData.seenMilestones`; copy it in `loadStudyDataWith` into
`StudyHistory`; export `saveSeenMilestones` next to `pushKeyedRows`), `apps/web/src/lib/study/types.ts`
(`StudyData.seenMilestones?`), `store.test.ts`.

**Interfaces:**
```ts
export interface SeenMilestone { id: string; seenAt: string | null; reachedDay: string | null }
export function parseSeenRows(rows: readonly { key: string; data: unknown; deletedAt: string | null }[]): Map<string, SeenMilestone>
export function seenRow(m: Reached, seenAt: Date): { key: string; data: { version: 1; id: string; seenAt: string; reachedDay: string } }
/** Rows to push: only ids with no live row; never a delete. */
export function seenWritePlan(mark: readonly Reached[], live: ReadonlyMap<string, SeenMilestone>, now: Date): { key: string; data: unknown }[]
export function seenIds(live: ReadonlyMap<string, SeenMilestone>, pending: readonly SeenMilestone[]): Set<string>
export function readPending(userId: number, workspaceId: number): SeenMilestone[]     // [] on any storage error
export function addPending(userId: number, workspaceId: number, items: readonly SeenMilestone[]): void
export function prunePending(userId: number, workspaceId: number, live: ReadonlyMap<string, SeenMilestone>): void
// study/store.ts
export async function saveSeenMilestones(workspaceId: number, rows: readonly { key: string; data: unknown }[]): Promise<void>
```
`saveSeenMilestones` uses `pushKeyedRows` with `chunk: rows.length` (one request) and no `knownAt` (no client
writes a `milestone:` tombstone). `pushChunks` turns both a skip and a network failure into `PartialPushError`: with
`skipped > 0` it is success (skipped = another device wrote it first; refused cannot be retried usefully), with
`skipped === 0` it rethrows (the caller keeps the pending list). `notifyWrite` fires either way (study caches
drop; `onStudyWrite` listeners reload).

- [ ] **Step 1: Failing tests:** every `seen-rows.json` / `seen-merge.json` case; `seenWritePlan` never returns an
  id with a live row, never a tombstone; pending storage keyed by user and workspace (user 1 never reads user 2's),
  throwing `localStorage` → `[]` and no throw; store: a `milestone:` row of another workspace or a user-global one is
  ignored; a typed-family key is still never study state; `saveSeenMilestones` sends one `POST /api/sync/push` with
  `pluginData` items `pluginId: "qinqin-flashcards"`, the workspace id, `updatedAt`, no `deletedAt`, treats
  `dataSkipped: n` as success and a rejected request as failure; `loadStudyDataWith` passes `seenMilestones` through.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates (full web suite: store consumers).
  **Step 5:** Commit `feat(milestones): seen rows and pending list`.

### Task 6: `plan.ts` — card plan, history, week items

**Files:** Create `apps/web/src/lib/milestones/plan.ts`, `plan.test.ts`.

**Interfaces:**
```ts
export type CardPlan = { kind: 'none' }
  | { kind: 'recent'; items: Reached[]; ids: string[] }
  | { kind: 'summary'; count: number; named: Reached[]; more: number; ids: string[] };
export function unseenReached(reached: readonly Reached[], seen: ReadonlySet<string>): Reached[]   // newest first
export function milestoneCard(unseen: readonly Reached[], today: string): CardPlan
export interface HistoryItem { id: string; day: string; isNew: boolean }
export function milestoneHistory(reached: readonly Reached[], live: ReadonlyMap<string, SeenMilestone>,
  pending: readonly SeenMilestone[], day: StudyDay): HistoryItem[]   // unknown ids left out
export function milestonesInWeek(history: readonly HistoryItem[], monday: string): HistoryItem[]
```

- [ ] **Step 1: Failing tests:** every `show-plan.json` case; `ids` always equals every unseen id; `recent` needs
  ≤ 3 items all on or after `today − 6`; history ordering (day desc, family order, threshold desc); a seen milestone
  no longer reached stays with its stored day; invalid stored day falls back to the derived one, then to `seenAt`'s
  learner day; week items by civil date.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `feat(milestones): card plan and history`.

### Task 7: `milestoneText.ts` and `loadMilestones.ts`

**Files:** Create `apps/web/src/lib/milestones/milestoneText.ts`, `milestoneText.test.ts`,
`apps/web/src/lib/milestones/loadMilestones.ts`, `loadMilestones.test.ts`.

**Interfaces:**
```ts
export function milestoneTitle(id: string, levels: ReadonlyMap<string, string>, locale?: string): string | null  // "1,000 reviews", "HSK 2 complete"
export function cardHeading(plan: CardPlan, locale?: string): string     // "Milestone reached", "You have reached 14 milestones"
export function reachedOn(day: string, locale?: string): string          // "reached 3 November 2026"
export interface MilestonesView { plan: CardPlan; history: HistoryItem[]; titles: Map<string, string> }
export function loadMilestones(workspaceId: number, opts: { scope: 'home' | 'week'; now?: number;
  week?: { timelines: Timelines; chars: CharRow[] | null; levels: LevelInput[] } }): Promise<MilestonesView>
export function markSeen(workspaceId: number, plan: CardPlan, reached: readonly Reached[]): Promise<void>
```
`loadMilestones` reads `loadStudyHistory` (`study/history.ts`), `loadWorkspaceEvents` (`lib/events.ts`), the
feature switches (`pluginStates`: `featureEnabled`, `pluginEnabled('qinqin-journal')`; not `ready` → plan `none`),
the vacation runs and the pending list; flushes pending rows (failure keeps them); `scope: 'home'` passes only log
families. The Week scope also loads the levels (`getSchemes`, `levelDecks(schemes, language)`, `getSchemeEntries` /
`fetchSchemeCharacters`; the Week tab does not load them today) and takes the universe and cards from
`loadCharacterMapData` as `loadWeekCharacters` does. `markSeen` adds
the ids to the pending list first, then `saveSeenMilestones`, then prunes on success.

- [ ] **Step 1: Failing tests:** titles of every family (singular/plural, `Intl` grouping, `en`), unknown id →
  null, the date never shifted by `TZ=Pacific/Kiritimati` / `America/Adak`; loader (mocks): plugin states not
  `ready` → `none`; journal plugin off → no `journal-entries`; home never builds
  timelines or fetches characters; a switched-off feature drops its families; pending flushed once and kept on a
  rejected push; `markSeen` offline → ids pending and the next load shows no card; a workspace switch mid-load is
  dropped by a sequence guard (the caller's), each call reads only its workspace's pending list.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `feat(milestones): texts and loading`.

### Task 8: `MilestoneCard.svelte` and `MilestoneHistory.svelte`

**Files:** Create `apps/web/src/lib/milestones/MilestoneCard.svelte`, `MilestoneCard.dom.test.ts`,
`MilestoneHistory.svelte`, `MilestoneHistory.dom.test.ts`.

**Props:** `MilestoneCard {view: MilestonesView; ondismiss: () => void}`; `MilestoneHistory {items: HistoryItem[];
titles: Map<string, string>}`.

- [ ] **Step 1: Failing dom tests:** nothing rendered for `none`; `recent` lists each title and date; `summary`
  names three and "and N more" plus the link to `/stats/week#milestones`; container `role="status"`, a `<section>`
  labelled by its `h2`; icon `aria-hidden`; Dismiss calls `ondismiss` and focus lands on the document's `h1`; the
  link also calls `ondismiss`; history is an `<ol>` newest first, "New" as text; empty state text.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (theme tokens, no animation; note 3:1 checks in the commit body).
  **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): milestone card and history`.

### Task 9: Home and Stats → Week

**Files:** Modify `apps/web/src/routes/+page.svelte` (card above the widgets), `apps/web/src/routes/stats/week/+page.svelte`
(card above the summary, `#milestones` history section, passes the tab's timelines, universe and levels),
`apps/web/src/lib/weekly/WeekSummary.svelte` (a "Milestones" line from `milestonesInWeek`), their dom tests
(`routes/stats/week/page.dom.test.ts`, a new `routes/home.dom.test.ts` — no home page test exists,
`lib/weekly/WeekSummary.dom.test.ts`), `lib/weekly/loadWeek.ts` only to expose the built timelines of `loadWeek`
and the universe/cards of `loadWeekCharacters` (no second replay; `timelinesFor` is memoised by `reviewsKey`).
The Week page already listens to `onStudyWrite` / `onEventLogChange` / `onContextStale`; the milestones load joins
that reload and its sequence guard.

- [ ] **Step 1: Failing tests:** home shows the card for log families and hides it after dismiss (the push is sent
  with the covered ids); Week shows replay-family cards; the history lists seen and new items; the week's
  "Milestones" line shows only items of the shown week and follows the week links; workspace switch reloads and
  drops a stale answer; `onStudyWrite` for the workspace reloads (another tab's dismiss); no workspace → nothing.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): milestones on home and Stats week`.

### Task 10: Performance guard

**Files:** Create `apps/web/src/lib/milestones/perf.test.ts`.

- [ ] **Step 1:** 5 000 cards, 50 000 seeded reviews, 2 000 read and 300 journal events: `reachedFromLog` once and
  again for an equal reloaded log (memo hit); `reachedFromReplay` on timelines already built adds 0 to
  `replayStats.timelines`; generous bounds (log pass 2 s, sweep 5 s on CI hardware). Write it, run it against a
  deliberately rebuilding stub (`timelinesFor([...reviews], …)` inside the loader) to SEE IT FAIL, then the real code.
- [ ] **Step 2:** gates + `run build`. **Step 3:** Commit `test(milestones): no extra replay`.

### Task 11: Wiki, README and contracts docs

**Files:** Create `docs/wiki/Milestones.md`; modify `docs/wiki/_Sidebar.md`, `docs/wiki/Home.md`,
`docs/wiki/Weekly-summary.md` (history section, the week's milestones line), `docs/wiki/Stats-and-heatmap.md`,
`docs/wiki/Your-data.md` (seen milestones are in the personal backup),
`README.md` (features list); re-check Task 1's contract rows against the code.

- [ ] **Step 1:** `npx vitest run src/lib/wikiDocs.test.ts src/lib/contractsDocs.test.ts` baseline PASS; add the page
  and links; run again (PASS). The page: the catalogue table, what each number means, "ever reached", per
  workspace, shown once (dismiss), the catch-up card, history, where replay families appear, offline, sync,
  feature switches, backup; no notifications.
- [ ] **Step 2:** gates. **Step 3:** Commit `docs: milestones`.

### Task 12: Real-app check and final gates

- [ ] **Step 1: Real-app check (no browser).** Copy `<wt>` to a scratch dir (`rsync -a --exclude node_modules
  --exclude .git`), `npm --prefix <copy>/apps/web ci && run build`, copy the build where the server embeds it, build
  the server under the Go lock, run it with a scratch data dir on a free `127.0.0.1` port (not 8080/8085/8300).
  With Python: first user and a second user, workspaces A (zh) and B; `PUT /api/me/time-zone` Europe/Berlin; card
  rows for 12 vocab cards (typed `cards` items in `POST /api/sync/push`, item 4); 120 `review` events over 8
  consecutive days, `read` events (2 × 40 min, one without `bookId`), one `journal` event with a string `entryId`
  and one with a numeric one, via `POST /api/events/batch` (or `events` of `POST /api/sync/push`). A
  temporary vitest file in the copy only
  (`QINQIN_CHECK_URL=… npx vitest run src/realapp.check.test.ts`) fetches the log, rows and zone history and asserts
  with the pure modules: `reviews:100`, `words-studied:10`, `streak:3`, `streak:7`, `reading-hours:1`,
  `journal-entries:1` reached on the expected Berlin days, `journal-entries:10` not reached by the numeric id,
  reading counted with and without `bookId`; plan `summary`/`recent` as expected. Then push the seen rows
  (`POST /api/sync/push`) → `GET /api/sync/pull?v=2&collections=pluginData&workspace=A` pages show them; a second
  push of one key with an older `updatedAt` → `dataSkipped: 1` and the row still live; a different key from
  "device 2" → both live (union); the second user's pull never shows them and a push into A is 404. Account export
  (`POST /api/account/export`, then `GET /api/account/export/{ticket}`) has the `milestone:` rows in
  `plugin-data/NNNNNN.jsonl`; restore into the second user (`POST /api/account/restore`, then
  `POST /api/account/restore/{token}`) → rows in the remapped
  workspace. Never commit the file. Kill the server, delete the copy,
  binary, data dir and scripts.
- [ ] **Step 2:** Full web gates (`run check`, `test`, `run build`), Node 26 full vitest, ONE full Go gate.
  `git status` clean.
- [ ] **Step 3:** Fill the Execution record below. Commit `docs(milestones): execution record`.

## Task dependencies

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Tasks 3 (if `streakRuns` is extracted), 4 and 5 touch shared
study modules: run the full web suite there. One implementer at a time (shared web gates).

## Contract notes (for `docs/contracts/`)

- `milestones/README.md` — catalogue, reached rule, level rule, seen rule, card plan, history; fixtures
  `catalogue.json` (Task 2), `reached.json` (Tasks 3, 4), `seen-rows.json`, `seen-merge.json` (Task 5),
  `show-plan.json` (Task 6). Web tests; Go decodes only the `backup/remap.json` cases (unchanged code path).
- `overview.md` — row key `milestone:<id>` (workspace, `qinqin-flashcards`), study-rules link.
- Android: rows in `pluginData`; its own replay for the replay families (fixtures give schedules); its local
  database replaces the pending list; never delete a `milestone:` row.

## Execution record

(filled by the builder: further adaptations, deviations as Rulings, test-first evidence per task, real-app check,
final gate exit codes, what was not verified, review fixes, mutation check.)

Re-read of spec and plan against the built items 4 and 5 (2026-11-17, docs only, before item 6 is merged):

- Adaptation: worktree path is `/home/user/www/github/qinqin/.claude/worktrees/milestones`, base
  `feature/v0.4.0-prep-2`; items 4 and 5 are in the branch, item 6 (`lib/eventPayloads.ts`, `read` / `journal`
  fixtures) is the remaining precondition of Task 1.
- Adaptation: storage ruling confirmed against item 4 — `goals:workspace`, `known:*`, `vacation:*` stayed keyed
  `qinqin-flashcards` plugin rows (`overview.md` "Keyed rows", `study/store.ts`); `milestone:*` follows them. No
  typed table, no migration (next free would be 040), no route, no token rule, no PWA route fixture change.
- Adaptation: `pushStudyRows` does not exist; keyed rows are written by the private `pushKeyedRows` in
  `study/store.ts`; `saveSeenMilestones` is exported beside it. `pushChunks` reports a network failure as
  `PartialPushError` with `skipped === 0`, a skip or refusal with `skipped > 0` (sum of `dataSkipped` and
  `dataRefused`), and stops after the first partial chunk.
- Adaptation: the parse goes into `fetchStudyData`'s `pluginData` loop (beside `GOALS_KEY`, `KNOWN_PREFIX`) and must
  be copied in `loadStudyDataWith` (fields are passed through one by one); `milestone:` is no `legacyFamily` prefix.
- Adaptation: the study pull is item 5's paged pull v2 (`pullStudy`, `V2_STUDY_COLLECTIONS` with `pluginData` and
  `pluginStates`, `tombstones=1`): tombstones arrive and read as not seen.
- Adaptation: backup plugin lines are `{pluginId, workspaceId|null, key, data, version, updatedAt, modifiedAt|null}`;
  the `remap.json` `pluginRow` case shape is `{name, op, maps, input, expect: {drop, workspaceId, key, data}, note}`.
- Adaptation: `read` = `{bookId, seconds}` and `journal` = `{entryId: string}` (item 6); after a restore of an
  unknown book `bookId` is removed (`remap.go`) and the seconds still count; a non-string `entryId` counts for
  neither `journal-entries` nor `days-active` (server `distinctBy` counts `json_type = 'text'` only).
- Adaptation: helper homes — `ownedLevelDeckId`, `levelDecks`, `levelItems` in
  `lib/features/flashcards/decks/systemDecks.ts`; `classifySchedule` in `lib/stats/wordStates.ts`; `readSeconds` in
  `lib/stats/readingTime.ts`; `CharRow` in `lib/api/types.ts`; `StudyDay` in `lib/time/studyDay.ts`.
- Adaptation: switches — flashcards and reader are core features (`featureEnabled` in `lib/features/index.ts`), the
  journal is still the plugin `qinqin-journal` (`pluginEnabled` in `lib/plugins/index.ts`).
- Adaptation: the Week tab loads timelines (`loadWeek`) and the universe (`loadWeekCharacters` →
  `loadCharacterMapData`) but no levels; the Week scope of `loadMilestones` loads schemes and members itself
  (`lib/api/schemes.ts`, cached). No home page dom test exists; Task 9 creates `routes/home.dom.test.ts`.
- Adaptation: Android reads level members from `levels.<packId>` packages (item 5).
- Ruling: features are read only when `pluginStates.status === 'ready'`, else no card — a missing state row reads
  as on and would flash a card of a switched-off feature — cost: no card while the states are unavailable.
- Ruling: `saveSeenMilestones` pushes all rows in one chunk; `PartialPushError` with `skipped > 0` is success,
  with `skipped === 0` a failure that keeps the ids pending — retrying a refused row cannot succeed — cost: a
  refused row is not seen on other devices (one extra card there).
- Ruling: a `read` event without `bookId` counts; a `journal` event without a string `entryId` does not — agrees
  with the heatmap and the reading totals — cost: an old numeric-id journal event earns nothing.

Build (2026-11-17, Tasks 1–11; Task 12 is the orchestrator's):

- Adaptation: item 6 merged (`9f0be5c`), but `lib/eventPayloads.ts` has **builders** only (`readPayload`,
  `journalPayload`), no parsers. `read` is counted through `readSeconds` (`stats/readingTime.ts`, which already
  pins the consume rule of `events/payloads.json`); the one missing reader, `journalEntryId(payload)` (a non-empty
  string or null), lives in `lib/milestones/reached.ts` — `eventPayloads.test.ts` pins that module's exports to
  exactly one builder per written type, so a parser there would break item 6's contract test.
- Adaptation: the streak rule is shared, not copied: `study/exp.ts` exports `streakRuns(days, vacation)` (the run
  length each review date ends); `dailyStreak` takes its best run from it (its tests unchanged, one new test).
- Adaptation: `docs/contracts/overview.md` also lists `milestones/` in "Read order" (between `weekly/` and
  `reader/`): `contractsDocs.test.ts` requires every folder there.
- Ruling: Task 1 adds `lib/milestones/fixtures.test.ts` (rule names, unique case names, id grammar, level ids
  against `decks/system-deck-ids.json`, plan ids = every unseen id) — the contracts coverage guard needs every
  fixture named by a test in the commit that adds it; the behaviour tests follow in Tasks 2–6 — cost: one small
  extra test file.
- Ruling: `reached.json` gives `enabled` as the feature switches `{flashcards, reader, journal}` (the families
  follow from `enabledFamilies` and the language) and `expect` lists every reached id of both the log and the
  replay families; each test file checks its own families — the fixture pins the whole derivation of a case, as
  Android will run it — cost: the log and replay tests filter `expect`.
- Ruling: the fixtures were derived by a scratch Python reference (not committed) that computes the replay
  families from **snapshots** at every distinct timeline instant (no incremental state) and the days with
  `zoneinfo`; every case's `note` holds a hand check — an implementation-independent oracle for the incremental
  sweep — cost: none.
- Ruling: character milestones count every live card of the mastery kinds, without a deck scope, as the
  character map and the weekly "characters learned" do; mature words keep the deck scope of the decks view —
  one meaning per number across the app — cost: none.
- Adaptation: backup is pinned twice: the two `pluginRow` cases of `backup/remap.json` and a Go pinning test
  `server/internal/backup/milestones_test.go` (export: two live rows, the tombstone left out; restore: rows in
  the remapped zh / ja workspaces, key and data unchanged). Both pass without Go code changes (generic path).
