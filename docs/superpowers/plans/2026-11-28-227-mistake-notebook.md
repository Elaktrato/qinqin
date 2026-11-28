# #227 — the mistake notebook (2026-11-28)

Milestone v0.9.0, phase 5 (after #224 and #277). Branch `feature/v090-227-notebook` from `feature/v0.9.0` (6adf22ef,
ContractVersion 38). This builder does **not** hold the text-heavy slot: UI strings only, no teacher reviews (see
"Pending review").

## What (issue and owner decisions)

- One list of what the learner got wrong, across the study sources, grouped by kind, newest first, each with what
  went wrong and a link to where it is practised.
- "Practise my mistakes": a round built from the notebook with the exercise that fits each mistake.
- **An item leaves after 3 correct answers in a row** (owner decision, v0.9.0 plan §4), or when removed by hand.
- Derived from events; nothing stored beyond the "removed by hand" marks. Per user and workspace, in backups,
  clearable.
- Contract 41 (#225 takes 39, #228 takes 40; the orchestrator renumbers on merge).

## Tasks

1. This plan.
2. The rules, test first: `lib/studycore/notebook.ts` (what each source's event says about an item: wrong, right or
   nothing; the item key; the group; the replay with the 3-in-a-row rule, the removal and clear marks) and the
   contract `docs/contracts/notebook/` (README, `notebook.json`), the `notebook` event type (`events/README.md`,
   `payloads.json` `build`, `lib/events/eventPayloads.ts`), `StudyHistory.notebookMarks` (`historyOf`).
   ContractVersion 41, CHANGELOG.
3. Backup: a restore remaps the card id inside a `notebook` mark of a card item, as it does a review's `cardId`
   (`server/internal/backup/remap.go`, `remap.json` case, Go test first).
4. The page `/notebook` (`lib/notebook`, a feature folder, `routes/notebook`): the groups, each item's line (what,
   what went wrong, when, "n of 3 right"), its link, Remove, Clear the notebook (confirm). Linked from the Practice
   list, the Decks page and the Grammar page. DOM tests first.
5. "Practise my mistakes" (`/notebook/practise`): the notebook's drill items as one mixed round through Practice's
   `RoundView` (each drill's own question); the notebook's cards that are due now as a flashcards session limited to
   those cards (`StudySessionConfig.cardIds`, `deckSessionPlan` `onlyCards`); grammar and course items through their
   own links. Tests first for the session filter.
6. Phone width (`phone-width.spec.ts` gains `/notebook` and `/notebook/practise`), an e2e of the page, page
   manifest, folder rules, docs (wiki, README if it lists features, `docs/releases/NEXT.md`).

## Rulings

- Ruling: **the sources are the four study sources with per-event outcomes in the base** — flashcard `review`s,
  `grammar` runs (lesson and review), `drill.<id>` answers (every drill id that parses, as the drills contract
  says) and `course` events; the scripts trainer, journal corrections (#46) and lookup history (#72) are left out —
  the orchestrator's brief names these four; the scripts trainer's `script` events are parsed in its own feature
  (not the core) with their own boxes, journal corrections are journal rows (not events) and a repeated lookup is not
  a wrong answer — cost if wrong: one more source in `notebookEntries` and the fixture (an addition, no reshaping).
- Ruling: **item identity per source**: a card `card:<cardId>` (the surviving id after the duplicate merge; replaced
  reviews dropped first, as everywhere); a drill item `drill.<drillId>:<item>`; a grammar point `grammar:<point>`;
  a course lesson `course:<courseId>:lesson:<unitId>:<lessonId>`; a unit test `course:<courseId>:unit:<unitId>`; a
  section exam `course:<courseId>:section:<sectionId>` — these are the keys each source already schedules or
  derives by; none holds a white space and a pack id has no `:`, so the key reads back unambiguously — cost if wrong:
  removal marks written under the old keys stop matching.
- Ruling: **what is wrong and what is right**:
  - a review: grade 1 (Again) wrong, 2–4 right (FSRS's own pass line; the issue says "graded Again");
  - a drill answer: grade 1 wrong, 2–4 right (the drills contract: 2 is a right answer after a hint);
  - a grammar run with `total > 0`: below the learned mark (`100 · score < 80 · total`) wrong, at or above it right
    (the grammar review's Good line, `grammar/review.json`); `total = 0` is nothing;
  - a course `lesson-finished` with `total > 0`: below 80 % wrong, else right (a lesson check has no pass mark; 80 % is
    the grammar mark and the unit test's default);
  - a `unit-test`: `passed: false` and not `early` wrong; `passed: true` right; a failed **early** test (taken to skip
    ahead) is nothing — the learner had not studied the unit, so a miss there is not a mistake;
  - a `section-exam`: `passed: false` wrong, `passed: true` right, except a failed exam that is a **placement** step:
    the course's next course event (in replay order) is a `placement` of that section — placement uses the exam to
    find the start, a fail there only says where to start;
  - `lesson-started` and `placement` are nothing.
  The score sources have no record of which question was missed, so their item is the whole run (the point, the
  lesson, the test) — cost if wrong: a 9/10 grammar run does not enter; a learner who fails one in five exercises of
  a lesson never sees it here.
- Ruling: **the replay**: all of a workspace's outcomes and marks in `(instant of ts, id)` order. A wrong answer puts
  the item in (or keeps it in) and sets its run of right answers to 0; a right answer of an item that is in adds 1,
  and at **3** the item leaves; a right answer of an item that is out does nothing. A later wrong answer puts it back
  with a fresh count. `mistakes` counts the wrong answers since it last entered; `since` is when it entered, `last`
  the instant of the last wrong answer and `detail` what that answer was. The order across sources is the event
  order, so a review on a phone and a drill on a laptop replay the same way everywhere — cost if wrong: none beyond
  the fixture.
- Ruling: **"removed by hand" and "clear" are events**, type `notebook`: `{action: "remove", item: "<key>"}` and
  `{action: "clear"}`, in the workspace, through the outbox. A removal takes an item out at that point of the replay
  (a later wrong answer brings it back); a clear takes every item out. An event, not a keyed row: the replay orders it
  against the answers on every device with no last-write-wins conflict, it is per user and workspace, it is in
  backups and the deletion preview already (the event log), and it needs no new table or delete rule; a keyed row
  per item could not hold a 200-code-point drill item in a 512-byte key and a single row would lose concurrent removals
  — cost if wrong: marks are append-only, so a long life of removals grows the log by one small event each (as the
  review log does).
- Ruling: **the notebook "clear" does not delete the underlying answers** — they are the review history every
  schedule is replayed from; "clearable" is the notebook's view — cost if wrong: a learner who wants the answers gone
  deletes the workspace (the existing route), as before.
- Ruling: **groups**: `words` (vocab, reverse, cloze and sentence cards; the measure-words, counters and
  counter-readings drills), `characters` (writing cards, cards of character entries, the look-alike drill
  `look-alikes`), `tones` (tone cards, the tone-pairs drill), `grammar` (grammar points, the conjugation drill),
  `course` (course lessons, unit tests, section exams); a drill id the table does not name goes to `words` — the
  issue's four groups plus the course's own checkpoints — cost if wrong: an item shows under another heading.
- Ruling: **an item whose card is gone is not shown** (the card's deck was deleted, or the card) — there is nothing
  to practise or link to; its events stay — cost if wrong: none.
- Ruling: **the order**: newest first by `last` (the last wrong answer), then the key (UTF-16 order), inside each
  group; groups in the order above.
- Ruling: **the notebook is not a switchable core feature**: it reads every feature's events and works in every
  language, so it is a feature folder (`lib/notebook`) with its own route, linked from Decks, Practice and Grammar
  (no nav section, like the lookup history) — a feature switch would be a server contract change for a page that
  holds no data of its own — cost if wrong: one switch added later.
- Ruling: **"Practise my mistakes"** is a mixed round of the notebook's **drill** items (Practice's `RoundView`, as
  the weakest round mixes drills), plus a flashcards session of the notebook's cards **that are due now**, plus links
  for grammar points and course checkpoints (their lesson or test) — a card practised before it is due spends its
  spacing (FSRS counts it as a review), and an Again card is due again within minutes anyway; grammar runs and course
  tests are whole runs that their own players ask — cost if wrong: a card that is in the notebook but not due waits for
  its review; the page says so.
- Ruling: **a drill item that is no longer a candidate** (the word left the decks) is listed but not asked in the
  round (as the drills' own rounds do) — cost if wrong: none.
- Ruling: **the card session filter**: `StudySessionConfig.cardIds` limits a deck session to those card ids (over the
  decks those cards are in, every kind, no companions, Study all); the planner still asks a listed card only when it is
  due (or new: the notebook lists none, every card in it has a review) — the same planner, one filter — cost if wrong:
  none for other sessions (absent = no filter).
- Ruling: **UI strings live under `study.notebook.*`**, not a new key area — a new area is an i18n contract change
  (`i18n/README.md` lists the areas) for no gain — cost if wrong: a rename when the notebook gets its own area.
- Ruling: **a sent mark is remembered like a sent answer** (`recentSent`, three days): the event log is cached for a few
  seconds, and without it a removed item stays on the page after Remove until the log refreshes (the e2e found this)
  — cost if wrong: none.
- Ruling: **restore remaps a card mark**: a `notebook` event whose `item` is `card:<id>` gets the id through the same
  map as a review's `cardId` (export notes the card as a reference); other items are kept byte for byte — the drill
  items that name entry ids are not remapped today either (drills contract), a known gap — cost if wrong: a card
  removed by hand comes back after a restore to another server.
- Ruling: **contract fixtures are decoded by the web**, with the `build` cases of the mark also by Go (the restore
  reads the `item` member) — the notebook is a client rule over events the server only stores, as `drills/pick.json`
  and `courses/tests.json` — cost if wrong: a second client decodes the same fixture.

## Pending review (text-heavy slot not held)

None needed for content: the change adds UI strings only (`en.json`). The `de`/`ja` catalogues do not exist yet on
this base (#144/#145 translate the final strings last).

## Local follow-up

- #227: open `/notebook` in the Android shell on a phone (back button from the round and from the flashcards session,
  focus in a drill's typed answer, no keyboard dismissal on Next). Commands: build the APK (`apps/android`, wiki
  Android), install, sign in, answer a card Again and a drill item wrong, open the notebook from Decks.

## Execution record

Commits (oldest first): the plan; `feat(studycore)` the rules and the mark event (contract 41); `feat(backup)` the
restore remap; `feat(flashcards)` the `cardIds` session filter; `feat(notebook)` the page and the round; `feat(notebook)`
the links; `fix(studycore)` sent marks remembered; `test(e2e)`; `docs(notebook)`.

- **Rules, test first.** The fixture `notebook.json` (hand-written expectations, a scratch script only laid out the
  JSON) and `notebook.contract.test.ts` were written first and failed (no module); `notebook.ts` made all 37 cases pass
  on the first run. `historyOf` gained `notebookMarks` (one expectation in `data.load.test.ts` updated).
- **Backup, test first.** The two `remap.json` cases failed (`TestRemapCases`) before `remap.go` handled `notebook`;
  `notebook_test.go` (the export's entry ref) was written after `export.go` was changed, then shown to fail with the
  change stashed (entry 3 missing from refs) and pass with it.
- **Session filter, test first.** `onlyCards.test.ts` and the `cardIds` case of `session.test.ts` failed first; one
  expectation was then corrected (a listed new card is still asked; the notebook never lists one).
- **The page.** `view.ts` (the words and links) and `practise.ts` were written before their tests (`view.test.ts`,
  `practise.test.ts`, 10 cases) — not test-first; `NotebookPage.dom.test.ts` (6 cases) was written after the component,
  also not test-first. Two DOM expectations waited on the loading heading and were fixed in the test.
- **The e2e** (`notebook.spec.ts`) failed on the first run: after Remove the item stayed, because the cached log did not
  have the sent mark yet. Test first for the fix: a `recentSent` case failed, `notebook` joined the remembered types,
  the e2e passed.
- **Phone width.** `/notebook` and `/notebook/practise` are in the main page list (empty notebook) and in their own
  test with a card, a tone pair and a grammar point whose lesson id is 120 characters without a space.

Not verified here: the Android shell (no SDK, Local follow-up), a hand check on a phone.

The full vitest run found two route guards the targeted runs missed (`routeTitles.test.ts`, `pageFrame.test.ts`: a
route sets its own document title, a path without a section has a phone title); fixed in
`fix(notebook): the notebook's routes have a document and a phone title`.

## Gates (final state)

- Go `gofmt -l .` empty; `go vet ./...` clean; `go test -count=1 -p 2 ./...` (cmd/qinqin included, `ok 32.5s`): every
  package ok except the known environment-only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6).
- `npm run check`: 0 errors, 0 warnings (2210 files). `npm run build`: ok.
- Full vitest: 797 files passed, 1 skipped; 15 982 tests passed, 3 skipped.
- Full e2e: 83 passed.
- `node --test scripts/*.test.mjs`: 244 tests, 243 pass, 1 skipped. `node scripts/gen-api-docs.mjs --check`: ok (no
  new route).
