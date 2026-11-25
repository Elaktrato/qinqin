# Study modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This run: executed inline by the builder, task by task (the project's process for this item; no subagents).

**Goal:** every "Study" button opens one small modal (summary, today line, card-type chips, Start, Study all,
"Advanced settings") that starts from a setup saved per workspace on the account; the long page moves to
`/study/advanced`.

**Architecture:** a new workspace keyed row `study-setup` holds the setup (pure parse/repair in
`lib/study/setup.ts`), owned per session by a runes store `StudySetups` with a per-user, per-workspace
localStorage cache. The page's counting is extracted into a pure `lib/study/setupPlan.ts` and its loading into
`lib/features/flashcards/setup/setupData.svelte.ts`, used by both the modal and `/study/advanced`. The modal is
mounted once in the root layout and opened through `session.studyModal`; the running session keeps its per-tab
sessionStorage copy.

**Tech Stack:** SvelteKit SPA (Svelte 5 runes), vitest + jsdom, Playwright e2e, Go 1.26 (`server/internal/keyed`).

**Spec:** `docs/superpowers/specs/2026-11-25-study-modal-design.md` (approved 2026-11-25).

## Global Constraints

- State per record 0009: no module-level state; the store and the opener live on `Session`; tests use
  `lib/testing/context.ts`.
- Folders per record 0004: the modal and its loader in `lib/features/flashcards/`; pure logic in `lib/study/`;
  `lib/ui` gains nothing domain-specific.
- Errors per record 0001: visible failures only through `errorText(err, fallback)`.
- Every string in `apps/web/src/lib/i18n/messages/en.json`.
- Contracts: the keyed family `study-setup`, scope `workspace`, in `docs/contracts/keyed/families.json`, the
  server's and the web's tables; a fixture `docs/contracts/study/setup.json` decoded by a Go and a web test; a
  `docs/contracts/CHANGELOG.md` entry; `overview.md` row-key table and `README.md` folder table updated.
- No backwards compatibility: `qinqin.study.cardTypes` and `qinqin.study.extraTypes` are ignored and no longer
  written; one line in `docs/releases/NEXT.md`.
- Android shell: the back button closes the modal (Dialog/Sheet are on the dismiss stack); the phone form is the
  `Sheet` below `FRAME_PHONE_BREAKPOINT` (720 px); no browser-only assumptions.
- Accessibility: the dialog has a title; focus starts on Start; chips are labelled checkboxes; Escape closes.
- The modal contains only: one summary line, one "this session" line, the chips (plus the warnings, errors and the
  unreadable-rows notice under them), Start and Study all, and "Advanced settings".
- e2e stays green; `study.spec.ts` and `offline.spec.ts` change deliberately; a new spec covers the modal.
- Commits: conventional, one per task, ending with the blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A synced setup naming a deck deleted on another device, or a level pack uninstalled: the modal repairs that
   field alone, says so in one line, and writes nothing until the learner changes something (Task 2 tests
   `repairSetup` per field; Task 6 tests that opening the modal sends no PUT).
2. Offline (the installed app with no network): the modal opens from the cached setup and Start works; a change
   made offline is kept on the device and shown as not saved, never silently dropped (Task 3 tests a failed save;
   e2e `offline.spec.ts` starts from the modal offline).
3. A slow load that lands after the learner toggled a chip must not put the old value back (Task 3: a read begun
   before a write is dropped).
4. Two workspaces: switching the header workspace while the modal is open shows the other workspace's setup, and a
   chip toggled just before the switch is written to the workspace it was toggled in (Task 3 keys every write by
   the workspace id captured at the click; Task 6 test).
5. The last selected chip cannot be unchecked, including when the only selected kind is an opt-in one (Task 6).

---

## File structure

| File | Responsibility |
| --- | --- |
| `docs/contracts/study/setup.json`, `study/README.md` § Study setup | the row's shape, parse, repair and write cases |
| `server/internal/keyed/families.go`, `families_test.go`, `setup_contract_test.go` | accept `study-setup` in workspace scope; decode the setup fixture |
| `apps/web/src/lib/sync/keyed.ts` | `ROW_FAMILIES` gains the family |
| `apps/web/src/lib/study/setup.ts` (+ test) | `StudySetup`, `parseSetup`, `defaultSetup`, `withSetup`, `repairSetup`, `setupDeckIds`, `setupKinds`, `setupSessionConfig` |
| `apps/web/src/lib/study/setupStore.svelte.ts` (+ test) | `StudySetups`: cache, refresh, update per workspace |
| `apps/web/src/lib/study/studyModal.svelte.ts` (+ test) | `StudyModalState`: the one opener |
| `apps/web/src/lib/context/session.svelte.ts` | owns `setups` and `studyModal`; sign-out drops the cache |
| `apps/web/src/lib/study/setupPlan.ts` (+ test) | the counts, warnings and guidance of a setup (extracted from the page) |
| `apps/web/src/lib/features/flashcards/setup/setupData.svelte.ts` (+ test) | loads study data, schemes and level entries for the current workspace |
| `apps/web/src/lib/features/flashcards/setup/StudyModal.svelte` (+ dom test), `studyModalView.ts` (+ test) | the modal and its pure view (lines, chips) |
| `apps/web/src/routes/+layout.svelte` | mounts the modal once, signed in and unrestricted |
| `apps/web/src/routes/study/+page.svelte` | opens the modal and replaces the URL with `/` |
| `apps/web/src/routes/study/advanced/+page.svelte` (+ dom test) | the moved page |
| `apps/web/src/lib/study/session.ts` | per-tab running session only (`from` added; `DEFAULT_CONFIG` removed) |
| `apps/web/src/lib/study/cardTypesMemory.ts` (+ test) | deleted |
| readers: `FlashcardsWidget.svelte`, `decks/studyStart.ts`, `DeckList.svelte`, `DeckDetail.svelte`, `SystemDeckDetail.svelte`, `pwa/prepareOffline.ts`, `pwa/prepareRuntime.ts`, `workspace/workspaceDelete.ts` | read the saved setup |
| `face/SessionTop.svelte`, `routes/study/session/+page.svelte`, `routes/study/scheduling/+page.svelte` | entry points |
| `apps/web/e2e/tests/study-modal.spec.ts`; `study.spec.ts`, `offline.spec.ts` | e2e |
| `docs/wiki/Flashcards-study-sessions.md`, `Finding-your-way.md` (and other pages naming `/study`) | user docs |

## Rulings

- Ruling: the contract lives in `docs/contracts/study/setup.json` — it is the study's data and the study folder
  already pins its rows — cost if wrong: a file move.
- Ruling: the row is `{version: 1, decks, mode, schemeId, levelName, cardTypes, unchecked, newLimit, reviewLimit,
  newOrder, typeOrder}`; `cardTypes` holds only the non-opt-in kinds, opt-in kinds come from the decks minus
  `unchecked` — the spec's fields plus `version` like every keyed row; a newer version is read leniently and its
  version kept on write (the nav-layout rule) — cost: a newer client's new semantics could be overwritten field-wise.
- Ruling: parse is per field; a missing or bad field is that field's default (`decks: "all"`, `mode: "decks"`,
  `cardTypes: ["vocab"]`, `unchecked: []`, `newLimit: 20`, `reviewLimit: 100`, `newOrder: "random"`,
  `typeOrder: "mixed"`) — 4.4b: never throw the whole setup away — cost: none known.
- Ruling: an explicit deck list keeps unknown ids in the row and drops them only when resolving; all gone → "all"
  with the note — a deck that comes back (restore) is still chosen — cost: a stale id lingers in the row.
- Ruling: "This session: N cards" = min(due, reviewLimit) + min(new, newLimit) of the uncapped plan the page counted
  today (daily limits, burying, vacation applied) — the spec's "under the saved limits"; one plan pass, not two —
  cost: an off-by-companion estimate when companions fill the new cap.
- Ruling: an opt-in chip (Reverse, Cloze) in the modal shows only when a selected deck switches it on and toggles
  only `unchecked`; the page's "applies to all decks" switch stays as it was — writing deck settings from the modal
  would make the chip vanish and change decks the learner never opened — cost: two places behave differently.
- Ruling: a change is written as the repaired setup plus the change, merged over the stored row (unknown members
  kept); the row is re-read before the write — 4.4b; another device's unknown members survive — cost: one GET per
  change.
- Ruling: a failed save keeps the value in memory and in the device cache, and the modal/page shows "Not saved"
  under the chips; the next change or the next open retries by writing again — anti-goal "losing a choice
  silently", and offline must work — cost: a device offline for days may later overwrite a newer change made
  elsewhere (last write wins).
- Ruling: the cache is localStorage `qinqin.study.setup.<userId>.<workspaceId>` holding the row's data; removed at
  sign-out and with the workspace — the modal opens from it without waiting — cost: a stale first paint for one
  refresh.
- Ruling: the modal's counts use the session's study cache (`loadStudyHistory`), so a warm cache paints at once; a
  cold start shows the chips (from the cached setup) and a "Loading…" line in place of the two count lines —
  §6 loading state — cost: none.
- Ruling: the chips are native checkboxes styled as chips inside the modal; no `lib/ui` component until a second
  user — §6, none of `lib/ui` fits and one user is no reason for a base component — cost: a later extraction.
- Ruling: the opener is `session.studyModal` (`StudyModalState`, in `lib/study/`) — per session, so a sign-out
  closes it — cost: none.
- Ruling: `/study` opens the modal and replaces the URL with `/` (home) — the spec's "My call"; replace keeps Back
  from bouncing to `/study` — cost: none.
- Ruling: the running session's per-tab config gains `from` (the path Start was pressed on); the finished session's
  Back ("Done") goes there with the modal closed; the other Back buttons (empty, error, no workspace) and the
  session's close go there and open the modal — 4.4a/4.6: ending early or finding nothing should offer the setup,
  a finished session should not (the spec's call) — cost: one more state to test.
- Ruling: the scheduling page's back link goes to `/study/advanced` ("Back to advanced settings") — the scheduling
  link now lives there; 4.6 listed it while it lived on `/study`; returning to a modal over the scheduling page would
  leave the learner on a page they meant to leave — cost: one more click to the modal.
- Ruling: "Back to study" on `/study/advanced` goes to `?from=<path>` (a same-origin path; anything else is `/`)
  and opens the modal; the modal's Advanced link adds the current path — survives a reload — cost: none.
- Ruling: limits on the Advanced page are saved on `change` (blur or Enter), only when 1..999; an invalid value
  shows the existing limit message and is not saved — a PUT per keystroke would race — cost: a typed value lost
  when the tab closes mid-edit.
- Ruling: "All decks" on the Advanced page is a checkbox above the deck list; checked = `decks: "all"`; unchecking
  it, or unticking one deck while it is on, turns it into the explicit list of the decks still ticked — the spec's
  live "all" — cost: none.
- Ruling: the contract version goes to 2 (`api.ContractVersion`), the changelog entry says "(contract 2)" — a new
  family is a change a client must follow (`version/README.md`) — cost: none.
- Ruling: stored data: the old local keys are not migrated (owner, 2026-11-24); NEXT.md says the remembered card
  types reset to the defaults once — cost: one reselection per workspace.
- Ruling: the modal is mounted for every signed-in, unrestricted page, whatever the flashcards switch — only
  flashcards pieces open it, and a switched-off feature hides pages only (record 0006) — cost: none.

## Tasks

### Task 1: Contract and server family

**Files:** create `docs/contracts/study/setup.json`; modify `docs/contracts/study/README.md`,
`docs/contracts/keyed/{families.json,README.md}`, `docs/contracts/{overview.md,README.md,CHANGELOG.md}`,
`docs/contracts/version/README.md` if it names the number, `server/internal/keyed/families.go`,
`server/internal/api/version.go`, `apps/web/src/lib/sync/keyed.ts`; tests
`server/internal/keyed/setup_contract_test.go`, `families_test.go` (fixture-driven), `apps/web/src/lib/sync/families.contract.test.ts` (fixture-driven).

**Interfaces:** Produces: key `study-setup` (exact, workspace); fixture `{version, rule: "study/setup", key,
defaults, parse: [{name, row, expect}], repair: [{name, row, context: {decks, schemes|null, language}, expect,
notes}], write: [{name, stored, change, expect}]}`.

- [ ] Step 1: add the family and the cases ("the study setup of a workspace" accept; "the study setup without a
  workspace" scope; "study-setup2" unknown) to `families.json`; write `TestStudySetupContract` (every example's
  key passes `Check` in workspace scope and fails with `ErrWrongScope` user-global; every `row`/`expect` is a JSON
  object under 256 KiB).
- [ ] Step 2: run `go test ./internal/keyed/` and the web families test: FAIL (fixture lists 14 families).
- [ ] Step 3: add `{"study-setup", false, ScopeWorkspace}` to `Families` and the web `ROW_FAMILIES`; bump
  `ContractVersion` to 2 with the changelog entry; docs tables.
- [ ] Step 4: Go gate on `./internal/keyed/ ./internal/api/` and the web test: PASS.
- [ ] Step 5: commit `feat(keyed): study-setup family and contract`.

### Task 2: The setup module

**Files:** create `apps/web/src/lib/study/setup.ts`, `setup.test.ts` (decodes `setup.json`).

**Interfaces:** Produces:
```ts
export const STUDY_SETUP_KEY = 'study-setup';
export interface StudySetup { version: number; decks: 'all' | string[]; mode: StudySessionMode; schemeId: number | null;
  levelName: string | null; cardTypes: StudyCardKind[]; unchecked: OptInKind[]; newLimit: number; reviewLimit: number;
  newOrder: SessionNewOrder; typeOrder: TypeOrder }
export type SetupNote = 'levelGone' | 'decksGone' | 'typesGone';
export function defaultSetup(): StudySetup;
export function parseSetup(raw: unknown): StudySetup;
export function withSetup(stored: unknown, next: StudySetup): Record<string, unknown>;
export function repairSetup(setup: StudySetup, ctx: { deckIds: readonly string[] | null; schemes: readonly Pick<Scheme,'id'|'language'|'levels'>[] | null; language: string }): { setup: StudySetup; notes: SetupNote[] };
export function setupDeckIds(setup: StudySetup, decks: readonly { id: string }[]): string[]; // general + decks for 'all'
export function setupKinds(setup: StudySetup, enabled: ReadonlySet<OptInKind>, language: string): StudyCardKind[];
export function setupSessionConfig(setup: StudySetup, deckIds: readonly string[], kinds: readonly StudyCardKind[], opts: { studyAll?: boolean; seed: number; from: string }): StudySessionConfig;
```
- [ ] Step 1: tests: every fixture case (`parse`, `repair` with notes, `write` keeps unknown members and a newer
  version); `setupKinds` = the old `effectiveKinds` rule (vocab default; opt-in when enabled and not unchecked;
  language filter); `setupDeckIds('all')` includes a deck created later; an explicit list drops unknown ids.
- [ ] Step 2: run `npx vitest run src/lib/study/setup.test.ts`: FAIL (module missing).
- [ ] Step 3: implement. `repairSetup` with `schemes: null` (not loaded) leaves the level alone; `deckIds: null`
  leaves the decks alone.
- [ ] Step 4: PASS. Step 5: commit `feat(study): the saved study setup`.

### Task 3: The store and the opener on the session

**Files:** create `lib/study/setupStore.svelte.ts` (+ `setupStore.test.ts`), `lib/study/studyModal.svelte.ts`
(+ test); modify `lib/context/session.svelte.ts`, `lib/workspace/workspaceDelete.ts` (+ its test),
`lib/context/app.test.ts` or `session` tests for the sign-out drop.

**Interfaces:** Produces:
```ts
export interface StudySetupsDeps { load(ws: number): Promise<unknown | null>; save(ws: number, data: unknown): Promise<void>;
  local(): Storage | null; user(): number | null; alive(): boolean }
export class StudySetups { constructor(d: StudySetupsDeps);
  of(ws: number): { setup: StudySetup; raw: unknown; loaded: boolean; saveError: unknown | null };
  refresh(ws: number): Promise<void>; update(ws: number, next: StudySetup): Promise<void>; forget(): void }
export function setupCacheKey(user: number, ws: number): string; // 'qinqin.study.setup.<u>.<ws>'
export class StudyModalState { readonly open: boolean; show(): void; hide(): void }
// Session: readonly setups: StudySetups; readonly studyModal: StudyModalState
```
- [ ] Step 1: tests: `of` answers the cache at once (`loaded: false`); `refresh` replaces it and writes the cache;
  `update` paints at once, re-reads, PUTs `withSetup(fresh, next)`; a load begun before an update is dropped; a
  failed save keeps the value and sets `saveError`; another user's cache is never read; `forget` removes the keys;
  a disposed session writes nothing; `StudyModalState` show/hide; deleting a workspace removes its cache key.
- [ ] Step 2: FAIL. Step 3: implement; Session wires `keyedData(ws).find/put` and calls `forget()` on `signOut`.
- [ ] Step 4: PASS (+ `stateModel.lint.test.ts`). Step 5: commit `feat(study): the session owns the saved setup`.

### Task 4: Every reader uses the saved setup; the old memory goes

**Files:** modify `lib/study/session.ts` (+ test: `from`, no `DEFAULT_CONFIG` fallback reader beyond the session),
`decks/studyStart.ts` (+ test), `DeckList.svelte`, `DeckDetail.svelte`, `SystemDeckDetail.svelte` (+ dom tests),
`FlashcardsWidget.svelte` (+ dom test), `pwa/prepareOffline.ts`, `prepareRuntime.ts` (+ test); delete
`lib/study/cardTypesMemory.ts` and its test.

**Interfaces:** Consumes Task 2/3. Produces:
`deckSessionConfig(setup: StudySetup, deckId, kinds, from, seed?)`, `levelSessionConfig(setup, schemeId, levelName, from, seed?)`,
`sessionKinds(setup: StudySetup, deckIds, settings, language): StudyCardKind[]`; `PrepareDeps.setup: () => StudySetup` replaces `config`, `tabTypes`, `remembered`, `choices`.
- [ ] Step 1: tests: a one-off deck start writes the per-tab config with the saved limits and never calls
  `setups.update`; the widget counts the saved setup's kinds (an unchecked Reverse is not counted); offline
  preparation plans the setup's decks and kinds (`"all"` = every deck).
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `refactor(study): read the saved setup everywhere`.

### Task 5: The plan of a setup and its data

**Files:** create `lib/study/setupPlan.ts` (+ test), `lib/features/flashcards/setup/setupData.svelte.ts` (+ test).

**Interfaces:** Produces:
```ts
export interface SetupPlanInput { setup: StudySetup; deckIds: string[]; kinds: StudyCardKind[]; cards; reviews; decks;
  deckSettings; weights; ctx: StudyContext; language: string; skip?: ReadonlySet<string>;
  level: { scheme: Scheme | null; entries: EntryBase[]; loading: boolean; error: string; schemesLoaded: boolean; schemeError: string } }
export interface SetupPlan { counts: {due:number; fresh:number}; allCounts: {due:number; fresh:number}; session: number;
  byKind: Record<StudyCardKind, number>; companions: number; warnings: string[]; guidance: string; noDailyLimit: boolean;
  levelUnit: LevelUnit; levelEntryTotal: number }
export function planSetup(input: SetupPlanInput, now: Date): SetupPlan;
// setupData: createSetupData(session) → { status, decks, cards, reviews, deckSettings, weights, ctx, vacations,
//   schedulingLabel, schemes, schemesLoaded, schemeError, levelEntries, levelLoading, levelError, workspaceId,
//   language, load(ws, lang), loadLevel(schemeId, level), refresh() }
```
- [ ] Step 1: tests ported from the page's count/guidance tests: deck due/new, the caps of "this session", the
  level counts, stroke-less glyphs, warnings, guidance texts, vacation (no counts), `noDailyLimit`.
- [ ] Step 2: FAIL. Step 3: implement by moving the page's derivations. Step 4: PASS.
  Step 5: commit `refactor(study): the setup's counts as a tested module`.

### Task 6: The modal and its entry points

**Files:** create `setup/StudyModal.svelte`, `setup/StudyModal.dom.test.ts`, `setup/studyModalView.ts` (+ test);
modify `routes/+layout.svelte`, `routes/study/+page.svelte` (replaced), `FlashcardsWidget.svelte`, `DeckList.svelte`,
`face/SessionTop.svelte`, `routes/study/session/+page.svelte` (+ dom test), `en.json`, `lib/ui/lint/pages.ts`.

**Interfaces:** Consumes Tasks 2–5. Produces `summaryLine(...)`, `todayLine(...)`, `visibleChips(setup, enabled, language): {id, label, checked, locked}[]`, `toggleChip(setup, id, enabled, language): StudySetup`, `safeFrom(raw: string | null): string`.
- [ ] Step 1: dom tests: opens as a dialog titled "Study" with focus on Start; phone width renders the sheet; chips
  only of the language (es: no Writing, no Tone); Reverse only when a selected deck enables it; the last chip is
  locked; a toggle calls `setups.update` with the captured workspace; opening writes nothing; Start writes the
  per-tab config with `from` and goes to `/study/session`; Study all; vacation replaces both lines; nothing to
  study disables Start; the fallback note; Escape closes; Advanced goes to `/study/advanced?from=…`; `/study`
  opens the modal and replaces to `/`; session Back/close open the modal on `from`, Done does not.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat(flashcards): the study modal`.

### Task 7: `/study/advanced`

**Files:** create `routes/study/advanced/+page.svelte`, `page.dom.test.ts` (moved and rewritten from
`routes/study/page.dom.test.ts`); modify `routes/study/scheduling/+page.svelte`, `lib/ui/lint/pages.ts`, `en.json`.
- [ ] Step 1: tests: every control writes the setup (limits on change, orders, mode, scheme/level, deck boxes,
  All decks, card types, opt-in switch writes all decks and `unchecked`), no Start, no deck create/rename/delete,
  per-deck switches, scheduling and mastery links, "Back to study" → `from` + modal.
- [ ] Step 2: FAIL. Step 3: implement on `setupData` and `planSetup`. Step 4: PASS. Step 5: commit
  `feat(study): the full setup moves to /study/advanced`.

### Task 8: Rename and delete on the decks page

**Files:** modify `decks/DeckList.svelte`, `DeckList.dom.test.ts`, `en.json` (reuse `study.decks.*`).
- [ ] Step 1: tests: Rename inline (empty name refused), Delete with the same confirmation, General has neither.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat(flashcards): rename and delete decks in the list`.

### Task 9: e2e

**Files:** modify `e2e/tests/study.spec.ts`, `offline.spec.ts`; create `e2e/tests/study-modal.spec.ts`.
- [ ] Step 1: the modal → Start flow; a toggled chip restored after a reload and in a second browser context;
  Advanced → change the new-card limit → Back to study → the modal shows it; the phone sheet at 360 px.
- [ ] Step 2: run the spec on the old build path: FAIL. Step 3: fix what it finds. Step 4: full suite PASS 3×.
  Step 5: commit `test(e2e): the study modal`.

### Task 10: Docs and gates

**Files:** `docs/wiki/*` naming `/study`, `docs/releases/NEXT.md`, `docs/architecture/0009-web-state-model.md`
(the session owns the setup), this plan's Execution record.
- [ ] Gates: Go targeted + full `./...` + `gofmt -l`; `npm run check` 0 errors; build; full vitest under Node 26;
  e2e 3×; `node --test scripts/*.test.mjs`; `node scripts/gen-api-docs.mjs --check`.
- [ ] Commit `docs: the study modal`.

## Execution record

(Filled in as the tasks run.)
