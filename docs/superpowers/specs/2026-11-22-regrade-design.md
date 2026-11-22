# Go back and change a misclicked grade (#131) — design

Issue: #131 "flashcards: go back to the previous card and change a misclicked grade". No owner comments; the
open questions are decided below (Ruling lines). This is a **shared rule**: replay, statistics, the heatmap,
backups and the Android client (#38) must all ignore a replaced review the same way.

## Today

- A review is an append-only `review` event `{cardId, mode, grade, meta?}` with a client ULID
  (`docs/contracts/events/`). A card's schedule, XP, streak, the daily limits, burying, goals, milestones, the
  weekly summary, Stats, the FSRS optimizer data and the deck numbers are all derived from the valid reviews
  (`review-parse.json`). The server's heatmap cells count `review` events (`activity.json`, `internal/stats`).
- Every web consumer reads reviews through one function: `store.ts` `reviewsOf` (inside `loadStudyDataWith`,
  before the canonical merge), for the uncached loads and the widgets' cached history alike. The exceptions read
  the raw log only for things a replacement cannot change (the vacation planner's "reviewed today" stamps; the
  plugin SDK's `events.list`, which hands raw events to plugins).
- The session page (`routes/study/session/+page.svelte`) mixes the queue once (#132). A grade runs `applyGrade`
  (`requeue.ts`: an Again on a first showing inserts a re-show `REQUEUE_GAP` cards later), then
  `buryAfterAnswer` (`cardFlow.ts`: an answer of an opt-in kind removes the word's later siblings). A re-show is
  practice: never recorded. Each card is recorded at most once per session. The page keeps `sessionReviews` for
  XP and streak, built by `sessionReview` with a **new** ULID (not the recorded event's id).
- Keys: 1–4 grade, Space/Enter reveal, P plays; the tone card uses 1–5, arrows and **Backspace** before its
  check; typed answers use text fields. Escape is not used by the session.

## The event: a replacing review

A changed grade is a new `review` event with one more payload member:

```
{cardId, mode, grade, meta?, replaces: "<id of the review it replaces>"}
```

written with the **target's** `cardId`, `mode`, `meta` and `ts` (the target's instant; the web sends the same
`ts` string it recorded, the server truncates both to the same second) and a fresh ULID.

Ruling: `replaces` on a new review, not a separate void event — one event is atomic (a partly flushed outbox
or a lost POST can never leave a void without its new grade, or the reverse), it keeps the "every review is one
event" shape every counter already reads, and a writer needs no second type — cost if wrong: clients that do
not know the rule (cached old web shells, Android before it ports this) count both reviews of the card; with a
void event they would count the new review and the old one alike, so neither shape avoids that.

Ruling: the replacement carries the target's `ts`, not the time of the change — the review stands in for the
target in time: the same replay position, learner day, heatmap cell, streak day and limit day, so a changed
grade moves no count to another day; the pull pages events by arrival (`updated_at`), so an old `ts` is never
missed — cost: a `GET /api/events?since=` reader (a plugin) that already read past that second misses the
replacement until it reads from earlier again.

Ruling: `meta` is copied (answer time, mistakes, hints, tier) — the answer happened once; goals count its
`durationMs` once — cost: none.

## Which reviews count (the shared rule, `events/review-replace.json`)

Over the set of review events a client holds for a workspace (each parsed and valid, `review-parse.json`):

1. **Parse.** `replaces` is kept when it is a non-empty string, else dropped (the review stays an ordinary
   review). It is never compared case-insensitively.
2. **Link.** E links to T when `E.payload.replaces === T.id`, `T.id !== E.id`, both are valid reviews of the
   same workspace and the same `cardId`, and their instants fall in the same whole second
   (`floor(instant / 1000 ms)` equal). Otherwise the reference is ignored and E counts as an ordinary review.
3. **Families.** Links join reviews into families (connected components, links taken in both directions). A
   review with no link is a family of one.
4. **Survivor.** In each family exactly one review counts: the one with the greatest `id` (plain string
   comparison, as the `(ts, id)` order). Every other member is **replaced**.
5. A replaced review counts **nowhere**: replay, next intervals, XP, streak, daily limits, burying, goals,
   milestones, weekly, Stats, deck numbers, the optimizer data, heatmap cells. The survivor counts as an
   ordinary review at its own `ts`.

Consequences, each a fixture case: a misclick (Again, then Good replacing it) replays as Good alone; two devices
replacing the same review leave the replacement with the greater id (both target the same review; the family
holds three members); a chain (replace a replacement) leaves the last; two devices where one replaces the other
device's replacement leave the greatest id of the whole family (never two survivors); a replacement held before
its target counts alone and, once the target arrives, voids it (the order of arrival never matters: the rule
reads the set); a dangling reference (target never arrives, lost or of another user) is harmless; a link
across workspaces, cards or seconds is ignored; a replacement with the same grade changes nothing; a cycle
(two reviews naming each other) is one family with one survivor.

Ruling: the survivor is the greatest id of the family, not the head of the longest chain — ULIDs grow with
creation time, so the newest decision wins on every device whatever the shape (fork, chain, fork of a chain),
and one rule covers all of them in a union-find — cost: none, because a writer must give the replacement an id
above the one it names (time at least the target's ULID time + 1 ms, whatever its clock says; review fix 1); a
writer that breaks this loses to its target, the same answer everywhere.

Ruling: a link needs the same workspace, card and second — a buggy or hostile writer can then only void a
review of the very card at the very second it claims to stand in for, never unrelated history, and the server
can compute the voids inside the heatmap's day windows — cost: a client must copy the target's `ts` exactly
(whole second), as the writer rule says.

Ruling: replaced reviews are filtered **before** the canonical merge (`study/canonical.json`), on the stored
`cardId` — the server has no merge, and the rule must give the same answer there — cost: a replacement naming
a duplicate card's id other than the target's is ignored (no writer does that: the replacement copies the
target's `cardId`).

## Server

- **Heatmap** (`internal/stats`): before counting the `review` rule, the review events of the user in the
  window that carry a string `replaces` are read, then their targets by id (always `user_id = caller`), the
  families built with the rule above, and the replaced ids excluded from the count (`NOT IN json_each(?11)`).
  Since a link needs the same second, every family lies inside one day window. Another user's events are never
  read, so a replacement can never void another user's review.
- **Backup restore** (`internal/backup`): ids are kept, but an id another user owns gets a new ULID. After the
  events are inserted, every restored review whose `replaces` names a re-identified id is rewritten to the new
  id (other members byte for byte), inside the restore transaction. Export needs nothing (the payload travels
  as stored). A `backup/remap.json` note and a Go test pin it.
- **No validation.** The server stores `replaces` like any payload member; push, pull, `GET /api/events` and
  the outbox are unchanged.

Ruling: no outbox shortcut (rewriting or dropping an unsent target) — an outbox item can be mid-flight (sent,
answer lost); a rewritten item with the same id would be a duplicate the server ignores (the wrong grade
stays), a dropped one would leave the stored wrong grade unreplaced; always appending a replacement is correct
in every state — cost: one extra event per changed grade.

## Web

- `study/replaced.ts` `liveReviews(reviews)`: the rule above, pure, order-preserving; `reviewParse.ts` keeps
  `replaces`. `store.ts` `reviewsOf` applies it, so every consumer listed in Today honours it with no change.
- `study/events.ts`: `recordReview` returns the event it recorded (posted or queued); `recordReplacement(target,
  grade)` builds and records the replacement the same way (outbox on failure). `grade.ts` passes the recorded
  event back (`GradeItemResult.review`), so `sessionReviews` holds the real events (the separate `sessionReview`
  id goes).
- `study/regrade.ts` (pure): the Back history and the regrade's session effects (below).

## Session: Back

- A **Back** button in the action dock (also on the summary screen) and the key **Z** step to the card graded
  last; Back again steps further. The card shows its answer side as it was left (the stored resolved card, the
  exercise is not replayed), the grade bar with the interval preview from the history without this review, the
  previous grade marked ("your grade", `aria-pressed`), and the suggestion of the exercise as before
  (auto-graded kinds). **Return** (or Escape) goes back to the current card without a change.
- Choosing a grade: the same grade changes nothing; another grade records the replacement (a recorded step) or
  only edits the queue (a practice step), then returns to the current card. A short announcement says what
  changed ("Changed to Good. Next review in 10 minutes.").
- **Effects undone** (pure `regradeQueue`): an Again's pending re-show of the card (one still ahead of or at the
  current card) is removed; a new Again queues a re-show the way `requeueAfterGrade` would have at the card's
  own position (`REQUEUE_GAP` after it, never before or in place of the current card — right after it at the earliest, review fix 2; appended at the summary — FIFO behind other re-shows, none when the
  card was the last one and others exist, none beyond `MAX_RESHOWS`, none when the card already appears after
  its position). A re-show already shown stays shown (practice). Burying depends on the kind, not the grade,
  and the daily new/review counts on the card, not the grade: a regrade keeps both. XP, level and streak are
  derived from `sessionReviews`, where the replacement takes the target's place.
- `Z` is ignored while a text field or a card input (`data-card-input`) has focus, while grading, and with
  modifier keys.

Ruling: Back is session-only (an in-memory history of this open session; gone after a reload or a workspace
switch), not "change the last grade" from the decks view or history — the session is where a misclick happens
and where its effects (re-show, intervals) can be shown and undone; a later entry point can write the same
event — cost: a misclick noticed after closing the session stays (it is still one review among many).

Ruling: at most the last 20 graded showings (`BACK_LIMIT`), recorded and practice alike — "several cards" with
a bound so the history cannot grow with a long session; 20 is more than a learner scrolls back — cost: none.

Ruling: the key is Z, not Backspace — Backspace clears a tone on the tone card and deletes text in typed
answers; Z is free in the session (Anki's undo is Ctrl+Z; the session ignores modified keys) — cost: none.

Ruling: going Back unmounts the current card and returning mounts it again (review fix 7): the reveal (`done`,
the suggestion, the interval preview) is kept by the page, but a partly done exercise (typed text, placed tiles
or tones, drawn strokes) is discarded — keeping six card components alive and hidden behind the Back view would
need a second face per kind and focus/key isolation between them; Back is used right after a misclick, before
work on the next card has started — cost: a learner who goes Back mid-exercise redoes that exercise.

Ruling: Escape returns from a Back view — it is unused in the session and is the expected "leave this view"
key — cost: none.

Ruling: the summary screen offers Back too — the last card's misclick is the commonest; a regrade to Again
there queues its re-show and the session continues — cost: none.

## Offline

The replacement goes through the same outbox as any review (posted, or queued on failure, flushed oldest
first, so its target goes first). The offline session's history (`withQueued`) applies the rule to queued and
sent events, so a changed grade offline is honoured at once.

## Android

Port `liveReviews` and run `events/review-replace.json`; apply it before every count. A writer copies the
target's `cardId`, `mode`, `meta` and `ts` (whole second, UTC) and names the family's current survivor.

## Out of scope

Changing a grade outside the open session; editing or deleting stored events; server-side validation of
`replaces`; plugins reading reviews through `events.list` (raw events; the plugin docs say to honour
`replaces`).
