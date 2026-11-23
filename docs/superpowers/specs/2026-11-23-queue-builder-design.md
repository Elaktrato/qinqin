# One queue builder for deck and level sessions (#175) — design

**Status:** built on `feature/hb-queue-builder` (collection branch `feature/hardening-batch`, part of #166). Plan:
`docs/superpowers/plans/2026-11-23-queue-builder.md`. Contract: `docs/contracts/cards/session-queue.json` and the
"Session queue" section of `docs/contracts/cards/README.md`.

Android ports the study planners (#38), so the part every session shares, admitting candidates through the
session caps and the daily limits and splitting queue and reserve, must be one algorithm with one fixture. The
study data layer is rebuilt later (#193, on top of #174 and this item); the builder is therefore a pure TS module
whose every input is passed in (no store, no session storage, no clock).

## Today: every place that builds a session queue

| Place | Module | Used by |
|---|---|---|
| Deck session | `cardFlow.ts` `deckSessionPlan` (`buildQueue` for the real cards, `planCompanions`, then `admit()` twice) | session page (decks mode), setup page counts (`deckSessionItems`, normal and Study all), offline preparation (`pwa/prepareOffline.ts`) |
| Level session | `levelQueue.ts` `buildLevelPlan` → `buildWordPlan` / `buildCharacterPlan` → `admitPlan` (`admit()` twice) | session page (levels mode), setup page counts (`levelPlanCounts`, normal and Study all) |
| Counts | `dueCounts.ts` `dueCounts` (`buildQueue` twice), `leftToday` (`queueCandidates` + `admit`) | decks view numbers (`deckStats.ts`), "left today" (`deckLimits.ts`, the home widget) |
| Plain queue | `scheduler.ts` `buildQueue` (`queueCandidates` + `admit`) | the deck plan and `dueCounts` |

"Study all" is not a separate place: it is a flag on the deck and level planners, set by the setup page's
**Study all** button. A deck's **Study** button (decks view, `studyStart.ts`) starts an ordinary deck session.
There is no "custom" session and no suspend state; a word's removed kinds (`skipKinds`) are the only per-card
exclusion besides burying. The server builds no queue (it stores limits rows and events only), so there is no Go
side.

### How they differ

| Rule | Deck session | Level session | Counts |
|---|---|---|---|
| Session caps | `newLimit`/`reviewLimit`, floored, non-finite → 0 (inline) | same (`cap()` copy in `levelQueue.ts`) | `dueCounts`: given or `UNLIMITED` 1 000 000; `leftToday`: none |
| Daily limits | `limitsOf(ctx, deck)` per existing deck | same; a virtual item counts against `general` | `dueCounts`: off unless `applyDailyLimits`; `leftToday`: on |
| **Study all** | caps = `STUDY_ALL_LIMIT`; `buildQueue` runs with `ctx.limits` **blanked** (`workspace: null, decks: {}`), which falls back to the **default 20 new / 200 reviews per deck**, then `admit()` with unlimited limits | caps = `STUDY_ALL_LIMIT`, unlimited limits | — |
| Study all, setup count | `deckSessionItems` with the blanked context (same default fallback) | `levelPlanCounts` with the blanked context: **default 20/200 applied**, while the level session itself is unlimited | — |
| Vacation day | empty | empty | empty |
| Burying | inside the planner (`buriedNow`): buried cards and companion keys leave before the limits | outside: the page passes `excludeEntries` (`buriedLevelEntries`) and `levelSessionItems` filters again | inside (`prepare`) |
| Removed kinds (`skipKinds`) | honoured for real cards and companions | **not honoured**: a character level plans writing for a character whose writing card the learner removed, and grading it creates the card again | honoured |
| Card types | `kinds`, tone only for Chinese, opt-in kinds need a deck switch | word levels vocab only; character levels vocab and writing (writing gated a learner day after recognition) | `kinds` + opt-in switches |
| Due order | due instant, ties by card id | word levels: due instant, ties by entry id; character levels: due instant, ties by level order | as deck |
| New order | real new by `createdAt`/id or the session key, then companions in planning order | word: real new by entry id, then virtual in level order, or the session key; character: writing group then recognition group | as deck |
| Reserve | companions only (real new cards past the cap never are), unbounded | every new item past the cap, at most `backfillLimit(newLimit)` (`reserve` option) | — |
| `backfillLeft` | `backfillLimit(capNew)`: Study all = 2 000 000 | computed by the session page: Study all = `STUDY_ALL_LIMIT` (1 000 000) | — |
| Unreadable rows (#167) | invisible (not in `cards`); never written by planning | invisible; a virtual item for an entry whose card row is unreadable is planned, and grading it takes `freshCardId` | invisible |
| Session mix (#132) | applied by the session page after the plan (`mixFlowQueue`, vocab first) | same, vocab first off | — |
| Day counts | `dayCountsCached` called twice | once | once |
| Constants | `STUDY_ALL_LIMIT` imported from `session.ts` | `STUDY_ALL_LIMIT` from `session.ts`, `UNCAPPED`, inline virtual id instead of `virtualLevelId` | `UNLIMITED`; `GENERAL_DECK_ID` imported from `store.ts` by pure `sessionOrder.ts` and `grade.ts` |

## Design

### The builder (`apps/web/src/lib/study/sessionQueue.ts`, pure)

Inputs are injected: candidates in queue order, the limit rows and vacation flag of the context
(`Pick<StudyContext, 'limits' | 'vacationToday'>`), today's day counts, the session caps and the Study all flag.

```ts
admitSession({ candidates, ctx, counts, caps, studyAll }): { inSession: Set<id>, inAllowance: Set<id>, left }
buildSessionQueue({ entries, ctx, counts, caps, studyAll, reserveSize? }): { queue, reserve, backfillLeft }
sessionBackfill(newLimit, studyAll): number
```

Rules (pinned by `session-queue.json`):

1. **Vacation day:** nothing is admitted; queue and reserve are empty.
2. **Caps:** `cap(x)` = `floor(x)` for a finite `x`, at least 0; non-finite → 0. **Study all** replaces both caps
   with `NO_LIMIT` (1 000 000) and every deck's daily limits with unlimited; nothing else changes (vacation,
   burying, kinds, removed kinds, order, the reserve rule).
3. **Admission:** `admit()` of `scheduler/daily-limits` unchanged: candidates in order; `continuing` takes only
   the session review cap; `review` and `new` need room in every existing deck of the card and the session cap.
   `inSession` is that pass; `inAllowance` the same pass with no new-card cap (the review cap kept, so reviews
   are the same in both); `left` the pass without any session cap.
4. **Queue** = the entries whose id is in `inSession`, in candidate order.
5. **Reserve** = the entries in `inAllowance` and not in `inSession` (always new items), in candidate order, at
   most `reserveSize` (default `backfillLeft`).
6. **`backfillLeft`** = `NO_LIMIT` for Study all, else `backfillLimit(newLimit)` = `max(30, 2 · cap(newLimit))`.

`NO_LIMIT` and `cap` live in `limits.ts` (with `limitsOf` and `existingDecksOf`, moved from `scheduler.ts` and
re-exported there); `GENERAL_DECK_ID` moves to `types.ts` (re-exported by `store.ts`); `STUDY_ALL_LIMIT`,
`UNCAPPED`, `UNLIMITED` and the two `cap()` copies are deleted. `backfillLimit` and `skipKindsByEntry` move into
`sessionQueue.ts` (re-exported by `cardFlow.ts`), so `levelQueue.ts` no longer imports `cardFlow.ts` or
`session.ts` for them.

### The planners on the builder

- **Deck** (`deckSessionPlan`): leaves out what may not be shown (as today), lists the real candidates with
  `queueCandidates` (no admission), admits them once with `admitSession` to know which words have a queued real
  card (the opt-in `exclude` of `planCompanions`), plans the companions, then `buildSessionQueue` over real and
  companion entries. One `dayCountsCached` call. `buildQueue` is no longer used by it.
- **Level** (`buildLevelPlan`): the word and character plans build their candidates as today and call
  `buildSessionQueue` (virtual items count against `GENERAL_DECK_ID`); `LevelPlan` gains `backfillLeft`, which the
  session page uses instead of computing its own. The word plan uses `virtualLevelId`.
- **Counts:** `buildQueue` becomes `queueCandidates` + `admitSession`; `dueCounts` lists candidates once and
  counts the admitted ones by bucket; `leftToday` is `admitSession(...).left`. `levelPlanCounts` plans once with
  `NO_LIMIT` caps and splits due and new by bucket.
- **Setup page:** the Study all numbers pass `studyAll: true` to the same planners instead of a blanked context.

The session mix (#132) is unchanged and still applied after the plan.

## Rulings

- Ruling: **Study all ignores every daily limit, including the 20/200 defaults, in both modes and in the setup
  numbers** — the button promises "every due review and new card" (wiki), and the level path already did this;
  the deck path's blanked context fell back to the defaults by accident — cost if wrong: a learner without limit
  rows who presses Study all in a deck with more than 20 new cards now gets all of them (that is the promise).
- Ruling: **Study all is a flag of the builder, never a rewritten context** — one place decides it, so the
  two modes cannot drift again — cost: none.
- Ruling: **the reserve is every new item the daily limits allow past the session cap, in queue order, at most
  `backfillLeft`, in both modes** — deck sessions held companions only and no bound, level sessions every new
  item. A real new card is in the reserve only when the session cap refused it, and then every later new item
  (all companions) is refused too, so no virtual item is in the queue and the reserve is never drawn: nothing
  changes for learners. Nothing beyond `backfillLeft` can ever be drawn, so the bound is invisible too — cost:
  `deck-session.json` reserve lists that held real cards would change (none do).
- Ruling: **`backfillLeft` for Study all is `NO_LIMIT` in both modes** (deck had 2 000 000, level 1 000 000) —
  either is more than any session — cost: none.
- Ruling: **level sessions honour a word's removed kinds (`skipKinds`)** — a character level re-planned a
  writing card the learner had removed, and grading it brought the card back; deck sessions and counts already
  honour it — cost: a learner who removed writing for a character and still wanted it in level sessions must add
  it back (the deck page's card types do that).
- Ruling: **candidate order stays per planner** (due ties by id in decks, by entry id or level order in levels;
  new order per mode) — the order sources differ (createdAt vs level order) and both are pinned by their own
  fixtures; the builder takes candidates in order and never reorders — cost: Android implements two candidate
  listings (already specified in `cards/` and `levels/`).
- Ruling: **burying of level sessions stays with the caller (`excludeEntries`)** — the level rule (a buried
  vocab or writing card hides the entry) is already equivalent per item, and moving it would change the
  planner's input without changing any result; #193 rebuilds the data layer around it — cost: none.
- Ruling: **unreadable rows (#167) need no builder rule** — they are absent from `cards`, planning writes
  nothing, and a created card takes `freshCardId`; the contract says so in one line — cost: none.
- Ruling: **no Go test** — the server builds no queue — cost: none until a server planner exists.

## What changes for learners

1. **Study all in a deck session** includes every new card and due review; before, without own limit rows, it
   stopped at 20 new and 200 reviews per deck (fewer when some were already studied today).
2. **The Study all numbers on the setup page** (both modes) count the same session Study all starts.
3. **Character levels** no longer plan a writing card the learner removed for that character.

Everything else (queue contents, order, the mix, burying, the reserve in practice) is unchanged.

## Testing

- `sessionQueue.test.ts`: the builder's rules, and `session-queue.json` decoded.
- `studyAll.test.ts`: one Study all behaviour — the same words in a deck session and a word-level session give
  the same counts with and without limit rows, and the setup counts equal the session.
- Existing fixtures stay green: `cards/deck-session.json`, `cards/session-mix.json`,
  `levels/character-level-queue.json`, `scheduler/daily-limits.json`.
- An import test: `levelQueue.ts`, `sessionQueue.ts`, `limits.ts`, `sessionOrder.ts`, `grade.ts` and `cardFlow.ts`
  import neither `./store` nor `./session`.

## Out of scope

The study data layer (#193), error display (#168), the session mix itself (#132), candidate order changes.
